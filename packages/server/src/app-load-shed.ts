import type {
  AppRateLimitOptions,
  AppRequestLimitOptions,
  ResolvedAppRateLimitOptions,
  ResolvedAppRequestLimitOptions,
  ResolvedAppRequestRateLimitOptions,
  KovoApp,
} from './app-types.js';
import { appSystemResponse, type AppSystemResponseSurface } from './app-system-response.js';

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

interface AppRateState {
  readonly global: Map<string, RateBucket>;
  readonly perIp: Map<string, RateBucket>;
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

const rateStates = new WeakMap<KovoApp, AppRateState>();

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
): Response | undefined {
  const bodyFailure = requestBodySizeFailure(app.requestLimits, request, surface, buildToken);
  if (bodyFailure) return bodyFailure;

  const rateLimited = rateLimitFailure(app, request, surface, Date.now());
  if (!rateLimited) return undefined;

  return appSystemResponse('Too Many Requests', {
    buildToken,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': String(rateLimited.retryAfterSeconds),
    },
    status: 429,
    surface,
  });
}

function normalizeBodyLimit(options: AppRequestLimitOptions): number | false {
  if (options.maxBodyBytes === false) return false;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new TypeError(
      'createApp({ requestLimits.maxBodyBytes }) must be a non-negative integer.',
    );
  }
  return maxBodyBytes;
}

function normalizeQueryListLimit(maxQueryListItems: number): number {
  if (!Number.isSafeInteger(maxQueryListItems) || maxQueryListItems < 1) {
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
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new TypeError('createApp({ requestLimits.*.max }) must be a positive integer.');
  }
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) {
    throw new TypeError('createApp({ requestLimits.*.maxKeys }) must be a positive integer.');
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('createApp({ requestLimits.*.windowMs }) must be a positive integer.');
  }
  return { max, maxKeys, windowMs };
}

function requestBodySizeFailure(
  limits: ResolvedAppRequestLimitOptions,
  request: Request,
  surface: LoadShedSurface,
  buildToken?: string,
): Response | undefined {
  if (limits.maxBodyBytes === false) return undefined;
  const size = requestContentLength(request);
  if (size === undefined || size <= limits.maxBodyBytes) return undefined;

  return appSystemResponse('Payload Too Large', {
    buildToken,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 413,
    surface,
  });
}

function requestContentLength(request: Request): number | undefined {
  const value = request.headers.get('content-length');
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function rateLimitFailure(
  app: KovoApp,
  request: Request,
  surface: LoadShedSurface,
  now: number,
): RateLimitDecision | undefined {
  const state = appRateState(app);
  const limits = app.requestLimits;
  const ip = resolveRequestClientIp(app, request) ?? 'unknown';
  const scoped = surfaceRateLimits(limits, surface);
  const checks: Array<{
    id: string;
    key: string;
    limit: ResolvedAppRateLimitOptions | false;
    store: Map<string, RateBucket>;
  }> = [
    { id: 'all:global', key: 'global', limit: limits.global, store: state.global },
    { id: 'all:per-ip', key: ip || 'unknown', limit: limits.perIp, store: state.perIp },
    { id: `${surface}:global`, key: 'global', limit: scoped.global, store: state.global },
    { id: `${surface}:per-ip`, key: ip || 'unknown', limit: scoped.perIp, store: state.perIp },
  ];

  for (const check of checks) {
    if (check.limit === false) continue;
    const decision = consumeRateLimit(check.store, `${check.id}:${check.key}`, check.limit, now);
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

  const existing = store.get(key);
  const bucket = existing === undefined ? { count: 0, windowStart: now } : existing;
  bucket.count += 1;
  if (existing === undefined) {
    while (store.size >= limit.maxKeys) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  } else {
    store.delete(key);
  }
  store.set(key, bucket);

  if (bucket.count <= limit.max) return undefined;

  return {
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + limit.windowMs - now) / 1000)),
  };
}

function evictExpiredRateBuckets(
  store: Map<string, RateBucket>,
  limit: ResolvedAppRateLimitOptions,
  now: number,
): void {
  for (const [key, bucket] of store) {
    if (now - bucket.windowStart >= limit.windowMs) store.delete(key);
  }
}

function appRateState(app: KovoApp): AppRateState {
  const existing = rateStates.get(app);
  if (existing) return existing;
  const next = { global: new Map<string, RateBucket>(), perIp: new Map<string, RateBucket>() };
  rateStates.set(app, next);
  return next;
}

/** @internal */
export function appRateLimitKeyCounts(app: KovoApp): { global: number; perIp: number } {
  const state = appRateState(app);
  return { global: state.global.size, perIp: state.perIp.size };
}

/** @internal */
export function requestWithBodyLimit(request: Request, maxBodyBytes: number | false): Request {
  if (maxBodyBytes === false || request.body === null) return request;
  return new Proxy(request, {
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
          return new Request(target.url, {
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
}

/** @internal */
export async function requestWithVerifiedBodyLimit(
  request: Request,
  maxBodyBytes: number | false,
): Promise<Request> {
  if (maxBodyBytes === false || request.body === null) return request;
  const body = await readLimitedArrayBuffer(request, maxBodyBytes);
  return new Request(request.url, {
    body,
    headers: request.headers,
    method: request.method,
    signal: request.signal,
  });
}

async function readLimitedArrayBuffer(
  request: Request,
  maxBodyBytes: number,
): Promise<ArrayBuffer> {
  if (request.body === null) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyLimitExceededError(maxBodyBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
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
    limits.clientIp?.(request) ?? requestClientIp(request, { trustedProxy: limits.trustedProxy });
  const trimmed = ip?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function requestClientIp(request: Request, options: { trustedProxy: boolean }): string | undefined {
  if (!options.trustedProxy) return undefined;
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = request.headers.get('forwarded');
  const match = forwarded?.match(/(?:^|;|,)\s*for="?([^";,\s]+)"?/i);
  return match?.[1];
}
