import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPostgresAppRuntimeDb,
  type KovoPostgresAppRuntimeDb,
  type KovoPostgresSystemDb,
} from '@kovojs/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { kovo } from '../../drizzle/src/index.js';
import { pgTable, text } from '../../server/node_modules/drizzle-orm/pg-core/index.js';
import {
  betterAuthPostgresSecret,
  createBetterAuthPostgresBindings,
  type BetterAuthPostgresBindingsOptions,
  type BetterAuthPostgresSecret,
} from './postgres.js';

const authMocks = vi.hoisted(() => {
  const getSession = vi.fn(async () => null);
  const signInEmail = vi.fn(async () => new Response(null, { status: 204 }));
  const signOut = vi.fn(async () => new Response(null, { status: 204 }));
  const signUpEmail = vi.fn(async () => new Response(null, { status: 204 }));
  const auth = { api: { getSession, signInEmail, signOut, signUpEmail } };
  return {
    adapter: Object.freeze({ kind: 'postgres-adapter' }),
    auth,
    betterAuth: vi.fn(() => auth),
    drizzleAdapter: vi.fn(() => Object.freeze({ kind: 'postgres-adapter' })),
    getSession,
    signInEmail,
    signOut,
    signUpEmail,
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

afterEach(async () => {
  vi.clearAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Better Auth Postgres bindings', () => {
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

  it('consumes a real opaque system capability and returns only frozen sanitized bindings', async () => {
    const systemDb = await createSystemDb();
    const bindings = createBetterAuthPostgresBindings(
      bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText)),
    );

    expect(Object.isFrozen(bindings)).toBe(true);
    expect(Object.keys(bindings).sort()).toEqual([
      'seedDemoUser',
      'sessionProvider',
      'signIn',
      'signOut',
    ]);
    expect(bindings).not.toHaveProperty('auth');
    expect(bindings).not.toHaveProperty('database');
    expect(bindings).not.toHaveProperty('systemDb');
    expect(authMocks.drizzleAdapter).toHaveBeenCalledOnce();
    expect(authMocks.betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        advanced: { disableCSRFCheck: true },
        database: { kind: 'postgres-adapter' },
        secret: strongSecretText,
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

  it('pins production posture before a late NODE_ENV mutation can re-enable fixed seeding', async () => {
    const systemDb = await createSystemDb();
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const productionApi = await import('./postgres.js?production-seed-posture');
      process.env.NODE_ENV = 'development';

      const bindings = productionApi.createBetterAuthPostgresBindings(
        bindingOptions(systemDb, productionApi.betterAuthPostgresSecret(strongSecretText)),
      );
      await bindings.seedDemoUser();

      expect(authMocks.signUpEmail).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('treats an absent development seed as disabled', async () => {
    const systemDb = await createSystemDb();
    const options = bindingOptions(systemDb, betterAuthPostgresSecret(strongSecretText));
    options.developmentSeed = undefined;
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
    schema: { bindingTestRows },
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
    schema: {},
    secret,
    signInAccess: { kind: 'public', reason: 'test sign-in' },
    signOutAccess: { kind: 'public', reason: 'test sign-out' },
    systemDb,
    ...overrides,
  };
}
