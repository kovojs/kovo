import { frameworkTrustedSqlCarrier } from '@kovojs/core/internal/sql-safety';
import {
  createDeclaredWriteDb,
  registerFrameworkManagedDbHooks,
  readonlyDb,
  type DeclaredWriteSqliteAuthorizerOptions,
  type Reader,
} from './managed-db.js';
import { createSecretBoxingReadDb } from './secret-read-boundary.js';
import { enforceManagedSql } from './sql-safe-handle.js';
import { assertManagedSqlParserAuthorityReady } from './sql-parser-authority-bootstrap.js';
import { extractCompilerBoundKovoRuntimeDbMetadata } from './generated-table-security-registry.js';
import {
  forEachReadonlyMapEntry,
  forEachReadonlySetValue,
} from './readonly-collection-snapshot.js';
import {
  createWitnessMap,
  createWitnessSet,
  witnessFreeze,
  witnessCreateNullRecord,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapSet,
  witnessObjectIs,
  witnessReflectApply,
  witnessSetAdd,
} from './security-witness-intrinsics.js';

/** Runtime source metadata for one SQLite result column. */
export interface KovoSqliteRuntimeColumnSource {
  /** Physical database column name. */
  column: string;
  /** Drizzle selection key for the column. */
  key: string;
  /** Whether the column is declared secret in Kovo metadata. */
  secret: boolean;
  /** Physical database table name. */
  table: string;
}

/** Schema-derived metadata consumed by the SQLite starter runtime boundary. */
export interface KovoSqliteAppRuntimeMetadata {
  /** Every known result key for schema columns. */
  allColumnKeys: ReadonlySet<string>;
  /** Runtime object identity map for Drizzle column/expression chunks when available. */
  columnSources: ReadonlyMap<object, KovoSqliteRuntimeColumnSource>;
  /** Governed Drizzle column keys grouped by physical table. */
  governedColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Governed physical column names grouped by physical table. */
  governedColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Secret column keys as selected by the query builder. */
  secretColumnKeys: ReadonlySet<string>;
  /** Secret column keys grouped by physical table. */
  secretColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Secret physical column names. */
  secretColumnNames: ReadonlySet<string>;
  /** Secret physical column names grouped by physical table. */
  secretColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Physical tables containing at least one secret column. */
  secretTableNames: ReadonlySet<string>;
}

/** Minimal SQLite client surface used to inspect raw-read result-column provenance. */
export interface KovoSqliteColumnOriginClient {
  /** Prepare SQL text so column origin metadata can be inspected before result boxing. */
  prepare(sql: string): { columns?: () => unknown };
}

/** Options for wiring a generated SQLite starter database into Kovo's runtime DB boundary. */
export interface KovoSqliteAppRuntimeOptions<Db extends object> {
  /** Optional adapter-owned resolver for construction-time Drizzle table execution snapshots. */
  canonicalizeTable?: (table: unknown) => unknown;
  /** Drizzle SQLite database handle created by the starter. */
  db: Db;
  /** Adapter-owned raw-read executor backed by the starter's pinned native SQLite controls. */
  executeRawRead: (statement: { params: readonly unknown[]; text: string }) => unknown;
  /** Schema-derived metadata from `@kovojs/drizzle#extractKovoRuntimeDbMetadata`. */
  metadata: KovoSqliteAppRuntimeMetadata;
  /** Normalize SQLite table names before policy comparisons. */
  normalizeTableName: (table: string) => string;
  /** SQLite authorizer hook used for raw-read and declared-write policy checks. */
  sqliteAuthorizer: DeclaredWriteSqliteAuthorizerOptions;
  /** Optional column-origin source for precise secret-read boxing. */
  sqliteColumnOrigins?: KovoSqliteColumnOriginClient;
  /** Resolve a Drizzle table object to the policy names accepted for writes. */
  tableNames: (table: unknown) => readonly string[];
}

/** Runtime handles created for a generated SQLite starter database. */
export interface KovoSqliteAppRuntimeDb<Db extends object> {
  /** Write-capable framework construction/auth adapter handle. */
  db: Db;
  /** Opaque provider carrier resolved only through framework-owned managed DB hooks. */
  providerDb: Db;
  /** Read-only endpoint/query handle with secret-read boxing applied. */
  readonlyDb: Reader<Db>;
}

/**
 * Bind a generated app's Drizzle schema to compiler-derived runtime security metadata.
 *
 * Generated dev/production entries register the compiler manifest before app modules evaluate;
 * this helper then uses live Drizzle values only for table/column identity and rejects any
 * authorization or confidentiality mismatch (SPEC §6.6/§10.3).
 */
export function runtimeDbMetadataForSchema(
  tables: readonly unknown[],
): KovoSqliteAppRuntimeMetadata {
  return snapshotSqliteRuntimeMetadata(extractCompilerBoundKovoRuntimeDbMetadata(tables));
}

/**
 * Attach Kovo's SQLite read and declared-write runtime boundaries to a generated starter DB.
 *
 * This is the public framework-owned wrapper for the opt-in SQLite starter. It keeps adapter
 * symbols and low-level read/write wrappers behind server internals while generated app source uses
 * a documented public entrypoint (SPEC §5.2/§10.3/§11.2).
 */
export function createSqliteAppRuntimeDb<Db extends object>(
  options: KovoSqliteAppRuntimeOptions<Db>,
): KovoSqliteAppRuntimeDb<Db> {
  assertManagedSqlParserAuthorityReady();
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('SQLite runtime options must be a stable own-data record.');
  }
  const rawDb = requiredSqliteRuntimeValue(options, 'db');
  const rawExecuteRawRead = requiredSqliteRuntimeValue(options, 'executeRawRead');
  const rawCanonicalizeTable = optionalSqliteRuntimeValue(options, 'canonicalizeTable');
  const rawMetadata = requiredSqliteRuntimeValue(options, 'metadata');
  const rawNormalizeTableName = requiredSqliteRuntimeValue(options, 'normalizeTableName');
  const rawSqliteAuthorizer = requiredSqliteRuntimeValue(options, 'sqliteAuthorizer');
  const rawSqliteColumnOrigins = optionalSqliteRuntimeValue(options, 'sqliteColumnOrigins');
  const rawTableNames = requiredSqliteRuntimeValue(options, 'tableNames');
  if (
    typeof rawDb !== 'object' ||
    rawDb === null ||
    typeof rawExecuteRawRead !== 'function' ||
    (rawCanonicalizeTable !== undefined && typeof rawCanonicalizeTable !== 'function') ||
    typeof rawMetadata !== 'object' ||
    rawMetadata === null ||
    typeof rawNormalizeTableName !== 'function' ||
    typeof rawSqliteAuthorizer !== 'object' ||
    rawSqliteAuthorizer === null ||
    (rawSqliteColumnOrigins !== undefined &&
      (typeof rawSqliteColumnOrigins !== 'object' || rawSqliteColumnOrigins === null)) ||
    typeof rawTableNames !== 'function'
  ) {
    throw new TypeError('SQLite runtime options contain an invalid authority value.');
  }
  const db = rawDb as Db;
  const executeRawRead = rawExecuteRawRead as (statement: {
    params: readonly unknown[];
    text: string;
  }) => unknown;
  const canonicalizeTable = rawCanonicalizeTable as ((table: unknown) => unknown) | undefined;
  const metadata = snapshotSqliteRuntimeMetadata(rawMetadata as KovoSqliteAppRuntimeMetadata);
  const normalizeTableName = rawNormalizeTableName as (table: string) => string;
  const sqliteAuthorizer = rawSqliteAuthorizer as DeclaredWriteSqliteAuthorizerOptions;
  const sqliteColumnOrigins =
    rawSqliteColumnOrigins === undefined
      ? undefined
      : readOnlySqliteColumnOriginClient(rawSqliteColumnOrigins as KovoSqliteColumnOriginClient);
  const tableNames = rawTableNames as (table: unknown) => readonly string[];
  const readDb = createSecretBoxingReadDb(
    readonlyDb(db, {
      rawRead: {
        dialect: 'sqlite',
        dialectLabel: 'SQLite',
        executeSql: (statement) => witnessReflectApply(executeRawRead, undefined, [statement]),
        normalizeTableName,
        sqliteAuthorizer,
      },
    }),
    metadata,
    sqliteColumnOrigins === undefined ? {} : { sqliteColumnOrigins },
  );
  registerFrameworkManagedDbHooks(
    db,
    () => readDb,
    (policy: Parameters<typeof createDeclaredWriteDb>[1]) =>
      createDeclaredWriteDb(db, policy, {
        ...(canonicalizeTable === undefined ? {} : { canonicalizeTable }),
        dialectLabel: 'SQLite',
        governedColumns: metadata,
        normalizeTableName,
        sqliteAuthorizer,
        tableNames,
      }),
  );
  // SPEC §10.3 C9: the generated provider must not receive the Drizzle/native database object.
  // This type-only mirror is resolved through the private WeakMap hooks below before a query or
  // mutation can use it; direct property access on the frozen null-record exposes no authority.
  const providerDb = witnessFreeze(witnessCreateNullRecord()) as Db;
  registerFrameworkManagedDbHooks(
    providerDb,
    () => readDb,
    (policy: Parameters<typeof createDeclaredWriteDb>[1]) =>
      createDeclaredWriteDb(db, policy, {
        ...(canonicalizeTable === undefined ? {} : { canonicalizeTable }),
        dialectLabel: 'SQLite',
        governedColumns: metadata,
        normalizeTableName,
        sqliteAuthorizer,
        tableNames,
      }),
  );
  return witnessFreeze({
    db,
    providerDb,
    readonlyDb: readDb,
  });
}

function readOnlySqliteColumnOriginClient(
  client: KovoSqliteColumnOriginClient,
): KovoSqliteColumnOriginClient {
  const prepare = requiredSqliteRuntimeValue(client, 'prepare');
  if (typeof prepare !== 'function') {
    throw new TypeError('SQLite runtime column-origin prepare must be a function.');
  }
  return witnessFreeze({
    prepare(sql: string): { columns?: () => unknown } {
      // SPEC §10.3/§11.2: PRAGMA and other SQLite connection-state statements may take
      // effect during prepare(). The confidentiality layer may inspect column origins only after
      // the same managed read classifier that guards execution has accepted the SQL text.
      enforceManagedSql(
        frameworkTrustedSqlCarrier(
          { text: sql, values: [] },
          'framework reconstructed SQLite column-origin carrier (SPEC §10.3)',
        ),
        'enforce',
        { capability: 'read', dialect: 'sqlite', engineReadonly: false },
      );
      return witnessReflectApply(prepare, client, [sql]) as { columns?: () => unknown };
    },
  });
}

function snapshotSqliteRuntimeMetadata(
  metadata: KovoSqliteAppRuntimeMetadata,
): KovoSqliteAppRuntimeMetadata {
  return witnessFreeze({
    allColumnKeys: snapshotSqliteReadonlySet(
      requiredSqliteRuntimeValue(metadata, 'allColumnKeys'),
      'SQLite runtime all-column keys',
    ),
    columnSources: snapshotSqliteReadonlyMap(
      requiredSqliteRuntimeValue(metadata, 'columnSources'),
      'SQLite runtime column sources',
      snapshotSqliteColumnSource,
    ),
    governedColumnKeysByTable: snapshotSqliteReadonlyMap(
      requiredSqliteRuntimeValue(metadata, 'governedColumnKeysByTable'),
      'SQLite runtime governed column keys',
      (values, tableName) =>
        snapshotSqliteReadonlySet(values, `SQLite runtime governed keys for ${String(tableName)}`),
    ),
    governedColumnNamesByTable: snapshotSqliteReadonlyMap(
      requiredSqliteRuntimeValue(metadata, 'governedColumnNamesByTable'),
      'SQLite runtime governed column names',
      (values, tableName) =>
        snapshotSqliteReadonlySet(values, `SQLite runtime governed names for ${String(tableName)}`),
    ),
    secretColumnKeys: snapshotSqliteReadonlySet(
      requiredSqliteRuntimeValue(metadata, 'secretColumnKeys'),
      'SQLite runtime secret column keys',
    ),
    secretColumnKeysByTable: snapshotSqliteReadonlyMap(
      requiredSqliteRuntimeValue(metadata, 'secretColumnKeysByTable'),
      'SQLite runtime secret column keys by table',
      (values, tableName) =>
        snapshotSqliteReadonlySet(values, `SQLite runtime secret keys for ${String(tableName)}`),
    ),
    secretColumnNames: snapshotSqliteReadonlySet(
      requiredSqliteRuntimeValue(metadata, 'secretColumnNames'),
      'SQLite runtime secret column names',
    ),
    secretColumnNamesByTable: snapshotSqliteReadonlyMap(
      requiredSqliteRuntimeValue(metadata, 'secretColumnNamesByTable'),
      'SQLite runtime secret column names by table',
      (values, tableName) =>
        snapshotSqliteReadonlySet(values, `SQLite runtime secret names for ${String(tableName)}`),
    ),
    secretTableNames: snapshotSqliteReadonlySet(
      requiredSqliteRuntimeValue(metadata, 'secretTableNames'),
      'SQLite runtime secret table names',
    ),
  });
}

function snapshotSqliteReadonlyMap<Key, Value, OutputValue = Value>(
  value: unknown,
  label: string,
  snapshot: (entry: Value, key: Key) => OutputValue = (entry) => entry as unknown as OutputValue,
): Map<Key, OutputValue> {
  const output = createWitnessMap<Key, OutputValue>();
  forEachReadonlyMapEntry<Key, Value>(value, label, (entry, key) => {
    witnessMapSet(output, key, snapshot(entry, key));
  });
  return output;
}

function snapshotSqliteReadonlySet<Value>(value: unknown, label: string): Set<Value> {
  const output = createWitnessSet<Value>();
  forEachReadonlySetValue<Value>(value, label, (entry) => {
    witnessSetAdd(output, entry);
  });
  return output;
}

function snapshotSqliteColumnSource(
  value: KovoSqliteRuntimeColumnSource,
  key: object,
): KovoSqliteRuntimeColumnSource {
  if (typeof key !== 'object' || key === null || typeof value !== 'object' || value === null) {
    throw new TypeError('SQLite runtime column-source metadata is invalid.');
  }
  const column = requiredSqliteRuntimeValue(value, 'column');
  const selectionKey = requiredSqliteRuntimeValue(value, 'key');
  const secret = requiredSqliteRuntimeValue(value, 'secret');
  const table = requiredSqliteRuntimeValue(value, 'table');
  if (
    typeof column !== 'string' ||
    typeof selectionKey !== 'string' ||
    typeof secret !== 'boolean' ||
    typeof table !== 'string'
  ) {
    throw new TypeError('SQLite runtime column-source metadata is invalid.');
  }
  return witnessFreeze({ column, key: selectionKey, secret, table });
}

function optionalSqliteRuntimeValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`SQLite runtime option ${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`SQLite runtime option ${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`SQLite runtime option ${String(property)} changed during validation.`);
  }
  return before.value;
}

function requiredSqliteRuntimeValue(source: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined) {
    throw new TypeError(`SQLite runtime option ${String(property)} must be an own data property.`);
  }
  return optionalSqliteRuntimeValue(source, property);
}
