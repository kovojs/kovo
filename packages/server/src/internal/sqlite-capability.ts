import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from '../security-witness-intrinsics.js';

const sqliteSystemDbBrand: unique symbol = Symbol('kovo.sqlite-system-db');
const sqliteSystemDbValues = createWitnessWeakMap<KovoSqliteSystemDb, BetterSQLite3Database>();
const sqliteAppRuntimeSystemDbs = createWitnessWeakMap<object, KovoSqliteSystemDb>();

/**
 * Opaque framework-owned SQLite system-write database capability.
 *
 * This dedicated package entry is the single mint/consume registry for packed public and internal
 * bundles. It intentionally uses a module-private WeakMap, never Symbol.for/global state (SPEC
 * §6.6/§10.3 C9).
 */
export interface KovoSqliteSystemDb {
  readonly [sqliteSystemDbBrand]: {
    readonly scope: 'sqlite-system-write-db';
  };
}

/** @internal Mint one SQLite system capability for a framework-owned raw database. */
export function createSqliteSystemDb(db: BetterSQLite3Database): KovoSqliteSystemDb {
  const capability = witnessFreeze({
    [sqliteSystemDbBrand]: witnessFreeze({ scope: 'sqlite-system-write-db' as const }),
  });
  witnessWeakMapSet(sqliteSystemDbValues, capability, db);
  return capability;
}

/** @internal Consume an opaque SQLite system capability inside a reviewed first-party sink. */
export function useSqliteSystemDb<Result>(
  capability: KovoSqliteSystemDb,
  use: (db: BetterSQLite3Database) => Result,
): Result {
  const db = witnessWeakMapGet(sqliteSystemDbValues, capability);
  if (db === undefined) {
    throw new Error(
      'KV414: invalid SQLite system DB capability; generated integrations must use sqliteSystemDbForGeneratedIntegration(...) (SPEC §10.3).',
    );
  }
  return witnessReflectApply<Result>(use, undefined, [db]);
}

/** @internal Bind an exact SQLite app-runtime token to its private integration capability. */
export function registerSqliteAppRuntimeSystemDb(
  runtime: object,
  capability: KovoSqliteSystemDb,
): void {
  witnessWeakMapSet(sqliteAppRuntimeSystemDbs, runtime, capability);
}

/** @internal Recover a system capability only from an exact framework-minted SQLite runtime. */
export function sqliteSystemDbForAppRuntime(runtime: object): KovoSqliteSystemDb {
  const capability = witnessWeakMapGet(sqliteAppRuntimeSystemDbs, runtime);
  if (capability === undefined) {
    throw new Error(
      'KV414: invalid SQLite app runtime; use createSqliteAppRuntime() before generated integration wiring (SPEC §10.3).',
    );
  }
  return capability;
}
