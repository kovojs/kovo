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
  taskFreeze,
  taskIsArray,
  taskIsRecord,
  taskMax,
  taskNewDate,
  taskNumberIsSafeInteger,
  taskOwnDataValue,
  taskOptionalOwnDataValue,
  taskSetAdd,
  taskSetForEach,
  taskSetHas,
  taskSetSize,
  taskSnapshotCollection,
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
      const filters = snapshotStatusFilters({
        ids: [statusHandleId(handle)],
        includeArgs: snapshotIncludeArgs(options),
        limit: 1,
      });
      const jobs = await readJobs(filters);
      const job = jobs[0];
      return job === undefined ? undefined : statusRecord(job, filters.includeArgs === true);
    },
    async list(filters = {}) {
      const snapshot = snapshotStatusFilters(filters);
      const jobs = await readJobs(snapshot);
      return mapStatusRecords(jobs, snapshot.includeArgs === true);
    },
    async listFailures(filters = {}) {
      const snapshot = snapshotStatusFilters(filters, ['failed', 'dead']);
      const jobs = await readJobs(snapshot);
      return mapStatusRecords(jobs, snapshot.includeArgs === true);
    },
  };
}

function statusHandleId(handle: TaskHandle | string): string {
  const id = typeof handle === 'string' ? handle : taskOwnDataValue(handle, 'id');
  if (typeof id !== 'string') {
    throw new TypeError('Durable task status handles require an own string id.');
  }
  return id;
}

function snapshotIncludeArgs(
  options: Pick<DurableTaskStatusFilters, 'includeArgs'> | undefined,
): boolean {
  if (options === undefined) return false;
  if (!taskIsRecord(options)) {
    throw new TypeError('Durable task status options must be a stable own-data record.');
  }
  const includeArgs = taskOptionalOwnDataValue(options, 'includeArgs');
  if (includeArgs !== undefined && typeof includeArgs !== 'boolean') {
    throw new TypeError('Durable task status includeArgs must be a boolean.');
  }
  return includeArgs === true;
}

function snapshotStatusFilters(
  filters: DurableTaskStatusFilters,
  statusOverride?: readonly DurableTaskObservedStatus[],
): DurableTaskStatusFilters {
  if (!taskIsRecord(filters)) {
    throw new TypeError('Durable task status filters must be a stable own-data record.');
  }
  const idsSource = taskOptionalOwnDataValue(filters, 'ids');
  const task = taskOptionalOwnDataValue(filters, 'task');
  const statusSource = statusOverride ?? taskOptionalOwnDataValue(filters, 'status');
  const limit = taskOptionalOwnDataValue(filters, 'limit');
  const offset = taskOptionalOwnDataValue(filters, 'offset');
  const includeArgs = snapshotIncludeArgs(filters);

  let ids: readonly string[] | undefined;
  if (idsSource !== undefined) {
    if (!taskIsArray(idsSource)) {
      throw new TypeError('Durable task status ids must be a dense own-data string array.');
    }
    const values = taskSnapshotCollection<unknown>(idsSource, 'Durable task status ids');
    for (let index = 0; index < values.length; index += 1) {
      if (typeof values[index] !== 'string') {
        throw new TypeError('Durable task status ids must be a dense own-data string array.');
      }
    }
    ids = taskFreeze(values as string[]);
  }

  if (task !== undefined && typeof task !== 'string') {
    throw new TypeError('Durable task status task must be a string.');
  }
  if (limit !== undefined && !taskNumberIsSafeInteger(limit)) {
    throw new TypeError('Durable task status limit must be a safe integer.');
  }
  if (offset !== undefined && !taskNumberIsSafeInteger(offset)) {
    throw new TypeError('Durable task status offset must be a safe integer.');
  }

  let status: DurableTaskObservedStatus | readonly DurableTaskObservedStatus[] | undefined;
  if (statusSource !== undefined) {
    if (taskIsArray(statusSource)) {
      const values = taskSnapshotCollection<unknown>(
        statusSource,
        'Durable task status filters',
      );
      for (let index = 0; index < values.length; index += 1) {
        values[index] = observedStatusValue(values[index]);
      }
      status = taskFreeze(values as DurableTaskObservedStatus[]);
    } else {
      status = observedStatusValue(statusSource);
    }
  }

  return taskFreeze({
    ...(ids === undefined ? {} : { ids }),
    ...(task === undefined ? {} : { task }),
    ...(status === undefined ? {} : { status }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(includeArgs ? { includeArgs: true } : {}),
  });
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
      if (!taskIsRecord(result)) {
        throw new TypeError('Durable task status SQL result must be a stable record.');
      }
      const rawRows = taskOwnDataValue(result, 'rows');
      if (!taskIsArray(rawRows)) {
        throw new TypeError('Durable task status SQL rows must be a dense own-data array.');
      }
      const rows = taskSnapshotCollection<DurableTaskJobRow>(
        rawRows as DurableTaskJobRow[],
        'Durable task status SQL rows',
      );
      const jobs: DurableTaskStatusJob[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        taskArrayPush(jobs, jobFromRow(rows[index]!, filters.includeArgs === true));
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
  if (!taskIsArray(jobs)) {
    throw new TypeError('Durable task status snapshots must return a dense own-data array.');
  }
  const rawJobs = taskSnapshotCollection<DurableTaskStatusJob>(
    jobs as DurableTaskStatusJob[],
    'Durable task status snapshot jobs',
  );
  const snapshotJobs: DurableTaskStatusJob[] = [];
  for (let index = 0; index < rawJobs.length; index += 1) {
    taskArrayPush(
      snapshotJobs,
      snapshotStatusJob(rawJobs[index]!, filters.includeArgs === true),
    );
  }
  const ids = taskCreateSet<string>();
  const filterIds = filters.ids ?? [];
  for (let index = 0; index < filterIds.length; index += 1) taskSetAdd(ids, filterIds[index]!);
  const statuses = statusFilter(filters.status);
  const offset = taskMax(0, taskFloor(filters.offset ?? 0));
  const limit = taskMax(0, taskFloor(filters.limit ?? 100));
  const selected: DurableTaskStatusJob[] = [];
  for (let index = 0; index < snapshotJobs.length; index += 1) {
    const job = snapshotJobs[index]!;
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
  return taskArraySlice(selected, offset, offset + limit);
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
  includeArgs: boolean,
): DurableTaskStatusRecord {
  return {
    id: job.id,
    task: job.task,
    status: job.status,
    attempts: job.attempts,
    runAt: copyDate(job.runAt),
    createdAt: copyDate(job.createdAt),
    updatedAt: copyDate(job.updatedAt),
    ...(includeArgs
      ? {
          args: assertAndCloneJsonValue(scrubSecretLifecycleValue(job.args), {
            root: 'args',
          }),
        }
      : {}),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(includeArgs && job.lastError !== undefined
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

function jobFromRow(row: DurableTaskJobRow, includeArgs: boolean): DurableTaskStatusJob {
  const id = statusJobRowValue(row, 'id');
  const task = statusJobRowValue(row, 'task_key');
  const runAt = statusJobRowValue(row, 'run_at');
  const status = statusJobRowValue(row, 'status');
  const attempts = statusJobRowValue(row, 'attempts');
  const createdAt = statusJobRowValue(row, 'created_at');
  const updatedAt = statusJobRowValue(row, 'updated_at');
  const logicalKey = statusJobRowValue(row, 'logical_key');
  const leasedUntil = statusJobRowValue(row, 'leased_until');
  const leaseOwner = statusJobRowValue(row, 'lease_owner');
  const args = includeArgs ? statusJobRowValue(row, 'args') : undefined;
  const lastError = includeArgs ? statusJobRowValue(row, 'last_error') : null;
  return snapshotStatusJob({
    id,
    task,
    args,
    runAt: dateFrom(runAt),
    status: observedStatus(status),
    attempts,
    createdAt: dateFrom(createdAt),
    updatedAt: dateFrom(updatedAt),
    ...(logicalKey === null ? {} : { key: logicalKey }),
    ...(leasedUntil === null ? {} : { leasedUntil: dateFrom(leasedUntil) }),
    ...(leaseOwner === null ? {} : { leaseOwner }),
    ...(lastError === null ? {} : { lastError }),
  } as DurableTaskStatusJob, includeArgs);
}

function statusJobRowValue<Key extends keyof DurableTaskJobRow>(
  row: DurableTaskJobRow,
  property: Key,
): DurableTaskJobRow[Key] {
  return taskOwnDataValue(row, property) as DurableTaskJobRow[Key];
}

function snapshotStatusJob(job: DurableTaskStatusJob, includeArgs: boolean): DurableTaskStatusJob {
  if (!taskIsRecord(job)) {
    throw new TypeError('Durable task status snapshot jobs must be stable own-data records.');
  }
  const id = taskOwnDataValue(job, 'id');
  const task = taskOwnDataValue(job, 'task');
  const runAt = taskOwnDataValue(job, 'runAt');
  const status = taskOwnDataValue(job, 'status');
  const attempts = taskOwnDataValue(job, 'attempts');
  const createdAt = taskOwnDataValue(job, 'createdAt');
  const updatedAt = taskOwnDataValue(job, 'updatedAt');
  const key = taskOptionalOwnDataValue(job, 'key');
  const leasedUntil = taskOptionalOwnDataValue(job, 'leasedUntil');
  const leaseOwner = taskOptionalOwnDataValue(job, 'leaseOwner');
  const args = includeArgs ? taskOwnDataValue(job, 'args') : undefined;
  const lastError = includeArgs ? taskOptionalOwnDataValue(job, 'lastError') : undefined;

  if (typeof id !== 'string' || typeof task !== 'string') {
    throw new TypeError('Durable task status snapshot job id and task must be strings.');
  }
  if (!taskNumberIsSafeInteger(attempts) || attempts < 0) {
    throw new TypeError('Durable task status snapshot job attempts must be a non-negative integer.');
  }
  if (!taskDateIsDate(runAt) || !taskDateIsDate(createdAt) || !taskDateIsDate(updatedAt)) {
    throw new TypeError('Durable task status snapshot job timestamps must be Date values.');
  }
  if (key !== undefined && typeof key !== 'string') {
    throw new TypeError('Durable task status snapshot job key must be a string.');
  }
  if (leasedUntil !== undefined && !taskDateIsDate(leasedUntil)) {
    throw new TypeError('Durable task status snapshot job lease timestamp must be a Date value.');
  }
  if (leaseOwner !== undefined && typeof leaseOwner !== 'string') {
    throw new TypeError('Durable task status snapshot job lease owner must be a string.');
  }

  return taskFreeze({
    id,
    task,
    args:
      includeArgs
        ? assertAndCloneJsonValue(scrubSecretLifecycleValue(args), { root: 'args' })
        : undefined,
    runAt: copyDate(runAt),
    status: observedStatusValue(status),
    attempts,
    createdAt: copyDate(createdAt),
    updatedAt: copyDate(updatedAt),
    ...(key === undefined ? {} : { key }),
    ...(lastError === undefined
      ? {}
      : { lastError: taskString(scrubSecretLifecycleValue(lastError)) }),
    ...(leasedUntil === undefined ? {} : { leasedUntil: copyDate(leasedUntil) }),
    ...(leaseOwner === undefined ? {} : { leaseOwner }),
  });
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
  return observedStatusValue(status);
}

function observedStatusValue(status: unknown): DurableTaskObservedStatus {
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
  throw new TypeError('Unknown durable task status in _kovo_jobs.');
}

function isSqlExecutor(
  value: DurableTaskStatusSnapshotSource | DurableTaskStatusSqlExecutor,
): value is DurableTaskStatusSqlExecutor {
  if (!taskIsRecord(value)) {
    throw new TypeError('Durable task status sources must be stable records.');
  }
  return taskOptionalOwnDataValue(value, 'execute') !== undefined;
}

function dateFrom(value: Date | string): Date {
  return taskDateIsDate(value) ? copyDate(value) : taskNewDate(value);
}

function copyDate(value: Date): Date {
  return taskNewDate(taskDateGetTime(value));
}

function mapStatusRecords(
  jobs: readonly DurableTaskStatusJob[],
  includeArgs: boolean,
): DurableTaskStatusRecord[] {
  const records: DurableTaskStatusRecord[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    taskArrayPush(records, statusRecord(jobs[index]!, includeArgs));
  }
  return records;
}

function joinClauses(clauses: readonly string[]): string {
  let joined = clauses[0] ?? '';
  for (let index = 1; index < clauses.length; index += 1) joined += ` and ${clauses[index]!}`;
  return joined;
}
