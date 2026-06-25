import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { CookieOptions } from './cookies.js';
import { serializeCookie } from './cookies.js';
import { escapeAttribute } from './html.js';
import { currentJsxFrameworkContext } from './jsx-context.js';
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

/** CSRF config: a `secret`, a session extractor, and optional anonymous form binding. */
export interface CsrfOptions<Request> {
  /** Configure or disable the anonymous CSRF cookie used when `sessionId` returns undefined. */
  anonymousCookie?: CsrfAnonymousCookieOptions | false;
  secret: string;
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
export interface CsrfValidationOptions<Request> extends CsrfOptions<Request> {
  field?: string;
}

/**
 * Mint a session-bound CSRF synchronizer token for a request (SPEC §6.6).
 *
 * @param request - The request to derive the session from.
 * @param options - The CSRF `secret` and `sessionId` extractor.
 * @returns The CSRF token string.
 * @example
 * import { csrfToken } from '@kovojs/server';
 *
 * interface Req { session: { id: string } }
 * const token: string = csrfToken({ session: { id: 's1' } } as Req, {
 *   secret: 'shop-secret',
 *   sessionId: (request: Req) => request.session.id,
 * });
 */
export function csrfToken<Request>(request: Request, options: CsrfOptions<Request>): string {
  const binding = resolveCsrfBinding(request, options);
  if (!binding) throw new Error('csrfToken requires a session id or anonymous CSRF cookie');

  return createCsrfToken(binding.value, options.secret);
}

/**
 * Render a hidden `<input>` carrying a CSRF token, ready to drop inside a form.
 * Forms emitted by the framework include this automatically; use it for
 * hand-written forms (SPEC §6.6).
 *
 * @param request - The request to derive the session from.
 * @param options - CSRF options plus an optional `field` name (defaults to `kovo-csrf`).
 * @returns The hidden-input HTML string.
 */
export function csrfField<Request>(
  request: Request,
  options: CsrfOptions<Request> & { field?: string },
): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(csrfToken(request, options))}">`;
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
  return csrfFieldForBinding(binding.value, csrf);
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
 * - Reject when `Sec-Fetch-Site: cross-site` (the browser asserts the request crossed a site boundary
 *   to a non-trusted target). `same-origin`/`same-site`/`none` are allowed by this header.
 * - When an `Origin` header is present, reject unless it equals the request's own origin OR is in the
 *   `trustedOrigins` allowlist.
 * - COMPAT FALLBACK: when BOTH `Sec-Fetch-Site` and `Origin` are absent (old clients, non-browser
 *   callers, server-to-server), do NOT reject on this floor — fall through to the token check so we do
 *   not break those clients.
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

  const secFetchSite = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');

  // COMPAT FALLBACK: neither header present → defer to the token check.
  if (secFetchSite === null && (origin === null || origin === '' || origin === 'null')) {
    return true;
  }

  // Sec-Fetch-Site: only `cross-site` is a hard reject. `same-origin`/`same-site`/`none` are allowed.
  if (secFetchSite === 'cross-site') return false;

  // Origin allowlist check (when the browser sent a usable Origin).
  if (origin !== null && origin !== '' && origin !== 'null') {
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

  // Sec-Fetch-Site present and not cross-site, with no Origin to contradict it → allow.
  return true;
}

export function validateCsrfToken<Request>(
  rawInput: unknown,
  request: Request,
  options: CsrfValidationOptions<Request>,
): boolean {
  // SPEC §6.6/§9.1: run the fail-closed header floor BEFORE the synchronizer-token check so an
  // unsafe-verb cross-site request is rejected even if it somehow carries a valid token. Uniform
  // across mutations + endpoints + the /_q/ channel because every path routes through here.
  if (!verifyCsrfRequestOriginFloor(request, options)) return false;

  const binding = resolveCsrfBinding(request, options);
  if (!binding) return false;

  const submitted = formLikeToRecord(rawInput)[options.field ?? 'kovo-csrf'];
  if (typeof submitted !== 'string') return false;

  return secureEqual(submitted, createCsrfToken(binding.value, options.secret));
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
): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(createCsrfToken(binding, options.secret))}">`;
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

function createCsrfToken(binding: string, secret: string): string {
  return createHmac('sha256', secret).update(binding).digest('base64url');
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}
