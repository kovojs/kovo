import {
  createFrameworkAsyncContextCell,
  currentFrameworkAsyncContextValue,
  runWithRevocableIsolatedFrameworkAsyncContext,
} from './async-context.js';
import {
  createSecurityReadableStream,
  securityResponseBody,
  securityResponseHeaders,
  securityResponseStatus,
  securityResponseStatusText,
  securityStreamClose,
  securityStreamEnqueue,
  securityStreamError,
} from './response-security-intrinsics.js';
import { frameworkDocumentResponseBuildToken, markFrameworkDocumentResponse } from './response.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessFreeze,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

export type RequestDeadlineInterruption = 'deadline' | 'disconnect';

interface RequestDeadlineContext {
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
}

/** @internal Non-forgeable request deadline plus the one-shot occupancy release hook. */
export interface RequestDeadlineAdmission extends RequestDeadlineContext {
  readonly interrupted: Promise<RequestDeadlineInterruption>;
}

type RequestDeadlineTaskOutcome<Value> =
  | { readonly kind: 'interrupted'; readonly reason: RequestDeadlineInterruption }
  | { readonly kind: 'value'; readonly value: Value };

const NativeAbortController = globalThis.AbortController;
const NativeResponse = globalThis.Response;
const nativeAbortControllerAbort = requiredPrototypeFunction(
  NativeAbortController.prototype,
  'abort',
);
const nativeAbortControllerSignal = requiredPrototypeGetter(
  NativeAbortController.prototype,
  'signal',
);
const nativeAbortSignalAborted = requiredPrototypeGetter(AbortSignal.prototype, 'aborted');
const nativeAddEventListener = requiredPrototypeFunction(EventTarget.prototype, 'addEventListener');
const nativeRemoveEventListener = requiredPrototypeFunction(
  EventTarget.prototype,
  'removeEventListener',
);
const nativeReadableStreamGetReader = requiredPrototypeFunction(
  ReadableStream.prototype,
  'getReader',
);
const readerControl = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
  nativeReadableStreamGetReader,
  new ReadableStream<Uint8Array>(),
  [],
);
const readerPrototype = Object.getPrototypeOf(readerControl) as object;
const nativeStreamReaderRead = requiredPrototypeFunction(readerPrototype, 'read');
const nativeStreamReaderCancel = requiredPrototypeFunction(readerPrototype, 'cancel');
const frameworkSetTimeout = globalThis.setTimeout;
const frameworkClearTimeout = globalThis.clearTimeout;
const requestDeadlineContext =
  createFrameworkAsyncContextCell<RequestDeadlineContext>('server.request-deadline');
const requestDeadlineTransportRequests = createWitnessWeakSet<Request>();
const requestDeadlineAdmissions = createWitnessWeakSet<RequestDeadlineAdmission>();
const requestDeadlineTransportAdmissions = createWitnessWeakMap<
  Request,
  RequestDeadlineAdmission
>();
const admissionControls = createWitnessWeakMap<
  RequestDeadlineAdmission,
  {
    complete(): void;
    interruption(): RequestDeadlineInterruption | undefined;
    open(): boolean;
    readonly transportManaged: boolean;
  }
>();

/** @internal Mark a Web request whose adapter owns the final response transport lifecycle. */
export function registerRequestDeadlineTransport(request: Request): void {
  witnessWeakSetAdd(requestDeadlineTransportRequests, request);
}

/** @internal Test whether the ingress adapter can prove actual response finish/close. */
export function requestDeadlineTransportManaged(request: Request): boolean {
  return witnessWeakSetHas(requestDeadlineTransportRequests, request);
}

/** @internal Create one finite deadline capability and bind it to ingress disconnect. */
export function createRequestDeadlineAdmission(options: {
  readonly deadlineMs: number;
  readonly onRelease: () => void;
  readonly sourceSignal: AbortSignal;
  readonly transportManaged?: boolean;
  readonly transportRequest?: Request;
}): RequestDeadlineAdmission {
  const controller = new NativeAbortController();
  const signal = witnessReflectApply<AbortSignal>(nativeAbortControllerSignal, controller, []);
  let interruption: RequestDeadlineInterruption | undefined;
  let released = false;
  let resolveInterrupted!: (reason: RequestDeadlineInterruption) => void;
  const interrupted = new Promise<RequestDeadlineInterruption>((resolve) => {
    resolveInterrupted = resolve;
  });

  const release = (): void => {
    if (released) return;
    released = true;
    frameworkClearTimeout(timer);
    witnessReflectApply(nativeRemoveEventListener, options.sourceSignal, ['abort', disconnect]);
    options.onRelease();
  };
  const abortCapability = (): void => {
    if (!witnessReflectApply<boolean>(nativeAbortSignalAborted, signal, [])) {
      witnessReflectApply(nativeAbortControllerAbort, controller, [
        new RequestDeadlineExceededError(),
      ]);
    }
  };
  const interrupt = (reason: RequestDeadlineInterruption): void => {
    if (interruption !== undefined || released) return;
    interruption = reason;
    // Resolve the discard race before abort listeners can settle authored work with a late value.
    resolveInterrupted(reason);
    abortCapability();
    release();
  };
  const disconnect = (): void => interrupt('disconnect');
  const timer = frameworkSetTimeout(() => interrupt('deadline'), options.deadlineMs);
  // A direct internal pre-dispatch probe must not keep a Node test/process alive solely for cleanup.
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  witnessReflectApply(nativeAddEventListener, options.sourceSignal, [
    'abort',
    disconnect,
    { once: true },
  ]);

  const admission = witnessFreeze({
    deadlineMs: options.deadlineMs,
    interrupted,
    signal,
  });
  witnessWeakSetAdd(requestDeadlineAdmissions, admission);
  witnessWeakMapSet(admissionControls, admission, {
    complete() {
      if (released) return;
      abortCapability();
      release();
    },
    interruption: () => interruption,
    open: () => !released,
    transportManaged: options.transportManaged === true,
  });
  if (options.transportManaged === true && options.transportRequest !== undefined) {
    witnessWeakMapSet(requestDeadlineTransportAdmissions, options.transportRequest, admission);
  }
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, options.sourceSignal, [])) {
    disconnect();
  }
  return admission;
}

/** @internal Run the complete post-admission request path in a revocable deadline lifecycle. */
export async function runRequestDeadlineTask<Value>(
  admission: RequestDeadlineAdmission,
  callback: () => Promise<Value> | Value,
): Promise<RequestDeadlineTaskOutcome<Value>> {
  assertRequestDeadlineAdmission(admission);
  let task;
  try {
    task = runWithRevocableIsolatedFrameworkAsyncContext(
      requestDeadlineContext,
      admission,
      callback,
    );
  } catch (error) {
    completeRequestDeadlineAdmission(admission);
    throw error;
  }
  const result = Promise.resolve(task.result).then(
    (value) => ({ kind: 'value' as const, value }),
    (error) => ({ kind: 'error' as const, error }),
  );
  const interrupted = admission.interrupted.then((reason) => ({
    kind: 'interrupted' as const,
    reason,
  }));
  const outcome = await Promise.race([result, interrupted]);
  if (outcome.kind === 'interrupted') {
    task.revoke();
    return outcome;
  }
  if (outcome.kind === 'error') {
    completeRequestDeadlineAdmission(admission);
    throw outcome.error;
  }
  const lateInterruption = witnessWeakMapGet(admissionControls, admission)?.interruption();
  if (lateInterruption !== undefined) {
    task.revoke();
    return { kind: 'interrupted', reason: lateInterruption };
  }
  return outcome;
}

/** @internal Close the capability and occupancy after an exception or bodyless response. */
export function completeRequestDeadlineAdmission(admission: RequestDeadlineAdmission): void {
  assertRequestDeadlineAdmission(admission);
  witnessWeakMapGet(admissionControls, admission)?.complete();
}

/**
 * @internal Bind a Kovo response to an adapter-owned transport. The returned one-shot callback must
 * run on actual transport finish or close; a deadline before then interrupts the transport.
 */
export function bindRequestDeadlineResponseTransport(
  request: Request,
  onInterrupt: () => void,
): () => void {
  const admission = witnessWeakMapGet(requestDeadlineTransportAdmissions, request);
  const admissionControl =
    admission === undefined ? undefined : witnessWeakMapGet(admissionControls, admission);
  if (admission === undefined || admissionControl?.open() !== true) return () => undefined;
  let completed = false;
  const removeAbortListener = (): void => {
    witnessReflectApply(nativeRemoveEventListener, admission.signal, ['abort', interrupt]);
  };
  const interrupt = (): void => {
    if (completed) return;
    onInterrupt();
  };
  const complete = (): void => {
    if (completed) return;
    completed = true;
    removeAbortListener();
    completeRequestDeadlineAdmission(admission);
  };
  witnessReflectApply(nativeAddEventListener, admission.signal, [
    'abort',
    interrupt,
    { once: true },
  ]);
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, admission.signal, [])) interrupt();
  return complete;
}

/** @internal Wrap a minted response so deadline, cancellation, and body completion release once. */
export function wrapRequestDeadlineResponse(
  admission: RequestDeadlineAdmission,
  response: Response,
  method: string,
): Response {
  assertRequestDeadlineAdmission(admission);
  const transportManaged =
    witnessWeakMapGet(admissionControls, admission)?.transportManaged === true;
  const body = securityResponseBody(response);
  if (method === 'HEAD' || body === null) {
    if (!transportManaged) completeRequestDeadlineAdmission(admission);
    if (body !== null) {
      const reader = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
        nativeReadableStreamGetReader,
        body,
        [],
      );
      void Promise.resolve(
        witnessReflectApply<Promise<void>>(nativeStreamReaderCancel, reader, [
          new RequestDeadlineExceededError(),
        ]),
      ).catch(() => undefined);
    }
    return response;
  }

  const reader = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
    nativeReadableStreamGetReader,
    body,
    [],
  );
  let settled = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const removeAbortListener = (): void => {
    witnessReflectApply(nativeRemoveEventListener, admission.signal, ['abort', abortStream]);
  };
  const settle = (): void => {
    if (settled) return;
    settled = true;
    removeAbortListener();
    if (!transportManaged) completeRequestDeadlineAdmission(admission);
  };
  const abortStream = (): void => {
    if (settled) return;
    settled = true;
    removeAbortListener();
    void Promise.resolve(
      witnessReflectApply<Promise<void>>(nativeStreamReaderCancel, reader, [
        new RequestDeadlineExceededError(),
      ]),
    ).catch(() => undefined);
    if (controller !== undefined) {
      try {
        securityStreamError(controller, new RequestDeadlineExceededError());
      } catch {
        // A concurrent read/cancel may already have closed the wrapper.
      }
    }
  };

  const wrappedBody = createSecurityReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      witnessReflectApply(nativeAddEventListener, admission.signal, [
        'abort',
        abortStream,
        { once: true },
      ]);
      if (witnessReflectApply<boolean>(nativeAbortSignalAborted, admission.signal, [])) {
        abortStream();
      }
    },
    async pull(streamController) {
      if (settled) return;
      try {
        const chunk = await witnessReflectApply<Promise<ReadableStreamReadResult<Uint8Array>>>(
          nativeStreamReaderRead,
          reader,
          [],
        );
        if (settled) return;
        if (chunk.done) {
          securityStreamClose(streamController);
          settle();
          return;
        }
        securityStreamEnqueue(streamController, chunk.value);
      } catch (error) {
        if (settled) return;
        try {
          securityStreamError(streamController, error);
        } finally {
          settle();
        }
      }
    },
    async cancel(reason) {
      if (settled) return;
      settled = true;
      removeAbortListener();
      try {
        await witnessReflectApply<Promise<void>>(nativeStreamReaderCancel, reader, [reason]);
      } finally {
        if (!transportManaged) completeRequestDeadlineAdmission(admission);
      }
    },
  });

  const wrappedResponse = new NativeResponse(wrappedBody, {
    headers: securityResponseHeaders(response),
    status: securityResponseStatus(response),
    statusText: securityResponseStatusText(response),
  });
  // SPEC §5.2.1/§9.5: body wrapping may not erase the private proof that authorizes Kovo-Build on
  // framework-assembled documents. Static export consumes this identity witness and still rejects
  // structurally forged reserved headers.
  const buildToken = frameworkDocumentResponseBuildToken(response);
  return buildToken === undefined
    ? wrappedResponse
    : markFrameworkDocumentResponse(wrappedResponse, buildToken);
}

/** @internal Deadline signal inherited by every Kovo-owned effect door in this request lifecycle. */
export function currentRequestDeadlineSignal(): AbortSignal | undefined {
  return currentFrameworkAsyncContextValue(requestDeadlineContext)?.signal;
}

/** @internal Subscribe an owned effect to the current request deadline through pinned controls. */
export function onCurrentRequestDeadline(callback: () => void): () => void {
  const signal = currentRequestDeadlineSignal();
  if (signal === undefined) return () => undefined;
  let listening = true;
  const remove = (): void => {
    if (!listening) return;
    listening = false;
    witnessReflectApply(nativeRemoveEventListener, signal, ['abort', abort]);
  };
  const abort = (): void => {
    remove();
    callback();
  };
  witnessReflectApply(nativeAddEventListener, signal, ['abort', abort, { once: true }]);
  if (witnessReflectApply<boolean>(nativeAbortSignalAborted, signal, [])) abort();
  return remove;
}

/** @internal Reject an owned effect that starts after its request deadline. */
export function assertCurrentRequestDeadlineActive(label: string): void {
  const signal = currentRequestDeadlineSignal();
  if (signal !== undefined && witnessReflectApply<boolean>(nativeAbortSignalAborted, signal, [])) {
    throw new RequestDeadlineExceededError(label);
  }
}

/** @internal Compose an effect-local cancellation source with the mandatory request deadline. */
export function composeCurrentRequestDeadlineSignal(signal: AbortSignal): AbortSignal {
  const deadlineSignal = currentRequestDeadlineSignal();
  if (deadlineSignal === undefined || deadlineSignal === signal) return signal;
  const controller = new NativeAbortController();
  const composed = witnessReflectApply<AbortSignal>(nativeAbortControllerSignal, controller, []);
  let completed = false;
  const abort = (): void => {
    if (completed) return;
    completed = true;
    witnessReflectApply(nativeRemoveEventListener, signal, ['abort', abort]);
    witnessReflectApply(nativeRemoveEventListener, deadlineSignal, ['abort', abort]);
    witnessReflectApply(nativeAbortControllerAbort, controller, [
      new RequestDeadlineExceededError(),
    ]);
  };
  witnessReflectApply(nativeAddEventListener, signal, ['abort', abort, { once: true }]);
  witnessReflectApply(nativeAddEventListener, deadlineSignal, ['abort', abort, { once: true }]);
  if (
    witnessReflectApply<boolean>(nativeAbortSignalAborted, signal, []) ||
    witnessReflectApply<boolean>(nativeAbortSignalAborted, deadlineSignal, [])
  ) {
    abort();
  }
  return composed;
}

/** @internal Bound a framework-owned async wait even when its underlying API cannot be preempted. */
export function awaitWithCurrentRequestDeadline<Value>(
  pending: Promise<Value>,
  label: string,
): Promise<Value> {
  const signal = currentRequestDeadlineSignal();
  if (signal === undefined) return pending;
  assertCurrentRequestDeadlineActive(label);
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => {
      witnessReflectApply(nativeRemoveEventListener, signal, ['abort', abort]);
      reject(new RequestDeadlineExceededError(label));
    };
    witnessReflectApply(nativeAddEventListener, signal, ['abort', abort, { once: true }]);
    pending.then(
      (value) => {
        witnessReflectApply(nativeRemoveEventListener, signal, ['abort', abort]);
        resolve(value);
      },
      (error) => {
        witnessReflectApply(nativeRemoveEventListener, signal, ['abort', abort]);
        reject(error);
      },
    );
  });
}

/** @internal Read one ingress chunk without delaying the body's own cancellation checkpoint. */
export function readRequestBodyChunkWithCurrentDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const signal = currentRequestDeadlineSignal();
  if (signal === undefined) {
    return witnessReflectApply<Promise<ReadableStreamReadResult<Uint8Array>>>(
      nativeStreamReaderRead,
      reader,
      [],
    );
  }
  assertCurrentRequestDeadlineActive('request body read');
  const abort = (): void => {
    void Promise.resolve(
      witnessReflectApply<Promise<void>>(nativeStreamReaderCancel, reader, [
        new RequestDeadlineExceededError('request body read'),
      ]),
    ).catch(() => undefined);
  };
  witnessReflectApply(nativeAddEventListener, signal, ['abort', abort, { once: true }]);
  // Return the native read promise itself. Wrapping its fulfillment in another promise race or
  // async-function result lets a one-chunk-ahead source close before the limiter can cancel an
  // oversized first chunk.
  const pending = witnessReflectApply<Promise<ReadableStreamReadResult<Uint8Array>>>(
    nativeStreamReaderRead,
    reader,
    [],
  );
  const remove = (): void => {
    witnessReflectApply(nativeRemoveEventListener, signal, ['abort', abort]);
  };
  void pending.then(remove, remove);
  return pending;
}

/** @internal Stable non-secret cancellation reason for logs, streams, and owned effects. */
export class RequestDeadlineExceededError extends Error {
  constructor(label = 'request') {
    super(`Kovo ${label} deadline expired.`);
    this.name = 'RequestDeadlineExceededError';
  }
}

function assertRequestDeadlineAdmission(admission: RequestDeadlineAdmission): void {
  if (!witnessWeakSetHas(requestDeadlineAdmissions, admission)) {
    throw new TypeError('Request deadline admission was not minted by this runtime.');
  }
}

function requiredPrototypeFunction(prototype: object, property: PropertyKey): Function {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`Kovo request deadline control ${String(property)} is unavailable.`);
  }
  return descriptor.value;
}

function requiredPrototypeGetter(prototype: object, property: PropertyKey): Function {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (descriptor === undefined || typeof descriptor.get !== 'function') {
    throw new TypeError(`Kovo request deadline getter ${String(property)} is unavailable.`);
  }
  return descriptor.get;
}
