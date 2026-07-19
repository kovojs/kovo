import { setTimeout as nodeSetTimeout } from 'node:timers';

import { mintFrameworkDurableReplayStoreReceipt } from '@kovojs/core/internal/security-markers';

import { snapshotAuditJustification } from './audit-justification.js';
import type { CapabilityReplayStore } from './capability-url.js';
import { parseMutationIdemToken } from './mutation-idem.js';
import {
  assertMutationReplayScopedKey,
  MutationReplayConflictError,
  mutationReplayScopedKeyFrame,
  snapshotMutationReplayResponse,
  type MutationReplayReservation,
  type MutationReplayResponse,
  type MutationReplayStore,
} from './replay.js';
import { replayMutationWireBody } from './response.js';
import {
  securityBufferFrom,
  securityBufferToString,
  securityEncodeURIComponent,
  securityJsonParse,
  securityJsonStringify,
  securityRandomUuid,
  securitySha256Base64,
  securityString,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';
import { requestStateIsSafeInteger, requestStateNow } from './request-state-intrinsics.js';
import {
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessReflectApply,
} from './security-witness-intrinsics.js';
import type {
  DurableTaskStatusSqlExecutor,
  DurableTaskStatusSqlResult,
} from './task-observability.js';
import {
  snapshotWebhookReplayIdentity,
  snapshotWebhookReplayResponse,
  WebhookReplayIdentityConflictError,
  type WebhookReplayIdentity,
  type WebhookReplayReservation,
  type WebhookReplayStore,
  type WebhookWireResponse,
} from './webhook.js';

/** Framework-owned durable replay relation provisioned with the Postgres runtime (SPEC §10.3). */
export const POSTGRES_REPLAY_TABLE = '_kovo_replay';
/** Durable monotonic floor preventing reclaimed truth from reviving after database clock rollback. */
export const POSTGRES_REPLAY_WATERMARK_TABLE = '_kovo_replay_reclaimed';
/** Hard database admission-slot ceiling shared by provisioning and runtime validation. */
export const POSTGRES_REPLAY_MAX_ENTRIES = 1_000;
/** Maximum raw UTF-16LE response-body bytes admitted to one durable replay row. */
export const POSTGRES_REPLAY_MAX_RESPONSE_BODY_BYTES = 1_048_576;
/** Maximum base64 bytes persisted for one bounded durable replay response body. */
export const POSTGRES_REPLAY_MAX_RESPONSE_BODY_STORAGE_BYTES = 1_398_104;
/** Maximum UTF-8 bytes persisted for one durable replay response header snapshot. */
export const POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES = 65_536;

/** Durable replay namespace; capability, mutation, and webhook keys cannot collide. */
export type PostgresReplaySurface = 'capability' | 'mutation' | 'webhook';

interface PostgresReplayRow {
  expires_at: string;
  fingerprint: string | null;
  generation: string;
  is_unexpired: boolean;
  occurred_at: string | null;
  response_body: string | null;
  response_headers: string | null;
  response_status: number | null;
  state: string;
}

interface PostgresReplayIdentity {
  expiresAtMs: number;
  idem: string;
  occurredAtMs: number | null;
}

interface SettledReplayResponse {
  body: string;
  headers: unknown;
  status: number;
}

/** Polling posture for a duplicate whose first request still owns the durable claim. */
export interface PostgresReplayStoreOptions {
  /** Maximum time for one lookup to join a pending first request before failing closed. */
  pendingWaitMs?: number;
  /** Delay between durable pending-row polls. */
  pollIntervalMs?: number;
  /** Maximum simultaneous pending claims for this replay surface. */
  maxEntries?: number;
  /** Maximum UTF-16LE bytes retained for one replay response body. */
  maxResponseBodyBytes?: number;
  /** Maximum UTF-8 bytes retained for one replay response header snapshot. */
  maxResponseHeaderBytes?: number;
}

/** Explicit target for operator reconciliation of a crash-orphaned pending replay claim. */
export interface PostgresPendingReplayTarget {
  generation: string;
  idem: string;
  scope: string;
  surface: Exclude<PostgresReplaySurface, 'capability'>;
}

/** Audit-readable manual release posture for a confirmed crash-orphaned pending claim. */
export interface PostgresPendingReplayReleaseOptions {
  justification: string;
}

const DEFAULT_PENDING_WAIT_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_MAX_ENTRIES = 1_000;
const DEFAULT_MAX_RESPONSE_BODY_BYTES = POSTGRES_REPLAY_MAX_RESPONSE_BODY_BYTES;
const DEFAULT_MAX_RESPONSE_HEADER_BYTES = POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES;

/**
 * Create a durable mutation replay store over a framework-system Postgres SQL executor.
 *
 * Reservation ownership is a unique `(surface, digest(scoped-key-frame), idem)` row. Pending rows
 * survive process crashes, while committed rows remain through their exact token horizon and can be
 * reclaimed only behind the durable per-surface watermark. This prevents another replica from
 * executing the mutation across the settlement window or after database-clock rollback (SPEC §10.3).
 */
/** @internal Construct only from a framework-owned system DB capability wrapper. */
export function createPostgresMutationReplayStoreFromExecutor(
  executor: DurableTaskStatusSqlExecutor,
  options: PostgresReplayStoreOptions = {},
): MutationReplayStore {
  const runtime = createPostgresReplayRuntime(executor, options);
  const store: MutationReplayStore = {
    async get(key, scope: string, idem: string, fingerprint?: string) {
      const keyFrame = assertMutationReplayScopedKey(key, scope, idem).frame;
      const identity = mutationReplayIdentity(idem);
      const row = await runtime.readSettled('mutation', keyFrame, identity, fingerprint);
      return row === undefined ? undefined : mutationResponseFromRow(row);
    },
    async reserve(key, scope: string, idem: string, fingerprint?: string) {
      const keyFrame = assertMutationReplayScopedKey(key, scope, idem).frame;
      const identity = mutationReplayIdentity(idem);
      const generation = await runtime.reserve('mutation', keyFrame, identity, fingerprint);
      return generation === undefined
        ? undefined
        : mutationReservation(runtime, keyFrame, identity, fingerprint, generation);
    },
    async set(
      key,
      scope: string,
      idem: string,
      response: MutationReplayResponse,
      fingerprint?: string,
    ) {
      const keyFrame = assertMutationReplayScopedKey(key, scope, idem).frame;
      const identity = mutationReplayIdentity(idem);
      await runtime.settleWithoutReservation(
        'mutation',
        keyFrame,
        identity,
        fingerprint,
        mutationResponseForStorage(response),
      );
    },
  };
  const closedStore = witnessFreeze(store);
  mintFrameworkDurableReplayStoreReceipt(closedStore, 'mutation');
  return closedStore;
}

/** Create a durable webhook replay store over a framework-system Postgres SQL executor. */
/** @internal Construct only from a framework-owned system DB capability wrapper. */
export function createPostgresWebhookReplayStoreFromExecutor(
  executor: DurableTaskStatusSqlExecutor,
  options: PostgresReplayStoreOptions = {},
): WebhookReplayStore {
  const runtime = createPostgresReplayRuntime(executor, options);
  const store: WebhookReplayStore = {
    async get(scope: string, source: WebhookReplayIdentity) {
      const identity = postgresWebhookReplayIdentity(
        source,
        'Postgres webhook replay get() identity',
      );
      const row = await runtime.readSettled('webhook', scope, identity, undefined);
      return row === undefined ? undefined : webhookResponseFromRow(row);
    },
    async reserve(scope: string, source: WebhookReplayIdentity) {
      const identity = postgresWebhookReplayIdentity(
        source,
        'Postgres webhook replay reserve() identity',
      );
      const generation = await runtime.reserve('webhook', scope, identity, undefined);
      return generation === undefined
        ? undefined
        : webhookReservation(runtime, scope, identity, generation);
    },
    async set(scope: string, source: WebhookReplayIdentity, response: WebhookWireResponse) {
      const identity = postgresWebhookReplayIdentity(
        source,
        'Postgres webhook replay set() identity',
      );
      await runtime.settleWithoutReservation(
        'webhook',
        scope,
        identity,
        undefined,
        webhookResponseForStorage(response),
      );
    },
  };
  const closedStore = witnessFreeze(store);
  mintFrameworkDurableReplayStoreReceipt(closedStore, 'webhook');
  return closedStore;
}

/**
 * Create a durable one-time capability replay store over the protected Postgres replay relation.
 *
 * `consume()` hashes the signed token id before persistence and atomically inserts one committed
 * truth row. A conflict means another process or a prior process lifetime already consumed the
 * token. Expired rows are pruned against the database clock, while an already-expired token can
 * never be reinserted (SPEC §6.6/§10.3).
 */
/** @internal Construct only from a framework-owned system DB capability wrapper. */
export function createPostgresCapabilityReplayStoreFromExecutor(
  executor: DurableTaskStatusSqlExecutor,
): CapabilityReplayStore {
  const sql = snapshotReplaySqlExecutor(executor);
  const persistedScope = persistedReplayKeyPart('one-time-capability-url');
  const store: CapabilityReplayStore = {
    async consume(id: string, expiresAt: number): Promise<boolean> {
      if (
        typeof id !== 'string' ||
        id === '' ||
        id.length > 16_384 ||
        !requestStateIsSafeInteger(expiresAt) ||
        expiresAt <= 0
      ) {
        return false;
      }
      await retirePostgresCommittedReplay(sql, 'capability');
      const persistedId = persistedReplayKeyPart(id);
      const generation = securityRandomUuid();
      const result = await sql.execute<{ generation: string }>({
        text:
          'WITH locked_watermark AS MATERIALIZED (' +
          'SELECT reclaimed_through FROM public._kovo_replay_reclaimed ' +
          "WHERE surface = 'capability' FOR UPDATE) " +
          'INSERT INTO public._kovo_replay ' +
          '(surface, scope, idem, fingerprint, generation, state, response_body, ' +
          'response_headers, response_status, expires_at, committed_at) ' +
          "SELECT 'capability', $1, $2, NULL, $3, 'committed', $4, '{}', 204, $5, CURRENT_TIMESTAMP " +
          'FROM locked_watermark ' +
          'WHERE $5::bigint > FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint ' +
          'AND $5::bigint > locked_watermark.reclaimed_through ' +
          'ON CONFLICT DO NOTHING RETURNING generation',
        values: [persistedScope, persistedId, generation, securityString(expiresAt), expiresAt],
      });
      const rows = replayRows(result, 'Postgres capability replay consume result');
      if (rows.length === 0) return false;
      const row = rows.length === 1 ? rows[0] : undefined;
      if (row === undefined || stableReplayRowValue(row, 'generation') !== generation) {
        throw new Error('Postgres capability replay consume returned invalid ownership truth.');
      }
      return true;
    },
  };
  const closedStore = witnessFreeze(store);
  mintFrameworkDurableReplayStoreReceipt(closedStore, 'capability');
  return closedStore;
}

interface PostgresReplayCleanupRow {
  deleted_count: number;
  reclaimed_through: string;
}

/**
 * Delete one bounded committed batch and monotonically record exactly how far truth was reclaimed.
 *
 * The watermark row is locked before candidate selection and remains locked through deletion and
 * advancement. Fresh claims lock the same row, so a database-clock rollback cannot race cleanup
 * and recreate an exact key whose committed truth has already been removed (SPEC §10.3).
 */
async function retirePostgresCommittedReplay(
  sql: DurableTaskStatusSqlExecutor,
  surface: PostgresReplaySurface,
): Promise<void> {
  const result = await sql.execute<PostgresReplayCleanupRow>({
    text:
      'WITH locked_watermark AS MATERIALIZED (' +
      'SELECT reclaimed_through FROM public._kovo_replay_reclaimed ' +
      'WHERE surface = $1 FOR UPDATE), ' +
      'expired AS MATERIALIZED (' +
      'SELECT replay.scope, replay.idem, replay.expires_at ' +
      'FROM public._kovo_replay AS replay CROSS JOIN locked_watermark ' +
      "WHERE replay.surface = $1 AND replay.state = 'committed' " +
      'AND replay.expires_at <= FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint ' +
      'ORDER BY replay.expires_at, replay.scope, replay.idem LIMIT 1024), ' +
      'deleted AS (' +
      'DELETE FROM public._kovo_replay AS replay USING expired ' +
      'WHERE replay.surface = $1 AND replay.scope = expired.scope AND replay.idem = expired.idem ' +
      'AND replay.expires_at = expired.expires_at RETURNING replay.expires_at), ' +
      'advanced AS (' +
      'UPDATE public._kovo_replay_reclaimed AS watermark SET reclaimed_through = GREATEST(' +
      'watermark.reclaimed_through, COALESCE((SELECT MAX(expires_at) FROM deleted), ' +
      'watermark.reclaimed_through)) FROM locked_watermark ' +
      'WHERE watermark.surface = $1 RETURNING watermark.reclaimed_through) ' +
      'SELECT reclaimed_through::text AS reclaimed_through, ' +
      '(SELECT COUNT(*)::int FROM deleted) AS deleted_count FROM advanced',
    values: [surface],
  });
  const rows = replayRows(result, 'Postgres replay committed-expiry cleanup result');
  const row = rows.length === 1 ? rows[0] : undefined;
  const reclaimedThrough =
    row === undefined ? undefined : stableReplayRowValue(row, 'reclaimed_through');
  const deletedCount = row === undefined ? undefined : stableReplayRowValue(row, 'deleted_count');
  if (
    row === undefined ||
    typeof reclaimedThrough !== 'string' ||
    typeof deletedCount !== 'number'
  ) {
    throw new Error('Postgres replay committed-expiry cleanup lost its durable watermark row.');
  }
  if (deletedCount < 0 || deletedCount > 1_024) {
    throw new Error('Postgres replay committed-expiry cleanup exceeded its database batch.');
  }
}

/**
 * Deliberately release one confirmed crash-orphaned pending claim.
 *
 * This is an operator reconciliation escape, not automatic expiry: callers must supply the exact
 * generation and an audit-readable justification. Committed truth is never deleted by this API.
 */
/** @internal Release only through a framework-owned system DB capability wrapper. */
export async function releasePostgresPendingReplayFromExecutor(
  executor: DurableTaskStatusSqlExecutor,
  target: PostgresPendingReplayTarget,
  options: PostgresPendingReplayReleaseOptions,
): Promise<boolean> {
  const sql = snapshotReplaySqlExecutor(executor);
  const surface = stableRequiredString(target, 'surface', 'Postgres replay release target');
  if (surface !== 'mutation' && surface !== 'webhook') {
    throw new TypeError('Postgres replay release surface must be mutation or webhook.');
  }
  const scope = stableRequiredString(target, 'scope', 'Postgres replay release target');
  const idem = stableRequiredString(target, 'idem', 'Postgres replay release target');
  const persisted = persistedReplayKey(
    surface === 'mutation' ? mutationReplayScopedKeyFrame(scope, idem) : scope,
    idem,
  );
  const generation = stableRequiredString(target, 'generation', 'Postgres replay release target');
  snapshotAuditJustification(
    stableRequiredString(options, 'justification', 'Postgres replay release options'),
    'createPostgresAppRuntimeDb().releasePendingReplay() (SPEC §10.3)',
  );
  const result = await sql.execute<{ generation: string }>({
    text:
      'DELETE FROM public._kovo_replay ' +
      "WHERE surface = $1 AND scope = $2 AND idem = $3 AND generation = $4 AND state = 'pending' " +
      'RETURNING generation',
    values: [surface, persisted.scope, persisted.idem, generation],
  });
  return replayRows(result, 'Postgres replay release result').length === 1;
}

interface PostgresReplayRuntime {
  abort(
    surface: Exclude<PostgresReplaySurface, 'capability'>,
    scope: string,
    identity: PostgresReplayIdentity,
    generation: string,
  ): Promise<void>;
  commit(
    surface: Exclude<PostgresReplaySurface, 'capability'>,
    scope: string,
    identity: PostgresReplayIdentity,
    generation: string,
    response: SettledReplayResponse,
  ): Promise<void>;
  readSettled(
    surface: Exclude<PostgresReplaySurface, 'capability'>,
    scope: string,
    identity: PostgresReplayIdentity,
    fingerprint: string | undefined,
  ): Promise<PostgresReplayRow | undefined>;
  reserve(
    surface: Exclude<PostgresReplaySurface, 'capability'>,
    scope: string,
    identity: PostgresReplayIdentity,
    fingerprint: string | undefined,
  ): Promise<string | undefined>;
  settleWithoutReservation(
    surface: Exclude<PostgresReplaySurface, 'capability'>,
    scope: string,
    identity: PostgresReplayIdentity,
    fingerprint: string | undefined,
    response: SettledReplayResponse,
  ): Promise<void>;
}

function createPostgresReplayRuntime(
  executor: DurableTaskStatusSqlExecutor,
  options: PostgresReplayStoreOptions,
): PostgresReplayRuntime {
  const sql = snapshotReplaySqlExecutor(executor);
  const pendingWaitMs = optionalReplayDuration(options, 'pendingWaitMs') ?? DEFAULT_PENDING_WAIT_MS;
  const pollIntervalMs =
    optionalReplayDuration(options, 'pollIntervalMs') ?? DEFAULT_POLL_INTERVAL_MS;
  const maxEntries =
    optionalReplayBound(options, 'maxEntries', POSTGRES_REPLAY_MAX_ENTRIES) ?? DEFAULT_MAX_ENTRIES;
  const maxResponseBodyBytes =
    optionalReplayBound(options, 'maxResponseBodyBytes', POSTGRES_REPLAY_MAX_RESPONSE_BODY_BYTES) ??
    DEFAULT_MAX_RESPONSE_BODY_BYTES;
  const maxResponseHeaderBytes =
    optionalReplayBound(
      options,
      'maxResponseHeaderBytes',
      POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES,
    ) ?? DEFAULT_MAX_RESPONSE_HEADER_BYTES;
  if (pollIntervalMs === 0) {
    throw new TypeError('Postgres replay pollIntervalMs must be greater than zero.');
  }
  if (maxEntries === 0) {
    throw new TypeError('Postgres replay maxEntries must be greater than zero.');
  }
  if (maxResponseBodyBytes === 0 || maxResponseHeaderBytes === 0) {
    throw new TypeError('Postgres replay response byte limits must be greater than zero.');
  }

  const readRow = async (
    surface: Exclude<PostgresReplaySurface, 'capability'>,
    scope: string,
    identity: PostgresReplayIdentity,
  ): Promise<PostgresReplayRow | undefined> => {
    const persisted = persistedReplayKey(scope, identity.idem);
    const result = await sql.execute<PostgresReplayRow>({
      text:
        'SELECT expires_at::text AS expires_at, fingerprint, generation, ' +
        '(expires_at > FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint) AS is_unexpired, ' +
        'occurred_at::text AS occurred_at, response_body, response_headers, response_status, state ' +
        'FROM public._kovo_replay WHERE surface = $1 AND scope = $2 AND idem = $3',
      values: [surface, persisted.scope, persisted.idem],
    });
    const rows = replayRows(result, 'Postgres replay lookup result');
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw new Error('Postgres replay lookup returned duplicate truth rows.');
    const row = snapshotPostgresReplayRow(rows[0]);
    assertReplayIdentity(surface, row, identity);
    return row;
  };

  const retireExpiredCommitted = async (
    surface: Exclude<PostgresReplaySurface, 'capability'>,
  ): Promise<void> => {
    await retirePostgresCommittedReplay(sql, surface);
  };

  return witnessFreeze({
    async abort(surface, scope, identity, generation) {
      const persisted = persistedReplayKey(scope, identity.idem);
      const result = await sql.execute<{ generation: string }>({
        text:
          'DELETE FROM public._kovo_replay ' +
          "WHERE surface = $1 AND scope = $2 AND idem = $3 AND generation = $4 AND state = 'pending' " +
          'AND expires_at = $5::bigint AND occurred_at IS NOT DISTINCT FROM $6::bigint ' +
          'RETURNING generation',
        values: [
          surface,
          persisted.scope,
          persisted.idem,
          generation,
          identity.expiresAtMs,
          identity.occurredAtMs,
        ],
      });
      const rows = replayRows(result, 'Postgres replay abort result');
      if (rows.length > 1) throw new Error('Postgres replay abort changed duplicate truth rows.');
    },
    async commit(surface, scope, identity, generation, response) {
      const persisted = persistedReplayKey(scope, identity.idem);
      const headers = serializeReplayHeaders(response.headers, maxResponseHeaderBytes);
      const body = serializeReplayBody(response.body, maxResponseBodyBytes);
      const result = await sql.execute<{ generation: string }>({
        text:
          'WITH locked_watermark AS MATERIALIZED (' +
          'SELECT reclaimed_through FROM public._kovo_replay_reclaimed ' +
          'WHERE surface = $1 FOR UPDATE) ' +
          "UPDATE public._kovo_replay SET state = 'committed', response_body = $5, " +
          'response_headers = $6, response_status = $7, committed_at = CURRENT_TIMESTAMP, ' +
          'admission_slot = NULL ' +
          "WHERE surface = $1 AND scope = $2 AND idem = $3 AND generation = $4 AND state = 'pending' " +
          'AND expires_at = $8::bigint AND occurred_at IS NOT DISTINCT FROM $9::bigint ' +
          'AND expires_at > FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint ' +
          'AND expires_at > (SELECT reclaimed_through FROM locked_watermark) ' +
          'RETURNING generation',
        values: [
          surface,
          persisted.scope,
          persisted.idem,
          generation,
          body,
          headers,
          response.status,
          identity.expiresAtMs,
          identity.occurredAtMs,
        ],
      });
      const rows = replayRows(result, 'Postgres replay commit result');
      if (rows.length !== 1) {
        throw new Error(
          'Postgres replay settlement lost its generation-fenced pending claim; execution remains fail-closed.',
        );
      }
    },
    async readSettled(surface, scope, identity, fingerprint) {
      await retireExpiredCommitted(surface);
      const persistedFingerprint = persistedReplayFingerprint(fingerprint);
      const startedAt = requestStateNow();
      for (;;) {
        const row = await readRow(surface, scope, identity);
        if (row === undefined) return undefined;
        assertReplayFingerprint(row.fingerprint, persistedFingerprint);
        if (row.state === 'committed') {
          return row.is_unexpired ? assertSettledReplayRow(row) : undefined;
        }
        if (row.state !== 'pending') throw new Error('Postgres replay row has an invalid state.');
        const elapsed = requestStateNow() - startedAt;
        if (elapsed >= pendingWaitMs) return undefined;
        const remaining = pendingWaitMs - elapsed;
        await replayDelay(pollIntervalMs < remaining ? pollIntervalMs : remaining);
      }
    },
    async reserve(surface, scope, identity, fingerprint) {
      await retireExpiredCommitted(surface);
      const persisted = persistedReplayKey(scope, identity.idem);
      const persistedFingerprint = persistedReplayFingerprint(fingerprint);
      const generation = securityRandomUuid();
      const result = await sql.execute<{ generation: string }>({
        text:
          'WITH locked_watermark AS MATERIALIZED (' +
          'SELECT reclaimed_through FROM public._kovo_replay_reclaimed ' +
          'WHERE surface = $1 FOR UPDATE) ' +
          'INSERT INTO public._kovo_replay ' +
          '(surface, scope, idem, fingerprint, generation, state, admission_slot, expires_at, occurred_at) ' +
          "SELECT $1, $2, $3, $4, $5, 'pending', candidate.slot, $7::bigint, $8::bigint " +
          'FROM locked_watermark CROSS JOIN generate_series(1, $6::integer) AS candidate(slot) ' +
          'WHERE $7::bigint > FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint ' +
          'AND $7::bigint > locked_watermark.reclaimed_through ' +
          'AND NOT EXISTS (SELECT 1 FROM public._kovo_replay AS occupied ' +
          "WHERE occupied.surface = $1 AND occupied.state = 'pending' " +
          'AND occupied.admission_slot = candidate.slot) ' +
          'ORDER BY candidate.slot LIMIT 1 ' +
          'ON CONFLICT DO NOTHING RETURNING generation',
        values: [
          surface,
          persisted.scope,
          persisted.idem,
          persistedFingerprint,
          generation,
          maxEntries,
          identity.expiresAtMs,
          identity.occurredAtMs,
        ],
      });
      const rows = replayRows(result, 'Postgres replay reserve result');
      if (rows.length === 0) {
        const existing = await readRow(surface, scope, identity);
        if (existing !== undefined) {
          assertReplayFingerprint(existing.fingerprint, persistedFingerprint);
        }
        return undefined;
      }
      const row = rows.length === 1 ? rows[0] : undefined;
      if (row === undefined || stableReplayRowValue(row, 'generation') !== generation) {
        throw new Error('Postgres replay reservation returned invalid ownership truth.');
      }
      return generation;
    },
    async settleWithoutReservation(surface, scope, identity, fingerprint, response) {
      await retireExpiredCommitted(surface);
      const persisted = persistedReplayKey(scope, identity.idem);
      const persistedFingerprint = persistedReplayFingerprint(fingerprint);
      const generation = securityRandomUuid();
      const result = await sql.execute<{ generation: string }>({
        text:
          'WITH locked_watermark AS MATERIALIZED (' +
          'SELECT reclaimed_through FROM public._kovo_replay_reclaimed ' +
          'WHERE surface = $1 FOR UPDATE) ' +
          'INSERT INTO public._kovo_replay ' +
          '(surface, scope, idem, fingerprint, generation, state, response_body, ' +
          'response_headers, response_status, committed_at, expires_at, occurred_at) ' +
          "SELECT $1, $2, $3, $4, $5, 'committed', $6, $7, $8, CURRENT_TIMESTAMP, " +
          '$9::bigint, $10::bigint ' +
          'FROM locked_watermark ' +
          'WHERE $9::bigint > FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint ' +
          'AND $9::bigint > locked_watermark.reclaimed_through ' +
          'ON CONFLICT DO NOTHING RETURNING generation',
        values: [
          surface,
          persisted.scope,
          persisted.idem,
          persistedFingerprint,
          generation,
          serializeReplayBody(response.body, maxResponseBodyBytes),
          serializeReplayHeaders(response.headers, maxResponseHeaderBytes),
          response.status,
          identity.expiresAtMs,
          identity.occurredAtMs,
        ],
      });
      const rows = replayRows(result, 'Postgres replay direct settlement result');
      if (rows.length === 1) return;
      if (rows.length > 1) {
        throw new Error('Postgres replay direct settlement created duplicate truth rows.');
      }
      const existing = await readRow(surface, scope, identity);
      if (existing === undefined) {
        throw new Error(
          'Postgres replay direct settlement identity is expired or unavailable at database time.',
        );
      }
      assertReplayFingerprint(existing.fingerprint, persistedFingerprint);
      if (existing.state !== 'committed') {
        throw new Error(
          'Postgres replay key is pending; direct settlement refused to overwrite it.',
        );
      }
      if (!existing.is_unexpired) {
        throw new Error('Postgres replay direct settlement found only expired committed truth.');
      }
    },
  });
}

function mutationReservation(
  runtime: PostgresReplayRuntime,
  scope: string,
  identity: PostgresReplayIdentity,
  fingerprint: string | undefined,
  generation: string,
): MutationReplayReservation {
  return witnessFreeze({
    abort: () => runtime.abort('mutation', scope, identity, generation),
    commit: (response: MutationReplayResponse) =>
      runtime.commit('mutation', scope, identity, generation, mutationResponseForStorage(response)),
  });
}

function webhookReservation(
  runtime: PostgresReplayRuntime,
  scope: string,
  identity: PostgresReplayIdentity,
  generation: string,
): WebhookReplayReservation {
  return witnessFreeze({
    abort: () => runtime.abort('webhook', scope, identity, generation),
    commit: (response: WebhookWireResponse) =>
      runtime.commit('webhook', scope, identity, generation, webhookResponseForStorage(response)),
  });
}

function mutationResponseForStorage(response: MutationReplayResponse): SettledReplayResponse {
  const snapshot = snapshotMutationReplayResponse(response);
  return { body: snapshot.body, headers: snapshot.headers, status: snapshot.status };
}

function webhookResponseForStorage(response: WebhookWireResponse): SettledReplayResponse {
  const snapshot = snapshotWebhookReplayResponse(response, 'Postgres webhook replay response');
  return { body: snapshot.body, headers: snapshot.headers, status: snapshot.status };
}

function mutationResponseFromRow(row: PostgresReplayRow): MutationReplayResponse {
  const settled = replayResponseFromRow(row);
  return snapshotMutationReplayResponse({
    body: replayMutationWireBody(settled.body, {
      reason: 'rehydrate framework-owned Postgres mutation replay truth',
    }),
    headers: settled.headers as MutationReplayResponse['headers'],
    status: settled.status as MutationReplayResponse['status'],
  });
}

function webhookResponseFromRow(row: PostgresReplayRow): WebhookWireResponse {
  const settled = replayResponseFromRow(row);
  return snapshotWebhookReplayResponse(settled, 'Persisted Postgres webhook replay response');
}

function replayResponseFromRow(row: PostgresReplayRow): SettledReplayResponse {
  if (row.response_body === null || row.response_headers === null || row.response_status === null) {
    throw new Error('Committed Postgres replay truth is missing its response snapshot.');
  }
  if (row.response_body.length > POSTGRES_REPLAY_MAX_RESPONSE_BODY_STORAGE_BYTES) {
    throw new Error('Committed Postgres replay response body exceeds its storage bound.');
  }
  if (
    securityUint8ArrayLength(securityBufferFrom(row.response_headers, 'utf8')) >
    POSTGRES_REPLAY_MAX_RESPONSE_HEADER_BYTES
  ) {
    throw new Error('Committed Postgres replay response headers exceed their storage bound.');
  }
  return {
    body: parseReplayBody(row.response_body),
    headers: securityJsonParse(row.response_headers),
    status: row.response_status,
  };
}

function assertSettledReplayRow(row: PostgresReplayRow): PostgresReplayRow {
  if (row.response_body === null || row.response_headers === null || row.response_status === null) {
    throw new Error('Committed Postgres replay truth is incomplete.');
  }
  return row;
}

function serializeReplayHeaders(headers: unknown, maxBytes: number): string {
  const serialized = securityJsonStringify(headers);
  if (serialized === undefined)
    throw new TypeError('Replay response headers are not serializable.');
  if (securityUint8ArrayLength(securityBufferFrom(serialized, 'utf8')) > maxBytes) {
    throw new RangeError('Replay response headers exceed the durable storage byte limit.');
  }
  return serialized;
}

function serializeReplayBody(body: string, maxBytes: number): string {
  // The persisted encoding is UTF-16LE, exactly two bytes per JavaScript code unit. Reject from
  // the primitive string length before allocating the encoded buffer, so an oversized renderer
  // cannot turn the storage guard itself into a transient allocation amplifier (SPEC §10.3).
  if (body.length > maxBytes / 2) {
    throw new RangeError('Replay response body exceeds the durable storage byte limit.');
  }
  const bytes = securityBufferFrom(body, 'utf16le');
  if (securityUint8ArrayLength(bytes) > maxBytes) {
    throw new RangeError('Replay response body exceeds the durable storage byte limit.');
  }
  return securityBufferToString(bytes, 'base64');
}

function parseReplayBody(body: string): string {
  const bytes = securityBufferFrom(body, 'base64');
  if (
    securityUint8ArrayLength(bytes) % 2 !== 0 ||
    securityBufferToString(bytes, 'base64') !== body
  ) {
    throw new Error('Committed Postgres replay truth has an invalid response body encoding.');
  }
  return securityBufferToString(bytes, 'utf16le');
}

function assertReplayFingerprint(stored: string | null, expected: string | null): void {
  if (stored !== expected) throw new MutationReplayConflictError();
}

function mutationReplayIdentity(idem: string): PostgresReplayIdentity {
  const facts = parseMutationIdemToken(idem);
  if (facts === undefined) {
    throw new TypeError(
      'Postgres mutation replay requires the canonical framework idempotency token grammar.',
    );
  }
  return witnessFreeze({
    expiresAtMs: facts.expiresAtMs,
    idem: facts.token,
    occurredAtMs: null,
  });
}

function postgresWebhookReplayIdentity(
  source: WebhookReplayIdentity,
  label: string,
): PostgresReplayIdentity {
  const identity = snapshotWebhookReplayIdentity(source, label);
  return witnessFreeze({
    expiresAtMs: identity.expiresAtMs,
    idem: identity.key,
    occurredAtMs: identity.occurredAtMs,
  });
}

function assertReplayIdentity(
  surface: Exclude<PostgresReplaySurface, 'capability'>,
  row: PostgresReplayRow,
  expected: PostgresReplayIdentity,
): void {
  const expectedExpiry = securityString(expected.expiresAtMs);
  const expectedOccurrence =
    expected.occurredAtMs === null ? null : securityString(expected.occurredAtMs);
  if (row.expires_at === expectedExpiry && row.occurred_at === expectedOccurrence) return;
  if (surface === 'webhook') throw new WebhookReplayIdentityConflictError();
  throw new Error(
    'Postgres mutation replay expiry does not match the canonical idempotency token.',
  );
}

function assertReplayKey(scope: string, idem: string): void {
  if (typeof scope !== 'string' || scope === '' || scope.length > 4_096) {
    throw new TypeError('Postgres replay scope must be 1..4096 characters.');
  }
  if (typeof idem !== 'string' || idem === '' || idem.length > 1_024) {
    throw new TypeError('Postgres replay idempotency key must be 1..1024 characters.');
  }
}

/**
 * PostgreSQL text cannot represent NUL, while framework-owned composite scopes deliberately use
 * NUL as an unambiguous separator. Hash the URI-canonical form so ordinary JavaScript strings keep
 * their existing fixed-width database identity and raw attacker-controlled keys are never
 * persisted. URI encoding rejects lone UTF-16 surrogates, so those exact code units use a
 * domain-separated UTF-16LE representation instead of aliasing the replacement character or
 * throwing only in the Postgres backend.
 */
function persistedReplayKey(scope: string, idem: string): { idem: string; scope: string } {
  assertReplayKey(scope, idem);
  return witnessFreeze({
    idem: persistedReplayKeyPart(idem),
    scope: persistedReplayKeyPart(scope),
  });
}

function persistedReplayKeyPart(value: string): string {
  let canonical: string;
  try {
    canonical = securityEncodeURIComponent(value);
  } catch {
    canonical = `utf16le:${securityBufferToString(securityBufferFrom(value, 'utf16le'), 'base64')}`;
  }
  return `sha256:${securitySha256Base64(canonical)}`;
}

function persistedReplayFingerprint(fingerprint: string | undefined): string | null {
  if (fingerprint === undefined) return null;
  if (fingerprint === '') {
    throw new TypeError('Postgres replay fingerprint must be non-empty.');
  }
  // Unlike the bounded client-supplied replay id, this is Kovo's canonical representation of the
  // already body-budgeted request. It can legitimately exceed 1 KiB and is reduced to a fixed-width
  // digest before SQL, so imposing the id-token limit here made memory and Postgres stores disagree.
  return persistedReplayKeyPart(fingerprint);
}

function optionalReplayDuration(
  source: PostgresReplayStoreOptions,
  property: keyof PostgresReplayStoreOptions,
): number | undefined {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Postgres replay store options must be a stable object.');
  }
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    !requestStateIsSafeInteger(before.value) ||
    before.value < 0
  ) {
    throw new TypeError(`Postgres replay ${property} must be a stable non-negative integer.`);
  }
  return before.value;
}

function optionalReplayBound(
  source: PostgresReplayStoreOptions,
  property: 'maxEntries' | 'maxResponseBodyBytes' | 'maxResponseHeaderBytes',
  hardMaximum: number,
): number | undefined {
  const value = optionalReplayDuration(source, property);
  if (value !== undefined && value > hardMaximum) {
    throw new TypeError(`Postgres replay ${property} must not exceed ${hardMaximum}.`);
  }
  return value;
}

function snapshotReplaySqlExecutor(
  source: DurableTaskStatusSqlExecutor,
): DurableTaskStatusSqlExecutor {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('Postgres replay requires a durable SQL executor object.');
  }
  const before = witnessGetOwnPropertyDescriptor(source, 'execute');
  const after = witnessGetOwnPropertyDescriptor(source, 'execute');
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    typeof before.value !== 'function' ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError('Postgres replay SQL executor requires a stable own execute method.');
  }
  const execute = before.value;
  return witnessFreeze({
    execute<Row>(statement: { readonly text: string; readonly values: readonly unknown[] }) {
      return witnessReflectApply<Promise<DurableTaskStatusSqlResult<Row>>>(execute, source, [
        statement,
      ]);
    },
  });
}

function replayRows<Row>(result: DurableTaskStatusSqlResult<Row>, label: string): readonly Row[] {
  if (typeof result !== 'object' || result === null || witnessIsArray(result)) {
    throw new TypeError(`${label} must be a SQL result object.`);
  }
  const rows = stableReplayRowValue(result, 'rows');
  if (!witnessIsArray(rows)) throw new TypeError(`${label}.rows must be an array.`);
  return rows as readonly Row[];
}

function snapshotPostgresReplayRow(source: PostgresReplayRow | undefined): PostgresReplayRow {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Postgres replay row must be a record.');
  }
  const expiresAt = stableReplayRowValue(source, 'expires_at');
  const fingerprint = stableReplayRowValue(source, 'fingerprint');
  const generation = stableReplayRowValue(source, 'generation');
  const isUnexpired = stableReplayRowValue(source, 'is_unexpired');
  const occurredAt = stableReplayRowValue(source, 'occurred_at');
  const responseBody = stableReplayRowValue(source, 'response_body');
  const responseHeaders = stableReplayRowValue(source, 'response_headers');
  const responseStatus = stableReplayRowValue(source, 'response_status');
  const state = stableReplayRowValue(source, 'state');
  if (
    typeof expiresAt !== 'string' ||
    (fingerprint !== null && typeof fingerprint !== 'string') ||
    typeof generation !== 'string' ||
    typeof isUnexpired !== 'boolean' ||
    (occurredAt !== null && typeof occurredAt !== 'string') ||
    (responseBody !== null && typeof responseBody !== 'string') ||
    (responseHeaders !== null && typeof responseHeaders !== 'string') ||
    (responseStatus !== null && typeof responseStatus !== 'number') ||
    typeof state !== 'string'
  ) {
    throw new TypeError('Postgres replay row has invalid scalar values.');
  }
  return witnessFreeze({
    expires_at: expiresAt,
    fingerprint,
    generation,
    is_unexpired: isUnexpired,
    occurred_at: occurredAt,
    response_body: responseBody,
    response_headers: responseHeaders,
    response_status: responseStatus,
    state,
  });
}

function stableReplayRowValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`Postgres replay ${String(property)} must be stable own data.`);
  }
  return before.value;
}

function stableRequiredString(source: object, property: PropertyKey, label: string): string {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must be a stable object.`);
  }
  const value = stableReplayRowValue(source, property);
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${label}.${String(property)} must be a non-empty string.`);
  }
  return value;
}

function replayDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    witnessReflectApply(nodeSetTimeout, undefined, [resolve, delayMs]);
  });
}
