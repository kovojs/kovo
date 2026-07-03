import { runMutation } from './mutation.js';
import type { TaskScheduler } from './mutation/definition.js';
import { recordQueryRuntimeWarnings, runQuery } from './query.js';
import { reportServerError } from './diagnostics.js';
import {
  PostgresRecurringTaskOccurrenceStore,
  createRecurringTaskMaterializer,
  ensureRecurringTaskSchema,
  type RecurringTaskMaterializer,
} from './task-cron.js';
import { createDurableTaskRunner, type DurableTaskRunner } from './task-runner.js';
import {
  PostgresDurableTaskQueue,
  createDurableTaskSqlExecutor,
  ensureDurableTaskSchema,
  type DurableTaskQueueStore,
} from './task-queue.js';
import type { KovoApp } from './app-types.js';
import type { DurableTaskRunnerErrorContext } from './task-runner.js';
import { scrubConsoleArgs } from './logging.js';

const TASK_CRON_POLL_INTERVAL_MS = 30_000;

export interface AppTaskRuntime {
  readonly scheduler: TaskScheduler;
  ensureStarted(request: Request): Promise<void>;
}

const appTaskRuntimes = new WeakMap<KovoApp, AppTaskRuntime>();

export function createAppTaskRuntime(app: KovoApp): AppTaskRuntime | undefined {
  if (app.tasks.length === 0) return undefined;
  if (app.db === undefined) {
    throw new TypeError(
      'createRequestHandler() cannot run durable tasks without createApp({ db }). request.schedule() persists jobs in _kovo_jobs (SPEC §9.6).',
    );
  }
  return new DefaultAppTaskRuntime(app);
}

export function registerAppTaskRuntime(app: KovoApp, runtime: AppTaskRuntime | undefined): void {
  if (runtime === undefined) {
    appTaskRuntimes.delete(app);
    return;
  }
  appTaskRuntimes.set(app, runtime);
}

export function appTaskScheduler(app: KovoApp): TaskScheduler | undefined {
  return appTaskRuntimes.get(app)?.scheduler;
}

class DefaultAppTaskRuntime implements AppTaskRuntime {
  private cronMaterializer: RecurringTaskMaterializer | undefined;
  private cronTimer: ReturnType<typeof setTimeout> | undefined;
  private runner: DurableTaskRunner | undefined;
  private startPromise: Promise<void> | undefined;

  readonly scheduler: TaskScheduler;

  constructor(private readonly app: KovoApp) {
    this.scheduler = {
      registeredTasks: app.tasks,
      cancel: async (request, handle) => this.queueForRequest(request).cancel(handle),
      schedule: async (request, input) => this.queueForRequest(request).enqueue(input),
    };
  }

  async ensureStarted(request: Request): Promise<void> {
    if (this.runner !== undefined) return;
    this.startPromise ??= this.start(request).catch((error: unknown) => {
      this.startPromise = undefined;
      throw error;
    });
    await this.startPromise;
  }

  private async start(request: Request): Promise<void> {
    const db = await this.resolveRootDb();
    const executor = createDurableTaskSqlExecutor(db);
    const store = new PostgresDurableTaskQueue(executor);
    await ensureDurableTaskSchema(executor);
    await ensureRecurringTaskSchema(executor);
    this.cronMaterializer = createRecurringTaskMaterializer({
      occurrenceStore: new PostgresRecurringTaskOccurrenceStore(executor),
      store,
      tasks: this.app.tasks,
    });
    await this.materializeRecurringTasks();
    this.runner = createDurableTaskRunner({
      hooks: {
        onError: async (error, context) => {
          this.reportTaskError(error, context, request);
        },
        runMutation: async (definition, input, ingressOptions) => {
          const result = await runMutation(
            definition as never,
            input,
            taskInternalRequest(request) as never,
            {
              csrf: false,
              ...(this.app.db === undefined ? {} : { db: this.app.db }),
              ...(this.app.onError === undefined ? {} : { onError: this.app.onError }),
              ...(this.app.sessionProvider === undefined
                ? {}
                : { sessionProvider: this.app.sessionProvider }),
              principalPosture: ingressOptions.principalPosture,
              taskScheduler: this.scheduler,
            } as never,
          );
          if (!result.ok) {
            throw new Error(
              `Durable task runMutation(${definition.key}) failed with ${result.status} ${result.error.code}.`,
            );
          }
          return result.value;
        },
        runQuery: async (definition, input, ingressOptions) => {
          const result = await runQuery(
            definition as never,
            input,
            taskInternalRequest(request) as never,
            {
              ...(this.app.db === undefined ? {} : { db: this.app.db }),
              maxListItems: this.app.requestLimits.maxQueryListItems,
              ...(this.app.onError === undefined ? {} : { onError: this.app.onError }),
              ...(this.app.sessionProvider === undefined
                ? {}
                : { sessionProvider: this.app.sessionProvider }),
              principalPosture: ingressOptions.principalPosture,
            } as never,
          );
          if (!result.ok) {
            throw new Error(
              `Durable task runQuery(${definition.key}) failed with ${result.status} ${result.error.code}.`,
            );
          }
          recordQueryRuntimeWarnings(request, result.warnings);
          return result.value;
        },
      },
      owner: `kovo-task-runner:${process.pid}`,
      pollIntervalMs: 100,
      store,
      tasks: this.app.tasks,
    });
    this.runner.start();
    this.scheduleCronTick();
  }

  private scheduleCronTick(): void {
    if (this.cronMaterializer === undefined || this.cronTimer !== undefined) return;
    this.cronTimer = setTimeout(() => {
      this.cronTimer = undefined;
      void this.materializeRecurringTasks()
        .catch(() => {
          // Runner ticks must survive transient DB errors; the next tick retries materialization.
        })
        .finally(() => this.scheduleCronTick());
    }, TASK_CRON_POLL_INTERVAL_MS);
    (this.cronTimer as { unref?: () => void }).unref?.();
  }

  private async materializeRecurringTasks(): Promise<void> {
    await this.cronMaterializer?.materializeDue();
  }

  private reportTaskError(
    error: unknown,
    context: DurableTaskRunnerErrorContext,
    request: Request,
  ): void {
    if (this.app.onError !== undefined) {
      reportServerError(this.app.onError, error, {
        operation: 'task-runner',
        request: taskInternalRequest(request),
        taskJobId: context.job.id,
        taskKey: context.task?.key ?? context.job.task,
        url: new URL('/_kovo/task', request.url).toString(),
      });
      return;
    }
    console.error(
      ...scrubConsoleArgs([
        '[kovo] durable task failed',
        {
          error,
          jobId: context.job.id,
          phase: context.phase,
          task: context.task?.key ?? context.job.task,
        },
      ]),
    );
  }

  private async resolveRootDb(): Promise<unknown> {
    if (this.app.db === undefined) {
      throw new TypeError(
        'createRequestHandler() cannot run durable tasks without createApp({ db }) (SPEC §9.6).',
      );
    }
    return this.app.db(undefined as never);
  }

  private queueForRequest(request: unknown): DurableTaskQueueStore {
    if (!isRecord(request) || request.db === undefined) {
      throw new Error(
        'request.schedule(task, args) requires a mutation request with request.db so _kovo_jobs writes share the enclosing transaction (SPEC §9.6).',
      );
    }
    return new PostgresDurableTaskQueue(createDurableTaskSqlExecutor(request.db));
  }
}

function taskInternalRequest(seed: Request): Request {
  return new Request(new URL('/_kovo/task', seed.url), { method: 'POST' });
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}
