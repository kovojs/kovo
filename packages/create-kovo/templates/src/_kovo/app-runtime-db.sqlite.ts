import { createSqliteAppRuntime, type KovoSqliteSeed } from '@kovojs/server/sqlite';
import { createBetterAuthSqliteBindingsFromEnvironment } from '@kovojs/better-auth';
import { type AccessDecision, type CsrfOptions, type MutationReplayStore } from '@kovojs/server';

import { account, authSchema, contacts, session, user, verification } from '../schema.js';
import type { AppReadonlyDb } from '../db.js';
import type { AppRequest, AppSession } from '../auth.js';

// SPEC §6.6/§10.3: generated source carries only declarative Drizzle tables, structured seed
// rows, and opaque Kovo capabilities. Filesystem paths, native SQLite clients, Drizzle construction,
// raw SQL/DDL, and Better Auth adapter authority remain inside first-party package boundaries.
const APP_TABLES = [contacts, user, session, account, verification] as const;
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
const authSystemDb = appDatabase.systemDb({
  operation: 'write',
  reason: 'Better Auth adapter manages local session tables before an app session exists',
  surface: 'src/_kovo/app-runtime-db.ts#createAppAuthBindings',
});

/** Volatile local-development replay token; opaque and non-callable in app-authored modules. */
export const appRuntimeMutationReplayStore: MutationReplayStore = appDatabase.mutationReplayStore;

interface AppAuthBindingOptions {
  csrf: CsrfOptions<AppRequest>;
  signInAccess: AccessDecision;
  signOutAccess: AccessDecision;
}

/**
 * SQLite twin of the framework-owned Better Auth construction boundary (SPEC §6.6/§10.3).
 *
 * The raw-capability consumer is package-internal. Generated code can only pass the opaque
 * capability to this sanitized binding constructor and receives no Better Auth/database object.
 */
export function createAppAuthBindings(options: AppAuthBindingOptions) {
  return createBetterAuthSqliteBindingsFromEnvironment<
    AppRequest,
    AppSession,
    AppRequest & { session: AppSession }
  >({
    csrf: options.csrf,
    mapSession: ({ session: authSession, user }) => ({
      id: authSession.id,
      user: { email: user.email, id: user.id, name: user.name },
    }),
    schema: authSchema,
    signInAccess: options.signInAccess,
    signOutAccess: options.signOutAccess,
    systemDb: authSystemDb,
  });
}

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady: Promise<void> = appDatabase.ready;

/** Framework construction token; it is not callable and has no raw/native database properties. */
export const appRuntimeDbProvider = appDatabase.db;
