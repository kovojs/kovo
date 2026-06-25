import type {
  CookieOptions,
  Domain,
  Guard,
  GuardDenial,
  MutationDefinition,
  MutationFail,
} from '@kovojs/server';

import type { BetterAuthRoleSession } from '../guards.js';
import type { BetterAuthCredentialMutationOptions } from '../internal.js';
import type {
  BetterAuthCredentialMutationApi,
  BetterAuthCredentialMutationTouchGraphOptions,
  BetterAuthRequestLike,
  BetterAuthResponseLike,
} from './contracts.js';

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

/** @internal Forward Better Auth `Set-Cookie` headers into the mutation response channel. */
// SPEC.md §9.1 and archived D5 auth plan B4: credential mutations can only forward auth cookies
// through the current mutation response-header channel.
export function forwardBetterAuthSetCookie(
  headers: Headers,
  context: { setCookie?: (name: string, value: string, options?: CookieOptions) => void },
): void {
  // bug-and-testing-part2 B3: the public Set-Cookie channel is the typed builder only (no raw
  // free-string overload). Better Auth emits standard URL-encoded Set-Cookie strings, so parse each
  // into (name, value, attributes) and re-emit through the typed builder. The value is decoded once
  // (Better Auth URL-encodes it) so the typed builder re-encodes it to the identical wire bytes.
  const setCookie = context.setCookie;
  if (!setCookie) return;
  for (const cookie of getBetterAuthSetCookie(headers)) {
    const parsed = parseSetCookieHeader(cookie);
    if (parsed) setCookie(parsed.name, parsed.value, parsed.options);
  }
}

type SessionRevocationHeaderContext = {
  setSessionRevocationClearSiteData?: () => void;
};

/** @internal Emit browser-side storage clearing for framework-owned session revocation. */
// OPP-15 runtime-DiD: Kovo owns the Better Auth sign-out mutation response, so its successful
// revoke path carries Clear-Site-Data alongside the session-clearing cookies.
export function setSessionRevocationClearSiteData(context: unknown): void {
  (context as SessionRevocationHeaderContext).setSessionRevocationClearSiteData?.();
}

/** @internal Parse a standard `Set-Cookie` header string into a typed cookie-builder call. */
function parseSetCookieHeader(
  raw: string,
): { name: string; options: CookieOptions; value: string } | undefined {
  const segments = raw.split(';');
  const first = segments[0] ?? '';
  const separator = first.indexOf('=');
  if (separator <= 0) return undefined;
  const name = first.slice(0, separator).trim();
  if (!name) return undefined;
  const value = decodeCookieOctet(first.slice(separator + 1).trim());

  const options: CookieOptions = {};
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]?.trim();
    if (!segment) continue;
    const attrSeparator = segment.indexOf('=');
    const attr = (attrSeparator === -1 ? segment : segment.slice(0, attrSeparator))
      .trim()
      .toLowerCase();
    const attrValue = attrSeparator === -1 ? '' : segment.slice(attrSeparator + 1).trim();
    switch (attr) {
      case 'httponly':
        options.httpOnly = true;
        break;
      case 'secure':
        options.secure = true;
        break;
      case 'path':
        options.path = attrValue;
        break;
      case 'domain':
        options.domain = attrValue;
        break;
      case 'max-age': {
        const maxAge = Number(attrValue);
        if (!Number.isNaN(maxAge)) options.maxAge = maxAge;
        break;
      }
      case 'expires':
        options.expires = attrValue;
        break;
      case 'samesite': {
        const sameSite = attrValue.toLowerCase();
        if (sameSite === 'lax' || sameSite === 'none' || sameSite === 'strict') {
          options.sameSite = sameSite;
          if (sameSite === 'none') {
            options.unsafe = {
              downgrade: { sameSite: 'none' },
              justification:
                'Better Auth emitted SameSite=None for a third-party or partitioned credential cookie.',
            };
          }
        }
        break;
      }
      // part-3 I1 (SPEC §9.1.1:856): `Partitioned` (CHIPS) is correctness-critical for
      // cross-site login — dropping it makes Chrome refuse/segregate the re-emitted cookie
      // so the session never sticks. Map it (and `Priority`) through the typed builder
      // instead of silently discarding the attribute.
      case 'partitioned':
        options.partitioned = true;
        break;
      case 'priority': {
        const priority = attrValue.toLowerCase();
        if (priority === 'high' || priority === 'low' || priority === 'medium') {
          options.priority = priority;
        }
        break;
      }
      default:
        break; // ignore attributes the typed builder does not model
    }
  }
  return { name, options, value };
}

function decodeCookieOctet(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** @internal Read all `Set-Cookie` values from a Headers object across platform variants. */
export function getBetterAuthSetCookie(headers: Headers | null | undefined): string[] {
  // part-3 I2 backward-compat: an instance that ignores `returnHeaders` returns the bare
  // session payload, so there is no `headers` object to read — treat that as "no refresh
  // cookies" rather than crashing on `undefined.getSetCookie`.
  if (headers === null || headers === undefined || typeof headers.get !== 'function') return [];
  const platformHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };

  // part-3 L13-3: when `getSetCookie()` is available (every modern runtime) it is the only
  // safe source — it returns each Set-Cookie as a separate, un-folded entry. Mandate it; an
  // empty result genuinely means no cookies, so do NOT fall through to the folded `get()`
  // path (which would re-introduce the comma-folding corruption this fix removes).
  if (typeof platformHeaders.getSetCookie === 'function') {
    return platformHeaders.getSetCookie();
  }

  const cookie = headers.get('set-cookie');
  if (!cookie) return [];

  // Fallback for a runtime without `getSetCookie()`: `get('set-cookie')` returns a single
  // comma-FOLDED string when multiple cookies were set. Naively returning it as one cookie
  // collapses multiple cookies into one AND corrupts any cookie whose `Expires` contains a
  // comma (e.g. `Expires=Wed, 09 Jun 2021 …`). Split on a top-level cookie boundary that
  // is Expires-comma-aware (a comma followed by a `name=` pair, not a comma inside a date).
  return splitFoldedSetCookie(cookie);
}

// part-3 L13-3: split a comma-FOLDED `Set-Cookie` header into individual cookies without
// splitting inside an RFC-1123/850 date that an `Expires` attribute embeds. A genuine
// cookie boundary is `", <cookie-name>="`: a comma, optional whitespace, an HTTP cookie-name
// token, then `=`. A comma inside an Expires date is followed by a weekday/day-of-month, not
// a `token=`, so it is preserved.
function splitFoldedSetCookie(folded: string): string[] {
  const cookies: string[] = [];
  // A cookie-name is an HTTP token (RFC 6265 token octets). The boundary requires the
  // delimiter comma to be immediately followed (after optional spaces) by `token=`.
  const boundary = /,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/g;
  let lastIndex = 0;
  for (let match = boundary.exec(folded); match !== null; match = boundary.exec(folded)) {
    cookies.push(folded.slice(lastIndex, match.index).trim());
    lastIndex = boundary.lastIndex;
  }
  const tail = folded.slice(lastIndex).trim();
  if (tail) cookies.push(tail);
  return cookies.filter((cookie) => cookie.length > 0);
}

/** @internal True when a Better Auth response status (400/401/403) signals a credential failure. */
export function isBetterAuthCredentialFailureResponse(response: BetterAuthResponseLike): boolean {
  return isCredentialFailureStatus(response.status);
}

// SECURITY (SECURITY_FINDINGS.md M2): a credential sign-in/sign-up must be classified
// by POSITIVE evidence of an established session, never by the mere absence of a
// 400/401/403. Better Auth returns Response objects for 2FA-pending (`200` with a
// `twoFactorRedirect` body and no session cookie), rate-limit (`429`), and transient
// 5xx; none of those establish a session and must be treated as failures.
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

interface SetCookieParts {
  attributes: string;
  name: string;
  normalizedName: string;
  value: string;
}

function parseSetCookieParts(rawSetCookie: string): SetCookieParts | undefined {
  const firstPair = rawSetCookie.split(';', 1)[0] ?? '';
  const separatorIndex = firstPair.indexOf('=');
  if (separatorIndex <= 0) return undefined;

  const name = firstPair.slice(0, separatorIndex).trim();
  if (!name) return undefined;

  return {
    attributes: rawSetCookie.slice(firstPair.length).toLowerCase(),
    name,
    normalizedName: normalizeCookieName(name),
    value: decodeCookieOctet(firstPair.slice(separatorIndex + 1).trim()),
  };
}

function isSessionCredentialCookieName(normalizedName: string): boolean {
  if (!normalizedName.includes('session')) return false;

  // Better Auth's cookie cache/data companions are session-derived state, not the bearer
  // credential. They must not satisfy the positive session-establishment sink.
  return !/(?:^|[._-])session[._-]?data(?:$|[._-])/.test(normalizedName);
}

// A Set-Cookie that establishes a session sets a non-empty value and is not a
// deletion (`Max-Age=0` / `Expires` in the past / empty value). Sign-out clears
// cookies this way, so the same predicate cleanly distinguishes establish vs. clear.
function isSessionEstablishingSetCookie(rawSetCookie: string): boolean {
  const parsed = parseSetCookieParts(rawSetCookie);
  if (!parsed) return false;
  if (!isSessionCredentialCookieName(parsed.normalizedName)) return false;

  if (parsed.value === '') return false;

  const attributes = parsed.attributes;
  if (/(?:^|;)\s*max-age\s*=\s*0(?:\s*;|\s*$)/.test(attributes)) return false;
  if (/(?:^|;)\s*max-age\s*=\s*-/.test(attributes)) return false;

  // part-3 I3 (SECURITY_FINDINGS.md M2): the docstring lists "Expires in the past" as a
  // clearing cookie, but only Max-Age was checked. A `sid=deleted; Expires=Thu, 01 Jan
  // 1970 …` (non-empty value, no Max-Age) was mis-classified as session-establishing.
  // Parse Expires off the ORIGINAL-case raw string (Date.parse needs the real casing) and
  // treat a valid past/now date as a deletion.
  const expires = parseSetCookieExpires(rawSetCookie);
  if (expires !== undefined && expires <= Date.now()) return false;

  return true;
}

/** @internal True when Better Auth is clearing a browser session credential. */
export function isBetterAuthSessionRevocationSetCookie(rawSetCookie: string): boolean {
  const parsed = parseSetCookieParts(rawSetCookie);
  if (!parsed) return false;
  if (!isSessionCredentialCookieName(parsed.normalizedName)) return false;

  const attributes = parsed.attributes;
  if (parsed.value === '') return true;
  if (/(?:^|;)\s*max-age\s*=\s*0(?:\s*;|\s*$)/.test(attributes)) return true;
  if (/(?:^|;)\s*max-age\s*=-/.test(attributes)) return true;

  const expires = parseSetCookieExpires(rawSetCookie);
  return expires !== undefined && expires <= Date.now();
}

function normalizeCookieName(name: string): string {
  return name
    .replace(/^__host-/i, '')
    .replace(/^__secure-/i, '')
    .toLowerCase();
}

// part-3 I3: extract a `Set-Cookie` `Expires` attribute as epoch ms, or undefined when the
// attribute is absent or unparseable. Operates on the raw (original-case) header so the
// HTTP-date is recoverable by `Date.parse`.
function parseSetCookieExpires(rawSetCookie: string): number | undefined {
  const segments = rawSetCookie.split(';');
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]?.trim() ?? '';
    const separator = segment.indexOf('=');
    if (separator === -1) continue;
    if (segment.slice(0, separator).trim().toLowerCase() !== 'expires') continue;
    const parsed = Date.parse(segment.slice(separator + 1).trim());
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function hasSessionEstablishingSetCookie(
  headers: Headers,
  options: {
    requestHeaders?: Headers;
    sessionCookieMode?: 'jwt' | 'opaque';
  },
): boolean {
  const incomingCredentials = readIncomingSessionCredentials(options.requestHeaders);
  const mode = options.sessionCookieMode ?? 'opaque';

  return getBetterAuthSetCookie(headers).some((cookie) => {
    if (!isSessionEstablishingSetCookie(cookie)) return false;

    const parsed = parseSetCookieParts(cookie);
    if (!parsed) return false;
    if (mode === 'opaque' && isJwtShapedSessionValue(parsed.value)) return false;
    if (incomingCredentials.get(parsed.normalizedName) === parsed.value) return false;

    return true;
  });
}

/** @internal True when request cookies include a JWT-shaped session credential. */
export function hasBetterAuthJwtSessionCookie(headers: Headers | undefined): boolean {
  for (const value of readIncomingSessionCredentials(headers).values()) {
    if (isJwtShapedSessionValue(value)) return true;
  }

  return false;
}

/** @internal True when the request carries a browser session credential accepted by the mode. */
export function hasBetterAuthAcceptedSessionCookie(
  headers: Headers | undefined,
  mode: 'jwt' | 'opaque' = 'opaque',
): boolean {
  for (const value of readIncomingSessionCredentials(headers).values()) {
    if (mode === 'jwt' || !isJwtShapedSessionValue(value)) return true;
  }

  return false;
}

/** @internal True when a Better Auth response clears at least one browser session credential. */
export function hasBetterAuthSessionRevocationSetCookie(headers: Headers): boolean {
  return getBetterAuthSetCookie(headers).some(isBetterAuthSessionRevocationSetCookie);
}

function readIncomingSessionCredentials(headers: Headers | undefined): Map<string, string> {
  const credentials = new Map<string, string>();
  const cookieHeader = headers?.get('cookie');
  if (!cookieHeader) return credentials;

  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const normalizedName = normalizeCookieName(name);
    if (!isSessionCredentialCookieName(normalizedName)) continue;
    credentials.set(normalizedName, decodeCookieOctet(segment.slice(separator + 1).trim()));
  }

  return credentials;
}

function isJwtShapedSessionValue(value: string): boolean {
  const segments = value.split('.');
  if (segments.length !== 3) return false;
  if (segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) return false;

  const headerSegment = segments[0];
  if (headerSegment === undefined) return false;

  const header = decodeBase64UrlJson(headerSegment);
  if (header === null || typeof header !== 'object') return false;

  const record = header as Record<string, unknown>;
  return typeof record['alg'] === 'string' || record['typ'] === 'JWT';
}

function decodeBase64UrlJson(segment: string): unknown {
  const padded = `${segment.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat(
    (4 - (segment.length % 4)) % 4,
  )}`;

  try {
    return JSON.parse(atob(padded)) as unknown;
  } catch {
    return null;
  }
}

interface BetterAuthCredentialResponseWithBody extends BetterAuthResponseLike {
  clone?: () => { json?: () => Promise<unknown> };
  json?: () => Promise<unknown>;
}

// Better Auth returns `200 { twoFactorRedirect: true, ... }` (no session cookie) when
// a second factor is required. The framework has no 2FA UI, so this is treated as a
// failure rather than redirecting into the protected area. The body is read from a
// clone so the original Response stays consumable for cookie forwarding; non-Response
// fakes (plain `{ headers, status }`) simply report "no two-factor body".
async function isBetterAuthTwoFactorPendingResponse(
  response: BetterAuthResponseLike,
): Promise<boolean> {
  const withBody = response as BetterAuthCredentialResponseWithBody;
  const readJson = (() => {
    if (typeof withBody.clone === 'function') {
      const cloned = withBody.clone();
      if (cloned && typeof cloned.json === 'function') return cloned.json.bind(cloned);
    }
    if (typeof withBody.json === 'function') return withBody.json.bind(withBody);
    return undefined;
  })();

  if (!readJson) return false;

  try {
    const body = await readJson();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>).twoFactorRedirect === true
    );
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
  context: { setCookie?: (name: string, value: string, options?: CookieOptions) => void },
  success: BetterAuthCredentialMutationValue<Status>,
  options: {
    requestHeaders?: Headers;
    sessionCookieMode?: 'jwt' | 'opaque';
  } = {},
): Promise<BetterAuthCredentialMutationValue<Status> | null> {
  if (!isSuccessStatus(response.status)) return null;
  if (await isBetterAuthTwoFactorPendingResponse(response)) return null;
  if (!hasSessionEstablishingSetCookie(response.headers, options)) return null;

  forwardBetterAuthSetCookie(response.headers, context);

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
  if (!Object.hasOwn(value, key)) return undefined;

  const property = (value as Record<string, unknown>)[key];

  return typeof property === 'number' ? property : undefined;
}

// SECURITY (SECURITY_FINDINGS.md H4): the same-origin redirect guard must reject
// authority-forming targets after backslash-normalization (browsers collapse `\`
// to `/` when resolving http(s) URLs, so `/\evil.com` resolves cross-origin) and
// reject ASCII control characters that can smuggle a CRLF / header-splitting
// payload into the emitted `Location` response header.
// eslint-disable-next-line no-control-regex -- intentional ASCII control-char class (U+0000 to U+001F, U+007F).
const redirectControlCharPattern = /[\u0000-\u001f\u007f]/;

/** @internal Same-origin redirect-target guard for the credential mutations (SECURITY_FINDINGS.md H4). */
export function redirectPath(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string' || value === '') return fallback;
  if (redirectControlCharPattern.test(value)) return fallback;

  // Browsers treat backslashes as path separators when resolving http(s) URLs, so
  // collapse them before checking for a protocol-relative (`//`) authority.
  const collapsed = value.replace(/\\/g, '/');
  if (!collapsed.startsWith('/') || collapsed.startsWith('//')) return fallback;

  return value;
}

/** @internal Build the shared `access`/`csrf`/`guard`/`registry`/`transaction` options for the credential mutations. */
export function credentialMutationDefinitionOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
>(
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest>,
  touches: readonly Domain[],
): Pick<
  MutationDefinition<Key, never, never, Request, never, GuardedRequest>,
  'access' | 'csrf' | 'guard' | 'registry' | 'transaction'
> {
  return {
    // SPEC.md §10.2: a credential mutation with no `guard` (sign-in/sign-up run
    // before authentication) declares its KV436 access decision via `access:`.
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    registry: {
      ...options.registry,
      touches: mergeDomainTouches(touches, options.registry?.touches),
    },
    ...(options.transaction === undefined ? {} : { transaction: options.transaction }),
  };
}

function mergeDomainTouches(
  defaults: readonly Domain[],
  overrides: readonly Domain[] | undefined,
): Domain[] {
  const merged = new Map(defaults.map((item) => [item.key, item]));

  for (const item of overrides ?? []) {
    merged.set(item.key, item);
  }

  return [...merged.values()];
}

export function isBetterAuthCredentialMutationTouchGraphOptions(
  value:
    | BetterAuthCredentialMutationTouchGraphOptions
    | Partial<Record<BetterAuthCredentialMutationApi, string>>,
): value is BetterAuthCredentialMutationTouchGraphOptions {
  return 'apis' in value || 'credentialMutationDeclaredTableTouches' in value || 'keys' in value;
}
