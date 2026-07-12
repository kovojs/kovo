import { secret } from '@kovojs/core';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessObjectKeys,
  witnessSetAdd,
  witnessSetForEach,
  witnessSetHas,
  witnessSetSize,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

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
  /** Optional privileged read handle for audited raw secret-read capabilities. */
  privilegedDb?: object;
  /** How to handle raw SQL referencing a secret table without a declared capability. */
  rawSecretTableRead?: 'engine' | 'throw';
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
  declaredSecretRead: boolean;
  opaqueResultKeys: ReadonlySet<string>;
  rawWholeRowSecret: boolean;
  secretResultKeys: ReadonlySet<string>;
  secretColumnKeys: ReadonlySet<string>;
  secretColumnNames: ReadonlySet<string>;
  secretColumnScopeKnown: boolean;
}

const kovoDeclaredSecretReadCapability = Symbol('kovoDeclaredSecretReadCapability');
const pinnedSecretReadMetadata = createWitnessWeakSet<object>();
const pinnedSecretReadBoundaries = createWitnessWeakSet<object>();

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
  const pinnedMetadata = snapshotSecretReadMetadata(metadata);
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const item = Reflect.get(target, prop, receiver);
      if (typeof item !== 'function') return item;
      if (!isReadSurfaceMethod(prop)) return item.bind(target);
      return (...args: unknown[]) => {
        const boundary = readBoundaryForArgs(
          args,
          pinnedMetadata,
          isDirectSqlReadMethod(prop),
          options,
        );
        const readTarget =
          boundary.declaredSecretRead && options.privilegedDb !== undefined
            ? (options.privilegedDb as Record<PropertyKey, unknown>)
            : target;
        const readMethod = Reflect.get(readTarget, prop, receiver);
        if (typeof readMethod !== 'function') return readMethod;
        return wrapReadSurface(
          Reflect.apply(readMethod, readTarget, args),
          pinnedMetadata,
          boundary,
          options,
        );
      };
    },
  }) as Db;
}

/**
 * Reconstruct the complete confidentiality classifier once at the managed read boundary.
 * Metadata originates in generated/adapter code but application modules share the same realm;
 * exact private copies keep later collection mutation or prototype replacement from changing a
 * declared secret verdict (SPEC §6.6 C9/§10.3/§11.2).
 */
function snapshotSecretReadMetadata(metadata: SecretReadMetadata): SecretReadMetadata {
  if (witnessWeakSetHas(pinnedSecretReadMetadata, metadata as object)) return metadata;

  try {
    const allColumnKeys = snapshotStringSet(
      ownDataValue(metadata, 'allColumnKeys'),
      'allColumnKeys',
    );
    const secretColumnKeys = snapshotStringSet(
      ownDataValue(metadata, 'secretColumnKeys'),
      'secretColumnKeys',
    );
    const secretColumnNames = snapshotStringSet(
      ownDataValue(metadata, 'secretColumnNames'),
      'secretColumnNames',
    );
    const secretTableNames = snapshotStringSet(
      ownDataValue(metadata, 'secretTableNames'),
      'secretTableNames',
    );
    const columnSources = createWitnessMap<object, SecretReadColumnSource>();
    witnessMapForEach(
      ownDataValue(metadata, 'columnSources') as Map<unknown, unknown>,
      (source, column) => {
        if ((typeof column !== 'object' && typeof column !== 'function') || column === null) {
          throw new TypeError('columnSources keys must be object identities.');
        }
        const snapshot = witnessFreeze({
          column: ownStringDataValue(source, 'column'),
          key: ownStringDataValue(source, 'key'),
          secret: ownBooleanDataValue(source, 'secret'),
          table: ownStringDataValue(source, 'table'),
        });
        witnessMapSet(columnSources, column, snapshot);
      },
    );

    const secretColumnKeysByTable = snapshotStringSetMap(
      ownDataValue(metadata, 'secretColumnKeysByTable'),
      'secretColumnKeysByTable',
    );
    const secretColumnNamesByTable = snapshotStringSetMap(
      ownDataValue(metadata, 'secretColumnNamesByTable'),
      'secretColumnNamesByTable',
    );
    const snapshot = witnessFreeze({
      allColumnKeys,
      columnSources,
      secretColumnKeys,
      secretColumnKeysByTable,
      secretColumnNames,
      secretColumnNamesByTable,
      secretTableNames,
    });
    witnessWeakSetAdd(pinnedSecretReadMetadata, snapshot);
    return snapshot;
  } catch (error) {
    throw new TypeError(
      `Secret read metadata must be an exact collection-backed snapshot: ${error instanceof Error ? error.message : 'invalid metadata'}`,
    );
  }
}

function snapshotSecretReadBoundary(boundary: SecretReadBoundary): SecretReadBoundary {
  if (witnessWeakSetHas(pinnedSecretReadBoundaries, boundary as object)) return boundary;
  const snapshot = witnessFreeze({
    declaredSecretRead: ownBooleanDataValue(boundary, 'declaredSecretRead'),
    opaqueResultKeys: snapshotStringSet(
      ownDataValue(boundary, 'opaqueResultKeys'),
      'opaqueResultKeys',
    ),
    rawWholeRowSecret: ownBooleanDataValue(boundary, 'rawWholeRowSecret'),
    secretColumnKeys: snapshotStringSet(
      ownDataValue(boundary, 'secretColumnKeys'),
      'secretColumnKeys',
    ),
    secretColumnNames: snapshotStringSet(
      ownDataValue(boundary, 'secretColumnNames'),
      'secretColumnNames',
    ),
    secretColumnScopeKnown: ownBooleanDataValue(boundary, 'secretColumnScopeKnown'),
    secretResultKeys: snapshotStringSet(
      ownDataValue(boundary, 'secretResultKeys'),
      'secretResultKeys',
    ),
  });
  witnessWeakSetAdd(pinnedSecretReadBoundaries, snapshot);
  return snapshot;
}

function snapshotStringSet(value: unknown, label: string): ReadonlySet<string> {
  const snapshot = createWitnessSet<string>();
  witnessSetForEach(value as Set<unknown>, (entry) => {
    if (typeof entry !== 'string') throw new TypeError(`${label} must contain only strings.`);
    witnessSetAdd(snapshot, entry);
  });
  return snapshot;
}

function snapshotStringSetMap(
  value: unknown,
  label: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const snapshot = createWitnessMap<string, ReadonlySet<string>>();
  witnessMapForEach(value as Map<unknown, unknown>, (entry, key) => {
    if (typeof key !== 'string') throw new TypeError(`${label} keys must be strings.`);
    witnessMapSet(snapshot, key, snapshotStringSet(entry, `${label}.${key}`));
  });
  return snapshot;
}

function ownDataValue(value: unknown, property: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('expected an object carrier.');
  }
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

function optionalOwnDataValue(value: unknown, property: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function ownStringDataValue(value: unknown, property: PropertyKey): string {
  const result = ownDataValue(value, property);
  if (typeof result !== 'string') throw new TypeError(`${String(property)} must be a string.`);
  return result;
}

function ownBooleanDataValue(value: unknown, property: PropertyKey): boolean {
  const result = ownDataValue(value, property);
  if (typeof result !== 'boolean') throw new TypeError(`${String(property)} must be a boolean.`);
  return result;
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
    metadata = snapshotSecretReadMetadata(metadata);
    boundary = snapshotSecretReadBoundary(boundary);
    if (witnessIsArray(value)) {
      return mapDenseReadArray(value, (entry) => boxSecretReadRows(entry, metadata, boundary));
    }
    if (value === null || typeof value !== 'object') return value;
    if (boundary.rawWholeRowSecret && witnessIsArray((value as { rows?: unknown }).rows)) {
      return {
        ...value,
        rows: mapDenseReadArray((value as { rows: unknown[] }).rows, (row) =>
          row !== null && typeof row === 'object' ? secret(row) : row,
        ),
      };
    }
    if (boundary.rawWholeRowSecret) return secret(value);
    const boxed = witnessCreateNullRecord();
    const keys = witnessObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const keyDescriptor = witnessGetOwnPropertyDescriptor(keys, index);
      if (keyDescriptor === undefined || !('value' in keyDescriptor)) {
        throw new TypeError('Secret read rows must expose stable own data keys.');
      }
      const key = keyDescriptor.value;
      const itemDescriptor = witnessGetOwnPropertyDescriptor(value, key);
      if (itemDescriptor === undefined || !('value' in itemDescriptor)) {
        throw new TypeError('Secret read rows must expose stable own data values.');
      }
      const item = itemDescriptor.value;
      const secretColumnKeys = boundary.secretColumnScopeKnown
        ? boundary.secretColumnKeys
        : metadata.secretColumnKeys;
      const secretColumnNames = boundary.secretColumnScopeKnown
        ? boundary.secretColumnNames
        : metadata.secretColumnNames;
      const boxedValue =
        item === null || item === undefined
          ? item
          : witnessSetHas(boundary.secretResultKeys as Set<string>, key) ||
              witnessSetHas(boundary.opaqueResultKeys as Set<string>, key) ||
              witnessSetHas(secretColumnKeys as Set<string>, key) ||
              witnessSetHas(secretColumnNames as Set<string>, key)
            ? secret(item)
            : boxSecretReadRows(item, metadata, boundary);
      witnessDefineProperty(boxed, key, {
        configurable: true,
        enumerable: true,
        value: boxedValue,
        writable: true,
      });
    }
    return boxed;
  },
);

function mapDenseReadArray(
  source: readonly unknown[],
  project: (entry: unknown) => unknown,
): unknown[] {
  const lengthDescriptor = witnessGetOwnPropertyDescriptor(source, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value % 1 !== 0
  ) {
    throw new TypeError('Secret read arrays must expose a stable dense length.');
  }
  const result: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(source, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Secret read arrays must expose stable own data values.');
    }
    witnessDefineProperty(result, index, {
      configurable: true,
      enumerable: true,
      value: project(descriptor.value),
      writable: true,
    });
  }
  return result;
}

const sqliteSecretReadBoundaryForStatement = securityClassifier(
  'server.secret-read.sqlite-boundary',
  function (
    statement: unknown,
    sql: string,
    metadata: SecretReadMetadata,
    client: SecretReadSqliteColumnOriginClient,
  ): SecretReadBoundary {
    const secretResultKeys = createWitnessSet<string>();
    const opaqueResultKeys = createWitnessSet<string>();
    const expressionSafety = expressionSafetyByResultKey(statement, metadata);
    const selectedKeys = selectedResultKeysFromValue(statement);
    const referencesSecretTable = sqlReferencesSecretTable(sql, metadata.secretTableNames);
    const secretBearingCompound = sqlHasCompoundSelect(sql) && referencesSecretTable;
    const columns = sqliteResultColumns(client, sql);

    if (columns === undefined) {
      return referencesSecretTable
        ? { ...emptyReadBoundary(), rawWholeRowSecret: true }
        : { ...emptyReadBoundary(), secretColumnScopeKnown: true };
    }

    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index]!;
      const key =
        selectedKeys[index] ??
        (typeof column.name === 'string' && column.name !== '' ? column.name : undefined);
      if (key === undefined) {
        if (referencesSecretTable) return { ...emptyReadBoundary(), rawWholeRowSecret: true };
        continue;
      }
      if (secretBearingCompound) {
        witnessSetAdd(opaqueResultKeys, key);
        continue;
      }
      if (
        typeof column.table === 'string' &&
        typeof column.column === 'string' &&
        (() => {
          const names = witnessMapGet(
            metadata.secretColumnNamesByTable as Map<string, ReadonlySet<string>>,
            column.table,
          );
          return names === undefined ? false : witnessSetHas(names as Set<string>, column.column);
        })()
      ) {
        witnessSetAdd(secretResultKeys, key);
        continue;
      }
      if (typeof column.table === 'string' && typeof column.column === 'string') continue;
      if (witnessMapGet(expressionSafety, key) === 'safe') continue;
      if (referencesSecretTable || witnessMapGet(expressionSafety, key) === 'opaque') {
        witnessSetAdd(opaqueResultKeys, key);
      }
    }

    return {
      ...emptyReadBoundary(),
      declaredSecretRead: false,
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
    prop === 'crossOwnerRead' ||
    prop === 'execute' ||
    prop === 'get' ||
    prop === 'prepare' ||
    prop === 'query' ||
    prop === 'rawRead' ||
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
  if (witnessIsArray(value)) return boxSecretReadRows(value, metadata, inheritedBoundary);
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
        if (options.rawSecretTableRead !== 'engine') {
          throw new Error(
            'KV435: reader raw SQL secret-column read requires a declared secret-read capability (SPEC §10.3).',
          );
        }
        return { ...emptyReadBoundary(), secretColumnScopeKnown: true };
      }
      return { ...boundary, declaredSecretRead: true, rawWholeRowSecret: true };
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
  if (!witnessSetHas(metadata.secretTableNames as Set<string>, declaration.table)) return false;
  const secretColumns = witnessMapGet(
    metadata.secretColumnNamesByTable as Map<string, ReadonlySet<string>>,
    declaration.table,
  );
  if (secretColumns === undefined) return false;
  for (let index = 0; index < declaration.columns.length; index += 1) {
    if (!witnessSetHas(secretColumns as Set<string>, declaration.columns[index]!)) return false;
  }
  return true;
}

function mergeReadBoundaries(
  left: SecretReadBoundary,
  right: SecretReadBoundary,
): SecretReadBoundary {
  return {
    declaredSecretRead: left.declaredSecretRead || right.declaredSecretRead,
    opaqueResultKeys: unionSets(left.opaqueResultKeys, right.opaqueResultKeys),
    rawWholeRowSecret: left.rawWholeRowSecret || right.rawWholeRowSecret,
    secretResultKeys: unionSets(left.secretResultKeys, right.secretResultKeys),
    secretColumnKeys: unionSets(left.secretColumnKeys, right.secretColumnKeys),
    secretColumnNames: unionSets(left.secretColumnNames, right.secretColumnNames),
    secretColumnScopeKnown: left.secretColumnScopeKnown || right.secretColumnScopeKnown,
  };
}

function emptyReadBoundary(): SecretReadBoundary {
  const boundary = witnessFreeze({
    declaredSecretRead: false,
    opaqueResultKeys: createWitnessSet<string>(),
    rawWholeRowSecret: false,
    secretResultKeys: createWitnessSet<string>(),
    secretColumnKeys: createWitnessSet<string>(),
    secretColumnNames: createWitnessSet<string>(),
    secretColumnScopeKnown: false,
  });
  witnessWeakSetAdd(pinnedSecretReadBoundaries, boundary);
  return boundary;
}

function selectedResultKeysFromValue(value: unknown): readonly string[] {
  const fields = selectedFieldsFromValue(value);
  return fields === undefined ? [] : witnessObjectKeys(fields);
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
    return witnessIsArray(result) ? (result as SecretReadSqliteColumnOrigin[]) : undefined;
  } catch {
    return undefined;
  }
}

function expressionSafetyByResultKey(
  value: unknown,
  metadata: SecretReadMetadata,
): Map<string, 'opaque' | 'safe'> {
  const fields = selectedFieldsFromValue(value);
  const safety = createWitnessMap<string, 'opaque' | 'safe'>();
  if (fields === undefined) return safety;
  const keys = witnessObjectKeys(fields);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(fields, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      witnessMapSet(safety, key, 'opaque');
      continue;
    }
    const field = descriptor.value;
    if (isColumnLike(field)) continue;
    const verdict = classifySqlExpression(field, metadata);
    if (verdict !== undefined) witnessMapSet(safety, key, verdict);
  }
  return safety;
}

function selectedFieldsFromValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidates: unknown[] = [];
  const config = optionalOwnDataValue(value, 'config');
  const internal = optionalOwnDataValue(value, '_');
  candidates[0] =
    config !== null && typeof config === 'object'
      ? optionalOwnDataValue(config, 'fields')
      : undefined;
  candidates[1] =
    internal !== null && typeof internal === 'object'
      ? optionalOwnDataValue(internal, 'selectedFields')
      : undefined;
  candidates[2] = optionalOwnDataValue(value, 'selectedFields');
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (isPlainRecord(candidate)) return candidate;
  }
  return undefined;
}

function classifySqlExpression(
  value: unknown,
  metadata: SecretReadMetadata,
): 'opaque' | 'safe' | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const chunks = optionalOwnDataValue(value, 'queryChunks');
  if (!witnessIsArray(chunks)) return undefined;
  for (let index = 0; index < chunks.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(chunks, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      !sqlChunkIsSafe(descriptor.value, metadata)
    ) {
      return 'opaque';
    }
  }
  return 'safe';
}

function sqlChunkIsSafe(chunk: unknown, metadata: SecretReadMetadata): boolean {
  if (chunk === null || chunk === undefined) return true;
  if (typeof chunk === 'string' || typeof chunk === 'number' || typeof chunk === 'boolean') {
    return true;
  }
  if (typeof chunk !== 'object') return false;

  const source = witnessMapGet(
    metadata.columnSources as Map<object, SecretReadColumnSource>,
    chunk,
  );
  if (source !== undefined) return !source.secret;

  const nested = optionalOwnDataValue(chunk, 'queryChunks');
  if (witnessIsArray(nested)) {
    for (let index = 0; index < nested.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(nested, index);
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        !sqlChunkIsSafe(descriptor.value, metadata)
      ) {
        return false;
      }
    }
    return true;
  }

  const value = optionalOwnDataValue(chunk, 'value');
  if (witnessIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string'
      ) {
        return false;
      }
      if (sqlStringChunkHidesReadSource(descriptor.value)) {
        throw new Error(
          'KV410: raw SQL expression chunks cannot contain SELECT or FROM; use builder table bindings or a declared rawRead path so the read set stays visible (SPEC §10.2/§10.3).',
        );
      }
      if (!sqlStringChunkIsInert(descriptor.value)) return false;
    }
    return true;
  }
  return false;
}

const SAFE_SQL_WORDS = [
  'abs',
  'as',
  'avg',
  'cast',
  'coalesce',
  'collate',
  'count',
  'ifnull',
  'length',
  'lower',
  'ltrim',
  'max',
  'min',
  'null',
  'nullif',
  'round',
  'rtrim',
  'substr',
  'substring',
  'sum',
  'total',
  'trim',
  'upper',
] as const;

function sqlStringChunkIsInert(value: string): boolean {
  const words = sqlIdentifierWords(value);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === 'select' || !stringListHas(SAFE_SQL_WORDS, word)) return false;
  }
  return true;
}

function sqlStringChunkHidesReadSource(value: string): boolean {
  return sqlHasIdentifierWord(value, 'from') || sqlHasIdentifierWord(value, 'select');
}

function sqlIdentifierWords(value: string): string[] {
  const words: string[] = [];
  let index = 0;
  while (index < value.length) {
    if (!isSqlIdentifierStart(value[index]!)) {
      index += 1;
      continue;
    }
    let word = '';
    while (index < value.length && isSqlIdentifierContinue(value[index]!)) {
      word += asciiLowerCharacter(value[index]!);
      index += 1;
    }
    words[words.length] = word;
  }
  return words;
}

function sqlHasIdentifierWord(value: string, expected: string): boolean {
  const words = sqlIdentifierWords(value);
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === expected) return true;
  }
  return false;
}

function stringListHas(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function asciiLowerCharacter(value: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === value) return lower[index]!;
  }
  return value;
}

function isSqlIdentifierStart(value: string): boolean {
  const lower = asciiLowerCharacter(value);
  return (lower >= 'a' && lower <= 'z') || value === '_';
}

function isSqlIdentifierContinue(value: string): boolean {
  return isSqlIdentifierStart(value) || (value >= '0' && value <= '9') || value === '$';
}

function isDirectSqlReadMethod(prop: PropertyKey): boolean {
  return (
    prop === 'all' ||
    prop === 'execute' ||
    prop === 'get' ||
    prop === 'prepare' ||
    prop === 'query' ||
    prop === 'rawRead' ||
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
          params: witnessIsArray(result.params) ? result.params : params,
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
  const sql = optionalOwnDataValue(value, 'sql');
  if (typeof sql === 'string') return sql;
  const chunks = optionalOwnDataValue(value, 'queryChunks');
  if (witnessIsArray(chunks)) {
    let text = '';
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunkDescriptor = witnessGetOwnPropertyDescriptor(chunks, chunkIndex);
      if (chunkDescriptor === undefined || !('value' in chunkDescriptor)) return undefined;
      const chunk = chunkDescriptor.value;
      if (chunk === null || typeof chunk !== 'object') continue;
      const part = optionalOwnDataValue(chunk, 'value');
      if (!witnessIsArray(part)) continue;
      for (let partIndex = 0; partIndex < part.length; partIndex += 1) {
        const partDescriptor = witnessGetOwnPropertyDescriptor(part, partIndex);
        if (partDescriptor === undefined || !('value' in partDescriptor)) return undefined;
        if (typeof partDescriptor.value === 'string') text += partDescriptor.value;
      }
    }
    return text || undefined;
  }
  return undefined;
}

function sqlReferencesSecretTable(sql: string, secretTableNames: ReadonlySet<string>): boolean {
  let references = false;
  witnessSetForEach(secretTableNames as Set<string>, (table) => {
    if (sqlReferencesTable(sql, table)) references = true;
  });
  return references;
}

function sqlHasCompoundSelect(sql: string): boolean {
  return (
    sqlHasIdentifierWord(sql, 'union') ||
    sqlHasIdentifierWord(sql, 'intersect') ||
    sqlHasIdentifierWord(sql, 'except')
  );
}

function sqlReferencesTable(sql: string, table: string): boolean {
  const expected = asciiLower(table);
  for (let start = 0; start < sql.length; start += 1) {
    const quoted = sql[start] === '"';
    const valueStart = quoted ? start + 1 : start;
    let matches = true;
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (asciiLowerCharacter(sql[valueStart + offset] ?? '') !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const before = sql[valueStart - 1];
    const after = sql[valueStart + expected.length];
    if (
      (!quoted && before !== undefined && isSqlIdentifierContinue(before)) ||
      (quoted && after !== '"') ||
      (!quoted && after !== undefined && isSqlIdentifierContinue(after))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function asciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += asciiLowerCharacter(value[index]!);
  }
  return result;
}

function isColumnLike(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !witnessIsArray(value);
}

function unionSets(left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlySet<string> {
  if (witnessSetSize(left as Set<string>) === 0) return right;
  if (witnessSetSize(right as Set<string>) === 0) return left;
  const union = createWitnessSet<string>();
  witnessSetForEach(left as Set<string>, (value) => witnessSetAdd(union, value));
  witnessSetForEach(right as Set<string>, (value) => witnessSetAdd(union, value));
  return union;
}
