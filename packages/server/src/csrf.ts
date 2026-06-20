import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { escapeAttribute } from './html.js';
import { currentJsxFrameworkContext } from './jsx-context.js';
import { formLikeToRecord } from './schema.js';

/** CSRF config: a `secret` and a `sessionId` extractor that binds the token to a session. */
export interface CsrfOptions<Request> {
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
  const sessionId = options.sessionId(request);
  if (!sessionId) throw new Error('csrfToken requires a session id');

  return createCsrfToken(sessionId, options.secret);
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
  if (!csrf.sessionId(context.request as Request)) return '';
  return csrfField(context.request as Request, csrf);
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
  const sessionId = options.sessionId(request);
  if (!sessionId) return false;

  const submitted = formLikeToRecord(rawInput)[options.field ?? 'kovo-csrf'];
  if (typeof submitted !== 'string') return false;

  return secureEqual(submitted, createCsrfToken(sessionId, options.secret));
}

export function mutationCsrfOptions<Request>(
  definition: { csrf?: CsrfValidationOptions<Request> | false },
  defaultOptions?: CsrfValidationOptions<Request>,
): CsrfValidationOptions<Request> | false | undefined {
  if (definition.csrf === false) return false;
  return definition.csrf ?? defaultOptions;
}

function createCsrfToken(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}
