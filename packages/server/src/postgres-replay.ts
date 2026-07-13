import { setTimeout as nodeSetTimeout } from 'node:timers';

import { mintFrameworkDurableReplayStoreReceipt } from '@kovojs/core/internal/security-markers';

import {
  MutationReplayConflictError,
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
  securityStringTrim,
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
  snapshotWebhookReplayResponse,
  type WebhookReplayReservation,
  type WebhookReplayStore,
  type WebhookWireResponse,
} from './webhook.js';

/** Framework-owned durable replay relation provisioned with the Postgres runtime (SPEC §10.3). */
export const POSTGRES_REPLAY_TABLE = '_kovo_replay';

/** Durable replay namespace; mutation and webhook keys cannot collide. */
export type PostgresReplaySurface = 'mutation' | 'webhook';

interface PostgresReplayRow {
  fingerprint: string | null;
  generation: string;
  response_body: string | null;
  response_headers: string | null;
  response_status: number | null;
  state: string;
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
}

/** Explicit target for operator reconciliation of a crash-orphaned pending replay claim. */
export interface PostgresPendingReplayTarget {
  generation: string;
  idem: string;
  scope: string;
  surface: PostgresReplaySurface;
}

/** Audit-readable manual release posture for a confirmed crash-orphaned pending claim. */
export interface PostgresPendingReplayReleaseOptions {
  justification: string;
}

const DEFAULT_PENDING_WAIT_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

/**
 * Create a durable mutation replay store over a framework-system Postgres SQL executor.
 *
 * Reservation ownership is a unique `(surface, scope, idem)` row. Committed rows never expire,
 * and a process crash leaves the row pending, so another replica fails closed instead of executing
 * the mutation again across the transaction/response settlement window (SPEC §10.3).
 */
export function createPostgresMutationReplayStore(
  executor: DurableTaskStatusSqlExecutor,
  options: PostgresReplayStoreOptions = {},
): MutationReplayStore {
  const runtime = createPostgresReplayRuntime(executor, options);
  const store: MutationReplayStore = {
    async get(scope: string, idem: string, fingerprint?: string) {
      const row = await runtime.readSettled('mutation', scope, idem, fingerprint);
      return row === undefined ? undefined : mutationResponseFromRow(row);
    },
    async reserve(scope: string, idem: string, fingerprint?: string) {
      const generation = await runtime.reserve('mutation', scope, idem, fingerprint);
      return generation === undefined
        ? undefined
        : mutationReservation(runtime, scope, idem, fingerprint, generation);
    },
    async set(scope: string, idem: string, response: MutationReplayResponse, fingerprint?: string) {
      await runtime.settleWithoutReservation(
        'mutation',
        scope,
        idem,
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
export function createPostgresWebhookReplayStore(
  executor: DurableTaskStatusSqlExecutor,
  options: PostgresReplayStoreOptions = {},
): WebhookReplayStore {
  const runtime = createPostgresReplayRuntime(executor, options);
  const store: WebhookReplayStore = {
    async get(scope: string, idem: string) {
      const row = await runtime.readSettled('webhook', scope, idem, undefined);
      return row === undefined ? undefined : webhookResponseFromRow(row);
    },
    async reserve(scope: string, idem: string) {
      const generation = await runtime.reserve('webhook', scope, idem, undefined);
      return generation === undefined
        ? undefined
        : webhookReservation(runtime, scope, idem, generation);
    },
    async set(scope: string, idem: string, response: WebhookWireResponse) {
      await runtime.settleWithoutReservation(
        'webhook',
        scope,
        idem,
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
 * Deliberately release one confirmed crash-orphaned pending claim.
 *
 * This is an operator reconciliation escape, not automatic expiry: callers must supply the exact
 * generation and an audit-readable justification. Committed truth is never deleted by this API.
 */
export async function releasePostgresPendingReplay(
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
  const persisted = persistedReplayKey(scope, idem);
  const generation = stableRequiredString(target, 'generation', 'Postgres replay release target');
  const justification = stableRequiredString(
    options,
    'justification',
    'Postgres replay release options',
  );
  if (securityStringTrim(justification) === '') {
    throw new TypeError('releasePostgresPendingReplay() requires a non-empty justification.');
  }
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
    surface: PostgresReplaySurface,
    scope: string,
    idem: string,
    generation: string,
  ): Promise<void>;
  commit(
    surface: PostgresReplaySurface,
    scope: string,
    idem: string,
    generation: string,
    response: SettledReplayResponse,
  ): Promise<void>;
  readSettled(
    surface: PostgresReplaySurface,
    scope: string,
    idem: string,
    fingerprint: string | undefined,
  ): Promise<PostgresReplayRow | undefined>;
  reserve(
    surface: PostgresReplaySurface,
    scope: string,
    idem: string,
    fingerprint: string | undefined,
  ): Promise<string | undefined>;
  settleWithoutReservation(
    surface: PostgresReplaySurface,
    scope: string,
    idem: string,
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
  if (pollIntervalMs === 0) {
    throw new TypeError('Postgres replay pollIntervalMs must be greater than zero.');
  }

  const readRow = async (
    surface: PostgresReplaySurface,
    scope: string,
    idem: string,
  ): Promise<PostgresReplayRow | undefined> => {
    const persisted = persistedReplayKey(scope, idem);
    const result = await sql.execute<PostgresReplayRow>({
      text:
        'SELECT fingerprint, generation, response_body, response_headers, response_status, state ' +
        'FROM public._kovo_replay WHERE surface = $1 AND scope = $2 AND idem = $3',
      values: [surface, persisted.scope, persisted.idem],
    });
    const rows = replayRows(result, 'Postgres replay lookup result');
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw new Error('Postgres replay lookup returned duplicate truth rows.');
    return snapshotPostgresReplayRow(rows[0]);
  };

  return witnessFreeze({
    async abort(surface, scope, idem, generation) {
      const persisted = persistedReplayKey(scope, idem);
      const result = await sql.execute<{ generation: string }>({
        text:
          'DELETE FROM public._kovo_replay ' +
          "WHERE surface = $1 AND scope = $2 AND idem = $3 AND generation = $4 AND state = 'pending' " +
          'RETURNING generation',
        values: [surface, persisted.scope, persisted.idem, generation],
      });
      const rows = replayRows(result, 'Postgres replay abort result');
      if (rows.length > 1) throw new Error('Postgres replay abort changed duplicate truth rows.');
    },
    async commit(surface, scope, idem, generation, response) {
      const persisted = persistedReplayKey(scope, idem);
      const headers = serializeReplayHeaders(response.headers);
      const body = serializeReplayBody(response.body);
      const result = await sql.execute<{ generation: string }>({
        text:
          "UPDATE public._kovo_replay SET state = 'committed', response_body = $5, " +
          'response_headers = $6, response_status = $7, committed_at = CURRENT_TIMESTAMP ' +
          "WHERE surface = $1 AND scope = $2 AND idem = $3 AND generation = $4 AND state = 'pending' " +
          'RETURNING generation',
        values: [
          surface,
          persisted.scope,
          persisted.idem,
          generation,
          body,
          headers,
          response.status,
        ],
      });
      const rows = replayRows(result, 'Postgres replay commit result');
      if (rows.length !== 1) {
        throw new Error(
          'Postgres replay settlement lost its generation-fenced pending claim; execution remains fail-closed.',
        );
      }
    },
    async readSettled(surface, scope, idem, fingerprint) {
      const persistedFingerprint = persistedReplayFingerprint(fingerprint);
      const startedAt = requestStateNow();
      for (;;) {
        const row = await readRow(surface, scope, idem);
        if (row === undefined) return undefined;
        assertReplayFingerprint(row.fingerprint, persistedFingerprint);
        if (row.state === 'committed') return assertSettledReplayRow(row);
        if (row.state !== 'pending') throw new Error('Postgres replay row has an invalid state.');
        const elapsed = requestStateNow() - startedAt;
        if (elapsed >= pendingWaitMs) return undefined;
        const remaining = pendingWaitMs - elapsed;
        await replayDelay(pollIntervalMs < remaining ? pollIntervalMs : remaining);
      }
    },
    async reserve(surface, scope, idem, fingerprint) {
      const persisted = persistedReplayKey(scope, idem);
      const persistedFingerprint = persistedReplayFingerprint(fingerprint);
      const generation = securityRandomUuid();
      const result = await sql.execute<{ generation: string }>({
        text:
          'INSERT INTO public._kovo_replay ' +
          '(surface, scope, idem, fingerprint, generation, state) ' +
          "VALUES ($1, $2, $3, $4, $5, 'pending') " +
          'ON CONFLICT (surface, scope, idem) DO NOTHING RETURNING generation',
        values: [surface, persisted.scope, persisted.idem, persistedFingerprint, generation],
      });
      const rows = replayRows(result, 'Postgres replay reserve result');
      if (rows.length === 0) {
        const existing = await readRow(surface, scope, idem);
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
    async settleWithoutReservation(surface, scope, idem, fingerprint, response) {
      const persisted = persistedReplayKey(scope, idem);
      const persistedFingerprint = persistedReplayFingerprint(fingerprint);
      const generation = securityRandomUuid();
      const result = await sql.execute<{ generation: string }>({
        text:
          'INSERT INTO public._kovo_replay ' +
          '(surface, scope, idem, fingerprint, generation, state, response_body, ' +
          'response_headers, response_status, committed_at) ' +
          "VALUES ($1, $2, $3, $4, $5, 'committed', $6, $7, $8, CURRENT_TIMESTAMP) " +
          'ON CONFLICT (surface, scope, idem) DO NOTHING RETURNING generation',
        values: [
          surface,
          persisted.scope,
          persisted.idem,
          persistedFingerprint,
          generation,
          serializeReplayBody(response.body),
          serializeReplayHeaders(response.headers),
          response.status,
        ],
      });
      const rows = replayRows(result, 'Postgres replay direct settlement result');
      if (rows.length === 1) return;
      if (rows.length > 1) {
        throw new Error('Postgres replay direct settlement created duplicate truth rows.');
      }
      const existing = await readRow(surface, scope, idem);
      if (existing === undefined) {
        throw new Error('Postgres replay direct settlement lost its durable truth row.');
      }
      assertReplayFingerprint(existing.fingerprint, persistedFingerprint);
      if (existing.state !== 'committed') {
        throw new Error(
          'Postgres replay key is pending; direct settlement refused to overwrite it.',
        );
      }
    },
  });
}

function mutationReservation(
  runtime: PostgresReplayRuntime,
  scope: string,
  idem: string,
  fingerprint: string | undefined,
  generation: string,
): MutationReplayReservation {
  return witnessFreeze({
    abort: () => runtime.abort('mutation', scope, idem, generation),
    commit: (response: MutationReplayResponse) =>
      runtime.commit('mutation', scope, idem, generation, mutationResponseForStorage(response)),
  });
}

function webhookReservation(
  runtime: PostgresReplayRuntime,
  scope: string,
  idem: string,
  generation: string,
): WebhookReplayReservation {
  return witnessFreeze({
    abort: () => runtime.abort('webhook', scope, idem, generation),
    commit: (response: WebhookWireResponse) =>
      runtime.commit('webhook', scope, idem, generation, webhookResponseForStorage(response)),
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

function serializeReplayHeaders(headers: unknown): string {
  const serialized = securityJsonStringify(headers);
  if (serialized === undefined)
    throw new TypeError('Replay response headers are not serializable.');
  return serialized;
}

function serializeReplayBody(body: string): string {
  return securityBufferToString(securityBufferFrom(body, 'utf16le'), 'base64');
}

function parseReplayBody(body: string): string {
  const bytes = securityBufferFrom(body, 'base64');
  if (bytes.byteLength % 2 !== 0 || securityBufferToString(bytes, 'base64') !== body) {
    throw new Error('Committed Postgres replay truth has an invalid response body encoding.');
  }
  return securityBufferToString(bytes, 'utf16le');
}

function assertReplayFingerprint(stored: string | null, expected: string | null): void {
  if (stored !== expected) throw new MutationReplayConflictError();
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
 * NUL as an unambiguous separator. Hash the URI-canonical form so every well-formed JavaScript
 * string has a fixed-width database identity and raw attacker-controlled keys are never persisted.
 */
function persistedReplayKey(scope: string, idem: string): { idem: string; scope: string } {
  assertReplayKey(scope, idem);
  return witnessFreeze({
    idem: persistedReplayKeyPart(idem),
    scope: persistedReplayKeyPart(scope),
  });
}

function persistedReplayKeyPart(value: string): string {
  return `sha256:${securitySha256Base64(securityEncodeURIComponent(value))}`;
}

function persistedReplayFingerprint(fingerprint: string | undefined): string | null {
  if (fingerprint === undefined) return null;
  if (fingerprint === '' || fingerprint.length > 1_024) {
    throw new TypeError('Postgres replay fingerprint must be 1..1024 characters.');
  }
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
  const fingerprint = stableReplayRowValue(source, 'fingerprint');
  const generation = stableReplayRowValue(source, 'generation');
  const responseBody = stableReplayRowValue(source, 'response_body');
  const responseHeaders = stableReplayRowValue(source, 'response_headers');
  const responseStatus = stableReplayRowValue(source, 'response_status');
  const state = stableReplayRowValue(source, 'state');
  if (
    (fingerprint !== null && typeof fingerprint !== 'string') ||
    typeof generation !== 'string' ||
    (responseBody !== null && typeof responseBody !== 'string') ||
    (responseHeaders !== null && typeof responseHeaders !== 'string') ||
    (responseStatus !== null && typeof responseStatus !== 'number') ||
    typeof state !== 'string'
  ) {
    throw new TypeError('Postgres replay row has invalid scalar values.');
  }
  return witnessFreeze({
    fingerprint,
    generation,
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
