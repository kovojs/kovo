import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPostgresAppRuntimeDb,
  csrfToken,
  type KovoPostgresAppRuntimeDb,
  type KovoPostgresSystemDb,
} from '@kovojs/server';
import { runEndpoint } from '@kovojs/server/internal/execution';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { kovo } from '../../drizzle/src/index.js';
import { runMutation } from '../../server/src/mutation.js';
import {
  bigint,
  integer,
  pgTable,
  text,
} from '../../server/node_modules/drizzle-orm/pg-core/index.js';
import { mount } from './mount.js';
import {
  betterAuthPostgresSecret,
  createBetterAuthPostgresBindings,
  createBetterAuthPostgresBindingsFromEnvironment,
  type BetterAuthPostgresBindingsOptions,
  type BetterAuthPostgresSecret,
} from './postgres.js';

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
      baseURL: 'https://app.example.test/api/auth',
      options: {
        advanced: { ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] } },
        basePath: '/api/auth',
      },
    }),
    api: { getSession, signInEmail, signOut, signUpEmail },
    handler,
  };
  return {
    adapter: Object.freeze({ kind: 'postgres-adapter' }),
    auth,
    betterAuth: vi.fn(() => auth),
    drizzleAdapter: vi.fn(() => Object.freeze({ kind: 'postgres-adapter' })),
    getSession,
    handler,
    signInEmail,
    signOut,
    signUpEmail,
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

const roots: string[] = [];
const runtimes: KovoPostgresAppRuntimeDb[] = [];
const strongSecretText = 'better-auth-postgres-test-secret-32-chars';
const bindingTestRows = pgTable(
  'kovo_better_auth_binding_test_rows',
  { id: text('id').primaryKey() },
  kovo({
    authzPolicy: 'shared framework binding test fixture',
    domain: 'better-auth-binding-test',
    key: 'id',
  }),
);
const rateLimit = pgTable('rateLimit', {
  count: integer('count').notNull(),
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

afterEach(async () => {
  vi.clearAllMocks();
  runtimeLockMocks.assertLocked.mockReset();
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Better Auth Postgres bindings', () => {
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
    ) as BetterAuthPostgresBindingsOptions<TestRequest, TestSession>;

    runtimeLockMocks.assertLocked.mockImplementationOnce(() => {
      throw new TypeError('lock-first-postgres-direct');
    });
    expect(() => createBetterAuthPostgresBindings(options)).toThrow('lock-first-postgres-direct');
    runtimeLockMocks.assertLocked.mockImplementationOnce(() => {
      throw new TypeError('lock-first-postgres-environment');
    });
    expect(() => createBetterAuthPostgresBindingsFromEnvironment(options)).toThrow(
      'lock-first-postgres-environment',
    );
    expect(optionTrapHits).toBe(0);
  });

  it('requires the validating secret constructor and repeats its runtime floor at the sink', () => {
    expect(() => betterAuthPostgresSecret('too-short')).toThrow(/at least 32 characters/u);
    expect(betterAuthPostgresSecret(strongSecretText)).toBe(strongSecretText);

    const forged = 'still-too-short' as BetterAuthPostgresSecret;
    expect(() =>
      createBetterAuthPostgresBindings(bindingOptions({} as KovoPostgresSystemDb, forged)),
    ).toThrow(/at least 32 characters/u);
    expect(authMocks.betterAuth).not.toHaveBeenCalled();
    expect(authMocks.drizzleAdapter).not.toHaveBeenCalled();
  });

  it('requires the Better Auth rate-limit table before constructing auth', async () => {
    const systemDb = await createSystemDb();
    const options = bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText));
    options.schema = { bindingTestRows };

    expect(() => createBetterAuthPostgresBindings(options)).toThrow(
      'Better Auth Postgres bindings require schema.rateLimit for durable credential throttling.',
    );
    expect(authMocks.betterAuth).not.toHaveBeenCalled();
    expect(authMocks.drizzleAdapter).not.toHaveBeenCalled();
  });

  it('consumes a real opaque system capability and returns only frozen sanitized bindings', async () => {
    const systemDb = await createSystemDb();
    const bindings = createBetterAuthPostgresBindings(
      bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText)),
    );

    expect(Object.isFrozen(bindings)).toBe(true);
    expect(Object.keys(bindings).sort()).toEqual([
      'mountAdapter',
      'seedDemoUser',
      'sessionProvider',
      'signIn',
      'signOut',
    ]);
    expect(bindings).not.toHaveProperty('auth');
    expect(bindings).not.toHaveProperty('database');
    expect(bindings).not.toHaveProperty('systemDb');
    expect(Object.isFrozen(bindings.mountAdapter)).toBe(true);
    expect(Object.keys(bindings.mountAdapter)).toEqual([]);
    expect(bindings.mountAdapter).not.toHaveProperty('handler');
    expect(authMocks.drizzleAdapter).toHaveBeenCalledOnce();
    expect(authMocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        advanced: {
          disableCSRFCheck: true,
          disableOriginCheck: true,
          ipAddress: { ipAddressHeaders: ['x-kovo-client-ip'] },
          useSecureCookies: true,
        },
        database: { kind: 'postgres-adapter' },
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

    await bindings.seedDemoUser();
    expect(authMocks.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        asResponse: true,
        body: {
          email: 'demo@example.com',
          name: 'Demo User',
          password: 'local-demo-password',
        },
      }),
    );

    const endpoint = mount('/api/auth', bindings.mountAdapter);
    const request = new Request('https://app.example.test/api/auth/callback/github', {
      headers: {
        authorization: 'Bearer provider-callback',
        cookie: 'better-auth.state=secret',
      },
    });
    const response = await runEndpoint(endpoint, request);
    expect(authMocks.handler).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const delegated = authMocks.handler.mock.calls.at(-1)?.[0];
    expect(delegated?.headers.get('authorization')).toBe('Bearer provider-callback');
    expect(delegated?.headers.get('cookie')).toBe('better-auth.state=secret');
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=rotated');
  });

  it('rejects counterfeit capabilities, proxy schemas, and accessor-backed options before auth', () => {
    const secret = betterAuthPostgresSecret(strongSecretText);
    expect(() =>
      createBetterAuthPostgresBindings(bindingOptions({} as KovoPostgresSystemDb, secret)),
    ).toThrow(/KV414: invalid Postgres system DB capability/u);

    const proxiedSchema = new Proxy({}, {});
    expect(() =>
      createBetterAuthPostgresBindings(
        bindingOptions({} as KovoPostgresSystemDb, secret, { schema: proxiedSchema }),
      ),
    ).toThrow(/schema module namespace must not be a Proxy/u);

    const options = bindingOptions({} as KovoPostgresSystemDb, secret);
    Object.defineProperty(options, 'baseURL', { enumerable: true, get: () => 'https://evil.test' });
    expect(() => createBetterAuthPostgresBindings(options)).toThrow(
      /must be an own-data property/u,
    );
    expect(authMocks.betterAuth).not.toHaveBeenCalled();
  });

  it('pins secrets and rejects hostile origins after late upstream environment mutation', async () => {
    const systemDb = await createSystemDb();
    const csrf = {
      field: 'csrf',
      secret: strongSecretText,
      sessionId: () => 'session-1',
    };
    const bindings = createBetterAuthPostgresBindings(
      bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText), { csrf }),
    );
    const sameOriginRequest = new Request('https://app.example.test/login', {
      headers: { origin: 'https://app.example.test' },
      method: 'POST',
    });
    const token = csrfToken(sameOriginRequest, csrf, { audience: 'auth/sign-in' });
    const previousSecrets = process.env.BETTER_AUTH_SECRETS;
    const previousTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    try {
      // Better Auth reads these variables dynamically. Its router is unreachable and its origin
      // authority is disabled; Kovo's mutation ingress remains the sole origin floor (SPEC §6.6).
      process.env.BETTER_AUTH_SECRETS = '99:attacker-controlled-secret-value';
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://attacker.example';
      const hostileRequest = new Request('https://app.example.test/login', {
        headers: { origin: 'https://attacker.example' },
        method: 'POST',
      });

      await expect(
        runMutation(
          bindings.signIn,
          { csrf: token, email: 'ada@example.test', password: 'password' },
          hostileRequest,
        ),
      ).resolves.toEqual({ error: { code: 'CSRF', payload: {} }, ok: false, status: 422 });
      expect(authMocks.signInEmail).not.toHaveBeenCalled();
      expect(authMocks.betterAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          advanced: expect.objectContaining({ disableOriginCheck: true }),
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

  it('does not let a late NODE_ENV mutation change the boot-pinned seed posture', async () => {
    const systemDb = await createSystemDb();
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      const bindings = createBetterAuthPostgresBindings(
        bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText)),
      );
      process.env.NODE_ENV = 'production';
      await bindings.seedDemoUser();

      expect(authMocks.signUpEmail).toHaveBeenCalledOnce();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('treats an absent development seed as disabled', async () => {
    const systemDb = await createSystemDb();
    const options = bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText));
    delete options.developmentSeed;
    const bindings = createBetterAuthPostgresBindings(options);

    await bindings.seedDemoUser();

    expect(authMocks.signUpEmail).not.toHaveBeenCalled();
  });

  it('rejects a non-string development password at the package boundary', () => {
    const options = bindingOptions(
      {} as KovoPostgresSystemDb,
      betterAuthPostgresSecret(strongSecretText),
    );
    options.developmentSeed = {
      email: 'demo@example.com',
      name: 'Demo User',
      password: 42 as unknown as string,
    };

    expect(() => createBetterAuthPostgresBindings(options)).toThrow(
      /developmentSeed\.password must be a string/u,
    );
    expect(authMocks.betterAuth).not.toHaveBeenCalled();
  });
});

async function createSystemDb(): Promise<KovoPostgresSystemDb> {
  const dataDir = mkdtempSync(join(tmpdir(), 'kovo-better-auth-postgres-'));
  roots.push(dataDir);
  const runtime = createPostgresAppRuntimeDb({
    dataDir,
    driver: 'pglite',
    schema: { bindingTestRows, rateLimit },
  });
  runtimes.push(runtime);
  await runtime.ready;
  return runtime.systemDb({
    operation: 'write',
    reason: 'Better Auth Postgres binding unit test',
    surface: 'packages/better-auth/src/postgres.test.ts',
  });
}

function bindingOptions(
  systemDb: KovoPostgresSystemDb,
  secret: BetterAuthPostgresSecret,
  overrides: Partial<BetterAuthPostgresBindingsOptions<TestRequest, TestSession>> = {},
): BetterAuthPostgresBindingsOptions<TestRequest, TestSession> {
  return {
    baseURL: 'https://app.example.test',
    csrf: {
      field: 'csrf',
      secret: strongSecretText,
      sessionId: () => undefined,
    },
    developmentSeed: {
      email: 'demo@example.com',
      name: 'Demo User',
      password: 'local-demo-password',
    },
    mapSession: ({ session, user }) => ({
      id: session.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema: { rateLimit },
    secret,
    signInAccess: { kind: 'public', reason: 'test sign-in' },
    signOutAccess: { kind: 'public', reason: 'test sign-out' },
    systemDb,
    ...overrides,
  };
}
