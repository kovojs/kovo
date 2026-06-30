import type { TaskDefinition, TaskHandle, TaskRunContext, TaskScheduleOptions } from './task.js';
import type { DurableTaskJob, DurableTaskQueueStore } from './task-queue.js';

export interface DurableTaskRunnerHooks {
  readonly fetch?: typeof globalThis.fetch;
  runMutation?: TaskRunContext['runMutation'];
  runQuery?: TaskRunContext['runQuery'];
  schedule?: TaskRunContext['schedule'];
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
  private readonly tasks = new Map<string, TaskDefinition<string, any, any>>();
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly owner: string;
  private readonly hooks: DurableTaskRunnerHooks;
  private readonly hardTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxInFlight: number;
  private readonly selfRescheduleDelayFloorMs: number;
  private readonly inFlightByTask = new Map<string, number>();
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private draining: Promise<void> | undefined;

  constructor(private readonly options: DurableTaskRunnerOptions) {
    const taskEntries =
      Symbol.iterator in Object(options.tasks)
        ? (options.tasks as Iterable<TaskDefinition<string, any, any>>)
        : Object.values(options.tasks as Record<string, TaskDefinition<string, any, any>>);
    for (const task of taskEntries) {
      this.tasks.set(task.key, task);
    }
    this.batchSize = options.batchSize ?? 5;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.hardTimeoutMs = options.hardTimeoutMs ?? 300_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(100, this.leaseMs / 2);
    this.maxInFlight = Math.max(
      1,
      Math.min(Math.floor(options.maxInFlight ?? this.batchSize), this.batchSize),
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
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.draining;
  }

  async runOnce(now: Date = new Date()): Promise<DurableTaskJob[]> {
    await this.options.store.reapExpiredLeases(now);
    const jobs = await this.claimAvailable(now);
    await Promise.all(jobs.map((job) => this.runTrackedJob(job)));
    return jobs;
  }

  private async claimAvailable(now: Date): Promise<DurableTaskJob[]> {
    const claimed: DurableTaskJob[] = [];
    while (claimed.length < this.batchSize && this.inFlight + claimed.length < this.maxInFlight) {
      const taskKeys = this.claimableTaskKeys(claimed);
      if (this.tasks.size > 0 && taskKeys.length === 0) break;
      const jobs = await this.options.store.claimDue({
        limit: 1,
        leaseMs: this.leaseMs,
        now,
        owner: this.owner,
        ...(taskKeys.length === 0 ? {} : { taskKeys }),
      });
      if (jobs.length === 0) break;
      claimed.push(jobs[0]!);
    }
    return claimed;
  }

  private claimableTaskKeys(pending: readonly DurableTaskJob[]): string[] {
    const pendingByTask = new Map<string, number>();
    for (const job of pending) {
      pendingByTask.set(job.task, (pendingByTask.get(job.task) ?? 0) + 1);
    }
    const keys: string[] = [];
    for (const [key, task] of this.tasks) {
      const cap = taskConcurrency(task);
      const current = (this.inFlightByTask.get(key) ?? 0) + (pendingByTask.get(key) ?? 0);
      if (current < cap) keys.push(key);
    }
    return keys;
  }

  private async runTrackedJob(job: DurableTaskJob): Promise<void> {
    this.inFlight += 1;
    this.inFlightByTask.set(job.task, (this.inFlightByTask.get(job.task) ?? 0) + 1);
    try {
      await this.runJob(job);
    } finally {
      this.inFlight -= 1;
      const remaining = (this.inFlightByTask.get(job.task) ?? 1) - 1;
      if (remaining <= 0) this.inFlightByTask.delete(job.task);
      else this.inFlightByTask.set(job.task, remaining);
    }
  }

  private scheduleTick(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.draining = this.runOnce()
        .then(() => undefined)
        .catch(() => {
          // Individual job failures are persisted by runJob; loop-level errors should not kill the runner.
        })
        .finally(() => {
          this.draining = undefined;
          if (!this.stopped) this.scheduleTick(this.pollIntervalMs);
        });
    }, delayMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async runJob(job: DurableTaskJob): Promise<void> {
    const task = this.tasks.get(job.task);
    if (task === undefined) {
      await this.options.store.markFailed(job.id, new UnknownDurableTaskError(job.task), {
        ...completionOptions(job),
        maxAttempts: 1,
      });
      return;
    }

    try {
      const args = task.input.parse(job.args);
      await this.runWithDeadline(job, task, args);
      await this.options.store.markSucceeded(job.id, completionOptions(job));
    } catch (error) {
      await this.options.store.markFailed(job.id, error, {
        ...completionOptions(job),
        maxAttempts: taskMaxAttempts(task),
        retryAt: retryRunAt(job, task),
      });
    }
  }

  private async runWithDeadline(
    job: DurableTaskJob,
    task: TaskDefinition<string, any, any>,
    args: unknown,
  ): Promise<void> {
    const timeoutMs = taskTimeoutMs(task, this.leaseMs, this.hardTimeoutMs);
    let settled = false;
    const heartbeat = setInterval(
      () => {
        if (settled) return;
        const now = new Date();
        void this.options.store.heartbeat(job.id, {
          ...completionOptions(job),
          leaseMs: Math.min(this.leaseMs, timeoutMs),
          now,
        });
      },
      Math.min(this.heartbeatIntervalMs, timeoutMs),
    );
    (heartbeat as { unref?: () => void }).unref?.();

    try {
      await withTimeout(
        Promise.resolve(task.run(args, this.createContext(job))),
        timeoutMs,
        `Durable task "${task.key}" exceeded timeoutMs ${timeoutMs}.`,
      );
    } finally {
      settled = true;
      clearInterval(heartbeat);
    }
  }

  private createContext(job: DurableTaskJob): TaskRunContext {
    return {
      jobId: job.id,
      idempotencyKey: job.id,
      fetch: this.hooks.fetch ?? globalThis.fetch.bind(globalThis),
      runMutation:
        this.hooks.runMutation ??
        (async () => {
          throw new Error('Task runner runMutation hook is not configured.');
        }),
      runQuery:
        this.hooks.runQuery ??
        (async () => {
          throw new Error('Task runner runQuery hook is not configured.');
        }),
      schedule:
        this.hooks.schedule ??
        (async (definition, args, options?: TaskScheduleOptions): Promise<TaskHandle> => {
          const runAt = scheduleRunAt(options);
          return this.options.store.enqueue({
            task: definition.key,
            args,
            runAt: selfRescheduleRunAt(job, definition.key, runAt, options, {
              delayFloorMs: this.selfRescheduleDelayFloorMs,
            }),
            generation: job.generation + 1,
            lineage: job.lineage,
            ...generationStatus(job, definition),
            ...(definition.priority === undefined ? {} : { priority: definition.priority }),
            ...(options?.key === undefined ? {} : { key: options.key }),
            ...(options?.coalesce === undefined ? {} : { coalesce: options.coalesce }),
          });
        }),
    };
  }
}

export function createDurableTaskRunner(options: DurableTaskRunnerOptions): DurableTaskRunner {
  return new DurableTaskRunner(options);
}

function scheduleRunAt(options: TaskScheduleOptions | undefined): Date {
  if (options?.afterMs !== undefined && options.at !== undefined) {
    throw new TypeError('Task schedule options cannot specify both afterMs and at.');
  }
  if (options?.afterMs !== undefined) return new Date(Date.now() + options.afterMs);
  if (options?.at !== undefined) return new Date(options.at);
  return new Date();
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
  return Math.max(1, Math.trunc(task.retry?.maxAttempts ?? 1));
}

function retryRunAt(job: DurableTaskJob, task: TaskDefinition<string, any, any>): Date {
  const attempt = Math.max(1, job.attempts);
  const baseMs = 1000;
  const delayMs =
    task.retry?.backoff === 'linear'
      ? baseMs * attempt
      : task.retry?.backoff === 'exponential'
        ? baseMs * 2 ** (attempt - 1)
        : baseMs;
  return new Date(Date.now() + delayMs);
}

function taskTimeoutMs(
  task: TaskDefinition<string, any, any>,
  leaseMs: number,
  hardTimeoutMs: number,
): number {
  const requested = task.timeoutMs ?? leaseMs;
  if (!Number.isFinite(requested) || requested <= 0) return Math.min(leaseMs, hardTimeoutMs);
  return Math.max(1, Math.min(Math.trunc(requested), hardTimeoutMs));
}

function taskConcurrency(task: TaskDefinition<string, any, any>): number {
  const concurrency = task.concurrency;
  if (concurrency === undefined || !Number.isFinite(concurrency)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.trunc(concurrency));
}

function generationStatus(
  parent: DurableTaskJob,
  definition: TaskDefinition<string, any, any>,
): { status?: 'dead'; lastError?: string } {
  const nextGeneration = parent.generation + 1;
  const maxGenerations = Math.max(0, Math.trunc(definition.maxGenerations ?? 64));
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
  const floor = Math.max(0, Math.trunc(config.delayFloorMs));
  const minimum = new Date(Date.now() + floor);
  return runAt.getTime() >= minimum.getTime() ? runAt : minimum;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    (timeout as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
