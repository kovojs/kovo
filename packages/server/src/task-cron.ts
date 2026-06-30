import type { TaskDefinition } from './task.js';
import type {
  DurableTaskQueueStore,
  DurableTaskSqlExecutor,
  DurableTaskSqlStatement,
} from './task-queue.js';

export const DEFAULT_TASK_CRON_BACKFILL_LIMIT = 16;
export const KOVO_TASK_CRON_OCCURRENCES_TABLE_SQL: readonly DurableTaskSqlStatement[] = [
  {
    text: `create table if not exists _kovo_task_cron_occurrences (
  cron_name text not null,
  occurrence_ts timestamptz not null,
  job_id text null,
  created_at timestamptz not null default now(),
  primary key (cron_name, occurrence_ts)
)`,
    values: [],
  },
];

export interface RecurringTaskMaterializeOptions {
  readonly backfillLimit?: number;
  readonly now?: Date;
}

export interface RecurringTaskMaterializeResult {
  readonly enqueued: number;
  readonly occurrences: readonly Date[];
}

export interface RecurringTaskMaterializer {
  materializeDue(
    options?: RecurringTaskMaterializeOptions,
  ): Promise<RecurringTaskMaterializeResult>;
}

export function createRecurringTaskMaterializer(options: {
  readonly store: DurableTaskQueueStore;
  readonly tasks:
    | Iterable<TaskDefinition<string, any, any>>
    | Record<string, TaskDefinition<string, any, any>>;
  readonly occurrenceStore?: RecurringTaskOccurrenceStore;
}): RecurringTaskMaterializer {
  const tasks = recurringTasks(options.tasks);
  const occurrenceStore = options.occurrenceStore ?? new MemoryRecurringTaskOccurrenceStore();

  return {
    async materializeDue(materializeOptions = {}) {
      const now = materializeOptions.now ?? (await occurrenceStore.currentTime?.()) ?? new Date();
      const backfillLimit = boundedBackfillLimit(materializeOptions.backfillLimit);
      let enqueued = 0;
      const occurrences: Date[] = [];

      for (const task of tasks) {
        const due = dueOccurrences(task, now, backfillLimit);
        for (const occurrence of due) {
          const inserted = await occurrenceStore.reserve(task.key, occurrence);
          if (!inserted) continue;
          const handle = await options.store.enqueue({
            task: task.key,
            args: task.cronArgs ?? {},
            runAt: occurrence,
            key: occurrenceKey(task.key, occurrence),
            coalesce: 'throttle',
          });
          await occurrenceStore.bindJob(task.key, occurrence, handle.id);
          enqueued += 1;
          occurrences.push(occurrence);
        }
      }

      return { enqueued, occurrences };
    },
  };
}

export interface RecurringTaskOccurrenceStore {
  bindJob(cronName: string, occurrenceTs: Date, jobId: string): Promise<void>;
  currentTime?(): Promise<Date>;
  reserve(cronName: string, occurrenceTs: Date): Promise<boolean>;
}

export class MemoryRecurringTaskOccurrenceStore implements RecurringTaskOccurrenceStore {
  private readonly occurrences = new Set<string>();
  private readonly jobs = new Map<string, string>();

  async currentTime(): Promise<Date> {
    return new Date();
  }

  async reserve(cronName: string, occurrenceTs: Date): Promise<boolean> {
    const key = occurrenceKey(cronName, occurrenceTs);
    if (this.occurrences.has(key)) return false;
    this.occurrences.add(key);
    return true;
  }

  async bindJob(cronName: string, occurrenceTs: Date, jobId: string): Promise<void> {
    this.jobs.set(occurrenceKey(cronName, occurrenceTs), jobId);
  }

  snapshot(): readonly { cronName: string; jobId?: string; occurrenceTs: Date }[] {
    return [...this.occurrences].map((key) => {
      const [cronName, iso] = splitOccurrenceKey(key);
      return {
        cronName,
        occurrenceTs: new Date(iso),
        ...(this.jobs.has(key) ? { jobId: this.jobs.get(key)! } : {}),
      };
    });
  }
}

export class PostgresRecurringTaskOccurrenceStore implements RecurringTaskOccurrenceStore {
  constructor(private readonly executor: DurableTaskSqlExecutor) {}

  async currentTime(): Promise<Date> {
    const result = await this.executor.execute<{ now: Date | string }>(
      sqlStatement('select now() as now', []),
    );
    const value = result.rows[0]?.now;
    if (value === undefined) {
      throw new Error('Recurring task materialization could not read the database clock.');
    }
    return value instanceof Date ? value : new Date(value);
  }

  async reserve(cronName: string, occurrenceTs: Date): Promise<boolean> {
    const result = await this.executor.execute<{ cron_name: string }>(
      sqlStatement(
        `insert into _kovo_task_cron_occurrences (cron_name, occurrence_ts, job_id)
values ($1, $2, null)
on conflict (cron_name, occurrence_ts) do nothing
returning cron_name`,
        [cronName, occurrenceTs],
      ),
    );
    return result.rows.length > 0;
  }

  async bindJob(cronName: string, occurrenceTs: Date, jobId: string): Promise<void> {
    await this.executor.execute(
      sqlStatement(
        `update _kovo_task_cron_occurrences
set job_id = $3
where cron_name = $1 and occurrence_ts = $2 and job_id is null`,
        [cronName, occurrenceTs, jobId],
      ),
    );
  }
}

export function occurrenceKey(cronName: string, occurrenceTs: Date): string {
  return `cron:${cronName}:${occurrenceTs.toISOString()}`;
}

function dueOccurrences(
  task: TaskDefinition<string, any, any> & { cron: string },
  now: Date,
  backfillLimit: number,
): Date[] {
  const schedule = parseCronExpression(task.cron);
  if (task.catchUp === 'backfill') {
    return previousOccurrences(schedule, now, backfillLimit).reverse();
  }
  const occurrence = previousOccurrence(schedule, now);
  return occurrence === undefined ? [] : [occurrence];
}

function recurringTasks(
  tasks:
    | Iterable<TaskDefinition<string, any, any>>
    | Record<string, TaskDefinition<string, any, any>>,
): (TaskDefinition<string, any, any> & { cron: string })[] {
  const taskEntries =
    Symbol.iterator in Object(tasks)
      ? (tasks as Iterable<TaskDefinition<string, any, any>>)
      : Object.values(tasks as Record<string, TaskDefinition<string, any, any>>);
  return [...taskEntries].filter(
    (task): task is TaskDefinition<string, any, any> & { cron: string } =>
      typeof task.cron === 'string',
  );
}

interface CronSchedule {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
}

function parseCronExpression(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new TypeError(
      `task({ cron }) expects a five-field cron expression, got "${expression}".`,
    );
  }
  return {
    minute: parseCronField(fields[0]!, 0, 59, 'minute'),
    hour: parseCronField(fields[1]!, 0, 23, 'hour'),
    dayOfMonth: parseCronField(fields[2]!, 1, 31, 'day of month'),
    month: parseCronField(fields[3]!, 1, 12, 'month'),
    dayOfWeek: parseCronField(fields[4]!, 0, 7, 'day of week'),
  };
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  label: string,
): ReadonlySet<number> {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part.length === 0) throw invalidCronField(field, label);
    const [rangePart, stepPart] = part.split('/');
    if (rangePart === undefined || (stepPart !== undefined && stepPart.length === 0)) {
      throw invalidCronField(field, label);
    }
    const step = stepPart === undefined ? 1 : positiveInteger(stepPart, label);
    const [start, end] =
      rangePart === '*'
        ? [min, max]
        : rangePart.includes('-')
          ? rangePart.split('-').map((value) => integer(value, label))
          : [integer(rangePart, label), integer(rangePart, label)];
    if (start === undefined || end === undefined || start < min || end > max || start > end) {
      throw invalidCronField(field, label);
    }
    for (let value = start; value <= end; value += step) {
      values.add(label === 'day of week' && value === 7 ? 0 : value);
    }
  }
  return values;
}

function previousOccurrences(schedule: CronSchedule, now: Date, limit: number): Date[] {
  const occurrences: Date[] = [];
  let cursor = floorUtcMinute(now);
  const earliest = new Date(cursor.getTime() - 366 * 24 * 60 * 60_000);

  while (occurrences.length < limit && cursor >= earliest) {
    if (matchesCron(schedule, cursor)) occurrences.push(new Date(cursor));
    cursor = new Date(cursor.getTime() - 60_000);
  }
  return occurrences;
}

function previousOccurrence(schedule: CronSchedule, now: Date): Date | undefined {
  return previousOccurrences(schedule, now, 1)[0];
}

function matchesCron(schedule: CronSchedule, value: Date): boolean {
  return (
    schedule.minute.has(value.getUTCMinutes()) &&
    schedule.hour.has(value.getUTCHours()) &&
    schedule.dayOfMonth.has(value.getUTCDate()) &&
    schedule.month.has(value.getUTCMonth() + 1) &&
    schedule.dayOfWeek.has(value.getUTCDay())
  );
}

function floorUtcMinute(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
    ),
  );
}

function boundedBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TASK_CRON_BACKFILL_LIMIT;
  if (!Number.isFinite(value) || value < 1) {
    throw new TypeError('Recurring task backfillLimit must be a positive finite number.');
  }
  return Math.min(DEFAULT_TASK_CRON_BACKFILL_LIMIT, Math.floor(value));
}

function positiveInteger(value: string, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 1) throw invalidCronField(value, label);
  return parsed;
}

function integer(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw invalidCronField(value, label);
  return Number(value);
}

function invalidCronField(field: string, label: string): TypeError {
  return new TypeError(`Invalid cron ${label} field "${field}".`);
}

function sqlStatement(text: string, values: readonly unknown[]): DurableTaskSqlStatement {
  return { text, values };
}

function splitOccurrenceKey(key: string): [string, string] {
  const prefix = 'cron:';
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const index = rest.lastIndexOf(':');
  return [rest.slice(0, index), rest.slice(index + 1)];
}
