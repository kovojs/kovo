export interface CookieOptions {
  domain?: string;
  expires?: Date | string;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: 'lax' | 'none' | 'strict';
  secure?: boolean;
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
  const encodedValue = encodeURIComponent(value);
  const parts = [`${name}=${encodedValue}`];

  if (options.maxAge !== undefined) {
    if (!Number.isInteger(options.maxAge)) throw new Error('Cookie maxAge must be an integer');
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.domain !== undefined) {
    assertCookieOctets(options.domain, 'cookie domain');
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path !== undefined) {
    assertCookieOctets(options.path, 'cookie path');
    parts.push(`Path=${options.path}`);
  }
  if (options.expires !== undefined) {
    const expires =
      options.expires instanceof Date ? options.expires.toUTCString() : options.expires;
    assertCookieOctets(expires, 'cookie expires');
    parts.push(`Expires=${expires}`);
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite !== undefined) {
    const sameSite = {
      lax: 'Lax',
      none: 'None',
      strict: 'Strict',
    }[options.sameSite];
    parts.push(`SameSite=${sameSite}`);
  }

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
  if (/[\x00-\x1f\x7f]/.test(value))
    throw new Error(`${label} must not contain control characters`);
}
