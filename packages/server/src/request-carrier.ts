import {
  createWitnessWeakMap,
  witnessGetOwnPropertyDescriptor,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const NativeAbortController = AbortController;
const NativeHeaders = Headers;
const NativeRequest = Request;
const authorityNeutralCloneFactories = createWitnessWeakMap<Request, () => Request>();
const authorityNeutralMetadataSources = createWitnessWeakMap<Request, Request>();
const nativeRequestClone = witnessGetOwnPropertyDescriptor(Request.prototype, 'clone')
  ?.value as unknown;
const nativeRequestHeaders = witnessGetOwnPropertyDescriptor(Request.prototype, 'headers')?.get;
const nativeHeadersEntries = witnessGetOwnPropertyDescriptor(Headers.prototype, 'entries')
  ?.value as unknown;
const nativeAbortControllerAbort = witnessGetOwnPropertyDescriptor(
  AbortController.prototype,
  'abort',
)?.value as unknown;
const nativeAbortControllerSignal = witnessGetOwnPropertyDescriptor(
  AbortController.prototype,
  'signal',
)?.get;
const abortSignalAbortedDescriptor = witnessGetOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
);
const nativeAbortSignalAborted = abortSignalAbortedDescriptor
  ? witnessReflectGet(abortSignalAbortedDescriptor, 'get')
  : undefined;
const nativeAddEventListener = witnessGetOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as unknown;

/** Invoke the captured Web Request clone intrinsic on a known native carrier. */
export function cloneNativeRequest(request: Request): Request {
  if (typeof nativeRequestClone !== 'function') {
    throw new TypeError('The Web Request implementation lacks a clone method.');
  }
  return witnessReflectApply(nativeRequestClone, request, []);
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
  const source = witnessWeakMapGet(authorityNeutralMetadataSources, value as Request) ?? value;
  if (typeof nativeRequestHeaders !== 'function') return false;
  try {
    witnessReflectApply(nativeRequestHeaders, source, []);
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
    witnessReflectApply(nativeHeadersEntries, value, []);
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
    witnessReflectApply(nativeAbortSignalAborted, value, []);
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
  witnessWeakMapSet(authorityNeutralCloneFactories, carrier, clone);
  witnessWeakMapSet(authorityNeutralMetadataSources, carrier, metadataSource);
}

/** Clone a framework carrier without trusting an app-overridable public method. */
export function cloneRequestForAuthorityNeutralization(request: Request): Request {
  return (
    witnessWeakMapGet(authorityNeutralCloneFactories, request)?.() ?? cloneNativeRequest(request)
  );
}

/** Resolve a genuine carrier for bodyless metadata reads without teeing or consuming its body. */
export function requestForAuthorityNeutralMetadata(request: Request): Request {
  return witnessWeakMapGet(authorityNeutralMetadataSources, request) ?? request;
}

/** Register a framework property/provenance Proxy with its genuine metadata carrier. */
export function registerAuthorityNeutralRequestMetadata(
  carrier: Request,
  metadataSource: Request,
): void {
  witnessWeakMapSet(authorityNeutralMetadataSources, carrier, metadataSource);
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
  const signal = witnessReflectApply<AbortSignal>(nativeAbortControllerSignal, controller, []);
  const abort = (): void => {
    if (!witnessReflectApply<boolean>(nativeAbortSignalAborted, signal, [])) {
      witnessReflectApply(nativeAbortControllerAbort, controller, []);
    }
  };
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, source, [])) {
    abort();
    return signal;
  }
  witnessReflectApply(nativeAddEventListener, source, ['abort', abort, { once: true }]);
  // Close the check/listen race without ever copying `source.reason`.
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, source, [])) abort();
  return signal;
}
