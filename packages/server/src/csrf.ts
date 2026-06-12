import { createHmac, timingSafeEqual } from 'node:crypto';

import { escapeAttribute } from './html.js';
import { formLikeToRecord } from './schema.js';

export interface CsrfOptions<Request> {
  secret: string;
  sessionId: (request: Request) => string | undefined;
}

export interface CsrfValidationOptions<Request> extends CsrfOptions<Request> {
  field?: string;
}

export function csrfToken<Request>(request: Request, options: CsrfOptions<Request>): string {
  const sessionId = options.sessionId(request);
  if (!sessionId) throw new Error('csrfToken requires a session id');

  return createCsrfToken(sessionId, options.secret);
}

export function csrfField<Request>(
  request: Request,
  options: CsrfOptions<Request> & { field?: string },
): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'fw-csrf')}" value="${escapeAttribute(csrfToken(request, options))}">`;
}

export function validateCsrfToken<Request>(
  rawInput: unknown,
  request: Request,
  options: CsrfValidationOptions<Request>,
): boolean {
  const sessionId = options.sessionId(request);
  if (!sessionId) return false;

  const submitted = formLikeToRecord(rawInput)[options.field ?? 'fw-csrf'];
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
