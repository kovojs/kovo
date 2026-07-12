import { frameworkEgressFetch } from './egress.js';
import {
  actAsNonRequestPrincipal,
  declareSystemPrincipal,
  type NonRequestPrincipalPosture,
  type PrincipalAccessOperation,
} from './auth-principal.js';
import type {
  TaskDefinition,
  TaskHandle,
  TaskIngressRunOptions,
  TaskPrincipalReadScope,
  TaskPrincipalScope,
  TaskPrincipalWriteScope,
  TaskRunContext,
  TaskScheduleOptions,
} from './task.js';
import type {
  DurableTaskEnqueueInput,
  DurableTaskJob,
  DurableTaskQueueStore,
} from './task-queue.js';
import {
  taskArrayPush,
  taskClearInterval,
  taskClearTimeout,
  taskCreateMap,
  taskCreatePromise,
  taskDateGetTime,
  taskDateNow,
  taskFloor,
  taskInstanceOf,
  taskIsArray,
  taskMapDelete,
  taskMapForEach,
  taskMapGet,
  taskMapSet,
  taskMapSize,
  taskMax,
  taskMin,
  taskNewDate,
  taskNumberIsFinite,
  taskPromiseAll,
  taskPromiseFinally,
  taskPromiseRace,
  taskPromiseResolve,
  taskPromiseThen,
  taskSetInterval,
  taskSetTimeout,
  taskSnapshotCollection,
  taskTimerUnref,
  taskTrunc,
} from './task-security-intrinsics.js';

export interface DurableTaskRunnerHooks {
  readonly fetch?: typeof globalThis.fetch;
  onError?: (error: unknown, context: DurableTaskRunnerErrorContext) => Promise<void> | void;
  runMutation?: (
    definition: Parameters<TaskRunContext['runMutation']>[0],
    input: Parameters<TaskRunContext['runMutation']>[1],
    options: TaskIngressRunOptions,
  ) => Promise<unknown>;
  runQuery?: (
    definition: Parameters<TaskRunContext['runQuery']>[0],
    input: Parameters<TaskRunContext['runQuery']>[1],
    options: TaskIngressRunOptions,
  ) => Promise<unknown>;
}

export interface DurableTaskRunnerErrorContext {
  readonly job: DurableTaskJob;
  readonly phase: 'unknown-task' | 'task-run';
  readonly task?: TaskDefinition<string, any, any>;
}

export interface DurableTaskRunnerOptions {
  readonly store: DurableTaskQueueStore;
  readonly tasks:
    | Iterable<TaskDefinition<string, any, any>>
    | Record<string, TaskDefinition<string, any, any>>;
  readonly batchSize?: number;
  readonly heartbeatIntervalMs?: number;
  readonly hardTimeoutMs?: number;
  readonly leaseMs?: number;
  readonly maxInFlight?: number;
  readonly pollIntervalMs?: number;
  readonly owner?: string;
  readonly selfRescheduleDelayFloorMs?: number;
  readonly hooks?: DurableTaskRunnerHooks;
}

export class UnknownDurableTaskError extends Error {
  constructor(readonly taskKey: string) {
    super(`No durable task is registered for key "${taskKey}".`);
    this.name = 'UnknownDurableTaskError';
  }
}

export class DurableTaskRunner {
  private readonly tasks = taskCreateMap<string, TaskDefinition<string, any, any>>();
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly owner: string;
  private readonly hooks: DurableTaskRunnerHooks;
  private readonly hardTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxInFlight: number;
  private readonly selfRescheduleDelayFloorMs: number;
  private readonly inFlightByTask = taskCreateMap<string, number>();
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private draining: Promise<void> | undefined;

  constructor(private readonly options: DurableTaskRunnerOptions) {
    const taskEntries = taskSnapshotCollection(options.tasks, 'Durable task registry');
    for (let index = 0; index < taskEntries.length; index += 1) {
      const task = taskEntries[index]!;
      if (taskMapGet(this.tasks, task.key) !== undefined) {
        throw new TypeError(`Durable task registry contains duplicate key "${task.key}".`);
      }
      taskMapSet(this.tasks, task.key, task);
    }
    this.batchSize = options.batchSize ?? 5;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.hardTimeoutMs = options.hardTimeoutMs ?? 300_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? taskMax(100, this.leaseMs / 2);
    this.maxInFlight = taskMax(
      1,
      taskMin(taskFloor(options.maxInFlight ?? this.batchSize), this.batchSize),
    );
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.owner = options.owner ?? 'kovo-task-runner';
    this.selfRescheduleDelayFloorMs = options.selfRescheduleDelayFloorMs ?? 1000;
    this.hooks = options.hooks ?? {};
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleTick(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      taskClearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.draining;
  }

  async runOnce(now: Date = taskNewDate()): Promise<DurableTaskJob[]> {
    await this.options.store.reapExpiredLeases(now);
    const jobs = await this.claimAvailable(now);
    const running: Promise<void>[] = [];
    for (let index = 0; index < jobs.length; index += 1) {
      taskArrayPush(running, this.runTrackedJob(jobs[index]!));
    }
    await taskPromiseAll(running);
    return jobs;
  }

  private async claimAvailable(now: Date): Promise<DurableTaskJob[]> {
    const claimed: DurableTaskJob[] = [];
    while (claimed.length < this.batchSize && this.inFlight + claimed.length < this.maxInFlight) {
      const taskKeys = this.claimableTaskKeys(claimed);
      if (taskMapSize(this.tasks) > 0 && taskKeys.length === 0) break;
      const jobs = await this.options.store.claimDue({
        limit: 1,
        leaseMs: this.leaseMs,
        now,
        owner: this.owner,
        ...(taskKeys.length === 0 ? {} : { taskKeys }),
      });
      if (jobs.length === 0) break;
      taskArrayPush(claimed, jobs[0]!);
    }
    return claimed;
  }

  private claimableTaskKeys(pending: readonly DurableTaskJob[]): string[] {
    const pendingByTask = taskCreateMap<string, number>();
    for (let index = 0; index < pending.length; index += 1) {
      const job = pending[index]!;
      taskMapSet(pendingByTask, job.task, (taskMapGet(pendingByTask, job.task) ?? 0) + 1);
    }
    const keys: string[] = [];
    taskMapForEach(this.tasks, (task, key) => {
      const cap = taskConcurrency(task);
      const current =
        (taskMapGet(this.inFlightByTask, key) ?? 0) + (taskMapGet(pendingByTask, key) ?? 0);
      if (current < cap) taskArrayPush(keys, key);
    });
    return keys;
  }

  private async runTrackedJob(job: DurableTaskJob): Promise<void> {
    this.inFlight += 1;
    taskMapSet(
      this.inFlightByTask,
      job.task,
      (taskMapGet(this.inFlightByTask, job.task) ?? 0) + 1,
    );
    let releaseWhenSettled: Promise<void> = taskPromiseResolve(undefined);
    try {
      releaseWhenSettled = (await this.runJob(job)).releaseWhenSettled;
    } finally {
      void taskPromiseFinally(releaseWhenSettled, () => this.releaseInFlight(job.task));
    }
  }

  private releaseInFlight(taskKey: string): void {
    this.inFlight -= 1;
    const remaining = (taskMapGet(this.inFlightByTask, taskKey) ?? 1) - 1;
    if (remaining <= 0) taskMapDelete(this.inFlightByTask, taskKey);
    else taskMapSet(this.inFlightByTask, taskKey, remaining);
  }

  private scheduleTick(delayMs: number): void {
    this.timer = taskSetTimeout(() => {
      this.timer = undefined;
      const drained = taskPromiseThen(
        this.runOnce(),
        () => undefined,
        () => {
          // Individual job failures are persisted by runJob; loop-level errors should not kill the runner.
        },
      );
      this.draining = taskPromiseFinally(drained, () => {
          this.draining = undefined;
          if (!this.stopped) this.scheduleTick(this.pollIntervalMs);
      });
    }, delayMs);
    taskTimerUnref(this.timer);
  }

  private async runJob(job: DurableTaskJob): Promise<{ releaseWhenSettled: Promise<void> }> {
    const task = taskMapGet(this.tasks, job.task);
    if (task === undefined) {
      const error = new UnknownDurableTaskError(job.task);
      await this.options.store.markFailed(job.id, error, {
        ...completionOptions(job),
        maxAttempts: 1,
      });
      await this.reportError(error, { job, phase: 'unknown-task' });
      return { releaseWhenSettled: taskPromiseResolve(undefined) };
    }

    let bodySettled: Promise<void> = taskPromiseResolve(undefined);
    try {
      const args = task.input.parse(job.args);
      const result = await this.runWithDeadline(job, task, args);
      bodySettled = result.bodySettled;
      await this.options.store.markSucceeded(job.id, completionOptions(job));
    } catch (error) {
      if (isDurableTaskTimeoutError(error)) bodySettled = error.bodySettled;
      await this.options.store.markFailed(job.id, error, {
        ...completionOptions(job),
        maxAttempts: taskMaxAttempts(task),
        retryAt: retryRunAt(job, task),
      });
      await this.reportError(error, { job, phase: 'task-run', task });
    }
    return { releaseWhenSettled: bodySettled };
  }

  private async reportError(error: unknown, context: DurableTaskRunnerErrorContext): Promise<void> {
    try {
      await this.hooks.onError?.(error, context);
    } catch (_diagnosticError) {
      void _diagnosticError;
      // Task diagnostics must not kill the runner loop or hide persisted job state.
    }
  }

  private async runWithDeadline(
    job: DurableTaskJob,
    task: TaskDefinition<string, any, any>,
    args: unknown,
  ): Promise<{ bodySettled: Promise<void> }> {
    const timeoutMs = taskTimeoutMs(task, this.leaseMs, this.hardTimeoutMs);
    let settled = false;
    const heartbeat = taskSetInterval(
      () => {
        if (settled) return;
        const now = taskNewDate();
        void this.options.store.heartbeat(job.id, {
          ...completionOptions(job),
          leaseMs: taskMin(this.leaseMs, timeoutMs),
          now,
        });
      },
      taskMin(this.heartbeatIntervalMs, timeoutMs),
    );
    taskTimerUnref(heartbeat);

    const bodyPromise = taskPromiseThen(taskPromiseResolve(undefined), () =>
      task.run(args, this.createContext(job)),
    );
    const bodySettled = taskPromiseThen(
      bodyPromise,
      () => undefined,
      () => undefined,
    );

    try {
      const timeoutMessage = `Durable task "${task.key}" exceeded timeoutMs ${timeoutMs}.`;
      await withTimeout(
        bodyPromise,
        timeoutMs,
        timeoutMessage,
        () => new DurableTaskTimeoutError(timeoutMessage, bodySettled),
      );
      return { bodySettled };
    } finally {
      settled = true;
      taskClearInterval(heartbeat);
    }
  }

  private createContext(job: DurableTaskJob): TaskRunContext {
    const runMutation = this.hooks.runMutation;
    const runQuery = this.hooks.runQuery;
    return {
      jobId: job.id,
      idempotencyKey: job.id,
      fetch: this.hooks.fetch ?? frameworkEgressFetch,
      actAs: (principalId: string): TaskPrincipalScope =>
        this.createPrincipalScope(
          job,
          actAsNonRequestPrincipal(principalId, taskPrincipalAudit(job, 'read')),
          actAsNonRequestPrincipal(principalId, taskPrincipalAudit(job, 'write')),
          runQuery,
          runMutation,
        ),
      declareSystemRead: (reason: string): TaskPrincipalReadScope =>
        this.createPrincipalScope(
          job,
          declareSystemPrincipal(reason, taskPrincipalAudit(job, 'read')),
          undefined,
          runQuery,
          runMutation,
        ),
      declareSystemWrite: (reason: string): TaskPrincipalWriteScope =>
        this.createPrincipalScope(
          job,
          undefined,
          declareSystemPrincipal(reason, taskPrincipalAudit(job, 'write')),
          runQuery,
          runMutation,
        ),
      runMutation: async () => {
        throw missingTaskPrincipalPostureError(job, 'write');
      },
      runQuery: async () => {
        throw missingTaskPrincipalPostureError(job, 'read');
      },
      schedule: async (definition, args, options?: TaskScheduleOptions): Promise<TaskHandle> => {
        // SPEC §9.6: task-body scheduling has one chokepoint. Registry checks, lineage,
        // maxGenerations, and the self-reschedule delay floor are computed here before any queue
        // write, so runtime hooks cannot replace the backstopped ctx.schedule contract.
        return this.options.store.enqueue(
          durableTaskScheduleInput({
            args,
            definition,
            options,
            parent: job,
            registeredTasks: this.tasks,
            selfRescheduleDelayFloorMs: this.selfRescheduleDelayFloorMs,
          }),
        );
      },
    };
  }

  private createPrincipalScope(
    job: DurableTaskJob,
    readPosture: NonRequestPrincipalPosture | undefined,
    writePosture: NonRequestPrincipalPosture | undefined,
    runQuery: DurableTaskRunnerHooks['runQuery'],
    runMutation: DurableTaskRunnerHooks['runMutation'],
  ): TaskPrincipalScope {
    return {
      runMutation: async (definition, input) => {
        if (writePosture === undefined) throw missingTaskPrincipalPostureError(job, 'write');
        if (runMutation === undefined) {
          throw new Error('Task runner runMutation hook is not configured.');
        }
        return runMutation(definition, input, { principalPosture: writePosture });
      },
      runQuery: async (definition, input) => {
        if (readPosture === undefined) throw missingTaskPrincipalPostureError(job, 'read');
        if (runQuery === undefined) {
          throw new Error('Task runner runQuery hook is not configured.');
        }
        return runQuery(definition, input, { principalPosture: readPosture });
      },
    };
  }
}

export function createDurableTaskRunner(options: DurableTaskRunnerOptions): DurableTaskRunner {
  return new DurableTaskRunner(options);
}

function taskPrincipalAudit(
  job: DurableTaskJob,
  operation: PrincipalAccessOperation,
): Parameters<typeof actAsNonRequestPrincipal>[1] {
  return {
    ingress: 'task',
    operation,
    surface: `${job.task}:${job.id}`,
  };
}

function missingTaskPrincipalPostureError(
  job: DurableTaskJob,
  operation: PrincipalAccessOperation,
): Error {
  return new Error(
    `Durable task "${job.task}" attempted ${operation} owner-table access without actAs(id) or declareSystem${operation === 'read' ? 'Read' : 'Write'}(reason). SPEC §10.3 DEC-G requires an explicit non-request principal posture.`,
  );
}

export function durableTaskScheduleInput(input: {
  readonly args: unknown;
  readonly definition: TaskDefinition<string, any, any>;
  readonly options: TaskScheduleOptions | undefined;
  readonly parent?: DurableTaskJob | undefined;
  readonly registeredTasks:
    | ReadonlyMap<string, TaskDefinition<string, any, any>>
    | ReadonlyArray<TaskDefinition<string, any, any>>;
  readonly selfRescheduleDelayFloorMs?: number | undefined;
}): DurableTaskEnqueueInput {
  let registered = false;
  if (taskIsArray(input.registeredTasks)) {
    for (let index = 0; index < input.registeredTasks.length; index += 1) {
      const task = input.registeredTasks[index];
      if (
        task !== undefined &&
        task.key === input.definition.key &&
        (task === input.definition || task.run === input.definition.run)
      ) {
        registered = true;
        break;
      }
    }
  } else {
    const task = taskMapGet(
      input.registeredTasks as Map<string, TaskDefinition<string, any, any>>,
      input.definition.key,
    );
    registered =
      task !== undefined &&
      task.key === input.definition.key &&
      (task === input.definition || task.run === input.definition.run);
  }
  if (!registered) throw new UnknownDurableTaskError(input.definition.key);

  const runAt = scheduleRunAt(input.options);
  const parent = input.parent;
  return {
    task: input.definition.key,
    args: input.args,
    runAt:
      parent === undefined
        ? runAt
        : selfRescheduleRunAt(parent, input.definition.key, runAt, input.options, {
            delayFloorMs: input.selfRescheduleDelayFloorMs ?? 1000,
          }),
    ...(parent === undefined
      ? {}
      : {
          generation: parent.generation + 1,
          lineage: parent.lineage,
          ...generationStatus(parent, input.definition),
        }),
    ...(input.definition.priority === undefined ? {} : { priority: input.definition.priority }),
    ...(input.options?.key === undefined ? {} : { key: input.options.key }),
    ...(input.options?.coalesce === undefined ? {} : { coalesce: input.options.coalesce }),
  };
}

class DurableTaskTimeoutError extends Error {
  constructor(
    message: string,
    readonly bodySettled: Promise<void>,
  ) {
    super(message);
    this.name = 'DurableTaskTimeoutError';
  }
}

function isDurableTaskTimeoutError(error: unknown): error is DurableTaskTimeoutError {
  return taskInstanceOf(error, DurableTaskTimeoutError);
}

function scheduleRunAt(options: TaskScheduleOptions | undefined): Date {
  if (options?.afterMs !== undefined && options.at !== undefined) {
    throw new TypeError('Task schedule options cannot specify both afterMs and at.');
  }
  if (options?.afterMs !== undefined) return taskNewDate(taskDateNow() + options.afterMs);
  if (options?.at !== undefined) return taskNewDate(options.at);
  return taskNewDate();
}

function completionOptions(job: DurableTaskJob): {
  leaseOwner?: string;
  leaseToken?: string;
} {
  return {
    ...(job.leaseOwner === undefined ? {} : { leaseOwner: job.leaseOwner }),
    ...(job.leaseToken === undefined ? {} : { leaseToken: job.leaseToken }),
  };
}

function taskMaxAttempts(task: TaskDefinition<string, any, any>): number {
  return taskMax(1, taskTrunc(task.retry?.maxAttempts ?? 1));
}

function retryRunAt(job: DurableTaskJob, task: TaskDefinition<string, any, any>): Date {
  const attempt = taskMax(1, job.attempts);
  const baseMs = 1000;
  const delayMs =
    task.retry?.backoff === 'linear'
      ? baseMs * attempt
      : task.retry?.backoff === 'exponential'
        ? baseMs * 2 ** (attempt - 1)
        : baseMs;
  return taskNewDate(taskDateNow() + delayMs);
}

function taskTimeoutMs(
  task: TaskDefinition<string, any, any>,
  leaseMs: number,
  hardTimeoutMs: number,
): number {
  const requested = task.timeoutMs ?? leaseMs;
  if (!taskNumberIsFinite(requested) || requested <= 0) return taskMin(leaseMs, hardTimeoutMs);
  return taskMax(1, taskMin(taskTrunc(requested), hardTimeoutMs));
}

function taskConcurrency(task: TaskDefinition<string, any, any>): number {
  const concurrency = task.concurrency;
  if (concurrency === undefined || !taskNumberIsFinite(concurrency)) return Infinity;
  return taskMax(1, taskTrunc(concurrency));
}

function generationStatus(
  parent: DurableTaskJob,
  definition: TaskDefinition<string, any, any>,
): { status?: 'dead'; lastError?: string } {
  const nextGeneration = parent.generation + 1;
  const maxGenerations = taskMax(0, taskTrunc(definition.maxGenerations ?? 64));
  if (nextGeneration <= maxGenerations) return {};
  return {
    lastError: `Durable task lineage "${parent.lineage}" exceeded maxGenerations ${maxGenerations}.`,
    status: 'dead',
  };
}

function selfRescheduleRunAt(
  parent: DurableTaskJob,
  childTaskKey: string,
  runAt: Date,
  options: TaskScheduleOptions | undefined,
  config: { delayFloorMs: number },
): Date {
  if (parent.task !== childTaskKey || options?.afterMs === undefined) return runAt;
  const floor = taskMax(0, taskTrunc(config.delayFloorMs));
  const minimum = taskNewDate(taskDateNow() + floor);
  return taskDateGetTime(runAt) >= taskDateGetTime(minimum) ? runAt : minimum;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  createTimeoutError: () => Error = () => new Error(message),
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = taskCreatePromise<never>((_, reject) => {
    timeout = taskSetTimeout(() => reject(createTimeoutError()), timeoutMs);
    taskTimerUnref(timeout);
  });
  try {
    return await taskPromiseRace([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) taskClearTimeout(timeout);
  }
}
