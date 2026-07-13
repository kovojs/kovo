import {
  createDeclaredWriteDb,
  registerFrameworkManagedDbHooks,
  readonlyDb,
  type DeclaredWriteSqliteAuthorizerOptions,
  type Reader,
} from './managed-db.js';
import { createSecretBoxingReadDb } from './secret-read-boundary.js';
import {
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
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
  /** Drizzle SQLite database handle created by the starter. */
  db: Db;
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
  /** Read-only endpoint/query handle with secret-read boxing applied. */
  readonlyDb: Reader<Db>;
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
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('SQLite runtime options must be a stable own-data record.');
  }
  const rawDb = requiredSqliteRuntimeValue(options, 'db');
  const rawMetadata = requiredSqliteRuntimeValue(options, 'metadata');
  const rawNormalizeTableName = requiredSqliteRuntimeValue(options, 'normalizeTableName');
  const rawSqliteAuthorizer = requiredSqliteRuntimeValue(options, 'sqliteAuthorizer');
  const rawSqliteColumnOrigins = optionalSqliteRuntimeValue(options, 'sqliteColumnOrigins');
  const rawTableNames = requiredSqliteRuntimeValue(options, 'tableNames');
  if (
    typeof rawDb !== 'object' ||
    rawDb === null ||
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
  const metadata = rawMetadata as KovoSqliteAppRuntimeMetadata;
  const normalizeTableName = rawNormalizeTableName as (table: string) => string;
  const sqliteAuthorizer = rawSqliteAuthorizer as DeclaredWriteSqliteAuthorizerOptions;
  const sqliteColumnOrigins = rawSqliteColumnOrigins as KovoSqliteColumnOriginClient | undefined;
  const tableNames = rawTableNames as (table: unknown) => readonly string[];
  const readDb = createSecretBoxingReadDb(
    readonlyDb(db, {
      rawRead: {
        dialectLabel: 'SQLite',
        executeMethod: 'all',
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
        dialectLabel: 'SQLite',
        governedColumns: metadata,
        normalizeTableName,
        sqliteAuthorizer,
        tableNames,
      }),
  );
  return witnessFreeze({
    db,
    readonlyDb: readDb,
  });
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
