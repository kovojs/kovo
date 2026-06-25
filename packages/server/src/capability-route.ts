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
 * Every mint records a capability fact drained into `kovo explain --capabilities` (SF-WIRE below).
 */

import type { StorageCapability } from '@kovojs/core';
import { normalizeStorageKey } from '@kovojs/core/internal/storage';

import { endpoint, type EndpointDeclaration } from './endpoint.js';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  signCapability,
  verifyCapability,
  type CapabilityMethod,
  type CapabilityReplayStore,
  type SignedCapability,
} from './capability-url.js';
import { respond, type RouteStoredFileOptions } from './response.js';

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

const capabilityMintFacts: CapabilityMintFact[] = [];

/**
 * Drain the recorded `ctx.signUrl(...)` capability-mint facts (SPEC §6.6, audit-only).
 *
 * SF-WIRE(graph-output): render --capabilities capability-URL mints — wire
 * {@link drainCapabilityMintFacts} into `kovo explain --capabilities` so every minted bearer
 * download URL (key, method, scope, ttl, one-time) is surfaced in the audit a reviewer runs. Each
 * row is a `kind: 'capabilityUrlMint'` escape: the URL is a bearer credential whose leakage is
 * mitigated, not proven (label per SPEC §6.6). Do NOT edit cli/graph-output.ts from this slice.
 */
export function drainCapabilityMintFacts(): readonly CapabilityMintFact[] {
  return capabilityMintFacts.splice(0, capabilityMintFacts.length);
}

/**
 * Build the absolute-path URL for a capability download: the mount base, the url-encoded
 * (canonicalized) key segments, and the token in the `kovo-cap` query param.
 */
function buildCapabilityUrl(basePath: string, key: string, token: string): string {
  const base = basePath.replace(/\/+$/, '');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encodedKey}?${CAPABILITY_TOKEN_PARAM}=${encodeURIComponent(token)}`;
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
  secret: string | Uint8Array;
  basePath?: string;
  defaultScope?: string;
  now?: () => number;
}): SignUrlContext {
  const basePath = options.basePath ?? DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH;
  return {
    async signUrl(signOptions: SignUrlOptions): Promise<SignedUrl> {
      // Canonicalize-before-sign: normalize the key the same way the storage adapters + the route
      // do, so the signed key is byte-identical to what the sink re-derives from the request path.
      const key = normalizeStorageKey(signOptions.key);
      const method = signOptions.method ?? 'GET';
      const scope = signOptions.scope ?? options.defaultScope;
      const expiresIn = signOptions.expiresIn ?? DEFAULT_CAPABILITY_TTL_MS;
      const oneTime = signOptions.oneTime === true;
      const signed: SignedCapability = await signCapability(
        options.secret,
        {
          key,
          method,
          ...(scope === undefined ? {} : { scope }),
          expiresIn,
          oneTime,
        },
        options.now?.(),
      );
      // Audit (SPEC §6.6): record every mint of a bearer download URL for `kovo explain
      // --capabilities`. Surfacing informs review; it enforces nothing.
      capabilityMintFacts.push({
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
  };
}

/** Options for the framework-owned storage download route. */
export interface StorageDownloadEndpointOptions {
  /** The storage capability the verified handler reads from (AFTER the verify sink passes). */
  storage: StorageCapability;
  /** The framework signing secret the token is verified against (NOT app/per-request controlled). */
  secret: string | Uint8Array;
  /** Mount path; the route is `prefix`-mounted here. Defaults to `/_kovo/storage`. */
  basePath?: string;
  /** The scope the sink derives from the request and re-checks against the token's claim. */
  scope?: (request: Request) => string | undefined;
  /** A one-time replay store; REQUIRED to honor `oneTime` tokens (absent ⇒ one-time tokens fail closed). */
  replayStore?: CapabilityReplayStore;
  /** Injectable clock (epoch ms) for tests. */
  now?: () => number;
  /** Disposition/filename forwarded to `respond.storedFile` AFTER verification (server-sniffed type). */
  storedFile?: Pick<RouteStoredFileOptions, 'disposition' | 'filename'>;
}

/**
 * A generic, reason-free fail-closed response for the download route. A failing capability check
 * MUST NOT leak WHY it failed (malformed vs bad-signature vs expired vs claim-mismatch vs replayed)
 * — every rejection is an indistinguishable 404 so the route is not an oracle. The 404 (not 403)
 * also hides whether the object exists at all.
 */
function downloadRejected(): Response {
  return new Response('Not Found', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    status: 404,
  });
}

/**
 * Derive the requested storage key from a download request: the path AFTER the mount base. Returns
 * `undefined` for a path that is not under the mount or that normalizes to nothing. The key is run
 * through `normalizeStorageKey` so it is byte-identical to the signed (canonicalized) key — a
 * traversal/odd-segment key throws there and is treated as a miss (fail closed, no read).
 */
export function deriveDownloadKey(pathname: string, basePath: string): string | undefined {
  const base = basePath.replace(/\/+$/, '');
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  const rest = pathname.slice(base.length).replace(/^\/+/, '');
  if (rest.length === 0) return undefined;
  let decoded: string;
  try {
    decoded = rest.split('/').map(decodeURIComponent).join('/');
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
 * @returns A prefix-mounted GET `EndpointDeclaration` (HEAD is handled within the same handler).
 */
export function createStorageDownloadEndpoint(
  options: StorageDownloadEndpointOptions,
): EndpointDeclaration<string, 'GET', 'prefix'> {
  const basePath = options.basePath ?? DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH;

  const handler = async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return downloadRejected();
    const expectedMethod: CapabilityMethod = method;

    const url = new URL(request.url);
    const token = url.searchParams.get(CAPABILITY_TOKEN_PARAM);
    if (token === null || token.length === 0) return downloadRejected();

    // Derive the EXPECTED claims FROM THE REQUEST — never from the token. This is the load-bearing
    // step: the route, not the token, says which object/method/scope is being authorized.
    const key = deriveDownloadKey(url.pathname, basePath);
    if (key === undefined) return downloadRejected();
    const scope = options.scope?.(request);

    // VERIFY BEFORE READ. The storage read below is unreachable unless this passes.
    const verification = await verifyCapability(
      options.secret,
      token,
      {
        key,
        method: expectedMethod,
        ...(scope === undefined ? {} : { scope }),
      },
      {
        ...(options.now === undefined ? {} : { now: options.now() }),
        ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
      },
    );
    // Fail closed on ANY rejection. The reason stays server-side (never leaked to the client).
    if (!verification.ok) return downloadRejected();

    // Only NOW — after a verifying token — do we touch storage. A HEAD verifies identically but
    // returns no body.
    const outcome = await respond.storedFile(options.storage, key, {
      ...(options.storedFile?.disposition === undefined
        ? {}
        : { disposition: options.storedFile.disposition }),
      ...(options.storedFile?.filename === undefined
        ? {}
        : { filename: options.storedFile.filename }),
    });
    if (outcome === undefined) return downloadRejected();

    const headers: Record<string, string> = {
      'Content-Type': outcome.contentType,
      'Content-Disposition': outcome.contentDisposition,
      'X-Content-Type-Options': 'nosniff',
      ...(outcome.etag === undefined ? {} : { ETag: outcome.etag }),
    };
    return new Response(expectedMethod === 'HEAD' ? null : (outcome.body as BodyInit), {
      headers,
      status: 200,
    });
  };

  return endpoint(basePath, {
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
    csrf: false,
    csrfJustification:
      'Read-only download gated by a per-request signed capability token (not a cookie/ambient ' +
      'credential), so there is no CSRF surface; non-GET/HEAD methods fail closed.',
    response: { appOwnedSafety: false, body: 'bytes', cache: 'private' },
    handler,
  });
}
