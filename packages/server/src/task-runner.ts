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
  readonly leaseMs?: number;
  readonly pollIntervalMs?: number;
  readonly owner?: string;
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
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.owner = options.owner ?? 'kovo-task-runner';
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
    const jobs = await this.options.store.claimDue({
      limit: this.batchSize,
      leaseMs: this.leaseMs,
      now,
      owner: this.owner,
    });
    await Promise.all(jobs.map((job) => this.runJob(job)));
    return jobs;
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
      await this.options.store.markFailed(job.id, new UnknownDurableTaskError(job.task));
      return;
    }

    try {
      const args = task.input.parse(job.args);
      await task.run(args, this.createContext(job));
      await this.options.store.markSucceeded(job.id);
    } catch (error) {
      await this.options.store.markFailed(job.id, error);
    }
  }

  private createContext(job: DurableTaskJob): TaskRunContext {
    return {
      jobId: job.id,
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
            runAt,
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
