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
  isUnstartedResult(value: unknown): boolean;
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
    isUnstartedResult(value) {
      return value === lazyResult && !started;
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
      lazyResult = lazy;
      return lazy;
    },
    status() {
      return { callbackFailed, callbackFailure, violated };
    },
  };
  let lazyResult: unknown;
  return continuation;
}

/** Run an adapter and reject unless it awaited the supplied continuation exactly once. */
export async function runExactlyOnceAdapter<Argument, Result, AdapterResult>(
  adapter: (run: (argument: Argument) => Promise<Result>) => Promise<AdapterResult> | AdapterResult,
  callback: (argument: Argument) => Promise<Result> | Result,
): Promise<AdapterResult> {
  const continuation = exactlyOnceContinuation(callback);
  let failed = false;
  let failure: unknown;
  let result: AdapterResult | undefined;
  let adapterResult: Promise<AdapterResult> | AdapterResult | undefined;
  try {
    adapterResult = adapter(continuation.run);
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (!failed && continuation.isUnstartedResult(adapterResult)) {
    continuation.close();
    await continuation.quiesce();
    throw new NativeTypeError('Framework continuation adapter must await exactly one invocation.');
  }
  if (!failed) {
    try {
      result = await adapterResult;
    } catch (error) {
      failed = true;
      failure = error;
    }
  }
  continuation.close();
  await continuation.quiesce();
  const status = continuation.status();
  if (status.violated) {
    throw new NativeTypeError('Framework continuation adapter must await exactly one invocation.');
  }
  if (!failed && status.callbackFailed) throw status.callbackFailure;
  if (failed) throw failure;
  return result as AdapterResult;
}
