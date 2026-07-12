import { assertAndCloneJsonValue } from '@kovojs/core/internal/json';
import { scrubSecretLifecycleValue } from './logging.js';
import type { TaskHandle } from './task.js';
import {
  taskApply,
  taskArrayPush,
  taskArraySlice,
  taskArraySort,
  taskCreateSet,
  taskDateGetTime,
  taskDateIsDate,
  taskFloor,
  taskIsArray,
  taskMax,
  taskNewDate,
  taskSetAdd,
  taskSetForEach,
  taskSetHas,
  taskSetSize,
  taskStableOwnFunction,
  taskString,
} from './task-security-intrinsics.js';

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
   * Args and failure text are intentionally redacted by default because scheduled task
   * payloads and thrown errors commonly carry customer data or external-provider secrets
   * (SPEC §9.6).
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
 * snapshot in memory tests, and redacts serialized args and failure text unless callers
 * explicitly request them for privileged diagnostics.
 */
export function createDurableTaskStatus(
  source: DurableTaskStatusSnapshotSource | DurableTaskStatusSqlExecutor,
): DurableTaskStatusSurface {
  const readJobs = createStatusReader(source);
  return {
    async get(handle, options) {
      const id = typeof handle === 'string' ? handle : handle.id;
      const jobs = await readJobs({ ids: [id], limit: 1 });
      const job = jobs[0];
      return job === undefined ? undefined : statusRecord(job, options);
    },
    async list(filters = {}) {
      const jobs = await readJobs(filters);
      return mapStatusRecords(jobs, filters);
    },
    async listFailures(filters = {}) {
      const jobs = await readJobs({ ...filters, status: ['failed', 'dead'] });
      return mapStatusRecords(jobs, filters);
    },
  };
}

function createStatusReader(
  source: DurableTaskStatusSnapshotSource | DurableTaskStatusSqlExecutor,
): (filters: DurableTaskStatusFilters) => Promise<DurableTaskStatusJob[]> {
  if (isSqlExecutor(source)) {
    const execute = taskStableOwnFunction(source, 'execute', 'Durable task status SQL source');
    return async (filters) => {
      const result = await taskApply<Promise<DurableTaskStatusSqlResult<DurableTaskJobRow>>>(
        execute,
        source,
        [sqlListJobsStatement(filters)],
      );
      const jobs: DurableTaskStatusJob[] = [];
      for (let index = 0; index < result.rows.length; index += 1) {
        taskArrayPush(jobs, jobFromRow(result.rows[index]!));
      }
      return jobs;
    };
  }
  const snapshot = taskStableOwnFunction(source, 'snapshot', 'Durable task status snapshot source');
  return async (filters) =>
    listSnapshotJobs(
      await taskApply<Promise<readonly DurableTaskStatusJob[]> | readonly DurableTaskStatusJob[]>(
        snapshot,
        source,
        [],
      ),
      filters,
    );
}

function listSnapshotJobs(
  jobs: readonly DurableTaskStatusJob[],
  filters: DurableTaskStatusFilters,
): DurableTaskStatusJob[] {
  const ids = taskCreateSet<string>();
  const filterIds = filters.ids ?? [];
  for (let index = 0; index < filterIds.length; index += 1) taskSetAdd(ids, filterIds[index]!);
  const statuses = statusFilter(filters.status);
  const offset = taskMax(0, taskFloor(filters.offset ?? 0));
  const limit = taskMax(0, taskFloor(filters.limit ?? 100));
  const selected: DurableTaskStatusJob[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    if (taskSetSize(ids) > 0 && !taskSetHas(ids, job.id)) continue;
    if (filters.task !== undefined && job.task !== filters.task) continue;
    if (statuses !== undefined && !taskSetHas(statuses, job.status)) continue;
    taskArrayPush(selected, job);
  }
  taskArraySort(
    selected,
    (a, b) =>
      taskDateGetTime(b.updatedAt) - taskDateGetTime(a.updatedAt) ||
      taskDateGetTime(b.createdAt) - taskDateGetTime(a.createdAt),
  );
  const page = taskArraySlice(selected, offset, offset + limit);
  const copied: DurableTaskStatusJob[] = [];
  for (let index = 0; index < page.length; index += 1) taskArrayPush(copied, copyJob(page[index]!));
  return copied;
}

function sqlListJobsStatement(filters: DurableTaskStatusFilters): {
  readonly text: string;
  readonly values: readonly unknown[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.ids !== undefined && filters.ids.length > 0) {
    taskArrayPush(values, taskArraySlice(filters.ids));
    taskArrayPush(clauses, `id = any($${values.length}::text[])`);
  }
  if (filters.task !== undefined) {
    taskArrayPush(values, filters.task);
    taskArrayPush(clauses, `task_key = $${values.length}`);
  }
  const statuses = statusFilter(filters.status);
  if (statuses !== undefined) {
    const statusValues: DurableTaskObservedStatus[] = [];
    taskSetForEach(statuses, (status) => taskArrayPush(statusValues, status));
    taskArrayPush(values, statusValues);
    taskArrayPush(clauses, `status = any($${values.length}::text[])`);
  }

  taskArrayPush(values, taskMax(1, taskFloor(filters.limit ?? 100)));
  const limitPlaceholder = `$${values.length}`;
  taskArrayPush(values, taskMax(0, taskFloor(filters.offset ?? 0)));
  const offsetPlaceholder = `$${values.length}`;

  return {
    text: `select id, task_key, args, run_at, logical_key, status, attempts, created_at, updated_at,
  leased_until, lease_owner, last_error
from _kovo_jobs
${clauses.length === 0 ? '' : `where ${joinClauses(clauses)}`}
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
      ? {
          args: assertAndCloneJsonValue(scrubSecretLifecycleValue(job.args), {
            root: 'args',
          }),
        }
      : {}),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(options?.includeArgs === true && job.lastError !== undefined
      ? { lastError: taskString(scrubSecretLifecycleValue(job.lastError)) }
      : {}),
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
    args: assertAndCloneJsonValue(scrubSecretLifecycleValue(job.args), { root: 'args' }),
    runAt: copyDate(job.runAt),
    status: job.status,
    attempts: job.attempts,
    createdAt: copyDate(job.createdAt),
    updatedAt: copyDate(job.updatedAt),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(job.lastError === undefined
      ? {}
      : { lastError: taskString(scrubSecretLifecycleValue(job.lastError)) }),
    ...(job.leasedUntil === undefined ? {} : { leasedUntil: copyDate(job.leasedUntil) }),
    ...(job.leaseOwner === undefined ? {} : { leaseOwner: job.leaseOwner }),
  };
}

function statusFilter(
  status: DurableTaskObservedStatus | readonly DurableTaskObservedStatus[] | undefined,
): Set<DurableTaskObservedStatus> | undefined {
  if (status === undefined) return undefined;
  const statuses = taskCreateSet<DurableTaskObservedStatus>();
  if (taskIsArray(status)) {
    for (let index = 0; index < status.length; index += 1) {
      taskSetAdd(statuses, status[index] as DurableTaskObservedStatus);
    }
  } else {
    taskSetAdd(statuses, status);
  }
  return statuses;
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
  return taskDateIsDate(value) ? copyDate(value) : taskNewDate(value);
}

function copyDate(value: Date): Date {
  return taskNewDate(taskDateGetTime(value));
}

function mapStatusRecords(
  jobs: readonly DurableTaskStatusJob[],
  filters: Pick<DurableTaskStatusFilters, 'includeArgs'>,
): DurableTaskStatusRecord[] {
  const records: DurableTaskStatusRecord[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    taskArrayPush(records, statusRecord(jobs[index]!, filters));
  }
  return records;
}

function joinClauses(clauses: readonly string[]): string {
  let joined = clauses[0] ?? '';
  for (let index = 1; index < clauses.length; index += 1) joined += ` and ${clauses[index]!}`;
  return joined;
}
