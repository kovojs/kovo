import { createBrowserKovoRoot } from './browser-root.js';
import { definedProps } from './defined-props.js';
import type {
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationResponseLike,
  UploadProgress,
} from './mutation-fetch.js';
import {
  installGeneratedKovoLoader,
  type KovoGeneratedEnhancedMutationOptions,
  type KovoGeneratedLoader,
  type KovoGeneratedLoaderOptions,
} from './loader.js';
import { createQueryStore, type QueryStore } from './query-store.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securitySet,
  securitySetAdd,
  securitySetDelete,
  securitySetForEach,
  securityWeakMap,
  securityWeakMapDelete,
  securityWeakMapGet,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

const IntrinsicAbortController = globalThis.AbortController;
const IntrinsicAbortSignal = globalThis.AbortSignal;
const IntrinsicEventTarget = globalThis.EventTarget;
const IntrinsicHeaders = globalThis.Headers;
const IntrinsicPromise = Promise;
const IntrinsicRequest = globalThis.Request;
const intrinsicAbort = IntrinsicAbortController
  ? securityGetOwnPropertyDescriptor(IntrinsicAbortController.prototype, 'abort')?.value
  : undefined;
const intrinsicAbortSignal = IntrinsicAbortController
  ? capturedGetter(IntrinsicAbortController.prototype, 'signal')
  : undefined;
const intrinsicAbortSignalAborted = IntrinsicAbortSignal
  ? capturedGetter(IntrinsicAbortSignal.prototype, 'aborted')
  : undefined;
const intrinsicAbortSignalReason = IntrinsicAbortSignal
  ? capturedGetter(IntrinsicAbortSignal.prototype, 'reason')
  : undefined;
const intrinsicAddEventListener = IntrinsicEventTarget
  ? securityGetOwnPropertyDescriptor(IntrinsicEventTarget.prototype, 'addEventListener')?.value
  : undefined;
const intrinsicRemoveEventListener = IntrinsicEventTarget
  ? securityGetOwnPropertyDescriptor(IntrinsicEventTarget.prototype, 'removeEventListener')?.value
  : undefined;
const intrinsicHeadersForEach = IntrinsicHeaders
  ? securityGetOwnPropertyDescriptor(IntrinsicHeaders.prototype, 'forEach')?.value
  : undefined;
const intrinsicPromiseAll = securityGetOwnPropertyDescriptor(IntrinsicPromise, 'all')?.value;
const intrinsicPromiseThen = securityGetOwnPropertyDescriptor(
  IntrinsicPromise.prototype,
  'then',
)?.value;
const intrinsicRequestCredentials = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'credentials')
  : undefined;
const intrinsicRequestHeaders = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'headers')
  : undefined;
const intrinsicRequestKeepalive = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'keepalive')
  : undefined;
const intrinsicRequestMethod = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'method')
  : undefined;
const intrinsicRequestRedirect = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'redirect')
  : undefined;
const intrinsicRequestReferrerPolicy = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'referrerPolicy')
  : undefined;
const intrinsicRequestSignal = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'signal')
  : undefined;
const intrinsicRequestUrl = IntrinsicRequest
  ? capturedGetter(IntrinsicRequest.prototype, 'url')
  : undefined;
const platformFetch = globalThis.fetch;
const clientBrowserSecurity = createBrowserNavigationSecurityControls();
const clientLoadedWithDocument = globalThis.document !== undefined && globalThis.document !== null;

type ClientRoot = EventTarget & ParentNode;
type DisposeMode = 'abort' | 'drain';
type LifecycleReason = 'session-transition' | 'user';
type LifecyclePhase = 'disposed' | 'disposing' | 'ready' | 'session-transition';

interface ClientState {
  accepting: boolean;
  aborting: boolean;
  controllers: Set<AbortController>;
  disposePromise?: Promise<void>;
  loader?: KovoGeneratedLoader;
  operations: Set<Promise<unknown>>;
  fetchObserver?: InstallKovoClientOptions['fetch'];
  onError?: InstallKovoClientOptions['onError'];
  onLifecycle?: InstallKovoClientOptions['onLifecycle'];
  onUploadProgress?: InstallKovoClientOptions['onUploadProgress'];
  root: ClientRoot;
  store: QueryStore;
}

const activeClients = securityWeakMap<object, ClientState>();

/** @internal Request transport configuration kept outside the public client barrel. */
export interface KovoClientMutationTransportOptions {
  dispatch(request: Request): Promise<Response>;
  isActive(): boolean;
  observe?: InstallKovoClientOptions['fetch'];
  onControllerFinish?(controller: AbortController): void;
  onControllerStart?(controller: AbortController): void;
}

/**
 * The one app-authored browser bootstrap for a custom shell.
 *
 * Kovo owns the query store, morph root, mutation transport, request posture,
 * module allowlist snapshot, and runtime caches. Generated applications do not
 * need this API: the compiler emits the equivalent generated-runtime bootstrap.
 *
 * @experimental
 */
export interface InstallKovoClientOptions {
  /**
   * Observe or wrap an allowed dynamic import. The URL is still checked against
   * the compiler/document module registry before this callback runs.
   */
  importModule?: (url: string) => Promise<Record<string, unknown>>;
  /**
   * Observe one framework-constructed mutation request. `next()` is zero-argument,
   * single-use, and always dispatches that exact request through the boot-pinned
   * platform fetch. Returning a different response is rejected.
   */
  fetch?: (
    request: Request,
    next: () => Promise<Response>,
    reportUploadProgress: (progress: { loaded: number; total?: number }) => void,
  ) => Promise<Response>;
  onError?: (error: unknown, context: { phase: string }) => void;
  onLifecycle?: (event: {
    mode?: 'abort' | 'drain';
    phase: 'disposed' | 'disposing' | 'ready' | 'session-transition';
    reason?: 'session-transition' | 'user';
  }) => void;
  onUploadProgress?: (progress: { loaded: number; total?: number }, form: unknown) => void;
  /** Delegation and live-fragment root. Defaults to the current `document`. */
  root?: EventTarget & ParentNode;
}

/**
 * Handle returned by {@link installKovoClient}.
 *
 * `dispose('drain')` (the default) removes listeners immediately, waits for
 * already-started imports and requests to settle, then clears internal state.
 * `dispose('abort')` removes listeners, aborts active requests, rejects late
 * imports, and clears state without waiting for authored wrappers.
 */
export interface KovoClient {
  readonly ready: Promise<void>;
  dispose(mode?: 'abort' | 'drain'): Promise<void>;
}

/**
 * Install Kovo's browser runtime for a custom shell.
 *
 * @experimental
 */
export function installKovoClient(options: InstallKovoClientOptions = {}): KovoClient {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Kovo client options must be an object.');
  }
  const root = resolveClientRoot(options);
  if (securityWeakMapGet(activeClients, root) !== undefined) {
    throw new TypeError('Kovo client is already installed on this root.');
  }

  const fetchObserver = ownDataOption(options, 'fetch');
  const onError = ownDataOption(options, 'onError');
  const onLifecycle = ownDataOption(options, 'onLifecycle');
  const onUploadProgress = ownDataOption(options, 'onUploadProgress');
  assertOptionalClientFunction(fetchObserver, 'fetch');
  assertOptionalClientFunction(onError, 'onError');
  assertOptionalClientFunction(onLifecycle, 'onLifecycle');
  assertOptionalClientFunction(onUploadProgress, 'onUploadProgress');

  const state: ClientState = {
    accepting: true,
    aborting: false,
    controllers: securitySet(),
    fetchObserver,
    onError,
    onLifecycle,
    onUploadProgress,
    operations: securitySet(),
    root,
    store: createQueryStore(),
  };
  securityWeakMapSet(activeClients, root, state);

  try {
    const importModule = createTrackedImporter(
      state,
      ownDataOption(options, 'importModule') ?? defaultImportModule,
    );
    const runtimeRoot = createBrowserKovoRoot({ documentRoot: root });
    const enhancedFetch = createClientMutationFetch(state);
    state.loader = installGeneratedKovoLoader({
      enhancedMutations: {
        fetch: enhancedFetch,
        onError(error) {
          reportClientError(state, error, 'enhanced-mutation');
        },
        onSessionTransition() {
          beginSessionTransition(state);
        },
        onUploadProgress(progress, form) {
          reportClientUploadProgress(state, progress, form);
        },
        root: runtimeRoot as KovoGeneratedEnhancedMutationOptions['root'],
        store: state.store,
      },
      importModule,
      onError(error, context) {
        reportClientError(state, error, context.phase);
      },
      queryStore: state.store,
      root: root as KovoGeneratedLoaderOptions['root'],
    });
  } catch (error) {
    state.accepting = false;
    state.aborting = true;
    securityWeakMapDelete(activeClients, root);
    abortClientRequests(state);
    state.store.clear();
    throw error;
  }

  const ready = resolvedVoidPromise();
  notifyLifecycle(state, 'ready');
  return {
    dispose(mode: DisposeMode = 'drain') {
      if (mode !== 'abort' && mode !== 'drain') {
        throw new TypeError('Kovo client dispose mode must be "abort" or "drain".');
      }
      return beginClientDispose(state, mode, 'user');
    },
    ready,
  };
}

function resolveClientRoot(options: InstallKovoClientOptions): ClientRoot {
  const root = ownDataOption(options, 'root');
  const resolved = root ?? (typeof document === 'undefined' ? undefined : document);
  if (
    resolved === undefined ||
    resolved === null ||
    typeof resolved !== 'object' ||
    stableClientMethod(resolved, 'addEventListener') === undefined ||
    stableClientMethod(resolved, 'querySelectorAll') === undefined
  ) {
    throw new TypeError('Kovo client requires a DOM root with event and query-selector support.');
  }
  return resolved as ClientRoot;
}

function createTrackedImporter(
  state: ClientState,
  importer: (url: string) => Promise<Record<string, unknown>>,
): (url: string) => Promise<Record<string, unknown>> {
  if (typeof importer !== 'function') {
    throw new TypeError('Kovo client importModule must be a function.');
  }
  return (url) =>
    trackClientOperation(
      state,
      (async () => {
        if (!state.accepting) throw clientDisposedError();
        const module = await importer(url);
        if (state.aborting) throw clientDisposedError();
        if (module === null || typeof module !== 'object') {
          throw new TypeError('Kovo client module imports must resolve to module records.');
        }
        return module;
      })(),
    );
}

async function defaultImportModule(url: string): Promise<Record<string, unknown>> {
  return import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;
}

function createClientMutationFetch(state: ClientState): EnhancedMutationFetch {
  const transport = createKovoClientMutationTransport({
    dispatch: dispatchPlatformRequest,
    isActive: () => state.accepting,
    observe: state.fetchObserver,
    onControllerFinish(controller) {
      securitySetDelete(state.controllers, controller);
    },
    onControllerStart(controller) {
      securitySetAdd(state.controllers, controller);
    },
  });
  return (url, options) => trackClientOperation(state, transport(url, options));
}

/**
 * Build the framework-owned Request transport used by custom shells.
 *
 * @internal Exported from its source module for adversarial contract tests; the
 * app-public `@kovojs/browser/client` barrel intentionally does not re-export it.
 */
export function createKovoClientMutationTransport(
  configuration: KovoClientMutationTransportOptions,
): EnhancedMutationFetch {
  const dispatch = ownDataOption(configuration, 'dispatch');
  const isActive = ownDataOption(configuration, 'isActive');
  const observe = ownDataOption(configuration, 'observe');
  const onControllerFinish = ownDataOption(configuration, 'onControllerFinish');
  const onControllerStart = ownDataOption(configuration, 'onControllerStart');
  if (typeof dispatch !== 'function' || typeof isActive !== 'function') {
    throw new TypeError('Kovo client transport requires internal dispatch and lifecycle controls.');
  }
  if (observe !== undefined && typeof observe !== 'function') {
    throw new TypeError('Kovo client fetch observer must be a function.');
  }
  return (url, options) =>
    dispatchClientMutationRequest(
      {
        dispatch,
        isActive,
        ...definedProps({ observe, onControllerFinish, onControllerStart }),
      },
      url,
      options,
    );
}

async function dispatchClientMutationRequest(
  configuration: {
    dispatch(request: Request): Promise<Response>;
    isActive(): boolean;
    observe?: InstallKovoClientOptions['fetch'];
    onControllerFinish?: (controller: AbortController) => void;
    onControllerStart?: (controller: AbortController) => void;
  },
  url: string,
  options: EnhancedMutationFetchOptions,
): Promise<EnhancedMutationResponseLike> {
  if (!configuration.isActive()) throw clientDisposedError();
  if (IntrinsicRequest === undefined || IntrinsicAbortController === undefined) {
    throw new TypeError('Kovo client fetch controls are unavailable.');
  }

  const controller = new IntrinsicAbortController();
  configuration.onControllerStart?.(controller);
  const controllerSignal = readControllerSignal(controller);
  const removeUpstreamAbort = forwardAbortSignal(options.signal, controller);
  const requestUrl = absoluteClientUrl(url);
  const requestInit: RequestInit = {
    credentials: 'same-origin',
    headers: options.headers,
    keepalive: options.keepalive,
    method: options.method,
    redirect: options.redirect,
    referrerPolicy: options.referrerPolicy,
    signal: controllerSignal,
  };
  if (options.body !== undefined && options.body !== null) {
    requestInit.body = options.body as BodyInit;
  }
  const request = new IntrinsicRequest(requestUrl, requestInit);
  const witness = snapshotRequest(request);

  let nextCalls = 0;
  let dispatchedResponse: Response | undefined;
  const next = async (): Promise<Response> => {
    nextCalls += 1;
    if (nextCalls !== 1) {
      throw new TypeError('Kovo client fetch next() may be called exactly once.');
    }
    if (!configuration.isActive()) throw clientDisposedError();
    assertRequestUnchanged(request, witness);
    dispatchedResponse = await configuration.dispatch(request);
    return dispatchedResponse;
  };
  const reportProgress = (progress: UploadProgress): void => {
    assertUploadProgress(progress);
    options.onUploadProgress?.(progress);
  };

  try {
    const observer = configuration.observe;
    const response =
      observer === undefined ? await next() : await observer(request, next, reportProgress);
    if (nextCalls !== 1 || response !== dispatchedResponse) {
      discardForeignResponse(response);
      throw new TypeError(
        'Kovo client fetch observers must return the exact Response produced by next().',
      );
    }
    assertRequestUnchanged(request, witness);
    return response;
  } finally {
    removeUpstreamAbort();
    configuration.onControllerFinish?.(controller);
  }
}

async function dispatchPlatformRequest(request: Request): Promise<Response> {
  if (typeof platformFetch !== 'function') {
    throw new TypeError('Kovo client platform fetch is unavailable.');
  }
  return applySecurityIntrinsic<Promise<Response>>(platformFetch, globalThis, [request]);
}

interface RequestWitness {
  credentials: string;
  headers: readonly (readonly [string, string])[];
  keepalive: boolean;
  method: string;
  redirect: string;
  referrerPolicy: string;
  signal: AbortSignal;
  url: string;
}

function snapshotRequest(request: Request): RequestWitness {
  if (
    !intrinsicRequestCredentials ||
    !intrinsicRequestHeaders ||
    !intrinsicRequestKeepalive ||
    !intrinsicRequestMethod ||
    !intrinsicRequestRedirect ||
    !intrinsicRequestReferrerPolicy ||
    !intrinsicRequestSignal ||
    !intrinsicRequestUrl ||
    !intrinsicHeadersForEach
  ) {
    throw new TypeError('Kovo client Request controls are unavailable.');
  }
  const headers = readRequestField<Headers>(intrinsicRequestHeaders, request);
  const snapshot: Array<readonly [string, string]> = [];
  applySecurityIntrinsic(intrinsicHeadersForEach, headers, [
    (value: string, name: string) => {
      securityArrayAppend(snapshot, [name, value] as const, 'Kovo client Request header snapshot');
    },
  ]);
  return {
    credentials: readRequestField(intrinsicRequestCredentials, request),
    headers: snapshot,
    keepalive: readRequestField(intrinsicRequestKeepalive, request),
    method: readRequestField(intrinsicRequestMethod, request),
    redirect: readRequestField(intrinsicRequestRedirect, request),
    referrerPolicy: readRequestField(intrinsicRequestReferrerPolicy, request),
    signal: readRequestField(intrinsicRequestSignal, request),
    url: readRequestField(intrinsicRequestUrl, request),
  };
}

function assertRequestUnchanged(request: Request, expected: RequestWitness): void {
  const current = snapshotRequest(request);
  if (
    current.credentials !== 'same-origin' ||
    current.credentials !== expected.credentials ||
    current.keepalive !== expected.keepalive ||
    current.method !== expected.method ||
    current.redirect !== 'error' ||
    current.redirect !== expected.redirect ||
    current.referrerPolicy !== 'origin' ||
    current.referrerPolicy !== expected.referrerPolicy ||
    current.signal !== expected.signal ||
    current.url !== expected.url ||
    current.headers.length !== expected.headers.length
  ) {
    throw new TypeError('Kovo client refused a modified framework Request.');
  }
  for (let index = 0; index < expected.headers.length; index += 1) {
    const left = expected.headers[index];
    const right = current.headers[index];
    if (left === undefined || right === undefined || left[0] !== right[0] || left[1] !== right[1]) {
      throw new TypeError('Kovo client refused modified framework request headers.');
    }
  }
}

function readRequestField<Value>(getter: (...args: any[]) => unknown, request: Request): Value {
  return applySecurityIntrinsic<Value>(getter, request, []);
}

function readControllerSignal(controller: AbortController): AbortSignal {
  if (!intrinsicAbortSignal) throw new TypeError('Kovo client abort controls are unavailable.');
  return applySecurityIntrinsic<AbortSignal>(intrinsicAbortSignal, controller, []);
}

function forwardAbortSignal(
  upstream: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (upstream === undefined) return () => undefined;
  if (!intrinsicAbortSignalAborted) {
    throw new TypeError('Kovo client AbortSignal controls are unavailable.');
  }
  const abort = () =>
    abortController(
      controller,
      intrinsicAbortSignalReason
        ? applySecurityIntrinsic(intrinsicAbortSignalReason, upstream, [])
        : undefined,
    );
  if (applySecurityIntrinsic(intrinsicAbortSignalAborted, upstream, []) === true) {
    abort();
    return () => undefined;
  }
  if (!intrinsicAddEventListener || !intrinsicRemoveEventListener) {
    throw new TypeError('Kovo client AbortSignal listener controls are unavailable.');
  }
  applySecurityIntrinsic(intrinsicAddEventListener, upstream, ['abort', abort, { once: true }]);
  return () => {
    applySecurityIntrinsic(intrinsicRemoveEventListener, upstream, ['abort', abort]);
  };
}

function abortController(controller: AbortController, reason?: unknown): void {
  if (!intrinsicAbort) throw new TypeError('Kovo client abort controls are unavailable.');
  applySecurityIntrinsic(intrinsicAbort, controller, reason === undefined ? [] : [reason]);
}

function absoluteClientUrl(url: string): string {
  const current = clientBrowserSecurity.currentUrl();
  const base = current?.href ?? (clientLoadedWithDocument ? undefined : 'http://localhost/');
  if (base === undefined) {
    throw new TypeError('Kovo client refused an unverified browser location.');
  }
  const parsed = clientBrowserSecurity.parseUrl(url, base);
  if (parsed === undefined) {
    throw new TypeError('Kovo client mutation URL is invalid.');
  }
  return parsed.href;
}

function trackClientOperation<Value>(
  state: ClientState,
  operation: Promise<Value>,
): Promise<Value> {
  if (!intrinsicPromiseThen) {
    throw new TypeError('Kovo client Promise controls are unavailable.');
  }
  securitySetAdd(state.operations, operation);
  applySecurityIntrinsic(intrinsicPromiseThen, operation, [
    () => {
      securitySetDelete(state.operations, operation);
    },
    () => {
      securitySetDelete(state.operations, operation);
    },
  ]);
  return operation;
}

function beginClientDispose(
  state: ClientState,
  mode: DisposeMode,
  reason: LifecycleReason,
): Promise<void> {
  if (state.disposePromise !== undefined) return state.disposePromise;
  state.accepting = false;
  state.aborting = mode === 'abort';
  notifyLifecycle(state, 'disposing', mode, reason);
  let loaderError: unknown;
  try {
    state.loader?.dispose();
  } catch (error) {
    loaderError = error;
  }
  if (mode === 'abort') abortClientRequests(state);

  state.disposePromise = (async () => {
    try {
      if (mode === 'drain') await drainClientOperations(state);
    } finally {
      state.store.clear();
      securityWeakMapDelete(activeClients, state.root);
      notifyLifecycle(state, 'disposed', mode, reason);
    }
    if (loaderError !== undefined) throw loaderError;
  })();
  return state.disposePromise;
}

async function drainClientOperations(state: ClientState): Promise<void> {
  if (!intrinsicPromiseAll) {
    throw new TypeError('Kovo client Promise controls are unavailable.');
  }
  for (;;) {
    const pending: Promise<unknown>[] = [];
    securitySetForEach(state.operations, (operation) => {
      securityArrayAppend(pending, operation, 'Kovo client drain operation snapshot');
    });
    if (pending.length === 0) return;
    const settled: Promise<unknown>[] = [];
    for (let index = 0; index < pending.length; index += 1) {
      const operation = pending[index];
      if (operation === undefined || !intrinsicPromiseThen) {
        throw new TypeError('Kovo client Promise controls are unavailable.');
      }
      securityArrayAppend(
        settled,
        applySecurityIntrinsic<Promise<unknown>>(intrinsicPromiseThen, operation, [
          () => undefined,
          () => undefined,
        ]),
        'Kovo client drain settlement snapshot',
      );
    }
    await applySecurityIntrinsic<Promise<unknown[]>>(intrinsicPromiseAll, IntrinsicPromise, [
      settled,
    ]);
  }
}

function abortClientRequests(state: ClientState): void {
  let firstError: unknown;
  securitySetForEach(state.controllers, (controller) => {
    try {
      abortController(controller);
    } catch (error) {
      firstError ??= error;
    }
  });
  if (firstError !== undefined) reportClientError(state, firstError, 'dispose');
}

function beginSessionTransition(state: ClientState): void {
  notifyLifecycle(state, 'session-transition', 'abort', 'session-transition');
  const disposed = beginClientDispose(state, 'abort', 'session-transition');
  if (intrinsicPromiseThen) {
    applySecurityIntrinsic(intrinsicPromiseThen, disposed, [
      undefined,
      (error: unknown) => {
        reportClientError(state, error, 'session-transition');
      },
    ]);
  }
}

function notifyLifecycle(
  state: ClientState,
  phase: LifecyclePhase,
  mode?: DisposeMode,
  reason?: LifecycleReason,
): void {
  const callback = state.onLifecycle;
  if (callback === undefined) return;
  try {
    callback({
      phase,
      ...definedProps({ mode, reason }),
    });
  } catch (error) {
    reportClientError(state, error, 'lifecycle');
  }
}

function reportClientError(state: ClientState, error: unknown, phase: string): void {
  const callback = state.onError;
  if (callback === undefined) return;
  try {
    callback(error, { phase });
  } catch {
    // Reporting cannot replace framework cleanup/recovery authority.
  }
}

function reportClientUploadProgress(
  state: ClientState,
  progress: UploadProgress,
  form: unknown,
): void {
  const callback = state.onUploadProgress;
  if (callback === undefined) return;
  try {
    callback(progress, form);
  } catch (error) {
    reportClientError(state, error, 'upload-progress');
  }
}

function assertUploadProgress(progress: UploadProgress): void {
  if (
    progress === null ||
    typeof progress !== 'object' ||
    !Number.isFinite(progress.loaded) ||
    progress.loaded < 0 ||
    (progress.total !== undefined &&
      (!Number.isFinite(progress.total) || progress.total < 0 || progress.loaded > progress.total))
  ) {
    throw new TypeError('Kovo client upload progress must contain bounded non-negative numbers.');
  }
}

function discardForeignResponse(response: unknown): void {
  if (response === null || typeof response !== 'object') return;
  const body = securityGetOwnPropertyDescriptor(response, 'body');
  const cancel =
    body && 'value' in body && body.value && typeof body.value === 'object'
      ? securityGetOwnPropertyDescriptor(body.value, 'cancel')
      : undefined;
  if (cancel && 'value' in cancel && typeof cancel.value === 'function') {
    try {
      applySecurityIntrinsic(cancel.value, body && 'value' in body ? body.value : undefined, []);
    } catch {}
  }
}

function ownDataOption<Options extends object, Key extends keyof Options>(
  options: Options,
  key: Key,
): Options[Key] | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(options, key);
  if (descriptor === undefined || ('value' in descriptor && descriptor.value === undefined)) {
    return undefined;
  }
  if (!('value' in descriptor)) {
    throw new TypeError(`Kovo client option ${String(key)} must be an own-data property.`);
  }
  return descriptor.value as Options[Key];
}

function assertOptionalClientFunction(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`Kovo client option ${name} must be a function.`);
  }
}

function stableClientMethod(value: object, property: PropertyKey): Function | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
    }
    owner = securityGetPrototypeOf(owner);
  }
  return undefined;
}

function clientDisposedError(): TypeError {
  return new TypeError('Kovo client has been disposed.');
}

function resolvedVoidPromise(): Promise<void> {
  return (async () => undefined)();
}

function capturedGetter(
  value: object,
  property: PropertyKey,
): ((...args: any[]) => unknown) | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  // oxlint-disable-next-line typescript/unbound-method -- the getter is deliberately captured and invoked only through applySecurityIntrinsic with an explicit receiver.
  return typeof descriptor?.get === 'function' ? descriptor.get : undefined;
}
