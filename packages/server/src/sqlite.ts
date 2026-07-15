import './security-bootstrap.js';

import { createRequire } from 'node:module';
import {
  DatabaseSync as NodeSqliteDatabaseSync,
  constants as nodeSqliteConstants,
} from 'node:sqlite';
import { types as nodeUtilTypes } from 'node:util';

import Database from 'better-sqlite3';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

import {
  createSqliteSystemDb,
  type KovoSqliteSystemDb,
} from '@kovojs/server/internal/sqlite-capability';
import { runtimeEnvironmentValue } from '@kovojs/server/internal/runtime-environment';

import { snapshotAuditReason, snapshotAuditText } from './audit-justification.js';
import { createFrameworkManagedDbProvider, type FrameworkManagedDbProvider } from './guards.js';
import type {
  DeclaredWriteSqliteAuthorizerConstants,
  DeclaredWriteSqliteAuthorizerDatabase,
  Reader,
} from './managed-db.js';
import { createMemoryMutationReplayStore, type MutationReplayStore } from './replay.js';
import {
  securityArrayJoin,
  securityNumberIsFinite,
  securityNumberIsInteger,
  securityPromiseResolve,
  securityString,
  securityStringIncludes,
  securityStringReplaceAll,
} from './response-security-intrinsics.js';
import {
  createWitnessSet,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetPrototypeOf,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessObjectIs,
  witnessOwnKeys,
  witnessReflectApply,
  witnessReflectConstruct,
  witnessSetAdd,
  witnessSetHas,
  witnessSortStrings,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  createSqliteAppRuntimeDb,
  runtimeDbMetadataForSchema,
  type KovoSqliteAppRuntimeMetadata,
} from './sqlite-runtime.js';
import { registerFrameworkSqliteTransactionFacade } from './sql-safe-handle.js';

export type { KovoSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';

type SqliteTable = Parameters<typeof getTableConfig>[0];
type SqliteTableConfig = ReturnType<typeof getTableConfig>;
type SqliteColumn = SqliteTableConfig['columns'][number];
type SqliteForeignKey = SqliteTableConfig['foreignKeys'][number];

const sqliteIsProxy = nodeUtilTypes.isProxy;
const sqliteNodeDatabaseSync = NodeSqliteDatabaseSync;
const sqliteNodeDatabaseExec = NodeSqliteDatabaseSync.prototype.exec;
const sqliteNodeDatabaseClose = NodeSqliteDatabaseSync.prototype.close;
const sqliteNodeDatabasePrepare = NodeSqliteDatabaseSync.prototype.prepare;
const sqliteNodeDatabaseSetAuthorizer = NodeSqliteDatabaseSync.prototype.setAuthorizer;
const sqliteConsole = console;
const sqliteConsoleWarn = console.warn;
const sqliteDatabaseErrorConstructor = Database.SqliteError;
const sqliteModuleRequire = createRequire(import.meta.url);
const sqliteNativeBinding = sqliteModuleRequire.resolve(
  'better-sqlite3/build/Release/better_sqlite3.node',
);
const sqliteAuthorizerConstants = witnessFreeze({
  SQLITE_ALTER_TABLE: nodeSqliteConstants.SQLITE_ALTER_TABLE,
  SQLITE_ATTACH: nodeSqliteConstants.SQLITE_ATTACH,
  SQLITE_CREATE_INDEX: nodeSqliteConstants.SQLITE_CREATE_INDEX,
  SQLITE_CREATE_TABLE: nodeSqliteConstants.SQLITE_CREATE_TABLE,
  SQLITE_CREATE_TEMP_INDEX: nodeSqliteConstants.SQLITE_CREATE_TEMP_INDEX,
  SQLITE_CREATE_TEMP_TABLE: nodeSqliteConstants.SQLITE_CREATE_TEMP_TABLE,
  SQLITE_CREATE_TEMP_TRIGGER: nodeSqliteConstants.SQLITE_CREATE_TEMP_TRIGGER,
  SQLITE_CREATE_TEMP_VIEW: nodeSqliteConstants.SQLITE_CREATE_TEMP_VIEW,
  SQLITE_CREATE_TRIGGER: nodeSqliteConstants.SQLITE_CREATE_TRIGGER,
  SQLITE_CREATE_VIEW: nodeSqliteConstants.SQLITE_CREATE_VIEW,
  SQLITE_CREATE_VTABLE: nodeSqliteConstants.SQLITE_CREATE_VTABLE,
  SQLITE_DELETE: nodeSqliteConstants.SQLITE_DELETE,
  SQLITE_DENY: nodeSqliteConstants.SQLITE_DENY,
  SQLITE_DETACH: nodeSqliteConstants.SQLITE_DETACH,
  SQLITE_DROP_INDEX: nodeSqliteConstants.SQLITE_DROP_INDEX,
  SQLITE_DROP_TABLE: nodeSqliteConstants.SQLITE_DROP_TABLE,
  SQLITE_DROP_TEMP_INDEX: nodeSqliteConstants.SQLITE_DROP_TEMP_INDEX,
  SQLITE_DROP_TEMP_TABLE: nodeSqliteConstants.SQLITE_DROP_TEMP_TABLE,
  SQLITE_DROP_TEMP_TRIGGER: nodeSqliteConstants.SQLITE_DROP_TEMP_TRIGGER,
  SQLITE_DROP_TEMP_VIEW: nodeSqliteConstants.SQLITE_DROP_TEMP_VIEW,
  SQLITE_DROP_TRIGGER: nodeSqliteConstants.SQLITE_DROP_TRIGGER,
  SQLITE_DROP_VIEW: nodeSqliteConstants.SQLITE_DROP_VIEW,
  SQLITE_DROP_VTABLE: nodeSqliteConstants.SQLITE_DROP_VTABLE,
  SQLITE_INSERT: nodeSqliteConstants.SQLITE_INSERT,
  SQLITE_OK: nodeSqliteConstants.SQLITE_OK,
  SQLITE_PRAGMA: nodeSqliteConstants.SQLITE_PRAGMA,
  SQLITE_READ: nodeSqliteConstants.SQLITE_READ,
  SQLITE_REINDEX: nodeSqliteConstants.SQLITE_REINDEX,
  SQLITE_UPDATE: nodeSqliteConstants.SQLITE_UPDATE,
} satisfies DeclaredWriteSqliteAuthorizerConstants);

const SQLITE_MAX_TABLES = 256;
const SQLITE_MAX_COLUMNS_PER_TABLE = 1_024;
const SQLITE_MAX_TOTAL_COLUMNS = 4_096;
const SQLITE_MAX_FOREIGN_KEYS_PER_TABLE = 1_024;
const SQLITE_MAX_TOTAL_FOREIGN_KEYS = 4_096;
const SQLITE_MAX_SEED_ROWS = 10_000;
const SQLITE_MAX_SEED_CELLS = 100_000;
const SQLITE_RUNTIME_WARNING =
  'Kovo SQLite starter is experimental and single-principal only: SQLite has no engine role/RLS layer, so Kovo owner scoping is not enforced. Use the default PGlite/Postgres runtime for multi-tenant authorization.';
let sqliteRuntimeWarningPrinted = false;

/** A primitive accepted by the parameterized SQLite starter seed path. */
export type KovoSqliteSeedValue = string | number | bigint | boolean | null;

/** One table plus rows inserted through the framework-owned parameterized seed sink. */
export interface KovoSqliteSeed {
  /** A table present in the exact `tables` array passed to the runtime constructor. */
  table: unknown;
  /** Dense own-data rows keyed by physical SQLite column name. */
  rows: readonly Readonly<Record<string, KovoSqliteSeedValue>>[];
}

/** Options for the experimental single-principal SQLite app runtime. */
export interface KovoSqliteAppRuntimeOptions {
  /** Structured seed data; raw DDL/SQL is intentionally not an accepted authority. */
  seed?: readonly KovoSqliteSeed[];
  /** Exact Drizzle SQLite tables used for DDL and compiler-bound security metadata. */
  tables: readonly unknown[];
}

/** Opaque provider accepted by `createApp({ db })` without exposing raw Drizzle methods. */
export type KovoSqliteDbProvider = FrameworkManagedDbProvider<BetterSQLite3Database>;

/** Frozen handles produced by the experimental single-principal SQLite runtime. */
export interface KovoSqliteAppRuntime {
  /** Close the framework-owned in-memory native client. */
  close(): void;
  /** Opaque framework provider token. It is not callable and has no raw/native DB properties. */
  readonly db: KovoSqliteDbProvider;
  /** Volatile development-only mutation replay truth. Production rejects it. */
  readonly mutationReplayStore: MutationReplayStore;
  /** Read-only query/endpoint database with SQLite secret boxing applied. */
  readonly readonlyDb: Reader<BetterSQLite3Database>;
  /** SQLite setup is synchronous; this promise preserves the starter's uniform boot shape. */
  readonly ready: Promise<void>;
  /** Mint a system-write capability for one reviewed first-party integration such as Better Auth. */
  systemDb(options: { operation: 'write'; reason: string; surface: string }): KovoSqliteSystemDb;
}

interface SqliteColumnSnapshot {
  readonly defaultDdl: string;
  readonly name: string;
  readonly notNull: boolean;
  readonly primary: boolean;
  readonly typeDdl: string;
  readonly unique: boolean;
}

interface SqliteForeignKeySnapshot {
  readonly foreignColumns: readonly string[];
  readonly foreignTable: string;
  readonly localColumns: readonly string[];
  readonly onDelete?: string;
  readonly onUpdate?: string;
}

interface SqliteTableSnapshot {
  readonly columns: readonly SqliteColumnSnapshot[];
  readonly foreignKeys: readonly SqliteForeignKeySnapshot[];
  readonly name: string;
  readonly table: SqliteTable;
}

interface SqliteTableDraft {
  readonly columns: readonly SqliteColumnSnapshot[];
  readonly config: SqliteTableConfig;
  readonly foreignKeys: readonly SqliteForeignKey[];
  readonly name: string;
  readonly rawColumns: readonly SqliteColumn[];
  readonly table: SqliteTable;
}

interface SqliteColumnIdentity {
  readonly column: SqliteColumnSnapshot;
  readonly table: SqliteTableDraft;
}

interface SqliteSeedRowSnapshot {
  readonly columns: readonly string[];
  readonly values: readonly KovoSqliteSeedValue[];
}

interface SqliteSeedSnapshot {
  readonly rows: readonly SqliteSeedRowSnapshot[];
  readonly table: SqliteTableSnapshot;
}

interface SqliteNativeDriverControls {
  readonly databaseClose: Function;
  readonly databaseConstructor: Function;
  readonly databaseExec: Function;
  readonly databasePrepare: Function;
  readonly databasePrototype: object;
  readonly statementAll: Function;
  readonly statementColumns: Function;
  readonly statementGet: Function;
  readonly statementRaw: Function;
  readonly statementRun: Function;
  readonly statementPrototype: object;
}

interface SqlitePinnedStatement {
  all(...params: unknown[]): unknown;
  columns(): unknown;
  get(...params: unknown[]): unknown;
  raw(toggleState?: boolean): SqlitePinnedStatement;
  run(...params: unknown[]): unknown;
}

interface SqlitePinnedTransaction {
  readonly default: (...params: unknown[]) => unknown;
  readonly deferred: (...params: unknown[]) => unknown;
  readonly exclusive: (...params: unknown[]) => unknown;
  readonly immediate: (...params: unknown[]) => unknown;
}

interface SqlitePinnedClient {
  prepare(sql: string): SqlitePinnedStatement;
  transaction(callback: Function): SqlitePinnedTransaction;
}

interface SqliteTransactionStatements {
  readonly begin: SqlitePinnedStatement;
  readonly beginDeferred: SqlitePinnedStatement;
  readonly beginExclusive: SqlitePinnedStatement;
  readonly beginImmediate: SqlitePinnedStatement;
  readonly commit: SqlitePinnedStatement;
  readonly release: SqlitePinnedStatement;
  readonly rollback: SqlitePinnedStatement;
  readonly rollbackTo: SqlitePinnedStatement;
  readonly savepoint: SqlitePinnedStatement;
}

// SPEC §6.6 rule 6: capture the exact native driver constructors and finite method controls while
// the framework SQLite module is evaluating, before any importing authored module body can run.
// This loads and pins the addon only; database authority is still created later, after compiler
// metadata and authored table snapshots have been validated by createSqliteAppRuntime().
const sqliteNativeDriverControls = pinSqliteNativeDriverControls();

/**
 * Create the opt-in SQLite starter runtime without giving generated source filesystem, native
 * driver, raw SQL, or database-construction authority.
 *
 * Compiler-bound metadata authenticates the exact table identities before any additional Drizzle
 * schema callback, filesystem operation, or native database creation. The framework then derives a
 * finite SQLite DDL subset and inserts optional seed rows with bound parameters. SQLite remains
 * single-principal/local-development only; this constructor does not claim an engine authorization
 * or confidentiality boundary (SPEC §6.6/§10.3).
 */
export function createSqliteAppRuntime(
  options: KovoSqliteAppRuntimeOptions,
): Readonly<KovoSqliteAppRuntime> {
  if (runtimeEnvironmentValue('NODE_ENV') === 'production') {
    throw new Error(
      'KV414: the single-principal SQLite starter must not boot in production; use the Postgres runtime for engine authorization and confidentiality (SPEC §10.3).',
    );
  }
  const source = snapshotOptions(options);
  const tableValues = snapshotTableIdentities(requiredOption(source, 'tables'));

  // SPEC §6.6/§10.3 C9: this is the compiler-bound authorization witness. It must run before the
  // second Drizzle config extraction below (which may evaluate authored FK/extra-config callbacks)
  // and before native database authority is created.
  const metadata = runtimeDbMetadataForSchema(tableValues);
  // Reuse the package-owned module-evaluation snapshot; do not discover native controls after any
  // importing authored module body has had an opportunity to mutate the shared addon/prototypes.
  // The in-memory database itself is still created only after the schema snapshot below.
  const nativeControls = sqliteNativeDriverControls;
  const tables = snapshotTables(tableValues, metadata);
  const seeds = snapshotSeeds(optionalOption(source, 'seed'), tables);
  const schemaDdl: string[] = [];
  for (let index = 0; index < tables.length; index += 1) {
    witnessArrayAppend(
      schemaDdl,
      sqliteCreateTableDdl(tables[index]!),
      'SQLite runtime schema DDL',
    );
  }
  const authorizerSchemaDdl = witnessFreeze(schemaDdl);

  warnExperimentalSqliteRuntime();

  let nativeDatabase: object | undefined;
  try {
    // Construct the exact native addon directly. The public better-sqlite3 wrapper consults mutable
    // String/Buffer/fs helpers after authored callbacks and would re-open a path authority channel.
    nativeDatabase = witnessReflectConstruct(nativeControls.databaseConstructor, [
      ':memory:',
      ':memory:',
      true,
      false,
      false,
      5_000,
      null,
      null,
    ]);
    assertSqliteNativeDatabase(nativeDatabase, nativeControls);
    const client = createPinnedSqliteClient(nativeDatabase, nativeControls);
    const transactionDatabase = nativeDatabase;
    registerFrameworkSqliteTransactionFacade(
      client,
      transactionDatabase,
      nativeControls.databaseExec,
      () => sqliteNativeDatabaseInTransaction(transactionDatabase),
    );
    witnessReflectApply(nativeControls.databaseExec, nativeDatabase, [
      'PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;',
    ]);
    for (let index = 0; index < authorizerSchemaDdl.length; index += 1) {
      witnessReflectApply(nativeControls.databaseExec, nativeDatabase, [
        authorizerSchemaDdl[index]!,
      ]);
    }
    seedSqliteTables(client, seeds);

    // Drizzle's declared type names the full public driver, but its adapter uses only this pinned
    // prepare/transaction surface. Reflective invocation keeps that finite runtime boundary honest
    // without casting the façade into a broader raw-driver type.
    const db = witnessReflectApply<BetterSQLite3Database>(drizzle, undefined, [{ client }]);
    const tableNames = createWitnessWeakMap<object, readonly string[]>();
    for (let index = 0; index < tables.length; index += 1) {
      const table = tables[index]!;
      witnessWeakMapSet(tableNames, table.table, witnessFreeze([normalizePolicyTable(table.name)]));
    }
    const runtime = createSqliteAppRuntimeDb({
      db,
      metadata,
      normalizeTableName: normalizePolicyTable,
      sqliteAuthorizer: {
        constants: sqliteAuthorizerConstants,
        openDatabase: () => {
          const authorizerDatabase = new sqliteNodeDatabaseSync(':memory:');
          try {
            witnessReflectApply(sqliteNodeDatabaseExec, authorizerDatabase, [
              'PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;',
            ]);
            for (let index = 0; index < authorizerSchemaDdl.length; index += 1) {
              witnessReflectApply(sqliteNodeDatabaseExec, authorizerDatabase, [
                authorizerSchemaDdl[index]!,
              ]);
            }
            // SPEC §6.6/§10.3 C9: app callbacks run before this clone opens and can mutate the
            // public node:sqlite prototype. Keep the raw handle private and expose only frozen
            // methods that dispatch through the bootstrap-captured native controls.
            return witnessFreeze({
              close(): void {
                witnessReflectApply(sqliteNodeDatabaseClose, authorizerDatabase, []);
              },
              prepare(statement: string): unknown {
                return witnessReflectApply(sqliteNodeDatabasePrepare, authorizerDatabase, [
                  statement,
                ]);
              },
              setAuthorizer(
                callback: Parameters<DeclaredWriteSqliteAuthorizerDatabase['setAuthorizer']>[0],
              ): void {
                witnessReflectApply(sqliteNodeDatabaseSetAuthorizer, authorizerDatabase, [
                  callback,
                ]);
              },
            });
          } catch (error) {
            witnessReflectApply(sqliteNodeDatabaseClose, authorizerDatabase, []);
            throw error;
          }
        },
      },
      sqliteColumnOrigins: client,
      tableNames(table) {
        if ((typeof table !== 'object' && typeof table !== 'function') || table === null) {
          throw new Error(
            'KV406: SQLite declared-write table must be one of the runtime schema tables (SPEC §10.3/§11.2).',
          );
        }
        const names = witnessWeakMapGet(tableNames, table);
        if (names === undefined) {
          throw new Error(
            'KV406: SQLite declared-write table is outside the runtime schema (SPEC §10.3/§11.2).',
          );
        }
        return names;
      },
    });
    const dbProvider = createFrameworkManagedDbProvider<globalThis.Request, BetterSQLite3Database>(
      () => runtime.providerDb,
    );
    const mutationReplayStore = createMemoryMutationReplayStore();
    const systemDb = createSqliteSystemDb(db);
    let closed = false;

    return witnessFreeze({
      close(): void {
        if (closed) return;
        closed = true;
        const closingDatabase = nativeDatabase;
        nativeDatabase = undefined;
        if (closingDatabase !== undefined) {
          witnessReflectApply(nativeControls.databaseClose, closingDatabase, []);
        }
      },
      db: dbProvider,
      mutationReplayStore,
      readonlyDb: runtime.readonlyDb,
      ready: securityPromiseResolve(undefined),
      systemDb(systemOptions): KovoSqliteSystemDb {
        snapshotSystemDbOptions(systemOptions);
        return systemDb;
      },
    });
  } catch (error) {
    if (nativeDatabase !== undefined) {
      witnessReflectApply(nativeControls.databaseClose, nativeDatabase, []);
    }
    throw error;
  }
}

function pinSqliteNativeDriverControls(): Readonly<SqliteNativeDriverControls> {
  const addonValue: unknown = sqliteModuleRequire(sqliteNativeBinding);
  if (typeof addonValue !== 'object' || addonValue === null || sqliteIsProxy(addonValue)) {
    throw new TypeError('KV414: better-sqlite3 native addon must be an exact object.');
  }
  const databaseConstructor = stableOwnDataFunction(
    addonValue,
    'Database',
    'better-sqlite3 native Database constructor',
  );
  const statementConstructor = stableOwnDataFunction(
    addonValue,
    'Statement',
    'better-sqlite3 native Statement constructor',
  );
  const databasePrototype = stableOwnDataObject(
    databaseConstructor,
    'prototype',
    'better-sqlite3 native Database prototype',
  );
  const statementPrototype = stableOwnDataObject(
    statementConstructor,
    'prototype',
    'better-sqlite3 native Statement prototype',
  );
  const controls = witnessFreeze({
    databaseClose: stableOwnDataFunction(
      databasePrototype,
      'close',
      'better-sqlite3 native Database.close',
    ),
    databaseConstructor,
    databaseExec: stableOwnDataFunction(
      databasePrototype,
      'exec',
      'better-sqlite3 native Database.exec',
    ),
    databasePrepare: stableOwnDataFunction(
      databasePrototype,
      'prepare',
      'better-sqlite3 native Database.prepare',
    ),
    databasePrototype,
    statementAll: stableOwnDataFunction(
      statementPrototype,
      'all',
      'better-sqlite3 native Statement.all',
    ),
    statementColumns: stableOwnDataFunction(
      statementPrototype,
      'columns',
      'better-sqlite3 native Statement.columns',
    ),
    statementGet: stableOwnDataFunction(
      statementPrototype,
      'get',
      'better-sqlite3 native Statement.get',
    ),
    statementRaw: stableOwnDataFunction(
      statementPrototype,
      'raw',
      'better-sqlite3 native Statement.raw',
    ),
    statementRun: stableOwnDataFunction(
      statementPrototype,
      'run',
      'better-sqlite3 native Statement.run',
    ),
    statementPrototype,
  } satisfies SqliteNativeDriverControls);

  const initialized = optionalStableOwnDataValue(
    addonValue,
    'isInitialized',
    'better-sqlite3 native addon initialization flag',
  );
  if (initialized !== true) {
    if (initialized !== undefined && initialized !== false) {
      throw new TypeError('KV414: better-sqlite3 native addon initialization flag is invalid.');
    }
    const setErrorConstructor = stableOwnDataFunction(
      addonValue,
      'setErrorConstructor',
      'better-sqlite3 native error constructor control',
    );
    witnessReflectApply(setErrorConstructor, addonValue, [sqliteDatabaseErrorConstructor]);
    witnessDefineProperty(addonValue, 'isInitialized', {
      configurable: true,
      enumerable: true,
      value: true,
      writable: true,
    });
  }
  if (
    stableOwnDataValue(
      addonValue,
      'isInitialized',
      'better-sqlite3 native addon initialization flag',
    ) !== true
  ) {
    throw new TypeError('KV414: better-sqlite3 native addon did not initialize safely.');
  }

  // Lock constructor-to-prototype identity before authored callbacks run. Method bodies remain
  // usable by other package consumers, while every Kovo dispatch below uses the captured controls.
  witnessFreeze(databaseConstructor);
  witnessFreeze(statementConstructor);
  pinOptionalSqliteNativeConstructor(addonValue, 'StatementIterator');
  pinOptionalSqliteNativeConstructor(addonValue, 'Backup');
  witnessFreeze(addonValue);
  return controls;
}

function pinOptionalSqliteNativeConstructor(addon: object, property: PropertyKey): void {
  const value = optionalStableOwnDataValue(
    addon,
    property,
    `better-sqlite3 native ${String(property)} constructor`,
  );
  if (value === undefined) return;
  if (typeof value !== 'function') {
    throw new TypeError(`KV414: better-sqlite3 native ${String(property)} must be a function.`);
  }
  witnessFreeze(value);
}

function assertSqliteNativeDatabase(
  database: object,
  controls: Readonly<SqliteNativeDriverControls>,
): void {
  if (
    sqliteIsProxy(database) ||
    !witnessObjectIs(witnessGetPrototypeOf(database), controls.databasePrototype) ||
    stableOwnDataValue(database, 'memory', 'better-sqlite3 native Database.memory') !== true ||
    stableOwnDataValue(database, 'readonly', 'better-sqlite3 native Database.readonly') !== false ||
    stableOwnDataValue(database, 'open', 'better-sqlite3 native Database.open') !== true ||
    stableOwnDataValue(database, 'name', 'better-sqlite3 native Database.name') !== ':memory:'
  ) {
    throw new TypeError(
      'KV414: better-sqlite3 did not create the exact in-memory native database.',
    );
  }
}

function createPinnedSqliteClient(
  database: object,
  controls: Readonly<SqliteNativeDriverControls>,
): Readonly<SqlitePinnedClient> {
  let transactionStatements: Readonly<SqliteTransactionStatements> | undefined;
  let client: Readonly<SqlitePinnedClient>;
  const prepare = (sql: string): SqlitePinnedStatement => {
    if (typeof sql !== 'string') throw new TypeError('SQLite prepare text must be a string.');
    const statement = witnessReflectApply<unknown>(controls.databasePrepare, database, [
      sql,
      client,
      false,
    ]);
    if (
      typeof statement !== 'object' ||
      statement === null ||
      sqliteIsProxy(statement) ||
      !witnessObjectIs(witnessGetPrototypeOf(statement), controls.statementPrototype)
    ) {
      throw new TypeError('KV414: better-sqlite3 prepare returned an invalid native statement.');
    }
    return createPinnedSqliteStatement(statement, controls);
  };
  const statements = (): Readonly<SqliteTransactionStatements> => {
    if (transactionStatements !== undefined) return transactionStatements;
    transactionStatements = witnessFreeze({
      begin: prepare('BEGIN'),
      beginDeferred: prepare('BEGIN DEFERRED'),
      beginExclusive: prepare('BEGIN EXCLUSIVE'),
      beginImmediate: prepare('BEGIN IMMEDIATE'),
      commit: prepare('COMMIT'),
      release: prepare('RELEASE SAVEPOINT "kovo.runtime.transaction"'),
      rollback: prepare('ROLLBACK'),
      rollbackTo: prepare('ROLLBACK TO SAVEPOINT "kovo.runtime.transaction"'),
      savepoint: prepare('SAVEPOINT "kovo.runtime.transaction"'),
    } satisfies SqliteTransactionStatements);
    return transactionStatements;
  };
  client = witnessFreeze({
    prepare,
    transaction(callback: Function): SqlitePinnedTransaction {
      if (typeof callback !== 'function') {
        throw new TypeError('SQLite transaction callback must be a function.');
      }
      return createPinnedSqliteTransaction(database, callback, statements);
    },
  } satisfies SqlitePinnedClient);
  return client;
}

function createPinnedSqliteStatement(
  statement: object,
  controls: Readonly<SqliteNativeDriverControls>,
): Readonly<SqlitePinnedStatement> {
  let facade: Readonly<SqlitePinnedStatement>;
  facade = witnessFreeze({
    all(...params: unknown[]): unknown {
      return witnessReflectApply(controls.statementAll, statement, params);
    },
    columns(): unknown {
      return witnessReflectApply(controls.statementColumns, statement, []);
    },
    get(...params: unknown[]): unknown {
      return witnessReflectApply(controls.statementGet, statement, params);
    },
    raw(toggleState?: boolean): SqlitePinnedStatement {
      if (toggleState === undefined) {
        witnessReflectApply(controls.statementRaw, statement, []);
      } else {
        witnessReflectApply(controls.statementRaw, statement, [toggleState]);
      }
      return facade;
    },
    run(...params: unknown[]): unknown {
      return witnessReflectApply(controls.statementRun, statement, params);
    },
  } satisfies SqlitePinnedStatement);
  return facade;
}

function createPinnedSqliteTransaction(
  database: object,
  callback: Function,
  statements: () => Readonly<SqliteTransactionStatements>,
): Readonly<SqlitePinnedTransaction> {
  return witnessFreeze({
    default(this: unknown, ...params: unknown[]): unknown {
      return runPinnedSqliteTransaction(database, callback, this, params, 'default', statements());
    },
    deferred(this: unknown, ...params: unknown[]): unknown {
      return runPinnedSqliteTransaction(database, callback, this, params, 'deferred', statements());
    },
    exclusive(this: unknown, ...params: unknown[]): unknown {
      return runPinnedSqliteTransaction(
        database,
        callback,
        this,
        params,
        'exclusive',
        statements(),
      );
    },
    immediate(this: unknown, ...params: unknown[]): unknown {
      return runPinnedSqliteTransaction(
        database,
        callback,
        this,
        params,
        'immediate',
        statements(),
      );
    },
  } satisfies SqlitePinnedTransaction);
}

function runPinnedSqliteTransaction(
  database: object,
  callback: Function,
  callbackThis: unknown,
  params: readonly unknown[],
  behavior: 'default' | 'deferred' | 'exclusive' | 'immediate',
  statements: Readonly<SqliteTransactionStatements>,
): unknown {
  const nested = sqliteNativeDatabaseInTransaction(database);
  const before = nested
    ? statements.savepoint
    : behavior === 'exclusive'
      ? statements.beginExclusive
      : behavior === 'immediate'
        ? statements.beginImmediate
        : behavior === 'deferred'
          ? statements.beginDeferred
          : statements.begin;
  const after = nested ? statements.release : statements.commit;
  const undo = nested ? statements.rollbackTo : statements.rollback;
  runPinnedSqliteStatement(before);
  try {
    const result = witnessReflectApply<unknown>(callback, callbackThis, params);
    assertSynchronousSqliteTransactionResult(result);
    runPinnedSqliteStatement(after);
    return result;
  } catch (error) {
    if (sqliteNativeDatabaseInTransaction(database)) {
      runPinnedSqliteStatement(undo);
      if (nested) runPinnedSqliteStatement(statements.release);
    }
    throw error;
  }
}

function runPinnedSqliteStatement(statement: SqlitePinnedStatement): void {
  const run = stableOwnDataFunction(statement, 'run', 'pinned SQLite transaction statement.run');
  witnessReflectApply(run, statement, []);
}

function sqliteNativeDatabaseInTransaction(database: object): boolean {
  const value = stableOwnDataValue(
    database,
    'inTransaction',
    'better-sqlite3 native Database.inTransaction',
  );
  if (typeof value !== 'boolean') {
    throw new TypeError('KV414: better-sqlite3 transaction state is invalid.');
  }
  return value;
}

function assertSynchronousSqliteTransactionResult(result: unknown): void {
  if ((typeof result !== 'object' && typeof result !== 'function') || result === null) return;
  if (sqliteIsProxy(result)) {
    throw new TypeError('SQLite transaction callback must not return a Proxy or Promise.');
  }
  let owner: object | null = result;
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const before = witnessGetOwnPropertyDescriptor(owner, 'then');
    const after = witnessGetOwnPropertyDescriptor(owner, 'then');
    if (before !== undefined || after !== undefined) {
      if (
        before === undefined ||
        after === undefined ||
        !('value' in before) ||
        !('value' in after) ||
        !witnessObjectIs(before.value, after.value)
      ) {
        throw new TypeError('SQLite transaction callback result.then must be stable own data.');
      }
      if (typeof before.value === 'function') {
        throw new TypeError('SQLite transaction callback must not return a Promise.');
      }
      return;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  if (owner !== null) {
    throw new TypeError('SQLite transaction callback result prototype chain is too deep.');
  }
}

function snapshotOptions(options: KovoSqliteAppRuntimeOptions): Record<string, unknown> {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('SQLite runtime options must be an own-data object.');
  }
  return snapshotOwnDataRecord(options, 'SQLite runtime options');
}

function requiredOption(source: Record<string, unknown>, property: 'tables'): unknown {
  const value = source[property];
  if (value === undefined) throw new TypeError(`SQLite runtime option ${property} is required.`);
  return value;
}

function optionalOption(source: Record<string, unknown>, property: 'seed'): unknown {
  return source[property];
}

function snapshotTableIdentities(value: unknown): readonly SqliteTable[] {
  const entries = snapshotDenseArray(value, 'SQLite runtime tables', SQLITE_MAX_TABLES);
  if (entries.length === 0) throw new TypeError('SQLite runtime requires at least one table.');
  const seen = createWitnessSet<object>();
  const tables: SqliteTable[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if ((typeof entry !== 'object' && typeof entry !== 'function') || entry === null) {
      throw new TypeError('SQLite runtime tables must contain Drizzle SQLite table objects.');
    }
    if (sqliteIsProxy(entry)) throw new TypeError('SQLite runtime tables must not be Proxies.');
    if (witnessSetHas(seen, entry)) throw new TypeError('SQLite runtime tables must be unique.');
    witnessSetAdd(seen, entry);
    witnessArrayAppend(tables, entry as SqliteTable, 'SQLite runtime table identity snapshot');
  }
  return witnessFreeze(tables);
}

function snapshotTables(
  values: readonly SqliteTable[],
  metadata: KovoSqliteAppRuntimeMetadata,
): readonly SqliteTableSnapshot[] {
  const drafts: SqliteTableDraft[] = [];
  const tableIdentities = createWitnessWeakMap<object, SqliteTableDraft>();
  const columnIdentities = createWitnessWeakMap<object, SqliteColumnIdentity>();
  const tableNames = createWitnessSet<string>();
  let totalColumns = 0;
  let totalForeignKeys = 0;

  for (let index = 0; index < values.length; index += 1) {
    const table = values[index]!;
    let config: SqliteTableConfig;
    try {
      config = witnessReflectApply<SqliteTableConfig>(getTableConfig, undefined, [table]);
    } catch {
      throw new TypeError('SQLite runtime tables must contain Drizzle SQLite table objects.');
    }
    if (sqliteIsProxy(config)) throw new TypeError('SQLite table config must not be a Proxy.');
    const name = stableOwnDataValue(config, 'name', 'SQLite table config.name');
    sqliteIdentifier(name, 'table');
    if (witnessSetHas(tableNames, name)) {
      throw new TypeError(`SQLite runtime table name ${name} is duplicated.`);
    }
    witnessSetAdd(tableNames, name);
    rejectNonEmptyConfigArray(config, 'indexes', name);
    rejectNonEmptyConfigArray(config, 'checks', name);
    rejectNonEmptyConfigArray(config, 'primaryKeys', name);
    rejectNonEmptyConfigArray(config, 'uniqueConstraints', name);

    const rawColumns = snapshotDenseArray(
      stableOwnDataValue(config, 'columns', `SQLite table ${name}.columns`),
      `SQLite table ${name}.columns`,
      SQLITE_MAX_COLUMNS_PER_TABLE,
    );
    if (rawColumns.length === 0) {
      throw new TypeError(`SQLite runtime table ${name} must contain at least one column.`);
    }
    totalColumns += rawColumns.length;
    if (totalColumns > SQLITE_MAX_TOTAL_COLUMNS) {
      throw new TypeError(
        `SQLite runtime schemas may contain at most ${SQLITE_MAX_TOTAL_COLUMNS} total columns.`,
      );
    }
    const columns: SqliteColumnSnapshot[] = [];
    const rawColumnObjects: SqliteColumn[] = [];
    const columnNames = createWitnessSet<string>();
    for (let columnIndex = 0; columnIndex < rawColumns.length; columnIndex += 1) {
      const rawColumn = rawColumns[columnIndex];
      if (typeof rawColumn !== 'object' || rawColumn === null || sqliteIsProxy(rawColumn)) {
        throw new TypeError(`SQLite table ${name} contains an invalid column.`);
      }
      const column = snapshotColumn(rawColumn as SqliteColumn, table, name);
      assertCompilerBoundColumn(metadata, rawColumn, column, name);
      if (witnessSetHas(columnNames, column.name)) {
        throw new TypeError(`SQLite runtime column ${name}.${column.name} is duplicated.`);
      }
      witnessSetAdd(columnNames, column.name);
      witnessArrayAppend(columns, column, `SQLite table ${name} column snapshot`);
      witnessArrayAppend(
        rawColumnObjects,
        rawColumn as SqliteColumn,
        `SQLite table ${name} raw column identity snapshot`,
      );
    }
    const rawForeignKeys = snapshotDenseArray(
      stableOwnDataValue(config, 'foreignKeys', `SQLite table ${name}.foreignKeys`),
      `SQLite table ${name}.foreignKeys`,
      SQLITE_MAX_FOREIGN_KEYS_PER_TABLE,
    );
    totalForeignKeys += rawForeignKeys.length;
    if (totalForeignKeys > SQLITE_MAX_TOTAL_FOREIGN_KEYS) {
      throw new TypeError(
        `SQLite runtime schemas may contain at most ${SQLITE_MAX_TOTAL_FOREIGN_KEYS} total foreign keys.`,
      );
    }
    const foreignKeys: SqliteForeignKey[] = [];
    for (let foreignKeyIndex = 0; foreignKeyIndex < rawForeignKeys.length; foreignKeyIndex += 1) {
      const foreignKey = rawForeignKeys[foreignKeyIndex];
      if (typeof foreignKey !== 'object' || foreignKey === null || sqliteIsProxy(foreignKey)) {
        throw new TypeError(`SQLite table ${name} contains an invalid foreign key.`);
      }
      witnessArrayAppend(
        foreignKeys,
        foreignKey as SqliteForeignKey,
        `SQLite table ${name} foreign-key snapshot`,
      );
    }
    const draft = witnessFreeze({
      columns: witnessFreeze(columns),
      config,
      foreignKeys: witnessFreeze(foreignKeys),
      name,
      rawColumns: witnessFreeze(rawColumnObjects),
      table,
    });
    witnessArrayAppend(drafts, draft, 'SQLite table config snapshot');
    witnessWeakMapSet(tableIdentities, table, draft);
    for (let columnIndex = 0; columnIndex < rawColumns.length; columnIndex += 1) {
      witnessWeakMapSet(columnIdentities, rawColumns[columnIndex] as object, {
        column: columns[columnIndex]!,
        table: draft,
      });
    }
  }

  const tables: SqliteTableSnapshot[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    const foreignKeys: SqliteForeignKeySnapshot[] = [];
    for (
      let foreignKeyIndex = 0;
      foreignKeyIndex < draft.foreignKeys.length;
      foreignKeyIndex += 1
    ) {
      witnessArrayAppend(
        foreignKeys,
        snapshotForeignKey(
          draft.foreignKeys[foreignKeyIndex]!,
          draft,
          tableIdentities,
          columnIdentities,
        ),
        `SQLite table ${draft.name} foreign-key DDL snapshot`,
      );
    }
    witnessArrayAppend(
      tables,
      witnessFreeze({
        columns: draft.columns,
        foreignKeys: witnessFreeze(foreignKeys),
        name: draft.name,
        table: draft.table,
      }),
      'SQLite final table snapshot',
    );
  }
  for (let index = 0; index < drafts.length; index += 1) {
    assertCompilerBoundTableStillStable(drafts[index]!, metadata);
  }
  return witnessFreeze(tables);
}

function assertCompilerBoundColumn(
  metadata: KovoSqliteAppRuntimeMetadata,
  rawColumn: unknown,
  column: SqliteColumnSnapshot,
  tableName: string,
): void {
  if (typeof rawColumn !== 'object' || rawColumn === null) {
    throw new TypeError('KV414: SQLite runtime column identity is invalid (SPEC §10.3).');
  }
  const source = witnessMapGet(metadata.columnSources, rawColumn);
  if (source === undefined || source.table !== tableName || source.column !== column.name) {
    throw new TypeError(
      `KV414: SQLite table ${tableName} changed after compiler-bound metadata extraction (SPEC §6.6/§10.3).`,
    );
  }
}

function assertCompilerBoundTableStillStable(
  table: SqliteTableDraft,
  metadata: KovoSqliteAppRuntimeMetadata,
): void {
  const currentName = getTableName(table.table);
  if (currentName !== table.name) {
    throw new TypeError(
      `KV414: SQLite table ${table.name} changed after compiler-bound metadata extraction (SPEC §6.6/§10.3).`,
    );
  }
  const currentColumns = getTableColumns(table.table);
  if (
    typeof currentColumns !== 'object' ||
    currentColumns === null ||
    sqliteIsProxy(currentColumns)
  ) {
    throw new TypeError(`KV414: SQLite table ${table.name} bound columns are invalid.`);
  }
  const currentKeys = witnessOwnKeys(currentColumns);
  if (currentKeys.length !== table.rawColumns.length) {
    throw new TypeError(`KV414: SQLite table ${table.name} bound column inventory changed.`);
  }
  for (let index = 0; index < table.rawColumns.length; index += 1) {
    const rawColumn = table.rawColumns[index]!;
    const expected = table.columns[index]!;
    const current = snapshotColumn(rawColumn, table.table, table.name);
    assertSameColumnSnapshot(expected, current, table.name);
    assertCompilerBoundColumn(metadata, rawColumn, current, table.name);
    const source = witnessMapGet(metadata.columnSources, rawColumn);
    if (
      source === undefined ||
      !witnessObjectIs(
        stableOwnDataValue(
          currentColumns,
          source.key,
          `SQLite table ${table.name} bound column ${source.key}`,
        ),
        rawColumn,
      )
    ) {
      throw new TypeError(`KV414: SQLite table ${table.name} bound column identities changed.`);
    }
  }
}

function assertSameColumnSnapshot(
  expected: SqliteColumnSnapshot,
  current: SqliteColumnSnapshot,
  tableName: string,
): void {
  if (
    current.name !== expected.name ||
    current.typeDdl !== expected.typeDdl ||
    current.defaultDdl !== expected.defaultDdl ||
    current.primary !== expected.primary ||
    current.notNull !== expected.notNull ||
    current.unique !== expected.unique
  ) {
    throw new TypeError(
      `KV414: SQLite table ${tableName} column facts changed after compiler-bound metadata extraction (SPEC §6.6/§10.3).`,
    );
  }
}

function rejectNonEmptyConfigArray(
  config: SqliteTableConfig,
  property: 'checks' | 'indexes' | 'primaryKeys' | 'uniqueConstraints',
  tableName: string,
): void {
  const values = snapshotDenseArray(
    stableOwnDataValue(config, property, `SQLite table ${tableName}.${property}`),
    `SQLite table ${tableName}.${property}`,
    1,
  );
  if (values.length > 0) {
    throw new TypeError(
      `SQLite runtime table ${tableName} uses unsupported ${property}; use the Postgres starter or the reviewed SQLite column subset.`,
    );
  }
}

function snapshotColumn(
  column: SqliteColumn,
  expectedTable: SqliteTable,
  tableName: string,
): Readonly<SqliteColumnSnapshot> {
  if (
    !witnessObjectIs(
      stableOwnDataValue(column, 'table', `${tableName} column.table`),
      expectedTable,
    )
  ) {
    throw new TypeError(`SQLite runtime table ${tableName} contains a column from another table.`);
  }
  const name = stableOwnDataValue(column, 'name', `${tableName} column.name`);
  sqliteIdentifier(name, 'column');
  const columnType = stableOwnDataValue(column, 'columnType', `${tableName}.${name}.columnType`);
  const primary = stableBooleanColumnValue(column, 'primary', tableName, name);
  const notNull = stableBooleanColumnValue(column, 'notNull', tableName, name);
  const unique = stableBooleanColumnValue(column, 'isUnique', tableName, name);
  const hasDefault = stableBooleanColumnValue(column, 'hasDefault', tableName, name);
  const generated = stableOwnDataValue(column, 'generated', `${tableName}.${name}.generated`);
  const generatedIdentity = stableOwnDataValue(
    column,
    'generatedIdentity',
    `${tableName}.${name}.generatedIdentity`,
  );
  const defaultFn = stableOwnDataValue(column, 'defaultFn', `${tableName}.${name}.defaultFn`);
  const onUpdateFn = stableOwnDataValue(column, 'onUpdateFn', `${tableName}.${name}.onUpdateFn`);
  if (
    generated !== undefined ||
    generatedIdentity !== undefined ||
    defaultFn !== undefined ||
    onUpdateFn !== undefined
  ) {
    throw new TypeError(
      `SQLite runtime column ${tableName}.${name} uses an unsupported generated/default callback.`,
    );
  }
  const defaultValue = stableOwnDataValue(column, 'default', `${tableName}.${name}.default`);
  return witnessFreeze({
    defaultDdl: sqliteColumnDefault(name, hasDefault, defaultValue),
    name,
    notNull,
    primary,
    typeDdl: sqliteColumnType(columnType),
    unique,
  });
}

function stableBooleanColumnValue(
  column: SqliteColumn,
  property: 'hasDefault' | 'isUnique' | 'notNull' | 'primary',
  tableName: string,
  columnName: string,
): boolean {
  const value = stableOwnDataValue(column, property, `${tableName}.${columnName}.${property}`);
  if (typeof value !== 'boolean') {
    throw new TypeError(
      `SQLite runtime column ${tableName}.${columnName}.${property} must be boolean.`,
    );
  }
  return value;
}

function snapshotForeignKey(
  foreignKey: SqliteForeignKey,
  localTable: SqliteTableDraft,
  tableIdentities: WeakMap<object, SqliteTableDraft>,
  columnIdentities: WeakMap<object, SqliteColumnIdentity>,
): Readonly<SqliteForeignKeySnapshot> {
  if (
    !witnessObjectIs(
      stableOwnDataValue(foreignKey, 'table', `${localTable.name} foreign key.table`),
      localTable.table,
    )
  ) {
    throw new TypeError(
      `SQLite table ${localTable.name} contains a foreign key from another table.`,
    );
  }
  const onDelete = sqliteForeignKeyAction(
    stableOwnDataValue(foreignKey, 'onDelete', `${localTable.name} foreign key.onDelete`),
  );
  const onUpdate = sqliteForeignKeyAction(
    stableOwnDataValue(foreignKey, 'onUpdate', `${localTable.name} foreign key.onUpdate`),
  );
  const reference = stableOwnDataValue(
    foreignKey,
    'reference',
    `${localTable.name} foreign key.reference`,
  );
  if (typeof reference !== 'function') {
    throw new TypeError(
      `SQLite table ${localTable.name} foreign key.reference must be a function.`,
    );
  }
  const referenceValue = witnessReflectApply<unknown>(reference, foreignKey, []);
  if (
    typeof referenceValue !== 'object' ||
    referenceValue === null ||
    sqliteIsProxy(referenceValue)
  ) {
    throw new TypeError(`SQLite table ${localTable.name} foreign key reference is invalid.`);
  }
  const foreignTableValue = stableOwnDataValue(
    referenceValue,
    'foreignTable',
    `${localTable.name} foreign key reference.foreignTable`,
  );
  if (
    (typeof foreignTableValue !== 'object' && typeof foreignTableValue !== 'function') ||
    foreignTableValue === null
  ) {
    throw new TypeError(`SQLite table ${localTable.name} foreign key target table is invalid.`);
  }
  const foreignTable = witnessWeakMapGet(tableIdentities, foreignTableValue);
  if (foreignTable === undefined) {
    throw new TypeError(
      `SQLite table ${localTable.name} foreign key target must be a runtime schema table.`,
    );
  }
  const rawLocalColumns = snapshotDenseArray(
    stableOwnDataValue(
      referenceValue,
      'columns',
      `${localTable.name} foreign key reference.columns`,
    ),
    `${localTable.name} foreign key reference.columns`,
    SQLITE_MAX_COLUMNS_PER_TABLE,
  );
  const rawForeignColumns = snapshotDenseArray(
    stableOwnDataValue(
      referenceValue,
      'foreignColumns',
      `${localTable.name} foreign key reference.foreignColumns`,
    ),
    `${localTable.name} foreign key reference.foreignColumns`,
    SQLITE_MAX_COLUMNS_PER_TABLE,
  );
  if (rawLocalColumns.length === 0 || rawLocalColumns.length !== rawForeignColumns.length) {
    throw new TypeError('SQLite starter foreign keys must have matching non-empty columns.');
  }
  const localColumns: string[] = [];
  const foreignColumns: string[] = [];
  for (let index = 0; index < rawLocalColumns.length; index += 1) {
    const rawLocalColumn = rawLocalColumns[index];
    const rawForeignColumn = rawForeignColumns[index];
    if (
      typeof rawLocalColumn !== 'object' ||
      rawLocalColumn === null ||
      typeof rawForeignColumn !== 'object' ||
      rawForeignColumn === null
    ) {
      throw new TypeError('SQLite starter foreign keys must reference runtime schema columns.');
    }
    const localIdentity = witnessWeakMapGet(columnIdentities, rawLocalColumn);
    const foreignIdentity = witnessWeakMapGet(columnIdentities, rawForeignColumn);
    if (
      localIdentity === undefined ||
      foreignIdentity === undefined ||
      !witnessObjectIs(localIdentity.table, localTable) ||
      !witnessObjectIs(foreignIdentity.table, foreignTable)
    ) {
      throw new TypeError(
        'SQLite starter foreign keys must reference their declared table columns.',
      );
    }
    witnessArrayAppend(localColumns, localIdentity.column.name, 'SQLite foreign-key local columns');
    witnessArrayAppend(
      foreignColumns,
      foreignIdentity.column.name,
      'SQLite foreign-key target columns',
    );
  }
  return witnessFreeze({
    foreignColumns: witnessFreeze(foreignColumns),
    foreignTable: foreignTable.name,
    localColumns: witnessFreeze(localColumns),
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  });
}

function snapshotSeeds(
  value: unknown,
  tables: readonly SqliteTableSnapshot[],
): readonly SqliteSeedSnapshot[] {
  if (value === undefined) return witnessFreeze([]);
  const entries = snapshotDenseArray(value, 'SQLite runtime seed entries', SQLITE_MAX_TABLES);
  const seeds: SqliteSeedSnapshot[] = [];
  const seen = createWitnessSet<object>();
  let totalRows = 0;
  let totalCells = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== 'object' || entry === null || witnessIsArray(entry)) {
      throw new TypeError('SQLite runtime seed entries must be own-data objects.');
    }
    const snapshot = snapshotOwnDataRecord(entry, 'SQLite runtime seed entry');
    const tableValue = snapshot.table;
    if (
      (typeof tableValue !== 'object' && typeof tableValue !== 'function') ||
      tableValue === null
    ) {
      throw new TypeError('SQLite runtime seed entry table must be a runtime schema table.');
    }
    let table: SqliteTableSnapshot | undefined;
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
      const candidate = tables[tableIndex]!;
      if (witnessObjectIs(candidate.table, tableValue)) {
        table = candidate;
        break;
      }
    }
    if (table === undefined) {
      throw new TypeError('SQLite runtime seed entry table must be a runtime schema table.');
    }
    if (witnessSetHas(seen, tableValue)) {
      throw new TypeError('SQLite runtime seed must declare each table at most once.');
    }
    witnessSetAdd(seen, tableValue);
    const rawRows = snapshotDenseArray(
      snapshot.rows,
      `SQLite seed rows for ${table.name}`,
      SQLITE_MAX_SEED_ROWS,
    );
    totalRows += rawRows.length;
    if (totalRows > SQLITE_MAX_SEED_ROWS) {
      throw new TypeError(`SQLite runtime seed may contain at most ${SQLITE_MAX_SEED_ROWS} rows.`);
    }
    const rows: SqliteSeedRowSnapshot[] = [];
    for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
      const row = snapshotSeedRow(rawRows[rowIndex], table);
      totalCells += row.columns.length;
      if (totalCells > SQLITE_MAX_SEED_CELLS) {
        throw new TypeError(
          `SQLite runtime seed may contain at most ${SQLITE_MAX_SEED_CELLS} total values.`,
        );
      }
      witnessArrayAppend(rows, row, `SQLite seed rows for ${table.name}`);
    }
    witnessArrayAppend(
      seeds,
      witnessFreeze({ rows: witnessFreeze(rows), table }),
      'SQLite seed table snapshot',
    );
  }
  return witnessFreeze(seeds);
}

function snapshotSeedRow(
  value: unknown,
  table: SqliteTableSnapshot,
): Readonly<SqliteSeedRowSnapshot> {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`SQLite seed rows for ${table.name} must be own-data objects.`);
  }
  const row = snapshotOwnDataRecord(value, `SQLite seed row for ${table.name}`);
  const allowed = createWitnessSet<string>();
  for (let index = 0; index < table.columns.length; index += 1) {
    witnessSetAdd(allowed, table.columns[index]!.name);
  }
  const ownKeys = witnessOwnKeys(row);
  if (ownKeys.length === 0)
    throw new TypeError('SQLite seed rows must contain at least one column.');
  const columns: string[] = [];
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== 'string' || !witnessSetHas(allowed, key)) {
      throw new TypeError(`SQLite seed row contains unknown column ${securityString(key)}.`);
    }
    witnessArrayAppend(columns, key, `SQLite seed row columns for ${table.name}`);
  }
  witnessSortStrings(columns);
  const values: KovoSqliteSeedValue[] = [];
  for (let index = 0; index < columns.length; index += 1) {
    const key = columns[index]!;
    const seedValue = row[key];
    if (
      seedValue !== null &&
      typeof seedValue !== 'string' &&
      typeof seedValue !== 'number' &&
      typeof seedValue !== 'bigint' &&
      typeof seedValue !== 'boolean'
    ) {
      throw new TypeError(`SQLite seed value ${table.name}.${key} must be primitive.`);
    }
    if (typeof seedValue === 'number' && !securityNumberIsFinite(seedValue)) {
      throw new TypeError(`SQLite seed value ${table.name}.${key} must be finite.`);
    }
    witnessArrayAppend(values, seedValue, `SQLite seed row values for ${table.name}`);
  }
  return witnessFreeze({ columns: witnessFreeze(columns), values: witnessFreeze(values) });
}

function seedSqliteTables(client: SqlitePinnedClient, seeds: readonly SqliteSeedSnapshot[]): void {
  for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
    const seed = seeds[seedIndex]!;
    for (let rowIndex = 0; rowIndex < seed.rows.length; rowIndex += 1) {
      const row = seed.rows[rowIndex]!;
      const quotedColumns: string[] = [];
      const placeholders: string[] = [];
      const values: KovoSqliteSeedValue[] = [];
      for (let columnIndex = 0; columnIndex < row.columns.length; columnIndex += 1) {
        witnessArrayAppend(
          quotedColumns,
          quoteSqliteIdentifier(row.columns[columnIndex]!),
          'SQLite seed quoted columns',
        );
        witnessArrayAppend(placeholders, '?', 'SQLite seed placeholders');
        const value = row.values[columnIndex]!;
        witnessArrayAppend(
          values,
          typeof value === 'boolean' ? (value ? 1 : 0) : value,
          'SQLite seed bound values',
        );
      }
      const sql = `INSERT INTO ${quoteSqliteIdentifier(seed.table.name)} (${securityArrayJoin(
        quotedColumns,
        ', ',
      )}) VALUES (${securityArrayJoin(placeholders, ', ')});`;
      const statement = client.prepare(sql);
      const run = stableOwnDataFunction(statement, 'run', 'SQLite prepared statement.run');
      witnessReflectApply(run, statement, values);
    }
  }
}

function sqliteCreateTableDdl(table: SqliteTableSnapshot): string {
  const definitions: string[] = [];
  for (let index = 0; index < table.columns.length; index += 1) {
    witnessArrayAppend(definitions, sqliteColumnDdl(table.columns[index]!), 'SQLite column DDL');
  }
  for (let index = 0; index < table.foreignKeys.length; index += 1) {
    witnessArrayAppend(
      definitions,
      sqliteForeignKeyDdl(table.foreignKeys[index]!),
      'SQLite foreign-key DDL',
    );
  }
  return `CREATE TABLE ${quoteSqliteIdentifier(table.name)} (${securityArrayJoin(definitions, ', ')});`;
}

function sqliteColumnDdl(column: SqliteColumnSnapshot): string {
  const tokens: string[] = [];
  witnessArrayAppend(tokens, quoteSqliteIdentifier(column.name), 'SQLite column DDL tokens');
  witnessArrayAppend(tokens, column.typeDdl, 'SQLite column DDL tokens');
  if (column.primary) witnessArrayAppend(tokens, 'PRIMARY KEY', 'SQLite column DDL tokens');
  if (column.notNull) witnessArrayAppend(tokens, 'NOT NULL', 'SQLite column DDL tokens');
  if (column.unique) witnessArrayAppend(tokens, 'UNIQUE', 'SQLite column DDL tokens');
  if (column.defaultDdl !== '') {
    witnessArrayAppend(tokens, column.defaultDdl, 'SQLite column DDL tokens');
  }
  return securityArrayJoin(tokens, ' ');
}

function sqliteColumnType(columnType: unknown): string {
  switch (columnType) {
    case 'SQLiteBigInt':
    case 'SQLiteBoolean':
    case 'SQLiteInteger':
    case 'SQLiteTimestamp':
      return 'integer';
    case 'SQLiteBlobBuffer':
    case 'SQLiteBlobJson':
      return 'blob';
    case 'SQLiteNumeric':
    case 'SQLiteNumericBigInt':
    case 'SQLiteNumericNumber':
      return 'numeric';
    case 'SQLiteReal':
      return 'real';
    case 'SQLiteText':
    case 'SQLiteTextJson':
      return 'text';
    default:
      throw new TypeError(`Unsupported SQLite starter column type ${securityString(columnType)}.`);
  }
}

function sqliteColumnDefault(name: string, hasDefault: boolean, value: unknown): string {
  if (!hasDefault || value === undefined) return '';
  if (value === null) return 'DEFAULT NULL';
  if (typeof value === 'boolean') return `DEFAULT ${value ? '1' : '0'}`;
  if (typeof value === 'number') {
    if (!securityNumberIsFinite(value)) {
      throw new TypeError(`SQLite starter default for ${name} must be finite.`);
    }
    return `DEFAULT ${securityString(value)}`;
  }
  if (typeof value === 'bigint') return `DEFAULT ${securityString(value)}`;
  if (typeof value === 'string') {
    return `DEFAULT '${securityStringReplaceAll(value, "'", "''")}'`;
  }
  throw new TypeError(
    `SQLite starter default for ${name} must be a primitive literal in the reviewed subset.`,
  );
}

function sqliteForeignKeyDdl(foreignKey: SqliteForeignKeySnapshot): string {
  const local: string[] = [];
  const foreign: string[] = [];
  for (let index = 0; index < foreignKey.localColumns.length; index += 1) {
    witnessArrayAppend(
      local,
      quoteSqliteIdentifier(foreignKey.localColumns[index]!),
      'SQLite foreign-key local DDL',
    );
    witnessArrayAppend(
      foreign,
      quoteSqliteIdentifier(foreignKey.foreignColumns[index]!),
      'SQLite foreign-key target DDL',
    );
  }
  const tokens: string[] = [];
  witnessArrayAppend(
    tokens,
    `FOREIGN KEY (${securityArrayJoin(local, ', ')}) REFERENCES ${quoteSqliteIdentifier(
      foreignKey.foreignTable,
    )} (${securityArrayJoin(foreign, ', ')})`,
    'SQLite foreign-key DDL tokens',
  );
  if (foreignKey.onDelete !== undefined) {
    witnessArrayAppend(tokens, `ON DELETE ${foreignKey.onDelete}`, 'SQLite foreign-key DDL tokens');
  }
  if (foreignKey.onUpdate !== undefined) {
    witnessArrayAppend(tokens, `ON UPDATE ${foreignKey.onUpdate}`, 'SQLite foreign-key DDL tokens');
  }
  return securityArrayJoin(tokens, ' ');
}

function sqliteForeignKeyAction(action: unknown): string | undefined {
  switch (action) {
    case undefined:
      return undefined;
    case 'cascade':
      return 'CASCADE';
    case 'restrict':
      return 'RESTRICT';
    case 'no action':
      return 'NO ACTION';
    case 'set null':
      return 'SET NULL';
    case 'set default':
      return 'SET DEFAULT';
    default:
      throw new TypeError(`Unsupported SQLite foreign-key action ${securityString(action)}.`);
  }
}

function sqliteIdentifier(value: unknown, kind: 'column' | 'table'): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || securityStringIncludes(value, '\0')) {
    throw new TypeError(`SQLite ${kind} name must be a non-empty NUL-free string.`);
  }
}

function quoteSqliteIdentifier(value: string): string {
  sqliteIdentifier(value, 'column');
  return `"${securityStringReplaceAll(value, '"', '""')}"`;
}

function normalizePolicyTable(table: string): string {
  return securityStringIncludes(table, '.') ? table : `main.${table}`;
}

function snapshotOwnDataRecord(value: object, label: string): Record<string, unknown> {
  if (sqliteIsProxy(value)) throw new TypeError(`${label} must not be a Proxy.`);
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string') throw new TypeError(`${label} must not contain symbol keys.`);
    const before = witnessGetOwnPropertyDescriptor(value, key);
    const after = witnessGetOwnPropertyDescriptor(value, key);
    if (
      before === undefined ||
      after === undefined ||
      !('value' in before) ||
      !('value' in after) ||
      !witnessObjectIs(before.value, after.value)
    ) {
      throw new TypeError(`${label}.${key} must be a stable own-data property.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: true,
      enumerable: before.enumerable === true,
      value: before.value,
      writable: true,
    });
  }
  return witnessFreeze(snapshot) as Record<string, unknown>;
}

function stableOwnDataValue<Source extends object, Key extends PropertyKey>(
  source: Source,
  property: Key,
  label: string,
): unknown {
  if (sqliteIsProxy(source)) throw new TypeError(`${label} owner must not be a Proxy.`);
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`${label} must be a stable own-data property.`);
  }
  return before.value;
}

function optionalStableOwnDataValue(source: object, property: PropertyKey, label: string): unknown {
  if (sqliteIsProxy(source)) throw new TypeError(`${label} owner must not be a Proxy.`);
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`${label} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`${label} must be a stable own-data property.`);
  }
  return before.value;
}

function stableOwnDataFunction(source: object, property: PropertyKey, label: string): Function {
  const value = stableOwnDataValue(source, property, label);
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

function stableOwnDataObject(source: object, property: PropertyKey, label: string): object {
  const value = stableOwnDataValue(source, property, label);
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function snapshotDenseArray(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!witnessIsArray(value) || sqliteIsProxy(value)) {
    throw new TypeError(`${label} must be a dense own-data array.`);
  }
  const length = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !securityNumberIsInteger(length.value) ||
    length.value < 0 ||
    length.value > maximum
  ) {
    throw new TypeError(`${label} must have a bounded length no greater than ${maximum}.`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain dense own-data entries.`);
    }
    witnessArrayAppend(snapshot, descriptor.value, label);
  }
  return witnessFreeze(snapshot);
}

function snapshotSystemDbOptions(options: {
  operation: 'write';
  reason: string;
  surface: string;
}): void {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('SQLite system DB options must be an own-data object.');
  }
  const snapshot = snapshotOwnDataRecord(options, 'SQLite system DB options');
  if (snapshot.operation !== 'write') {
    throw new TypeError('SQLite system DB operation must be write.');
  }
  snapshotAuditReason(snapshot.reason, 'SQLite system DB capability reason (SPEC §10.3)');
  snapshotAuditText(snapshot.surface, 'SQLite system DB capability surface (SPEC §10.3)');
}

function warnExperimentalSqliteRuntime(): void {
  if (sqliteRuntimeWarningPrinted) return;
  sqliteRuntimeWarningPrinted = true;
  witnessReflectApply(sqliteConsoleWarn, sqliteConsole, [SQLITE_RUNTIME_WARNING]);
}
