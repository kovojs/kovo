const NativeAbortController = AbortController;
const NativeHeaders = Headers;
const NativeRequest = Request;
const authorityNeutralCloneFactories = new WeakMap<Request, () => Request>();
const authorityNeutralMetadataSources = new WeakMap<Request, Request>();
const nativeRequestClone = Object.getOwnPropertyDescriptor(Request.prototype, 'clone')
  ?.value as unknown;
const nativeRequestHeaders = Object.getOwnPropertyDescriptor(Request.prototype, 'headers')?.get;
const nativeHeadersEntries = Object.getOwnPropertyDescriptor(Headers.prototype, 'entries')
  ?.value as unknown;
const nativeAbortControllerAbort = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  'abort',
)?.value as unknown;
const nativeAbortControllerSignal = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  'signal',
)?.get;
const abortSignalAbortedDescriptor = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
);
const nativeAbortSignalAborted = abortSignalAbortedDescriptor
  ? (Reflect.get(abortSignalAbortedDescriptor, 'get') as unknown)
  : undefined;
const nativeAddEventListener = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as unknown;

/** Invoke the captured Web Request clone intrinsic on a known native carrier. */
export function cloneNativeRequest(request: Request): Request {
  if (typeof nativeRequestClone !== 'function') {
    throw new TypeError('The Web Request implementation lacks a clone method.');
  }
  return Reflect.apply(nativeRequestClone, request, []) as Request;
}

/** Construct with the import-time Web intrinsic, never a later app-replaced global. */
export function createNativeRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  return new NativeRequest(input, init);
}

/** Clone headers with the import-time Web intrinsic, never a later app-replaced global. */
export function createNativeHeaders(init?: HeadersInit): Headers {
  return new NativeHeaders(init);
}

/** Test with the import-time Web Request brand intrinsic. */
export function isNativeRequest(value: unknown): value is Request {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  const source = authorityNeutralMetadataSources.get(value as Request) ?? value;
  if (typeof nativeRequestHeaders !== 'function') return false;
  try {
    Reflect.apply(nativeRequestHeaders, source, []);
    return true;
  } catch {
    return false;
  }
}

/** Test with the import-time Web Headers brand intrinsic. */
export function isNativeHeaders(value: unknown): value is Headers {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (typeof nativeHeadersEntries !== 'function') return false;
  try {
    Reflect.apply(nativeHeadersEntries, value, []);
    return true;
  } catch {
    return false;
  }
}

/** Test with the import-time Web AbortSignal brand intrinsic. */
export function isNativeAbortSignal(value: unknown): value is AbortSignal {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  if (typeof nativeAbortSignalAborted !== 'function') return false;
  try {
    Reflect.apply(nativeAbortSignalAborted, value, []);
    return true;
  } catch {
    return false;
  }
}

/** Register the only framework-owned way to unwrap a Request compatibility carrier safely. */
export function registerAuthorityNeutralRequestClone(
  carrier: Request,
  clone: () => Request,
  metadataSource: Request,
): void {
  authorityNeutralCloneFactories.set(carrier, clone);
  authorityNeutralMetadataSources.set(carrier, metadataSource);
}

/** Clone a framework carrier without trusting an app-overridable public method. */
export function cloneRequestForAuthorityNeutralization(request: Request): Request {
  return authorityNeutralCloneFactories.get(request)?.() ?? cloneNativeRequest(request);
}

/** Resolve a genuine carrier for bodyless metadata reads without teeing or consuming its body. */
export function requestForAuthorityNeutralMetadata(request: Request): Request {
  return authorityNeutralMetadataSources.get(request) ?? request;
}

/** Register a framework property/provenance Proxy with its genuine metadata carrier. */
export function registerAuthorityNeutralRequestMetadata(
  carrier: Request,
  metadataSource: Request,
): void {
  authorityNeutralMetadataSources.set(carrier, metadataSource);
}

/** Mirror cancellation timing while discarding an arbitrary caller-controlled abort reason. */
export function authorityNeutralAbortSignal(source: AbortSignal): AbortSignal {
  if (
    typeof nativeAbortControllerAbort !== 'function' ||
    typeof nativeAbortControllerSignal !== 'function' ||
    typeof nativeAbortSignalAborted !== 'function' ||
    typeof nativeAddEventListener !== 'function'
  ) {
    throw new TypeError('The Web AbortSignal implementation lacks required intrinsics.');
  }

  const controller = new NativeAbortController();
  const signal = Reflect.apply(nativeAbortControllerSignal, controller, []) as AbortSignal;
  const abort = (): void => {
    if (!(Reflect.apply(nativeAbortSignalAborted, signal, []) as boolean)) {
      Reflect.apply(nativeAbortControllerAbort, controller, []);
    }
  };
  if (Reflect.apply(nativeAbortSignalAborted, source, []) as boolean) {
    abort();
    return signal;
  }
  Reflect.apply(nativeAddEventListener, source, ['abort', abort, { once: true }]);
  // Close the check/listen race without ever copying `source.reason`.
  if (Reflect.apply(nativeAbortSignalAborted, source, []) as boolean) abort();
  return signal;
}
