import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

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

export function validateCsrfToken<Request>(
  rawInput: unknown,
  request: Request,
  options: CsrfValidationOptions<Request>,
): boolean {
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

function csrfFieldForBinding<Request>(binding: string, options: CsrfOptions<Request> & { field?: string }): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(createCsrfToken(binding, options.secret))}">`;
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
  const existing = readCookieValue(request, name);
  if (isUsableAnonymousCsrfSecret(existing)) return { value: `anonymous:${existing}` };
  if (!mintOptions.mintAnonymous) return undefined;

  const anonymousSecret = randomBytes(32).toString('base64url');
  return {
    setCookie: serializeCookie(name, anonymousSecret, {
      httpOnly: true,
      maxAge: cookieOptions.maxAge ?? 24 * 60 * 60,
      path: cookieOptions.path ?? '/',
      sameSite: cookieOptions.sameSite ?? 'lax',
      secure: cookieOptions.secure ?? requestIsHttps(request),
    }),
    value: `anonymous:${anonymousSecret}`,
  };
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
