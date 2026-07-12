import type {
  AccessDecision,
  CsrfOptions,
  Domain,
  Guard,
  GuardDenial,
  MutationDefinition,
  MutationFail,
} from '@kovojs/server';

import type { BetterAuthRoleSession } from '../guards.js';
import type { BetterAuthCredentialMutationInternalOptions } from '../credential-options.js';
import type {
  BetterAuthCredentialMutationApi,
  BetterAuthCredentialMutationTouchGraphOptions,
  BetterAuthRequestLike,
  BetterAuthResponseLike,
} from './contracts.js';
import {
  betterAuthArrayAppend,
  betterAuthApply,
  betterAuthCharacterCodeAt,
  betterAuthDateNow,
  betterAuthDateParse,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthIndexOf,
  betterAuthIsNaN,
  betterAuthRegExpExec,
  betterAuthResponseHeaders,
  betterAuthResponseJson,
  betterAuthResponseStatus,
  betterAuthSlice,
  betterAuthSplit,
  betterAuthToLowerCase,
  betterAuthTrim,
} from './intrinsics.js';
import { getBetterAuthSetCookie } from './trusted-plaintext.js';

export { getBetterAuthSetCookie } from './trusted-plaintext.js';

/** Success value returned by Better Auth credential mutations. */
export interface BetterAuthCredentialMutationValue<Status extends string> {
  redirectTo: string;
  status: Status;
}

/** @internal Typed shape of the `INVALID_CREDENTIALS` failure the credential mutations can return. */
export type BetterAuthCredentialFailure = MutationFail<
  'INVALID_CREDENTIALS',
  Record<string, never>
>;

interface BetterAuthForwardSetCookiePosture {
  class: 'session';
  source: 'better-auth-credential';
}

/** @internal Forward Better Auth `Set-Cookie` headers into the mutation response channel. */
// SPEC.md §9.1 and archived D5 auth plan B4: credential mutations can only forward auth cookies
// through the current mutation response-header channel.
export function forwardBetterAuthSetCookie(headers: Headers, context: unknown): void {
  const forward = readBetterAuthForwardSetCookie(context);
  if (!forward) return;

  const cookies = getBetterAuthSetCookie(headers);
  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index]!;
    // P1.5 / SPEC.md §9.1.1: Better Auth owns the cookie name it later reads. The server
    // internal forwarding sink preserves that name and every upstream attribute while applying
    // Kovo's credential-cookie floor.
    forward(cookie, { class: 'session', source: 'better-auth-credential' });
  }
}

function readBetterAuthForwardSetCookie(
  context: unknown,
): ((rawSetCookie: string, posture: BetterAuthForwardSetCookiePosture) => void) | undefined {
  if (typeof context !== 'object' || context === null) return undefined;
  const candidate = betterAuthGetOwnPropertyDescriptor(context, 'forwardSetCookie');
  return candidate !== undefined && 'value' in candidate && typeof candidate.value === 'function'
    ? (candidate.value as (
        rawSetCookie: string,
        posture: BetterAuthForwardSetCookiePosture,
      ) => void)
    : undefined;
}

/** @internal Emit browser-side storage clearing for framework-owned session revocation. */
// OPP-15 runtime-DiD: Kovo owns the Better Auth sign-out mutation response, so its successful
// revoke path carries Clear-Site-Data alongside the session-clearing cookies.
export function setSessionRevocationClearSiteData(context: unknown): void {
  if (typeof context !== 'object' || context === null) return;
  const candidate = betterAuthGetOwnPropertyDescriptor(
    context,
    'setSessionRevocationClearSiteData',
  );
  if (candidate !== undefined && 'value' in candidate && typeof candidate.value === 'function') {
    betterAuthApply(candidate.value, context, []);
  }
}

/** @internal True when a Better Auth response status (400/401/403) signals a credential failure. */
export function isBetterAuthCredentialFailureResponse(response: BetterAuthResponseLike): boolean {
  const status = betterAuthResponseStatus(response);
  return status === undefined ? false : isCredentialFailureStatus(status);
}

// SECURITY (SECURITY_FINDINGS.md M2): a credential sign-in/sign-up must be classified
// by POSITIVE evidence of an established session, never by the mere absence of a
// 400/401/403. Better Auth returns Response objects for 2FA-pending (`200` with a
// `twoFactorRedirect` body and no session cookie), rate-limit (`429`), and transient
// 5xx; none of those establish a session and must be treated as failures.
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

// A Set-Cookie that establishes a session sets a non-empty value and is not a
// deletion (`Max-Age=0` / `Expires` in the past / empty value). Sign-out clears
// cookies this way, so the same predicate cleanly distinguishes establish vs. clear.
function isSessionEstablishingSetCookie(rawSetCookie: string): boolean {
  const firstPair = betterAuthSplit(rawSetCookie, ';', 1)[0] ?? '';
  const separatorIndex = betterAuthIndexOf(firstPair, '=');
  if (separatorIndex < 0) return false;

  const value = betterAuthTrim(betterAuthSlice(firstPair, separatorIndex + 1));
  if (value === '') return false;

  const attributes = betterAuthToLowerCase(betterAuthSlice(rawSetCookie, firstPair.length));
  if (betterAuthRegExpExec(/(?:^|;)\s*max-age\s*=\s*0(?:\s*;|\s*$)/u, attributes)) {
    return false;
  }
  if (betterAuthRegExpExec(/(?:^|;)\s*max-age\s*=\s*-/u, attributes)) return false;

  // part-3 I3 (SECURITY_FINDINGS.md M2): the docstring lists "Expires in the past" as a
  // clearing cookie, but only Max-Age was checked. A `sid=deleted; Expires=Thu, 01 Jan
  // 1970 …` (non-empty value, no Max-Age) was mis-classified as session-establishing.
  // Parse Expires off the ORIGINAL-case raw string (Date.parse needs the real casing) and
  // treat a valid past/now date as a deletion.
  const expires = parseSetCookieExpires(rawSetCookie);
  if (expires !== undefined && expires <= betterAuthDateNow()) return false;

  return true;
}

// part-3 I3: extract a `Set-Cookie` `Expires` attribute as epoch ms, or undefined when the
// attribute is absent or unparseable. Operates on the raw (original-case) header so the
// HTTP-date is recoverable by `Date.parse`.
function parseSetCookieExpires(rawSetCookie: string): number | undefined {
  const segments = betterAuthSplit(rawSetCookie, ';');
  for (let index = 1; index < segments.length; index += 1) {
    const segment = betterAuthTrim(segments[index] ?? '');
    const separator = betterAuthIndexOf(segment, '=');
    if (separator === -1) continue;
    if (
      betterAuthToLowerCase(betterAuthTrim(betterAuthSlice(segment, 0, separator))) !== 'expires'
    ) {
      continue;
    }
    const parsed = betterAuthDateParse(betterAuthTrim(betterAuthSlice(segment, separator + 1)));
    return betterAuthIsNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function hasSessionEstablishingSetCookie(headers: Headers): boolean {
  const cookies = getBetterAuthSetCookie(headers);
  for (let index = 0; index < cookies.length; index += 1) {
    if (isSessionEstablishingSetCookie(cookies[index]!)) return true;
  }
  return false;
}

// Better Auth returns `200 { twoFactorRedirect: true, ... }` (no session cookie) when
// a second factor is required. The framework has no 2FA UI, so this is treated as a
// failure rather than redirecting into the protected area. The body is read from a
// clone so the original Response stays consumable for cookie forwarding; non-Response
// fakes (plain `{ headers, status }`) simply report "no two-factor body".
async function isBetterAuthTwoFactorPendingResponse(
  response: BetterAuthResponseLike,
): Promise<boolean> {
  const readJson = betterAuthResponseJson(response);
  if (readJson === undefined) return false;

  try {
    const body = await readJson;
    if (typeof body !== 'object' || body === null) return false;
    const descriptor = betterAuthGetOwnPropertyDescriptor(body, 'twoFactorRedirect');
    return descriptor !== undefined && 'value' in descriptor && descriptor.value === true;
  } catch {
    // A non-JSON or unreadable body cannot be a two-factor-pending payload.
    return false;
  }
}

/**
 * @internal Resolve a credential response to a success value only when the session was
 * positively established; otherwise return null so the caller emits the declared
 * failure. See SECURITY_FINDINGS.md M2.
 */
export async function resolveBetterAuthCredentialSuccess<Status extends string>(
  response: BetterAuthResponseLike,
  context: unknown,
  success: BetterAuthCredentialMutationValue<Status>,
): Promise<BetterAuthCredentialMutationValue<Status> | null> {
  const status = betterAuthResponseStatus(response);
  const headers = betterAuthResponseHeaders(response);
  if (status === undefined || headers === undefined || !isSuccessStatus(status)) return null;
  if (await isBetterAuthTwoFactorPendingResponse(response)) return null;
  if (!hasSessionEstablishingSetCookie(headers)) return null;

  forwardBetterAuthSetCookie(headers, context);

  return success;
}

/** @internal True when a thrown Better Auth error carries a 400/401/403 credential-failure status. */
export function isBetterAuthCredentialFailureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const status =
    readNumericProperty(error, 'status') ??
    readNumericProperty(error, 'statusCode') ??
    readNumericProperty(error, 'code');

  return status === undefined ? false : isCredentialFailureStatus(status);
}

/** @internal Session shape with an optional active organization id, read by `activeOrganization`. */
export interface BetterAuthOrganizationSession extends BetterAuthRoleSession {
  activeOrganizationId?: string | null;
}

/** @internal Request shape carrying an organization session for the `activeOrganization` guard. */
export interface BetterAuthOrganizationRequest {
  session?: BetterAuthOrganizationSession | null;
}

/** @internal Request narrowed by `activeOrganization` to guarantee a non-null active organization. */
export type ActiveOrganizationRequest<Request extends BetterAuthOrganizationRequest> = Request & {
  session: NonNullable<Request['session']> & {
    activeOrganizationId: string;
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

/** @internal Guard that requires an active organization on the session; narrows the request accordingly. */
export function activeOrganization<Request extends BetterAuthOrganizationRequest>(): Guard<
  Request,
  ActiveOrganizationRequest<Request>
> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.activeOrganizationId ? true : unauthorizedGuardFailure();
  };
}

/**
 * @internal SPEC.md §6.5 and §10.3: adapter guards preserve the unauthenticated (→ login
 * redirect) vs forbidden (→ 403 shell) intent the framework maps to HTTP.
 */
export function unauthenticatedGuardFailure(): GuardDenial {
  return {
    kind: 'unauthenticated',
    payload: {},
  };
}

/** @internal Forbidden (→ 403 shell) guard denial; pairs with `unauthenticatedGuardFailure`. */
export function unauthorizedGuardFailure(): GuardDenial {
  return {
    kind: 'forbidden',
    payload: {},
  };
}

function isCredentialFailureStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

function readNumericProperty(value: object, key: string): number | undefined {
  try {
    const descriptor = betterAuthGetOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'number'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

// SECURITY (SECURITY_FINDINGS.md H4): the same-origin redirect guard must reject
// authority-forming targets after backslash-normalization (browsers collapse `\`
// to `/` when resolving http(s) URLs, so `/\evil.com` resolves cross-origin) and
// reject ASCII control characters that can smuggle a CRLF / header-splitting
// payload into the emitted `Location` response header.
/** @internal Same-origin redirect-target guard for the credential mutations (SECURITY_FINDINGS.md H4). */
export function redirectPath(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string' || value === '') return fallback;
  for (let index = 0; index < value.length; index += 1) {
    const code = betterAuthCharacterCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return fallback;
  }
  if (betterAuthCharacterCodeAt(value, 0) !== 0x2f) return fallback;
  if (value.length > 1 && betterAuthCharacterCodeAt(value, 1) === 0x2f) return fallback;

  return value;
}

/** @internal Build the shared `access`/`csrf`/`guard`/`registry`/`transaction` options for the credential mutations. */
export function credentialMutationDefinitionOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
>(
  options: BetterAuthCredentialMutationInternalOptions<Key, Request, GuardedRequest>,
  contract: {
    defaultAccess?: AccessDecision;
    touches: readonly Domain[];
  },
): Pick<
  MutationDefinition<Key, never, never, Request, never, GuardedRequest>,
  'access' | 'csrf' | 'guard' | 'registry' | 'transaction'
> {
  // SPEC §6.6: anonymous CSRF is mandatory for pre-authentication forms. Keep a runtime
  // fail-closed check in addition to the public type so JavaScript callers and forged/cast values
  // cannot turn a credential mutation into a login-CSRF or logout-CSRF endpoint.
  const csrf = (options as { csrf?: CsrfOptions<Request> | false }).csrf;
  if (csrf === false) {
    throw new TypeError(
      'Better Auth credential mutations cannot disable CSRF. SPEC §6.6 requires CSRF protection for sign-in, sign-up, and sign-out forms.',
    );
  }

  const access =
    options.access !== undefined
      ? options.access
      : options.guard === undefined
        ? contract.defaultAccess
        : undefined;
  const transaction =
    options.transaction ??
    (<Result>(_request: Request, run: (transactionRequest: GuardedRequest) => Promise<Result>) =>
      run(_request as unknown as GuardedRequest));

  return {
    // SPEC.md §10.2: a credential mutation with no `guard` (sign-in/sign-up run
    // before authentication) declares its KV436 access decision via `access:`.
    ...(access === undefined ? {} : { access }),
    ...(csrf === undefined ? {} : { csrf }),
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    registry: {
      ...options.registry,
      touches: mergeDomainTouches(contract.touches, options.registry?.touches),
    },
    // Better Auth credential APIs use the Better Auth Drizzle adapter internally; wrapping that
    // call in Kovo's default app-db transaction nests the same in-process PGlite connection.
    transaction,
  };
}

function mergeDomainTouches(
  defaults: readonly Domain[],
  overrides: readonly Domain[] | undefined,
): Domain[] {
  const merged: Domain[] = [];
  for (let index = 0; index < defaults.length; index += 1) {
    betterAuthArrayAppend(merged, defaults[index]!, 'Better Auth credential domain touches');
  }
  const additions = overrides ?? [];
  for (let index = 0; index < additions.length; index += 1) {
    const item = additions[index]!;
    let existing = -1;
    for (let candidate = 0; candidate < merged.length; candidate += 1) {
      if (merged[candidate]!.key === item.key) {
        existing = candidate;
        break;
      }
    }
    if (existing < 0) {
      betterAuthArrayAppend(merged, item, 'Better Auth credential domain touches');
    } else merged[existing] = item;
  }
  return merged;
}

export function isBetterAuthCredentialMutationTouchGraphOptions(
  value:
    | BetterAuthCredentialMutationTouchGraphOptions
    | Partial<Record<BetterAuthCredentialMutationApi, string>>,
): value is BetterAuthCredentialMutationTouchGraphOptions {
  return (
    'apis' in value ||
    'credentialMutationTableTouches' in value ||
    'keys' in value ||
    'schemaBridge' in value
  );
}
