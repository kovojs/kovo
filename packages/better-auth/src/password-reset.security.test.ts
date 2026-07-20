import { describe, expect, it, vi } from 'vitest';

vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

import { betterAuthPasswordResetMailDoor } from './index.js';
import {
  beginBetterAuthPasswordResetMailAttempt,
  cancelBetterAuthPasswordResetMailAttempt,
  createBetterAuthPasswordResetMailBinding,
  dispatchBetterAuthPasswordResetMail,
} from './password-reset-mail.js';

describe('Better Auth password-reset mail door (SPEC §6.6/§9.2)', () => {
  it('keeps password-reset token egress bound to the registered mail purpose', async () => {
    const delivered: Array<{ resetUrl: string; to: string }> = [];
    const mail = betterAuthPasswordResetMailDoor(async (message) => {
      delivered.push(message);
    });
    const binding = createBetterAuthPasswordResetMailBinding(mail, {
      authBasePath: '/api/auth',
      baseURL: 'https://app.example.test',
      resetPath: '/reset-password',
    });

    const presentRequest = new Request('https://app.example.test/api/auth/request-password-reset', {
      method: 'POST',
    });
    const present = beginBetterAuthPasswordResetMailAttempt(
      binding,
      presentRequest,
      'ada@example.test',
    );
    await binding.capture(
      {
        token: 'present-reset-token',
        url:
          'https://app.example.test/api/auth/reset-password/present-reset-token' +
          '?callbackURL=%2Freset-password',
        user: { email: 'ada@example.test' },
      },
      presentRequest,
    );
    await dispatchBetterAuthPasswordResetMail(present);

    const absentRequest = new Request('https://app.example.test/api/auth/request-password-reset', {
      method: 'POST',
    });
    const absent = beginBetterAuthPasswordResetMailAttempt(
      binding,
      absentRequest,
      'missing@example.test',
    );
    await dispatchBetterAuthPasswordResetMail(absent);

    expect(delivered).toHaveLength(2);
    expect(delivered[0]).toEqual({
      resetUrl:
        'https://app.example.test/api/auth/reset-password/present-reset-token' +
        '?callbackURL=%2Freset-password',
      to: 'ada@example.test',
    });
    expect(delivered[1]).toMatchObject({ to: 'missing@example.test' });
    expect(delivered[1]?.resetUrl).toMatch(
      /^https:\/\/app\.example\.test\/api\/auth\/reset-password\/[a-f0-9]{48}\?callbackURL=%2Freset-password$/u,
    );
    expect(Object.keys(delivered[0] ?? {}).sort()).toEqual(['resetUrl', 'to']);
    expect(Object.isFrozen(delivered[0])).toBe(true);

    expect(() =>
      createBetterAuthPasswordResetMailBinding({} as never, {
        authBasePath: '/api/auth',
        baseURL: 'https://app.example.test',
        resetPath: '/reset-password',
      }),
    ).toThrow(/opaque password-reset mail door/u);
  });

  it('rejects provider token, recipient, callback, and attempt mismatches before mail egress', async () => {
    const send = vi.fn(async () => {});
    const binding = createBetterAuthPasswordResetMailBinding(
      betterAuthPasswordResetMailDoor(send),
      {
        authBasePath: '/api/auth',
        baseURL: 'https://app.example.test',
        resetPath: '/reset-password',
      },
    );

    for (const data of [
      {
        token: 'expected-token',
        url:
          'https://evil.example/api/auth/reset-password/expected-token' +
          '?callbackURL=%2Freset-password',
        user: { email: 'ada@example.test' },
      },
      {
        token: 'expected-token',
        url:
          'https://app.example.test/api/auth/reset-password/other-token' +
          '?callbackURL=%2Freset-password',
        user: { email: 'ada@example.test' },
      },
      {
        token: 'expected-token',
        url:
          'https://app.example.test/api/auth/reset-password/expected-token' +
          '?callbackURL=%2Fevil-reset',
        user: { email: 'ada@example.test' },
      },
      {
        token: 'expected-token',
        url:
          'https://app.example.test/api/auth/reset-password/expected-token' +
          '?callbackURL=%2Freset-password',
        user: { email: 'other@example.test' },
      },
    ]) {
      const request = new Request('https://app.example.test/api/auth/request-password-reset', {
        method: 'POST',
      });
      const attempt = beginBetterAuthPasswordResetMailAttempt(binding, request, 'ada@example.test');
      await expect(binding.capture(data, request)).rejects.toThrow(
        /Better Auth password-reset mail/u,
      );
      cancelBetterAuthPasswordResetMailAttempt(attempt);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it('redacts mail-provider failures and seals each attempt against replay', async () => {
    const secret = 'RESET_TOKEN_MUST_NOT_LEAVE_THE_MAIL_DOOR';
    const binding = createBetterAuthPasswordResetMailBinding(
      betterAuthPasswordResetMailDoor(async (message) => {
        throw new Error(`${secret}:${message.resetUrl}`);
      }),
      {
        authBasePath: '/api/auth',
        baseURL: 'https://app.example.test',
        resetPath: '/reset-password',
      },
    );
    const request = new Request('https://app.example.test/api/auth/request-password-reset', {
      method: 'POST',
    });
    const attempt = beginBetterAuthPasswordResetMailAttempt(binding, request, 'ada@example.test');
    await binding.capture(
      {
        token: secret,
        url:
          `https://app.example.test/api/auth/reset-password/${secret}` +
          '?callbackURL=%2Freset-password',
        user: { email: 'ada@example.test' },
      },
      request,
    );

    let thrown: unknown;
    try {
      await dispatchBetterAuthPasswordResetMail(attempt);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toBe(
      'Error: Better Auth credential consumer failed inside the non-egress gate.',
    );
    expect(`${String((thrown as Error).stack)} ${JSON.stringify(thrown)}`).not.toContain(secret);
    await expect(dispatchBetterAuthPasswordResetMail(attempt)).rejects.toThrow(
      /unregistered password-reset mail attempt/u,
    );
  });
});
