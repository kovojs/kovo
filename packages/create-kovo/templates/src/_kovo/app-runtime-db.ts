import {
  createPostgresAppRuntimeDb,
  declareSecretReadCapability,
  type AccessDecision,
  type CsrfOptions,
  type MutationReplayStore,
} from '@kovojs/server';
import { betterAuthPostgresSecret, createBetterAuthPostgresBindings } from '@kovojs/better-auth';

import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';
import type { AppDb, AppReadonlyDb } from '../db.js';
import type { AppRequest, AppSession } from '../auth.js';

// SPEC §6.6/§10.3: app boot eagerly mints the database runtime and its one narrowly scoped
// auth capability. Generated runtime exports below project only app-safe values; the system
// capability and raw Better Auth/Drizzle objects never cross this module.
const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);
const authSystemDb = appDatabase.systemDb({
  operation: 'write',
  reason: 'Better Auth adapter manages session tables before an app session exists',
  surface: 'src/_kovo/app-runtime-db.ts#createAppAuthBindings',
});

export { declareSecretReadCapability };

/** Durable SPEC §10.3 mutation replay truth, reachable only through the framework system role. */
export function appRuntimeMutationReplayStore(): MutationReplayStore {
  return appDatabase.mutationReplayStore;
}

interface AppAuthBindingOptions {
  baseURL: string;
  csrf: CsrfOptions<AppRequest>;
  secret: string;
  signInAccess: AccessDecision;
  signOutAccess: AccessDecision;
}

function appDevelopmentSeed() {
  const password = process.env.KOVO_DEMO_PASSWORD;
  if (!password || password === 'replace-with-a-local-demo-password') return undefined;
  return { email: 'demo@example.com', name: 'Demo User', password };
}

/**
 * Framework-owned Better Auth construction boundary (SPEC §6.6/§10.3).
 *
 * The generated module passes only an opaque system capability into `@kovojs/better-auth` and
 * receives a frozen sanitized binding record. Neither the raw database nor Better Auth instance
 * becomes an app-authored value.
 */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  const developmentSeed = appDevelopmentSeed();
  return createBetterAuthPostgresBindings<
    AppRequest,
    AppSession,
    AppRequest & { session: AppSession }
  >({
    baseURL: options.baseURL,
    csrf: options.csrf,
    ...(developmentSeed === undefined ? {} : { developmentSeed }),
    mapSession: ({ session: authSession, user }) => ({
      id: authSession.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema: appRuntimeSchema.authSchema,
    secret: betterAuthPostgresSecret(options.secret),
    signInAccess: options.signInAccess,
    signOutAccess: options.signOutAccess,
    systemDb: authSystemDb,
  });
}

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  return appDatabase.db(request);
}
