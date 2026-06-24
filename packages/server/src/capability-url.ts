import { createHmac } from 'node:crypto';
import type { StorageCapability, StorageStreamResult } from '@kovojs/core';
import { respond, routeOutcomeResponse, routeResponseToWebResponse } from './response.js';

/**
 * A capability URL scope. `exact` is the default and binds the URL to its
 * canonical key. `prefix` records a normalized key prefix for audited broader
 * capabilities while the URL still signs the concrete key (SPEC.md Phase 5
 * Capability-URL primitive).
 */
export type CapabilityUrlScope =
  | { kind?: 'exact' }
  | {
      kind: 'prefix';
      prefix: string;
    };

/** Secret bytes used to HMAC-sign capability URLs. */
export type CapabilityUrlSecret = string | Uint8Array;

/** Input for minting an HMAC-signed capability URL. */
export interface SignCapabilityUrlOptions {
  /** URL base or full URL path that receives the capability query parameters. */
  baseUrl: string | URL;
  /** Concrete storage/object key authorized by the capability. */
  key: string;
  /** HTTP method authorized by the capability. */
  method: string;
  /** Signing clock. Defaults to `Date.now()`. */
  now?: Date | number;
  /** Scope classification. Defaults to exact `key + method`. */
  scope?: CapabilityUrlScope;
  /** HMAC signing secret. */
  secret: CapabilityUrlSecret;
  /** Relative expiry in seconds. Defaults to a short 300-second lifetime. */
  expiresIn?: number;
}

/** App-shell configuration for framework-owned capability URL minting and verification. */
export interface AppCapabilityUrlOptions {
  /** URL path reserved for framework-owned capability verification. Defaults to `/_cap/storage`. */
  path?: string;
  /** HMAC signing secret for capability URLs. */
  secret: CapabilityUrlSecret;
  /** Object store read only after framework verification succeeds. */
  storage?: StorageCapability;
}

/** Server-owned minting input exposed on lifecycle requests as `request.signUrl`. */
export interface AppSignCapabilityUrlOptions {
  /** Concrete storage/object key authorized by the capability. */
  key: string;
  /** HTTP method authorized by the capability. Defaults to `GET`. */
  method?: string;
  /** Scope classification. Defaults to exact `key + method`. */
  scope?: CapabilityUrlScope;
  /** Relative expiry in seconds. Defaults to a short 300-second lifetime. */
  expiresIn?: number;
}

/** Server-owned capability URL minting function installed on lifecycle requests. */
export type AppCapabilityUrlSigner = (options: AppSignCapabilityUrlOptions) => string;

/** Input for verifying an HMAC-signed capability URL before dereferencing a key. */
export interface VerifyCapabilityUrlOptions {
  /** Concrete storage/object key the sink is about to dereference. */
  key: string;
  /** HTTP method at the verify sink. */
  method: string;
  /** Verification clock. Defaults to `Date.now()`. */
  now?: Date | number;
  /** Expected scope classification. Defaults to exact `key + method`. */
  scope?: CapabilityUrlScope;
  /** HMAC signing secret. */
  secret: CapabilityUrlSecret;
}

/** Successful verification metadata returned by `verifyCapabilityUrl`. */
export interface CapabilityUrlVerification {
  expiresAt: Date;
  key: string;
  method: string;
  ok: true;
  scope: string;
}

/** Discriminated result returned by `verifyCapabilityUrl` before a capability sink reads an object. */
export type CapabilityUrlVerificationResult =
  | CapabilityUrlVerification
  | {
      ok: false;
      reason:
        | 'expired'
        | 'invalid'
        | 'key-mismatch'
        | 'malformed'
        | 'method-mismatch'
        | 'scope-mismatch';
    };

const CAPABILITY_STORAGE_PATH = '/_cap/storage';

const DEFAULT_EXPIRES_IN_SECONDS = 5 * 60;
const textEncoder = new TextEncoder();

/**
 * Mint a signed capability URL whose HMAC covers canonical
 * `method + key + expiry + scope` bytes. The key and scope are normalized before
 * signing so backslash, double-slash, and dot-segment variants cannot reopen a
 * capability at the verify sink.
 */
export function signCapabilityUrl(options: SignCapabilityUrlOptions): string {
  const method = canonicalCapabilityMethod(options.method);
  const key = canonicalCapabilityKey(options.key);
  const scope = canonicalCapabilityScope(options.scope, key);
  const expiresAt = expirySeconds(options.now, options.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS);
  const payload = canonicalCapabilityPayload({ expiresAt, key, method, scope });
  const signature = hmacCapabilityPayload(options.secret, payload);

  const url = new URL(options.baseUrl);
  url.searchParams.set('kovo-cap-key', key);
  url.searchParams.set('kovo-cap-method', method);
  url.searchParams.set('kovo-cap-exp', String(expiresAt));
  url.searchParams.set('kovo-cap-scope', scope);
  url.searchParams.set('kovo-cap-sig', signature);
  return url.toString();
}

/**
 * Build the server-owned `request.signUrl()` helper for an app request. The base
 * path is framework-reserved so signed credentials do not get minted into
 * ordinary query/cacheable URLs by default (SPEC.md Phase 5 Capability-URLs).
 */
export function createAppCapabilityUrlSigner(
  requestUrl: string,
  options: AppCapabilityUrlOptions,
): AppCapabilityUrlSigner {
  return (input) =>
    signCapabilityUrl({
      baseUrl: new URL(options.path ?? CAPABILITY_STORAGE_PATH, requestUrl),
      key: input.key,
      method: input.method ?? 'GET',
      ...(input.expiresIn === undefined ? {} : { expiresIn: input.expiresIn }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      secret: options.secret,
    });
}

/**
 * Verify a signed capability URL before reading the named object. Verification
 * fails closed for malformed, tampered, expired, wrong-method, wrong-key, and
 * wrong-scope URLs; callers should perform no storage read unless `ok` is true.
 */
export function verifyCapabilityUrl(
  url: string | URL,
  options: VerifyCapabilityUrlOptions,
): CapabilityUrlVerificationResult {
  const parsed = new URL(url);
  const rawKey = parsed.searchParams.get('kovo-cap-key');
  const rawMethod = parsed.searchParams.get('kovo-cap-method');
  const rawExpiry = parsed.searchParams.get('kovo-cap-exp');
  const rawScope = parsed.searchParams.get('kovo-cap-scope');
  const rawSignature = parsed.searchParams.get('kovo-cap-sig');

  if (
    rawKey === null ||
    rawMethod === null ||
    rawExpiry === null ||
    rawScope === null ||
    rawSignature === null
  ) {
    return { ok: false, reason: 'malformed' };
  }

  let signedKey: string;
  let expectedKey: string;
  let signedMethod: string;
  let expectedMethod: string;
  let expectedScope: string;
  try {
    signedKey = canonicalCapabilityKey(rawKey);
    expectedKey = canonicalCapabilityKey(options.key);
    signedMethod = canonicalCapabilityMethod(rawMethod);
    expectedMethod = canonicalCapabilityMethod(options.method);
    expectedScope = canonicalCapabilityScope(options.scope, expectedKey);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (signedMethod !== rawMethod) return { ok: false, reason: 'malformed' };
  if (signedKey !== rawKey) return { ok: false, reason: 'malformed' };
  if (signedMethod !== expectedMethod) return { ok: false, reason: 'method-mismatch' };
  if (signedKey !== expectedKey) return { ok: false, reason: 'key-mismatch' };
  if (rawScope !== expectedScope) return { ok: false, reason: 'scope-mismatch' };

  const expiresAt = parseExpirySeconds(rawExpiry);
  if (expiresAt === undefined) return { ok: false, reason: 'malformed' };
  if (expiresAt < nowSeconds(options.now)) return { ok: false, reason: 'expired' };

  const payload = canonicalCapabilityPayload({
    expiresAt,
    key: signedKey,
    method: signedMethod,
    scope: rawScope,
  });
  const expectedSignature = hmacCapabilityPayload(options.secret, payload);
  if (!constantTimeStringEqual(rawSignature, expectedSignature)) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    expiresAt: new Date(expiresAt * 1000),
    key: signedKey,
    method: signedMethod,
    ok: true,
    scope: rawScope,
  };
}

/** Render the framework-owned capability download endpoint. */
export async function renderCapabilityStorageResponse(
  request: Request,
  options: AppCapabilityUrlOptions | undefined,
): Promise<Response> {
  if (options?.storage === undefined) return capabilityFailureResponse(request, 404);

  const allowedMethods = ['GET', 'HEAD'];
  const method = request.method.toUpperCase();
  if (!allowedMethods.includes(method)) {
    return new Response(request.method === 'HEAD' ? null : 'Method Not Allowed', {
      headers: {
        Allow: allowedMethods.join(', '),
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 405,
    });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('kovo-cap-key');
  const scope = capabilityScopeFromSignedValue(url.searchParams.get('kovo-cap-scope'));
  if (key === null || scope === undefined) return capabilityFailureResponse(request, 403);

  const verification = verifyCapabilityUrl(url, {
    key,
    method,
    scope,
    secret: options.secret,
  });
  if (!verification.ok) return capabilityFailureResponse(request, 403);

  const object = await options.storage.stream(verification.key);
  if (object === undefined) return capabilityFailureResponse(request, 404);

  return capabilityStorageObjectResponse(request, object);
}

function canonicalCapabilityPayload(input: {
  expiresAt: number;
  key: string;
  method: string;
  scope: string;
}): string {
  return `kovo-cap-url-v1\nmethod=${input.method}\nkey=${input.key}\nexp=${input.expiresAt}\nscope=${input.scope}`;
}

function canonicalCapabilityMethod(method: string): string {
  const normalized = method.toUpperCase();
  if (!/^[A-Z]+$/u.test(normalized)) {
    throw new Error('Capability URL method must be an HTTP token made of letters');
  }
  return normalized;
}

function canonicalCapabilityKey(key: string): string {
  assertNoControlCharacters(key, 'Capability URL key');
  if (key.includes('\\')) throw new Error('Capability URL key must not contain backslashes');

  const withoutLeadingSlash = key.startsWith('/') ? key.slice(1) : key;
  if (withoutLeadingSlash.length === 0) throw new Error('Capability URL key must be non-empty');

  const segments = withoutLeadingSlash.split('/');
  for (const segment of segments) {
    if (segment.length === 0) throw new Error('Capability URL key must not contain // segments');
    if (segment === '.' || segment === '..') {
      throw new Error('Capability URL key must not contain dot segments');
    }
  }
  return segments.join('/');
}

function canonicalCapabilityScope(scope: CapabilityUrlScope | undefined, key: string): string {
  if (scope?.kind === 'prefix') {
    const prefix = canonicalCapabilityKey(scope.prefix);
    if (key !== prefix && !key.startsWith(`${prefix}/`)) {
      throw new Error('Capability URL prefix scope must contain the signed key');
    }
    return `prefix:${prefix}`;
  }
  return `key:${key}`;
}

function capabilityScopeFromSignedValue(value: string | null): CapabilityUrlScope | undefined {
  if (value === null) return undefined;
  if (value.startsWith('key:')) return { kind: 'exact' };
  if (value.startsWith('prefix:')) return { kind: 'prefix', prefix: value.slice('prefix:'.length) };
  return undefined;
}

function capabilityStorageObjectResponse(request: Request, object: StorageStreamResult): Response {
  const response = routeOutcomeResponse(
    respond.stream(object.body, {
      contentType: object.contentType ?? 'application/octet-stream',
      ...capabilityStorageFilenameOption(object.key),
      headers: {
        'Cache-Control': 'private, no-store',
        ...(object.etag === undefined ? {} : { ETag: object.etag }),
      },
    }),
    request,
  );

  return routeResponseToWebResponse(response, request);
}

function capabilityStorageFilenameOption(key: string): { filename: string } | {} {
  const filename = key.split('/').at(-1);
  return filename === undefined || filename === '' ? {} : { filename };
}

function capabilityFailureResponse(request: Request, status: 403 | 404): Response {
  return new Response(
    request.method === 'HEAD' ? null : status === 403 ? 'Forbidden' : 'Not Found',
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status,
    },
  );
}

function expirySeconds(now: Date | number | undefined, expiresIn: number): number {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Capability URL expiresIn must be a positive number of seconds');
  }
  return nowSeconds(now) + Math.floor(expiresIn);
}

function parseExpirySeconds(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function nowSeconds(now: Date | number | undefined): number {
  const milliseconds = now instanceof Date ? now.getTime() : (now ?? Date.now());
  return Math.floor(milliseconds / 1000);
}

function hmacCapabilityPayload(secret: CapabilityUrlSecret, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function assertNoControlCharacters(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(`${label} must not contain control characters`);
    }
  }
}
