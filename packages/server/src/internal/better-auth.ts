import {
  assertBetterAuthMountAdapter,
  invokeBetterAuthMountAdapter,
  type BetterAuthMountAdapter,
} from '@kovojs/better-auth/internal/server-mount-adapter';
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import {
  bigint,
  integer as pgInteger,
  PgTable,
  pgTable,
  text as pgText,
} from 'drizzle-orm/pg-core';
import {
  integer as sqliteInteger,
  SQLiteTable,
  sqliteTable,
  text as sqliteText,
} from 'drizzle-orm/sqlite-core';

import { publicAccess } from '../access.js';
import {
  frameworkEndpoint,
  pinEndpointBrowserCredentialDelegation,
  type EndpointDeclaration,
} from '../endpoint.js';
import {
  constructMutationDeclaration,
  type MutationCsrfDeclaration,
  type MutationDefinition,
  type MutationFormDefinition,
} from '../mutation/definition.js';
import type { Schema } from '../schema.js';
import { usePostgresSystemDb, type KovoPostgresSystemDb } from './postgres-capability.js';
import { useSqliteSystemDb, type KovoSqliteSystemDb } from './sqlite-capability.js';

const BETTER_AUTH_RATE_LIMIT_BUCKET_PREFIX = 'kovo-ba-rl-v1:';
const BETTER_AUTH_RATE_LIMIT_MAX = 3;
const BETTER_AUTH_RATE_LIMIT_WINDOW_MS = 10_000;
const BETTER_AUTH_RATE_LIMIT_BUCKET_PATTERN = /^kovo-ba-rl-v1:[0-9a-f]{4}$/u;

// These functions are never called. Their return types give the reviewed dynamic-schema boundary
// an exact Drizzle shape after the runtime table/column census below has succeeded.
function postgresRateLimitTableContract() {
  return pgTable('rateLimit', {
    count: pgInteger().notNull(),
    id: pgText().primaryKey(),
    key: pgText().notNull().unique(),
    lastRequest: bigint({ mode: 'number' }).notNull(),
  });
}

function sqliteRateLimitTableContract() {
  return sqliteTable('rateLimit', {
    count: sqliteInteger().notNull(),
    id: sqliteText().primaryKey(),
    key: sqliteText().notNull().unique(),
    lastRequest: sqliteInteger().notNull(),
  });
}

type PostgresRateLimitTable = ReturnType<typeof postgresRateLimitTableContract>;
type SqliteRateLimitTable = ReturnType<typeof sqliteRateLimitTableContract>;

/** @internal Fixed input accepted by Kovo's Better Auth bucket consumers. */
export interface BetterAuthRateLimitBucketInput {
  /** Fixed-width, HMAC-derived Kovo bucket key; never a raw IP address or URL path. */
  bucketKey: string;
  /** Exact credential-attempt ceiling. */
  max: number;
  /** Exact credential window in milliseconds. */
  windowMs: number;
}

/** @internal Atomic bounded-bucket consumer used by the first-party Better Auth adapters. */
export type BetterAuthRateLimitBucketConsumer = (
  input: BetterAuthRateLimitBucketInput,
) => Promise<boolean>;

/**
 * Declare a framework-owned Better Auth mutation with an exact reviewed wire key. App-authored
 * declarations stay on the public source-derived `mutation({ ... })` API; this adapter-only entry
 * keeps the branded mutation mint in the same packed server chunk that later consumes it
 * (SPEC §4.1/§6.5).
 *
 * @internal
 */
export function createBetterAuthCredentialMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
>(
  key: Key,
  definition: Omit<
    MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
    'csrf' | 'csrfJustification' | 'key'
  > &
    MutationCsrfDeclaration<Request>,
): MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> &
  MutationFormDefinition<Key, Request> {
  // This adapter's broad generic keeps both optional keys in its structural type. Enter the same
  // runtime-validating constructor directly: an actual dual declaration is still rejected before
  // any mutation snapshot or executable declaration can escape.
  return constructMutationDeclaration(key, definition);
}

/**
 * Build the fixed endpoint for an exact opaque Better Auth adapter token. This entry accepts no
 * handler, auth declaration, CSRF exemption, access decision, or response posture from its caller;
 * a forged or structural token fails before private browser authority is minted (SPEC §6.6/§9.1).
 *
 * @internal
 */
export function createBetterAuthMountEndpoint<const Path extends string>(
  path: Path,
  adapter: BetterAuthMountAdapter,
): EndpointDeclaration<Path, 'GET', 'prefix'> {
  assertBetterAuthMountAdapter(adapter);
  return frameworkEndpoint(
    path,
    {
      access: publicAccess('better-auth provider redirect protocol handled by Better Auth state'),
      auth: { kind: 'custom', name: 'better-auth' },
      csrf: false,
      csrfJustification: 'better-auth browser redirect protocol handler',
      async handler(request) {
        return await invokeBetterAuthMountAdapter(adapter, request);
      },
      method: 'GET',
      mount: 'prefix',
      mountJustification: 'better-auth owns provider callback subpaths under this mount',
      reason: 'better-auth provider redirect and callback mount',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        reservedHeaders: ['Location', 'Set-Cookie'],
      },
    },
    (declaration) => {
      pinEndpointBrowserCredentialDelegation(declaration);
    },
  );
}

/**
 * Build the Postgres half of Kovo's bounded Better Auth credential limiter.
 *
 * The table is validated before the cast, and every decision is one atomic, DB-clock statement.
 * The fixed HMAC bucket space bounds persistent cardinality while collisions aggregate attempts
 * and therefore fail closed (SPEC §6.6/§10.3 C9).
 *
 * @internal
 */
export function createBetterAuthPostgresRateLimitBucketConsumer(
  capability: KovoPostgresSystemDb,
  table: unknown,
): BetterAuthRateLimitBucketConsumer {
  const rateLimit = requirePostgresRateLimitTable(table);
  return usePostgresSystemDb(capability, (db) => async (input) => {
    assertBetterAuthRateLimitBucketInput(input);
    const databaseNow = sql<number>`CAST(EXTRACT(EPOCH FROM statement_timestamp()) * 1000 AS BIGINT)`;
    const rows = await db
      .insert(rateLimit)
      .values({
        count: 1,
        // Keep the primary key independent so `key` is the only deterministic conflict. Real
        // PostgreSQL may report a simultaneous PK collision before the targeted key arbiter.
        id: sql<string>`gen_random_uuid()::text`,
        key: input.bucketKey,
        lastRequest: databaseNow,
      })
      .onConflictDoUpdate({
        set: {
          count: sql<number>`CASE WHEN ${rateLimit.lastRequest} < ${databaseNow} - ${input.windowMs} THEN 1 ELSE ${rateLimit.count} + 1 END`,
          lastRequest: databaseNow,
        },
        setWhere: sql`${rateLimit.lastRequest} < ${databaseNow} - ${input.windowMs} OR ${rateLimit.count} < ${input.max}`,
        target: rateLimit.key,
      })
      .returning();
    return rows.length === 1;
  });
}

/**
 * Build the SQLite half of Kovo's bounded Better Auth credential limiter.
 *
 * SQLite serializes the upsert itself; the database clock and conditional conflict update keep
 * independent framework instances from admitting more than the exact shared ceiling.
 *
 * @internal
 */
export function createBetterAuthSqliteRateLimitBucketConsumer(
  capability: KovoSqliteSystemDb,
  table: unknown,
): BetterAuthRateLimitBucketConsumer {
  const rateLimit = requireSqliteRateLimitTable(table);
  return useSqliteSystemDb(capability, (db) => async (input) => {
    assertBetterAuthRateLimitBucketInput(input);
    const databaseNow = sql<number>`CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`;
    const rows = await db
      .insert(rateLimit)
      .values({
        count: 1,
        id: sql<string>`lower(hex(randomblob(16)))`,
        key: input.bucketKey,
        lastRequest: databaseNow,
      })
      .onConflictDoUpdate({
        set: {
          count: sql<number>`CASE WHEN ${rateLimit.lastRequest} < ${databaseNow} - ${input.windowMs} THEN 1 ELSE ${rateLimit.count} + 1 END`,
          lastRequest: databaseNow,
        },
        setWhere: sql`${rateLimit.lastRequest} < ${databaseNow} - ${input.windowMs} OR ${rateLimit.count} < ${input.max}`,
        target: rateLimit.key,
      })
      .returning();
    return rows.length === 1;
  });
}

function assertBetterAuthRateLimitBucketInput(input: BetterAuthRateLimitBucketInput): void {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.bucketKey !== 'string' ||
    !BETTER_AUTH_RATE_LIMIT_BUCKET_PATTERN.test(input.bucketKey) ||
    input.bucketKey.slice(0, BETTER_AUTH_RATE_LIMIT_BUCKET_PREFIX.length) !==
      BETTER_AUTH_RATE_LIMIT_BUCKET_PREFIX ||
    input.max !== BETTER_AUTH_RATE_LIMIT_MAX ||
    input.windowMs !== BETTER_AUTH_RATE_LIMIT_WINDOW_MS
  ) {
    throw new TypeError(
      'KV414: invalid Better Auth rate-limit bucket input; use the first-party bounded storage adapter (SPEC §6.6).',
    );
  }
}

function requirePostgresRateLimitTable(table: unknown): PostgresRateLimitTable {
  if (!is(table, PgTable) || getTableName(table) !== 'rateLimit') {
    throw new TypeError(
      'KV414: Better Auth Postgres rateLimit must be the pinned Drizzle rateLimit table.',
    );
  }
  requireRateLimitColumns(getTableColumns(table), 'Postgres');
  return table as PostgresRateLimitTable;
}

function requireSqliteRateLimitTable(table: unknown): SqliteRateLimitTable {
  if (!is(table, SQLiteTable) || getTableName(table) !== 'rateLimit') {
    throw new TypeError(
      'KV414: Better Auth SQLite rateLimit must be the pinned Drizzle rateLimit table.',
    );
  }
  requireRateLimitColumns(getTableColumns(table), 'SQLite');
  return table as SqliteRateLimitTable;
}

function requireRateLimitColumns(
  columns: Record<string, { columnType?: unknown }>,
  dialect: 'Postgres' | 'SQLite',
): void {
  const id = columns.id;
  const key = columns.key;
  const count = columns.count;
  const lastRequest = columns.lastRequest;
  if (
    id?.columnType !== (dialect === 'Postgres' ? 'PgText' : 'SQLiteText') ||
    key?.columnType !== (dialect === 'Postgres' ? 'PgText' : 'SQLiteText') ||
    count?.columnType !== (dialect === 'Postgres' ? 'PgInteger' : 'SQLiteInteger') ||
    lastRequest?.columnType !== (dialect === 'Postgres' ? 'PgBigInt53' : 'SQLiteInteger')
  ) {
    throw new TypeError(
      `KV414: Better Auth ${dialect} rateLimit must expose exact id/key/count/lastRequest columns.`,
    );
  }
}
