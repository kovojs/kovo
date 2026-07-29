import { createSqliteAppRuntime, type KovoSqliteSeed } from '@kovojs/server/sqlite';
import type { BetterAuthAppRequest } from '@kovojs/better-auth';
import { createBetterAuthSqliteAppBindings } from '@kovojs/better-auth/sqlite';
import { type AccessDecision } from '@kovojs/server';
import { type MutationReplayStore } from '@kovojs/server/replay';
import { type PrincipalEpochStore } from '@kovojs/server/principal-epochs';
import type { CsrfOptions } from '@kovojs/server/security';

import {
  account,
  authSchema,
  contacts,
  rateLimit,
  session,
  user,
  verification,
} from '../schema.js';
import type { AppSession } from '../auth.js';

// SPEC §6.6/§10.3: generated source carries only declarative Drizzle tables, structured seed
// rows, and opaque Kovo capabilities. Filesystem paths, native SQLite clients, Drizzle construction,
// raw SQL/DDL, and Better Auth adapter authority remain inside first-party package boundaries.
const APP_TABLES = [contacts, user, session, account, verification, rateLimit] as const;
const APP_SEED = [
  {
    table: contacts,
    rows: [
      {
        company: 'Analytical Engines',
        email: 'ada@example.com',
        id: 'c1',
        name: 'Ada Lovelace',
      },
      {
        company: 'Naval Systems',
        email: 'grace@example.com',
        id: 'c2',
        name: 'Grace Hopper',
      },
      {
        company: 'Bletchley Park',
        email: 'alan@example.com',
        id: 'c3',
        name: 'Alan Turing',
      },
    ],
  },
] as const satisfies readonly KovoSqliteSeed[];

const appDatabase = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });

/** Volatile local-development replay token; opaque and non-callable in app-authored modules. */
export const appRuntimeMutationReplayStore: MutationReplayStore = appDatabase.mutationReplayStore;
export const appRuntimePrincipalEpochStore: PrincipalEpochStore = appDatabase.principalEpochStore;

type StarterAuthRequest = BetterAuthAppRequest<AppSession>;

interface AppAuthBindingOptions {
  csrf: CsrfOptions<StarterAuthRequest>;
  signInAccess: AccessDecision;
}

/**
 * SQLite twin of the framework-owned Better Auth construction boundary (SPEC §6.6/§10.3).
 *
 * The public SQLite task door verifies the exact runtime, recovers its purpose-closed system
 * capability internally, and returns no Better Auth/database object.
 */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  return createBetterAuthSqliteAppBindings(appDatabase, {
    csrf: options.csrf,
    mapSession: ({ session: authSession, user }) => ({
      id: authSession.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema: authSchema,
    signInAccess: options.signInAccess,
  });
}

export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction token; it is not callable and has no raw/native database properties. */
export const appRuntimeDbProvider = appDatabase.db;
