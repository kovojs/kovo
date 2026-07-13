import { describe, expect, it } from 'vitest';

import { login, loginFieldSelector } from './login.js';

describe('integration login security', () => {
  it('rejects a cross-origin login route before credentials reach a page', async () => {
    let navigated = false;
    const page = {
      goto() {
        navigated = true;
      },
    };
    await expect(
      login(page as never, 'http://fixture.local', {
        fields: { email: 'a@example.test', password: 'secret' },
        loginPath: 'https://attacker.test/login',
      }),
    ).rejects.toThrow(/must resolve on the fixture origin/u);
    expect(navigated).toBe(false);
  });

  it('escapes field names as one exact CSS attribute string', () => {
    expect(loginFieldSelector('email\"]#attacker')).toBe('[name="email\\22 \\5d \\23 attacker"]');
  });

  it('rejects login option accessors without invoking them', async () => {
    let invoked = false;
    const options = {
      fields: { email: 'a@example.test' },
      get loginPath() {
        invoked = true;
        return 'https://attacker.test/login';
      },
    };
    await expect(login({} as never, 'http://fixture.local', options)).rejects.toThrow(
      /stable own data property/u,
    );
    expect(invoked).toBe(false);
  });

  it('pins URL origin and href facts against authored getter poisoning', async () => {
    const originalHref = Object.getOwnPropertyDescriptor(URL.prototype, 'href')!;
    const originalOrigin = Object.getOwnPropertyDescriptor(URL.prototype, 'origin')!;
    let navigated = false;
    try {
      Object.defineProperty(URL.prototype, 'origin', {
        configurable: true,
        get: () => 'http://fixture.local',
      });
      Object.defineProperty(URL.prototype, 'href', {
        configurable: true,
        get: () => 'https://attacker.test/login',
      });
      await expect(
        login(
          {
            goto() {
              navigated = true;
            },
          } as never,
          'http://fixture.local',
          {
            fields: { email: 'a@example.test', password: 'secret' },
            loginPath: 'https://attacker.test/login',
          },
        ),
      ).rejects.toThrow(/must resolve on the fixture origin/u);
      expect(navigated).toBe(false);
    } finally {
      Object.defineProperty(URL.prototype, 'href', originalHref);
      Object.defineProperty(URL.prototype, 'origin', originalOrigin);
    }
  });
});
