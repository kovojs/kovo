import { createSqliteAppRuntime, type KovoSqliteAppRuntime } from '@kovojs/server/sqlite';
import { runEndpoint } from '@kovojs/server/internal/execution';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  integer,
  sqliteTable,
  text,
} from '../../server/node_modules/drizzle-orm/sqlite-core/index.js';
import { mount } from './mount.js';
import {
  betterAuthSqliteSecret,
  createBetterAuthSqliteBindings,
  createBetterAuthSqliteBindingsFromEnvironment,
  type BetterAuthSqliteBindingsOptions,
} from './sqlite.js';

const authMocks = vi.hoisted(() => {
  const getSession = vi.fn(async () => null);
  const signInEmail = vi.fn(async () => new Response(null, { status: 204 }));
  const signOut = vi.fn(async () => new Response(null, { status: 204 }));
  const signUpEmail = vi.fn(async () => new Response(null, { status: 204 }));
  const handler = vi.fn(
    async (_request: Request) =>
      new Response(null, {
        headers: {
          'cache-control': 'no-store',
          location: '/signed-in',
          'set-cookie': 'better-auth.session_token=rotated; Path=/; HttpOnly',
        },
        status: 302,
      }),
  );
  const auth = {
    $context: Promise.resolve({
      baseURL: 'http://localhost:5173/api/auth',
      options: {
        advanced: { ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] } },
        basePath: '/api/auth',
      },
    }),
    api: { getSession, signInEmail, signOut, signUpEmail },
    handler,
  };
  return {
    auth,
    betterAuth: vi.fn(() => auth),
    drizzleAdapter: vi.fn(() => Object.freeze({ kind: 'sqlite-adapter' })),
    handler,
  };
});

const runtimeLockMocks = vi.hoisted(() => ({ assertLocked: vi.fn() }));

vi.mock('better-auth', () => ({ betterAuth: authMocks.betterAuth }));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: authMocks.drizzleAdapter }));
vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: runtimeLockMocks.assertLocked,
}));

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
const rateLimit = sqliteTable('rateLimit', {
  count: integer('count').notNull(),
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  lastRequest: integer('last_request').notNull(),
});

afterEach(() => {
  vi.restoreAllMocks();
  runtimeLockMocks.assertLocked.mockReset();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

describe('Better Auth SQLite bindings', () => {
  it('requires the persistent realm lock before direct or environment option reads', () => {
    let optionTrapHits = 0;
    const options = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          optionTrapHits += 1;
          return undefined;
        },
      },
    ) as BetterAuthSqliteBindingsOptions<TestRequest, TestSession>;

    runtimeLockMocks.assertLocked.mockImplementationOnce(() => {
      throw new TypeError('lock-first-sqlite-direct');
    });
    expect(() => createBetterAuthSqliteBindings(options)).toThrow('lock-first-sqlite-direct');
    runtimeLockMocks.assertLocked.mockImplementationOnce(() => {
      throw new TypeError('lock-first-sqlite-environment');
    });
    expect(() => createBetterAuthSqliteBindingsFromEnvironment(options)).toThrow(
      'lock-first-sqlite-environment',
    );
    expect(optionTrapHits).toBe(0);
  });

  it('requires the Better Auth rate-limit table before constructing auth', () => {
    const runtime = createSqliteAppRuntime({ tables: [proof] });
    runtimes.push(runtime);
    const options = bindingOptions(runtime);
    options.schema = { proof };

    expect(() => createBetterAuthSqliteBindings(options)).toThrow(
      'Better Auth SQLite bindings require schema.rateLimit for durable credential throttling.',
    );
    expect(authMocks.betterAuth).not.toHaveBeenCalled();
    expect(authMocks.drizzleAdapter).not.toHaveBeenCalled();
  });

  it('pins secret and origin posture and exposes only an opaque official GET mount', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createSqliteAppRuntime({ tables: [proof, rateLimit] });
    runtimes.push(runtime);
    const previousSecrets = process.env.BETTER_AUTH_SECRETS;
    const previousTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    try {
      process.env.BETTER_AUTH_SECRETS = '99:attacker-controlled-secret-value';
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://attacker.example';

      const bindings = createBetterAuthSqliteBindings(bindingOptions(runtime));

      expect(Object.keys(bindings).sort()).toEqual([
        'mountAdapter',
        'seedDemoUser',
        'sessionProvider',
        'signIn',
        'signOut',
      ]);
      expect(bindings).not.toHaveProperty('auth');
      expect(Object.isFrozen(bindings.mountAdapter)).toBe(true);
      expect(Object.keys(bindings.mountAdapter)).toEqual([]);
      expect(bindings.mountAdapter).not.toHaveProperty('handler');
      expect(authMocks.betterAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          advanced: {
            disableCSRFCheck: true,
            disableOriginCheck: true,
            ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
            useSecureCookies: false,
          },
          database: { kind: 'sqlite-adapter' },
          emailAndPassword: {
            autoSignIn: false,
            enabled: true,
            password: { hash: expect.any(Function), verify: expect.any(Function) },
          },
          rateLimit: expect.objectContaining({
            customRules: {
              '/**': false,
              '/sign-in/email': expect.any(Function),
              '/sign-up/email': expect.any(Function),
            },
            customStorage: {
              consume: expect.any(Function),
              get: expect.any(Function),
              set: expect.any(Function),
            },
            enabled: true,
            storage: 'database',
          }),
          secret: strongSecretText,
          secrets: [{ value: strongSecretText, version: 0 }],
          telemetry: { enabled: false },
          trustedOrigins: [],
        }),
      );

      const endpoint = mount('/api/auth', bindings.mountAdapter);
      const request = new Request('http://localhost:5173/api/auth/callback/github', {
        headers: {
          authorization: 'Bearer provider-callback',
          cookie: 'better-auth.state=secret',
        },
      });
      const response = await runEndpoint(endpoint, request);
      const delegated = authMocks.handler.mock.calls.at(-1)?.[0];
      expect(delegated?.headers.get('authorization')).toBe('Bearer provider-callback');
      expect(delegated?.headers.get('cookie')).toBe('better-auth.state=secret');
      expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=rotated');
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
    schema: { proof, rateLimit },
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
