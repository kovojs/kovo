import { assertAndCloneJsonValue, canonicalJsonStringify } from '@kovojs/core/internal/json';
import type { TaskHandle, TaskScheduleOptions } from './task.js';
import type {
  DurableTaskStatusSqlExecutor,
  DurableTaskStatusSqlResult,
  DurableTaskStatusSqlStatement,
} from './task-observability.js';
import { scrubSecretLifecycleValue } from './logging.js';
import { frameworkManagedDbRawTarget } from './sql-safe-handle.js';
import {
  taskApply,
  taskArrayPush,
  taskArraySlice,
  taskArraySort,
  taskCreateEntropyId,
  taskCreateMap,
  taskCreateSet,
  taskDateGetTime,
  taskDateIsDate,
  taskFloor,
  taskIsArray,
  taskIsError,
  taskIsRecord,
  taskMapForEach,
  taskMapGet,
  taskMapSet,
  taskMax,
  taskNewDate,
  taskNumberIsFinite,
  taskSetAdd,
  taskSetHas,
  taskString,
  taskStringReplaceAll,
  taskStringTrim,
  taskTrunc,
} from './task-security-intrinsics.js';

export type DurableTaskJobStatus =
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead'
  | 'cancelled';

export interface DurableTaskJob {
  readonly id: string;
  readonly task: string;
  readonly args: unknown;
  readonly runAt: Date;
  readonly key?: string;
  readonly lineage: string;
  readonly generation: number;
  readonly priority: number;
  readonly status: DurableTaskJobStatus;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly leasedUntil?: Date;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly lastError?: string;
}

export interface DurableTaskEnqueueInput {
  readonly task: string;
  readonly args: unknown;
  readonly runAt?: Date;
  readonly key?: string;
  readonly coalesce?: TaskScheduleOptions['coalesce'];
  readonly generation?: number;
  readonly lineage?: string;
  readonly priority?: number;
  readonly status?: 'ready' | 'dead';
  readonly lastError?: string;
}

export interface DurableTaskClaimOptions {
  readonly limit: number;
  readonly leaseMs: number;
  readonly now?: Date;
  readonly owner?: string;
  readonly taskKeys?: readonly string[];
}

export interface DurableTaskCompletionOptions {
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly now?: Date;
}

export interface DurableTaskFailureOptions extends DurableTaskCompletionOptions {
  readonly maxAttempts?: number;
  readonly retryAt?: Date;
}

export interface DurableTaskHeartbeatOptions {
  readonly leaseMs: number;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly now?: Date;
}

export interface DurableTaskQueueStore {
  enqueue(input: DurableTaskEnqueueInput): Promise<TaskHandle>;
  cancel(handle: TaskHandle): Promise<boolean>;
  claimDue(options: DurableTaskClaimOptions): Promise<DurableTaskJob[]>;
  heartbeat(id: string, options: DurableTaskHeartbeatOptions): Promise<boolean>;
  markSucceeded(id: string, options?: DurableTaskCompletionOptions | Date): Promise<boolean>;
  markFailed(
    id: string,
    error: unknown,
    options?: DurableTaskFailureOptions | Date,
  ): Promise<boolean>;
  reapExpiredLeases(now?: Date): Promise<number>;
}

/** Parameterized SQL statement executed by the durable task queue/status helpers. */
export interface DurableTaskSqlStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** Row result returned by a durable-task SQL executor (SPEC §9.6). */
export interface DurableTaskSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount?: number;
}

/** Minimal Postgres-compatible SQL executor consumed by the durable task queue. */
export interface DurableTaskSqlExecutor {
  execute<Row = Record<string, unknown>>(
    statement: DurableTaskSqlStatement,
  ): Promise<DurableTaskSqlResult<Row>>;
}

/**
 * Adapt a framework-managed or raw Postgres-compatible client into the parameterized
 * SQL executor shape used by durable-task queue/status helpers (SPEC §9.6).
 */
export function createDurableTaskSqlExecutor(handle: unknown): DurableTaskStatusSqlExecutor {
  const client = resolveRawSqlClient(frameworkManagedDbRawTarget(handle) ?? handle);
  if (client === undefined) {
    throw new TypeError(
      'Durable tasks require a Postgres-compatible db client with query(text, values) or execute({ text, values }) so _kovo_jobs can be persisted (SPEC §9.6).',
    );
  }

  const query = client.query;
  if (typeof query === 'function') {
    return {
      async execute<Row = Record<string, unknown>>(
        statement: DurableTaskStatusSqlStatement,
      ): Promise<DurableTaskStatusSqlResult<Row>> {
        const result = await taskApply<Promise<unknown>>(query, client, [
          statement.text,
          taskArraySlice(statement.values),
        ]);
        return normalizeSqlResult<Row>(result);
      },
    };
  }

  const execute = client.execute;
  if (typeof execute === 'function') {
    return {
      async execute<Row = Record<string, unknown>>(
        statement: DurableTaskStatusSqlStatement,
      ): Promise<DurableTaskStatusSqlResult<Row>> {
        const result = await taskApply<Promise<unknown>>(execute, client, [{
          text: statement.text,
          values: taskArraySlice(statement.values),
        }]);
        return normalizeSqlResult<Row>(result);
      },
    };
  }

  throw new TypeError(
    'Durable tasks require a Postgres-compatible db client with query(text, values) or execute({ text, values }) so _kovo_jobs can be persisted (SPEC §9.6).',
  );
}

interface DurableTaskJobRow {
  id: string;
  task_key: string;
  args: unknown;
  run_at: Date | string;
  logical_key: string | null;
  lineage: string | null;
  generation: number | null;
  priority: number | null;
  status: DurableTaskJobStatus;
  attempts: number;
  created_at: Date | string;
  updated_at: Date | string;
  leased_until: Date | string | null;
  lease_owner: string | null;
  lease_token: string | null;
  last_error: string | null;
}

export const KOVO_JOBS_TABLE_SQL: readonly DurableTaskSqlStatement[] = [
  {
    text: `create table if not exists _kovo_jobs (
  id text primary key,
  task_key text not null,
  args jsonb not null,
  logical_key text null,
  status text not null check (status in ('ready', 'running', 'succeeded', 'failed', 'dead', 'cancelled')),
  attempts integer not null default 0,
  lineage text null,
  generation integer not null default 0,
  priority integer not null default 0,
  run_at timestamptz not null,
  leased_until timestamptz null,
  lease_owner text null,
  lease_token text null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  cancelled_at timestamptz null
)`,
    values: [],
  },
  {
    text: `create unique index if not exists _kovo_jobs_ready_logical_key
on _kovo_jobs (task_key, logical_key)
where status = 'ready' and logical_key is not null`,
    values: [],
  },
  {
    text: `create index if not exists _kovo_jobs_ready_run_at
on _kovo_jobs (priority desc, run_at, created_at)
where status = 'ready'`,
    values: [],
  },
  {
    text: `create index if not exists _kovo_jobs_running_lease
on _kovo_jobs (leased_until)
where status = 'running'`,
    values: [],
  },
];

export async function ensureDurableTaskSchema(executor: DurableTaskSqlExecutor): Promise<void> {
  for (let index = 0; index < KOVO_JOBS_TABLE_SQL.length; index += 1) {
    await executor.execute(KOVO_JOBS_TABLE_SQL[index]!);
  }
}

const DURABLE_TASK_WRITER_TABLES = ['_kovo_jobs', '_kovo_task_cron_occurrences'] as const;

export async function grantDurableTaskWriterRole(
  executor: DurableTaskSqlExecutor,
  role = process.env.KOVO_DB_WRITER_ROLE ?? 'kovo_writer',
): Promise<void> {
  const writerRole = taskStringTrim(role);
  if (writerRole === '') return;
  for (let index = 0; index < DURABLE_TASK_WRITER_TABLES.length; index += 1) {
    const table = DURABLE_TASK_WRITER_TABLES[index]!;
    try {
      await executor.execute({
        text: `grant select, insert, update, delete on ${quoteIdent(table)} to ${quoteIdent(writerRole)}`,
        values: [],
      });
    } catch {
      // Non-Postgres adapters or externally managed role setups may not expose the default writer
      // role. The queue schema itself remains the authoritative startup check.
    }
  }
}

export async function assertDurableTaskStoreReady(
  executor: DurableTaskSqlExecutor,
  cause: unknown,
): Promise<void> {
  try {
    await executor.execute({ text: 'select id from _kovo_jobs where false', values: [] });
    await executor.execute({
      text: 'select cron_name from _kovo_task_cron_occurrences where false',
      values: [],
    });
  } catch {
    throw cause;
  }
}

function quoteIdent(value: string): string {
  return `"${taskStringReplaceAll(value, '"', '""')}"`;
}

export class PostgresDurableTaskQueue implements DurableTaskQueueStore {
  constructor(private readonly executor: DurableTaskSqlExecutor) {}

  async enqueue(input: DurableTaskEnqueueInput): Promise<TaskHandle> {
    const now = taskNewDate();
    const runAt = input.runAt ?? now;
    const id = createJobId();
    const argsJson = canonicalJsonStringify(scrubSecretLifecycleValue(input.args), {
      root: 'args',
    });
    const coalesce = input.coalesce ?? 'debounce';
    const lineage = input.lineage ?? id;
    const generation = normalizeNonNegativeInteger(input.generation, 0);
    const priority = normalizePriority(input.priority);
    const status = input.status ?? 'ready';
    const lastError = input.lastError === undefined ? null : scrubErrorMessage(input.lastError);

    if (input.key !== undefined && coalesce === 'throttle') {
      const result = await this.executor.execute<{ id: string }>(
        sqlStatement(taskQueueSql.enqueueThrottle, [
          id,
          input.task,
          argsJson,
          input.key,
          runAt,
          now,
          lineage,
          generation,
          priority,
          status,
          lastError,
        ]),
      );
      const row = result.rows[0];
      return { id: row?.id ?? id, task: input.task };
    }

    const statementText =
      input.key === undefined ? taskQueueSql.enqueueUnkeyed : taskQueueSql.enqueueDebounce;
    const result = await this.executor.execute<{ id: string }>(
      sqlStatement(statementText, [
        id,
        input.task,
        argsJson,
        input.key ?? null,
        runAt,
        now,
        lineage,
        generation,
        priority,
        status,
        lastError,
      ]),
    );
    return { id: result.rows[0]?.id ?? id, task: input.task };
  }

  async cancel(handle: TaskHandle): Promise<boolean> {
    const result = await this.executor.execute(
      sqlStatement(taskQueueSql.cancelReady, [handle.id, taskNewDate()]),
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async claimDue(options: DurableTaskClaimOptions): Promise<DurableTaskJob[]> {
    const now = options.now ?? taskNewDate();
    const owner = options.owner ?? 'kovo-runner';
    const leasedUntil = taskNewDate(taskDateGetTime(now) + options.leaseMs);
    const leaseToken = createLeaseToken();
    const taskKeys = dedupeTaskKeys(options.taskKeys);
    const result = await this.executor.execute<DurableTaskJobRow>(
      sqlStatement(taskQueueSql.claimDue, [
        now,
        taskMax(1, taskFloor(options.limit)),
        owner,
        leasedUntil,
        leaseToken,
        taskKeys,
      ]),
    );
    const jobs: DurableTaskJob[] = [];
    for (let index = 0; index < result.rows.length; index += 1) {
      taskArrayPush(jobs, jobFromRow(result.rows[index]!));
    }
    return jobs;
  }

  async heartbeat(id: string, options: DurableTaskHeartbeatOptions): Promise<boolean> {
    const now = options.now ?? taskNewDate();
    const leasedUntil = taskNewDate(taskDateGetTime(now) + taskMax(1, options.leaseMs));
    const result = await this.executor.execute(
      sqlStatement(taskQueueSql.heartbeat, [
        id,
        now,
        leasedUntil,
        options.leaseOwner ?? null,
        options.leaseToken ?? null,
      ]),
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async markSucceeded(
    id: string,
    options: DurableTaskCompletionOptions | Date = {},
  ): Promise<boolean> {
    const normalized = normalizeCompletionOptions(options);
    const result = await this.executor.execute(
      sqlStatement(taskQueueSql.markSucceeded, [
        id,
        normalized.now,
        normalized.leaseOwner ?? null,
        normalized.leaseToken ?? null,
      ]),
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async markFailed(
    id: string,
    error: unknown,
    options: DurableTaskFailureOptions | Date = {},
  ): Promise<boolean> {
    const normalized = normalizeFailureOptions(options);
    const result = await this.executor.execute(
      sqlStatement(taskQueueSql.markFailed, [
        id,
        errorMessage(error),
        normalized.now,
        normalized.maxAttempts,
        normalized.retryAt ?? normalized.now,
        normalized.leaseOwner ?? null,
        normalized.leaseToken ?? null,
      ]),
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async reapExpiredLeases(now: Date = taskNewDate()): Promise<number> {
    const result = await this.executor.execute(sqlStatement(taskQueueSql.reapExpiredLeases, [now]));
    return result.rowCount ?? result.rows.length;
  }
}

export class MemoryDurableTaskQueue implements DurableTaskQueueStore {
  private readonly jobs = taskCreateMap<string, MutableDurableTaskJob>();

  async enqueue(input: DurableTaskEnqueueInput): Promise<TaskHandle> {
    const now = taskNewDate();
    const runAt = input.runAt ?? now;
    const args = assertAndCloneJsonValue(scrubSecretLifecycleValue(input.args), {
      root: 'args',
    });
    const coalesce = input.coalesce ?? 'debounce';
    const id = createJobId();
    const lineage = input.lineage ?? id;
    const generation = normalizeNonNegativeInteger(input.generation, 0);
    const priority = normalizePriority(input.priority);
    const status = input.status ?? 'ready';

    if (input.key !== undefined) {
      let ready: MutableDurableTaskJob | undefined;
      taskMapForEach(this.jobs, (job) => {
        if (
          ready === undefined &&
          job.status === 'ready' &&
          job.task === input.task &&
          job.key === input.key
        ) {
          ready = job;
        }
      });
      if (ready !== undefined) {
        if (coalesce === 'debounce') {
          ready.args = args;
          ready.runAt = copyDate(runAt);
          ready.updatedAt = now;
        }
        return { id: ready.id, task: ready.task };
      }
    }

    const job: MutableDurableTaskJob = {
      id,
      task: input.task,
      args,
      runAt: copyDate(runAt),
      lineage,
      generation,
      priority,
      status,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (input.key !== undefined) job.key = input.key;
    if (input.lastError !== undefined) job.lastError = scrubErrorMessage(input.lastError);
    taskMapSet(this.jobs, id, job);
    return { id, task: input.task };
  }

  async cancel(handle: TaskHandle): Promise<boolean> {
    const job = taskMapGet(this.jobs, handle.id);
    if (job === undefined || job.status !== 'ready') return false;
    const now = taskNewDate();
    job.status = 'cancelled';
    job.updatedAt = now;
    return true;
  }

  async claimDue(options: DurableTaskClaimOptions): Promise<DurableTaskJob[]> {
    const now = options.now ?? taskNewDate();
    const leaseMs = taskMax(1, options.leaseMs);
    const owner = options.owner ?? 'memory-runner';
    const taskKeys = taskKeySet(options.taskKeys);
    const dueCandidates: MutableDurableTaskJob[] = [];
    const nowMs = taskDateGetTime(now);
    taskMapForEach(this.jobs, (job) => {
      if (
        job.status === 'ready' &&
        taskDateGetTime(job.runAt) <= nowMs &&
        (taskKeys === undefined || taskSetHas(taskKeys, job.task))
      ) {
        taskArrayPush(dueCandidates, job);
      }
    });
    taskArraySort(
      dueCandidates,
      (a, b) =>
        b.priority - a.priority ||
        taskDateGetTime(a.runAt) - taskDateGetTime(b.runAt) ||
        taskDateGetTime(a.createdAt) - taskDateGetTime(b.createdAt),
    );
    const due = taskArraySlice(dueCandidates, 0, taskMax(1, taskFloor(options.limit)));

    for (let index = 0; index < due.length; index += 1) {
      const job = due[index]!;
      job.status = 'running';
      job.attempts += 1;
      job.leaseOwner = owner;
      job.leaseToken = createLeaseToken();
      job.leasedUntil = taskNewDate(nowMs + leaseMs);
      job.updatedAt = now;
    }

    const claimed: DurableTaskJob[] = [];
    for (let index = 0; index < due.length; index += 1) {
      taskArrayPush(claimed, readonlyJob(due[index]!));
    }
    return claimed;
  }

  async heartbeat(id: string, options: DurableTaskHeartbeatOptions): Promise<boolean> {
    const job = taskMapGet(this.jobs, id);
    if (job === undefined || job.status !== 'running') return false;
    if (!leaseMatches(job, options)) return false;
    const now = options.now ?? taskNewDate();
    job.leasedUntil = taskNewDate(taskDateGetTime(now) + taskMax(1, options.leaseMs));
    job.updatedAt = now;
    return true;
  }

  async markSucceeded(
    id: string,
    options: DurableTaskCompletionOptions | Date = {},
  ): Promise<boolean> {
    const job = taskMapGet(this.jobs, id);
    if (job === undefined || job.status !== 'running') return false;
    const normalized = normalizeCompletionOptions(options);
    if (!leaseMatches(job, normalized)) return false;
    job.status = 'succeeded';
    delete job.leasedUntil;
    delete job.leaseOwner;
    delete job.leaseToken;
    job.updatedAt = normalized.now;
    return true;
  }

  async markFailed(
    id: string,
    error: unknown,
    options: DurableTaskFailureOptions | Date = {},
  ): Promise<boolean> {
    const job = taskMapGet(this.jobs, id);
    if (job === undefined || job.status !== 'running') return false;
    const normalized = normalizeFailureOptions(options);
    if (!leaseMatches(job, normalized)) return false;
    job.status = job.attempts >= normalized.maxAttempts ? 'dead' : 'ready';
    job.lastError = scrubErrorMessage(error);
    if (job.status === 'ready') {
      job.runAt = copyDate(normalized.retryAt ?? normalized.now);
    }
    delete job.leasedUntil;
    delete job.leaseOwner;
    delete job.leaseToken;
    job.updatedAt = normalized.now;
    return true;
  }

  async reapExpiredLeases(now: Date = taskNewDate()): Promise<number> {
    let reaped = 0;
    const nowMs = taskDateGetTime(now);
    taskMapForEach(this.jobs, (job) => {
      if (
        job.status === 'running' &&
        job.leasedUntil !== undefined &&
        taskDateGetTime(job.leasedUntil) <= nowMs
      ) {
        job.status = 'ready';
        delete job.leasedUntil;
        delete job.leaseOwner;
        delete job.leaseToken;
        job.updatedAt = now;
        reaped += 1;
      }
    });
    return reaped;
  }

  snapshot(): DurableTaskJob[] {
    const jobs: DurableTaskJob[] = [];
    taskMapForEach(this.jobs, (job) => taskArrayPush(jobs, readonlyJob(job)));
    return jobs;
  }
}

interface MutableDurableTaskJob {
  id: string;
  task: string;
  args: unknown;
  runAt: Date;
  key?: string;
  lineage: string;
  generation: number;
  priority: number;
  status: DurableTaskJobStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  leasedUntil?: Date;
  leaseOwner?: string;
  leaseToken?: string;
  lastError?: string;
}

const taskQueueSql = {
  enqueueUnkeyed: `insert into _kovo_jobs (
  id, task_key, args, logical_key, status, attempts, run_at, created_at, updated_at,
  lineage, generation, priority, last_error
) values ($1, $2, $3::jsonb, $4, $10, 0, $5, $6, $6, $7, $8, $9, $11)
returning id`,
  enqueueDebounce: `insert into _kovo_jobs (
  id, task_key, args, logical_key, status, attempts, run_at, created_at, updated_at,
  lineage, generation, priority, last_error
) values ($1, $2, $3::jsonb, $4, $10, 0, $5, $6, $6, $7, $8, $9, $11)
on conflict (task_key, logical_key) where status = 'ready' and logical_key is not null
do update set args = excluded.args,
  run_at = excluded.run_at,
  priority = excluded.priority,
  updated_at = excluded.updated_at
returning id`,
  enqueueThrottle: `insert into _kovo_jobs (
  id, task_key, args, logical_key, status, attempts, run_at, created_at, updated_at,
  lineage, generation, priority, last_error
) values ($1, $2, $3::jsonb, $4, $10, 0, $5, $6, $6, $7, $8, $9, $11)
on conflict (task_key, logical_key) where status = 'ready' and logical_key is not null
do update set updated_at = _kovo_jobs.updated_at
returning id`,
  cancelReady: `update _kovo_jobs
set status = 'cancelled', cancelled_at = $2, updated_at = $2
where id = $1 and status = 'ready'`,
  claimDue: `with claimed as (
  select id from _kovo_jobs
  where status = 'ready' and run_at <= $1 and ($6::text[] is null or task_key = any($6::text[]))
  order by priority desc, run_at asc, created_at asc
  for update skip locked
  limit $2
)
update _kovo_jobs
set status = 'running',
  attempts = attempts + 1,
  lease_owner = $3,
  leased_until = $4,
  lease_token = $5,
  updated_at = $1
where id in (select id from claimed)
returning id, task_key, args, run_at, logical_key, status, attempts, created_at, updated_at,
  leased_until, lease_owner, lease_token, last_error, lineage, generation, priority`,
  heartbeat: `update _kovo_jobs
set leased_until = $3,
  updated_at = $2
where id = $1
  and status = 'running'
  and ($4::text is null or lease_owner = $4)
  and ($5::text is null or lease_token = $5)`,
  markSucceeded: `update _kovo_jobs
set status = 'succeeded',
  completed_at = $2,
  leased_until = null,
  lease_owner = null,
  lease_token = null,
  updated_at = $2
where id = $1
  and status = 'running'
  and ($3::text is null or lease_owner = $3)
  and ($4::text is null or lease_token = $4)`,
  markFailed: `update _kovo_jobs
set status = case when attempts >= $4 then 'dead' else 'ready' end,
  last_error = $2,
  run_at = case when attempts >= $4 then run_at else $5 end,
  leased_until = null,
  lease_owner = null,
  lease_token = null,
  updated_at = $3
where id = $1
  and status = 'running'
  and ($6::text is null or lease_owner = $6)
  and ($7::text is null or lease_token = $7)`,
  reapExpiredLeases: `update _kovo_jobs
set status = 'ready',
  leased_until = null,
  lease_owner = null,
  lease_token = null,
  updated_at = $1
where status = 'running' and leased_until <= $1`,
} as const;

function jobFromRow(row: DurableTaskJobRow): DurableTaskJob {
  return {
    id: row.id,
    task: row.task_key,
    args: row.args,
    runAt: dateFrom(row.run_at),
    lineage: row.lineage ?? row.id,
    generation: row.generation ?? 0,
    priority: row.priority ?? 0,
    status: row.status,
    attempts: row.attempts,
    createdAt: dateFrom(row.created_at),
    updatedAt: dateFrom(row.updated_at),
    ...(row.logical_key === null ? {} : { key: row.logical_key }),
    ...(row.leased_until === null ? {} : { leasedUntil: dateFrom(row.leased_until) }),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_token === null ? {} : { leaseToken: row.lease_token }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

function sqlStatement(text: string, values: readonly unknown[]): DurableTaskSqlStatement {
  return { text, values };
}

function resolveRawSqlClient(handle: unknown): SqlClientLike | undefined {
  if (!isRecord(handle)) return undefined;

  const session = handle.session;
  if (isRecord(session) && isSqlClientLike(session.client)) {
    return session.client;
  }

  if (isSqlClientLike(handle.$client)) return handle.$client;
  if (isSqlClientLike(handle.client)) return handle.client;
  if (isSqlClientLike(handle)) return handle;
  return undefined;
}

interface SqlClientLike {
  execute?: (...args: unknown[]) => unknown;
  query?: (...args: unknown[]) => unknown;
}

function isSqlClientLike(value: unknown): value is SqlClientLike {
  return (
    isRecord(value) && (typeof value.query === 'function' || typeof value.execute === 'function')
  );
}

function normalizeSqlResult<Row>(result: unknown): DurableTaskSqlResult<Row> {
  if (taskIsArray(result)) return { rows: result as readonly Row[] };
  if (!isRecord(result)) return { rows: [] };

  const rows = taskIsArray(result.rows) ? (result.rows as readonly Row[]) : [];
  return {
    rows,
    ...(typeof result.rowCount === 'number'
      ? { rowCount: result.rowCount }
      : typeof result.affectedRows === 'number'
        ? { rowCount: result.affectedRows }
        : {}),
  };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return taskIsRecord(value);
}

function readonlyJob(job: MutableDurableTaskJob): DurableTaskJob {
  return {
    id: job.id,
    task: job.task,
    args: assertAndCloneJsonValue(job.args, { root: 'args' }),
    runAt: copyDate(job.runAt),
    lineage: job.lineage,
    generation: job.generation,
    priority: job.priority,
    status: job.status,
    attempts: job.attempts,
    createdAt: copyDate(job.createdAt),
    updatedAt: copyDate(job.updatedAt),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(job.leasedUntil === undefined ? {} : { leasedUntil: copyDate(job.leasedUntil) }),
    ...(job.leaseOwner === undefined ? {} : { leaseOwner: job.leaseOwner }),
    ...(job.leaseToken === undefined ? {} : { leaseToken: job.leaseToken }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
  };
}

function dateFrom(value: Date | string): Date {
  return taskDateIsDate(value) ? copyDate(value) : taskNewDate(value);
}

function copyDate(value: Date): Date {
  return taskNewDate(taskDateGetTime(value));
}

function createJobId(): string {
  return taskCreateEntropyId('job');
}

function createLeaseToken(): string {
  return taskCreateEntropyId('lease');
}

function scrubErrorMessage(error: unknown): string {
  return errorMessage(scrubSecretLifecycleValue(error));
}

function errorMessage(error: unknown): string {
  if (taskIsError(error)) return error.message;
  if (typeof error === 'string') return error;
  try {
    const json = canonicalJsonStringify(error, { root: 'error' });
    if (typeof json === 'string') return json;
  } catch (_jsonError) {
    void _jsonError;
  }
  return taskString(error);
}

function normalizePriority(value: number | undefined): number {
  if (value === undefined || !taskNumberIsFinite(value)) return 0;
  return taskTrunc(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !taskNumberIsFinite(value)) return fallback;
  return taskMax(0, taskTrunc(value));
}

function normalizeCompletionOptions(
  options: DurableTaskCompletionOptions | Date,
): Required<Pick<DurableTaskCompletionOptions, 'now'>> & Omit<DurableTaskCompletionOptions, 'now'> {
  if (taskDateIsDate(options)) return { now: options };
  return {
    ...(options.leaseOwner === undefined ? {} : { leaseOwner: options.leaseOwner }),
    ...(options.leaseToken === undefined ? {} : { leaseToken: options.leaseToken }),
    now: options.now ?? taskNewDate(),
  };
}

interface NormalizedDurableTaskFailureOptions extends DurableTaskFailureOptions {
  readonly maxAttempts: number;
  readonly now: Date;
}

function normalizeFailureOptions(
  options: DurableTaskFailureOptions | Date,
): NormalizedDurableTaskFailureOptions {
  if (taskDateIsDate(options)) return { maxAttempts: 1, now: options };
  const maxAttempts =
    options.maxAttempts === undefined || !taskNumberIsFinite(options.maxAttempts)
      ? 1
      : taskMax(1, taskTrunc(options.maxAttempts));
  return {
    ...(options.leaseOwner === undefined ? {} : { leaseOwner: options.leaseOwner }),
    ...(options.leaseToken === undefined ? {} : { leaseToken: options.leaseToken }),
    ...(options.retryAt === undefined ? {} : { retryAt: options.retryAt }),
    maxAttempts,
    now: options.now ?? taskNewDate(),
  };
}

function taskKeySet(values: readonly string[] | undefined): Set<string> | undefined {
  if (values === undefined) return undefined;
  const set = taskCreateSet<string>();
  for (let index = 0; index < values.length; index += 1) taskSetAdd(set, values[index]!);
  return set;
}

function dedupeTaskKeys(values: readonly string[] | undefined): string[] | null {
  if (values === undefined || values.length === 0) return null;
  const set = taskCreateSet<string>();
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (taskSetHas(set, value)) continue;
    taskSetAdd(set, value);
    taskArrayPush(result, value);
  }
  return result;
}

function leaseMatches(
  job: MutableDurableTaskJob,
  options: Pick<DurableTaskCompletionOptions, 'leaseOwner' | 'leaseToken'>,
): boolean {
  if (options.leaseOwner !== undefined && job.leaseOwner !== options.leaseOwner) return false;
  if (options.leaseToken !== undefined && job.leaseToken !== options.leaseToken) return false;
  return true;
}
