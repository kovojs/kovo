import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

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
   * The security class that selects the attribute floor (SPEC §6.6/§9.1). When omitted, Kovo derives
   * a conservative floor at the sink: session/auth-shaped names use the credential floor, while all
   * other cookies use the `app-data` floor.
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
   * Force or suppress the production `Secure` gate. When omitted, `Secure` is derived from the
   * runtime environment (`process.env.NODE_ENV === 'production'`) so localhost-http dev login keeps
   * working while production always gets `Secure`. Set explicitly to override the gate (e.g. behind a
   * TLS-terminating proxy that reports dev `NODE_ENV`).
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
  if (typeof downgrade.justification !== 'string' || downgrade.justification.trim() === '') {
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

const cookieDowngradeFacts: CookieDowngradeFact[] = [];

function recordCookieDowngradeFact(fact: CookieDowngradeFact): void {
  cookieDowngradeFacts.push(fact);
}

/**
 * Drain and return the recorded cookie-downgrade facts (SPEC §6.6/§9.1, audit-only).
 *
 * The `kovo explain --cookies` renderer (packages/cli/src/graph-output.ts, the `'cookies' in options`
 * branch) consumes the typed `graph.cookieDowngrades` field (`CookieDowngradeExplain`, the
 * core-graph mirror of {@link CookieDowngradeFact}). A build/export step drains these runtime facts
 * — produced at the `serializeCookie` sink whenever an `unsafeCookie` downgrade is exercised — into
 * that graph field, so each justified downgrade is surfaced in the audit a reviewer runs. The
 * downgrade itself is gated at the sink (KV432); this surface is audit-only (enforces nothing).
 */
export function drainCookieDowngradeFacts(): readonly CookieDowngradeFact[] {
  return cookieDowngradeFacts.splice(0, cookieDowngradeFacts.length);
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

/**
 * Whether the runtime is in production, gating the `Secure` floor. Honors an explicit
 * `productionSecure` override so a TLS-terminating proxy reporting dev `NODE_ENV` can force `Secure`,
 * and so tests can assert both branches without mutating the environment.
 */
function resolveProductionSecure(options: CookieOptions): boolean {
  if (options.productionSecure !== undefined) return options.productionSecure;
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

function isCredentialClass(cookieClass: CookieClass): boolean {
  return cookieClass === 'session' || cookieClass === 'auth';
}

function inferCookieClass(name: string): CookieClass {
  const normalized = name.replace(/^__(?:Host|Secure)-/, '').toLowerCase();
  const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (
    parts.some(
      (part) =>
        part === 'sid' ||
        part === 'session' ||
        part === 'sessionid' ||
        part === 'sessiontoken' ||
        part === 'auth' ||
        part === 'authtoken',
    )
  ) {
    return 'session';
  }
  return 'app-data';
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
  // but never leave SameSite silently unset — default to `lax`.
  if (!isCredentialClass(cookieClass)) {
    return {
      httpOnly: options.httpOnly,
      sameSite: options.sameSite ?? 'lax',
      secure: options.secure,
    };
  }

  const productionSecure = resolveProductionSecure(options);

  // Detect explicit insecure downgrades of the credential floor.
  const httpOnlyDowngrade = options.httpOnly === false;
  const sameSiteDowngrade = options.sameSite === 'none';
  // `Secure=false` is only a downgrade where the floor would otherwise force it (production). In
  // dev/localhost-http the floor does not set Secure at all, so `secure:false` there is not a
  // downgrade — it is the dev default and must not trip KV432 (else dev login breaks).
  const secureDowngrade = productionSecure && options.secure === false;

  const hasDowngrade = httpOnlyDowngrade || sameSiteDowngrade || secureDowngrade;

  if (hasDowngrade && downgrade === undefined) {
    throw new CookieDowngradeError(diagnosticDefinitions.KV432.message);
  }

  if (hasDowngrade && options.unsafe !== undefined) {
    recordCookieDowngradeFact({
      class: cookieClass,
      downgrade: options.unsafe.downgrade,
      justification: options.unsafe.justification,
      name,
    });
  }

  // Resolve effective attributes: floor unless an audited downgrade explicitly weakens it.
  const httpOnly = httpOnlyDowngrade ? false : true;
  const sameSite: 'lax' | 'none' | 'strict' = options.sameSite ?? 'lax';
  // Secure is prod-gated. An audited `secure:false` downgrade only takes effect in production (where
  // Secure would otherwise be forced); in dev Secure is simply not applied.
  const secure = productionSecure ? (secureDowngrade ? false : true) : (options.secure ?? false);

  return { httpOnly, sameSite, secure };
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
  if (name.startsWith('__Host-') || name.startsWith('__Secure-')) return name;
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
  // unjustified downgrade); the floor is by-construction at this single Set-Cookie sink for declared
  // classes and the app-data default. The name-based credential inference is runtime defense-in-depth
  // for classless legacy callers, not a static proof.
  const cookieClass = options.class ?? inferCookieClass(name);
  const isCredential = isCredentialClass(cookieClass);
  const floored = applyCookieFloor(name, cookieClass, options);
  const effectiveName = applyCookieNamePrefix(name, cookieClass, floored, options);

  const encodedValue = encodeURIComponent(value);
  const parts = [`${effectiveName}=${encodedValue}`];

  if (options.maxAge !== undefined) {
    if (!Number.isInteger(options.maxAge)) throw new Error('Cookie maxAge must be an integer');
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.domain !== undefined) {
    assertCookieOctets(options.domain, 'cookie domain');
    parts.push(`Domain=${options.domain}`);
  }
  // `__Host-`-prefixed cookies require `Path=/`; the floor defaults Path for credential cookies so
  // the prefix contract holds even when the caller omitted it.
  const effectivePath = options.path ?? (isCredential ? '/' : undefined);
  if (effectivePath !== undefined) {
    assertCookieOctets(effectivePath, 'cookie path');
    parts.push(`Path=${effectivePath}`);
  }
  if (options.expires !== undefined) {
    const expires =
      options.expires instanceof Date ? options.expires.toUTCString() : options.expires;
    assertCookieOctets(expires, 'cookie expires');
    parts.push(`Expires=${expires}`);
  }
  if (floored.httpOnly) parts.push('HttpOnly');
  if (floored.secure) parts.push('Secure');
  if (floored.sameSite !== undefined) {
    const sameSite = {
      lax: 'Lax',
      none: 'None',
      strict: 'Strict',
    }[floored.sameSite];
    parts.push(`SameSite=${sameSite}`);
  }
  if (options.priority !== undefined) {
    const priority = {
      high: 'High',
      low: 'Low',
      medium: 'Medium',
    }[options.priority];
    parts.push(`Priority=${priority}`);
  }
  // `Partitioned` is a valueless attribute; emit it last so it survives the round-trip
  // through `parseSetCookieHeader` (part-3 I1, SPEC §9.1.1).
  if (options.partitioned) parts.push('Partitioned');

  return parts.join('; ');
}

/**
 * Parsed attributes of a raw `Set-Cookie` header, used to normalize a forwarded cookie through the
 * floor (SPEC §6.6/§9.1).
 */
interface ParsedSetCookie {
  attributes: Map<string, string | true>;
  name: string;
  value: string;
}

function parseSetCookieHeader(raw: string): ParsedSetCookie | undefined {
  const segments = raw.split(';');
  const first = segments[0];
  if (first === undefined) return undefined;
  const eq = first.indexOf('=');
  if (eq < 0) return undefined;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (name === '') return undefined;

  const attributes = new Map<string, string | true>();
  for (const segment of segments.slice(1)) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    const attrEq = trimmed.indexOf('=');
    if (attrEq < 0) {
      attributes.set(trimmed.toLowerCase(), true);
    } else {
      attributes.set(
        trimmed.slice(0, attrEq).trim().toLowerCase(),
        trimmed.slice(attrEq + 1).trim(),
      );
    }
  }
  return { attributes, name, value };
}

/**
 * Normalize a forwarded better-auth (or other upstream) raw `Set-Cookie` header through the
 * class-derived floor (SPEC §6.6/§9.1, part-3 I1). Preserves the upstream attributes — including
 * `Partitioned` and `Priority` — and re-emits the cookie with the `session`/`auth` floor applied so a
 * forwarded credential cookie can never land below the floor. The cookie value is already
 * percent-encoded by the upstream emitter, so it is round-tripped verbatim (re-encoding would
 * double-encode it).
 *
 * SF-WIRE(forward-sink): the forwarded Set-Cookie sink (`onSessionSetCookie`/`onCsrfSetCookie` →
 * `appendResponseHeader(..., 'Set-Cookie', cookie)`) lives in `app-document.ts` (another wire). Route
 * forwarded session/auth cookies through this helper there.
 *
 * @param raw - The upstream `Set-Cookie` header value.
 * @param cookieClass - The class to floor the forwarded cookie at (default `'session'`).
 */
export function normalizeForwardedSetCookie(
  raw: string,
  cookieClass: CookieClass = 'session',
): string {
  assertNoHeaderControlCharacters(raw, 'Set-Cookie');
  const parsed = parseSetCookieHeader(raw);
  if (parsed === undefined) return raw;

  const { attributes } = parsed;
  const sameSiteRaw = attributes.get('samesite');
  const sameSite =
    typeof sameSiteRaw === 'string'
      ? (sameSiteRaw.toLowerCase() as 'lax' | 'none' | 'strict')
      : undefined;

  const upstreamHttpOnly = attributes.has('httponly');
  const upstreamSecure = attributes.has('secure');

  // Re-derive the effective floor. An upstream cookie that already omits HttpOnly/Secure/SameSite is
  // brought UP to the floor; we never downgrade a forwarded credential cookie, so no `unsafe` escape
  // is involved here. To preserve the upstream's intent where it set SameSite=None (a deliberate
  // cross-site embed), we keep it but pair it with Secure (browsers require Secure for SameSite=None).
  const productionSecure = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  const floorHttpOnly = isCredentialClass(cookieClass) ? true : upstreamHttpOnly;
  const floorSecure = isCredentialClass(cookieClass)
    ? upstreamSecure || productionSecure || sameSite === 'none'
    : upstreamSecure;

  const parts = [`${parsed.name}=${parsed.value}`];
  // Re-emit preserved attributes in a stable order, applying the floor for HttpOnly/Secure/SameSite.
  if (attributes.has('max-age')) parts.push(`Max-Age=${attributes.get('max-age') as string}`);
  if (attributes.has('domain')) parts.push(`Domain=${attributes.get('domain') as string}`);
  const path = (attributes.get('path') as string | undefined) ?? '/';
  parts.push(`Path=${path}`);
  if (attributes.has('expires')) parts.push(`Expires=${attributes.get('expires') as string}`);
  if (floorHttpOnly) parts.push('HttpOnly');
  if (floorSecure) parts.push('Secure');
  const effectiveSameSite = sameSite ?? (isCredentialClass(cookieClass) ? 'lax' : undefined);
  if (effectiveSameSite !== undefined) {
    parts.push(`SameSite=${{ lax: 'Lax', none: 'None', strict: 'Strict' }[effectiveSameSite]}`);
  }
  // Preserve Priority and Partitioned exactly as upstream set them (part-3 I1).
  if (attributes.has('priority')) parts.push(`Priority=${attributes.get('priority') as string}`);
  if (attributes.has('partitioned')) parts.push('Partitioned');

  return parts.join('; ');
}

function assertCookieName(value: string): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
    throw new Error('Cookie name must be an HTTP token');
  }
}

function assertCookieOctets(value: string, label: string): void {
  assertNoHeaderControlCharacters(value, label);
  if (value.includes(';')) throw new Error(`${label} must not contain semicolons`);
}

function assertNoHeaderControlCharacters(value: string, label: string): void {
  // SPEC §9.1.1:846 (B4): reject all C0 control characters (0x00-0x1F) and DEL (0x7F),
  // not just CR/LF/NUL. TAB, BEL, and other control bytes outside the printable header
  // grammar must be rejected by throwing — never silently stripped.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(`${label} must not contain control characters`);
    }
  }
}
