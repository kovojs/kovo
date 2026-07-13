import {
  createPostgresAppRuntimeDb,
  declareSecretReadCapability,
  postgresSchemaModule,
  type AccessDecision,
  type CsrfOptions,
  usePostgresSystemDb,
  type KovoPostgresAppRuntimeDb,
  type KovoPostgresAppRuntimeOptions,
  type KovoPostgresSystemDb,
} from '@kovojs/server';
import {
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
} from '@kovojs/better-auth';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import * as schema from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';
import type { AppRequest, AppSession } from '../auth.js';

// Vite represents ESM live bindings as namespace accessors. Normalize that genuine namespace once
// through the boot-pinned framework helper so runtime DDL/RLS and Better Auth share one immutable
// schema identity (SPEC §6.6/§10.3); ordinary authored getters remain rejected by the runtime.
const appRuntimeSchema = postgresSchemaModule(schema);

const SEED_CONTACTS =
  'INSERT INTO contacts (id, name, email, company) VALUES ' +
  "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
  "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
  "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
  'ON CONFLICT (id) DO NOTHING;';

/**
 * Side-effect-light runtime config shared by app boot and `kovo db` commands.
 * The CLI imports this object to derive the same roles/seed/policies as runtime boot.
 */
export const appRuntimeDbOptions = {
  schema: appRuntimeSchema,
  seedSql: SEED_CONTACTS,
} satisfies KovoPostgresAppRuntimeOptions;

let appDatabase: KovoPostgresAppRuntimeDb | undefined;

export { declareSecretReadCapability };

function createAppDatabase(): KovoPostgresAppRuntimeDb {
  const appDatabase = createPostgresAppRuntimeDb({
    ...appRuntimeDbOptions,
  });
  return appDatabase;
}

function getAppDatabase(): KovoPostgresAppRuntimeDb {
  appDatabase ??= createAppDatabase();
  return appDatabase;
}

function lazyAppDatabaseValue<T extends object>(load: () => T): T {
  return new Proxy(Object.create(null) as T, {
    get(_target, property) {
      const value = Reflect.get(load(), property);
      return typeof value === 'function' ? value.bind(load()) : value;
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(load(), property);
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
    has(_target, property) {
      return property in load();
    },
    ownKeys() {
      return Reflect.ownKeys(load());
    },
  });
}

function lazyPromise<T>(load: () => Promise<T>): Promise<T> {
  return {
    catch(onRejected) {
      return load().catch(onRejected);
    },
    finally(onFinally) {
      return load().finally(onFinally);
    },
    then(onFulfilled, onRejected) {
      return load().then(onFulfilled, onRejected);
    },
    [Symbol.toStringTag]: 'Promise',
  } as Promise<T>;
}

function authAdapterDb(): KovoPostgresSystemDb {
  return getAppDatabase().systemDb({
    operation: 'write',
    reason: 'Better Auth adapter manages session tables before an app session exists',
    surface: 'src/_kovo/app-runtime-db.ts#createAppAuthBindings',
  });
}

function createAuthAdapter(): ReturnType<typeof drizzleAdapter> {
  return usePostgresSystemDb(authAdapterDb(), (db) =>
    drizzleAdapter(db, { provider: 'pg', schema: appRuntimeSchema.authSchema }),
  );
}

interface AppAuthBindingOptions {
  baseURL: string;
  csrf: CsrfOptions<AppRequest>;
  secret: string;
  signInAccess: AccessDecision;
  signOutAccess: AccessDecision;
}

/**
 * Framework-owned Better Auth construction boundary (SPEC §6.6/§10.3).
 *
 * The privileged adapter and raw Better Auth instance never cross this module. App-authored
 * `auth.ts` receives only a sanitized session provider, Kovo mutation declarations, and the
 * fixed demo-seed operation; none exposes `$context`, an adapter method, or an auth-table row.
 */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  const auth = betterAuth({
    advanced: { disableCSRFCheck: true },
    baseURL: options.baseURL,
    database: createAuthAdapter(),
    emailAndPassword: { enabled: true },
    secret: options.secret,
  });

  const sessionProvider = betterAuthSession(auth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: { email: user.email, id: user.id, name: user.name },
  }));
  const signIn = betterAuthSignInEmailMutation<'auth/sign-in', AppRequest>(auth, {
    access: options.signInAccess,
    csrf: options.csrf,
    defaultRedirectTo: '/',
  });
  const signOut = betterAuthSignOutMutation<
    'auth/sign-out',
    AppRequest,
    AppRequest & { session: AppSession }
  >(auth, {
    access: options.signOutAccess,
    csrf: options.csrf,
    defaultRedirectTo: '/login',
  });

  async function seedDemoUser(): Promise<void> {
    // SPEC §2/§6.6: the generated credential is a local-development convenience,
    // never a production authentication path. A copied gitignored .env must not
    // silently provision a known demo principal when the deploy artifact boots.
    if (process.env.NODE_ENV === 'production') return;
    const password = process.env.KOVO_DEMO_PASSWORD;
    if (!password || password === 'replace-with-a-local-demo-password') return;

    try {
      await auth.api.signUpEmail({
        asResponse: true,
        body: { email: 'demo@example.com', name: 'Demo User', password },
        headers: new Headers(),
      });
    } catch {
      // Already seeded.
    }
  }

  return Object.freeze({ seedDemoUser, sessionProvider, signIn, signOut });
}

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = lazyAppDatabaseValue(
  () => getAppDatabase().readonlyDb,
);
export const appRuntimeDbReady: Promise<void> = lazyPromise(() => getAppDatabase().ready);

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  return getAppDatabase().db(request);
}
