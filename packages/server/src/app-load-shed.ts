import type {
  AppRateLimitOptions,
  AppRequestLimitOptions,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
  KovoApp,
} from './app-types.js';
import { appSystemResponse, type AppSystemResponseSurface } from './app-system-response.js';
import {
  cloneNativeRequest,
  createNativeRequest,
  registerAuthorityNeutralRequestClone,
} from './request-carrier.js';
import { requestDecodeUtf8, requestParseJson } from './request-body-intrinsics.js';
import {
  requestStateHeaderGet,
  requestStateIgnorePromiseRejection,
  requestStateIsSafeInteger,
  requestStateNow,
  requestStateOptionalRateLimitKey,
  requestStateParseUnsignedInteger,
  requestStateRetryAfterSeconds,
  requestStateRightmostForwardedForValue,
  requestStateRightmostHeaderListValue,
  requestStateString,
} from './request-state-intrinsics.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessMapSize,
  witnessReflectApply,
  witnessReflectGet,
  witnessProxy,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

export type LoadShedSurface = AppSystemResponseSurface;

/** @internal */
export class RequestBodyLimitExceededError extends Error {
  constructor(readonly maxBodyBytes: number) {
    super(`Request body exceeded ${maxBodyBytes} bytes.`);
    this.name = 'RequestBodyLimitExceededError';
  }
}

interface RateBucket {
  count: number;
  windowStart: number;
}

type RateBucketScope = 'global' | 'perIp';

interface RateBucketStore {
  readonly buckets: Map<string, RateBucket>;
  readonly scope: RateBucketScope;
}

interface AppRateState {
  readonly stores: Map<string, RateBucketStore>;
}

interface RateLimitDecision {
  retryAfterSeconds: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_RATE_KEYS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_MAX_QUERY_LIST_ITEMS = 100;
const DEFAULT_GLOBAL_RATE: ResolvedAppRateLimitOptions = witnessFreeze({
  max: 20_000,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_PER_IP_RATE: ResolvedAppRateLimitOptions = witnessFreeze({
  max: 600,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_MUTATION_GLOBAL_RATE: ResolvedAppRateLimitOptions = witnessFreeze({
  max: 5_000,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_MUTATION_PER_IP_RATE: ResolvedAppRateLimitOptions = witnessFreeze({
  max: 120,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_QUERY_GLOBAL_RATE: ResolvedAppRateLimitOptions = witnessFreeze({
  max: 15_000,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_QUERY_PER_IP_RATE: ResolvedAppRateLimitOptions = witnessFreeze({
  max: 600,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const requestPeerAddressProperty = '__kovoPeerAddress';
const NativeHeaders = globalThis.Headers;
const NativeRequest = globalThis.Request;
const NativeUint8Array = globalThis.Uint8Array;
const readNativeRequestBody = requestIntrinsicGetter<ReadableStream<Uint8Array> | null>('body');
const readNativeRequestHeaders = requestIntrinsicGetter<Headers>('headers');
const readNativeRequestMethod = requestIntrinsicGetter<string>('method');
const readNativeRequestSignal = requestIntrinsicGetter<AbortSignal>('signal');
const readNativeRequestUrl = requestIntrinsicGetter<string>('url');
const nativeRequestArrayBuffer = inheritedFunctionDataProperty(
  NativeRequest.prototype,
  'arrayBuffer',
);
const nativeRequestBlob = inheritedFunctionDataProperty(NativeRequest.prototype, 'blob');
const nativeRequestClone = inheritedFunctionDataProperty(NativeRequest.prototype, 'clone');
const nativeRequestFormData = inheritedFunctionDataProperty(NativeRequest.prototype, 'formData');
const nativeRequestJson = inheritedFunctionDataProperty(NativeRequest.prototype, 'json');
const nativeRequestText = inheritedFunctionDataProperty(NativeRequest.prototype, 'text');
const nativeRequestBytes = optionalInheritedFunctionDataProperty(NativeRequest.prototype, 'bytes');

const streamControlRequest = createNativeRequest('https://kovo.invalid/body-control', {
  body: 'control',
  method: 'POST',
});
const streamControl = readNativeRequestBody(streamControlRequest);
if (streamControl === null)
  throw new TypeError('The Web Request implementation lacks body streams.');
const nativeStreamGetReader = inheritedFunctionDataProperty(streamControl, 'getReader');
const streamReaderControl = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
  nativeStreamGetReader,
  streamControl,
  [],
);
const nativeStreamReaderRead = inheritedFunctionDataProperty(streamReaderControl, 'read');
const nativeStreamReaderCancel = inheritedFunctionDataProperty(streamReaderControl, 'cancel');
const nativeStreamReaderReleaseLock = inheritedFunctionDataProperty(
  streamReaderControl,
  'releaseLock',
);
witnessReflectApply(nativeStreamReaderReleaseLock, streamReaderControl, []);

const headersControl = new NativeHeaders({ 'X-Kovo-Control': 'accepted' });
const nativeHeadersAppend = inheritedFunctionDataProperty(headersControl, 'append');
const nativeHeadersDelete = inheritedFunctionDataProperty(headersControl, 'delete');
const nativeHeadersEntries = inheritedFunctionDataProperty(headersControl, 'entries');
const nativeHeadersForEach = inheritedFunctionDataProperty(headersControl, 'forEach');
const nativeHeadersGet = inheritedFunctionDataProperty(headersControl, 'get');
const nativeHeadersHas = inheritedFunctionDataProperty(headersControl, 'has');
const nativeHeadersKeys = inheritedFunctionDataProperty(headersControl, 'keys');
const nativeHeadersSet = inheritedFunctionDataProperty(headersControl, 'set');
const nativeHeadersValues = inheritedFunctionDataProperty(headersControl, 'values');
const nativeHeadersGetSetCookie = optionalInheritedFunctionDataProperty(
  headersControl,
  'getSetCookie',
);
const headersIteratorControl = witnessReflectApply<object>(
  nativeHeadersEntries,
  headersControl,
  [],
);
const nativeHeadersIteratorNext = inheritedFunctionDataProperty(headersIteratorControl, 'next');
const nativeTypedArrayByteLength = inheritedAccessorGetter(
  NativeUint8Array.prototype,
  'byteLength',
);
const nativeTypedArrayBuffer = inheritedAccessorGetter(NativeUint8Array.prototype, 'buffer');

const rateStates = createWitnessWeakMap<KovoApp, AppRateState>();
const verifiedBodyRequests = createWitnessWeakSet<Request>();
const pinnedIngressRequests = createWitnessWeakSet<Request>();
const pinnedIngressHeaders = createWitnessWeakSet<Headers>();
const pinnedIngressBodyStreams = createWitnessWeakSet<object>();
const pinnedIngressBodyReaders = createWitnessWeakSet<object>();

export function normalizeAppRequestLimits(
  options: AppRequestLimitOptions | false | undefined,
): ResolvedAppRequestLimitOptions {
  if (options === false) {
    return witnessFreeze({
      global: false,
      maxBodyBytes: false,
      maxQueryListItems: DEFAULT_MAX_QUERY_LIST_ITEMS,
      mutations: frozenRequestRateLimits(false, false),
      perIp: false,
      queries: frozenRequestRateLimits(false, false),
      trustedProxy: false,
    });
  }

  const source =
    options === undefined ? undefined : requestLimitRecord(options, 'createApp requestLimits');
  const clientIp = requestLimitOwnDataValue(source, 'clientIp', 'requestLimits.clientIp');
  const global = requestLimitOwnDataValue(source, 'global', 'requestLimits.global') as
    | AppRateLimitOptions
    | false
    | undefined;
  const maxBodyBytes = requestLimitOwnDataValue(
    source,
    'maxBodyBytes',
    'requestLimits.maxBodyBytes',
  );
  const maxQueryListItems = requestLimitOwnDataValue(
    source,
    'maxQueryListItems',
    'requestLimits.maxQueryListItems',
  );
  const mutations = requestLimitOwnDataValue(source, 'mutations', 'requestLimits.mutations');
  const perIp = requestLimitOwnDataValue(source, 'perIp', 'requestLimits.perIp') as
    | AppRateLimitOptions
    | false
    | undefined;
  const queries = requestLimitOwnDataValue(source, 'queries', 'requestLimits.queries');
  const trustedProxy = requestLimitOwnDataValue(
    source,
    'trustedProxy',
    'requestLimits.trustedProxy',
  );
  if (clientIp !== undefined && typeof clientIp !== 'function') {
    throw new TypeError('createApp({ requestLimits.clientIp }) must be a function.');
  }
  if (trustedProxy !== undefined && typeof trustedProxy !== 'boolean') {
    throw new TypeError('createApp({ requestLimits.trustedProxy }) must be boolean.');
  }

  const baseGlobal = normalizeRate(global, DEFAULT_GLOBAL_RATE, 'requestLimits.global');
  const basePerIp = normalizeRate(perIp, DEFAULT_PER_IP_RATE, 'requestLimits.perIp');

  return witnessFreeze({
    ...(clientIp === undefined ? {} : { clientIp: clientIp as (request: Request) => string }),
    global: baseGlobal,
    maxBodyBytes:
      maxBodyBytes === undefined ? DEFAULT_MAX_BODY_BYTES : normalizeBodyLimit(maxBodyBytes),
    maxQueryListItems:
      maxQueryListItems === undefined
        ? DEFAULT_MAX_QUERY_LIST_ITEMS
        : normalizeQueryListLimit(maxQueryListItems),
    mutations: normalizeRequestRateLimits(
      mutations,
      DEFAULT_MUTATION_GLOBAL_RATE,
      DEFAULT_MUTATION_PER_IP_RATE,
      'requestLimits.mutations',
    ),
    perIp: basePerIp,
    queries: normalizeRequestRateLimits(
      queries,
      DEFAULT_QUERY_GLOBAL_RATE,
      DEFAULT_QUERY_PER_IP_RATE,
      'requestLimits.queries',
    ),
    trustedProxy: trustedProxy === true,
  });
}

function normalizeRequestRateLimits(
  value: unknown,
  defaultGlobal: ResolvedAppRateLimitOptions,
  defaultPerIp: ResolvedAppRateLimitOptions,
  label: string,
): ResolvedAppRequestRateLimitOptions {
  const source = value === undefined ? undefined : requestLimitRecord(value, label);
  const global = requestLimitOwnDataValue(source, 'global', `${label}.global`) as
    | AppRateLimitOptions
    | false
    | undefined;
  const perIp = requestLimitOwnDataValue(source, 'perIp', `${label}.perIp`) as
    | AppRateLimitOptions
    | false
    | undefined;
  return frozenRequestRateLimits(
    normalizeRate(global, defaultGlobal, `${label}.global`),
    normalizeRate(perIp, defaultPerIp, `${label}.perIp`),
  );
}

function frozenRequestRateLimits(
  global: ResolvedAppRateLimitOptions | false,
  perIp: ResolvedAppRateLimitOptions | false,
): ResolvedAppRequestRateLimitOptions {
  return witnessFreeze({ global, perIp });
}

export function preDispatchLoadShedResponse(
  app: KovoApp,
  request: Request,
  surface: LoadShedSurface,
  buildToken?: string,
  maxBodyBytes: number | false = app.requestLimits.maxBodyBytes,
): Response | undefined {
  const bodyFailure = requestBodySizeFailure(maxBodyBytes, request, surface, buildToken);
  if (bodyFailure) return bodyFailure;

  const rateLimited = rateLimitFailure(app, request, surface, requestStateNow());
  if (!rateLimited) return undefined;

  return appSystemResponse('Too Many Requests', {
    buildToken,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': requestStateString(rateLimited.retryAfterSeconds),
    },
    method: readNativeRequestMethod(request),
    status: 429,
    surface,
  });
}

function normalizeBodyLimit(maxBodyBytes: unknown): number | false {
  if (maxBodyBytes === false) return false;
  if (!requestStateIsSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new TypeError(
      'createApp({ requestLimits.maxBodyBytes }) must be a non-negative integer.',
    );
  }
  return maxBodyBytes;
}

function normalizeQueryListLimit(maxQueryListItems: unknown): number {
  if (!requestStateIsSafeInteger(maxQueryListItems) || maxQueryListItems < 1) {
    throw new TypeError(
      'createApp({ requestLimits.maxQueryListItems }) must be a positive integer.',
    );
  }
  return maxQueryListItems;
}

function normalizeRate(
  options: AppRateLimitOptions | false | undefined,
  defaults: ResolvedAppRateLimitOptions,
  label: string,
): ResolvedAppRateLimitOptions | false {
  if (options === false) return false;
  if (options === undefined) return defaults;
  const source = requestLimitRecord(options, label);
  const authoredMax = requestLimitOwnDataValue(source, 'max', `${label}.max`);
  const authoredMaxKeys = requestLimitOwnDataValue(source, 'maxKeys', `${label}.maxKeys`);
  const authoredWindowMs = requestLimitOwnDataValue(source, 'windowMs', `${label}.windowMs`);
  const max = authoredMax ?? defaults.max;
  const maxKeys = authoredMaxKeys ?? defaults.maxKeys;
  const windowMs = authoredWindowMs ?? defaults.windowMs;
  if (!requestStateIsSafeInteger(max) || max < 1) {
    throw new TypeError('createApp({ requestLimits.*.max }) must be a positive integer.');
  }
  if (!requestStateIsSafeInteger(maxKeys) || maxKeys < 1) {
    throw new TypeError('createApp({ requestLimits.*.maxKeys }) must be a positive integer.');
  }
  if (!requestStateIsSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('createApp({ requestLimits.*.windowMs }) must be a positive integer.');
  }
  return witnessFreeze({ max, maxKeys, windowMs });
}

function requestLimitRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`createApp({ ${label} }) must be a stable own-data object.`);
  }
  return value as Record<PropertyKey, unknown>;
}

function requestLimitOwnDataValue(
  source: Record<PropertyKey, unknown> | undefined,
  property: PropertyKey,
  label: string,
): unknown {
  if (source === undefined) return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`createApp({ ${label} }) must be a stable own data property.`);
  }
  return descriptor.value;
}

function requestBodySizeFailure(
  maxBodyBytes: ResolvedAppRequestLimitOptions['maxBodyBytes'],
  request: Request,
  surface: LoadShedSurface,
  buildToken?: string,
): Response | undefined {
  if (maxBodyBytes === false) return undefined;
  const size = requestContentLength(request);
  if (size === undefined || size <= maxBodyBytes) return undefined;

  return appSystemResponse('Payload Too Large', {
    buildToken,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    method: readNativeRequestMethod(request),
    status: 413,
    surface,
  });
}

function requestContentLength(request: Request): number | undefined {
  const value = requestStateHeaderGet(readNativeRequestHeaders(request), 'content-length');
  if (value === null) return undefined;
  return requestStateParseUnsignedInteger(value);
}

function rateLimitFailure(
  app: KovoApp,
  request: Request,
  surface: LoadShedSurface,
  now: number,
): RateLimitDecision | undefined {
  const state = appRateState(app);
  const limits = app.requestLimits;
  const ip = resolveRequestClientIp(app, request);
  const scoped = surfaceRateLimits(limits, surface);
  const checks: Array<{
    id: string;
    key: string;
    limit: ResolvedAppRateLimitOptions | false;
    scope: RateBucketScope;
  }> = [
    { id: 'all:global', key: 'global', limit: limits.global, scope: 'global' },
    { id: `${surface}:global`, key: 'global', limit: scoped.global, scope: 'global' },
  ];
  if (ip !== undefined) {
    appendLoadShedValue(checks, {
      id: 'all:per-ip',
      key: ip,
      limit: limits.perIp,
      scope: 'perIp',
    });
    appendLoadShedValue(checks, {
      id: `${surface}:per-ip`,
      key: ip,
      limit: scoped.perIp,
      scope: 'perIp',
    });
  }

  for (let index = 0; index < checks.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(checks, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      return { retryAfterSeconds: 1 };
    }
    const check = descriptor.value;
    if (check.limit === false) continue;
    const store = appRateBucketStore(state, check.id, check.scope);
    const decision = consumeRateLimit(store, check.key, check.limit, now);
    if (decision) return decision;
  }

  return undefined;
}

function surfaceRateLimits(
  limits: ResolvedAppRequestLimitOptions,
  surface: LoadShedSurface,
): ResolvedAppRequestRateLimitOptions {
  if (surface === 'mutation') return limits.mutations;
  if (surface === 'query') return limits.queries;
  return { global: false, perIp: false };
}

function consumeRateLimit(
  store: Map<string, RateBucket>,
  key: string,
  limit: ResolvedAppRateLimitOptions,
  now: number,
): RateLimitDecision | undefined {
  evictExpiredRateBuckets(store, limit, now);

  const existing = witnessMapGet(store, key);
  const bucket = existing === undefined ? { count: 0, windowStart: now } : existing;
  bucket.count += 1;
  if (existing === undefined) {
    while (witnessMapSize(store) >= limit.maxKeys) {
      let oldest: string | undefined;
      witnessMapForEach(store, (_bucket, candidate) => {
        if (oldest === undefined) oldest = candidate;
      });
      if (oldest === undefined) break;
      witnessMapDelete(store, oldest);
    }
  } else {
    witnessMapDelete(store, key);
  }
  witnessMapSet(store, key, bucket);

  if (bucket.count <= limit.max) return undefined;

  return {
    retryAfterSeconds: requestStateRetryAfterSeconds(bucket.windowStart + limit.windowMs - now),
  };
}

function evictExpiredRateBuckets(
  store: Map<string, RateBucket>,
  limit: ResolvedAppRateLimitOptions,
  now: number,
): void {
  witnessMapForEach(store, (bucket, key) => {
    if (now - bucket.windowStart >= limit.windowMs) witnessMapDelete(store, key);
  });
}

function appRateState(app: KovoApp): AppRateState {
  const existing = witnessWeakMapGet(rateStates, app);
  if (existing) return existing;
  const next = { stores: createWitnessMap<string, RateBucketStore>() };
  witnessWeakMapSet(rateStates, app, next);
  return next;
}

function appRateBucketStore(
  state: AppRateState,
  id: string,
  scope: RateBucketScope,
): Map<string, RateBucket> {
  const existing = witnessMapGet(state.stores, id);
  if (existing) return existing.buckets;
  const next: RateBucketStore = { buckets: createWitnessMap<string, RateBucket>(), scope };
  witnessMapSet(state.stores, id, next);
  return next.buckets;
}

/** @internal */
export function appRateLimitKeyCounts(app: KovoApp): { global: number; perIp: number } {
  const state = appRateState(app);
  let global = 0;
  let perIp = 0;
  witnessMapForEach(state.stores, (store) => {
    if (store.scope === 'global') {
      global += witnessMapSize(store.buckets);
    } else {
      perIp += witnessMapSize(store.buckets);
    }
  });
  return { global, perIp };
}

/** @internal */
export function requestWithBodyLimit(request: Request, maxBodyBytes: number | false): Request {
  if (witnessWeakSetHas(verifiedBodyRequests, request)) return request;
  if (maxBodyBytes === false || readNativeRequestBody(request) === null) return request;
  const limited = witnessProxy(request, {
    get(target, property) {
      if (property === 'arrayBuffer') {
        return async () => readLimitedArrayBuffer(target, maxBodyBytes);
      }
      if (property === 'text') {
        return async () => requestDecodeUtf8(await readLimitedArrayBuffer(target, maxBodyBytes));
      }
      if (property === 'json') {
        return async () =>
          requestParseJson(requestDecodeUtf8(await readLimitedArrayBuffer(target, maxBodyBytes)));
      }
      if (property === 'formData') {
        return async () => {
          const body = await readLimitedArrayBuffer(target, maxBodyBytes);
          const formRequest = createNativeRequest(readNativeRequestUrl(target), {
            body,
            headers: readNativeRequestHeaders(target),
            method: readNativeRequestMethod(target),
          });
          return witnessReflectApply(nativeRequestFormData, formRequest, []);
        };
      }
      if (property === 'clone') {
        return () =>
          requestWithBodyLimit(
            witnessReflectApply<Request>(nativeRequestClone, target, []),
            maxBodyBytes,
          );
      }
      if (property === 'body') {
        return countedBody(readNativeRequestBody(target), maxBodyBytes);
      }

      const value = witnessReflectGet(target, property, target);
      return typeof value === 'function'
        ? (...args: unknown[]) => witnessReflectApply(value, target, args)
        : value;
    },
  }) as Request;
  registerAuthorityNeutralRequestClone(
    limited,
    () => authorityNeutralBodyLimitedClone(request, maxBodyBytes),
    request,
  );
  return limited;
}

function authorityNeutralBodyLimitedClone(request: Request, maxBodyBytes: number): Request {
  const source = cloneNativeRequest(request);
  const body = readNativeRequestBody(source);
  if (body === null) return source;
  const init = {
    body: countedBody(body, maxBodyBytes),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  const limited = createNativeRequest(source, init);
  copyRequestPeerAddress(request, limited);
  return limited;
}

/** @internal */
export async function requestWithVerifiedBodyLimit(
  request: Request,
  maxBodyBytes: number | false,
): Promise<Request> {
  if (maxBodyBytes === false || readNativeRequestBody(request) === null) {
    pinRequestIngressSurface(request);
    witnessWeakSetAdd(verifiedBodyRequests, request);
    return request;
  }
  const body = await readLimitedArrayBuffer(request, maxBodyBytes);
  const verified = createNativeRequest(readNativeRequestUrl(request), {
    body,
    headers: readNativeRequestHeaders(request),
    method: readNativeRequestMethod(request),
    signal: readNativeRequestSignal(request),
  });
  copyRequestPeerAddress(request, verified);
  copyRequestScopedDb(request, verified);
  pinRequestIngressSurface(verified);
  witnessWeakSetAdd(verifiedBodyRequests, verified);
  return verified;
}

function copyRequestScopedDb(source: Request, target: Request): void {
  // C194 / SPEC §6.6/§9.5/§11.2: body verification reconstructs a native Request so hostile
  // accessors and ad-hoc authority do not cross the predispatch boundary. The request-scoped DB
  // capability is the one explicit adapter binding that mutation dispatch must retain. Copy only
  // an own data value, pin its identity, and never invoke or inherit an authored getter.
  const descriptor = witnessGetOwnPropertyDescriptor(source, 'db');
  if (descriptor === undefined || !('value' in descriptor) || descriptor.value === undefined) {
    return;
  }
  witnessDefineProperty(target, 'db', {
    configurable: false,
    enumerable: descriptor.enumerable ?? false,
    value: descriptor.value,
    writable: false,
  });
}

/** Framework-owned verifier input reconstructed from one exact Request snapshot (SPEC §6.6). */
export interface RequestVerifierInput {
  headers: Headers;
  payload: Uint8Array;
}

/**
 * Clone and read verifier bytes through the same boot-pinned stream controls as the body limiter.
 * Header lookup is an immutable own method over an exact entry snapshot, so a verifier cannot
 * authenticate a stateful `Headers.prototype.get` result that the dispatched request never held.
 * @internal
 */
export async function requestVerifierInput(request: Request): Promise<RequestVerifierInput> {
  pinRequestIngressSurface(request);
  const source = cloneNativeRequest(request);
  const buffer = await readLimitedArrayBuffer(source, 9_007_199_254_740_991);
  const payload = new NativeUint8Array(buffer);
  const headers = snapshotPinnedHeaders(readNativeRequestHeaders(request));
  return witnessFreeze({
    headers: witnessFreeze(headers),
    payload,
  });
}

function copyRequestPeerAddress(source: Request, target: Request): void {
  const descriptor = witnessGetOwnPropertyDescriptor(source, requestPeerAddressProperty);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    descriptor.enumerable === true ||
    descriptor.writable === true ||
    typeof descriptor.value !== 'string'
  ) {
    return;
  }
  witnessDefineProperty(target, requestPeerAddressProperty, descriptor);
}

async function readLimitedArrayBuffer(
  request: Request,
  maxBodyBytes: number,
): Promise<ArrayBuffer> {
  const body = readNativeRequestBody(request);
  if (body === null) {
    const empty = new NativeUint8Array(0);
    return witnessReflectApply(nativeTypedArrayBuffer, empty, []);
  }
  const reader = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
    nativeStreamGetReader,
    body,
    [],
  );
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (let count = 0; count <= 1_000_000; count += 1) {
      const result = await witnessReflectApply<Promise<ReadableStreamReadResult<Uint8Array>>>(
        nativeStreamReaderRead,
        reader,
        [],
      );
      const done = ownDataProperty(result, 'done');
      if (done === true) break;
      const value = ownDataProperty(result, 'value');
      if (done !== false || typeof value !== 'object' || value === null) {
        throw new TypeError('Kovo received an invalid request body stream chunk.');
      }
      let length: number;
      try {
        length = typedArrayByteLength(value as Uint8Array);
      } catch {
        throw new TypeError('Kovo received an invalid request body stream chunk.');
      }
      if (length > maxBodyBytes - total) {
        const cancellation = witnessReflectApply<Promise<unknown>>(
          nativeStreamReaderCancel,
          reader,
          [],
        );
        requestStateIgnorePromiseRejection(cancellation);
        throw new RequestBodyLimitExceededError(maxBodyBytes);
      }
      total += length;
      appendLoadShedValue(chunks, value as Uint8Array);
      if (count === 1_000_000) {
        throw new TypeError('Kovo refused a request body with too many stream chunks.');
      }
    }
  } finally {
    witnessReflectApply(nativeStreamReaderReleaseLock, reader, []);
  }

  const bytes = new NativeUint8Array(total);
  let offset = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunkDescriptor = witnessGetOwnPropertyDescriptor(chunks, chunkIndex);
    if (chunkDescriptor === undefined || !('value' in chunkDescriptor)) {
      throw new TypeError('Kovo request body chunk snapshot is incomplete.');
    }
    const chunk = chunkDescriptor.value;
    const length = typedArrayByteLength(chunk);
    for (let index = 0; index < length; index += 1) {
      bytes[offset] = chunk[index]!;
      offset += 1;
    }
  }
  return witnessReflectApply(nativeTypedArrayBuffer, bytes, []);
}

function requestIntrinsicGetter<Value>(property: string): (request: Request) => Value {
  const descriptor = witnessGetOwnPropertyDescriptor(NativeRequest.prototype, property);
  const getter = descriptor ? witnessReflectGet(descriptor, 'get') : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError(`The Web Request implementation lacks a ${property} getter.`);
  }
  return (request) => witnessReflectApply(getter, request, []) as Value;
}

function inheritedFunctionDataProperty(value: object, property: PropertyKey): Function {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`The Web platform ${String(property)} method is unavailable.`);
      }
      return descriptor.value;
    }
    current = witnessGetPrototypeOf(current);
  }
  throw new TypeError(`The Web platform ${String(property)} method is unavailable.`);
}

function optionalInheritedFunctionDataProperty(
  value: object,
  property: PropertyKey,
): Function | undefined {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
    }
    current = witnessGetPrototypeOf(current);
  }
  return undefined;
}

/** @internal Close the native Request surface before authored lifecycle code can observe it. */
export function pinRequestIngressSurface(request: Request): void {
  if (witnessWeakSetHas(pinnedIngressRequests, request)) return;
  const headers = readNativeRequestHeaders(request);
  const body = readNativeRequestBody(request);
  pinHeadersSurface(headers);
  pinBodyStreamSurface(body);
  witnessDefineProperty(request, 'headers', { value: headers });
  witnessDefineProperty(request, 'body', { value: body });
  witnessDefineProperty(request, 'method', { value: readNativeRequestMethod(request) });
  witnessDefineProperty(request, 'signal', { value: readNativeRequestSignal(request) });
  witnessDefineProperty(request, 'url', { value: readNativeRequestUrl(request) });
  pinBoundMethod(request, 'arrayBuffer', nativeRequestArrayBuffer);
  pinBoundMethod(request, 'blob', nativeRequestBlob);
  pinBoundMethod(request, 'formData', nativeRequestFormData);
  pinBoundMethod(request, 'json', nativeRequestJson);
  pinBoundMethod(request, 'text', nativeRequestText);
  if (nativeRequestBytes !== undefined) pinBoundMethod(request, 'bytes', nativeRequestBytes);
  witnessDefineProperty(request, 'clone', {
    value() {
      const cloned = witnessReflectApply<Request>(nativeRequestClone, request, []);
      pinRequestIngressSurface(cloned);
      return cloned;
    },
  });
  witnessWeakSetAdd(pinnedIngressRequests, request);
}

function pinBoundMethod(target: object, property: PropertyKey, method: Function): void {
  witnessDefineProperty(target, property, {
    value(...args: unknown[]) {
      return witnessReflectApply(method, target, args);
    },
  });
}

function pinBodyStreamSurface(body: ReadableStream<Uint8Array> | null): void {
  if (body === null || witnessWeakSetHas(pinnedIngressBodyStreams, body)) return;
  witnessDefineProperty(body, 'getReader', {
    value(...args: unknown[]) {
      const reader = witnessReflectApply<object>(nativeStreamGetReader, body, args);
      pinBodyReaderSurface(reader);
      return reader;
    },
  });
  witnessWeakSetAdd(pinnedIngressBodyStreams, body);
}

function pinBodyReaderSurface(reader: object): void {
  if (witnessWeakSetHas(pinnedIngressBodyReaders, reader)) return;
  pinBoundMethod(reader, 'read', nativeStreamReaderRead);
  pinBoundMethod(reader, 'cancel', nativeStreamReaderCancel);
  pinBoundMethod(reader, 'releaseLock', nativeStreamReaderReleaseLock);
  witnessWeakSetAdd(pinnedIngressBodyReaders, reader);
}

function snapshotPinnedHeaders(source: Headers): Headers {
  const entries = snapshotHeaderEntries(source);
  const headers = new NativeHeaders();
  for (let index = 0; index < entries.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(entries, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Kovo received an incomplete header snapshot.');
    }
    const entry = descriptor.value;
    witnessReflectApply(nativeHeadersAppend, headers, [entry[0], entry[1]]);
  }
  pinHeadersSurface(headers);
  return headers;
}

function pinHeadersSurface(headers: Headers): void {
  if (witnessWeakSetHas(pinnedIngressHeaders, headers)) return;
  pinBoundMethod(headers, 'append', nativeHeadersAppend);
  pinBoundMethod(headers, 'delete', nativeHeadersDelete);
  pinHeadersIteratorMethod(headers, 'entries', nativeHeadersEntries);
  pinBoundMethod(headers, 'forEach', nativeHeadersForEach);
  pinBoundMethod(headers, 'get', nativeHeadersGet);
  pinBoundMethod(headers, 'has', nativeHeadersHas);
  pinHeadersIteratorMethod(headers, 'keys', nativeHeadersKeys);
  pinBoundMethod(headers, 'set', nativeHeadersSet);
  pinHeadersIteratorMethod(headers, 'values', nativeHeadersValues);
  pinHeadersIteratorMethod(headers, Symbol.iterator, nativeHeadersEntries);
  if (nativeHeadersGetSetCookie !== undefined) {
    pinBoundMethod(headers, 'getSetCookie', nativeHeadersGetSetCookie);
  }
  witnessWeakSetAdd(pinnedIngressHeaders, headers);
}

function pinHeadersIteratorMethod(headers: Headers, property: PropertyKey, method: Function): void {
  witnessDefineProperty(headers, property, {
    value(...args: unknown[]) {
      const iterator = witnessReflectApply<object>(method, headers, args);
      pinBoundMethod(iterator, 'next', nativeHeadersIteratorNext);
      witnessDefineProperty(iterator, Symbol.iterator, { value: () => iterator });
      return iterator;
    },
  });
}

function inheritedAccessorGetter(value: object, property: PropertyKey): Function {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      const getter = witnessReflectGet(descriptor, 'get');
      if (typeof getter !== 'function') {
        throw new TypeError(`The Web platform ${String(property)} getter is unavailable.`);
      }
      return getter;
    }
    current = witnessGetPrototypeOf(current);
  }
  throw new TypeError(`The Web platform ${String(property)} getter is unavailable.`);
}

function ownDataProperty(value: unknown, property: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo expected an object data carrier.');
  }
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`Kovo expected own data property ${String(property)}.`);
  }
  return descriptor.value;
}

function typedArrayByteLength(value: Uint8Array): number {
  const length = witnessReflectApply<unknown>(nativeTypedArrayByteLength, value, []);
  if (typeof length !== 'number' || length < 0 || length % 1 !== 0) {
    throw new TypeError('Kovo received an invalid typed-array byte length.');
  }
  return length;
}

function appendLoadShedValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function snapshotHeaderEntries(headers: Headers): readonly (readonly [string, string])[] {
  const entries: (readonly [string, string])[] = [];
  const iterator = witnessReflectApply<object>(nativeHeadersEntries, headers, []);
  for (let count = 0; count <= 100_000; count += 1) {
    const result = witnessReflectApply<unknown>(nativeHeadersIteratorNext, iterator, []);
    const done = ownDataProperty(result, 'done');
    if (done === true) return witnessFreeze(entries);
    if (done !== false) throw new TypeError('Kovo received an invalid Headers iterator result.');
    const value = ownDataProperty(result, 'value');
    if (!witnessIsArray(value) || value.length !== 2) {
      throw new TypeError('Kovo received an invalid Headers entry.');
    }
    const name = ownDataProperty(value, 0);
    const headerValue = ownDataProperty(value, 1);
    if (typeof name !== 'string' || typeof headerValue !== 'string') {
      throw new TypeError('Kovo received a non-string Headers entry.');
    }
    const entry = witnessFreeze([asciiLower(name), headerValue] as const);
    appendLoadShedValue(entries, entry);
    if (count === 100_000) throw new TypeError('Kovo refused an unbounded Headers carrier.');
  }
  throw new TypeError('Kovo refused an unbounded Headers carrier.');
}

function asciiLower(value: string): string {
  let result = '';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    const character = value[valueIndex]!;
    let mapped = character;
    for (let index = 0; index < upper.length; index += 1) {
      if (upper[index] === character) mapped = lower[index]!;
    }
    result += mapped;
  }
  return result;
}

function countedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
): ReadableStream<Uint8Array> | null {
  if (body === null) return null;
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBodyBytes) {
          controller.error(new RequestBodyLimitExceededError(maxBodyBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * @internal Resolve the trustworthy client IP for a request using the SAME source the coarse
 * pre-dispatch limiter uses (SPEC §9.5): the app-configured `createApp({ requestLimits: { clientIp }
 * })` extractor, else `X-Forwarded-For`/`X-Real-IP`/`Forwarded` ONLY when `trustedProxy` is set.
 * The request shell threads this onto `req.clientIp` (via `resolveLifecycleRequest`'s `clientIp`
 * resolver) so `guards.rateLimit({ per: 'ip' })` keys on a trusted value rather than an arbitrary
 * client-supplied header. Returns `undefined` (never an empty string) when no trusted IP is found.
 */
export function resolveRequestClientIp(app: KovoApp, request: Request): string | undefined {
  const limits = app.requestLimits;
  const ip =
    limits.clientIp?.(request) ??
    requestClientIp(request, { trustedProxy: limits.trustedProxy }) ??
    requestPeerAddress(request);
  return requestStateOptionalRateLimitKey(ip, 'createApp({ requestLimits.clientIp })');
}

function requestPeerAddress(request: Request): string | undefined {
  const value = (request as Request & { [requestPeerAddressProperty]?: unknown })[
    requestPeerAddressProperty
  ];
  return typeof value === 'string' ? value : undefined;
}

function requestClientIp(request: Request, options: { trustedProxy: boolean }): string | undefined {
  if (!options.trustedProxy) return undefined;
  const headers = readNativeRequestHeaders(request);
  const forwardedFor = requestStateRightmostHeaderListValue(
    requestStateHeaderGet(headers, 'x-forwarded-for'),
  );
  if (forwardedFor) return forwardedFor;

  const realIp = requestStateOptionalRateLimitKey(
    requestStateHeaderGet(headers, 'x-real-ip'),
    'trusted X-Real-IP',
  );
  if (realIp) return realIp;

  return requestStateRightmostForwardedForValue(requestStateHeaderGet(headers, 'forwarded'));
}
