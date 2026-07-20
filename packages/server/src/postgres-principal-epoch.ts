import { mintFrameworkPrincipalEpochStoreReceipt } from '@kovojs/core/internal/security-markers';

import { securitySha256Base64 } from './response-security-intrinsics.js';
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
import type { PrincipalEpochState, PrincipalEpochStore } from './principal-epoch.js';

/** Framework-owned persistent revocation relation (SPEC §6.6/§10.3). */
export const POSTGRES_PRINCIPAL_EPOCH_TABLE = '_kovo_principal_epoch';

interface PostgresPrincipalEpochRow {
  changed_at_ms: string;
  epoch: string;
  status: string;
}

/** @internal Construct only over the framework-system SQL executor. */
export function createPostgresPrincipalEpochStoreFromExecutor(
  executor: DurableTaskStatusSqlExecutor,
): PrincipalEpochStore {
  const sql = snapshotExecutor(executor);
  const table = `public.${POSTGRES_PRINCIPAL_EPOCH_TABLE}`;
  const store: PrincipalEpochStore = witnessFreeze({
    async current(principal, options) {
      if (options.signal.aborted) throw new Error('Principal epoch lookup aborted.');
      const digest = securitySha256Base64(principal);
      const result = await sql.execute<PostgresPrincipalEpochRow>({
        text:
          `SELECT epoch::text AS epoch, changed_at_ms::text AS changed_at_ms, status ` +
          `FROM ${table} WHERE principal_digest = $1`,
        values: [digest],
      });
      if (options.signal.aborted) throw new Error('Principal epoch lookup aborted.');
      const rows = resultRows(result, 'Postgres principal epoch current()');
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new Error('Principal epoch identity is not unique.');
      return rowState(rows[0]);
    },
    initialize(principal) {
      return initializePrincipalEpoch(sql, table, principal);
    },
    advance(principal, reason) {
      return updatePrincipalEpoch(sql, table, principal, reason, false);
    },
    tombstone(principal, reason) {
      return updatePrincipalEpoch(sql, table, principal, reason, true);
    },
  });
  mintFrameworkPrincipalEpochStoreReceipt(store);
  return store;
}

async function initializePrincipalEpoch(
  sql: DurableTaskStatusSqlExecutor,
  table: string,
  principal: string,
): Promise<PrincipalEpochState> {
  const digest = securitySha256Base64(principal);
  const existing = await selectPrincipalEpoch(sql, table, digest);
  if (existing !== undefined) return existing;
  const inserted = await sql.execute<PostgresPrincipalEpochRow>({
    text:
      `INSERT INTO ${table} ` +
      `(principal_digest, epoch, changed_at_ms, status, last_reason) ` +
      `VALUES ($1, 1, FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint, ` +
      `'active', 'principal-created') ` +
      `ON CONFLICT (principal_digest) DO NOTHING ` +
      `RETURNING epoch::text AS epoch, changed_at_ms::text AS changed_at_ms, status`,
    values: [digest],
  });
  const insertedRows = resultRows(inserted, 'Postgres principal epoch initialization');
  if (insertedRows.length === 1) return rowState(insertedRows[0]);
  if (insertedRows.length !== 0) {
    throw new Error('Principal epoch initialization returned multiple rows.');
  }
  const raced = await selectPrincipalEpoch(sql, table, digest);
  if (raced === undefined) {
    throw new Error('Principal epoch initialization lost its concurrent identity row.');
  }
  return raced;
}

async function selectPrincipalEpoch(
  sql: DurableTaskStatusSqlExecutor,
  table: string,
  digest: string,
): Promise<PrincipalEpochState | undefined> {
  const result = await sql.execute<PostgresPrincipalEpochRow>({
    text:
      `SELECT epoch::text AS epoch, changed_at_ms::text AS changed_at_ms, status ` +
      `FROM ${table} WHERE principal_digest = $1`,
    values: [digest],
  });
  const rows = resultRows(result, 'Postgres principal epoch lookup');
  if (rows.length === 0) return undefined;
  if (rows.length !== 1) throw new Error('Principal epoch identity is not unique.');
  return rowState(rows[0]);
}

async function updatePrincipalEpoch(
  sql: DurableTaskStatusSqlExecutor,
  table: string,
  principal: string,
  reason: string,
  tombstone: boolean,
): Promise<PrincipalEpochState> {
  const result = await sql.execute<PostgresPrincipalEpochRow>({
    text:
      `INSERT INTO ${table} AS principal_epoch ` +
      `(principal_digest, epoch, changed_at_ms, status, last_reason) ` +
      `VALUES ($1, 1, FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint, $2, $3) ` +
      `ON CONFLICT (principal_digest) DO UPDATE SET ` +
      `epoch = principal_epoch.epoch + 1, ` +
      `changed_at_ms = GREATEST(` +
      `FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint, ` +
      `principal_epoch.changed_at_ms + 1), ` +
      `status = CASE WHEN principal_epoch.status = 'tombstoned' OR $2 = 'tombstoned' ` +
      `THEN 'tombstoned' ELSE 'active' END, last_reason = $3 ` +
      `RETURNING epoch::text AS epoch, changed_at_ms::text AS changed_at_ms, status`,
    values: [securitySha256Base64(principal), tombstone ? 'tombstoned' : 'active', reason],
  });
  const rows = resultRows(result, 'Postgres principal epoch transition');
  if (rows.length !== 1) throw new Error('Principal epoch transition returned no exact row.');
  return rowState(rows[0]);
}

function rowState(row: PostgresPrincipalEpochRow | undefined): PrincipalEpochState {
  if (row === undefined || typeof row !== 'object' || witnessIsArray(row)) {
    throw new Error('Postgres principal epoch row is malformed.');
  }
  const epoch = parseInteger(row.epoch);
  const changedAtMs = parseInteger(row.changed_at_ms);
  if (epoch < 1 || changedAtMs < 0 || (row.status !== 'active' && row.status !== 'tombstoned')) {
    throw new Error('Postgres principal epoch row is invalid.');
  }
  return witnessFreeze({ changedAtMs, epoch, status: row.status });
}

function parseInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error('Postgres principal epoch integer is malformed.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Postgres principal epoch integer overflow.');
  return parsed;
}

function snapshotExecutor(source: DurableTaskStatusSqlExecutor): DurableTaskStatusSqlExecutor {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('Postgres principal epoch requires a SQL executor.');
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
    throw new TypeError('Postgres principal epoch executor requires a stable own execute method.');
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

function resultRows<Row>(result: DurableTaskStatusSqlResult<Row>, label: string): readonly Row[] {
  if (typeof result !== 'object' || result === null || witnessIsArray(result)) {
    throw new TypeError(`${label} must return a SQL result.`);
  }
  const rows = result.rows;
  if (!witnessIsArray(rows)) throw new TypeError(`${label}.rows must be an array.`);
  return rows;
}
