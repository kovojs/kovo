import { describe, expect, it } from 'vitest';

import { cookiePair, firstSetCookiePair, headerValues, setCookieValues } from './headers.js';

describe('@jiso/test header fixtures', () => {
  it('reads case-insensitive header record values', () => {
    expect(
      headerValues(
        {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': ['sid=1; Path=/', 'theme=dark; Path=/'],
        },
        'set-cookie',
      ),
    ).toEqual(['sid=1; Path=/', 'theme=dark; Path=/']);
    expect(headerValues({ 'Content-Type': 'text/html' }, 'content-type')).toEqual(['text/html']);
  });

  it('reads Headers values and normalizes Set-Cookie pairs', () => {
    const headers = new Headers({
      'content-type': 'text/html',
      'set-cookie': 'sid=1; Path=/; HttpOnly',
    });

    expect(headerValues(headers, 'content-type')).toEqual(['text/html']);
    expect(setCookieValues(headers)).toEqual(['sid=1; Path=/; HttpOnly']);
    expect(cookiePair(setCookieValues(headers)[0])).toBe('sid=1');
    expect(firstSetCookiePair(headers)).toBe('sid=1');
  });
});
