const unsafeCookieTokens = new WeakSet<UnsafeCookieDowngrade>();

/**
 * Cookie safety class used to derive the secure attribute floor required by
 * SPEC §9.1.1 and `plans/secure-by-construction.md` Phase 5.
 */
export type CookieClass = 'app-data' | 'auth' | 'session';

/**
 * Attribute options for a typed `Set-Cookie` header, accepted by mutation
 * `context.setCookie(name, value, options)` (SPEC §9.1.1). Values are encoded,
 * attributes are structurally serialized, and missing security attributes are
 * filled from the Phase 5 cookie floor.
 */
export interface CookieOptions {
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
  sameSite?: 'lax' | 'none' | 'strict';
  secure?: boolean;
  unsafe?: UnsafeCookieDowngrade;
}

/**
 * Justified escape hatch for an insecure cookie-attribute downgrade. KV432 treats
 * downgrades as audit-grade exceptions rather than silent app configuration.
 */
export interface UnsafeCookieDowngrade {
  downgrade: 'httpOnly' | 'sameSiteNone' | 'secure';
  justification: string;
}

/**
 * Record an explicitly justified insecure cookie downgrade (KV432).
 *
 * @param options - The downgraded attribute and audit justification.
 * @returns A token accepted by {@link CookieOptions.unsafe}.
 */
export function unsafeCookie(options: {
  downgrade: UnsafeCookieDowngrade['downgrade'];
  justification: string;
}): UnsafeCookieDowngrade {
  const justification = options.justification.trim();
  if (!justification) throw new Error('unsafeCookie requires a justification');
  const token = {
    downgrade: options.downgrade,
    justification,
  };
  unsafeCookieTokens.add(token);
  return token;
}

export function validateRawSetCookie(value: string): string {
  if (!value) throw new Error('ctx.setCookie requires a non-empty Set-Cookie value');
  assertNoHeaderControlCharacters(value, 'Set-Cookie');
  return value;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  assertCookieName(name);
  // SPEC §9.1.1:846: reject any control character (B4) before encoding; then
  // percent-encode the value so spaces, commas, equals, etc. cannot inject a
  // second cookie or add unintended attributes (B2).
  assertNoHeaderControlCharacters(value, 'cookie value');
  const normalized = normalizeCookieOptions(name, options);
  const encodedValue = encodeURIComponent(value);
  const parts = [`${name}=${encodedValue}`];

  if (normalized.maxAge !== undefined) {
    if (!Number.isInteger(normalized.maxAge)) throw new Error('Cookie maxAge must be an integer');
    parts.push(`Max-Age=${normalized.maxAge}`);
  }
  if (normalized.domain !== undefined) {
    assertCookieOctets(normalized.domain, 'cookie domain');
    parts.push(`Domain=${normalized.domain}`);
  }
  if (normalized.path !== undefined) {
    assertCookieOctets(normalized.path, 'cookie path');
    parts.push(`Path=${normalized.path}`);
  }
  if (normalized.expires !== undefined) {
    const expires =
      normalized.expires instanceof Date ? normalized.expires.toUTCString() : normalized.expires;
    assertCookieOctets(expires, 'cookie expires');
    parts.push(`Expires=${expires}`);
  }
  if (normalized.httpOnly) parts.push('HttpOnly');
  if (normalized.secure) parts.push('Secure');
  if (normalized.sameSite !== undefined) {
    const sameSite = {
      lax: 'Lax',
      none: 'None',
      strict: 'Strict',
    }[normalized.sameSite];
    parts.push(`SameSite=${sameSite}`);
  }
  if (normalized.priority !== undefined) {
    const priority = {
      high: 'High',
      low: 'Low',
      medium: 'Medium',
    }[normalized.priority];
    parts.push(`Priority=${priority}`);
  }
  // `Partitioned` is a valueless attribute; emit it last so it survives the round-trip
  // through `parseSetCookieHeader` (part-3 I1, SPEC §9.1.1).
  if (normalized.partitioned) parts.push('Partitioned');

  return parts.join('; ');
}

/**
 * Normalize a forwarded provider-owned `Set-Cookie` header through the same secure
 * floor as the typed cookie builder. Used for Better Auth/session-provider refresh
 * cookies before they are appended to route responses.
 */
export function normalizeForwardedSetCookie(
  value: string,
  options: { class?: CookieClass } = {},
): string {
  validateRawSetCookie(value);
  const parsed = parseSetCookieHeader(value);
  const normalized = normalizeCookieOptions(parsed.name, {
    ...parsed.options,
    class: options.class ?? 'session',
  });
  const parts = [`${parsed.name}=${parsed.encodedValue}`];

  if (normalized.maxAge !== undefined) parts.push(`Max-Age=${normalized.maxAge}`);
  if (normalized.domain !== undefined) parts.push(`Domain=${normalized.domain}`);
  if (normalized.path !== undefined) parts.push(`Path=${normalized.path}`);
  if (normalized.expires !== undefined) {
    const expires =
      normalized.expires instanceof Date ? normalized.expires.toUTCString() : normalized.expires;
    parts.push(`Expires=${expires}`);
  }
  if (normalized.httpOnly) parts.push('HttpOnly');
  if (normalized.secure) parts.push('Secure');
  if (normalized.sameSite !== undefined) {
    parts.push(`SameSite=${formatSameSite(normalized.sameSite)}`);
  }
  if (normalized.priority !== undefined)
    parts.push(`Priority=${formatPriority(normalized.priority)}`);
  for (const attribute of parsed.passthroughAttributes) parts.push(attribute);
  if (normalized.partitioned) parts.push('Partitioned');

  return parts.join('; ');
}

function normalizeCookieOptions(name: string, options: CookieOptions): CookieOptions {
  assertHostPrefix(name, options);
  const normalized: CookieOptions = {
    ...options,
    httpOnly: options.httpOnly ?? true,
    sameSite: options.sameSite ?? 'lax',
    secure: options.secure ?? true,
  };
  if (name.startsWith('__Host-')) {
    normalized.path = '/';
    normalized.secure = true;
    delete normalized.domain;
  }
  assertCookieFloor(name, options, normalized);
  return normalized;
}

function assertCookieFloor(name: string, original: CookieOptions, normalized: CookieOptions): void {
  if (normalized.httpOnly === false && !allowsUnsafe(original.unsafe, 'httpOnly')) {
    throw new Error('KV432 insecure cookie downgrade: HttpOnly=false requires unsafeCookie');
  }
  if (normalized.secure === false && !allowsUnsafe(original.unsafe, 'secure')) {
    throw new Error('KV432 insecure cookie downgrade: Secure=false requires unsafeCookie');
  }
  if (normalized.sameSite === 'none' && !allowsUnsafe(original.unsafe, 'sameSiteNone')) {
    throw new Error('KV432 insecure cookie downgrade: SameSite=None requires unsafeCookie');
  }
  if (name.startsWith('__Host-') && normalized.secure !== true) {
    throw new Error('__Host- cookies require Secure');
  }
}

function assertHostPrefix(name: string, options: CookieOptions): void {
  if (!name.startsWith('__Host-')) return;
  if (options.domain !== undefined) throw new Error('__Host- cookies must not set Domain');
  if (options.path !== undefined && options.path !== '/') {
    throw new Error('__Host- cookies must use Path=/');
  }
}

function allowsUnsafe(
  unsafe: UnsafeCookieDowngrade | undefined,
  downgrade: UnsafeCookieDowngrade['downgrade'],
): boolean {
  return unsafe !== undefined && unsafeCookieTokens.has(unsafe) && unsafe.downgrade === downgrade;
}

function parseSetCookieHeader(value: string): {
  encodedValue: string;
  name: string;
  options: CookieOptions;
  passthroughAttributes: string[];
} {
  const [pair, ...attributes] = value.split(';');
  const separator = pair?.indexOf('=') ?? -1;
  if (!pair || separator <= 0) throw new Error('Set-Cookie must start with a name=value pair');
  const name = pair.slice(0, separator).trim();
  const encodedValue = pair.slice(separator + 1).trim();
  assertCookieName(name);
  assertCookieOctets(encodedValue, 'cookie value');

  const options: CookieOptions = {};
  const passthroughAttributes: string[] = [];
  for (const rawAttribute of attributes) {
    const attribute = rawAttribute.trim();
    if (!attribute) continue;
    assertCookieOctets(attribute, 'cookie attribute');
    const [rawKey, ...rawRest] = attribute.split('=');
    if (rawKey === undefined) continue;
    const key = rawKey.toLowerCase();
    const rawValue = rawRest.join('=');
    switch (key) {
      case 'domain':
        options.domain = rawValue;
        break;
      case 'expires':
        options.expires = rawValue;
        break;
      case 'httponly':
        options.httpOnly = true;
        break;
      case 'max-age': {
        const maxAge = Number(rawValue);
        if (!Number.isInteger(maxAge)) throw new Error('Cookie maxAge must be an integer');
        options.maxAge = maxAge;
        break;
      }
      case 'partitioned':
        options.partitioned = true;
        break;
      case 'path':
        options.path = rawValue;
        break;
      case 'priority':
        options.priority = parsePriority(rawValue);
        break;
      case 'samesite':
        options.sameSite = parseSameSite(rawValue);
        break;
      case 'secure':
        options.secure = true;
        break;
      default:
        passthroughAttributes.push(attribute);
        break;
    }
  }

  return { encodedValue, name, options, passthroughAttributes };
}

function parseSameSite(value: string): NonNullable<CookieOptions['sameSite']> {
  const normalized = value.toLowerCase();
  if (normalized === 'lax' || normalized === 'none' || normalized === 'strict') return normalized;
  throw new Error('Cookie SameSite must be Lax, Strict, or None');
}

function formatSameSite(value: NonNullable<CookieOptions['sameSite']>): string {
  return { lax: 'Lax', none: 'None', strict: 'Strict' }[value];
}

function parsePriority(value: string): NonNullable<CookieOptions['priority']> {
  const normalized = value.toLowerCase();
  if (normalized === 'high' || normalized === 'low' || normalized === 'medium') return normalized;
  throw new Error('Cookie Priority must be High, Medium, or Low');
}

function formatPriority(value: NonNullable<CookieOptions['priority']>): string {
  return { high: 'High', low: 'Low', medium: 'Medium' }[value];
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
