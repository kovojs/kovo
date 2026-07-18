import { type CsrfOptions, type MutationDefinition, type Schema } from '@kovojs/server';
import { csrfToken } from '@kovojs/server/internal/csrf';
import { runMutation } from '@kovojs/server/internal/execution';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

import type { BetterAuthLike, BetterAuthSignOutLike } from './internal/contracts.js';
import { betterAuthSignOutMutation, betterAuthSignUpEmailMutation } from './mutations.js';
import { betterAuthSession } from './session.js';

const csrf = {
  secret: 'origin-posture-csrf-secret-0123456789abcdef',
  sessionId: () => 'origin-posture-pre-auth',
} satisfies CsrfOptions<Request>;

async function runProtectedMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Value,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, Request>,
  input: Record<string, unknown>,
  request: Request,
) {
  Object.defineProperty(request, 'clientIp', {
    configurable: true,
    enumerable: true,
    value: '192.0.2.20',
    writable: false,
  });
  return runMutation(
    definition,
    {
      ...input,
      'kovo-csrf': csrfToken(request, csrf, { mutation: definition }),
    },
    request,
    { csrf },
  );
}

function authDatabase() {
  return { account: [], session: [], user: [], verification: [] };
}

function publicSessionProvider(auth: ReturnType<typeof betterAuth>) {
  return betterAuthSession(auth, ({ session, user }) => ({
    id: session.id,
    user: { email: user.email, id: user.id },
  }));
}

function rawAuthWithAdvancedCookies(advanced: NonNullable<BetterAuthOptions['advanced']>) {
  return betterAuth({
    advanced,
    baseURL: 'https://app.example.test/api/auth',
    database: memoryAdapter(authDatabase()),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    secret: 'origin-posture-custom-cookie-secret-0123456789abcdef',
    telemetry: { enabled: false },
  });
}

describe('Kovo-owned Better Auth origin authority', () => {
  it('rejects structural API wrappers before session or sign-out authority is used', async () => {
    const getSession = vi.fn(() => null);
    const signOut = vi.fn(() => new Response(null, { status: 204 }));
    const auth = { api: { getSession, signOut } };
    const provider = betterAuthSession(
      auth as unknown as BetterAuthLike<unknown, unknown>,
      (value) => value,
    );
    const signOutMutation = betterAuthSignOutMutation(auth as unknown as BetterAuthSignOutLike);

    await expect(
      provider(
        new Request('https://app.example.test/account', {
          headers: { cookie: '__Host-better-auth.session_token=must-not-parse' },
        }),
      ),
    ).rejects.toThrow('Better Auth session provider failed inside the trusted plaintext boundary');
    await expect(
      runProtectedMutation(
        signOutMutation,
        {},
        new Request('https://app.example.test/_m/auth/sign-out', {
          headers: {
            cookie: '__Host-better-auth.session_token=must-not-parse',
            origin: 'https://app.example.test',
          },
          method: 'POST',
        }),
      ),
    ).rejects.toThrow(
      'Better Auth credential provider failed inside the trusted plaintext boundary',
    );
    expect(getSession).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('rejects a real empty baseURL before credential, session, sign-out, or database handling', async () => {
    const database = authDatabase();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const auth = betterAuth({
        advanced: {
          disableCSRFCheck: true,
          disableOriginCheck: true,
          ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
        },
        database: memoryAdapter(database),
        emailAndPassword: { enabled: true },
        rateLimit: { enabled: false },
        secret: 'origin-posture-empty-base-url-secret-0123456789abcdef',
        telemetry: { enabled: false },
      });
      expect((await auth.$context).baseURL).toBe('');
      const handler = vi.spyOn(auth, 'handler');
      const getSession = vi.spyOn(auth.api, 'getSession');
      const signOutApi = vi.spyOn(auth.api, 'signOut');
      const signUp = betterAuthSignUpEmailMutation(auth);
      const signOut = betterAuthSignOutMutation(auth);
      const provider = publicSessionProvider(auth);

      await expect(
        runProtectedMutation(
          signUp,
          {
            email: 'must-not-exist@example.test',
            name: 'Must Not Exist',
            password: 'Correct-password-123!',
          },
          new Request('https://app.example.test/_m/auth/sign-up', {
            headers: { origin: 'https://app.example.test' },
            method: 'POST',
          }),
        ),
      ).rejects.toThrow(
        'Better Auth credential provider failed inside the trusted plaintext boundary',
      );
      await expect(
        provider(
          new Request('https://app.example.test/account', {
            headers: { cookie: 'better-auth.session_token=must-not-parse' },
          }),
        ),
      ).rejects.toThrow(
        'Better Auth session provider failed inside the trusted plaintext boundary',
      );
      await expect(
        runProtectedMutation(
          signOut,
          {},
          new Request('https://app.example.test/_m/auth/sign-out', {
            headers: { origin: 'https://app.example.test' },
            method: 'POST',
          }),
        ),
      ).rejects.toThrow(
        'Better Auth credential provider failed inside the trusted plaintext boundary',
      );
      expect(handler).not.toHaveBeenCalled();
      expect(getSession).not.toHaveBeenCalled();
      expect(signOutApi).not.toHaveBeenCalled();
      expect(database).toEqual({ account: [], session: [], user: [], verification: [] });
    } finally {
      warning.mockRestore();
    }
  });

  it('rejects the real HTTPS __Secure default before duplicate cookies reach Better Auth', async () => {
    const database = authDatabase();
    const auth = betterAuth({
      advanced: {
        disableCSRFCheck: true,
        disableOriginCheck: true,
        ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
      },
      baseURL: 'https://app.example.test/api/auth',
      database: memoryAdapter(database),
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: false },
      secret: 'origin-posture-secure-default-secret-0123456789abcdef',
      telemetry: { enabled: false },
    });
    expect((await auth.$context).authCookies.sessionToken.name).toBe(
      '__Secure-better-auth.session_token',
    );
    const handler = vi.spyOn(auth, 'handler');
    const getSession = vi.spyOn(auth.api, 'getSession');
    const signOutApi = vi.spyOn(auth.api, 'signOut');
    const signUp = betterAuthSignUpEmailMutation(auth);
    const signOut = betterAuthSignOutMutation(auth);
    const provider = publicSessionProvider(auth);

    // Chromium sends an older sibling-planted Domain=.example.test __Secure cookie before a newer
    // host-only victim cookie, and Better Auth selects the first duplicate. Registration rejects
    // this arbitrary dependency instance before any of those remotely supplied bytes are parsed.
    await expect(
      runProtectedMutation(
        signUp,
        {
          email: 'unsafe-default@example.test',
          name: 'Unsafe Default',
          password: 'Correct-password-123!',
        },
        new Request('https://app.example.test/_m/auth/sign-up', {
          headers: { origin: 'https://app.example.test' },
          method: 'POST',
        }),
      ),
    ).rejects.toThrow(
      'Better Auth credential provider failed inside the trusted plaintext boundary',
    );
    const duplicateCookie =
      '__Secure-better-auth.session_token=attacker; __Secure-better-auth.session_token=victim';
    await expect(
      provider(
        new Request('https://app.example.test/account', {
          headers: { cookie: duplicateCookie },
        }),
      ),
    ).rejects.toThrow('Better Auth session provider failed inside the trusted plaintext boundary');
    await expect(
      runProtectedMutation(
        signOut,
        {},
        new Request('https://app.example.test/_m/auth/sign-out', {
          headers: { cookie: duplicateCookie, origin: 'https://app.example.test' },
          method: 'POST',
        }),
      ),
    ).rejects.toThrow(
      'Better Auth credential provider failed inside the trusted plaintext boundary',
    );
    expect(handler).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(signOutApi).not.toHaveBeenCalled();
    expect(database).toEqual({ account: [], session: [], user: [], verification: [] });
  });

  it('does not mistake safe-looking raw cookie customizations for Kovo construction proof', async () => {
    const samples = [
      rawAuthWithAdvancedCookies({
        cookiePrefix: '__Host-custom',
        defaultCookieAttributes: {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: true,
        },
        useSecureCookies: false,
      }),
      betterAuth({
        advanced: {
          cookies: {
            session_token: {
              attributes: { httpOnly: true, path: '/', sameSite: 'lax', secure: true },
              name: '__Host-auth-session-v2',
            },
          },
          useSecureCookies: false,
        },
        baseURL: 'https://app.example.test/api/auth',
        database: memoryAdapter(authDatabase()),
        emailAndPassword: { enabled: true },
        rateLimit: { enabled: false },
        secret: 'origin-posture-cache-cookie-secret-0123456789abcdef',
        session: { cookieCache: { enabled: true, maxAge: 300 } },
        telemetry: { enabled: false },
      }),
    ];

    expect((await samples[0]!.$context).authCookies.sessionToken.name).toBe(
      '__Host-custom.session_token',
    );
    expect((await samples[1]!.$context).authCookies.sessionToken.name).toBe(
      '__Host-auth-session-v2',
    );
    for (const auth of samples) {
      const getSession = vi.spyOn(auth.api, 'getSession');
      await expect(
        publicSessionProvider(auth)(new Request('https://app.example.test/account')),
      ).rejects.toThrow(
        'Better Auth session provider failed inside the trusted plaintext boundary',
      );
      expect(getSession).not.toHaveBeenCalled();
    }
  });
});
