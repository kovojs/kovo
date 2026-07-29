import { type AccessDecision } from '@kovojs/server';
import { createPostgresAppRuntimeDb } from '@kovojs/server/postgres';
import { type MutationReplayStore } from '@kovojs/server/replay';
import { type PrincipalEpochStore } from '@kovojs/server/principal-epochs';
import type { CsrfOptions } from '@kovojs/server/security';
import type { BetterAuthAppRequest } from '@kovojs/better-auth';
import { createBetterAuthPostgresAppBindings } from '@kovojs/better-auth/postgres';

import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';
import type { AppSession } from '../auth.js';

// SPEC §6.6/§10.3: app boot eagerly mints the database runtime. The Better Auth task door below
// accepts only that exact witnessed runtime and internally owns its fixed system-write capability;
// raw Better Auth/Drizzle objects never cross this module.
const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);

/** Durable SPEC §10.3 replay token; opaque and non-callable in app-authored modules. */
export const appRuntimeMutationReplayStore: MutationReplayStore = appDatabase.mutationReplayStore;
export const appRuntimePrincipalEpochStore: PrincipalEpochStore = appDatabase.principalEpochStore;

type StarterAuthRequest = BetterAuthAppRequest<AppSession>;

interface AppAuthBindingOptions {
  csrf: CsrfOptions<StarterAuthRequest>;
  signInAccess: AccessDecision;
}

/**
 * Framework-owned Better Auth construction boundary (SPEC §6.6/§10.3).
 *
 * The public Postgres task door verifies the exact runtime, mints its purpose-closed system
 * capability internally, and returns a frozen sanitized binding record. Neither the raw database
 * nor Better Auth instance becomes an app-authored value.
 */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  return createBetterAuthPostgresAppBindings(appDatabase, {
    csrf: options.csrf,
    mapSession: ({ session: authSession, user }) => ({
      id: authSession.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema: appRuntimeSchema.authSchema,
    signInAccess: options.signInAccess,
  });
}

export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction token; it is not callable and has no raw/native database properties. */
export const appRuntimeDbProvider = appDatabase.db;
