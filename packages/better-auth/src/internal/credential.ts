import type {
  AccessDecision,
  CsrfOptions,
  Domain,
  Guard,
  GuardDenial,
  MutationDefinition,
  MutationFail,
} from '@kovojs/server';
import type { MutationRegistry } from '@kovojs/server/internal/execution';

import type { BetterAuthRoleSession } from '../guards.js';
import type { BetterAuthCredentialMutationInternalOptions } from '../credential-options.js';
import type {
  BetterAuthCredentialMutationApi,
  BetterAuthCredentialMutationTouchGraphOptions,
  BetterAuthBindingRequest,
  BetterAuthResponseLike,
} from './contracts.js';
import {
  betterAuthArrayAppend,
  betterAuthArrayIsArray,
  betterAuthApply,
  betterAuthCharacterCodeAt,
  betterAuthDateNow,
  betterAuthDateParse,
  betterAuthDeepFreeze,
  betterAuthFreezeOwn,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthIndexOf,
  betterAuthIsNaN,
  betterAuthOwnDataOption,
  betterAuthPinOwnData,
  betterAuthRegExpExec,
  betterAuthResponseHeaders,
  betterAuthResponseJson,
  betterAuthResponseStatus,
  betterAuthSlice,
  betterAuthSplit,
  betterAuthSnapshotDenseArray,
  betterAuthToLowerCase,
  betterAuthTrim,
} from './intrinsics.js';
import { isBetterAuthCredentialGateFailure } from './credential-runtime-gate.js';
import { getBetterAuthRetryAfter, getBetterAuthSetCookie } from './trusted-plaintext.js';

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

/** @internal Framework wire outcome for a Better Auth router rate-limit response. */
export type BetterAuthCredentialRateLimitFailure = MutationFail<
  'RATE_LIMITED',
  Record<string, never>
>;

/**
 * @internal Preserve Better Auth's routed 429 and retry delay through Kovo's mutation wire.
 */
export function betterAuthCredentialRateLimitFailure(
  response: BetterAuthResponseLike,
): BetterAuthCredentialRateLimitFailure | undefined {
  if (betterAuthResponseStatus(response) !== 429) return undefined;
  const headers = betterAuthResponseHeaders(response);
  const retryAfter = getBetterAuthRetryAfter(headers);
  return {
    error: { code: 'RATE_LIMITED', payload: {} },
    ok: false,
    ...(retryAfter === undefined ? {} : { retryAfter }),
    status: 429,
  };
}

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
    const body = await (readJson as PromiseLike<unknown>);
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
  if (isBetterAuthCredentialGateFailure(error)) return true;
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
    // SPEC §6.5/§10.3: session, user, and organization are authorization evidence. Do not
    // invoke accessors or inherit prototype state at this last adapter-owned guard boundary.
    // Pin the exact validated carrier before the type refinement lets downstream code use it:
    // a caller Proxy must not show the guard one organization and the handler another (C9).
    const session = readOwnDataValue(request, 'session');
    if (session === null || typeof session !== 'object') return unauthenticatedGuardFailure();
    try {
      betterAuthDeepFreeze(session, 'Better Auth active-organization session authority');
      betterAuthPinOwnData(
        request,
        'session',
        session,
        'Better Auth active-organization request session',
      );
    } catch {
      return unauthorizedGuardFailure();
    }
    const user = readOwnDataValue(session, 'user');
    if (user === null || typeof user !== 'object') return unauthenticatedGuardFailure();
    const activeOrganizationId = readOwnDataValue(session, 'activeOrganizationId');

    return typeof activeOrganizationId === 'string' && activeOrganizationId !== ''
      ? true
      : unauthorizedGuardFailure();
  };
}

function readOwnDataValue(value: object, property: PropertyKey): unknown {
  const descriptor = betterAuthGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
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
  Request extends BetterAuthBindingRequest,
  GuardedRequest extends Request,
>(
  options: BetterAuthCredentialMutationInternalOptions<Key, Request, GuardedRequest>,
  contract: {
    defaultAccess?: AccessDecision;
    touches: readonly Domain[];
  },
): Pick<
  MutationDefinition<Key, never, never, Request, never, GuardedRequest>,
  'access' | 'guard' | 'registry' | 'transaction'
> & {
  csrf?: CsrfOptions<Request>;
} {
  // SPEC §6.6: anonymous CSRF is mandatory for pre-authentication forms. Keep a runtime
  // fail-closed check in addition to the public type so JavaScript callers and forged/cast values
  // cannot turn a credential mutation into a login-CSRF or logout-CSRF endpoint.
  const csrf = betterAuthOwnDataOption<CsrfOptions<Request> | false>(
    options,
    'csrf',
    'Better Auth credential option csrf',
  );
  if (csrf === false) {
    throw new TypeError(
      'Better Auth credential mutations cannot disable CSRF. SPEC §6.6 requires CSRF protection for sign-in, sign-up, and sign-out forms.',
    );
  }

  const configuredAccess = betterAuthOwnDataOption<AccessDecision>(
    options,
    'access',
    'Better Auth credential option access',
  );
  const guard = betterAuthOwnDataOption<Guard<Request, GuardedRequest>>(
    options,
    'guard',
    'Better Auth credential option guard',
  );
  const configuredTransaction = betterAuthOwnDataOption<
    <Result>(
      request: Request,
      run: (transactionRequest: GuardedRequest) => Promise<Result>,
    ) => Promise<Result>
  >(options, 'transaction', 'Better Auth credential option transaction');
  const registry = betterAuthOwnDataOption<
    MutationDefinition<Key, never, never, Request, never, GuardedRequest>['registry']
  >(options, 'registry', 'Better Auth credential option registry');
  const access =
    configuredAccess !== undefined
      ? configuredAccess
      : guard === undefined
        ? contract.defaultAccess
        : undefined;
  const transaction = async <Result>(
    request: Request,
    run: (transactionRequest: GuardedRequest) => Promise<Result>,
  ): Promise<Result> => {
    // SPEC §6.6/§10.2: a framework continuation adapter must own and await exactly one
    // continuation invocation. Returning the lazy `run(...)` promise directly lets the server
    // cardinality gate observe an adapter that never awaited completion. Keep both the configured
    // option function and its receiver captured here, invoke through the boot-pinned Reflect.apply
    // control, and await before this adapter completes.
    const pending = configuredTransaction
      ? betterAuthApply<Promise<Result>>(configuredTransaction, options, [request, run])
      : betterAuthApply<Promise<Result>>(run, undefined, [request as unknown as GuardedRequest]);
    return await pending;
  };

  return {
    // SPEC.md §10.2: a credential mutation with no `guard` (sign-in/sign-up run
    // before authentication) declares its KV436 access decision via `access:`.
    ...(access === undefined ? {} : { access }),
    ...(csrf === undefined ? {} : { csrf }),
    ...(guard === undefined ? {} : { guard }),
    registry: credentialMutationRegistry(registry, contract.touches),
    // Better Auth credential APIs use the Better Auth Drizzle adapter internally; wrapping that
    // call in Kovo's default app-db transaction nests the same in-process PGlite connection.
    transaction,
  };
}

function credentialMutationRegistry(
  registry: MutationRegistry | undefined,
  defaultTouches: readonly Domain[],
): MutationRegistry {
  if (
    registry !== undefined &&
    (typeof registry !== 'object' || registry === null || betterAuthArrayIsArray(registry))
  ) {
    throw new TypeError('Better Auth credential registry must be an object.');
  }

  const inferredTouches = snapshotCredentialRegistryArray<
    NonNullable<MutationRegistry['inferredTouches']>[number]
  >(registry, 'inferredTouches', 'Better Auth credential registry inferredTouches');
  const queries = snapshotCredentialRegistryArray<NonNullable<MutationRegistry['queries']>[number]>(
    registry,
    'queries',
    'Better Auth credential registry queries',
  );
  const tables = snapshotCredentialRegistryArray<string>(
    registry,
    'tables',
    'Better Auth credential registry tables',
  );
  if (tables !== undefined) {
    for (let index = 0; index < tables.length; index += 1) {
      if (typeof tables[index] !== 'string') {
        throw new TypeError('Better Auth credential registry tables must contain strings.');
      }
    }
  }
  const overrideTouches = snapshotCredentialRegistryArray<Domain>(
    registry,
    'touches',
    'Better Auth credential registry touches',
  );

  return betterAuthFreezeOwn(
    {
      ...(inferredTouches === undefined ? {} : { inferredTouches }),
      ...(queries === undefined ? {} : { queries }),
      ...(tables === undefined ? {} : { tables }),
      touches: mergeDomainTouches(defaultTouches, overrideTouches),
    },
    'Better Auth credential registry',
  );
}

function snapshotCredentialRegistryArray<Value>(
  registry: object | undefined,
  property: PropertyKey,
  label: string,
): readonly Value[] | undefined {
  if (registry === undefined) return undefined;
  const value = betterAuthOwnDataOption<readonly Value[]>(registry, property, label);
  return value === undefined
    ? undefined
    : betterAuthFreezeOwn(betterAuthSnapshotDenseArray(value, label), label);
}

function mergeDomainTouches(
  defaults: readonly Domain[],
  overrides: readonly Domain[] | undefined,
): Domain[] {
  const merged: Domain[] = [];
  const defaultSnapshot = betterAuthSnapshotDenseArray(
    defaults,
    'Better Auth credential default domain touches',
  );
  for (let index = 0; index < defaultSnapshot.length; index += 1) {
    betterAuthArrayAppend(
      merged,
      snapshotCredentialDomain(defaultSnapshot[index], index),
      'Better Auth credential domain touches',
    );
  }
  const additions =
    overrides === undefined
      ? []
      : betterAuthSnapshotDenseArray(overrides, 'Better Auth credential override domain touches');
  for (let index = 0; index < additions.length; index += 1) {
    const item = snapshotCredentialDomain(additions[index], defaultSnapshot.length + index);
    let existing = -1;
    for (let candidate = 0; candidate < merged.length; candidate += 1) {
      if (merged[candidate]!.key === item.key) {
        existing = candidate;
        break;
      }
    }
    if (existing < 0) {
      betterAuthArrayAppend(merged, item, 'Better Auth credential domain touches');
    }
  }
  return betterAuthFreezeOwn(merged, 'Better Auth credential domain touches');
}

function snapshotCredentialDomain(value: unknown, index: number): Domain {
  if (typeof value !== 'object' || value === null || betterAuthArrayIsArray(value)) {
    throw new TypeError(`Better Auth credential domain touch ${index} must be an object.`);
  }
  const key = betterAuthOwnDataOption<string>(
    value,
    'key',
    `Better Auth credential domain touch ${index}.key`,
  );
  if (typeof key !== 'string' || key === '') {
    throw new TypeError(`Better Auth credential domain touch ${index}.key must be non-empty text.`);
  }
  return betterAuthDeepFreeze({ key }, `Better Auth credential domain touch ${index}`);
}

export function isBetterAuthCredentialMutationTouchGraphOptions(
  value:
    | BetterAuthCredentialMutationTouchGraphOptions
    | Partial<Record<BetterAuthCredentialMutationApi, string>>,
): value is BetterAuthCredentialMutationTouchGraphOptions {
  return (
    betterAuthGetOwnPropertyDescriptor(value, 'apis') !== undefined ||
    betterAuthGetOwnPropertyDescriptor(value, 'credentialMutationTableTouches') !== undefined ||
    betterAuthGetOwnPropertyDescriptor(value, 'keys') !== undefined ||
    betterAuthGetOwnPropertyDescriptor(value, 'schemaBridge') !== undefined
  );
}
