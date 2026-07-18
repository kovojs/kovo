import { frameworkEgressFetch } from './egress.js';
import { assertAndCloneJsonValue } from '@kovojs/core/internal/json';
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
  taskApply,
  taskClearInterval,
  taskClearTimeout,
  taskCreateMap,
  taskCreatePromise,
  taskDateGetTime,
  taskDateIsDate,
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
  taskNumberIsSafeInteger,
  taskOptionalOwnDataValue,
  taskObjectKeys,
  taskOwnDataValue,
  taskPromiseAll,
  taskPromiseFinally,
  taskPromiseRace,
  taskPromiseResolve,
  taskPromiseThen,
  taskSetInterval,
  taskSetTimeout,
  taskSnapshotCollection,
  taskStableOwnFunction,
  taskStringTrim,
  taskFreeze,
  taskTimerUnref,
  taskTrunc,
} from './task-security-intrinsics.js';

export interface DurableTaskRunnerHooks {
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
  private readonly store: DurableTaskQueueStore;
  private readonly inFlightByTask = taskCreateMap<string, number>();
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private draining: Promise<void> | undefined;

  constructor(options: DurableTaskRunnerOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new TypeError('Durable task runner options must be a stable own-data record.');
    }
    const store = taskOwnDataValue(options, 'store');
    const tasks = taskOwnDataValue(options, 'tasks');
    const batchSize = taskOptionalOwnDataValue(options, 'batchSize');
    const heartbeatIntervalMs = taskOptionalOwnDataValue(options, 'heartbeatIntervalMs');
    const hardTimeoutMs = taskOptionalOwnDataValue(options, 'hardTimeoutMs');
    const leaseMs = taskOptionalOwnDataValue(options, 'leaseMs');
    const maxInFlight = taskOptionalOwnDataValue(options, 'maxInFlight');
    const pollIntervalMs = taskOptionalOwnDataValue(options, 'pollIntervalMs');
    const owner = taskOptionalOwnDataValue(options, 'owner');
    const selfRescheduleDelayFloorMs = taskOptionalOwnDataValue(
      options,
      'selfRescheduleDelayFloorMs',
    );
    const hooks = taskOptionalOwnDataValue(options, 'hooks');
    this.store = snapshotDurableTaskRunnerStore(store);
    const taskEntries = taskSnapshotCollection(
      tasks as DurableTaskRunnerOptions['tasks'],
      'Durable task registry',
    );
    for (let index = 0; index < taskEntries.length; index += 1) {
      const task = taskEntries[index]!;
      if (taskMapGet(this.tasks, task.key) !== undefined) {
        throw new TypeError(`Durable task registry contains duplicate key "${task.key}".`);
      }
      taskMapSet(this.tasks, task.key, task);
    }
    this.batchSize = runnerCountOption(batchSize, 5, 'batchSize');
    this.leaseMs = runnerDurationOption(leaseMs, 30_000, 'leaseMs');
    this.hardTimeoutMs = runnerDurationOption(hardTimeoutMs, 300_000, 'hardTimeoutMs');
    this.heartbeatIntervalMs = runnerDurationOption(
      heartbeatIntervalMs,
      taskMax(100, taskFloor(this.leaseMs / 2)),
      'heartbeatIntervalMs',
    );
    this.maxInFlight = taskMax(
      1,
      taskMin(
        taskFloor(runnerCountOption(maxInFlight, this.batchSize, 'maxInFlight')),
        this.batchSize,
      ),
    );
    this.pollIntervalMs = runnerDurationOption(pollIntervalMs, 1000, 'pollIntervalMs', true);
    if (
      owner !== undefined &&
      (typeof owner !== 'string' || taskStringTrim(owner) === '' || owner.length > 1_024)
    ) {
      throw new TypeError('Durable task runner owner must be a non-empty bounded string.');
    }
    this.owner = owner ?? 'kovo-task-runner';
    this.selfRescheduleDelayFloorMs = runnerDurationOption(
      selfRescheduleDelayFloorMs,
      1000,
      'selfRescheduleDelayFloorMs',
      true,
    );
    this.hooks = snapshotDurableTaskRunnerHooks(hooks);
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
    await this.store.reapExpiredLeases(now);
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
      const jobs = await this.store.claimDue({
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
    taskMapSet(this.inFlightByTask, job.task, (taskMapGet(this.inFlightByTask, job.task) ?? 0) + 1);
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
      await this.store.markFailed(job.id, error, {
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
      await this.store.markSucceeded(job.id, completionOptions(job));
    } catch (error) {
      if (isDurableTaskTimeoutError(error)) bodySettled = error.bodySettled;
      await this.store.markFailed(job.id, error, {
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
        void this.store.heartbeat(job.id, {
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
      // SPEC §6.6: task code receives exactly the framework-owned positive egress capability.
      // Runner hooks may adapt persistence/query execution, but cannot replace the network door.
      fetch: frameworkEgressFetch,
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
        return this.store.enqueue(
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

const MAX_RUNNER_COUNT = 100_000;
const MAX_RUNNER_DURATION_MS = 2_147_483_647;

function runnerCountOption(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!taskNumberIsSafeInteger(value) || value < 1 || value > MAX_RUNNER_COUNT) {
    throw new TypeError(
      `Durable task runner ${name} must be a positive integer at most ${MAX_RUNNER_COUNT}.`,
    );
  }
  return value;
}

function runnerDurationOption(
  value: unknown,
  fallback: number,
  name: string,
  allowZero = false,
): number {
  if (value === undefined) return fallback;
  if (
    !taskNumberIsSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > MAX_RUNNER_DURATION_MS
  ) {
    throw new TypeError(
      `Durable task runner ${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer at most ${MAX_RUNNER_DURATION_MS}.`,
    );
  }
  return value;
}

/** Pin the queue adapter receiver and method identities, and reconstruct every returned job. */
function snapshotDurableTaskRunnerStore(source: unknown): DurableTaskQueueStore {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('Durable task runner store must be a stable queue adapter.');
  }
  const enqueue = taskStableOwnFunction(source, 'enqueue', 'Durable task runner store');
  const cancel = taskStableOwnFunction(source, 'cancel', 'Durable task runner store');
  const claimDue = taskStableOwnFunction(source, 'claimDue', 'Durable task runner store');
  const heartbeat = taskStableOwnFunction(source, 'heartbeat', 'Durable task runner store');
  const markSucceeded = taskStableOwnFunction(source, 'markSucceeded', 'Durable task runner store');
  const markFailed = taskStableOwnFunction(source, 'markFailed', 'Durable task runner store');
  const reapExpiredLeases = taskStableOwnFunction(
    source,
    'reapExpiredLeases',
    'Durable task runner store',
  );
  return taskFreeze({
    async enqueue(input) {
      const result = await taskApply<Promise<unknown>>(enqueue, source, [input]);
      return snapshotTaskHandle(result, 'Durable task runner enqueue result');
    },
    async cancel(handle) {
      return requiredTaskBoolean(
        await taskApply<Promise<unknown>>(cancel, source, [handle]),
        'Durable task runner cancel result',
      );
    },
    async claimDue(options) {
      const result = await taskApply<Promise<unknown>>(claimDue, source, [options]);
      if (!taskIsArray(result)) {
        throw new TypeError('Durable task runner claimDue result must be a dense job array.');
      }
      const requestedLimit = taskOwnDataValue(options, 'limit');
      const returnedLength = taskOwnDataValue(result, 'length');
      if (
        !taskNumberIsSafeInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > MAX_RUNNER_COUNT ||
        !taskNumberIsSafeInteger(returnedLength) ||
        returnedLength < 0 ||
        returnedLength > requestedLimit
      ) {
        throw new TypeError(
          'Durable task runner claimDue result must not exceed the requested bounded limit.',
        );
      }
      const values = taskSnapshotCollection(result, 'Durable task runner claimed jobs');
      const jobs: DurableTaskJob[] = [];
      for (let index = 0; index < values.length; index += 1) {
        taskArrayPush(jobs, snapshotDurableTaskJob(values[index], index));
      }
      return jobs;
    },
    async heartbeat(id, options) {
      return requiredTaskBoolean(
        await taskApply<Promise<unknown>>(heartbeat, source, [id, options]),
        'Durable task runner heartbeat result',
      );
    },
    async markSucceeded(id, options) {
      return requiredTaskBoolean(
        await taskApply<Promise<unknown>>(markSucceeded, source, [id, options]),
        'Durable task runner markSucceeded result',
      );
    },
    async markFailed(id, error, options) {
      return requiredTaskBoolean(
        await taskApply<Promise<unknown>>(markFailed, source, [id, error, options]),
        'Durable task runner markFailed result',
      );
    },
    async reapExpiredLeases(now) {
      const result = await taskApply<Promise<unknown>>(reapExpiredLeases, source, [now]);
      if (!taskNumberIsSafeInteger(result) || result < 0) {
        throw new TypeError(
          'Durable task runner reapExpiredLeases result must be a non-negative integer.',
        );
      }
      return result;
    },
  });
}

function requiredTaskBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function snapshotTaskHandle(source: unknown, label: string): TaskHandle {
  if (typeof source !== 'object' || source === null || taskIsArray(source)) {
    throw new TypeError(`${label} must be a stable own-data record.`);
  }
  const id = taskOwnDataValue(source, 'id');
  const taskKey = taskOwnDataValue(source, 'task');
  if (
    typeof id !== 'string' ||
    taskStringTrim(id) === '' ||
    typeof taskKey !== 'string' ||
    taskStringTrim(taskKey) === ''
  ) {
    throw new TypeError(`${label} must contain non-empty id and task strings.`);
  }
  return taskFreeze({ id, task: taskKey });
}

function snapshotDurableTaskJob(source: unknown, index: number): DurableTaskJob {
  const label = `Durable task runner claimed jobs[${index}]`;
  if (typeof source !== 'object' || source === null || taskIsArray(source)) {
    throw new TypeError(`${label} must be a stable own-data record.`);
  }
  const id = taskOwnDataValue(source, 'id');
  const taskKey = taskOwnDataValue(source, 'task');
  const args = taskOwnDataValue(source, 'args');
  const runAt = taskOwnDataValue(source, 'runAt');
  const lineage = taskOwnDataValue(source, 'lineage');
  const generation = taskOwnDataValue(source, 'generation');
  const priority = taskOwnDataValue(source, 'priority');
  const status = taskOwnDataValue(source, 'status');
  const attempts = taskOwnDataValue(source, 'attempts');
  const createdAt = taskOwnDataValue(source, 'createdAt');
  const updatedAt = taskOwnDataValue(source, 'updatedAt');
  const key = taskOptionalOwnDataValue(source, 'key');
  const leasedUntil = taskOptionalOwnDataValue(source, 'leasedUntil');
  const leaseOwner = taskOptionalOwnDataValue(source, 'leaseOwner');
  const leaseToken = taskOptionalOwnDataValue(source, 'leaseToken');
  const lastError = taskOptionalOwnDataValue(source, 'lastError');
  if (
    typeof id !== 'string' ||
    taskStringTrim(id) === '' ||
    typeof taskKey !== 'string' ||
    taskStringTrim(taskKey) === '' ||
    typeof lineage !== 'string' ||
    taskStringTrim(lineage) === '' ||
    !taskNumberIsSafeInteger(generation) ||
    generation < 0 ||
    !taskNumberIsSafeInteger(priority) ||
    !taskNumberIsSafeInteger(attempts) ||
    attempts < 0 ||
    !isDurableRunnerJobStatus(status) ||
    (key !== undefined && typeof key !== 'string') ||
    (leaseOwner !== undefined && typeof leaseOwner !== 'string') ||
    (leaseToken !== undefined && typeof leaseToken !== 'string') ||
    (lastError !== undefined && typeof lastError !== 'string')
  ) {
    throw new TypeError(`${label} contains invalid authority fields.`);
  }
  return taskFreeze({
    id,
    task: taskKey,
    args: assertAndCloneJsonValue(args, { root: 'args' }),
    runAt: snapshotRunnerDate(runAt, `${label}.runAt`),
    lineage,
    generation,
    priority,
    status,
    attempts,
    createdAt: snapshotRunnerDate(createdAt, `${label}.createdAt`),
    updatedAt: snapshotRunnerDate(updatedAt, `${label}.updatedAt`),
    ...(key === undefined ? {} : { key }),
    ...(leasedUntil === undefined
      ? {}
      : { leasedUntil: snapshotRunnerDate(leasedUntil, `${label}.leasedUntil`) }),
    ...(leaseOwner === undefined ? {} : { leaseOwner }),
    ...(leaseToken === undefined ? {} : { leaseToken }),
    ...(lastError === undefined ? {} : { lastError }),
  });
}

function snapshotRunnerDate(value: unknown, label: string): Date {
  if (!taskDateIsDate(value)) throw new TypeError(`${label} must be a Date.`);
  const timestamp = taskDateGetTime(value);
  if (!taskNumberIsFinite(timestamp)) throw new TypeError(`${label} must be valid.`);
  return taskFreeze(taskNewDate(timestamp));
}

function isDurableRunnerJobStatus(value: unknown): value is DurableTaskJob['status'] {
  return (
    value === 'ready' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'dead' ||
    value === 'cancelled'
  );
}

function snapshotDurableTaskRunnerHooks(source: unknown): DurableTaskRunnerHooks {
  if (source === undefined) return taskFreeze({});
  if (typeof source !== 'object' || source === null || taskIsArray(source)) {
    throw new TypeError('Durable task runner hooks must be a stable own-data record.');
  }
  const keys = taskObjectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== 'onError' && key !== 'runMutation' && key !== 'runQuery') {
      throw new TypeError(
        `Unsupported durable task runner hook "${key}". The task egress capability is ` +
          'framework-owned and cannot be replaced (SPEC §6.6).',
      );
    }
  }
  const onError = taskOptionalOwnDataValue(source, 'onError');
  const runMutation = taskOptionalOwnDataValue(source, 'runMutation');
  const runQuery = taskOptionalOwnDataValue(source, 'runQuery');
  if (
    (onError !== undefined && typeof onError !== 'function') ||
    (runMutation !== undefined && typeof runMutation !== 'function') ||
    (runQuery !== undefined && typeof runQuery !== 'function')
  ) {
    throw new TypeError('Durable task runner hooks must contain only function data properties.');
  }
  return taskFreeze({
    ...(onError === undefined
      ? {}
      : { onError: onError as NonNullable<DurableTaskRunnerHooks['onError']> }),
    ...(runMutation === undefined
      ? {}
      : {
          runMutation: runMutation as NonNullable<DurableTaskRunnerHooks['runMutation']>,
        }),
    ...(runQuery === undefined
      ? {}
      : { runQuery: runQuery as NonNullable<DurableTaskRunnerHooks['runQuery']> }),
  });
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
  const scheduleOptions = snapshotTaskScheduleOptions(input.options);
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

  const runAt = scheduleRunAt(scheduleOptions);
  const parent = input.parent;
  return {
    task: input.definition.key,
    args: input.args,
    runAt:
      parent === undefined
        ? runAt
        : selfRescheduleRunAt(parent, input.definition.key, runAt, scheduleOptions, {
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
    ...(scheduleOptions?.key === undefined ? {} : { key: scheduleOptions.key }),
    ...(scheduleOptions?.coalesce === undefined ? {} : { coalesce: scheduleOptions.coalesce }),
  };
}

function snapshotTaskScheduleOptions(
  source: TaskScheduleOptions | undefined,
): Readonly<TaskScheduleOptions> | undefined {
  if (source === undefined) return undefined;
  if (typeof source !== 'object' || source === null || taskIsArray(source)) {
    throw new TypeError('Task schedule options must be a stable own-data record.');
  }
  const afterMs = taskOptionalOwnDataValue(source, 'afterMs');
  const at = taskOptionalOwnDataValue(source, 'at');
  const key = taskOptionalOwnDataValue(source, 'key');
  const coalesce = taskOptionalOwnDataValue(source, 'coalesce');
  if (afterMs !== undefined && at !== undefined) {
    throw new TypeError('Task schedule options cannot specify both afterMs and at.');
  }
  if (
    afterMs !== undefined &&
    (!taskNumberIsSafeInteger(afterMs) || afterMs < 0 || afterMs > MAX_RUNNER_DURATION_MS)
  ) {
    throw new TypeError(
      `Task schedule afterMs must be a non-negative integer at most ${MAX_RUNNER_DURATION_MS}.`,
    );
  }
  if (at !== undefined && typeof at !== 'string' && typeof at !== 'number' && !taskDateIsDate(at)) {
    throw new TypeError('Task schedule at must be a Date, string, or number.');
  }
  if (key !== undefined && (typeof key !== 'string' || key.length === 0 || key.length > 1_024)) {
    throw new TypeError('Task schedule key must be a non-empty bounded string.');
  }
  if (coalesce !== undefined && coalesce !== 'debounce' && coalesce !== 'throttle') {
    throw new TypeError('Task schedule coalesce must be debounce or throttle.');
  }
  let pinnedAt = at;
  if (at !== undefined) {
    const date = taskNewDate(at as string | number | Date);
    const timestamp = taskDateGetTime(date);
    if (!taskNumberIsFinite(timestamp)) throw new TypeError('Task schedule at must be valid.');
    pinnedAt = taskFreeze(taskNewDate(timestamp));
  }
  return taskFreeze({
    ...(afterMs === undefined ? {} : { afterMs }),
    ...(pinnedAt === undefined ? {} : { at: pinnedAt }),
    ...(key === undefined ? {} : { key }),
    ...(coalesce === undefined ? {} : { coalesce }),
  });
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
