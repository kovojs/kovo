import { assertAndCloneJsonValue } from '@kovojs/core/internal/json';
import type { TaskHandle } from './task.js';

/** Persisted durable-task job states visible through the SPEC §9.6 status surface. */
export type DurableTaskObservedStatus =
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead'
  | 'cancelled';

/** Parameterized SQL statement emitted by the durable-task status reader. */
export interface DurableTaskStatusSqlStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** Row result shape returned by a durable-task status SQL executor. */
export interface DurableTaskStatusSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
}

/** Minimal SQL executor required to inspect deployed `_kovo_jobs` rows (SPEC §9.6). */
export interface DurableTaskStatusSqlExecutor {
  execute<Row = Record<string, unknown>>(
    statement: DurableTaskStatusSqlStatement,
  ): Promise<DurableTaskStatusSqlResult<Row>>;
}

/** Filters accepted by the durable-task status and failure inspection surface. */
export interface DurableTaskStatusFilters {
  readonly ids?: readonly string[];
  readonly task?: string;
  readonly status?: DurableTaskObservedStatus | readonly DurableTaskObservedStatus[];
  readonly limit?: number;
  readonly offset?: number;
  /**
   * Args are intentionally redacted by default because scheduled task payloads
   * commonly carry customer data or external-provider secrets (SPEC §9.6).
   */
  readonly includeArgs?: boolean;
}

/** Redacted job record returned by the durable-task status surface. */
export interface DurableTaskStatusRecord {
  readonly id: string;
  readonly task: string;
  readonly status: DurableTaskObservedStatus;
  readonly attempts: number;
  readonly runAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly args?: unknown;
  readonly key?: string;
  readonly lastError?: string;
  readonly leasedUntil?: Date;
  readonly leaseOwner?: string;
}

/** Read-only in-memory source for durable-task status inspection in tests/tools. */
export interface DurableTaskStatusSnapshotSource {
  snapshot(): readonly DurableTaskStatusJob[];
}

/** Unredacted job snapshot consumed by `createDurableTaskStatus(...)`. */
export interface DurableTaskStatusJob {
  readonly id: string;
  readonly task: string;
  readonly args: unknown;
  readonly runAt: Date;
  readonly status: DurableTaskObservedStatus;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly key?: string;
  readonly lastError?: string;
  readonly leasedUntil?: Date;
  readonly leaseOwner?: string;
}

/** Framework-owned durable-task status reader for SPEC §9.6 operational visibility. */
export interface DurableTaskStatusSurface {
  get(
    handle: TaskHandle | string,
    options?: Pick<DurableTaskStatusFilters, 'includeArgs'>,
  ): Promise<DurableTaskStatusRecord | undefined>;
  list(filters?: DurableTaskStatusFilters): Promise<DurableTaskStatusRecord[]>;
  listFailures(
    filters?: Omit<DurableTaskStatusFilters, 'status'>,
  ): Promise<DurableTaskStatusRecord[]>;
}

/**
 * Framework-owned inspection facade for durable tasks (SPEC §9.6). It reads the
 * persisted job rows directly for deployed Postgres artifacts, or a read-only
 * snapshot in memory tests, and redacts serialized args unless callers
 * explicitly request them for privileged diagnostics.
 */
export function createDurableTaskStatus(
  source: DurableTaskStatusSnapshotSource | DurableTaskStatusSqlExecutor,
): DurableTaskStatusSurface {
  return {
    async get(handle, options) {
      const id = typeof handle === 'string' ? handle : handle.id;
      const [job] = await listJobs(source, { ids: [id], limit: 1 });
      return job === undefined ? undefined : statusRecord(job, options);
    },
    async list(filters = {}) {
      const jobs = await listJobs(source, filters);
      return jobs.map((job) => statusRecord(job, filters));
    },
    async listFailures(filters = {}) {
      const jobs = await listJobs(source, { ...filters, status: ['failed', 'dead'] });
      return jobs.map((job) => statusRecord(job, filters));
    },
  };
}

async function listJobs(
  source: DurableTaskStatusSnapshotSource | DurableTaskStatusSqlExecutor,
  filters: DurableTaskStatusFilters,
): Promise<DurableTaskStatusJob[]> {
  if (isSqlExecutor(source)) return listSqlJobs(source, filters);
  return listSnapshotJobs(source.snapshot(), filters);
}

async function listSqlJobs(
  executor: DurableTaskStatusSqlExecutor,
  filters: DurableTaskStatusFilters,
): Promise<DurableTaskStatusJob[]> {
  const result = await executor.execute<DurableTaskJobRow>(sqlListJobsStatement(filters));
  return result.rows.map(jobFromRow);
}

function listSnapshotJobs(
  jobs: readonly DurableTaskStatusJob[],
  filters: DurableTaskStatusFilters,
): DurableTaskStatusJob[] {
  const ids = new Set(filters.ids ?? []);
  const statuses = statusFilter(filters.status);
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const limit = Math.max(0, Math.floor(filters.limit ?? 100));

  return jobs
    .filter((job) => ids.size === 0 || ids.has(job.id))
    .filter((job) => filters.task === undefined || job.task === filters.task)
    .filter((job) => statuses === undefined || statuses.has(job.status))
    .sort(
      (a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(offset, offset + limit)
    .map(copyJob);
}

function sqlListJobsStatement(filters: DurableTaskStatusFilters): {
  readonly text: string;
  readonly values: readonly unknown[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.ids !== undefined && filters.ids.length > 0) {
    values.push([...filters.ids]);
    clauses.push(`id = any($${values.length}::text[])`);
  }
  if (filters.task !== undefined) {
    values.push(filters.task);
    clauses.push(`task_key = $${values.length}`);
  }
  const statuses = statusFilter(filters.status);
  if (statuses !== undefined) {
    values.push([...statuses]);
    clauses.push(`status = any($${values.length}::text[])`);
  }

  values.push(Math.max(1, Math.floor(filters.limit ?? 100)));
  const limitPlaceholder = `$${values.length}`;
  values.push(Math.max(0, Math.floor(filters.offset ?? 0)));
  const offsetPlaceholder = `$${values.length}`;

  return {
    text: `select id, task_key, args, run_at, logical_key, status, attempts, created_at, updated_at,
  leased_until, lease_owner, last_error
from _kovo_jobs
${clauses.length === 0 ? '' : `where ${clauses.join(' and ')}`}
order by updated_at desc, created_at desc
limit ${limitPlaceholder} offset ${offsetPlaceholder}`,
    values,
  };
}

function statusRecord(
  job: DurableTaskStatusJob,
  options: Pick<DurableTaskStatusFilters, 'includeArgs'> | undefined,
): DurableTaskStatusRecord {
  return {
    id: job.id,
    task: job.task,
    status: job.status,
    attempts: job.attempts,
    runAt: copyDate(job.runAt),
    createdAt: copyDate(job.createdAt),
    updatedAt: copyDate(job.updatedAt),
    ...(options?.includeArgs === true
      ? { args: assertAndCloneJsonValue(job.args, { root: 'args' }) }
      : {}),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
    ...(job.leasedUntil === undefined ? {} : { leasedUntil: copyDate(job.leasedUntil) }),
    ...(job.leaseOwner === undefined ? {} : { leaseOwner: job.leaseOwner }),
  };
}

interface DurableTaskJobRow {
  id: string;
  task_key: string;
  args: unknown;
  run_at: Date | string;
  logical_key: string | null;
  status: string;
  attempts: number;
  created_at: Date | string;
  updated_at: Date | string;
  leased_until: Date | string | null;
  lease_owner: string | null;
  last_error: string | null;
}

function jobFromRow(row: DurableTaskJobRow): DurableTaskStatusJob {
  return {
    id: row.id,
    task: row.task_key,
    args: row.args,
    runAt: dateFrom(row.run_at),
    status: observedStatus(row.status),
    attempts: row.attempts,
    createdAt: dateFrom(row.created_at),
    updatedAt: dateFrom(row.updated_at),
    ...(row.logical_key === null ? {} : { key: row.logical_key }),
    ...(row.leased_until === null ? {} : { leasedUntil: dateFrom(row.leased_until) }),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

function copyJob(job: DurableTaskStatusJob): DurableTaskStatusJob {
  return {
    id: job.id,
    task: job.task,
    args: assertAndCloneJsonValue(job.args, { root: 'args' }),
    runAt: copyDate(job.runAt),
    status: job.status,
    attempts: job.attempts,
    createdAt: copyDate(job.createdAt),
    updatedAt: copyDate(job.updatedAt),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
    ...(job.leasedUntil === undefined ? {} : { leasedUntil: copyDate(job.leasedUntil) }),
    ...(job.leaseOwner === undefined ? {} : { leaseOwner: job.leaseOwner }),
  };
}

function statusFilter(
  status: DurableTaskObservedStatus | readonly DurableTaskObservedStatus[] | undefined,
): Set<DurableTaskObservedStatus> | undefined {
  if (status === undefined) return undefined;
  return new Set(Array.isArray(status) ? status : [status]);
}

function observedStatus(status: string): DurableTaskObservedStatus {
  if (
    status === 'ready' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'dead'
  ) {
    return status;
  }
  throw new TypeError(`Unknown durable task status "${status}" in _kovo_jobs.`);
}

function isSqlExecutor(
  value: DurableTaskStatusSnapshotSource | DurableTaskStatusSqlExecutor,
): value is DurableTaskStatusSqlExecutor {
  return 'execute' in value;
}

function dateFrom(value: Date | string): Date {
  return value instanceof Date ? copyDate(value) : new Date(value);
}

function copyDate(value: Date): Date {
  return new Date(value.getTime());
}
