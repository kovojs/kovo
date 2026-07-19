import type { TaskDefinition } from './task.js';
import { frameworkScopedKey } from '@kovojs/core/internal/storage';
import type {
  DurableTaskQueueStore,
  DurableTaskSqlExecutor,
  DurableTaskSqlStatement,
} from './task-queue.js';
import {
  taskArrayPush,
  taskArrayReverse,
  taskCreateMap,
  taskCreateSet,
  taskDateGetTime,
  taskDateIsDate,
  taskDateParts,
  taskDateToISOString,
  taskDateUtc,
  taskFloor,
  taskMapGet,
  taskMapHas,
  taskMapSet,
  taskMin,
  taskNewDate,
  taskNumber,
  taskNumberIsFinite,
  taskRegExpTest,
  taskSetAdd,
  taskSetForEach,
  taskSetHas,
  taskSetSize,
  taskSnapshotCollection,
  taskStringIncludes,
  taskStringLastIndexOf,
  taskStringSlice,
  taskStringSplit,
  taskStringStartsWith,
  taskStringTrim,
} from './task-security-intrinsics.js';

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

export async function ensureRecurringTaskSchema(executor: DurableTaskSqlExecutor): Promise<void> {
  for (let index = 0; index < KOVO_TASK_CRON_OCCURRENCES_TABLE_SQL.length; index += 1) {
    await executor.execute(KOVO_TASK_CRON_OCCURRENCES_TABLE_SQL[index]!);
  }
}

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
      const now =
        materializeOptions.now ?? (await occurrenceStore.currentTime?.()) ?? taskNewDate();
      const backfillLimit = boundedBackfillLimit(materializeOptions.backfillLimit);
      let enqueued = 0;
      const occurrences: Date[] = [];

      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
        const task = tasks[taskIndex]!;
        const due = dueOccurrences(task, now, backfillLimit);
        for (let dueIndex = 0; dueIndex < due.length; dueIndex += 1) {
          const occurrence = due[dueIndex]!;
          const inserted = await occurrenceStore.reserve(task.key, occurrence);
          if (!inserted) continue;
          const handle = await options.store.enqueue({
            task: task.key,
            args: task.cronArgs ?? {},
            runAt: occurrence,
            key: frameworkScopedKey('durable-task-cron', occurrenceKey(task.key, occurrence)),
            coalesce: 'throttle',
          });
          await occurrenceStore.bindJob(task.key, occurrence, handle.id);
          enqueued += 1;
          taskArrayPush(occurrences, occurrence);
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
  private readonly occurrences = taskCreateSet<string>();
  private readonly jobs = taskCreateMap<string, string>();

  async currentTime(): Promise<Date> {
    return taskNewDate();
  }

  async reserve(cronName: string, occurrenceTs: Date): Promise<boolean> {
    const key = occurrenceKey(cronName, occurrenceTs);
    if (taskSetHas(this.occurrences, key)) return false;
    taskSetAdd(this.occurrences, key);
    return true;
  }

  async bindJob(cronName: string, occurrenceTs: Date, jobId: string): Promise<void> {
    taskMapSet(this.jobs, occurrenceKey(cronName, occurrenceTs), jobId);
  }

  snapshot(): readonly { cronName: string; jobId?: string; occurrenceTs: Date }[] {
    const snapshots: { cronName: string; jobId?: string; occurrenceTs: Date }[] = [];
    taskSetForEach(this.occurrences, (key) => {
      const keyParts = splitOccurrenceKey(key);
      const cronName = keyParts[0];
      const iso = keyParts[1];
      taskArrayPush(snapshots, {
        cronName,
        occurrenceTs: taskNewDate(iso),
        ...(taskMapHas(this.jobs, key) ? { jobId: taskMapGet(this.jobs, key)! } : {}),
      });
    });
    return snapshots;
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
    return taskDateIsDate(value) ? value : taskNewDate(value);
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
  return `cron:${cronName}:${taskDateToISOString(occurrenceTs)}`;
}

function dueOccurrences(
  task: TaskDefinition<string, any, any> & { cron: string },
  now: Date,
  backfillLimit: number,
): Date[] {
  const schedule = parseCronExpression(task.cron);
  if (task.catchUp === 'backfill') {
    return taskArrayReverse(previousOccurrences(schedule, now, backfillLimit));
  }
  const occurrence = previousOccurrence(schedule, now);
  return occurrence === undefined ? [] : [occurrence];
}

function recurringTasks(
  tasks:
    | Iterable<TaskDefinition<string, any, any>>
    | Record<string, TaskDefinition<string, any, any>>,
): (TaskDefinition<string, any, any> & { cron: string })[] {
  const taskEntries = taskSnapshotCollection(tasks, 'Recurring task registry');
  const recurring: (TaskDefinition<string, any, any> & { cron: string })[] = [];
  for (let index = 0; index < taskEntries.length; index += 1) {
    const task = taskEntries[index]!;
    if (typeof task.cron === 'string') {
      taskArrayPush(recurring, task as TaskDefinition<string, any, any> & { cron: string });
    }
  }
  return recurring;
}

interface CronSchedule {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly dayOfMonthUnrestricted: boolean;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
  readonly dayOfWeekUnrestricted: boolean;
}

export function validateCronExpression(expression: string): void {
  parseCronExpression(expression);
}

function parseCronExpression(expression: string): CronSchedule {
  const fields = taskStringSplit(taskStringTrim(expression), /\s+/);
  if (fields.length !== 5) {
    throw new TypeError(
      `task({ cron }) expects a five-field cron expression, got "${expression}".`,
    );
  }
  return {
    minute: parseCronField(fields[0]!, 0, 59, 'minute'),
    hour: parseCronField(fields[1]!, 0, 23, 'hour'),
    dayOfMonth: parseCronField(fields[2]!, 1, 31, 'day of month'),
    dayOfMonthUnrestricted: isUnrestrictedCronField(fields[2]!, 1, 31, 'day of month'),
    month: parseCronField(fields[3]!, 1, 12, 'month'),
    dayOfWeek: parseCronField(fields[4]!, 0, 7, 'day of week'),
    dayOfWeekUnrestricted: isUnrestrictedCronField(fields[4]!, 0, 7, 'day of week'),
  };
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  label: string,
): ReadonlySet<number> {
  const values = taskCreateSet<number>();
  const parts = taskStringSplit(field, ',');
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]!;
    if (part.length === 0) throw invalidCronField(field, label);
    const slashParts = taskStringSplit(part, '/');
    const rangePart = slashParts[0];
    const stepPart = slashParts[1];
    if (rangePart === undefined || (stepPart !== undefined && stepPart.length === 0)) {
      throw invalidCronField(field, label);
    }
    const step = stepPart === undefined ? 1 : positiveInteger(stepPart, label);
    const range =
      rangePart === '*'
        ? [min, max]
        : taskStringIncludes(rangePart, '-')
          ? parseCronRange(rangePart, label)
          : [integer(rangePart, label), stepPart === undefined ? integer(rangePart, label) : max];
    const start = range[0];
    const end = range[1];
    if (start === undefined || end === undefined || start < min || end > max || start > end) {
      throw invalidCronField(field, label);
    }
    for (let value = start; value <= end; value += step) {
      taskSetAdd(values, label === 'day of week' && value === 7 ? 0 : value);
    }
  }
  return values;
}

function previousOccurrences(schedule: CronSchedule, now: Date, limit: number): Date[] {
  const occurrences: Date[] = [];
  let cursor = floorUtcMinute(now);
  const earliest = taskNewDate(taskDateGetTime(cursor) - 366 * 24 * 60 * 60_000);

  while (occurrences.length < limit && taskDateGetTime(cursor) >= taskDateGetTime(earliest)) {
    if (matchesCron(schedule, cursor)) taskArrayPush(occurrences, taskNewDate(cursor));
    cursor = taskNewDate(taskDateGetTime(cursor) - 60_000);
  }
  return occurrences;
}

function previousOccurrence(schedule: CronSchedule, now: Date): Date | undefined {
  return previousOccurrences(schedule, now, 1)[0];
}

function matchesCron(schedule: CronSchedule, value: Date): boolean {
  const parts = taskDateParts(value);
  const dayOfMonthMatches = taskSetHas(schedule.dayOfMonth as Set<number>, parts.date);
  const dayOfWeekMatches = taskSetHas(schedule.dayOfWeek as Set<number>, parts.day);
  const dayMatches =
    schedule.dayOfMonthUnrestricted && schedule.dayOfWeekUnrestricted
      ? true
      : schedule.dayOfMonthUnrestricted
        ? dayOfWeekMatches
        : schedule.dayOfWeekUnrestricted
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches;

  return (
    taskSetHas(schedule.minute as Set<number>, parts.minutes) &&
    taskSetHas(schedule.hour as Set<number>, parts.hours) &&
    taskSetHas(schedule.month as Set<number>, parts.month + 1) &&
    dayMatches
  );
}

function floorUtcMinute(value: Date): Date {
  const parts = taskDateParts(value);
  return taskNewDate(
    taskDateUtc(parts.fullYear, parts.month, parts.date, parts.hours, parts.minutes),
  );
}

function boundedBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TASK_CRON_BACKFILL_LIMIT;
  if (!taskNumberIsFinite(value) || value < 1) {
    throw new TypeError('Recurring task backfillLimit must be a positive finite number.');
  }
  return taskMin(DEFAULT_TASK_CRON_BACKFILL_LIMIT, taskFloor(value));
}

function positiveInteger(value: string, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 1) throw invalidCronField(value, label);
  return parsed;
}

function integer(value: string, label: string): number {
  if (!taskRegExpTest(/^\d+$/, value)) throw invalidCronField(value, label);
  return taskNumber(value);
}

function invalidCronField(field: string, label: string): TypeError {
  return new TypeError(`Invalid cron ${label} field "${field}".`);
}

function isUnrestrictedCronField(field: string, min: number, max: number, label: string): boolean {
  const values = parseCronField(field, min, max, label);
  const normalizedMax = label === 'day of week' ? 6 : max;
  return taskSetSize(values as Set<number>) === normalizedMax - min + 1;
}

function sqlStatement(text: string, values: readonly unknown[]): DurableTaskSqlStatement {
  return { text, values };
}

function splitOccurrenceKey(key: string): [string, string] {
  const prefix = 'cron:';
  const rest = taskStringStartsWith(key, prefix) ? taskStringSlice(key, prefix.length) : key;
  const index = taskStringLastIndexOf(rest, ':');
  return [taskStringSlice(rest, 0, index), taskStringSlice(rest, index + 1)];
}

function parseCronRange(value: string, label: string): [number, number] {
  const values = taskStringSplit(value, '-');
  if (values.length !== 2) throw invalidCronField(value, label);
  return [integer(values[0]!, label), integer(values[1]!, label)];
}
