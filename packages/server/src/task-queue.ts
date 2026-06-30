import type { TaskHandle, TaskScheduleOptions } from './task.js';

export type DurableTaskJobStatus = 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface DurableTaskJob {
  readonly id: string;
  readonly task: string;
  readonly args: unknown;
  readonly runAt: Date;
  readonly key?: string;
  readonly status: DurableTaskJobStatus;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly leasedUntil?: Date;
  readonly leaseOwner?: string;
  readonly lastError?: string;
}

export interface DurableTaskEnqueueInput {
  readonly task: string;
  readonly args: unknown;
  readonly runAt?: Date;
  readonly key?: string;
  readonly coalesce?: TaskScheduleOptions['coalesce'];
}

export interface DurableTaskClaimOptions {
  readonly limit: number;
  readonly leaseMs: number;
  readonly now?: Date;
  readonly owner?: string;
}

export interface DurableTaskQueueStore {
  enqueue(input: DurableTaskEnqueueInput): Promise<TaskHandle>;
  cancel(handle: TaskHandle): Promise<boolean>;
  claimDue(options: DurableTaskClaimOptions): Promise<DurableTaskJob[]>;
  markSucceeded(id: string, now?: Date): Promise<boolean>;
  markFailed(id: string, error: unknown, now?: Date): Promise<boolean>;
  reapExpiredLeases(now?: Date): Promise<number>;
}

export interface DurableTaskSqlStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface DurableTaskSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount?: number;
}

export interface DurableTaskSqlExecutor {
  execute<Row = Record<string, unknown>>(
    statement: DurableTaskSqlStatement,
  ): Promise<DurableTaskSqlResult<Row>>;
}

export function createDurableTaskSqlExecutor(handle: unknown): DurableTaskSqlExecutor {
  const client = resolveRawSqlClient(handle);
  if (client === undefined) {
    throw new TypeError(
      'Durable tasks require a Postgres-compatible db client with query(text, values) or execute({ text, values }) so _kovo_jobs can be persisted (SPEC §9.6).',
    );
  }

  const query = client.query;
  if (typeof query === 'function') {
    return {
      async execute<Row = Record<string, unknown>>(
        statement: DurableTaskSqlStatement,
      ): Promise<DurableTaskSqlResult<Row>> {
        const result = await query.call(client, statement.text, [...statement.values]);
        return normalizeSqlResult<Row>(result);
      },
    };
  }

  const execute = client.execute;
  if (typeof execute === 'function') {
    return {
      async execute<Row = Record<string, unknown>>(
        statement: DurableTaskSqlStatement,
      ): Promise<DurableTaskSqlResult<Row>> {
        const result = await execute.call(client, {
          text: statement.text,
          values: [...statement.values],
        });
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
  status: DurableTaskJobStatus;
  attempts: number;
  created_at: Date | string;
  updated_at: Date | string;
  leased_until: Date | string | null;
  lease_owner: string | null;
  last_error: string | null;
}

export const KOVO_JOBS_TABLE_SQL: readonly DurableTaskSqlStatement[] = [
  {
    text: `create table if not exists _kovo_jobs (
  id text primary key,
  task_key text not null,
  args jsonb not null,
  logical_key text null,
  status text not null check (status in ('ready', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0,
  run_at timestamptz not null,
  leased_until timestamptz null,
  lease_owner text null,
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
on _kovo_jobs (run_at, created_at)
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
  for (const statement of KOVO_JOBS_TABLE_SQL) {
    await executor.execute(statement);
  }
}

export class PostgresDurableTaskQueue implements DurableTaskQueueStore {
  constructor(private readonly executor: DurableTaskSqlExecutor) {}

  async enqueue(input: DurableTaskEnqueueInput): Promise<TaskHandle> {
    const now = new Date();
    const runAt = input.runAt ?? now;
    const id = createJobId();
    const argsJson = JSON.stringify(assertJsonSerializable(input.args));
    const coalesce = input.coalesce ?? 'debounce';

    if (input.key !== undefined && coalesce === 'throttle') {
      const result = await this.executor.execute<{ id: string }>(
        sqlStatement(taskQueueSql.enqueueThrottle, [
          id,
          input.task,
          argsJson,
          input.key,
          runAt,
          now,
        ]),
      );
      const row = result.rows[0];
      return { id: row?.id ?? id, task: input.task };
    }

    const statementText =
      input.key === undefined ? taskQueueSql.enqueueUnkeyed : taskQueueSql.enqueueDebounce;
    const result = await this.executor.execute<{ id: string }>(
      sqlStatement(statementText, [id, input.task, argsJson, input.key ?? null, runAt, now]),
    );
    return { id: result.rows[0]?.id ?? id, task: input.task };
  }

  async cancel(handle: TaskHandle): Promise<boolean> {
    const result = await this.executor.execute(
      sqlStatement(taskQueueSql.cancelReady, [handle.id, new Date()]),
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async claimDue(options: DurableTaskClaimOptions): Promise<DurableTaskJob[]> {
    const now = options.now ?? new Date();
    const owner = options.owner ?? 'kovo-runner';
    const leasedUntil = new Date(now.getTime() + options.leaseMs);
    const result = await this.executor.execute<DurableTaskJobRow>(
      sqlStatement(taskQueueSql.claimDue, [
        now,
        Math.max(1, Math.floor(options.limit)),
        owner,
        leasedUntil,
      ]),
    );
    return result.rows.map(jobFromRow);
  }

  async markSucceeded(id: string, now: Date = new Date()): Promise<boolean> {
    const result = await this.executor.execute(sqlStatement(taskQueueSql.markSucceeded, [id, now]));
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async markFailed(id: string, error: unknown, now: Date = new Date()): Promise<boolean> {
    const result = await this.executor.execute(
      sqlStatement(taskQueueSql.markFailed, [id, errorMessage(error), now]),
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async reapExpiredLeases(now: Date = new Date()): Promise<number> {
    const result = await this.executor.execute(sqlStatement(taskQueueSql.reapExpiredLeases, [now]));
    return result.rowCount ?? result.rows.length;
  }
}

export class MemoryDurableTaskQueue implements DurableTaskQueueStore {
  private readonly jobs = new Map<string, MutableDurableTaskJob>();

  async enqueue(input: DurableTaskEnqueueInput): Promise<TaskHandle> {
    const now = new Date();
    const runAt = input.runAt ?? now;
    const args = cloneJson(assertJsonSerializable(input.args));
    const coalesce = input.coalesce ?? 'debounce';

    if (input.key !== undefined) {
      const ready = [...this.jobs.values()].find(
        (job) => job.status === 'ready' && job.task === input.task && job.key === input.key,
      );
      if (ready !== undefined) {
        if (coalesce === 'debounce') {
          ready.args = args;
          ready.runAt = copyDate(runAt);
          ready.updatedAt = now;
        }
        return { id: ready.id, task: ready.task };
      }
    }

    const id = createJobId();
    const job: MutableDurableTaskJob = {
      id,
      task: input.task,
      args,
      runAt: copyDate(runAt),
      status: 'ready',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (input.key !== undefined) job.key = input.key;
    this.jobs.set(id, job);
    return { id, task: input.task };
  }

  async cancel(handle: TaskHandle): Promise<boolean> {
    const job = this.jobs.get(handle.id);
    if (job === undefined || job.status !== 'ready') return false;
    const now = new Date();
    job.status = 'cancelled';
    job.updatedAt = now;
    return true;
  }

  async claimDue(options: DurableTaskClaimOptions): Promise<DurableTaskJob[]> {
    const now = options.now ?? new Date();
    const leaseMs = Math.max(1, options.leaseMs);
    const owner = options.owner ?? 'memory-runner';
    const due = [...this.jobs.values()]
      .filter((job) => job.status === 'ready' && job.runAt.getTime() <= now.getTime())
      .sort(
        (a, b) =>
          a.runAt.getTime() - b.runAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .slice(0, Math.max(1, Math.floor(options.limit)));

    for (const job of due) {
      job.status = 'running';
      job.attempts += 1;
      job.leaseOwner = owner;
      job.leasedUntil = new Date(now.getTime() + leaseMs);
      job.updatedAt = now;
    }

    return due.map(readonlyJob);
  }

  async markSucceeded(id: string, now: Date = new Date()): Promise<boolean> {
    const job = this.jobs.get(id);
    if (job === undefined || job.status !== 'running') return false;
    job.status = 'succeeded';
    delete job.leasedUntil;
    delete job.leaseOwner;
    job.updatedAt = now;
    return true;
  }

  async markFailed(id: string, error: unknown, now: Date = new Date()): Promise<boolean> {
    const job = this.jobs.get(id);
    if (job === undefined || job.status !== 'running') return false;
    job.status = 'failed';
    job.lastError = errorMessage(error);
    delete job.leasedUntil;
    delete job.leaseOwner;
    job.updatedAt = now;
    return true;
  }

  async reapExpiredLeases(now: Date = new Date()): Promise<number> {
    let reaped = 0;
    for (const job of this.jobs.values()) {
      if (
        job.status === 'running' &&
        job.leasedUntil !== undefined &&
        job.leasedUntil.getTime() <= now.getTime()
      ) {
        job.status = 'ready';
        delete job.leasedUntil;
        delete job.leaseOwner;
        job.updatedAt = now;
        reaped += 1;
      }
    }
    return reaped;
  }

  snapshot(): DurableTaskJob[] {
    return [...this.jobs.values()].map(readonlyJob);
  }
}

interface MutableDurableTaskJob {
  id: string;
  task: string;
  args: unknown;
  runAt: Date;
  key?: string;
  status: DurableTaskJobStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  leasedUntil?: Date;
  leaseOwner?: string;
  lastError?: string;
}

const taskQueueSql = {
  enqueueUnkeyed: `insert into _kovo_jobs (
  id, task_key, args, logical_key, status, attempts, run_at, created_at, updated_at
) values ($1, $2, $3::jsonb, $4, 'ready', 0, $5, $6, $6)
returning id`,
  enqueueDebounce: `insert into _kovo_jobs (
  id, task_key, args, logical_key, status, attempts, run_at, created_at, updated_at
) values ($1, $2, $3::jsonb, $4, 'ready', 0, $5, $6, $6)
on conflict (task_key, logical_key) where status = 'ready' and logical_key is not null
do update set args = excluded.args, run_at = excluded.run_at, updated_at = excluded.updated_at
returning id`,
  enqueueThrottle: `insert into _kovo_jobs (
  id, task_key, args, logical_key, status, attempts, run_at, created_at, updated_at
) values ($1, $2, $3::jsonb, $4, 'ready', 0, $5, $6, $6)
on conflict (task_key, logical_key) where status = 'ready' and logical_key is not null
do update set updated_at = _kovo_jobs.updated_at
returning id`,
  cancelReady: `update _kovo_jobs
set status = 'cancelled', cancelled_at = $2, updated_at = $2
where id = $1 and status = 'ready'`,
  claimDue: `with claimed as (
  select id from _kovo_jobs
  where status = 'ready' and run_at <= $1
  order by run_at asc, created_at asc
  for update skip locked
  limit $2
)
update _kovo_jobs
set status = 'running',
  attempts = attempts + 1,
  lease_owner = $3,
  leased_until = $4,
  updated_at = $1
where id in (select id from claimed)
returning id, task_key, args, run_at, logical_key, status, attempts, created_at, updated_at,
  leased_until, lease_owner, last_error`,
  markSucceeded: `update _kovo_jobs
set status = 'succeeded',
  completed_at = $2,
  leased_until = null,
  lease_owner = null,
  updated_at = $2
where id = $1 and status = 'running'`,
  markFailed: `update _kovo_jobs
set status = 'failed',
  last_error = $2,
  leased_until = null,
  lease_owner = null,
  updated_at = $3
where id = $1 and status = 'running'`,
  reapExpiredLeases: `update _kovo_jobs
set status = 'ready',
  leased_until = null,
  lease_owner = null,
  updated_at = $1
where status = 'running' and leased_until <= $1`,
} as const;

function jobFromRow(row: DurableTaskJobRow): DurableTaskJob {
  return {
    id: row.id,
    task: row.task_key,
    args: row.args,
    runAt: dateFrom(row.run_at),
    status: row.status,
    attempts: row.attempts,
    createdAt: dateFrom(row.created_at),
    updatedAt: dateFrom(row.updated_at),
    ...(row.logical_key === null ? {} : { key: row.logical_key }),
    ...(row.leased_until === null ? {} : { leasedUntil: dateFrom(row.leased_until) }),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
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
  if (Array.isArray(result)) return { rows: result as readonly Row[] };
  if (!isRecord(result)) return { rows: [] };

  const rows = Array.isArray(result.rows) ? (result.rows as readonly Row[]) : [];
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
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function readonlyJob(job: MutableDurableTaskJob): DurableTaskJob {
  return {
    id: job.id,
    task: job.task,
    args: cloneJson(job.args),
    runAt: copyDate(job.runAt),
    status: job.status,
    attempts: job.attempts,
    createdAt: copyDate(job.createdAt),
    updatedAt: copyDate(job.updatedAt),
    ...(job.key === undefined ? {} : { key: job.key }),
    ...(job.leasedUntil === undefined ? {} : { leasedUntil: copyDate(job.leasedUntil) }),
    ...(job.leaseOwner === undefined ? {} : { leaseOwner: job.leaseOwner }),
    ...(job.lastError === undefined ? {} : { lastError: job.lastError }),
  };
}

function dateFrom(value: Date | string): Date {
  return value instanceof Date ? copyDate(value) : new Date(value);
}

function copyDate(value: Date): Date {
  return new Date(value.getTime());
}

function assertJsonSerializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (error) {
    throw new TypeError(`Durable task args must be JSON-serializable: ${errorMessage(error)}`);
  }
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function createJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
