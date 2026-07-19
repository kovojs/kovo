import type { AsyncLocalStorage } from 'node:async_hooks';

import {
  formHelperAsyncLocalGetStore,
  formHelperAsyncLocalRun,
  formHelperCreateAsyncLocalStorage,
  formHelperIsPromise,
  formHelperPromiseThen,
} from './jsx-form-helper-intrinsics.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessFreeze,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const frameworkAsyncContextCellBrand: unique symbol = Symbol('kovo.async-context-cell');
const revocableFrameworkAsyncContextTaskBrand: unique symbol = Symbol(
  'kovo.revocable-async-context-task',
);

/**
 * @internal Opaque identity for one least-authority async-context cell (SPEC §6.6).
 *
 * The public shell contains no storage or lifecycle authority. Only this module can associate it
 * with an `AsyncLocalStorage` instance through the private WeakMap below.
 */
export interface FrameworkAsyncContextCell<Value> {
  readonly [frameworkAsyncContextCellBrand]: true;
  readonly id: string;
  readonly __value?: Value;
}

/** @internal One framework-owned isolated task whose cell authority can be revoked early. */
export interface RevocableFrameworkAsyncContextTask<Result> {
  readonly [revocableFrameworkAsyncContextTaskBrand]: true;
  readonly result: Result;
  revoke(): void;
}

interface FrameworkAsyncContextLifecycle {
  readonly generation: number;
  readonly witness: object;
}

interface FrameworkAsyncContextStore<Value> {
  readonly cell: FrameworkAsyncContextCell<Value>;
  readonly lifecycle: FrameworkAsyncContextLifecycle;
  readonly value: Value;
}

interface FrameworkAsyncContextCellState<Value> {
  readonly storage: AsyncLocalStorage<FrameworkAsyncContextStore<Value>>;
}

const frameworkAsyncContextLifecycleStorage =
  formHelperCreateAsyncLocalStorage<FrameworkAsyncContextLifecycle>();
const frameworkAsyncContextCellStates = createWitnessWeakMap<
  FrameworkAsyncContextCell<unknown>,
  FrameworkAsyncContextCellState<unknown>
>();
const closedFrameworkAsyncContextLifecycles =
  createWitnessWeakSet<FrameworkAsyncContextLifecycle>();
let nextFrameworkAsyncContextGeneration = 0;

/** @internal Create one exact, independently typed async-context cell. */
export function createFrameworkAsyncContextCell<Value>(
  id: string,
): FrameworkAsyncContextCell<Value> {
  if (id.length === 0) {
    throw new TypeError('Framework async-context cell id must be non-empty.');
  }
  const cell = witnessFreeze({
    [frameworkAsyncContextCellBrand]: true as const,
    id,
  }) as FrameworkAsyncContextCell<Value>;
  witnessWeakMapSet(
    frameworkAsyncContextCellStates,
    cell as FrameworkAsyncContextCell<unknown>,
    witnessFreeze({
      storage: formHelperCreateAsyncLocalStorage<FrameworkAsyncContextStore<Value>>(),
    }) as FrameworkAsyncContextCellState<unknown>,
  );
  return cell;
}

/**
 * @internal Return authority only from this exact cell in the exact active, still-open lifecycle.
 * Missing, inherited-foreign, and stale stores all collapse to absence rather than ambient fallback.
 */
export function currentFrameworkAsyncContextValue<Value>(
  cell: FrameworkAsyncContextCell<Value>,
): Value | undefined {
  const state = frameworkAsyncContextCellState(cell);
  const store = formHelperAsyncLocalGetStore(state.storage);
  if (store === undefined || store.cell !== cell) return undefined;
  const lifecycle = formHelperAsyncLocalGetStore(frameworkAsyncContextLifecycleStorage);
  if (
    lifecycle === undefined ||
    lifecycle !== store.lifecycle ||
    witnessWeakSetHas(closedFrameworkAsyncContextLifecycles, lifecycle)
  ) {
    return undefined;
  }
  return store.value;
}

/**
 * @internal Run a cell inside the active lifecycle, or own a new lifecycle when called at a root.
 * Nested cells therefore prove the same exact lifecycle identity without aggregating their values.
 */
export function runWithFrameworkAsyncContext<Value, Result>(
  cell: FrameworkAsyncContextCell<Value>,
  value: Value,
  callback: () => Result,
): Result {
  const current = formHelperAsyncLocalGetStore(frameworkAsyncContextLifecycleStorage);
  if (current !== undefined) {
    if (witnessWeakSetHas(closedFrameworkAsyncContextLifecycles, current)) {
      throw new TypeError(
        `Framework async-context lifecycle ${current.generation} is closed; detached work cannot reacquire ${cell.id}.`,
      );
    }
    return runCellWithLifecycle(cell, value, current, callback);
  }
  return runOwnedFrameworkAsyncContextLifecycle((lifecycle) =>
    runCellWithLifecycle(cell, value, lifecycle, callback),
  );
}

/**
 * @internal Start a distinct authority root and run one cell inside it. Inherited cells remain
 * present in Node's implementation but cannot be read because their lifecycle identity differs.
 */
export function runWithIsolatedFrameworkAsyncContext<Value, Result>(
  cell: FrameworkAsyncContextCell<Value>,
  value: Value,
  callback: () => Result,
): Result {
  return runOwnedFrameworkAsyncContextLifecycle((lifecycle) =>
    runCellWithLifecycle(cell, value, lifecycle, callback),
  );
}

/**
 * @internal Run one isolated cell with an exact one-shot revocation capability.
 *
 * Deferred-region timeout owns the only production call site. Revocation closes the lifecycle even
 * when authored work never settles, so its later continuations see no JSX or sibling authority.
 */
export function runWithRevocableIsolatedFrameworkAsyncContext<Value, Result>(
  cell: FrameworkAsyncContextCell<Value>,
  value: Value,
  callback: () => Result,
): RevocableFrameworkAsyncContextTask<Result> {
  const lifecycle = createFrameworkAsyncContextLifecycle();
  let result: Result;
  try {
    result = formHelperAsyncLocalRun(frameworkAsyncContextLifecycleStorage, lifecycle, () =>
      runCellWithLifecycle(cell, value, lifecycle, callback),
    );
  } catch (error) {
    closeFrameworkAsyncContextLifecycle(lifecycle);
    throw error;
  }

  if (formHelperIsPromise(result)) {
    result = formHelperPromiseThen(
      result,
      (value) => {
        closeFrameworkAsyncContextLifecycle(lifecycle);
        return value;
      },
      (error) => {
        closeFrameworkAsyncContextLifecycle(lifecycle);
        throw error;
      },
    ) as Result;
  } else {
    closeFrameworkAsyncContextLifecycle(lifecycle);
  }

  return witnessFreeze({
    [revocableFrameworkAsyncContextTaskBrand]: true as const,
    result,
    revoke: () => closeFrameworkAsyncContextLifecycle(lifecycle),
  });
}

/**
 * @internal Start an authority-empty lifecycle boundary. A request dispatcher uses this before any
 * pre-dispatch callback so no cell from an ambient caller can become the new request's authority.
 */
export function runInFreshFrameworkAsyncContext<Result>(callback: () => Result): Result {
  return runOwnedFrameworkAsyncContextLifecycle(() => callback());
}

/** @internal Current generation for diagnostics/oracles; it is not an authority token. */
export function currentFrameworkAsyncContextGeneration(): number | undefined {
  const lifecycle = formHelperAsyncLocalGetStore(frameworkAsyncContextLifecycleStorage);
  return lifecycle === undefined ||
    witnessWeakSetHas(closedFrameworkAsyncContextLifecycles, lifecycle)
    ? undefined
    : lifecycle.generation;
}

function frameworkAsyncContextCellState<Value>(
  cell: FrameworkAsyncContextCell<Value>,
): FrameworkAsyncContextCellState<Value> {
  const state = witnessWeakMapGet(
    frameworkAsyncContextCellStates,
    cell as FrameworkAsyncContextCell<unknown>,
  );
  if (state === undefined) {
    throw new TypeError('Framework async-context cell was not minted by this runtime.');
  }
  return state as FrameworkAsyncContextCellState<Value>;
}

function runCellWithLifecycle<Value, Result>(
  cell: FrameworkAsyncContextCell<Value>,
  value: Value,
  lifecycle: FrameworkAsyncContextLifecycle,
  callback: () => Result,
): Result {
  const state = frameworkAsyncContextCellState(cell);
  const store = witnessFreeze({ cell, lifecycle, value });
  return formHelperAsyncLocalRun(state.storage, store, callback);
}

function runOwnedFrameworkAsyncContextLifecycle<Result>(
  callback: (lifecycle: FrameworkAsyncContextLifecycle) => Result,
): Result {
  const lifecycle = createFrameworkAsyncContextLifecycle();
  let result: Result;
  try {
    result = formHelperAsyncLocalRun(frameworkAsyncContextLifecycleStorage, lifecycle, () =>
      callback(lifecycle),
    );
  } catch (error) {
    closeFrameworkAsyncContextLifecycle(lifecycle);
    throw error;
  }
  if (formHelperIsPromise(result)) {
    return formHelperPromiseThen(
      result,
      (value) => {
        closeFrameworkAsyncContextLifecycle(lifecycle);
        return value;
      },
      (error) => {
        closeFrameworkAsyncContextLifecycle(lifecycle);
        throw error;
      },
    ) as Result;
  }
  closeFrameworkAsyncContextLifecycle(lifecycle);
  return result;
}

function createFrameworkAsyncContextLifecycle(): FrameworkAsyncContextLifecycle {
  const generation = nextFrameworkAsyncContextGeneration + 1;
  if (!Number.isSafeInteger(generation)) {
    throw new TypeError('Framework async-context lifecycle generation space is exhausted.');
  }
  nextFrameworkAsyncContextGeneration = generation;
  return witnessFreeze({ generation, witness: witnessFreeze({}) });
}

function closeFrameworkAsyncContextLifecycle(lifecycle: FrameworkAsyncContextLifecycle): void {
  witnessWeakSetAdd(closedFrameworkAsyncContextLifecycles, lifecycle);
}
