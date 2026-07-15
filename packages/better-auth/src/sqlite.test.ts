import { createSqliteAppRuntime, type KovoSqliteAppRuntime } from '@kovojs/server/sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sqliteTable, text } from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
import {
  betterAuthSqliteSecret,
  createBetterAuthSqliteBindings,
  type BetterAuthSqliteBindingsOptions,
} from './sqlite.js';

const authMocks = vi.hoisted(() => {
  const getSession = vi.fn(async () => null);
  const signInEmail = vi.fn(async () => new Response(null, { status: 204 }));
  const signOut = vi.fn(async () => new Response(null, { status: 204 }));
  const signUpEmail = vi.fn(async () => new Response(null, { status: 204 }));
  const auth = { api: { getSession, signInEmail, signOut, signUpEmail } };
  return {
    auth,
    betterAuth: vi.fn(() => auth),
    drizzleAdapter: vi.fn(() => Object.freeze({ kind: 'sqlite-adapter' })),
  };
});

vi.mock('better-auth', () => ({ betterAuth: authMocks.betterAuth }));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: authMocks.drizzleAdapter }));

interface TestRequest {
  headers: Headers;
}

interface TestSession {
  id: string;
  user: { email: string; id: string; name: string };
}

const runtimes: KovoSqliteAppRuntime[] = [];
const strongSecretText = 'better-auth-sqlite-test-secret-32-characters';
const proof = sqliteTable('kovo_better_auth_sqlite_posture', {
  id: text('id').primaryKey(),
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

describe('Better Auth SQLite bindings', () => {
  it('pins secret and origin posture against late upstream environment mutation', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: [proof] });
    runtimes.push(runtime);
    const previousSecrets = process.env.BETTER_AUTH_SECRETS;
    const previousTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    try {
      process.env.BETTER_AUTH_SECRETS = '99:attacker-controlled-secret-value';
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://attacker.example';

      const bindings = createBetterAuthSqliteBindings(bindingOptions(runtime));

      expect(Object.keys(bindings).sort()).toEqual([
        'seedDemoUser',
        'sessionProvider',
        'signIn',
        'signOut',
      ]);
      expect(bindings).not.toHaveProperty('auth');
      expect(authMocks.betterAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          advanced: {
            disableCSRFCheck: true,
            disableOriginCheck: true,
            useSecureCookies: false,
          },
          database: { kind: 'sqlite-adapter' },
          emailAndPassword: { autoSignIn: false, enabled: true },
          secret: strongSecretText,
          secrets: [{ value: strongSecretText, version: 0 }],
          trustedOrigins: [],
        }),
      );
    } finally {
      if (previousSecrets === undefined) delete process.env.BETTER_AUTH_SECRETS;
      else process.env.BETTER_AUTH_SECRETS = previousSecrets;
      if (previousTrustedOrigins === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      else process.env.BETTER_AUTH_TRUSTED_ORIGINS = previousTrustedOrigins;
    }
  });
});

function bindingOptions(
  runtime: KovoSqliteAppRuntime,
): BetterAuthSqliteBindingsOptions<TestRequest, TestSession> {
  return {
    baseURL: 'http://localhost:5173',
    csrf: {
      field: 'csrf',
      secret: strongSecretText,
      sessionId: () => undefined,
    },
    mapSession: ({ session, user }) => ({
      id: session.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema: { proof },
    secret: betterAuthSqliteSecret(strongSecretText),
    signInAccess: { kind: 'public', reason: 'test sign-in' },
    signOutAccess: { kind: 'public', reason: 'test sign-out' },
    systemDb: runtime.systemDb({
      operation: 'write',
      reason: 'Better Auth SQLite posture test',
      surface: 'packages/better-auth/src/sqlite.test.ts',
    }),
  };
}
