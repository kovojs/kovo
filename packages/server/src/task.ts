import type { InferSchema, Schema } from './schema.js';

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
export type TaskRunnableQueryInput<Query> =
  Query extends { args: Schema<infer Input> } ? Input : undefined;

/** Context available to durable task bodies (SPEC §9.6: composition only, no raw db). */
export interface TaskRunContext {
  readonly jobId: string;
  readonly fetch: typeof globalThis.fetch;
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
  input: InputSchema;
  key: Key;
  maxGenerations?: number;
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
export function task<const Key extends string, InputSchema extends Schema<unknown>, Value = unknown>(
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
  const known = new Set(['input', 'maxGenerations', 'retry', 'run', 'timeoutMs']);
  const unknown = Object.keys(definition).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown task() definition field: ${unknown.join(', ')}`);
  }
}
