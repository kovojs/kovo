import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { createBoundedRuntimeAuditCollector } from '@kovojs/core/internal/security-markers';
import { runtimeEnvironmentValue } from './runtime-environment-authority.js';

import {
  createSecurityMap,
  createSecuritySet,
  securityArrayJoin,
  securityArrayPush,
  securityDateToUtcString,
  securityEncodeURIComponent,
  securityIsDate,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityNumberIsInteger,
  securityRegExpTest,
  securitySetAdd,
  securitySetHas,
  securityStringCharCodeAt,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityStringToLowerCase,
  securityStringTrim,
} from './response-security-intrinsics.js';

/**
 * The security class of a cookie, which selects the by-construction attribute floor applied at the
 * single `serializeCookie` sink (SPEC §6.6/§9.1, secure-framework Phase 5). The floor exists so an
 * insecure cookie cannot be expressed by default.
 *
 * - `session` / `auth` — credential-bearing cookies (session id, auth token, CSRF binding). They get
 *   a forced floor: `HttpOnly` (defends against XSS theft), `Secure` in production (defends against
 *   MITM), and an explicit `SameSite` (defends against CSRF). A `__Host-`/`__Secure-` name prefix is
 *   applied where the attributes satisfy the browser-enforced prefix contract.
 * - `app-data` — non-credential application cookies (theme, locale). No HttpOnly/Secure floor is
 *   forced (these are frequently read by client JS by design), but an explicit `SameSite` is still
 *   defaulted so the cookie is never silently CSRF-exposed.
 */
export type CookieClass = 'app-data' | 'auth' | 'session';

/**
 * The audited escape for an intentional insecure downgrade of a `session`/`auth`-class cookie
 * (SPEC §6.6/§9.1). Produced by {@link unsafeCookie}; recorded as a downgrade fact for
 * `kovo explain --cookies` instead of being rejected with KV432.
 */
export interface UnsafeCookieDowngrade {
  /** Which floor attribute(s) the author is intentionally weakening. */
  downgrade: {
    httpOnly?: boolean;
    sameSite?: 'lax' | 'none' | 'strict';
    secure?: boolean;
  };
  /** A required human justification, surfaced in `kovo explain --cookies`. */
  justification: string;
}

/**
 * Attribute options for a typed `Set-Cookie` header, accepted by the third argument
 * of `MutationContext.setCookie` (SPEC §6.6 / §9.1.1). Values are serialized and
 * validated by `serializeCookie`; control characters and semicolons are rejected.
 */
export interface CookieOptions {
  /**
   * The security class that selects the attribute floor (SPEC §6.6/§9.1). When omitted, Kovo applies
   * the **credential floor** (HttpOnly + Secure(prod) + `__Host-`) — default-deny over default-allow
   * (SPEC §2). Shipping a client-readable cookie therefore requires an explicit `class: 'app-data'`;
   * there is no name-guessing fallback that could fail open on an unrecognized credential name.
   */
  class?: CookieClass;
  domain?: string;
  expires?: Date | string;
  httpOnly?: boolean;
  maxAge?: number;
  // SPEC §9.1.1:856 — CHIPS partitioning is correctness-critical for cross-site
  // (`SameSite=None`) login in an embedded/third-party context: Chrome requires the
  // `Partitioned` attribute or it refuses/segregates the cookie. The typed builder
  // must be able to emit it so `forwardBetterAuthSetCookie` round-trips it (part-3 I1).
  partitioned?: boolean;
  path?: string;
  // RFC 6265bis cookie priority. Modeled so the typed builder re-emits it instead of
  // silently dropping an attribute Better Auth set (part-3 I1).
  priority?: 'high' | 'low' | 'medium';
  /**
   * Force the credential `Secure` floor on, or request an audited downgrade off (SPEC §6.6/§9.1).
   *
   * `true` forces `Secure` regardless of `NODE_ENV` — e.g. behind a TLS-terminating proxy that
   * reports a dev request URL. `false` requests suppression of the floor; on a `session`/`auth`
   * cookie that is an insecure downgrade routed through the SAME KV432 gate as `secure: false`
   * (bugz-3 M1), so it is rejected unless recorded via {@link unsafeCookie} — an un-audited insecure
   * credential cookie is inexpressible. When omitted, `Secure` is engaged by the bootstrap-pinned
   * operator production posture (`NODE_ENV === 'production'`) or by an HTTPS-request signal
   * (`secure: true`), so the floor never depends solely on the env string (bugz-3 L1) while
   * localhost-http dev still works.
   */
  productionSecure?: boolean;
  sameSite?: 'lax' | 'none' | 'strict';
  secure?: boolean;
  /**
   * The audited downgrade escape for a `session`/`auth`-class cookie (SPEC §6.6/§9.1). When present,
   * an intentional weakening of the floor is recorded as a downgrade fact instead of being rejected
   * with KV432. Construct via {@link unsafeCookie}.
   */
  unsafe?: UnsafeCookieDowngrade;
}

/**
 * Construct the audited `unsafe` escape for an intentional insecure cookie downgrade
 * (SPEC §6.6/§9.1). Without this escape, downgrading a `session`/`auth`-class cookie's floor
 * (`HttpOnly`/`Secure` false, or `SameSite=None`) is rejected with KV432. With it, the downgrade is
 * allowed and recorded for `kovo explain --cookies`.
 *
 * @example
 * serializeCookie('embed_sid', value, {
 *   class: 'session',
 *   sameSite: 'none',
 *   unsafe: unsafeCookie({ downgrade: { sameSite: 'none' }, justification: 'third-party embed' }),
 * });
 */
export function unsafeCookie(downgrade: UnsafeCookieDowngrade): UnsafeCookieDowngrade {
  if (
    typeof downgrade.justification !== 'string' ||
    securityStringTrim(downgrade.justification) === ''
  ) {
    throw new Error('unsafeCookie requires a non-empty justification (KV432).');
  }
  return downgrade;
}

/**
 * A recorded insecure-cookie downgrade fact for `kovo explain --cookies` (SPEC §6.6/§9.1). One is
 * produced for every `serializeCookie` call that intentionally weakens a credential cookie's floor
 * through {@link unsafeCookie}. Collected by {@link drainCookieDowngradeFacts}.
 */
export interface CookieDowngradeFact {
  class: CookieClass;
  downgrade: UnsafeCookieDowngrade['downgrade'];
  justification: string;
  name: string;
}

const cookieDowngradeFacts = createBoundedRuntimeAuditCollector<CookieDowngradeFact>();

function recordCookieDowngradeFact(fact: CookieDowngradeFact): void {
  cookieDowngradeFacts.record(fact);
}

/**
 * Drain and return the recorded cookie-downgrade facts (SPEC §6.6/§9.1, audit-only).
 *
 * The `kovo explain --cookies` renderer (packages/cli/src/graph-output.ts, the `'cookies' in options`
 * branch) consumes the typed `graph.cookieDowngrades` field (`CookieDowngradeExplain`, the
 * core-graph mirror of {@link CookieDowngradeFact}). This defense-in-depth runtime drain returns the
 * newest 256 observations; static unsafeCookie call-site facts remain the authoritative build/
 * explain inventory. The downgrade itself is gated at the sink (KV432); this surface is audit-only
 * (enforces nothing).
 */
export function drainCookieDowngradeFacts(): readonly CookieDowngradeFact[] {
  return cookieDowngradeFacts.drain();
}

/**
 * Error thrown at the `serializeCookie` sink when a `session`/`auth`-class cookie is downgraded below
 * its security floor without the audited {@link unsafeCookie} escape (KV432, SPEC §6.6/§9.1). This is
 * the by-construction enforcement: an insecure credential cookie cannot be expressed by default.
 */
export class CookieDowngradeError extends Error {
  readonly code = 'KV432' as const;

  constructor(message: string) {
    super(`KV432 ${message}`);
    this.name = 'CookieDowngradeError';
  }
}

export function validateRawSetCookie(value: string): string {
  if (!value) throw new Error('ctx.setCookie requires a non-empty Set-Cookie value');
  assertNoHeaderControlCharacters(value, 'Set-Cookie');
  return value;
}

/** @internal Posture for a raw upstream `Set-Cookie` value forwarded by framework-owned adapters. */
export interface ForwardSetCookiePosture {
  /** Credential class whose floor should be applied to the forwarded cookie. */
  class?: CookieClass;
  /** Trusted HTTPS request signal from the framework adapter. */
  secure?: boolean;
  /** Audit-only source label for the internal caller that owns the upstream cookie. */
  source: 'better-auth-credential' | 'csrf' | 'legacy-normalize' | 'session-provider';
}

/**
 * Whether the bootstrap-pinned operator environment reports production via `NODE_ENV`. This is
 * one — but no longer
 * the SOLE — trigger for the credential `Secure` floor (SPEC §6.6/§9.1): an explicit force
 * (`productionSecure: true`) or an HTTPS-request signal (`secure: true`) also engages it, so the
 * floor never depends solely on a free-form env string (bugz-3 L1).
 */
function isProductionRuntime(): boolean {
  return runtimeEnvironmentValue('NODE_ENV') === 'production';
}

function isCredentialClass(cookieClass: CookieClass): boolean {
  return cookieClass === 'session' || cookieClass === 'auth';
}

/**
 * Apply the class-derived attribute floor (SPEC §6.6/§9.1). Returns the effective attributes a
 * credential cookie must carry, and emits KV432 (via {@link CookieDowngradeError}) on an unjustified
 * downgrade. For `app-data`, only a `SameSite` default is applied; for `session`/`auth`, the full
 * HttpOnly + Secure(prod) + SameSite floor is forced. Justified downgrades are recorded as facts.
 */
function applyCookieFloor(
  name: string,
  cookieClass: CookieClass,
  options: CookieOptions,
): {
  httpOnly: boolean | undefined;
  sameSite: 'lax' | 'none' | 'strict' | undefined;
  secure: boolean | undefined;
} {
  const downgrade = options.unsafe?.downgrade;

  // app-data: do not force HttpOnly/Secure (these cookies are often read by client JS by design),
  // but never leave SameSite silently unset — default to `lax`. SPEC §9.1.1: a `SameSite=None` cookie
  // MUST be paired with `Secure` (browsers silently drop a `SameSite=None` cookie without `Secure`),
  // mirroring the credential and forwarded paths — so a cross-site app-data cookie is never emitted
  // in a form every major browser rejects.
  if (!isCredentialClass(cookieClass)) {
    return {
      httpOnly: options.httpOnly,
      sameSite: options.sameSite ?? 'lax',
      secure: options.sameSite === 'none' ? true : options.secure,
    };
  }

  // The credential `Secure` floor is ENGAGED when any of: the runtime is production (`NODE_ENV`),
  // the caller forces it (`productionSecure: true`), or the caller signals an HTTPS request
  // (`secure: true`). SPEC §6.6/§9.1, bugz-3 L1: an HTTPS request forces `Secure` regardless of
  // `NODE_ENV`, so the floor no longer depends SOLELY on a free-form env string. A dev-localhost
  // carve-out remains: a plain-http request with no force engages no `Secure`, so localhost-http dev
  // login keeps working (an unconditional `Secure` would also break non-localhost http dev).
  const secureForced = options.secure === true || options.productionSecure === true;
  const secureRequired = secureForced || isProductionRuntime();

  // Detect explicit insecure downgrades of the credential floor.
  const httpOnlyDowngrade = options.httpOnly === false;
  const sameSiteDowngrade = options.sameSite === 'none';
  // bugz-3 M1: a `Secure` suppression is requested by EITHER `secure: false` OR
  // `productionSecure: false`. Both route through the SAME KV432 throw + `unsafeCookie` audit path,
  // so `productionSecure: false` can no longer silently dodge the floor (the prior code only treated
  // `secure: false` as a downgrade). A suppression is only a *downgrade* where the floor would
  // otherwise force `Secure` (`secureRequired`); in plain-http dev the floor sets no `Secure`, so
  // suppressing it there is the dev default and must not trip KV432 (else dev login breaks).
  const secureSuppressionRequested = options.secure === false || options.productionSecure === false;
  const secureDowngrade = secureRequired && secureSuppressionRequested;

  const hasDowngrade = httpOnlyDowngrade || sameSiteDowngrade || secureDowngrade;
  const actualDowngrade: UnsafeCookieDowngrade['downgrade'] = {
    ...(httpOnlyDowngrade ? { httpOnly: false } : {}),
    ...(sameSiteDowngrade ? { sameSite: 'none' as const } : {}),
    ...(secureDowngrade ? { secure: false } : {}),
  };

  if (hasDowngrade && downgrade === undefined) {
    throw new CookieDowngradeError(diagnosticDefinitions.KV432.message);
  }

  if (hasDowngrade && options.unsafe !== undefined) {
    assertUnsafeCookieDowngradeMatches(actualDowngrade, options.unsafe.downgrade);
    recordCookieDowngradeFact({
      class: cookieClass,
      downgrade: actualDowngrade,
      justification: options.unsafe.justification,
      name,
    });
  }

  // Resolve effective attributes: floor unless an audited downgrade explicitly weakens it.
  const httpOnly = httpOnlyDowngrade ? false : true;
  const sameSite: 'lax' | 'none' | 'strict' = options.sameSite ?? 'lax';
  // `Secure` is on when the floor requires it and no audited downgrade turns it off; off otherwise
  // (the dev-localhost carve-out, where `secureRequired` is false).
  const secure = secureRequired && !secureDowngrade;

  return { httpOnly, sameSite, secure };
}

function assertUnsafeCookieDowngradeMatches(
  actual: UnsafeCookieDowngrade['downgrade'],
  asserted: UnsafeCookieDowngrade['downgrade'],
): void {
  const matches =
    actual.httpOnly === asserted.httpOnly &&
    actual.sameSite === asserted.sameSite &&
    actual.secure === asserted.secure;
  if (matches) return;

  throw new CookieDowngradeError(
    'unsafeCookie downgrade attributes must exactly match the credential-cookie floor attributes being weakened.',
  );
}

/**
 * Apply the `__Host-`/`__Secure-` browser-enforced name prefix where the effective attributes satisfy
 * the prefix contract (RFC 6265bis §4.1.3, SPEC §9.1.1). Only added for credential cookies, and only
 * when not already prefixed, so the floor strengthens the name without breaking an author who already
 * chose a prefix. `__Host-` requires Secure + Path=/ + no Domain; `__Secure-` requires Secure.
 */
function applyCookieNamePrefix(
  name: string,
  cookieClass: CookieClass,
  effective: { secure: boolean | undefined },
  options: CookieOptions,
): string {
  if (!isCredentialClass(cookieClass)) return name;
  if (securityStringStartsWith(name, '__Host-') || securityStringStartsWith(name, '__Secure-')) {
    return name;
  }
  if (!effective.secure) return name;

  const path = options.path ?? '/';
  if (path === '/' && options.domain === undefined) return `__Host-${name}`;
  return `__Secure-${name}`;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  assertCookieName(name);
  // SPEC §9.1.1:846: reject any control character (B4) before encoding; then
  // percent-encode the value so spaces, commas, equals, etc. cannot inject a
  // second cookie or add unintended attributes (B2).
  assertNoHeaderControlCharacters(value, 'cookie value');

  // SPEC §6.6/§9.1 secure-framework Phase 5: resolve the class-derived attribute floor before
  // serialization so an insecure credential cookie is inexpressible by default (KV432 on an
  // unjustified downgrade); the floor is by-construction at this single Set-Cookie sink.
  // SPEC §2 (default-deny over default-allow): an OMITTED `class` resolves to the credential floor
  // (HttpOnly + Secure(prod) + `__Host-`), never the client-readable `app-data` floor — so a cookie
  // shipped without a declared class fails closed. Emitting a client-readable cookie must be an
  // explicit, auditable `class: 'app-data'`; there is no name-guessing heuristic (which would fail
  // open on any unrecognized credential name like `access_token`/`jwt`/`bearer`).
  const cookieClass = options.class ?? 'session';
  const isCredential = isCredentialClass(cookieClass);
  const floored = applyCookieFloor(name, cookieClass, options);
  const effectiveName = applyCookieNamePrefix(name, cookieClass, floored, options);

  const encodedValue = securityEncodeURIComponent(value);
  const parts = [`${effectiveName}=${encodedValue}`];

  if (options.maxAge !== undefined) {
    if (!securityNumberIsInteger(options.maxAge)) {
      throw new Error('Cookie maxAge must be an integer');
    }
    securityArrayPush(parts, `Max-Age=${options.maxAge}`);
  }
  if (options.domain !== undefined) {
    assertCookieOctets(options.domain, 'cookie domain');
    securityArrayPush(parts, `Domain=${options.domain}`);
  }
  // `__Host-`-prefixed cookies require `Path=/`; the floor defaults Path for credential cookies so
  // the prefix contract holds even when the caller omitted it.
  const effectivePath = options.path ?? (isCredential ? '/' : undefined);
  if (effectivePath !== undefined) {
    assertCookieOctets(effectivePath, 'cookie path');
    securityArrayPush(parts, `Path=${effectivePath}`);
  }
  if (options.expires !== undefined) {
    const expires = securityIsDate(options.expires)
      ? securityDateToUtcString(options.expires)
      : options.expires;
    assertCookieOctets(expires, 'cookie expires');
    securityArrayPush(parts, `Expires=${expires}`);
  }
  if (floored.httpOnly) securityArrayPush(parts, 'HttpOnly');
  if (floored.secure) securityArrayPush(parts, 'Secure');
  if (floored.sameSite !== undefined) {
    const sameSite = {
      lax: 'Lax',
      none: 'None',
      strict: 'Strict',
    }[floored.sameSite];
    securityArrayPush(parts, `SameSite=${sameSite}`);
  }
  if (options.priority !== undefined) {
    const priority = {
      high: 'High',
      low: 'Low',
      medium: 'Medium',
    }[options.priority];
    securityArrayPush(parts, `Priority=${priority}`);
  }
  // `Partitioned` is a valueless attribute; emit it last so it survives the round-trip
  // through `parseSetCookieHeader` (part-3 I1, SPEC §9.1.1).
  if (options.partitioned) securityArrayPush(parts, 'Partitioned');

  return securityArrayJoin(parts, '; ');
}

/**
 * Parsed attributes of a raw `Set-Cookie` header, used to normalize a forwarded cookie through the
 * floor (SPEC §6.6/§9.1).
 */
interface ParsedSetCookie {
  attributes: ParsedSetCookieAttribute[];
  byName: Map<string, ParsedSetCookieAttribute>;
  name: string;
  value: string;
}

interface ParsedSetCookieAttribute {
  lowerName: string;
  name: string;
  value?: string;
}

function parseSetCookieHeader(raw: string): ParsedSetCookie | undefined {
  const segments = securityStringSplit(raw, ';');
  const first = segments[0];
  if (first === undefined) return undefined;
  const eq = securityStringIndexOf(first, '=');
  if (eq < 0) return undefined;
  const name = securityStringTrim(securityStringSlice(first, 0, eq));
  const value = securityStringTrim(securityStringSlice(first, eq + 1));
  if (name === '') return undefined;

  const attributes: ParsedSetCookieAttribute[] = [];
  const byName = createSecurityMap<string, ParsedSetCookieAttribute>();
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const trimmed = securityStringTrim(segment);
    if (trimmed === '') continue;
    const attrEq = securityStringIndexOf(trimmed, '=');
    const attribute =
      attrEq < 0
        ? { lowerName: securityStringToLowerCase(trimmed), name: trimmed }
        : {
            lowerName: securityStringToLowerCase(
              securityStringTrim(securityStringSlice(trimmed, 0, attrEq)),
            ),
            name: securityStringTrim(securityStringSlice(trimmed, 0, attrEq)),
            value: securityStringTrim(securityStringSlice(trimmed, attrEq + 1)),
          };
    if (attribute.name === '') continue;
    securityArrayPush(attributes, attribute);
    securityMapSet(byName, attribute.lowerName, attribute);
  }
  return { attributes, byName, name, value };
}

/**
 * @internal Normalize a raw upstream `Set-Cookie` header through Kovo's cookie floor.
 * Preserves the upstream name/value and attributes while adding the credential floor
 * required by SPEC.md §6.6/§9.1.1. This is the only raw forwarding sink framework-owned
 * adapters should use; app-authored cookies still go through `serializeCookie`.
 */
export function forwardSetCookie(raw: string, posture: ForwardSetCookiePosture): string {
  assertNoHeaderControlCharacters(raw, 'Set-Cookie');
  const parsed = parseSetCookieHeader(raw);
  if (parsed === undefined) throw new Error('forwardSetCookie requires a name=value Set-Cookie');
  assertCookieName(parsed.name);

  const cookieClass = posture.class ?? 'session';
  const { byName } = parsed;
  const sameSiteRaw = securityMapGet(byName, 'samesite')?.value;
  const sameSite = forwardedSameSite(sameSiteRaw);

  const upstreamHttpOnly = securityMapHas(byName, 'httponly');
  const upstreamSecure = securityMapHas(byName, 'secure');

  // Re-derive the effective floor. An upstream cookie that already omits HttpOnly/Secure/SameSite is
  // brought UP to the floor; we never downgrade a forwarded credential cookie, so no `unsafe` escape
  // is involved here. To preserve the upstream's intent where it set SameSite=None (a deliberate
  // cross-site embed), we keep it but pair it with Secure (browsers require Secure for SameSite=None).
  const productionSecure = isProductionRuntime() || posture.secure === true;
  const floorHttpOnly = isCredentialClass(cookieClass) ? true : upstreamHttpOnly;
  const floorSecure = isCredentialClass(cookieClass)
    ? upstreamSecure || productionSecure || sameSite === 'none'
    : upstreamSecure;

  const parts = [`${parsed.name}=${parsed.value}`];
  // Re-emit preserved attributes in a stable order, applying the floor for HttpOnly/Secure/SameSite.
  appendForwardedAttribute(parts, securityMapGet(byName, 'max-age'), 'Max-Age');
  appendForwardedAttribute(parts, securityMapGet(byName, 'domain'), 'Domain');
  const path = securityMapGet(byName, 'path')?.value ?? '/';
  securityArrayPush(parts, `Path=${path}`);
  appendForwardedAttribute(parts, securityMapGet(byName, 'expires'), 'Expires');
  if (floorHttpOnly) securityArrayPush(parts, 'HttpOnly');
  if (floorSecure) securityArrayPush(parts, 'Secure');
  const effectiveSameSite = sameSite ?? (isCredentialClass(cookieClass) ? 'lax' : undefined);
  if (effectiveSameSite !== undefined) {
    securityArrayPush(
      parts,
      `SameSite=${{ lax: 'Lax', none: 'None', strict: 'Strict' }[effectiveSameSite]}`,
    );
  }
  appendUnknownForwardedAttributes(parts, parsed.attributes);
  // Preserve Priority and Partitioned after the floor-controlled security attributes (part-3 I1).
  appendForwardedAttribute(parts, securityMapGet(byName, 'priority'), 'Priority');
  if (securityMapHas(byName, 'partitioned')) securityArrayPush(parts, 'Partitioned');

  return securityArrayJoin(parts, '; ');
}

function forwardedSameSite(value: string | undefined): 'lax' | 'none' | 'strict' | undefined {
  const normalized = value === undefined ? undefined : securityStringToLowerCase(value);
  if (normalized === 'lax' || normalized === 'none' || normalized === 'strict') {
    return normalized;
  }
  return undefined;
}

export function normalizeForwardedSetCookie(
  raw: string,
  cookieClass: CookieClass = 'session',
): string {
  return forwardSetCookie(raw, { class: cookieClass, source: 'legacy-normalize' });
}

function appendForwardedAttribute(
  parts: string[],
  attribute: ParsedSetCookieAttribute | undefined,
  name: string,
): void {
  if (attribute?.value === undefined) return;
  securityArrayPush(parts, `${name}=${attribute.value}`);
}

const floorControlledForwardedAttributes = createFloorControlledForwardedAttributes();

function createFloorControlledForwardedAttributes(): Set<string> {
  const values = createSecuritySet<string>();
  securitySetAdd(values, 'domain');
  securitySetAdd(values, 'expires');
  securitySetAdd(values, 'httponly');
  securitySetAdd(values, 'max-age');
  securitySetAdd(values, 'partitioned');
  securitySetAdd(values, 'path');
  securitySetAdd(values, 'priority');
  securitySetAdd(values, 'samesite');
  securitySetAdd(values, 'secure');
  return values;
}

function appendUnknownForwardedAttributes(
  parts: string[],
  attributes: readonly ParsedSetCookieAttribute[],
): void {
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (securitySetHas(floorControlledForwardedAttributes, attribute.lowerName)) continue;
    securityArrayPush(
      parts,
      attribute.value === undefined ? attribute.name : `${attribute.name}=${attribute.value}`,
    );
  }
}

function assertCookieName(value: string): void {
  if (!securityRegExpTest(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, value)) {
    throw new Error('Cookie name must be an HTTP token');
  }
}

function assertCookieOctets(value: string, label: string): void {
  assertNoHeaderControlCharacters(value, label);
  if (securityStringIncludes(value, ';')) {
    throw new Error(`${label} must not contain semicolons`);
  }
}

function assertNoHeaderControlCharacters(value: string, label: string): void {
  // SPEC §9.1.1:846 (B4): reject all C0 control characters (0x00-0x1F) and DEL (0x7F),
  // not just CR/LF/NUL. TAB, BEL, and other control bytes outside the printable header
  // grammar must be rejected by throwing — never silently stripped.
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(`${label} must not contain control characters`);
    }
  }
}
