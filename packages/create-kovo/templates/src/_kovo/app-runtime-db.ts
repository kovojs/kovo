import {
  createPostgresAppRuntimeDb,
  type AccessDecision,
  type CsrfOptions,
  type MutationReplayStore,
  type PrincipalEpochStore,
} from '@kovojs/server';
import {
  authed,
  createBetterAuthPostgresBindingsFromEnvironment,
  type BetterAuthBindingRequest,
  type BetterAuthCsrfRequestLike,
} from '@kovojs/better-auth';

import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';
import type { AppReadonlyDb } from '../db.js';
import type { AppSession } from '../auth.js';

// SPEC §6.6/§10.3: app boot eagerly mints the database runtime and its one narrowly scoped
// auth capability. Generated runtime exports below project only app-safe values; the system
// capability and raw Better Auth/Drizzle objects never cross this module.
const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);
const authSystemDb = appDatabase.systemDb({
  operation: 'write',
  reason: 'Better Auth adapter manages session tables before an app session exists',
  surface: 'src/_kovo/app-runtime-db.ts#createAppAuthBindings',
});

/** Durable SPEC §10.3 replay token; opaque and non-callable in app-authored modules. */
export const appRuntimeMutationReplayStore: MutationReplayStore = appDatabase.mutationReplayStore;
export const appRuntimePrincipalEpochStore: PrincipalEpochStore = appDatabase.principalEpochStore;

type StarterAuthRequest = BetterAuthBindingRequest &
  BetterAuthCsrfRequestLike & {
    session?: AppSession | null;
  };

interface AppAuthBindingOptions {
  csrf: CsrfOptions<StarterAuthRequest>;
  signInAccess: AccessDecision;
}

/**
 * Framework-owned Better Auth construction boundary (SPEC §6.6/§10.3).
 *
 * The generated module passes only an opaque system capability into `@kovojs/better-auth` and
 * receives a frozen sanitized binding record. Neither the raw database nor Better Auth instance
 * becomes an app-authored value.
 */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  return createBetterAuthPostgresBindingsFromEnvironment<
    StarterAuthRequest,
    AppSession,
    StarterAuthRequest & { session: AppSession }
  >({
    csrf: options.csrf,
    mapSession: ({ session: authSession, user }) => ({
      id: authSession.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    principalEpochStore: appRuntimePrincipalEpochStore,
    schema: appRuntimeSchema.authSchema,
    signInAccess: options.signInAccess,
    signOutAccess: [authed<StarterAuthRequest>()],
    systemDb: authSystemDb,
  });
}

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction token; it is not callable and has no raw/native database properties. */
export const appRuntimeDbProvider = appDatabase.db;
