import { describe, expect, it, vi } from 'vitest';

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

  it('pins response matching and concurrent completion after authored prototype poisoning', async () => {
    const frame = {};
    const click = vi.fn(async () => {});
    const page = {
      fill: vi.fn(async () => {}),
      getByRole: vi.fn(() => ({ click })),
      goto: vi.fn(async () => {}),
      mainFrame: vi.fn(() => frame),
      waitForEvent: vi.fn(
        async (_name: string, options: { predicate(value: unknown): boolean }) => {
          expect(options.predicate(frame)).toBe(true);
        },
      ),
      waitForLoadState: vi.fn(async () => {}),
      waitForResponse: vi.fn(
        async (predicate: (response: { status(): number; url(): string }) => boolean) => {
          expect(
            predicate({
              status: () => 200,
              url: () => 'http://fixture.local/_m/auth/sign-in',
            }),
          ).toBe(true);
        },
      ),
    };
    const nativeIncludes = String.prototype.includes;
    const nativePromiseAll = Promise.all;
    try {
      String.prototype.includes = () => false;
      Promise.all = () => {
        throw new Error('ambient Promise.all must not run');
      };
      await login(page as never, 'http://fixture.local', {
        fields: { email: 'a@example.test', password: 'secret' },
        submit: 'Sign in',
      });
    } finally {
      String.prototype.includes = nativeIncludes;
      Promise.all = nativePromiseAll;
    }

    expect(click).toHaveBeenCalledOnce();
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle');
  });
});
