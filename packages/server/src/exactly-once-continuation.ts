const NativePromise = Promise;
const NativeTypeError = TypeError;
const nativePromiseCatch = NativePromise.prototype.catch;
const nativePromiseFinally = NativePromise.prototype.finally;
const nativePromiseReject = NativePromise.reject;
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = Reflect.apply;
const nativePromiseToStringTag: typeof Symbol.toStringTag = Symbol.toStringTag;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

export interface ExactlyOnceContinuationStatus {
  readonly callbackFailed: boolean;
  readonly callbackFailure: unknown;
  readonly invocations: number;
  readonly settled: boolean;
  readonly started: boolean;
  readonly violated: boolean;
}

/**
 * Revocable exactly-once gate for framework continuations handed to app/driver adapters at the
 * SPEC §10.3 transaction and §11.4 webhook authority boundaries.
 *
 * `run()` returns a lazy Promise-compatible thenable: merely obtaining or discarding it does not
 * start user work. Awaiting/returning/then-ing it starts the callback once. `close()` revokes every
 * unstarted or future call, while `quiesce()` lets the framework wait for work an adapter started
 * but failed to await before reporting the adapter violation.
 */
export interface ExactlyOnceContinuation<Argument, Result> {
  close(): void;
  quiesce(): Promise<void>;
  run(argument: Argument): Promise<Result>;
  status(): ExactlyOnceContinuationStatus;
}

export function exactlyOnceContinuation<Argument, Result>(
  callback: (argument: Argument) => Promise<Result> | Result,
): ExactlyOnceContinuation<Argument, Result> {
  let calls = 0;
  let callbackFailed = false;
  let callbackFailure: unknown;
  let closed = false;
  let pending: Promise<Result> | undefined;
  let settled = false;
  let started = false;
  let violated = false;

  const continuation: ExactlyOnceContinuation<Argument, Result> = {
    close() {
      closed = true;
      if (calls !== 1 || !started || !settled) violated = true;
    },
    async quiesce() {
      if (pending === undefined) return;
      try {
        await pending;
      } catch {
        // status() preserves the original callback failure for the adapter boundary.
      }
    },
    run(argument) {
      if (closed || calls !== 0) {
        violated = true;
        throw new NativeTypeError('Framework continuation must be invoked exactly once.');
      }
      calls = 1;

      const start = (): Promise<Result> => {
        if (pending !== undefined) return pending;
        if (closed) {
          violated = true;
          return apply(nativePromiseReject, NativePromise, [
            new NativeTypeError('Framework continuation was observed after its adapter returned.'),
          ]);
        }
        started = true;
        pending = (async () => {
          try {
            return await callback(argument);
          } catch (error) {
            callbackFailed = true;
            callbackFailure = error;
            throw error;
          } finally {
            settled = true;
          }
        })();
        return pending;
      };

      const lazy: Promise<Result> = {
        catch<Rejected = never>(
          onRejected?: (reason: unknown) => Rejected | PromiseLike<Rejected>,
        ): Promise<Result | Rejected> {
          return apply<Promise<Result | Rejected>>(nativePromiseCatch, start(), [onRejected]);
        },
        finally(onFinally?: (() => void) | null): Promise<Result> {
          return apply<Promise<Result>>(nativePromiseFinally, start(), [onFinally]);
        },
        then<Fulfilled = Result, Rejected = never>(
          onFulfilled?: ((value: Result) => Fulfilled | PromiseLike<Fulfilled>) | null,
          onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
        ): Promise<Fulfilled | Rejected> {
          return apply<Promise<Fulfilled | Rejected>>(nativePromiseThen, start(), [
            onFulfilled,
            onRejected,
          ]);
        },
        [nativePromiseToStringTag]: 'Promise',
      };
      return lazy;
    },
    status() {
      return { callbackFailed, callbackFailure, invocations: calls, settled, started, violated };
    },
  };
  return continuation;
}

/** Run an adapter, observe its return, and reject unless one continuation settles in its frame. */
export async function runExactlyOnceAdapter<Argument, Result, AdapterResult>(
  adapter: (run: (argument: Argument) => Promise<Result>) => Promise<AdapterResult> | AdapterResult,
  callback: (argument: Argument) => Promise<Result> | Result,
): Promise<Result> {
  let callbackCompleted = false;
  let callbackResult: Result | undefined;
  const continuation = exactlyOnceContinuation(async (argument: Argument) => {
    const value = (await callback(argument)) as Result;
    callbackCompleted = true;
    callbackResult = value;
    return value;
  });
  let failed = false;
  let failure: unknown;
  let adapterResult: Promise<AdapterResult> | AdapterResult | undefined;
  try {
    adapterResult = adapter(continuation.run);
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (!failed) {
    try {
      await adapterResult;
    } catch (error) {
      failed = true;
      failure = error;
    }
  }
  continuation.close();
  await continuation.quiesce();
  const status = continuation.status();
  // An adapter can fail during transaction setup before it is able to invoke the continuation.
  // No callback authority ran in that case, so preserve the original setup failure. Once an
  // invocation exists, cardinality/observation violations remain authoritative and fail closed.
  if (failed && status.invocations === 0) throw failure;
  if (status.violated) {
    throw new NativeTypeError('Framework continuation adapter must await exactly one invocation.');
  }
  if (!failed && status.callbackFailed) throw status.callbackFailure;
  if (failed) throw failure;
  if (!callbackCompleted) {
    throw new NativeTypeError('Framework continuation did not produce a callback result.');
  }
  // The adapter owns transaction scheduling/commit, not result authority. Once it has completed
  // exactly one callback, return the callback's settled truth even if the adapter substitutes a
  // different success value (SPEC §10.3/§11.4).
  return callbackResult as Result;
}
