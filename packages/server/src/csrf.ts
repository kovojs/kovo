import { randomBytes, randomUUID } from 'node:crypto';

import type { CookieOptions } from './cookies.js';
import { serializeCookie } from './cookies.js';
import { escapeAttribute } from './html.js';
import { currentJsxFrameworkContext } from './jsx-context.js';
import {
  isSigningKeyRing,
  signingKeyRingFromSecret,
  type SigningKeyRing,
  type SigningKeyRingOptions,
  type SigningSecret,
} from './keyring.js';
import { formLikeToRecord } from './schema.js';

/**
 * Anonymous CSRF binding cookie settings for sessionless mutation forms (SPEC §6.6).
 */
export interface CsrfAnonymousCookieOptions {
  maxAge?: number;
  name?: string;
  path?: string;
  sameSite?: 'lax' | 'none' | 'strict';
  secure?: boolean;
}

/** CSRF HMAC secret. Object form supports one previous key during deploy rotation. */
export type CsrfSecret =
  | string
  | Uint8Array
  | SigningKeyRing
  | SigningKeyRingOptions
  | {
      current: string;
      previous?: string;
    };

/** CSRF config: a `secret`, a session extractor, and optional anonymous form binding. */
export interface CsrfOptions<Request> {
  /** Configure or disable the anonymous CSRF cookie used when `sessionId` returns undefined. */
  anonymousCookie?: CsrfAnonymousCookieOptions | false;
  /** Form field name used as the default signing audience when no narrower sink audience is supplied. */
  field?: string;
  secret: CsrfSecret;
  sessionId: (request: Request) => string | undefined;
  /**
   * Allowlist of cross-origin origins permitted to make unsafe-verb requests (SPEC §6.6/§9.1). Each
   * entry is an absolute origin (e.g. `'https://app.example.com'`). The same-origin host is always
   * trusted; this list adds the legitimate cross-origin callers (split front-end, native shell) that
   * the header-based CSRF floor would otherwise reject. Flows from `createApp({ csrf })`.
   */
  trustedOrigins?: readonly string[];
}

/** `CsrfOptions` plus the optional form `field` name to validate against. */
export type CsrfValidationOptions<Request> = CsrfOptions<Request>;

/**
 * The mutation a hand-authored CSRF token/field targets (SPEC §6.5/§9.1): either the mutation
 * definition (any object carrying its `key`) or the bare mutation key string. Both resolve to the
 * same `definition.key` value that mutation dispatch validates the token against
 * (`runMutation`/`renderMutationResponse`/the no-JS path all check `{ audience: definition.key }`).
 * Naming the target is how `csrfField`/`csrfToken` bind the correct audience instead of the
 * generic `field:<name>` default — so a hand-rolled login/signup/logout/reset form cannot mint a
 * token the targeted mutation then rejects with a bare 422.
 *
 * @internal Kept private to `csrf.ts`; the public `csrfToken`/`csrfField` signatures inline this
 * shape so they do not require a separately-exported helper type (rules/api-surface.md). The same
 * structural shape is what callers pass.
 */
type CsrfMutationTarget = string | { readonly key: string };

/**
 * Audience-binding context for the standalone `csrfToken`/`csrfField` helpers (SPEC §6.5/§6.6/§9.1).
 *
 * Pass `mutation` (the targeted mutation definition or its key) so the minted token's signing
 * audience is `definition.key` — exactly what mutation dispatch validates against. This closes the
 * audit trap where a hand-authored auth form minted a `field:<name>`-audience token that the
 * mutation sink silently rejected (HTTP 422). `audience` remains for advanced, non-mutation sinks
 * that bind a custom audience; when both are supplied they MUST agree (a contradictory pair is a
 * configuration error and throws rather than minting a token for the wrong sink).
 *
 * @internal Inlined into the public signatures for the same api-surface reason as
 * `CsrfMutationTarget`.
 */
interface CsrfAudienceContext {
  audience?: string;
  mutation?: CsrfMutationTarget;
}

/**
 * Mint a CSRF synchronizer token for a request, bound to the targeted mutation (SPEC §6.5/§6.6/§9.1).
 *
 * For a hand-authored form, pass the targeted `mutation` so the token's audience is bound to the
 * mutation's `key` — the value mutation dispatch validates against. Without it the token defaults to
 * the generic `field:<name>` audience, which a mutation sink rejects with a bare 422; binding the
 * mutation closes that audit trap by construction.
 *
 * @param request - The request to derive the session (or anonymous binding) from.
 * @param options - The CSRF `secret` and `sessionId` extractor.
 * @param context - Audience binding: the targeted `mutation` (preferred) or a raw `audience`.
 * @returns The CSRF token string.
 * @example
 * import { csrfToken } from '@kovojs/server';
 *
 * interface Req { session: { id: string } }
 * // Bind the token to the mutation the form targets (closes the audience-mismatch trap):
 * const token: string = csrfToken({ session: { id: 's1' } } as Req, {
 *   secret: 'shop-secret',
 *   sessionId: (request: Req) => request.session.id,
 * }, { mutation: signInMutation });
 */
export function csrfToken<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  // Shape inlined (not a named export) so the public signature needs no extra exported helper type
  // (rules/api-surface.md); structurally identical to the private `CsrfAudienceContext`.
  context: { audience?: string; mutation?: string | { readonly key: string } } = {},
): string {
  const binding = resolveCsrfBinding(request, options);
  if (!binding) throw new Error('csrfToken requires a session id or anonymous CSRF cookie');

  return createCsrfToken(binding.value, options.secret, resolveCsrfAudience(options, context));
}

/**
 * Render a hidden `<input>` carrying a CSRF token, ready to drop inside a form.
 * Forms emitted by the framework include this automatically; use it for
 * hand-written forms (SPEC §6.5/§6.6/§9.1).
 *
 * Pass the targeted `mutation` (its definition or key) so the token's audience binds to the
 * mutation's `key` — exactly what dispatch validates against. The framework-emitted
 * `<form mutation={…}>` path binds this automatically via `renderMutationCsrfField`; hand-rolled
 * forms must name the mutation here or the submit silently 422s on an audience mismatch.
 *
 * @param request - The request to derive the session (or anonymous binding) from.
 * @param options - CSRF options plus the targeted `mutation`/`audience` and an optional `field`
 *   name (defaults to `kovo-csrf`).
 * @returns The hidden-input HTML string.
 */
export function csrfField<Request>(
  request: Request,
  // Shape inlined (not a named export) so the public signature needs no extra exported helper type
  // (rules/api-surface.md); structurally identical to `CsrfOptions & CsrfAudienceContext & field`.
  options: CsrfOptions<Request> & {
    audience?: string;
    field?: string;
    mutation?: string | { readonly key: string };
  },
): string {
  const context: CsrfAudienceContext = {};
  if (options.audience !== undefined) context.audience = options.audience;
  if (options.mutation !== undefined) context.mutation = options.mutation;
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(csrfToken(request, options, context))}">`;
}

/** @internal Render the framework-owned CSRF field for compiler-emitted mutation forms. */
export function renderMutationCsrfField<Request>(definition: {
  csrf?: CsrfValidationOptions<Request> | false;
  key: string;
}): string {
  if (definition.csrf === false) return '';
  const context = currentJsxFrameworkContext();
  const csrf = definition.csrf ?? context?.csrf;
  if (!context || !csrf) return '';
  const binding = resolveCsrfBinding(context.request as Request, csrf, { mintAnonymous: true });
  if (!binding) return '';
  if (binding.setCookie) context.onCsrfSetCookie?.(binding.setCookie);
  return csrfFieldForBinding(binding.value, csrf, csrfAudience(csrf, definition.key));
}

/**
 * The field name for the per-submit idempotency token emitted by no-JS mutation forms
 * (SPEC.md §10.3:1063/1065). Must match the field the server reads from form data.
 * @internal
 */
export const KOVO_IDEM_FIELD_NAME = 'Kovo-Idem';

/**
 * @internal Mint a fresh ≥128-bit cryptographically-random idempotency token for a
 * no-JS mutation form (SPEC.md §10.3:1063/1065 — "atomic reservation for **all**
 * mutation paths" including no-JS). Uses `crypto.randomUUID()` which provides 122
 * bits of cryptographic entropy.
 */
export function mintIdemToken(): string {
  return randomUUID();
}

/**
 * @internal Render a hidden `<input>` carrying a per-submit idempotency token for
 * no-JS mutation forms (SPEC.md §10.3:1063/1065). Each render mints a fresh token so
 * Back-resubmit and double-submit use different idems and the replay store can dedup
 * them correctly. Emitted alongside the CSRF field by compiler-lowered forms.
 */
export function renderMutationIdemField(): string {
  return `<input type="hidden" name="${escapeAttribute(KOVO_IDEM_FIELD_NAME)}" value="${escapeAttribute(mintIdemToken())}">`;
}

/**
 * The unsafe HTTP verbs (state-changing) that the CSRF floor applies to (SPEC §6.6/§9.1). Safe verbs
 * (GET/HEAD/OPTIONS/TRACE) are not gated by the header floor.
 */
function isUnsafeVerb(method: string | undefined): boolean {
  if (method === undefined) return false;
  const upper = method.toUpperCase();
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE';
}

/**
 * Header-based CSRF floor (SPEC §6.6/§9.1): a fail-closed second floor that runs BEFORE the
 * synchronizer-token check on unsafe-verb requests, catching up to SvelteKit/Remix/Rails which all
 * ship an Origin/`Sec-Fetch-Site` floor in addition to a token.
 *
 * Decision (runtime defense-in-depth, sound at this sink):
 * - Unsafe real `Request` objects must carry a usable `Origin` header.
 * - Reject unless `Origin` equals the request's own origin OR is in the `trustedOrigins` allowlist.
 * - `Sec-Fetch-Site` is never an allow signal. Browsers can send `same-site`/`none` without a usable
 *   `Origin`, and SPEC §6.6/§9.1 requires the Origin floor to stay default-on for real unsafe paths.
 *
 * Only a real `Request` carrying an unsafe verb is gated; plain-object request shapes (used by the
 * direct `runMutation` API) have no method/headers, so they fall through to the token check.
 *
 * @returns `true` when the request passes (or the floor does not apply), `false` to reject.
 */
export function verifyCsrfRequestOriginFloor<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'trustedOrigins'>,
): boolean {
  if (!(request instanceof globalThis.Request)) return true;
  if (!isUnsafeVerb(request.method)) return true;

  const origin = request.headers.get('origin');

  if (origin === null || origin === '' || origin === 'null') return false;

  let requestOrigin: string | undefined;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    requestOrigin = undefined;
  }
  if (origin === requestOrigin) return true;
  if (options.trustedOrigins?.includes(origin)) return true;
  return false;
}

export function validateCsrfToken<Request>(
  rawInput: unknown,
  request: Request,
  options: CsrfValidationOptions<Request>,
  context: { audience?: string } = {},
): boolean {
  // SPEC §6.6/§9.1: run the fail-closed header floor BEFORE the synchronizer-token check so an
  // unsafe-verb cross-site request is rejected even if it somehow carries a valid token. Uniform
  // across mutations + endpoints + the /_q/ channel because every path routes through here.
  if (!verifyCsrfRequestOriginFloor(request, options)) return false;

  const binding = resolveCsrfBinding(request, options);
  if (!binding) return false;

  const submitted = formLikeToRecord(rawInput)[options.field ?? 'kovo-csrf'];
  if (typeof submitted !== 'string') return false;

  const submittedMac = unmaskCsrfToken(submitted);
  if (!submittedMac) return false;

  return (
    signingKeyRingFromCsrfSecret(options.secret).verify({
      audience: csrfAudience(options, context.audience),
      payload: binding.value,
      purpose: csrfPurpose(binding.value),
      signature: submittedMac,
    }).ok === true
  );
}

export function mutationCsrfOptions<Request>(
  definition: { csrf?: CsrfValidationOptions<Request> | false | undefined },
  defaultOptions?: CsrfValidationOptions<Request>,
): CsrfValidationOptions<Request> | false | undefined {
  if (definition.csrf === false) return false;
  return definition.csrf ?? defaultOptions;
}

interface CsrfBinding {
  setCookie?: string;
  value: string;
}

const DEFAULT_ANONYMOUS_CSRF_COOKIE = 'kovo_csrf';

function csrfFieldForBinding<Request>(
  binding: string,
  options: CsrfOptions<Request> & { field?: string },
  audience: string,
): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(createCsrfToken(binding, options.secret, audience))}">`;
}

/**
 * Build the `serializeCookie` options for the framework's anonymous CSRF cookie (SPEC §6.6/§9.1).
 *
 * The cookie is a credential-bearing binding, so it declares `class: 'session'`. That makes the
 * HttpOnly + Secure(prod) + SameSite floor default-on at the single `serializeCookie` sink — a
 * runtime defense-in-depth floor that is sound at that sink but bypassable by a same-process raw
 * `Set-Cookie`. The floor itself forces HttpOnly, so no per-call `httpOnly: true` is needed.
 *
 * Secure is resolved so localhost-http dev keeps working without tripping the credential floor's
 * KV432 downgrade guard:
 * - When the caller explicitly set `secure`, it is forwarded as `productionSecure` (the documented
 *   override that force-sets or force-suppresses the gate without being treated as a downgrade).
 * - Otherwise, when the request arrived over HTTPS, `secure: true` opts in even outside production
 *   (dev-over-TLS). On plain http we pass NOTHING and let the floor's env-derived gate decide, so
 *   production always gets `Secure` (even behind a proxy that reports an http request URL) while
 *   dev-http simply omits it. We never pass `secure: false`, which the prod floor would reject.
 */
function buildAnonymousCsrfCookieOptions(
  request: unknown,
  cookieOptions: CsrfAnonymousCookieOptions,
): CookieOptions {
  const options: CookieOptions = {
    class: 'session',
    maxAge: cookieOptions.maxAge ?? 24 * 60 * 60,
    path: cookieOptions.path ?? '/',
    sameSite: cookieOptions.sameSite ?? 'lax',
  };
  if (cookieOptions.secure !== undefined) {
    options.productionSecure = cookieOptions.secure;
  } else if (requestIsHttps(request)) {
    options.secure = true;
  }
  return options;
}

function resolveCsrfBinding<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  mintOptions: { mintAnonymous?: boolean } = {},
): CsrfBinding | undefined {
  const sessionId = options.sessionId(request);
  if (sessionId) return { value: sessionId };
  if (options.anonymousCookie === false) return undefined;

  const cookieOptions = options.anonymousCookie ?? {};
  const name = cookieOptions.name ?? DEFAULT_ANONYMOUS_CSRF_COOKIE;
  // The cookie is set with the `session`-class floor, which prepends a `__Host-`/`__Secure-`
  // browser-prefix when `Secure` is in effect (SPEC §9.1.1). Read the prefixed names first so the
  // binding round-trips, falling back to the bare name for the dev/no-Secure case and for cookies
  // minted before the floor existed.
  const existing = readAnonymousCsrfCookie(request, name);
  if (isUsableAnonymousCsrfSecret(existing)) return { value: `anonymous:${existing}` };
  if (!mintOptions.mintAnonymous) return undefined;

  const anonymousSecret = randomBytes(32).toString('base64url');
  return {
    setCookie: serializeCookie(
      name,
      anonymousSecret,
      buildAnonymousCsrfCookieOptions(request, cookieOptions),
    ),
    value: `anonymous:${anonymousSecret}`,
  };
}

/**
 * Read the anonymous CSRF cookie value, tolerating the `__Host-`/`__Secure-` name prefix that the
 * `session`-class floor adds when `Secure` is in effect (SPEC §6.6/§9.1.1). The binding value is the
 * same regardless of prefix, so any prefixed variant is accepted under the one logical name.
 */
function readAnonymousCsrfCookie(request: unknown, name: string): string | undefined {
  for (const candidate of [`__Host-${name}`, `__Secure-${name}`, name]) {
    const value = readCookieValue(request, candidate);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readCookieValue(request: unknown, name: string): string | undefined {
  if (!(request instanceof Request)) return undefined;
  const header = request.headers.get('cookie');
  if (!header) return undefined;

  for (const cookie of header.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName !== name) continue;
    const value = rawValue.join('=');
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

function isUsableAnonymousCsrfSecret(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{32,}$/.test(value);
}

function requestIsHttps(request: unknown): boolean {
  return request instanceof Request && new URL(request.url).protocol === 'https:';
}

const CSRF_MASKED_TOKEN_VERSION = 'v1';
const CSRF_MAC_BYTES = 32;

function createCsrfToken(binding: string, secret: CsrfSecret, audience: string): string {
  const mac = Buffer.from(
    signingKeyRingFromCsrfSecret(secret).sign({
      audience,
      payload: binding,
      purpose: csrfPurpose(binding),
    }).signature,
    'base64url',
  );
  const mask = randomBytes(CSRF_MAC_BYTES);
  const maskedMac = xorBuffers(mac, mask);
  return [
    CSRF_MASKED_TOKEN_VERSION,
    mask.toString('base64url'),
    maskedMac.toString('base64url'),
  ].join('.');
}

function unmaskCsrfToken(token: string): string | undefined {
  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== CSRF_MASKED_TOKEN_VERSION ||
    !isBase64UrlSegment(parts[1]) ||
    !isBase64UrlSegment(parts[2])
  ) {
    return undefined;
  }

  let mask: Buffer;
  let maskedMac: Buffer;
  try {
    mask = Buffer.from(parts[1], 'base64url');
    maskedMac = Buffer.from(parts[2], 'base64url');
  } catch {
    return undefined;
  }

  if (mask.byteLength !== CSRF_MAC_BYTES || maskedMac.byteLength !== CSRF_MAC_BYTES) {
    return undefined;
  }

  return xorBuffers(maskedMac, mask).toString('base64url');
}

function isBase64UrlSegment(value: string | undefined): value is string {
  return value !== undefined && value !== '' && /^[A-Za-z0-9_-]+$/.test(value);
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const output = Buffer.allocUnsafe(left.byteLength);
  for (let index = 0; index < left.byteLength; index += 1) {
    output[index] = left[index]! ^ right[index]!;
  }
  return output;
}

/** @internal Return the active CSRF/framework signing key for new tokens and non-CSRF attestations. */
export function currentCsrfSecret(secret: CsrfSecret): string {
  if (typeof secret === 'string') return secret;
  if (secret instanceof Uint8Array) return Buffer.from(secret).toString('base64url');
  if (isSigningKeyRing(secret)) {
    throw new Error('currentCsrfSecret cannot expose raw material from a SigningKeyRing');
  }
  if ('keys' in secret) {
    const current = secret.keys.find((key) => key.state === 'active');
    if (current === undefined) throw new Error('csrf secret keyring requires an active key');
    return typeof current.secret === 'string'
      ? current.secret
      : Buffer.from(current.secret).toString('base64url');
  }
  return secret.current;
}

export function signingKeyRingFromCsrfSecret(secret: CsrfSecret) {
  if (typeof secret === 'object' && !(secret instanceof Uint8Array) && 'current' in secret) {
    const keys = [
      { id: 'current', secret: secret.current, state: 'active' as const },
      ...(secret.previous === undefined
        ? []
        : [{ id: 'previous', secret: secret.previous, state: 'previous' as const }]),
    ];
    return signingKeyRingFromSecret({ keys });
  }
  return signingKeyRingFromSecret(secret as SigningSecret);
}

function csrfPurpose(binding: string): string {
  return binding.startsWith('anonymous:') ? 'anonymous-csrf' : 'csrf';
}

function csrfAudience(options: { field?: string }, audience?: string): string {
  return audience ?? `field:${options.field ?? 'kovo-csrf'}`;
}

/**
 * Resolve the CSRF signing audience for a hand-authored token/field (SPEC §6.5/§6.6/§9.1).
 *
 * When the caller names the targeted `mutation`, bind the audience to `definition.key` — the exact
 * value `runMutation`/`renderMutationResponse`/the no-JS path validate against (mutation dispatch
 * checks `{ audience: definition.key }`). This is the audit-trap fix: a hand-rolled
 * login/signup/logout/reset form can no longer mint a `field:<name>`-audience token that the
 * mutation sink then rejects with a bare 422. If an explicit `audience` is *also* supplied it must
 * equal the mutation's key — a contradictory pair is a configuration error, surfaced loudly rather
 * than silently minting a token for the wrong sink. Absent a mutation, fall back to the legacy
 * `field:<name>` audience for advanced non-mutation sinks.
 */
function resolveCsrfAudience(options: { field?: string }, context: CsrfAudienceContext): string {
  if (context.mutation !== undefined) {
    const bound = typeof context.mutation === 'string' ? context.mutation : context.mutation.key;
    if (context.audience !== undefined && context.audience !== bound) {
      throw new Error(
        `csrf audience "${context.audience}" does not match targeted mutation key "${bound}"`,
      );
    }
    return bound;
  }
  return csrfAudience(options, context.audience);
}
