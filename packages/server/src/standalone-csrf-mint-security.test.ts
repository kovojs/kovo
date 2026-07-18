import { describe, expect, it } from 'vitest';

import { mintCsrfToken, validateCsrfToken, type CsrfOptions } from './csrf.js';

const secret = 'raw-multi-form-secret-0123456789abcdef';
const options: CsrfOptions<Request> = {
  secret,
  sessionId: () => undefined,
};

function cookiePair(setCookie: string | undefined): string {
  if (setCookie === undefined) throw new TypeError('expected anonymous CSRF cookie');
  return setCookie.split(';', 1)[0]!;
}

describe('standalone anonymous CSRF mint isolation', () => {
  it('keeps every token valid when one raw response mints multiple forms', () => {
    const request = new Request('https://shop.example.test/forms');
    const first = mintCsrfToken(request, options, { audience: 'first' });
    const second = mintCsrfToken(request, options, { audience: 'second' });

    expect(second.setCookie).toBe(first.setCookie);
    const cookie = cookiePair(second.setCookie);
    const submit = (path: string) =>
      new Request(`https://shop.example.test${path}`, {
        headers: { cookie, origin: 'https://shop.example.test' },
        method: 'POST',
      });
    expect(
      validateCsrfToken({ 'kovo-csrf': first.token }, submit('/_m/first'), options, {
        audience: 'first',
      }),
    ).toBe(true);
    expect(
      validateCsrfToken({ 'kovo-csrf': second.token }, submit('/_m/second'), options, {
        audience: 'second',
      }),
    ).toBe(true);
  });

  it('rejects conflicting same-name cookie postures within one raw response', () => {
    const request = new Request('https://shop.example.test/forms');
    mintCsrfToken(request, options, { audience: 'first' });

    expect(() =>
      mintCsrfToken(
        request,
        {
          anonymousCookie: { path: '/auth' },
          secret,
          sessionId: () => undefined,
        },
        { audience: 'second' },
      ),
    ).toThrow(/conflicting browser attribute postures/u);
  });

  it('rejects an authored browser-prefix alias at the standalone mint boundary', () => {
    expect(() =>
      mintCsrfToken(
        new Request('https://shop.example.test/forms'),
        {
          anonymousCookie: { name: '__Host-kovo_csrf' },
          secret,
          sessionId: () => undefined,
        },
        { audience: 'first' },
      ),
    ).toThrow(/unprefixed logical name/u);
  });
});
