import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DatabaseSync as NodeSqliteDatabaseSync,
  constants as nodeSqliteConstants,
} from 'node:sqlite';

import Database from 'better-sqlite3';
import {
  createSqliteAppRuntimeDb,
  declareSecretReadCapability,
  runtimeDbMetadataForSchema,
  type AccessDecision,
  type CsrfOptions,
  type KovoSqliteAppRuntimeDb,
} from '@kovojs/server';
import {
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
} from '@kovojs/better-auth';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';
import type { AppRequest, AppSession } from '../auth.js';

// The framework-owned app database runtime for the opt-in SQLite scaffold.
// Postgres remains the default starter dialect.

interface CreatedAppRuntimeDb extends KovoSqliteAppRuntimeDb<AppDb> {
  ready: Promise<void>;
  sqliteFile: string;
}

const SCHEMA_DDL = [
  // App domain.
  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT '');",
  // Better Auth tables (column names match src/schema.ts). SQLite stores
  // booleans and Drizzle timestamp_ms dates as integer mode columns.
  'CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" integer NOT NULL DEFAULT 0, image text, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
  'CREATE TABLE "session" (id text PRIMARY KEY, "expiresAt" integer NOT NULL, token text NOT NULL UNIQUE, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);',
  'CREATE TABLE "account" (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" integer, "refreshTokenExpiresAt" integer, scope text, password text, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
  'CREATE TABLE "verification" (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" integer NOT NULL, "createdAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)), "updatedAt" integer NOT NULL DEFAULT (CAST(unixepoch(\'subsec\') * 1000 AS integer)));',
].join('\n');

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park');";
const SCHEMA_TABLES = [
  schema.contacts,
  schema.user,
  schema.session,
  schema.account,
  schema.verification,
] as const;
const RUNTIME_DB_METADATA = runtimeDbMetadataForSchema(SCHEMA_TABLES);
const SQLITE_RUNTIME_WARNING =
  'Kovo SQLite starter is experimental and single-principal only: SQLite has no engine role/RLS layer, so Kovo owner scoping is not enforced. Use the default PGlite/Postgres runtime for multi-tenant authorization.';
let sqliteRuntimeWarningPrinted = false;

function createAppRuntimeDb(): CreatedAppRuntimeDb {
  warnExperimentalSqliteRuntime();
  const sqliteDir = mkdtempSync(join(tmpdir(), 'kovo-sqlite-runtime-'));
  const sqliteFile = join(sqliteDir, 'app.sqlite');
  process.once('exit', () => rmSync(sqliteDir, { force: true, recursive: true }));
  const client = new Database(sqliteFile);
  client.exec(SCHEMA_DDL);
  client.exec(SEED_CONTACTS);
  const db = drizzle({ client });
  const runtime = createSqliteAppRuntimeDb({
    db,
    metadata: RUNTIME_DB_METADATA,
    normalizeTableName: normalizePolicyTable,
    sqliteAuthorizer: {
      constants: nodeSqliteConstants,
      openDatabase: () => new NodeSqliteDatabaseSync(sqliteFile),
    },
    sqliteColumnOrigins: client,
    tableNames: sqliteTablePolicyNames,
  });
  return {
    ...runtime,
    ready: Promise.resolve(),
    sqliteFile,
  };
}

type SqliteTable = Parameters<typeof getTableConfig>[0];
export { declareSecretReadCapability };

function sqliteTablePolicyNames(table: unknown): string[] {
  try {
    const config = getTableConfig(table as SqliteTable);
    const schema = (config as { schema?: unknown }).schema;
    const schemaName = typeof schema === 'string' ? schema : undefined;
    const names = [normalizePolicyTable(config.name)];
    if (schemaName !== undefined) names.push(`${schemaName}.${config.name}`);
    return [...new Set(names)];
  } catch {
    throw new Error(
      'KV406: SQLite adapter declared-write fallback could not resolve a Drizzle write table (SPEC §10.3/§11.2).',
    );
  }
}

function normalizePolicyTable(table: string): string {
  return table.includes('.') ? table : `main.${table}`;
}

const appDatabase = createAppRuntimeDb();

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/**
 * Framework-owned auth adapter factory. The SQLite DB value remains module-private to the
 * generated runtime module, matching the Postgres auth wiring capability boundary.
 */
function createAuthAdapter(): ReturnType<typeof drizzleAdapter> {
  return drizzleAdapter(appDatabase.db, { provider: 'sqlite', schema: schema.authSchema });
}

interface AppAuthBindingOptions {
  baseURL: string;
  csrf: CsrfOptions<AppRequest>;
  secret: string;
  signInAccess: AccessDecision;
  signOutAccess: AccessDecision;
}

/** SQLite twin of the framework-owned Better Auth construction boundary (SPEC §6.6/§10.3). */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  const auth = betterAuth({
    advanced: { disableCSRFCheck: true },
    baseURL: options.baseURL,
    database: createAuthAdapter(),
    emailAndPassword: { enabled: true },
    secret: options.secret,
  });

  const sessionProvider = betterAuthSession(auth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: { email: user.email, id: user.id, name: user.name },
  }));
  const signIn = betterAuthSignInEmailMutation<'auth/sign-in', AppRequest>(auth, {
    access: options.signInAccess,
    csrf: options.csrf,
    defaultRedirectTo: '/',
  });
  const signOut = betterAuthSignOutMutation<
    'auth/sign-out',
    AppRequest,
    AppRequest & { session: AppSession }
  >(auth, {
    access: options.signOutAccess,
    csrf: options.csrf,
    defaultRedirectTo: '/login',
  });

  async function seedDemoUser(): Promise<void> {
    // SPEC §2/§6.6: the generated credential is a local-development convenience,
    // never a production authentication path. A copied gitignored .env must not
    // silently provision a known demo principal when the deploy artifact boots.
    if (process.env.NODE_ENV === 'production') return;
    const password = process.env.KOVO_DEMO_PASSWORD;
    if (!password || password === 'replace-with-a-local-demo-password') return;

    try {
      await auth.api.signUpEmail({
        asResponse: true,
        body: { email: 'demo@example.com', name: 'Demo User', password },
        headers: new Headers(),
      });
    } catch {
      // Already seeded.
    }
  }

  return Object.freeze({ seedDemoUser, sessionProvider, signIn, signOut });
}

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  void request;
  if (request === undefined) return appDatabase.db;
  return appDatabase.db;
}

function warnExperimentalSqliteRuntime(): void {
  if (sqliteRuntimeWarningPrinted) return;
  sqliteRuntimeWarningPrinted = true;
  console.warn(SQLITE_RUNTIME_WARNING);
}
