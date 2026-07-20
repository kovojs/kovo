import { publicAccess, type CsrfOptions } from '@kovojs/server';
import { csrfToken } from '@kovojs/server/internal/csrf';
import { runMutation } from '@kovojs/server/internal/execution';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
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
import { betterAuthRequestPasswordResetMutation } from './mutations.js';
import { registerFakeBetterAuth } from './test-fakes.js';

const passwordResetCsrf = {
  secret: 'better-auth-password-reset-csrf-secret-0123456789',
  sessionId: () => 'anonymous-password-reset-session',
} satisfies CsrfOptions<Request>;

async function requestPasswordReset(
  mutation: ReturnType<typeof betterAuthRequestPasswordResetMutation<string, Request, Request>>,
  email: string,
  clientIp: string,
) {
  const request = new Request('https://app.example.test/_m/auth/request-password-reset', {
    headers: { origin: 'https://app.example.test' },
    method: 'POST',
  });
  Object.defineProperty(request, 'clientIp', {
    configurable: true,
    enumerable: true,
    value: clientIp,
    writable: false,
  });
  return await runMutation(
    mutation,
    {
      email,
      'kovo-csrf': csrfToken(request, passwordResetCsrf, { mutation }),
    },
    request,
    { csrf: passwordResetCsrf },
  );
}

describe('Better Auth password-reset mail door (SPEC §6.6/§9.2)', () => {
  it('makes real account-present and account-absent requests observationally equal', async () => {
    const delivered: Array<{ resetUrl: string; to: string }> = [];
    const binding = createBetterAuthPasswordResetMailBinding(
      betterAuthPasswordResetMailDoor(async (message) => {
        delivered.push(message);
      }),
      {
        authBasePath: '/api/auth',
        baseURL: 'https://app.example.test',
        resetPath: '/reset-password',
      },
    );
    const database = {
      account: [] as Record<string, unknown>[],
      session: [] as Record<string, unknown>[],
      user: [] as Record<string, unknown>[],
      verification: [] as Record<string, unknown>[],
    };
    const auth = betterAuth({
      advanced: {
        disableCSRFCheck: true,
        disableOriginCheck: true,
        ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
      },
      baseURL: 'https://app.example.test',
      database: memoryAdapter(database),
      emailAndPassword: {
        autoSignIn: false,
        enabled: true,
        password: {
          hash: async () => 'test-password-hash',
          verify: async () => false,
        },
        sendResetPassword: binding.capture,
      },
      rateLimit: { enabled: false },
      secret: 'better-auth-password-reset-real-router-secret-0123456789',
      telemetry: { enabled: false },
      trustedOrigins: [],
    });
    registerFakeBetterAuth(auth, 'https://app.example.test');

    const seed = await auth.handler(
      new Request('https://app.example.test/api/auth/sign-up/email', {
        body: JSON.stringify({
          email: 'present@example.test',
          name: 'Present Account',
          password: 'seed-password',
        }),
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.example.test',
          'x-kovo-client-ip': '192.0.2.20',
        },
        method: 'POST',
      }),
    );
    expect(seed.status).toBe(200);

    const mutation = betterAuthRequestPasswordResetMutation<
      'auth/request-password-reset',
      Request,
      Request
    >(auth, {
      access: publicAccess('purpose-closed Better Auth password reset'),
      csrf: passwordResetCsrf,
      mail: binding,
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const present = await requestPasswordReset(mutation, 'PRESENT@example.test', '192.0.2.21');
      const absent = await requestPasswordReset(mutation, 'absent@example.test', '192.0.2.22');

      expect(present).toEqual(absent);
      expect(present).toEqual({
        changes: [],
        ok: true,
        rerunQueries: [],
        value: { redirectTo: '/', status: 'recovery-accepted' },
      });
      expect(JSON.stringify(present)).not.toMatch(/cookie|token|user/u);
      expect(delivered).toHaveLength(2);
      expect(delivered[0]).toMatchObject({ to: 'PRESENT@example.test' });
      expect(delivered[1]).toMatchObject({ to: 'absent@example.test' });
      expect(delivered[0]?.resetUrl).toMatch(
        /^https:\/\/app\.example\.test\/api\/auth\/reset-password\/[A-Za-z0-9_-]+\?callbackURL=%2Freset-password$/u,
      );
      expect(delivered[1]?.resetUrl).toMatch(
        /^https:\/\/app\.example\.test\/api\/auth\/reset-password\/[A-Za-z0-9]{24}\?callbackURL=%2Freset-password$/u,
      );
      expect(database.verification).toHaveLength(1);
    } finally {
      warning.mockRestore();
    }
  });

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
      /^https:\/\/app\.example\.test\/api\/auth\/reset-password\/[A-Za-z0-9]{24}\?callbackURL=%2Freset-password$/u,
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
    expect(() =>
      createBetterAuthPasswordResetMailBinding(mail, {
        authBasePath: '/api/auth',
        baseURL: 'https://app.example.test',
        resetPath: '//evil',
      }),
    ).toThrow(/canonical same-origin path/u);
    expect(() =>
      beginBetterAuthPasswordResetMailAttempt(
        binding,
        new Request('https://app.example.test/api/auth/request-password-reset'),
        'ada@example.test\r\nBcc: attacker@example.test',
      ),
    ).toThrow(/valid email/u);
  });

  it('keeps routed rate-limit denial outside the mail door', async () => {
    const send = vi.fn(async () => {});
    const binding = createBetterAuthPasswordResetMailBinding(
      betterAuthPasswordResetMailDoor(send),
      {
        authBasePath: '/api/auth',
        baseURL: 'https://app.example.test',
        resetPath: '/reset-password',
      },
    );
    const handler = vi.fn(
      async (_request: Request) =>
        new Response(JSON.stringify({ private: 'provider-rate-limit-body' }), {
          headers: { 'content-type': 'application/json', 'retry-after': '10' },
          status: 429,
        }),
    );
    const auth = registerFakeBetterAuth(
      {
        $context: Promise.resolve({
          baseURL: 'https://app.example.test/api/auth',
          options: {
            advanced: { ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] } },
            basePath: '/api/auth',
          },
        }),
        handler,
      },
      'https://app.example.test',
    );
    const mutation = betterAuthRequestPasswordResetMutation<
      'auth/request-password-reset',
      Request,
      Request
    >(auth, {
      access: publicAccess('purpose-closed Better Auth password reset'),
      csrf: passwordResetCsrf,
      mail: binding,
    });

    await expect(
      requestPasswordReset(mutation, 'limited@example.test', '192.0.2.30'),
    ).resolves.toEqual({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 10,
      status: 429,
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(new URL(handler.mock.calls[0]![0].url).pathname).toBe(
      '/api/auth/request-password-reset',
    );
    expect(send).not.toHaveBeenCalled();
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
        token: 'expected/token',
        url:
          'https://app.example.test/api/auth/reset-password/expected%2Ftoken' +
          '?callbackURL=%2Freset-password',
        user: { email: 'ada@example.test' },
      },
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
