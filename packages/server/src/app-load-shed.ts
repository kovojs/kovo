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
const DEFAULT_GLOBAL_RATE: ResolvedAppRateLimitOptions = Object.freeze({
  max: 20_000,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_PER_IP_RATE: ResolvedAppRateLimitOptions = Object.freeze({
  max: 600,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_MUTATION_GLOBAL_RATE: ResolvedAppRateLimitOptions = Object.freeze({
  max: 5_000,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_MUTATION_PER_IP_RATE: ResolvedAppRateLimitOptions = Object.freeze({
  max: 120,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_QUERY_GLOBAL_RATE: ResolvedAppRateLimitOptions = Object.freeze({
  max: 15_000,
  maxKeys: DEFAULT_MAX_RATE_KEYS,
  windowMs: DEFAULT_WINDOW_MS,
});
const DEFAULT_QUERY_PER_IP_RATE: ResolvedAppRateLimitOptions = Object.freeze({
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
const nativeHeadersEntries = inheritedFunctionDataProperty(headersControl, 'entries');
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

export function normalizeAppRequestLimits(
  options: AppRequestLimitOptions | false | undefined,
): ResolvedAppRequestLimitOptions {
  if (options === false) {
    return {
      global: false,
      maxBodyBytes: false,
      maxQueryListItems: DEFAULT_MAX_QUERY_LIST_ITEMS,
      mutations: { global: false, perIp: false },
      perIp: false,
      queries: { global: false, perIp: false },
      trustedProxy: false,
    };
  }

  const baseGlobal = normalizeRate(options?.global, DEFAULT_GLOBAL_RATE);
  const basePerIp = normalizeRate(options?.perIp, DEFAULT_PER_IP_RATE);

  return {
    ...(options?.clientIp === undefined ? {} : { clientIp: options.clientIp }),
    global: baseGlobal,
    maxBodyBytes:
      options?.maxBodyBytes === undefined ? DEFAULT_MAX_BODY_BYTES : normalizeBodyLimit(options),
    maxQueryListItems:
      options?.maxQueryListItems === undefined
        ? DEFAULT_MAX_QUERY_LIST_ITEMS
        : normalizeQueryListLimit(options.maxQueryListItems),
    mutations: {
      global: normalizeRate(options?.mutations?.global, DEFAULT_MUTATION_GLOBAL_RATE),
      perIp: normalizeRate(options?.mutations?.perIp, DEFAULT_MUTATION_PER_IP_RATE),
    },
    perIp: basePerIp,
    queries: {
      global: normalizeRate(options?.queries?.global, DEFAULT_QUERY_GLOBAL_RATE),
      perIp: normalizeRate(options?.queries?.perIp, DEFAULT_QUERY_PER_IP_RATE),
    },
    trustedProxy: options?.trustedProxy === true,
  };
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

function normalizeBodyLimit(options: AppRequestLimitOptions): number | false {
  if (options.maxBodyBytes === false) return false;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!requestStateIsSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new TypeError(
      'createApp({ requestLimits.maxBodyBytes }) must be a non-negative integer.',
    );
  }
  return maxBodyBytes;
}

function normalizeQueryListLimit(maxQueryListItems: number): number {
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
): ResolvedAppRateLimitOptions | false {
  if (options === false) return false;
  const max = options?.max ?? defaults.max;
  const maxKeys = options?.maxKeys ?? defaults.maxKeys;
  const windowMs = options?.windowMs ?? defaults.windowMs;
  if (!requestStateIsSafeInteger(max) || max < 1) {
    throw new TypeError('createApp({ requestLimits.*.max }) must be a positive integer.');
  }
  if (!requestStateIsSafeInteger(maxKeys) || maxKeys < 1) {
    throw new TypeError('createApp({ requestLimits.*.maxKeys }) must be a positive integer.');
  }
  if (!requestStateIsSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('createApp({ requestLimits.*.windowMs }) must be a positive integer.');
  }
  return { max, maxKeys, windowMs };
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
    checks.push({ id: 'all:per-ip', key: ip, limit: limits.perIp, scope: 'perIp' });
    checks.push({ id: `${surface}:per-ip`, key: ip, limit: scoped.perIp, scope: 'perIp' });
  }

  for (const check of checks) {
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
  if (maxBodyBytes === false || request.body === null) return request;
  const limited = new Proxy(request, {
    get(target, property) {
      if (property === 'arrayBuffer') {
        return async () => readLimitedArrayBuffer(target, maxBodyBytes);
      }
      if (property === 'text') {
        return async () =>
          new TextDecoder().decode(await readLimitedArrayBuffer(target, maxBodyBytes));
      }
      if (property === 'json') {
        return async () =>
          JSON.parse(new TextDecoder().decode(await readLimitedArrayBuffer(target, maxBodyBytes)));
      }
      if (property === 'formData') {
        return async () => {
          const body = await readLimitedArrayBuffer(target, maxBodyBytes);
          return createNativeRequest(target.url, {
            body,
            headers: target.headers,
            method: target.method,
          }).formData();
        };
      }
      if (property === 'clone') {
        return () => requestWithBodyLimit(target.clone(), maxBodyBytes);
      }
      if (property === 'body') {
        return countedBody(target.body, maxBodyBytes);
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
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
  if (source.body === null) return source;
  const init = {
    body: countedBody(source.body, maxBodyBytes),
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
  if (maxBodyBytes === false || readNativeRequestBody(request) === null) return request;
  const body = await readLimitedArrayBuffer(request, maxBodyBytes);
  const verified = createNativeRequest(readNativeRequestUrl(request), {
    body,
    headers: readNativeRequestHeaders(request),
    method: readNativeRequestMethod(request),
    signal: readNativeRequestSignal(request),
  });
  copyRequestPeerAddress(request, verified);
  witnessWeakSetAdd(verifiedBodyRequests, verified);
  return verified;
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
  const source = cloneNativeRequest(request);
  const buffer = await readLimitedArrayBuffer(source, 9_007_199_254_740_991);
  const payload = new NativeUint8Array(buffer);
  const headers = new NativeHeaders(readNativeRequestHeaders(request));
  const entries = snapshotHeaderEntries(headers);
  witnessDefineProperty(headers, 'get', {
    enumerable: true,
    value(name: string): string | null {
      if (typeof name !== 'string') return null;
      const expected = asciiLower(name);
      for (let index = 0; index < entries.length; index += 1) {
        const descriptor = witnessGetOwnPropertyDescriptor(entries, index);
        if (descriptor === undefined || !('value' in descriptor)) return null;
        const entry = descriptor.value;
        if (entry[0] === expected) return entry[1];
      }
      return null;
    },
    writable: false,
  });
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
