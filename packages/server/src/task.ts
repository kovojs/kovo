import type { InferSchema, Schema } from './schema.js';
import type { NonRequestPrincipalPosture } from './auth-principal.js';
import { validateCronExpression } from './task-cron.js';

const UNASSIGNED_DERIVED_TASK_KEY = '\0kovo:unassigned-task-key';

/** Stable handle returned by `request.schedule(task, args)` for later cancellation. */
export interface TaskHandle<Key extends string = string> {
  readonly id: string;
  readonly task: Key;
}

/** Scheduling options for durable task jobs (SPEC §9.6). */
export interface TaskScheduleOptions {
  /** Run no earlier than this many milliseconds after the enclosing transaction commits. */
  afterMs?: number;
  /** Run no earlier than this wall-clock time. Mutually exclusive with `afterMs`. */
  at?: Date | string | number;
  /** Logical identity for replacing or throttling a still-ready pending job. */
  key?: string;
  /** Key coalescing mode. Defaults to debounce: latest args and latest run time win. */
  coalesce?: 'debounce' | 'throttle';
}

/** Catch-up policy for task-declared recurring schedules (SPEC §9.6). */
export type TaskCronCatchUp = 'skip' | 'backfill';

/** Mutation request helpers for durable task scheduling (SPEC §9.6). */
export interface TaskSchedulingRequest {
  cancel(handle: TaskHandle): Promise<boolean>;
  schedule<const Task extends TaskDefinition<string, Schema<unknown>, any>>(
    definition: Task,
    args: TaskInput<Task>,
    options?: TaskScheduleOptions,
  ): Promise<TaskHandle<Task['key']>>;
}

/** Minimal public shape of a mutation accepted by `TaskRunContext.runMutation(...)`. */
export interface TaskRunnableMutation<Input = unknown> {
  input: Schema<Input>;
  key: string;
}

/** Minimal public shape of a query accepted by `TaskRunContext.runQuery(...)`. */
export interface TaskRunnableQuery<Input = unknown> {
  args?: Schema<Input>;
  key: string;
}

/** Input type accepted by `TaskRunContext.runMutation(...)` for a mutation-like definition. */
export type TaskRunnableMutationInput<Mutation> =
  Mutation extends TaskRunnableMutation<infer Input> ? Input : never;

/** Input type accepted by `TaskRunContext.runQuery(...)` for a query-like definition. */
export type TaskRunnableQueryInput<Query> = Query extends { args: Schema<infer Input> }
  ? Input
  : undefined;

/** @internal Principal posture threaded from task ctx helpers to framework-owned ingress hooks. */
export interface TaskIngressRunOptions {
  readonly principalPosture: NonRequestPrincipalPosture;
}

/**
 * Read-only task scope returned by `ctx.actAs(id)` or `ctx.declareSystemRead(reason)`.
 *
 * SPEC §10.3 DEC-G: durable tasks have no ambient request principal, so owner-scoped reads must
 * name an explicit principal or audited system posture before entering the query runtime.
 */
export interface TaskPrincipalReadScope {
  runQuery<const Query extends TaskRunnableQuery<any>>(
    definition: Query,
    input: TaskRunnableQueryInput<Query>,
  ): Promise<unknown>;
}

/**
 * Write-only task scope returned by `ctx.actAs(id)` or `ctx.declareSystemWrite(reason)`.
 *
 * SPEC §10.3 DEC-G: durable tasks have no ambient request principal, so owner-scoped writes must
 * name an explicit principal or audited system posture before entering the mutation runtime.
 */
export interface TaskPrincipalWriteScope {
  runMutation<const Mutation extends TaskRunnableMutation<any>>(
    definition: Mutation,
    input: TaskRunnableMutationInput<Mutation>,
  ): Promise<unknown>;
}

/**
 * Read/write task scope returned by `ctx.actAs(id)` for work derived to a single owner principal
 * (SPEC §10.3 DEC-G).
 */
export interface TaskPrincipalScope extends TaskPrincipalReadScope, TaskPrincipalWriteScope {}

/**
 * Context available to durable task bodies (SPEC §9.6: composition only, no raw db).
 *
 * Tasks do not receive `db` or a transaction handle. Writes compose through
 * `ctx.runMutation(...)`, and reads compose through `ctx.runQuery(...)`, so durable background
 * work reuses the audited mutation/query channels instead of importing a broad app DB handle.
 */
export interface TaskRunContext {
  readonly jobId: string;
  /** Stable idempotency key for external APIs; equal to the durable job id (SPEC §9.6). */
  readonly idempotencyKey: string;
  readonly fetch: typeof globalThis.fetch;
  /**
   * SPEC §10.3 DEC-G: choose the owner principal for scoped background work. Payload fields do
   * not become authority unless task code explicitly derives and validates this id first.
   */
  actAs(principalId: string): TaskPrincipalScope;
  /** SPEC §10.3 DEC-G: audited cross-owner read posture for genuine system work. */
  declareSystemRead(reason: string): TaskPrincipalReadScope;
  /** SPEC §10.3 DEC-G: audited cross-owner write posture for genuine system work. */
  declareSystemWrite(reason: string): TaskPrincipalWriteScope;
  runMutation<const Mutation extends TaskRunnableMutation<any>>(
    definition: Mutation,
    input: TaskRunnableMutationInput<Mutation>,
  ): Promise<unknown>;
  runQuery<const Query extends TaskRunnableQuery<any>>(
    definition: Query,
    input: TaskRunnableQueryInput<Query>,
  ): Promise<unknown>;
  schedule<const Task extends TaskDefinition<string, Schema<unknown>, any>>(
    definition: Task,
    args: TaskInput<Task>,
    options?: TaskScheduleOptions,
  ): Promise<TaskHandle<Task['key']>>;
}

/** A typed durable background function declaration (SPEC §9.6). */
export interface TaskDefinition<
  Key extends string = string,
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Value = unknown,
> {
  /** Five-field UTC cron expression for recurring task materialization (SPEC §9.6). */
  cron?: string;
  /** Missed-occurrence policy. Defaults to `skip`; `backfill` is bounded by the materializer. */
  catchUp?: TaskCronCatchUp;
  /** Serialized args for recurring invocations. Defaults to `{}`. */
  cronArgs?: InferSchema<InputSchema>;
  input: InputSchema;
  key: Key;
  maxGenerations?: number;
  priority?: number;
  concurrency?: number;
  retry?: {
    backoff?: 'exponential' | 'linear';
    maxAttempts?: number;
  };
  run(args: InferSchema<InputSchema>, context: TaskRunContext): Promise<Value> | Value;
  timeoutMs?: number;
}

/** Serialized input type accepted by `request.schedule(task, args)`. */
export type TaskInput<Task> =
  Task extends TaskDefinition<string, infer InputSchema, any> ? InferSchema<InputSchema> : never;

/** App-scoped task factory. `createApp()` uses this to contextually type task declarations. */
export interface TaskFactory {
  <InputSchema extends Schema<unknown>, Value = unknown>(
    definition: Omit<TaskDefinition<string, InputSchema, Value>, 'key'>,
  ): TaskDefinition<string, InputSchema, Value>;
  <const Key extends string, InputSchema extends Schema<unknown>, Value = unknown>(
    key: Key,
    definition: Omit<TaskDefinition<Key, InputSchema, Value>, 'key'>,
  ): TaskDefinition<Key, InputSchema, Value>;
}

/**
 * Declare a durable background function (SPEC §9.6). Tasks are registry entries with typed
 * serialized input; task bodies may perform external I/O, but DB access composes through
 * `ctx.runQuery`/`ctx.runMutation` rather than receiving a raw transactional db.
 */
export function task<InputSchema extends Schema<unknown>, Value = unknown>(
  definition: Omit<TaskDefinition<string, InputSchema, Value>, 'key'>,
): TaskDefinition<string, InputSchema, Value>;
export function task<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Value = unknown,
>(
  key: Key,
  definition: Omit<TaskDefinition<Key, InputSchema, Value>, 'key'>,
): TaskDefinition<Key, InputSchema, Value>;
export function task(
  keyOrDefinition: string | Omit<TaskDefinition<any, any, any>, 'key'>,
  maybeDefinition?: Omit<TaskDefinition<any, any, any>, 'key'>,
): TaskDefinition<string> {
  const [key, definition] =
    typeof keyOrDefinition === 'string'
      ? [keyOrDefinition, maybeDefinition]
      : [UNASSIGNED_DERIVED_TASK_KEY, keyOrDefinition];
  if (!definition) {
    throw new TypeError('task(key, definition) requires a definition object.');
  }
  assertKnownTaskDefinitionKeys(definition);
  assertTaskCronOptions(definition);
  assertTaskRetryOptions(definition);
  return { ...definition, key };
}

/** @internal Compiler-emitted/generated ABI for SPEC §4.1 source-derived task identities. */
export function assignDerivedTaskKey<Task extends TaskDefinition<string, any, any>>(
  definition: Task,
  key: string,
): Task {
  if (!key) {
    throw new TypeError('assignDerivedTaskKey() requires a non-empty task key.');
  }
  if (definition.key !== UNASSIGNED_DERIVED_TASK_KEY && definition.key !== key) {
    throw new TypeError(
      `Cannot assign derived task key "${key}" to task already keyed as "${definition.key}".`,
    );
  }
  definition.key = key;
  return definition;
}

function assertKnownTaskDefinitionKeys(definition: object): void {
  const known = new Set([
    'catchUp',
    'concurrency',
    'cron',
    'cronArgs',
    'input',
    'maxGenerations',
    'priority',
    'retry',
    'run',
    'timeoutMs',
  ]);
  const unknown = Object.keys(definition).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown task() definition field: ${unknown.join(', ')}`);
  }
}

function assertTaskCronOptions(definition: Omit<TaskDefinition<any, any, any>, 'key'>): void {
  if (definition.cron !== undefined && typeof definition.cron !== 'string') {
    throw new TypeError('task({ cron }) must be a five-field cron expression string.');
  }
  if (definition.cron === '') {
    throw new TypeError('task({ cron }) must be a non-empty five-field cron expression string.');
  }
  if (
    definition.catchUp !== undefined &&
    definition.catchUp !== 'skip' &&
    definition.catchUp !== 'backfill'
  ) {
    throw new TypeError("task({ catchUp }) must be 'skip' or 'backfill'.");
  }
  if (definition.catchUp !== undefined && definition.cron === undefined) {
    throw new TypeError('task({ catchUp }) requires task({ cron }).');
  }
  if (definition.cronArgs !== undefined && definition.cron === undefined) {
    throw new TypeError('task({ cronArgs }) requires task({ cron }).');
  }
  if (definition.cron !== undefined) {
    validateCronExpression(definition.cron);
    try {
      definition.input.parse(definition.cronArgs ?? {});
    } catch (error) {
      const cause = error instanceof Error ? ` ${error.message}` : '';
      throw new TypeError(
        `task({ cronArgs }) must satisfy the task input schema for recurring task "${definition.cron}".${cause}`,
      );
    }
  }
}

function assertTaskRetryOptions(definition: Omit<TaskDefinition<any, any, any>, 'key'>): void {
  if (definition.retry === undefined) return;
  const { backoff, maxAttempts } = definition.retry;
  if (backoff !== undefined && backoff !== 'exponential' && backoff !== 'linear') {
    throw new TypeError("task({ retry.backoff }) must be 'exponential' or 'linear'.");
  }
  if (maxAttempts === undefined || !Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('task({ retry.maxAttempts }) must be a positive finite number.');
  }
}
