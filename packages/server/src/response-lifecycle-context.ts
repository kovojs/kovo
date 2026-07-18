import {
  formHelperAsyncLocalGetStore,
  formHelperAsyncLocalRun,
  formHelperCreateAsyncLocalStorage,
  formHelperIsPromise,
  formHelperPromiseThen,
} from './jsx-form-helper-intrinsics.js';
import {
  createWitnessSet,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessSetAdd,
  witnessSetForEach,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

interface ResponseLifecycleContext {
  readonly canonicalRequest: object;
  readonly key: object;
  /** Exact framework-owned Set-Cookie values minted while this response can still carry them. */
  readonly pendingSetCookies: Set<string>;
}

const responseLifecycleStorage = formHelperCreateAsyncLocalStorage<
  ResponseLifecycleContext | undefined
>();
const responseLifecycleContexts = createWitnessWeakMap<object, ResponseLifecycleContext>();
const sealedResponseLifecycleContexts = createWitnessWeakSet<object>();

function responseLifecycleContextForRequest(
  request: unknown,
): ResponseLifecycleContext | undefined {
  if ((typeof request === 'object' || typeof request === 'function') && request !== null) {
    const exact = witnessWeakMapGet(responseLifecycleContexts, request as object);
    if (exact !== undefined) return exact;
  }
  return formHelperAsyncLocalGetStore(responseLifecycleStorage);
}

/** @internal Run authored response construction in one non-forgeable async lifecycle frame. */
export function runWithResponseLifecycleRequest<Value>(
  key: unknown,
  canonicalRequest: unknown,
  callback: () => Value,
): Value {
  if ((typeof key !== 'object' && typeof key !== 'function') || key === null) {
    throw new TypeError('A response lifecycle requires an exact response key.');
  }
  if (
    (typeof canonicalRequest !== 'object' && typeof canonicalRequest !== 'function') ||
    canonicalRequest === null
  ) {
    throw new TypeError('A response lifecycle requires an exact canonical request.');
  }
  const exactKey = key as object;
  const exactCanonicalRequest = canonicalRequest as object;
  const current = formHelperAsyncLocalGetStore(responseLifecycleStorage);
  if (current?.key === exactKey) {
    const canonicalContext = witnessWeakMapGet(responseLifecycleContexts, exactCanonicalRequest);
    if (canonicalContext !== undefined && canonicalContext !== current) {
      throw new TypeError('A canonical request cannot belong to two response lifecycles.');
    }
    witnessWeakMapSet(responseLifecycleContexts, exactCanonicalRequest, current);
    return callback();
  }
  let context = witnessWeakMapGet(responseLifecycleContexts, exactKey);
  if (context === undefined) {
    context = witnessFreeze({
      canonicalRequest: exactCanonicalRequest,
      key: exactKey,
      pendingSetCookies: createWitnessSet<string>(),
    });
    witnessWeakMapSet(responseLifecycleContexts, exactKey, context);
  } else if (context.canonicalRequest !== exactCanonicalRequest) {
    throw new TypeError('A response lifecycle key cannot be rebound to another request.');
  }
  const canonicalContext = witnessWeakMapGet(responseLifecycleContexts, exactCanonicalRequest);
  if (canonicalContext !== undefined && canonicalContext !== context) {
    throw new TypeError('A canonical request cannot belong to two response lifecycles.');
  }
  witnessWeakMapSet(responseLifecycleContexts, exactCanonicalRequest, context);
  let result: Value;
  try {
    result = formHelperAsyncLocalRun(responseLifecycleStorage, context, callback);
  } catch (error) {
    witnessWeakSetAdd(sealedResponseLifecycleContexts, context);
    throw error;
  }
  if (formHelperIsPromise(result)) {
    return formHelperPromiseThen(
      result,
      (value) => value,
      (error) => {
        witnessWeakSetAdd(sealedResponseLifecycleContexts, context);
        throw error;
      },
    ) as Value;
  }
  return result;
}

/**
 * Run a distinct request-handler dispatch without inheriting its caller's ambient response frame.
 * The nested handler opens its own managed lifecycle only after its pre-dispatch gates succeed.
 *
 * Exact retained requests must additionally be cloned at handler ingress because exact identity
 * intentionally outranks ambient context everywhere else. AsyncLocalStorage's explicit undefined
 * store keeps unrelated `new Request(...)` nested dispatches out of the caller's frame too.
 *
 * @internal App request-handler response boundary; not exported from a package entrypoint.
 */
export function runWithoutResponseLifecycleContext<Value>(callback: () => Value): Value {
  return formHelperAsyncLocalRun(responseLifecycleStorage, undefined, callback);
}

/** @internal Resolve the response-owned state key for a helper call in the current async frame. */
export function responseLifecycleStateRoot(request: object): object {
  return responseLifecycleContextForRequest(request)?.key ?? request;
}

/**
 * Resolve only an exact retained response carrier, without inheriting an ambient nested frame.
 *
 * Response finalizers use this boundary for an explicit request identity that may have returned
 * before a lifecycle was opened. Falling back to AsyncLocalStorage there would let an inner early
 * return seal or personalize its caller's still-open outer response.
 *
 * @internal Exact response-finalization bridge; not exported from a package entrypoint.
 */
export function responseLifecycleExactStateRoot(request: object): object {
  return witnessWeakMapGet(responseLifecycleContexts, request)?.key ?? request;
}

/** @internal Resolve the canonical lifecycle request for authority reads in this response frame. */
export function responseLifecycleCanonicalRequest<Request>(fallback: Request): Request {
  return (
    (responseLifecycleContextForRequest(fallback)?.canonicalRequest as Request | undefined) ??
    fallback
  );
}

/**
 * Retain a request carrier only when a managed response lifecycle already owns the current async
 * frame. Direct route/endpoint runners cannot create a cookie-delivery receipt through this bridge.
 *
 * @internal Managed route authorization carrier bridge.
 */
export function retainCurrentResponseLifecycleRequest(request: object): void {
  const current = formHelperAsyncLocalGetStore(responseLifecycleStorage);
  if (current === undefined) return;
  const retained = witnessWeakMapGet(responseLifecycleContexts, request);
  if (retained !== undefined && retained !== current) {
    throw new TypeError('A request cannot belong to two response lifecycles.');
  }
  witnessWeakMapSet(responseLifecycleContexts, request, current);
}

/** @internal Whether a first anonymous response mint has a cookie-delivery lifecycle receipt. */
export function hasResponseLifecycleReceipt(request: unknown): boolean {
  return responseLifecycleContextForRequest(request) !== undefined;
}

/**
 * Whether this exact request identity is already retained by a response lifecycle.
 *
 * A nested `createRequestHandler()` invocation can receive the same Web `Request` object as its
 * caller. That new response must be rekeyed before dispatch: otherwise its finalizer would resolve
 * the exact identity back to the caller's context and could seal or consume the outer response.
 * Ambient context alone is deliberately not enough here; an ordinary new/derived Request already
 * receives its own lifecycle when the nested dispatcher reaches its response surface.
 *
 * @internal Request-handler ingress isolation bridge; not exported from a package entrypoint.
 */
export function hasExactResponseLifecycleReceipt(request: unknown): boolean {
  return (
    (typeof request === 'object' || typeof request === 'function') &&
    request !== null &&
    witnessWeakMapGet(responseLifecycleContexts, request as object) !== undefined
  );
}

/** @internal Mark the retained response frame whose headers can no longer change. */
export function sealResponseLifecycleRequest(request: object): void {
  const context = witnessWeakMapGet(responseLifecycleContexts, request);
  if (context !== undefined) witnessWeakSetAdd(sealedResponseLifecycleContexts, context);
}

/**
 * Record a framework-owned cookie while response headers are still mutable.
 *
 * This check and insertion are deliberately synchronous: once finalization seals the private
 * lifecycle context, no stream callback or queued microtask can add authority to the snapshot that
 * is about to cross the wire.
 *
 * @internal CSRF response-authority bridge; not exported from a package entrypoint.
 */
export function recordResponseLifecycleSetCookie(request: object, rawSetCookie: string): void {
  const context = responseLifecycleContextForRequest(request);
  if (context === undefined) {
    throw new Error(
      'Anonymous CSRF authority cannot be minted without a framework response lifecycle that can deliver its binding cookie.',
    );
  }
  if (witnessWeakSetHas(sealedResponseLifecycleContexts, context)) {
    throw new Error(
      'Anonymous CSRF authority cannot be minted after response headers were committed because its binding cookie can no longer reach the browser.',
    );
  }
  witnessSetAdd(context.pendingSetCookies, rawSetCookie);
}

/**
 * Atomically commit response headers and snapshot every framework-owned cookie minted beforehand.
 * Repeated calls return the same exact snapshot; callers perform exact deduplication at the sink.
 *
 * @internal Response-finalization bridge; not exported from a package entrypoint.
 */
export function sealResponseLifecycleRequestAndSnapshotSetCookies(
  request: object,
): readonly string[] {
  const context = witnessWeakMapGet(responseLifecycleContexts, request);
  if (context === undefined) return witnessFreeze([] as string[]);

  witnessWeakSetAdd(sealedResponseLifecycleContexts, context);
  const snapshot: string[] = [];
  witnessSetForEach(context.pendingSetCookies, (rawSetCookie) => {
    witnessDefineProperty(snapshot, snapshot.length, {
      configurable: true,
      enumerable: true,
      value: rawSetCookie,
      writable: true,
    });
  });
  return witnessFreeze(snapshot);
}

/** @internal Whether the exact retained context or current authored response committed headers. */
export function responseLifecycleHeadersCommitted(request: object): boolean {
  const context = responseLifecycleContextForRequest(request);
  return context !== undefined && witnessWeakSetHas(sealedResponseLifecycleContexts, context);
}
