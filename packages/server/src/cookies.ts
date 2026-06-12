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
  assertCookieOctets(value, 'cookie value');
  const parts = [`${name}=${value}`];

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
  if (/[\r\n]/.test(value)) throw new Error(`${label} must not contain CR or LF`);
}
