/**
 * Capability-URL framework download ROUTE + `ctx.signUrl` mint (SPEC §6.6 / §9.1;
 * `plans/secure-framework.md` Phase 5 follow-up). This is the framework-owned storage download
 * surface that HOSTS the verify sink for the cryptographic core in `./capability-url.ts`.
 *
 * What this closes (the load-bearing gap the audit/SPEC §6.6 flagged): `signCapability` /
 * `verifyCapability` are the sign + constant-time verify + one-time-replay primitive, but nothing
 * mounted them on the framework's storage surface. `createStorageDownloadEndpoint` builds a
 * framework-owned download `endpoint()` (GET/HEAD, prefix-mounted) whose handler:
 *
 *   1. derives the EXPECTED key/method/scope FROM THE REQUEST (the path segment after the mount +
 *      the HTTP method + a route-supplied scope) — NEVER from the token — so a token minted for
 *      object `a` cannot read object `b` even with an otherwise-valid signature;
 *   2. calls `verifyCapability` (fail-closed, ordered parse → constant-time sig → expiry →
 *      claim-match → one-time burn) BEFORE any `storage.get`/`storage.stream` — the storage read
 *      is unreachable unless the token verifies;
 *   3. on ANY failure returns a generic 404 with NO reason leaked to the client (the audit reject
 *      reason stays server-side).
 *
 * `ctx.signUrl({ key, method?, scope?, expiresIn?, oneTime? })` mints a signed URL pointing AT
 * that route, using `signCapability` + the framework signing secret. Short-expiry default
 * (`DEFAULT_CAPABILITY_TTL_MS`). The key is canonicalized (path normalization reused from
 * `@kovojs/core`'s `normalizeStorageKey`) BEFORE signing, matching what the route re-derives.
 *
 * Honesty (SPEC §6.6, label exactly): the verify sink is **by-construction** — given the handler
 * runs `verifyCapability` before the storage read, an object is *un-dereferenceable without a
 * verifying token*. The URL is a **bearer credential**; its *leakage* via `Referer` / server &
 * proxy logs / CDN caches is **MITIGATED** (short expiry by default, narrow scope, optional
 * one-time replay) but **NOT proven**. Treat a signed URL as a secret.
 *
 * Every mint is observed by a bounded runtime capability collector (SF-WIRE below).
 */

import type { StorageReadCapability } from '@kovojs/core';
import { normalizeStorageKey } from '@kovojs/core/internal/storage';
import { createBoundedRuntimeAuditCollector } from '@kovojs/core/internal/security-markers';

import { verifiedAccess } from './access.js';
import {
  capabilityDecodeURIComponent,
  capabilityDefineProperty,
  capabilityEncodeURIComponent,
  capabilityError,
  capabilityFreeze,
  capabilityIsSafeInteger,
  capabilityOwnDataValue,
  capabilityReflectApply,
  capabilityRequestMethod,
  capabilityRequestUrl,
  capabilityStringCharCodeAt,
  capabilityStringIndexOf,
  capabilityStringSlice,
  capabilityStableProperty,
  capabilityStringToUpperCase,
  capabilityTypeError,
  capabilityUrl,
  capabilityUrlParam,
  capabilityUrlPathname,
} from './capability-intrinsics.js';
import {
  frameworkEndpoint,
  pinEndpointSelfVerifyingAuth,
  type EndpointDeclaration,
  type EndpointMethod,
  type EndpointMount,
} from './endpoint.js';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  isDurableCapabilityReplayStore,
  MAX_CAPABILITY_AUDIENCE_LENGTH,
  MAX_CAPABILITY_KEY_LENGTH,
  MAX_CAPABILITY_SCOPE_LENGTH,
  MAX_CAPABILITY_TTL_MS,
  signCapability,
  snapshotReplayStore,
  verifyCapability,
  type CapabilityMethod,
  type CapabilityReplayStore,
  type SignedCapability,
} from './capability-url.js';
import { resolveBootMode } from './env.js';
import { signingKeyRingFromSecret, type SigningSecret } from './keyring.js';
import { respond, serverResponseToWebResponse, type RouteStoredFileOptions } from './response.js';

/** The query-parameter name the token rides in on a capability download URL. */
export const CAPABILITY_TOKEN_PARAM = 'kovo-cap';

/** Default mount path for the framework-owned storage download route. */
export const DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH = '/_kovo/storage';

/** Options accepted by `ctx.signUrl(...)`: the storage key plus the capability claims to mint. */
export interface SignUrlOptions {
  /** The storage object key to authorize (e.g. `receipts/ord_1.pdf`). Canonicalized before signing. */
  key: string;
  /** The HTTP method the URL authorizes. Downloads are reads; defaults to `GET`. */
  method?: CapabilityMethod;
  /** Optional scope binding (tenant/principal id) folded into the signature and re-checked at the sink. */
  scope?: string;
  /** Time-to-live in ms. Short by default (`DEFAULT_CAPABILITY_TTL_MS`) — a leaked URL is a bearer secret. */
  expiresIn?: number;
  /** When true, the URL is single-use: the sink burns it in the replay store on first dereference. */
  oneTime?: boolean;
}

/** The minted capability URL plus the claims it encodes. */
export interface SignedUrl {
  /** The absolute-path URL (mount base + url-encoded key + `?kovo-cap=<token>`) to hand a client. */
  url: string;
  /** The opaque capability token embedded in {@link url}. */
  token: string;
  /** The storage object key (canonicalized) the URL authorizes. */
  key: string;
  /** Whether the URL is single-use. */
  oneTime: boolean;
}

/** The `ctx.signUrl` capability added to the route request context (SPEC §6.6 / §9.1). */
export interface SignUrlContext {
  /**
   * Mint a signed, short-lived, scope-bound capability URL for a stored object, pointing at the
   * framework download route. Canonicalize-before-sign: the signed key is the normalized key the
   * route re-derives, so the URL is not dereferenceable for any other object. Records a capability
   * fact for `kovo explain --capabilities`.
   */
  signUrl(options: SignUrlOptions): Promise<SignedUrl>;
}

/** A recorded `ctx.signUrl(...)` mint, surfaced (audit-only) by `kovo explain --capabilities`. */
export interface CapabilityMintFact {
  /** The canonicalized storage key the minted URL authorizes. */
  readonly key: string;
  /** The HTTP method the URL authorizes. */
  readonly method: CapabilityMethod;
  /** The optional scope binding folded into the signature. */
  readonly scope?: string;
  /** Whether the minted URL is single-use. */
  readonly oneTime: boolean;
  /** The TTL (ms) the URL was minted with — the leakage-window the audit cares about. */
  readonly expiresInMs: number;
}

const capabilityMintFacts = createBoundedRuntimeAuditCollector<CapabilityMintFact>();
const STORAGE_DOWNLOAD_ENDPOINT_INFO = Symbol('kovo.storageDownloadEndpointInfo');

export interface StorageDownloadEndpointInfo {
  readonly basePath: string;
  readonly oneTimeReplayStore: boolean;
  readonly secret: SigningSecret;
  readonly scope?: (request: Request) => string | undefined;
}

type StorageDownloadEndpointDeclaration = EndpointDeclaration<string, 'GET', 'prefix'> & {
  allowedMethods?: readonly ['GET', 'HEAD'];
  [STORAGE_DOWNLOAD_ENDPOINT_INFO]?: StorageDownloadEndpointInfo;
};

/**
 * Drain the recorded `ctx.signUrl(...)` capability-mint facts (SPEC §6.6, audit-only).
 *
 * SF-WIRE(graph-output): render --capabilities capability-URL mints — wire
 * {@link drainCapabilityMintFacts} into runtime diagnostics. It retains the newest 256 mint
 * observations and is deliberately not a complete process-lifetime inventory. Each row is a
 * `kind: 'capabilityUrlMint'` escape: the URL is a bearer credential whose leakage is mitigated,
 * not proven (label per SPEC §6.6).
 */
export function drainCapabilityMintFacts(): readonly CapabilityMintFact[] {
  return capabilityMintFacts.drain();
}

/**
 * Build the absolute-path URL for a capability download: the mount base, the url-encoded
 * (canonicalized) key segments, and the token in the `kovo-cap` query param.
 */
function buildCapabilityUrl(basePath: string, key: string, token: string): string {
  const base = normalizeCapabilityBasePath(basePath);
  const encodedKey = transformCapabilityPathSegments(key, capabilityEncodeURIComponent);
  return `${base}/${encodedKey}?${CAPABILITY_TOKEN_PARAM}=${capabilityEncodeURIComponent(token)}`;
}

/**
 * Create the `ctx.signUrl` capability bound to the framework signing secret and the download
 * route's mount path. `createApp` threads this onto the route request context so a page can mint a
 * capability URL for a stored object.
 *
 * @param options - The framework signing `secret`, the route `basePath`, and an optional scope
 *   the mints default to (e.g. the request's tenant).
 */
export function createSignUrl(options: {
  secret: SigningSecret;
  basePath?: string;
  defaultScope?: string;
  oneTimeReplayStore?: boolean;
  now?: () => number;
}): SignUrlContext {
  const configuredSecret = capabilityOwnDataValue(options, 'secret');
  const configuredBasePath = capabilityOwnDataValue(options, 'basePath');
  const defaultScope = capabilityOwnDataValue(options, 'defaultScope');
  const oneTimeReplayStore = capabilityOwnDataValue(options, 'oneTimeReplayStore');
  const now = capabilityOwnDataValue(options, 'now');
  if (
    (configuredBasePath !== undefined &&
      (typeof configuredBasePath !== 'string' ||
        configuredBasePath.length > MAX_CAPABILITY_AUDIENCE_LENGTH)) ||
    (defaultScope !== undefined &&
      (typeof defaultScope !== 'string' || defaultScope.length > MAX_CAPABILITY_SCOPE_LENGTH)) ||
    (oneTimeReplayStore !== undefined && typeof oneTimeReplayStore !== 'boolean') ||
    (now !== undefined && typeof now !== 'function')
  ) {
    throw capabilityTypeError('ctx.signUrl configuration must use stable values.');
  }
  if (resolveBootMode() === 'production' && now !== undefined) {
    throw capabilityError(
      'KV436: createSignUrl() refused an injected clock in production (SPEC §6.6).',
    );
  }
  const secret = signingKeyRingFromSecret(configuredSecret as SigningSecret);
  const basePath = normalizeCapabilityBasePath(
    configuredBasePath ?? DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  );
  if (capabilityRouteAudience(basePath).length > MAX_CAPABILITY_AUDIENCE_LENGTH) {
    throw capabilityTypeError('ctx.signUrl basePath exceeds the bounded capability audience.');
  }
  return capabilityFreeze({
    async signUrl(signOptions: SignUrlOptions): Promise<SignedUrl> {
      const sourceKey = capabilityOwnDataValue(signOptions, 'key');
      const configuredMethod = capabilityOwnDataValue(signOptions, 'method');
      const configuredScope = capabilityOwnDataValue(signOptions, 'scope');
      const configuredExpiresIn = capabilityOwnDataValue(signOptions, 'expiresIn');
      const configuredOneTime = capabilityOwnDataValue(signOptions, 'oneTime');
      if (
        typeof sourceKey !== 'string' ||
        sourceKey.length > MAX_CAPABILITY_KEY_LENGTH ||
        (configuredMethod !== undefined &&
          configuredMethod !== 'GET' &&
          configuredMethod !== 'HEAD') ||
        (configuredScope !== undefined &&
          (typeof configuredScope !== 'string' ||
            configuredScope.length > MAX_CAPABILITY_SCOPE_LENGTH)) ||
        (configuredExpiresIn !== undefined && typeof configuredExpiresIn !== 'number') ||
        (typeof configuredExpiresIn === 'number' &&
          (!capabilityIsSafeInteger(configuredExpiresIn) ||
            configuredExpiresIn <= 0 ||
            configuredExpiresIn > MAX_CAPABILITY_TTL_MS)) ||
        (configuredOneTime !== undefined && typeof configuredOneTime !== 'boolean')
      ) {
        throw capabilityTypeError('ctx.signUrl options must use stable, typed values.');
      }
      // Canonicalize-before-sign: normalize the key the same way the storage adapters + the route
      // do, so the signed key is byte-identical to what the sink re-derives from the request path.
      const key = normalizeStorageKey(sourceKey);
      const method = configuredMethod ?? 'GET';
      const scope = configuredScope ?? defaultScope;
      const expiresIn = configuredExpiresIn ?? DEFAULT_CAPABILITY_TTL_MS;
      const oneTime = configuredOneTime === true;
      if (oneTime && oneTimeReplayStore !== true) {
        throw capabilityError(
          'ctx.signUrl({ oneTime: true }) requires a storage download endpoint with a replayStore. ' +
            'One-time capability URLs are unusable without a replay store at the verify sink ' +
            '(SPEC §6.6); pass oneTimeReplayStore: true for an explicit signer bound to such an ' +
            'endpoint, or configure replayStore on createStorageDownloadEndpoint().',
        );
      }
      let currentTime: number | undefined;
      if (now !== undefined) {
        const configuredTime = capabilityReflectApply<unknown>(now, undefined, []);
        if (typeof configuredTime !== 'number') {
          throw capabilityTypeError('ctx.signUrl clock must return an epoch-millisecond number.');
        }
        currentTime = configuredTime;
      }
      const signed: SignedCapability = await signCapability(
        secret,
        {
          key,
          method,
          ...(scope === undefined ? {} : { scope }),
          audience: capabilityRouteAudience(basePath),
          expiresIn,
          oneTime,
        },
        currentTime,
      );
      // Audit (SPEC §6.6): record every mint of a bearer download URL for `kovo explain
      // --capabilities`. Surfacing informs review; it enforces nothing.
      capabilityMintFacts.record({
        key,
        method,
        ...(scope === undefined ? {} : { scope }),
        oneTime,
        expiresInMs: expiresIn,
      });
      return {
        url: buildCapabilityUrl(basePath, key, signed.token),
        token: signed.token,
        key,
        oneTime,
      };
    },
  });
}

/** Options for the framework-owned storage download route. */
export interface StorageDownloadEndpointOptions {
  /** The storage capability the verified handler reads from (AFTER the verify sink passes). */
  storage: StorageReadCapability;
  /** The framework signing secret the token is verified against (NOT app/per-request controlled). */
  secret: SigningSecret;
  /** Mount path; the route is `prefix`-mounted here. Defaults to `/_kovo/storage`. */
  basePath?: string;
  /** The scope the sink derives from the request and re-checks against the token's claim. */
  scope?: (request: Request) => string | undefined;
  /**
   * A one-time replay store; REQUIRED in production and to honor `oneTime` tokens. Production
   * accepts only createPostgresAppRuntimeDb().capabilityReplayStore.
   */
  replayStore?: CapabilityReplayStore;
  /** Development/test-only injectable clock (epoch ms); production refuses it. */
  now?: () => number;
  /** Disposition/filename forwarded to `respond.storedFile` AFTER verification (server-sniffed type). */
  storedFile?: Pick<RouteStoredFileOptions, 'disposition' | 'filename'>;
}

function snapshotStorageReadCapability(source: unknown): StorageReadCapability {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw capabilityTypeError('Storage download endpoint requires a storage read capability.');
  }
  const get = capabilityStableProperty(source, 'get');
  const stat = capabilityStableProperty(source, 'stat');
  const stream = capabilityStableProperty(source, 'stream');
  if (typeof get !== 'function' || typeof stat !== 'function' || typeof stream !== 'function') {
    throw capabilityTypeError(
      'Storage download endpoint requires stable get, stat, and stream methods.',
    );
  }
  return capabilityFreeze({
    get(key: string): ReturnType<StorageReadCapability['get']> {
      return capabilityReflectApply(get, source, [key]);
    },
    stat(key: string): ReturnType<StorageReadCapability['stat']> {
      return capabilityReflectApply(stat, source, [key]);
    },
    stream(key: string): ReturnType<StorageReadCapability['stream']> {
      return capabilityReflectApply(stream, source, [key]);
    },
  });
}

function snapshotStoredFileOptions(source: unknown): RouteStoredFileOptions {
  if (source === undefined) return capabilityFreeze({});
  if (typeof source !== 'object' || source === null) {
    throw capabilityTypeError('Storage download storedFile configuration must be an object.');
  }
  const disposition = capabilityOwnDataValue(source, 'disposition');
  const filename = capabilityOwnDataValue(source, 'filename');
  if (
    (disposition !== undefined && disposition !== 'attachment' && disposition !== 'inline') ||
    (filename !== undefined && typeof filename !== 'string')
  ) {
    throw capabilityTypeError('Storage download storedFile configuration has invalid values.');
  }
  return capabilityFreeze({
    ...(disposition === undefined ? {} : { disposition }),
    ...(filename === undefined ? {} : { filename }),
  });
}

/**
 * A generic, reason-free fail-closed response for the download route. A failing capability check
 * MUST NOT leak WHY it failed (malformed vs bad-signature vs expired vs claim-mismatch vs replayed)
 * — every rejection is an indistinguishable 404 so the route is not an oracle. The 404 (not 403)
 * also hides whether the object exists at all.
 */
function downloadRejected(method = 'GET'): Response {
  return serverResponseToWebResponse(
    {
      body: 'Not Found',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
      status: 404,
    },
    { method },
  );
}

/**
 * Derive the requested storage key from a download request: the path AFTER the mount base. Returns
 * `undefined` for a path that is not under the mount or that normalizes to nothing. The key is run
 * through `normalizeStorageKey` so it is byte-identical to the signed (canonicalized) key — a
 * traversal/odd-segment key throws there and is treated as a miss (fail closed, no read).
 */
export function deriveDownloadKey(pathname: string, basePath: string): string | undefined {
  if (typeof pathname !== 'string' || typeof basePath !== 'string') return undefined;
  let base: string;
  try {
    base = normalizeCapabilityBasePath(basePath);
  } catch {
    return undefined;
  }
  if (pathname === base || capabilityStringIndexOf(pathname, `${base}/`) !== 0) return undefined;
  let offset = base.length;
  while (offset < pathname.length && capabilityStringCharCodeAt(pathname, offset) === 0x2f) {
    offset += 1;
  }
  const rest = capabilityStringSlice(pathname, offset);
  if (rest.length === 0) return undefined;
  let decoded: string;
  try {
    decoded = transformCapabilityPathSegments(rest, capabilityDecodeURIComponent);
  } catch {
    return undefined;
  }
  try {
    return normalizeStorageKey(decoded);
  } catch {
    return undefined;
  }
}

/**
 * Build the framework-owned storage download route as a prefix-mounted GET/HEAD `endpoint()`. The
 * handler is the VERIFY SINK: it re-derives the expected key/method/scope from the request and runs
 * `verifyCapability` BEFORE any storage read; on any failure it fails closed (generic 404, object
 * never read, reason never leaked). This is what makes a stored object un-dereferenceable without a
 * verifying token (SPEC §6.6, by-construction at the sink).
 *
 * @param options - The `storage` to read from, the signing `secret`, the mount `basePath`, an
 *   optional request-derived `scope`, an optional `replayStore` for one-time tokens, and a clock.
 * @returns A prefix-mounted GET/HEAD `EndpointDeclaration`.
 */
export function createStorageDownloadEndpoint(
  options: StorageDownloadEndpointOptions,
): EndpointDeclaration<string, 'GET', 'prefix'> {
  const sourceStorage = capabilityOwnDataValue(options, 'storage');
  const configuredSecret = capabilityOwnDataValue(options, 'secret');
  const configuredBasePath = capabilityOwnDataValue(options, 'basePath');
  const configuredScopeForRequest = capabilityOwnDataValue(options, 'scope');
  const configuredReplayStore = capabilityOwnDataValue(options, 'replayStore');
  const now = capabilityOwnDataValue(options, 'now');
  const configuredStoredFile = capabilityOwnDataValue(options, 'storedFile');
  if (
    (configuredBasePath !== undefined &&
      (typeof configuredBasePath !== 'string' ||
        configuredBasePath.length > MAX_CAPABILITY_AUDIENCE_LENGTH)) ||
    (configuredScopeForRequest !== undefined && typeof configuredScopeForRequest !== 'function') ||
    (now !== undefined && typeof now !== 'function')
  ) {
    throw capabilityTypeError('Storage download endpoint configuration must use stable values.');
  }
  if (resolveBootMode() === 'production' && now !== undefined) {
    throw capabilityError(
      'KV436: createStorageDownloadEndpoint() refused an injected clock in production (SPEC §6.6).',
    );
  }
  const scopeForRequest = configuredScopeForRequest as
    | ((request: Request) => string | undefined)
    | undefined;
  const secret = signingKeyRingFromSecret(configuredSecret as SigningSecret);
  const basePath = normalizeCapabilityBasePath(
    configuredBasePath ?? DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  );
  if (capabilityRouteAudience(basePath).length > MAX_CAPABILITY_AUDIENCE_LENGTH) {
    throw capabilityTypeError(
      'Storage download endpoint basePath exceeds the bounded capability audience.',
    );
  }
  const storage = snapshotStorageReadCapability(sourceStorage);
  const replayStore =
    configuredReplayStore === undefined ? undefined : snapshotReplayStore(configuredReplayStore);
  if (resolveBootMode() === 'production' && !isDurableCapabilityReplayStore(replayStore)) {
    throw capabilityError(
      'KV436: createStorageDownloadEndpoint() refused a missing, custom, or volatile memory replayStore in production; use createPostgresAppRuntimeDb().capabilityReplayStore so one-time token consumption survives restart and replicas (SPEC §6.6/§10.3).',
    );
  }
  const storedFile = snapshotStoredFileOptions(configuredStoredFile);

  const handler = async (request: Request): Promise<Response> => {
    let method = 'GET';
    let expectedMethod: CapabilityMethod;
    let key: string;
    try {
      method = capabilityStringToUpperCase(capabilityRequestMethod(request));
      if (method !== 'GET' && method !== 'HEAD') return downloadRejected(method);
      expectedMethod = method;

      const url = capabilityUrl(capabilityRequestUrl(request));
      const token = capabilityUrlParam(url, CAPABILITY_TOKEN_PARAM);
      if (token === null || token.length === 0) return downloadRejected(method);

      // Derive the EXPECTED claims FROM THE REQUEST — never from the token. This is the load-bearing
      // step: the route, not the token, says which object/method/scope is being authorized.
      const requestedKey = deriveDownloadKey(capabilityUrlPathname(url), basePath);
      if (requestedKey === undefined || requestedKey.length > MAX_CAPABILITY_KEY_LENGTH) {
        return downloadRejected(method);
      }
      key = requestedKey;
      const scope =
        scopeForRequest === undefined
          ? undefined
          : capabilityReflectApply<unknown>(scopeForRequest, undefined, [request]);
      if (scope !== undefined && typeof scope !== 'string') return downloadRejected(method);
      let currentTime: number | undefined;
      if (now !== undefined) {
        const configuredTime = capabilityReflectApply<unknown>(now, undefined, []);
        if (typeof configuredTime !== 'number') return downloadRejected(method);
        currentTime = configuredTime;
      }

      // VERIFY BEFORE READ. The storage read below is unreachable unless this passes.
      const verification = await verifyCapability(
        secret,
        token,
        {
          key,
          method: expectedMethod,
          ...(scope === undefined ? {} : { scope }),
        },
        {
          ...(currentTime === undefined ? {} : { now: currentTime }),
          audience: capabilityRouteAudience(basePath),
          ...(replayStore === undefined ? {} : { replayStore }),
        },
      );
      // Fail closed on ANY rejection. The reason stays server-side (never leaked to the client).
      if (!verification.ok) return downloadRejected(method);
    } catch {
      return downloadRejected(method);
    }

    // Only NOW — after a verifying token — do we touch storage. A HEAD verifies identically but
    // returns no body.
    const outcome = await respond.storedFile(storage, key, storedFile);
    if (outcome === undefined) return downloadRejected(method);

    const headers: Record<string, string> = {
      'Cache-Control': 'private, no-store',
      'Content-Type': outcome.contentType,
      'Content-Disposition': outcome.contentDisposition,
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      ...(outcome.etag === undefined ? {} : { ETag: outcome.etag }),
    };
    return serverResponseToWebResponse(
      {
        body: outcome.body,
        headers,
        status: 200,
      },
      { method: expectedMethod },
    );
  };

  const declaration = frameworkEndpoint(
    basePath,
    {
      access: verifiedAccess,
      method: 'GET',
      mount: 'prefix',
      mountJustification:
        'Framework-owned capability-URL storage download route: one handler serves any stored ' +
        'object key under this prefix, gated by a per-object signed token verified before any read.',
      reason:
        'Capability-URL storage download verify sink (SPEC §6.6): verifyCapability runs before any ' +
        'storage read so an object is un-dereferenceable without a token minted for that exact object.',
      // The capability token IS the auth/CSRF defense here: a state-changing verb never reaches this
      // read-only route (non-GET/HEAD fail closed), and the bearer token gates every read.
      auth: {
        kind: 'verifier',
        name: 'kovo-capability-url',
      },
      csrf: false,
      csrfJustification:
        'Read-only download gated by a per-request signed capability token (not a cookie/ambient ' +
        'credential), so there is no CSRF surface; non-GET/HEAD methods fail closed.',
      response: {
        appOwnedSafety: true,
        body: ['bytes', 'text'],
        cache: 'private',
        reservedHeaders: ['X-Content-Type-Options'],
      },
      handler,
    },
    (frameworkDeclaration) => {
      pinEndpointSelfVerifyingAuth(frameworkDeclaration);
      capabilityDefineProperty(frameworkDeclaration, 'allowedMethods', {
        configurable: false,
        enumerable: false,
        value: capabilityFreeze(['GET', 'HEAD']) satisfies readonly ['GET', 'HEAD'],
        writable: false,
      });
      capabilityDefineProperty(frameworkDeclaration, STORAGE_DOWNLOAD_ENDPOINT_INFO, {
        configurable: false,
        enumerable: false,
        value: capabilityFreeze({
          basePath,
          oneTimeReplayStore: replayStore !== undefined,
          secret,
          ...(scopeForRequest === undefined ? {} : { scope: scopeForRequest }),
        } satisfies StorageDownloadEndpointInfo),
        writable: false,
      });
    },
  );
  return declaration;
}

function capabilityRouteAudience(basePath: string): string {
  return `storage-download:${normalizeCapabilityBasePath(basePath)}`;
}

function normalizeCapabilityBasePath(basePath: string): string {
  if (typeof basePath !== 'string') throw invalidCapabilityBasePath();
  let end = basePath.length;
  while (end > 0 && capabilityStringCharCodeAt(basePath, end - 1) === 0x2f) end -= 1;
  const normalized = capabilityStringSlice(basePath, 0, end);
  if (normalized.length === 0 || !isSafeCapabilityBasePath(basePath)) {
    throw invalidCapabilityBasePath();
  }
  return normalized;
}

function isSafeCapabilityBasePath(value: string): boolean {
  if (
    value.length === 0 ||
    capabilityStringCharCodeAt(value, 0) !== 0x2f ||
    capabilityStringCharCodeAt(value, 1) === 0x2f ||
    capabilityStringCharCodeAt(value, 1) === 0x5c
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = capabilityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c || code === 0x3f || code === 0x23) {
      return false;
    }
  }
  return true;
}

function invalidCapabilityBasePath(): TypeError {
  return capabilityTypeError(
    'Capability URL basePath must be a non-root same-origin absolute path without control ' +
      'characters, query, hash, or backslashes (SPEC §6.6).',
  );
}

function transformCapabilityPathSegments(
  value: string,
  transform: (segment: string) => string,
): string {
  let result = '';
  let start = 0;
  while (start <= value.length) {
    const separator = capabilityStringIndexOf(value, '/', start);
    const end = separator === -1 ? value.length : separator;
    if (start !== 0) result += '/';
    result += transform(capabilityStringSlice(value, start, end));
    if (separator === -1) return result;
    start = separator + 1;
  }
  return result;
}

/** @internal */
export function storageDownloadEndpointBasePath(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): string | undefined {
  return storageDownloadEndpointInfo(definition)?.basePath;
}

/** @internal */
export function storageDownloadEndpointInfo(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
): StorageDownloadEndpointInfo | undefined {
  if (typeof definition !== 'object' || definition === null) return undefined;
  return capabilityOwnDataValue(
    definition as StorageDownloadEndpointDeclaration,
    STORAGE_DOWNLOAD_ENDPOINT_INFO,
  ) as StorageDownloadEndpointInfo | undefined;
}
