import {
  createPostgresAppRuntimeDb,
  declareSecretReadCapability,
  type KovoPostgresAppRuntimeDb,
  type KovoPostgresAppRuntimeOptions,
} from '@kovojs/server';

import * as schema from '../schema.js';
import type { AppDb, AppReadonlyDb } from '../db.js';

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
  schema,
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
      const value = load()[property];
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

/** Framework-owned auth adapter DB. RLS-subject system posture, not a raw superuser handle. */
export const appRuntimeAuthDb: AppDb = lazyAppDatabaseValue(() =>
  getAppDatabase().systemDb({
    operation: 'write',
    reason: 'Better Auth adapter manages session tables before an app session exists',
    surface: 'src/auth.ts',
  }),
);

/** Read-only app DB value re-exported by src/db.ts for endpoint/user-authored reads. */
export const appRuntimeReadonlyDb: AppReadonlyDb = lazyAppDatabaseValue(
  () => getAppDatabase().readonlyDb,
);
export const appRuntimeDbReady: Promise<void> = lazyPromise(() => getAppDatabase().ready);

/** Framework construction/auth adapter hook; do not import this into endpoint/webhook/task code. */
export function appRuntimeDbProvider(request?: unknown): AppDb {
  return getAppDatabase().db(request);
}
