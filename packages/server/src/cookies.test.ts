import { describe, expect, it } from 'vitest';

import { serializeCookie, validateRawSetCookie } from './cookies.js';

describe('cookie header helpers', () => {
  it('serializes structured Set-Cookie values', () => {
    expect(
      serializeCookie('kovo_csrf', 'c1', {
        domain: 'example.test',
        expires: new Date('2026-01-02T03:04:05Z'),
        httpOnly: true,
        maxAge: 60,
        path: '/',
        sameSite: 'strict',
        secure: true,
      }),
    ).toBe(
      'kovo_csrf=c1; Max-Age=60; Domain=example.test; Path=/; Expires=Fri, 02 Jan 2026 03:04:05 GMT; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('rejects invalid cookie names and attributes', () => {
    expect(() => serializeCookie('bad name', 'value')).toThrow('Cookie name must be an HTTP token');
    expect(() => serializeCookie('name', 'bad;value')).toThrow(
      'cookie value must not contain semicolons',
    );
    expect(() => serializeCookie('name', 'value', { maxAge: 1.5 })).toThrow(
      'Cookie maxAge must be an integer',
    );
    expect(() => serializeCookie('name', 'value', { path: '/\r\nSet-Cookie: x=y' })).toThrow(
      'cookie path must not contain CR, LF, or NUL',
    );
  });

  it('rejects CR/LF/NUL in cookie values to prevent header injection (bugs-1 F9)', () => {
    expect(() => serializeCookie('name', 'a\r\nSet-Cookie: evil=1')).toThrow(
      'cookie value must not contain CR, LF, or NUL',
    );
    expect(() => serializeCookie('name', 'a\nb')).toThrow(
      'cookie value must not contain CR, LF, or NUL',
    );
    expect(() => serializeCookie('name', 'a\0b')).toThrow(
      'cookie value must not contain CR, LF, or NUL',
    );
  });

  it('rejects empty or control-character raw Set-Cookie headers', () => {
    expect(() => validateRawSetCookie('')).toThrow(
      'ctx.setCookie requires a non-empty Set-Cookie value',
    );
    expect(() => validateRawSetCookie('a=b\nSet-Cookie: c=d')).toThrow(
      'Set-Cookie must not contain CR, LF, or NUL',
    );
    expect(() => validateRawSetCookie('a=b\0')).toThrow(
      'Set-Cookie must not contain CR, LF, or NUL',
    );
  });
});
