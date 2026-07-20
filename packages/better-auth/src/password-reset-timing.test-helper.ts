import { publicAccess, type CsrfOptions } from '@kovojs/server';
import { csrfToken } from '@kovojs/server/internal/csrf';
import { runMutation } from '@kovojs/server/internal/execution';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

import { betterAuthPasswordResetMailDoor } from './index.js';
import { betterAuthRequestPasswordResetMutation } from './mutations.js';
import { createBetterAuthPasswordResetMailBinding } from './password-reset-mail.js';
import { registerFakeBetterAuth } from './test-fakes.js';

const passwordResetCsrf = {
  secret: 'better-auth-password-reset-nightly-csrf-secret-0123456789',
  sessionId: () => 'anonymous-password-reset-nightly-session',
} satisfies CsrfOptions<Request>;

/** Build real provider-backed account worlds for the explicitly enabled nightly timing oracle. */
export async function createBetterAuthPasswordResetTimingWorlds(): Promise<{
  accountAbsent: () => Promise<void>;
  accountPresent: () => Promise<void>;
}> {
  const binding = createBetterAuthPasswordResetMailBinding(
    betterAuthPasswordResetMailDoor(async () => {}),
    {
      authBasePath: '/api/auth',
      baseURL: 'https://app.example.test',
      resetPath: '/reset-password',
    },
  );
  const auth = betterAuth({
    advanced: {
      disableCSRFCheck: true,
      disableOriginCheck: true,
    },
    baseURL: 'https://app.example.test',
    database: memoryAdapter({
      account: [] as Record<string, unknown>[],
      session: [] as Record<string, unknown>[],
      user: [] as Record<string, unknown>[],
      verification: [] as Record<string, unknown>[],
    }),
    emailAndPassword: {
      autoSignIn: false,
      enabled: true,
      password: {
        hash: async () => 'nightly-password-hash',
        verify: async () => false,
      },
      sendResetPassword: binding.capture,
    },
    logger: { disabled: true },
    rateLimit: { enabled: false },
    secret: 'better-auth-password-reset-nightly-router-secret-0123456789',
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
      },
      method: 'POST',
    }),
  );
  if (seed.status !== 200) throw new Error('Failed to seed the password-reset timing world.');

  const mutation = betterAuthRequestPasswordResetMutation<
    'auth/request-password-reset',
    Request,
    Request
  >(auth, {
    access: publicAccess('nightly purpose-closed Better Auth password reset'),
    csrf: passwordResetCsrf,
    mail: binding,
  });
  const run = async (email: string): Promise<void> => {
    const request = new Request('https://app.example.test/_m/auth/request-password-reset', {
      headers: { origin: 'https://app.example.test' },
      method: 'POST',
    });
    Object.defineProperty(request, 'clientIp', {
      configurable: true,
      enumerable: true,
      value: '192.0.2.40',
      writable: false,
    });
    await runMutation(
      mutation,
      {
        email,
        'kovo-csrf': csrfToken(request, passwordResetCsrf, { mutation }),
      },
      request,
      { csrf: passwordResetCsrf },
    );
  };
  return {
    accountAbsent: () => run('missing@example.test'),
    accountPresent: () => run('present@example.test'),
  };
}
