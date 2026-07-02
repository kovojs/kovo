import { secret } from '@kovojs/core';
import { securityClassifier } from '@kovojs/core/internal/security-markers';

/** Runtime provenance for a database column participating in read-confidentiality decisions. */
export interface SecretReadColumnSource {
  /** Physical database column name. */
  column: string;
  /** Drizzle selection key for the column. */
  key: string;
  /** Whether the column is declared secret in Kovo metadata. */
  secret: boolean;
  /** Physical database table name. */
  table: string;
}

/**
 * Runtime read-confidentiality metadata consumed by `createSecretBoxingReadDb`.
 *
 * Drizzle-specific extraction lives in `@kovojs/drizzle`; this server-side shape is deliberately
 * framework-generic so the read-boundary decision has no Drizzle dependency (SPEC §10.3/§11.2).
 */
export interface SecretReadMetadata {
  /** Every known result key for schema columns. */
  allColumnKeys: ReadonlySet<string>;
  /** Runtime object identity map for Drizzle column/expression chunks when available. */
  columnSources: ReadonlyMap<object, SecretReadColumnSource>;
  /** Secret column keys as selected by the query builder. */
  secretColumnKeys: ReadonlySet<string>;
  /** Secret physical column names. */
  secretColumnNames: ReadonlySet<string>;
  /** Secret column keys grouped by physical table. */
  secretColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Secret physical column names grouped by physical table. */
  secretColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Physical tables containing at least one secret column. */
  secretTableNames: ReadonlySet<string>;
}

/** SQLite result-column provenance reported by a database driver. */
export interface SecretReadSqliteColumnOrigin {
  /** Physical source column when the driver can prove it. */
  column?: string | null;
  /** Result column name or alias. */
  name?: string | null;
  /** Physical source table when the driver can prove it. */
  table?: string | null;
}

/** Minimal SQLite client surface used to ask the driver for result-column origins. */
export interface SecretReadSqliteColumnOriginClient {
  /** Prepare SQL text so column origin metadata can be inspected before result boxing. */
  prepare(sql: string): { columns?: () => unknown };
}

/** Options for the server-owned read-confidentiality boundary wrapper. */
export interface SecretReadBoundaryOptions {
  /** Optional SQLite column-origin source; absence falls back to fail-closed raw-row boxing. */
  sqliteColumnOrigins?: SecretReadSqliteColumnOriginClient;
}

/** Audited declaration allowing a raw SQL statement to read secret columns. */
export interface DeclaredSecretReadCapability {
  /** Secret physical column names the raw statement is expected to read. */
  columns: readonly string[];
  /** Reviewable reason for using raw SQL to read secret material. */
  justification: string;
  /** Human-readable source label for audit/debugging. */
  source: string;
  /** Physical secret table name. */
  table: string;
}

interface SqlCarrier {
  params: readonly unknown[];
  text: string;
}

interface SecretReadBoundary {
  opaqueResultKeys: ReadonlySet<string>;
  rawWholeRowSecret: boolean;
  secretResultKeys: ReadonlySet<string>;
  secretColumnKeys: ReadonlySet<string>;
  secretColumnNames: ReadonlySet<string>;
  secretColumnScopeKnown: boolean;
}

const kovoDeclaredSecretReadCapability = Symbol('kovoDeclaredSecretReadCapability');

/**
 * Attach an audited raw secret-read declaration to a statement object.
 *
 * Raw SQL that references a secret table is refused unless it carries this declaration; the
 * resulting rows are still boxed before egress (SPEC §10.3/§11.2).
 */
export function declareSecretReadCapability<T extends object>(
  statement: T,
  declaration: DeclaredSecretReadCapability,
): T {
  if (declaration.justification.trim() === '') {
    throw new Error('KV435: declared secret-read capability requires a justification.');
  }
  if (declaration.source.trim() === '' || declaration.table.trim() === '') {
    throw new Error('KV435: declared secret-read capability requires a source table.');
  }
  if (
    declaration.columns.length === 0 ||
    declaration.columns.some((column) => column.trim() === '')
  ) {
    throw new Error('KV435: declared secret-read capability requires at least one secret column.');
  }
  Object.defineProperty(statement, kovoDeclaredSecretReadCapability, {
    configurable: false,
    enumerable: false,
    value: { ...declaration, columns: [...declaration.columns] },
  });
  return statement;
}

/**
 * Wrap a read-only database handle so secret-classified reads produce runtime `Secret` boxes.
 *
 * This is the server-owned runtime choke for generated starter database wiring (SPEC §10.3/§11.2).
 */
export function createSecretBoxingReadDb<Db extends object>(
  db: Db,
  metadata: SecretReadMetadata,
  options: SecretReadBoundaryOptions = {},
): Db {
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (typeof item !== 'function') return item;
      if (!isReadSurfaceMethod(prop)) return item.bind(target);
      return (...args: unknown[]) =>
        wrapReadSurface(
          Reflect.apply(item, db, args),
          metadata,
          readBoundaryForArgs(args, metadata, isDirectSqlReadMethod(prop), options),
          options,
        );
    },
  }) as Db;
}

/**
 * Box a read result according to a precomputed secret-read boundary.
 *
 * @internal
 */
export const boxSecretReadRows = securityClassifier(
  'server.secret-read.box-rows',
  function (
    value: unknown,
    metadata: SecretReadMetadata,
    boundary: SecretReadBoundary = emptyReadBoundary(),
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => boxSecretReadRows(entry, metadata, boundary));
    }
    if (value === null || typeof value !== 'object') return value;
    if (boundary.rawWholeRowSecret && Array.isArray((value as { rows?: unknown }).rows)) {
      return {
        ...value,
        rows: (value as { rows: unknown[] }).rows.map((row) =>
          row !== null && typeof row === 'object' ? secret(row) : row,
        ),
      };
    }
    if (boundary.rawWholeRowSecret) return secret(value);
    const boxed: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const secretColumnKeys = boundary.secretColumnScopeKnown
        ? boundary.secretColumnKeys
        : metadata.secretColumnKeys;
      const secretColumnNames = boundary.secretColumnScopeKnown
        ? boundary.secretColumnNames
        : metadata.secretColumnNames;
      boxed[key] =
        item === null || item === undefined
          ? item
          : boundary.secretResultKeys.has(key) ||
              boundary.opaqueResultKeys.has(key) ||
              secretColumnKeys.has(key) ||
              secretColumnNames.has(key)
            ? secret(item)
            : boxSecretReadRows(item, metadata, boundary);
    }
    return boxed;
  },
);

const sqliteSecretReadBoundaryForStatement = securityClassifier(
  'server.secret-read.sqlite-boundary',
  function (
    statement: unknown,
    sql: string,
    metadata: SecretReadMetadata,
    client: SecretReadSqliteColumnOriginClient,
  ): SecretReadBoundary {
    const secretResultKeys = new Set<string>();
    const opaqueResultKeys = new Set<string>();
    const expressionSafety = expressionSafetyByResultKey(statement, metadata);
    const selectedKeys = selectedResultKeysFromValue(statement);
    const referencesSecretTable = sqlReferencesSecretTable(sql, metadata.secretTableNames);
    const columns = sqliteResultColumns(client, sql);

    if (columns === undefined) {
      return referencesSecretTable
        ? { ...emptyReadBoundary(), rawWholeRowSecret: true }
        : { ...emptyReadBoundary(), secretColumnScopeKnown: true };
    }

    for (const [index, column] of columns.entries()) {
      const key =
        selectedKeys[index] ??
        (typeof column.name === 'string' && column.name !== '' ? column.name : undefined);
      if (key === undefined) {
        if (referencesSecretTable) return { ...emptyReadBoundary(), rawWholeRowSecret: true };
        continue;
      }
      if (
        typeof column.table === 'string' &&
        typeof column.column === 'string' &&
        (metadata.secretColumnNamesByTable.get(column.table)?.has(column.column) ?? false)
      ) {
        secretResultKeys.add(key);
        continue;
      }
      if (typeof column.table === 'string' && typeof column.column === 'string') continue;
      if (expressionSafety.get(key) === 'safe') continue;
      if (referencesSecretTable || expressionSafety.get(key) === 'opaque') {
        opaqueResultKeys.add(key);
      }
    }

    return {
      ...emptyReadBoundary(),
      opaqueResultKeys,
      secretResultKeys,
      secretColumnScopeKnown: true,
    };
  },
);

function isReadSurfaceMethod(prop: PropertyKey): boolean {
  return (
    prop === '$count' ||
    prop === '$with' ||
    prop === 'all' ||
    prop === 'execute' ||
    prop === 'get' ||
    prop === 'prepare' ||
    prop === 'query' ||
    prop === 'run' ||
    prop === 'select' ||
    prop === 'selectDistinct' ||
    prop === 'sql' ||
    prop === 'values' ||
    prop === 'with'
  );
}

function wrapReadSurface(
  value: unknown,
  metadata: SecretReadMetadata,
  inheritedBoundary: SecretReadBoundary = emptyReadBoundary(),
  options: SecretReadBoundaryOptions,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return boxSecretReadRows(value, metadata, inheritedBoundary);
  if (value instanceof Promise) {
    return value.then((result) => boxSecretReadRows(result, metadata, inheritedBoundary));
  }
  return new Proxy(value, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (prop === 'then' && typeof item === 'function') {
        const boundary = mergeReadBoundaries(
          inheritedBoundary,
          readBoundaryForQuery(target, metadata, options),
        );
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Reflect.apply(item, target, [
            (result: unknown) => onFulfilled?.(boxSecretReadRows(result, metadata, boundary)),
            onRejected,
          ]);
      }
      if (typeof item !== 'function') return item;
      return (...args: unknown[]) =>
        wrapReadSurface(
          Reflect.apply(item, target, args),
          metadata,
          mergeReadBoundaries(
            inheritedBoundary,
            readBoundaryForArgs(args, metadata, false, options),
          ),
          options,
        );
    },
  });
}

function readBoundaryForQuery(
  value: unknown,
  metadata: SecretReadMetadata,
  options: SecretReadBoundaryOptions,
): SecretReadBoundary {
  const carrier = sqlCarrierFromValue(value, []);
  if (carrier === undefined || options.sqliteColumnOrigins === undefined) {
    return emptyReadBoundary();
  }
  return sqliteSecretReadBoundaryForStatement(
    value,
    carrier.text,
    metadata,
    options.sqliteColumnOrigins,
  );
}

function readBoundaryForArgs(
  args: readonly unknown[],
  metadata: SecretReadMetadata,
  directSqlRead: boolean,
  options: SecretReadBoundaryOptions,
): SecretReadBoundary {
  if (!directSqlRead) return emptyReadBoundary();
  for (const arg of args) {
    const carrier = sqlCarrierFromValue(arg, []);
    const sql = carrier?.text ?? sqlTextFromValue(arg);
    if (sql === undefined) return { ...emptyReadBoundary(), rawWholeRowSecret: true };
    const boundary =
      options.sqliteColumnOrigins === undefined
        ? fallbackReadBoundaryForSql(sql, metadata)
        : sqliteSecretReadBoundaryForStatement(arg, sql, metadata, options.sqliteColumnOrigins);
    if (sqlReferencesSecretTable(sql, metadata.secretTableNames)) {
      if (!hasDeclaredSecretReadCapability(arg, metadata)) {
        throw new Error(
          'KV435: reader raw SQL secret-column read requires a declared secret-read capability (SPEC §10.3).',
        );
      }
      return { ...boundary, rawWholeRowSecret: true };
    }
    return boundary;
  }
  return { ...emptyReadBoundary(), secretColumnScopeKnown: true };
}

function fallbackReadBoundaryForSql(sql: string, metadata: SecretReadMetadata): SecretReadBoundary {
  if (sqlReferencesSecretTable(sql, metadata.secretTableNames)) {
    return { ...emptyReadBoundary(), rawWholeRowSecret: true };
  }
  return { ...emptyReadBoundary(), secretColumnScopeKnown: true };
}

function hasDeclaredSecretReadCapability(
  statement: unknown,
  metadata: SecretReadMetadata,
): boolean {
  if (statement === null || typeof statement !== 'object') return false;
  const declaration = Reflect.get(statement, kovoDeclaredSecretReadCapability) as
    | DeclaredSecretReadCapability
    | undefined;
  if (declaration === undefined) return false;
  if (!metadata.secretTableNames.has(declaration.table)) return false;
  const secretColumns =
    metadata.secretColumnNamesByTable.get(declaration.table) ?? new Set<string>();
  return declaration.columns.every((column) => secretColumns.has(column));
}

function mergeReadBoundaries(
  left: SecretReadBoundary,
  right: SecretReadBoundary,
): SecretReadBoundary {
  return {
    opaqueResultKeys: unionSets(left.opaqueResultKeys, right.opaqueResultKeys),
    rawWholeRowSecret: left.rawWholeRowSecret || right.rawWholeRowSecret,
    secretResultKeys: unionSets(left.secretResultKeys, right.secretResultKeys),
    secretColumnKeys: unionSets(left.secretColumnKeys, right.secretColumnKeys),
    secretColumnNames: unionSets(left.secretColumnNames, right.secretColumnNames),
    secretColumnScopeKnown: left.secretColumnScopeKnown || right.secretColumnScopeKnown,
  };
}

function emptyReadBoundary(): SecretReadBoundary {
  return {
    opaqueResultKeys: new Set<string>(),
    rawWholeRowSecret: false,
    secretResultKeys: new Set<string>(),
    secretColumnKeys: new Set<string>(),
    secretColumnNames: new Set<string>(),
    secretColumnScopeKnown: false,
  };
}

function selectedResultKeysFromValue(value: unknown): readonly string[] {
  const fields = selectedFieldsFromValue(value);
  return fields === undefined ? [] : Object.keys(fields);
}

function sqliteResultColumns(
  client: SecretReadSqliteColumnOriginClient,
  sql: string,
): readonly SecretReadSqliteColumnOrigin[] | undefined {
  try {
    const statement = client.prepare(sql);
    const columns = statement.columns;
    if (typeof columns !== 'function') return undefined;
    const result = columns.call(statement);
    return Array.isArray(result) ? (result as SecretReadSqliteColumnOrigin[]) : undefined;
  } catch {
    return undefined;
  }
}

function expressionSafetyByResultKey(
  value: unknown,
  metadata: SecretReadMetadata,
): Map<string, 'opaque' | 'safe'> {
  const fields = selectedFieldsFromValue(value);
  const safety = new Map<string, 'opaque' | 'safe'>();
  if (fields === undefined) return safety;
  for (const [key, field] of Object.entries(fields)) {
    if (isColumnLike(field)) continue;
    const verdict = classifySqlExpression(field, metadata);
    if (verdict !== undefined) safety.set(key, verdict);
  }
  return safety;
}

function selectedFieldsFromValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  for (const candidate of [
    (value as { config?: { fields?: unknown } }).config?.fields,
    (value as { _?: { selectedFields?: unknown } })._?.selectedFields,
    (value as { selectedFields?: unknown }).selectedFields,
  ]) {
    if (isPlainRecord(candidate)) return candidate;
  }
  return undefined;
}

function classifySqlExpression(
  value: unknown,
  metadata: SecretReadMetadata,
): 'opaque' | 'safe' | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const chunks = (value as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  return chunks.every((chunk) => sqlChunkIsSafe(chunk, metadata)) ? 'safe' : 'opaque';
}

function sqlChunkIsSafe(chunk: unknown, metadata: SecretReadMetadata): boolean {
  if (chunk === null || chunk === undefined) return true;
  if (typeof chunk === 'string' || typeof chunk === 'number' || typeof chunk === 'boolean') {
    return true;
  }
  if (typeof chunk !== 'object') return false;

  const source = metadata.columnSources.get(chunk);
  if (source !== undefined) return !source.secret;

  const nested = (chunk as { queryChunks?: unknown }).queryChunks;
  if (Array.isArray(nested)) return nested.every((item) => sqlChunkIsSafe(item, metadata));

  const value = (chunk as { value?: unknown }).value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.every(sqlStringChunkIsInert);
  }
  return false;
}

const SAFE_SQL_WORDS = new Set([
  'abs',
  'as',
  'cast',
  'coalesce',
  'collate',
  'ifnull',
  'length',
  'lower',
  'ltrim',
  'null',
  'nullif',
  'round',
  'rtrim',
  'substr',
  'substring',
  'trim',
  'upper',
]);

function sqlStringChunkIsInert(value: string): boolean {
  if (/\bselect\b/i.test(value)) return false;
  for (const word of value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (!SAFE_SQL_WORDS.has(word.toLowerCase())) return false;
  }
  return true;
}

function isDirectSqlReadMethod(prop: PropertyKey): boolean {
  return (
    prop === 'all' ||
    prop === 'execute' ||
    prop === 'get' ||
    prop === 'prepare' ||
    prop === 'query' ||
    prop === 'run' ||
    prop === 'sql' ||
    prop === 'values'
  );
}

function sqlCarrierFromValue(value: unknown, params: readonly unknown[]): SqlCarrier | undefined {
  if (typeof value === 'string') return { params, text: value };
  const toSQL = (value as { toSQL?: unknown }).toSQL;
  if (typeof toSQL === 'function') {
    try {
      const result = toSQL.call(value) as { params?: unknown; sql?: unknown };
      if (typeof result?.sql === 'string') {
        return {
          params: Array.isArray(result.params) ? result.params : params,
          text: result.sql,
        };
      }
    } catch {
      return undefined;
    }
  }
  const text = sqlTextFromValue(value);
  if (text !== undefined) return { params, text };
  return undefined;
}

function sqlTextFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return undefined;
  const sql = (value as { sql?: unknown }).sql;
  if (typeof sql === 'string') return sql;
  const chunks = (value as { queryChunks?: unknown }).queryChunks;
  if (Array.isArray(chunks)) {
    const text = chunks
      .flatMap((chunk) => {
        const part = (chunk as { value?: unknown }).value;
        return Array.isArray(part)
          ? part.filter((item): item is string => typeof item === 'string')
          : [];
      })
      .join('');
    return text || undefined;
  }
  return undefined;
}

function sqlReferencesSecretTable(sql: string, secretTableNames: ReadonlySet<string>): boolean {
  for (const table of secretTableNames) {
    if (sqlReferencesTable(sql, table)) return true;
  }
  return false;
}

function sqlReferencesTable(sql: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])"?${escaped}"?(?:$|[^A-Za-z0-9_])`, 'i').test(sql);
}

function isColumnLike(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unionSets(left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlySet<string> {
  if (left.size === 0) return right;
  if (right.size === 0) return left;
  return new Set([...left, ...right]);
}
