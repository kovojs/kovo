import { secret } from '@kovojs/core';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import {
  createWitnessMap,
  createWitnessSet,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessObjectKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessSetAdd,
  witnessSetForEach,
  witnessSetHas,
  witnessSetSize,
  witnessWeakSetAdd,
  witnessWeakSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const NativePromise = globalThis.Promise;
const nativePromiseThen = witnessReflectGet(NativePromise.prototype, 'then') as Function;
const nativePromiseResolve = witnessReflectGet(NativePromise, 'resolve') as Function;
const nativeFunctionHasInstance = Function.prototype[Symbol.hasInstance];

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
  prepare(sql: string): {
    all?: (...params: unknown[]) => unknown;
    columns?: () => unknown;
    get?: (...params: unknown[]) => unknown;
    values?: (...params: unknown[]) => unknown;
  };
}

/** Options for the server-owned read-confidentiality boundary wrapper. */
export interface SecretReadBoundaryOptions {
  /** Framework adapter executor used to bind an async builder verdict to the exact SQL carrier. */
  executeSql?: (
    statement: Readonly<{ params: readonly unknown[]; text: string }>,
    mode: SecretReadExecutionMode,
  ) => unknown;
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
  boxEveryResultValue: boolean;
  declaredSecretRead: boolean;
  opaqueResultKeys: ReadonlySet<string>;
  rawWholeRowSecret: boolean;
  secretResultKeys: ReadonlySet<string>;
  secretColumnKeys: ReadonlySet<string>;
  secretColumnNames: ReadonlySet<string>;
  secretColumnScopeKnown: boolean;
}

export type SecretReadExecutionMode = 'all' | 'get' | 'values';

interface ExactSecretReadExecution {
  readonly columns: readonly SecretReadSqliteColumnOrigin[] | undefined;
  readonly exactColumns: boolean;
  execute(): unknown;
}

interface PinnedRelationalReadQuery {
  readonly carrier: SqlCarrier;
  readonly nestedResultKeys: ReadonlySet<string>;
  readonly opaqueResultKeys: ReadonlySet<string>;
  readonly preparedTerminals: ReadonlySet<string>;
  execute(property: PropertyKey, args: readonly unknown[]): unknown;
}

const declaredSecretReadCapabilities = createWitnessWeakMap<object, DeclaredSecretReadCapability>();
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
  const justification = optionalOwnDataValue(declaration, 'justification');
  const source = optionalOwnDataValue(declaration, 'source');
  const table = optionalOwnDataValue(declaration, 'table');
  const columnsValue = optionalOwnDataValue(declaration, 'columns');
  if (typeof justification !== 'string' || trimSecurityString(justification) === '') {
    throw new Error('KV435: declared secret-read capability requires a justification.');
  }
  if (
    typeof source !== 'string' ||
    typeof table !== 'string' ||
    trimSecurityString(source) === '' ||
    trimSecurityString(table) === ''
  ) {
    throw new Error('KV435: declared secret-read capability requires a source table.');
  }
  if (!witnessIsArray(columnsValue) || columnsValue.length === 0) {
    throw new Error('KV435: declared secret-read capability requires at least one secret column.');
  }
  const columns: string[] = [];
  for (let index = 0; index < columnsValue.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(columnsValue, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      trimSecurityString(descriptor.value) === ''
    ) {
      throw new Error('KV435: declared secret-read capability requires secret column names.');
    }
    witnessDefineProperty(columns, columns.length, { value: descriptor.value, writable: true });
  }
  witnessWeakMapSet(
    declaredSecretReadCapabilities,
    statement,
    witnessFreeze({ columns: witnessFreeze(columns), justification, source, table }),
  );
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
  const pinnedOptions = snapshotSecretReadBoundaryOptions(options);
  return new Proxy(db as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const item = witnessReflectGet(target, prop, receiver);
      if (prop === 'query' && item !== null && typeof item === 'object') {
        return wrapReadSurface(item, pinnedMetadata, emptyReadBoundary(), pinnedOptions);
      }
      if (typeof item !== 'function') return item;
      if (!isReadSurfaceMethod(prop)) {
        return (...args: unknown[]) => witnessReflectApply(item, target, args);
      }
      return (...args: unknown[]) => {
        const boundary = readBoundaryForArgs(
          args,
          pinnedMetadata,
          isDirectSqlReadMethod(prop),
          pinnedOptions,
        );
        const readTarget =
          boundary.declaredSecretRead && pinnedOptions.privilegedDb !== undefined
            ? (pinnedOptions.privilegedDb as Record<PropertyKey, unknown>)
            : target;
        const readMethod = witnessReflectGet(readTarget, prop, receiver);
        if (typeof readMethod !== 'function') return readMethod;
        return wrapReadSurface(
          witnessReflectApply(readMethod, readTarget, args),
          pinnedMetadata,
          boundary,
          pinnedOptions,
        );
      };
    },
  }) as Db;
}

function snapshotSecretReadBoundaryOptions(
  options: SecretReadBoundaryOptions,
): SecretReadBoundaryOptions {
  const rawSecretTableRead = optionalOwnDataValue(options, 'rawSecretTableRead');
  if (
    rawSecretTableRead !== undefined &&
    rawSecretTableRead !== 'engine' &&
    rawSecretTableRead !== 'throw'
  ) {
    throw new TypeError('Secret read raw-table posture must be engine or throw.');
  }
  const privilegedDb = optionalOwnDataValue(options, 'privilegedDb');
  if (privilegedDb !== undefined && !isObjectLike(privilegedDb)) {
    throw new TypeError('Secret read privilegedDb must be an object handle.');
  }
  const originClient = optionalOwnDataValue(options, 'sqliteColumnOrigins');
  if (originClient !== undefined && !isObjectLike(originClient)) {
    throw new TypeError('Secret read SQLite origins must be an object handle.');
  }
  const executor = optionalOwnDataValue(options, 'executeSql');
  if (executor !== undefined && typeof executor !== 'function') {
    throw new TypeError('Secret read exact executor must be a function.');
  }
  const snapshot: SecretReadBoundaryOptions = {};
  if (typeof executor === 'function') {
    witnessDefineProperty(snapshot, 'executeSql', {
      value(
        statement: Readonly<{ params: readonly unknown[]; text: string }>,
        mode: SecretReadExecutionMode,
      ) {
        return witnessReflectApply(executor, options, [statement, mode]);
      },
    });
  }
  if (privilegedDb !== undefined) {
    witnessDefineProperty(snapshot, 'privilegedDb', { value: privilegedDb });
  }
  if (rawSecretTableRead !== undefined) {
    witnessDefineProperty(snapshot, 'rawSecretTableRead', { value: rawSecretTableRead });
  }
  if (originClient !== undefined) {
    witnessDefineProperty(snapshot, 'sqliteColumnOrigins', {
      value: pinSqliteColumnOriginClient(originClient),
    });
  }
  return witnessFreeze(snapshot);
}

function pinSqliteColumnOriginClient(value: object): SecretReadSqliteColumnOriginClient {
  const prepare = inheritedFunctionDataProperty(value, 'prepare');
  return witnessFreeze({
    prepare(sql: string) {
      const statement = witnessReflectApply<unknown>(prepare, value, [sql]);
      if (!isObjectLike(statement)) {
        throw new TypeError('SQLite prepare did not return a statement object.');
      }
      const facade = witnessCreateNullRecord<Function>();
      const methods = ['all', 'columns', 'get', 'values'] as const;
      for (let index = 0; index < methods.length; index += 1) {
        const methodDescriptor = witnessGetOwnPropertyDescriptor(methods, index);
        if (methodDescriptor === undefined || !('value' in methodDescriptor)) {
          throw new TypeError('SQLite statement method list integrity failed.');
        }
        const method = optionalInheritedFunctionDataProperty(statement, methodDescriptor.value);
        if (method === undefined) continue;
        witnessDefineProperty(facade, methodDescriptor.value, {
          value:
            methodDescriptor.value === 'columns'
              ? () => snapshotSqliteColumnOrigins(witnessReflectApply(method, statement, []))
              : (...params: unknown[]) => witnessReflectApply(method, statement, params),
        });
      }
      return witnessFreeze(facade);
    },
  });
}

function inheritedFunctionDataProperty(value: object, property: PropertyKey): Function {
  const result = optionalInheritedFunctionDataProperty(value, property);
  if (result === undefined) {
    throw new TypeError(`${String(property)} must be an inherited data function.`);
  }
  return result;
}

function optionalInheritedFunctionDataProperty(
  value: object,
  property: PropertyKey,
): Function | undefined {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = witnessGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) {
        throw new TypeError(`${String(property)} cannot be accessor-backed.`);
      }
      return typeof descriptor.value === 'function' ? descriptor.value : undefined;
    }
    current = witnessGetPrototypeOf(current);
  }
  return undefined;
}

function snapshotSqliteColumnOrigins(
  value: unknown,
): readonly SecretReadSqliteColumnOrigin[] | undefined {
  if (!witnessIsArray(value)) return undefined;
  const snapshot: SecretReadSqliteColumnOrigin[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor) || !isObjectLike(descriptor.value)) {
      throw new TypeError('SQLite column origins must be a dense object array.');
    }
    const origin = descriptor.value;
    const column = optionalOwnDataValue(origin, 'column');
    const name = optionalOwnDataValue(origin, 'name');
    const table = optionalOwnDataValue(origin, 'table');
    const fields = [column, name, table];
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const fieldDescriptor = witnessGetOwnPropertyDescriptor(fields, fieldIndex);
      if (fieldDescriptor === undefined || !('value' in fieldDescriptor)) {
        throw new TypeError('SQLite column origin field list integrity failed.');
      }
      const item = fieldDescriptor.value;
      if (item !== undefined && item !== null && typeof item !== 'string') {
        throw new TypeError('SQLite column origin fields must be strings or null.');
      }
    }
    const pinned = witnessCreateNullRecord<string | null | undefined>();
    witnessDefineProperty(pinned, 'column', { enumerable: true, value: column });
    witnessDefineProperty(pinned, 'name', { enumerable: true, value: name });
    witnessDefineProperty(pinned, 'table', { enumerable: true, value: table });
    witnessDefineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: witnessFreeze(pinned),
      writable: true,
    });
  }
  return witnessFreeze(snapshot);
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
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
    boxEveryResultValue: ownBooleanDataValue(boundary, 'boxEveryResultValue'),
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
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') {
      return boundary.boxEveryResultValue ? secret(value) : value;
    }
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
      const boxEveryLeaf =
        boundary.boxEveryResultValue && item !== null && typeof item === 'object'
          ? boxSecretReadRows(item, metadata, boundary)
          : undefined;
      const boxedValue =
        item === null || item === undefined
          ? item
          : boxEveryLeaf !== undefined
            ? boxEveryLeaf
            : boundary.boxEveryResultValue ||
                witnessSetHas(boundary.secretResultKeys as Set<string>, key) ||
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
    client: SecretReadSqliteColumnOriginClient | undefined,
    exactColumns?: readonly SecretReadSqliteColumnOrigin[],
    nestedResultKeys?: ReadonlySet<string>,
  ): SecretReadBoundary {
    const secretResultKeys = createWitnessSet<string>();
    const opaqueResultKeys = createWitnessSet<string>();
    const expressionSafety = expressionSafetyByResultKey(statement, metadata);
    const selectedKeys = selectedResultKeysFromValue(statement);
    const referencesSecretTable = sqlReferencesSecretTable(sql, metadata.secretTableNames);
    const secretBearingCompound = sqlHasCompoundSelect(sql) && referencesSecretTable;
    const columns = exactColumns ?? (client === undefined ? undefined : sqliteResultColumns(client, sql));

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
        nestedResultKeys !== undefined &&
        witnessSetHas(nestedResultKeys as Set<string>, key)
      ) {
        // Drizzle relational selections encode a nested relation into one driver JSON column.
        // Preserve that container so the post-mapping walk can classify each nested schema key.
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
  inheritedRelationalQuery?: PinnedRelationalReadQuery,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (witnessIsArray(value)) return boxSecretReadRows(value, metadata, inheritedBoundary);
  if (isNativePromise(value)) {
    return witnessReflectApply(nativePromiseThen, value, [
      (result: unknown) => boxSecretReadRows(result, metadata, inheritedBoundary),
    ]);
  }
  const relationalQuery = inheritedRelationalQuery ?? pinRelationalReadQuery(value);
  return new Proxy(value, {
    get(target, prop, receiver) {
      const item = witnessReflectGet(target, prop, receiver);
      if (prop === 'then' && typeof item === 'function') {
        const carrier = relationalQuery?.carrier ?? sqlCarrierFromValue(target, []);
        const exact =
          carrier === undefined
            ? undefined
            : exactSecretReadExecution(target, carrier, 'all', options);
        const boundary = mergeReadBoundaries(
          mergeReadBoundaries(
            inheritedBoundary,
            readBoundaryForQuery(
              target,
              carrier,
              metadata,
              options,
              exact,
              relationalQuery,
            ),
          ),
          relationalReadBoundary(relationalQuery, metadata),
        );
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => {
          if (relationalQuery !== undefined) {
            const settled = settleSecretReadResult(relationalQuery.execute('execute', []));
            return witnessReflectApply(nativePromiseThen, settled, [
              (result: unknown) =>
                onFulfilled?.(boxSecretReadRows(result, metadata, boundary)),
              onRejected,
            ]);
          }
          if (exact !== undefined) {
            const settled = witnessReflectApply<Promise<unknown>>(
              nativePromiseResolve,
              NativePromise,
              [exact.execute()],
            );
            return witnessReflectApply(nativePromiseThen, settled, [
              (result: unknown) =>
                onFulfilled?.(boxSecretReadRows(result, metadata, boundary)),
              onRejected,
            ]);
          }
          const fallback = failClosedExecutionBoundary(boundary);
          return witnessReflectApply(item, target, [
            (result: unknown) =>
              onFulfilled?.(boxSecretReadRows(result, metadata, fallback)),
            onRejected,
          ]);
        };
      }
      if (typeof item !== 'function') {
        return item !== null && typeof item === 'object'
          ? wrapReadSurface(item, metadata, inheritedBoundary, options)
          : item;
      }
      return (...args: unknown[]) => {
        if (prop === 'prepare' && relationalQuery !== undefined) {
          if (args.length !== 0) {
            throw new TypeError('Relational prepare does not accept arguments.');
          }
          return wrapReadSurface(
            createPinnedRelationalPreparedFacade(relationalQuery),
            metadata,
            inheritedBoundary,
            options,
            relationalQuery,
          );
        }
        const terminalMode = readBuilderTerminalMode(prop, args);
        if (terminalMode !== undefined) {
          const carrier = relationalQuery?.carrier ?? sqlCarrierFromValue(target, []);
          const exact =
            carrier === undefined ||
            relationalQuery !== undefined ||
            args.length !== 0
              ? undefined
              : exactSecretReadExecution(target, carrier, terminalMode, options);
          const boundary = mergeReadBoundaries(
            mergeReadBoundaries(
              inheritedBoundary,
              readBoundaryForQuery(
                target,
                carrier,
                metadata,
                options,
                exact,
                relationalQuery,
              ),
            ),
            relationalReadBoundary(relationalQuery, metadata),
          );
          if (relationalQuery !== undefined) {
            const result = relationalQuery.execute(prop, args);
            const terminalBoundary =
              prop === 'values' ? failClosedExecutionBoundary(boundary) : boundary;
            if (prop === 'sync') return boxSecretReadRows(result, metadata, terminalBoundary);
            return boxSecretReadExecutionResult(result, metadata, terminalBoundary);
          }
          const result =
            exact === undefined
              ? witnessReflectApply(item, target, args)
              : exact.execute();
          return boxSecretReadExecutionResult(
            result,
            metadata,
            exact === undefined ? failClosedExecutionBoundary(boundary) : boundary,
          );
        }
        const boundary = mergeReadBoundaries(
          inheritedBoundary,
          readBoundaryForArgs(args, metadata, false, options),
        );
        return wrapReadSurface(
          witnessReflectApply(item, target, args),
          metadata,
          boundary,
          options,
        );
      };
    },
  });
}

function readBoundaryForQuery(
  value: unknown,
  carrier: SqlCarrier | undefined,
  metadata: SecretReadMetadata,
  options: SecretReadBoundaryOptions,
  exact: ExactSecretReadExecution | undefined,
  relationalQuery?: PinnedRelationalReadQuery,
): SecretReadBoundary {
  if (carrier === undefined) return failClosedExecutionBoundary(emptyReadBoundary());
  if (exact?.exactColumns === true) {
    return sqliteSecretReadBoundaryForStatement(
      value,
      carrier.text,
      metadata,
      undefined,
      exact.columns,
      relationalQuery?.nestedResultKeys,
    );
  }
  return options.sqliteColumnOrigins === undefined
    ? relationalQuery === undefined
      ? fallbackReadBoundaryForSql(carrier.text, metadata)
      : { ...emptyReadBoundary(), secretColumnScopeKnown: true }
    : sqliteSecretReadBoundaryForStatement(
        value,
        carrier.text,
        metadata,
        options.sqliteColumnOrigins,
        undefined,
        relationalQuery?.nestedResultKeys,
      );
}

function pinRelationalReadQuery(value: object): PinnedRelationalReadQuery | undefined {
  const configValue = optionalOwnDataValue(value, 'config');
  const tableConfig = optionalOwnDataValue(value, 'tableConfig');
  if ((configValue !== true && !isPlainRecord(configValue)) || !isPlainRecord(tableConfig)) {
    return undefined;
  }
  const config = configValue === true ? witnessCreateNullRecord<unknown>() : configValue;
  const prepare = optionalInheritedFunctionDataProperty(value, '_prepare');
  if (prepare === undefined) return undefined;
  // Compile once now. The private prepared object binds the exact config/SQL/mapping that every
  // later terminal below executes, so a retained app config reference cannot split the verdict
  // from a second relational compilation (SPEC §6.6 C9, §10.3).
  const prepared = witnessReflectApply<unknown>(prepare, value, []);
  if (!isObjectLike(prepared)) {
    throw new TypeError('Relational query preparation did not return an object.');
  }
  const query = ownDataValue(prepared, 'query');
  const carrier = sqlCarrierFromValue(query, []);
  const terminalMethods = createWitnessMap<string, Function>();
  const preparedTerminals = createWitnessSet<string>();
  const terminalNames = ['all', 'execute', 'get', 'values'] as const;
  for (let index = 0; index < terminalNames.length; index += 1) {
    const name = terminalNames[index]!;
    const method = optionalInheritedFunctionDataProperty(prepared, name);
    if (method === undefined) continue;
    witnessMapSet(terminalMethods, name, method);
    witnessSetAdd(preparedTerminals, name);
  }
  if (carrier === undefined || !witnessSetHas(preparedTerminals, 'execute')) {
    throw new TypeError('Relational query preparation did not expose stable SQL execution.');
  }
  const posture = relationalResultPosture(config);
  return witnessFreeze({
    carrier,
    nestedResultKeys: posture.nestedResultKeys,
    opaqueResultKeys: posture.opaqueResultKeys,
    preparedTerminals,
    execute(property: PropertyKey, args: readonly unknown[]) {
      if (args.length > 1) {
        throw new TypeError('Relational query terminals accept at most one placeholder bag.');
      }
      const terminal = property === 'sync' ? 'execute' : property;
      if (typeof terminal !== 'string') {
        throw new TypeError('Relational query terminal must be a string property.');
      }
      const method = witnessMapGet(terminalMethods, terminal);
      if (method === undefined) {
        throw new TypeError(`Relational prepared query does not support ${terminal}.`);
      }
      const result = witnessReflectApply<unknown>(
        method,
        prepared,
        args.length === 0 ? [] : [args[0]],
      );
      if (property !== 'sync') return result;
      if (!isObjectLike(result)) {
        throw new TypeError('Synchronous relational execution did not return a sync carrier.');
      }
      const sync = optionalInheritedFunctionDataProperty(result, 'sync');
      if (sync === undefined) {
        throw new TypeError('Relational query is not available synchronously on this adapter.');
      }
      return witnessReflectApply(sync, result, []);
    },
  });
}

function createPinnedRelationalPreparedFacade(
  query: PinnedRelationalReadQuery,
): Record<PropertyKey, unknown> {
  const facade = witnessCreateNullRecord<unknown>();
  witnessSetForEach(query.preparedTerminals as Set<string>, (property) => {
    witnessDefineProperty(facade, property, {
      configurable: true,
      enumerable: false,
      value() {
        throw new TypeError('Pinned relational terminals must execute through their wrapper.');
      },
      writable: false,
    });
  });
  return facade;
}

function relationalResultPosture(config: Record<string, unknown>): {
  nestedResultKeys: ReadonlySet<string>;
  opaqueResultKeys: ReadonlySet<string>;
} {
  const nestedResultKeys = createWitnessSet<string>();
  const opaqueResultKeys = createWitnessSet<string>();
  const seen = createWitnessWeakSet<object>();
  const visit = (current: Record<string, unknown>, depth: number): void => {
    if (depth > 32 || witnessWeakSetHas(seen, current)) {
      throw new TypeError('Relational query config must be finite.');
    }
    witnessWeakSetAdd(seen, current);
    const extras = stableRelationalConfigValue(current, 'extras');
    if (extras !== undefined) {
      if (!isPlainRecord(extras)) throw new TypeError('Relational extras must be a record.');
      const extraKeys = witnessObjectKeys(extras);
      for (let index = 0; index < extraKeys.length; index += 1) {
        witnessSetAdd(opaqueResultKeys, extraKeys[index]!);
      }
    }
    const relations = stableRelationalConfigValue(current, 'with');
    if (relations === undefined) return;
    if (!isPlainRecord(relations)) throw new TypeError('Relational with must be a record.');
    const relationKeys = witnessObjectKeys(relations);
    for (let index = 0; index < relationKeys.length; index += 1) {
      const key = relationKeys[index]!;
      const descriptor = witnessGetOwnPropertyDescriptor(relations, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Relational selections must use own data properties.');
      }
      if (descriptor.value === false || descriptor.value === undefined) continue;
      witnessSetAdd(nestedResultKeys, key);
      if (isPlainRecord(descriptor.value)) visit(descriptor.value, depth + 1);
      else if (descriptor.value !== true) {
        throw new TypeError('Relational selections must be true or a config record.');
      }
    }
  };
  visit(config, 0);
  return {
    nestedResultKeys: witnessFreeze(nestedResultKeys),
    opaqueResultKeys: witnessFreeze(opaqueResultKeys),
  };
}

function stableRelationalConfigValue(
  config: Record<string, unknown>,
  property: 'extras' | 'with',
): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(config, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`Relational ${property} cannot be accessor-backed.`);
  }
  return descriptor.value;
}

function relationalReadBoundary(
  query: PinnedRelationalReadQuery | undefined,
  metadata: SecretReadMetadata,
): SecretReadBoundary {
  return query === undefined
    ? emptyReadBoundary()
    : {
        ...emptyReadBoundary(),
        opaqueResultKeys: query.opaqueResultKeys,
        secretColumnKeys: metadata.secretColumnKeys,
        secretColumnNames: metadata.secretColumnNames,
        secretColumnScopeKnown: true,
      };
}

function readBuilderTerminalMode(
  property: PropertyKey,
  _args: readonly unknown[],
): SecretReadExecutionMode | undefined {
  if (property === 'get') return 'get';
  if (property === 'values') return 'values';
  return property === 'all' || property === 'execute' || property === 'sync'
    ? 'all'
    : undefined;
}

function exactSecretReadExecution(
  query: unknown,
  carrier: SqlCarrier,
  mode: SecretReadExecutionMode,
  options: SecretReadBoundaryOptions,
): ExactSecretReadExecution | undefined {
  if (options.sqliteColumnOrigins !== undefined) {
    try {
      const statement = options.sqliteColumnOrigins.prepare(carrier.text);
      const columnsMethod = optionalInheritedFunctionDataProperty(statement, 'columns');
      const executionMethod = optionalInheritedFunctionDataProperty(statement, mode);
      if (executionMethod !== undefined) {
        const columns =
          columnsMethod === undefined
            ? undefined
            : snapshotSqliteColumnOrigins(
                witnessReflectApply(columnsMethod, statement, []),
              );
        return witnessFreeze({
          columns,
          exactColumns: true,
          execute: () =>
            mapExactSqliteReadResult(
              witnessReflectApply(executionMethod, statement, carrier.params),
              query,
              columns,
              mode,
            ),
        });
      }
    } catch {
      return undefined;
    }
  }
  if (options.executeSql === undefined) return undefined;
  const executeSql = options.executeSql;
  return witnessFreeze({
    columns: undefined,
    exactColumns: false,
    execute: () => executeSql(carrier, mode),
  });
}

function mapExactSqliteReadResult(
  result: unknown,
  query: unknown,
  columns: readonly SecretReadSqliteColumnOrigin[] | undefined,
  mode: SecretReadExecutionMode,
): unknown {
  if (columns === undefined || mode === 'values') return result;
  const selectedKeys = selectedResultKeysFromValue(query);
  if (selectedKeys.length !== columns.length) return result;
  if (witnessIsArray(result)) {
    return mapDenseReadArray(result, (row) =>
      mapExactSqliteReadRow(row, selectedKeys, columns),
    );
  }
  return mapExactSqliteReadRow(result, selectedKeys, columns);
}

function mapExactSqliteReadRow(
  row: unknown,
  selectedKeys: readonly string[],
  columns: readonly SecretReadSqliteColumnOrigin[],
): unknown {
  if (!isObjectLike(row)) return row;
  const mapped = witnessCreateNullRecord();
  for (let index = 0; index < columns.length; index += 1) {
    const columnDescriptor = witnessGetOwnPropertyDescriptor(columns, index);
    const keyDescriptor = witnessGetOwnPropertyDescriptor(selectedKeys, index);
    if (
      columnDescriptor === undefined ||
      !('value' in columnDescriptor) ||
      keyDescriptor === undefined ||
      !('value' in keyDescriptor)
    ) {
      throw new TypeError('SQLite exact read projection must be dense.');
    }
    const sourceName = columnDescriptor.value.name;
    if (typeof sourceName !== 'string') return row;
    const valueDescriptor = witnessGetOwnPropertyDescriptor(row, sourceName);
    if (valueDescriptor === undefined || !('value' in valueDescriptor)) return row;
    witnessDefineProperty(mapped, keyDescriptor.value, {
      configurable: true,
      enumerable: true,
      value: valueDescriptor.value,
      writable: true,
    });
  }
  return mapped;
}

function boxSecretReadExecutionResult(
  result: unknown,
  metadata: SecretReadMetadata,
  boundary: SecretReadBoundary,
): unknown {
  if (result !== null && typeof result === 'object') {
    if (isNativePromise(result)) {
      return witnessReflectApply(nativePromiseThen, result, [
        (value: unknown) => boxSecretReadRows(value, metadata, boundary),
      ]);
    }
    const then = optionalInheritedFunctionDataProperty(result, 'then');
    if (then !== undefined) {
      return witnessReflectApply(nativePromiseThen, settleSecretReadResult(result, then), [
        (value: unknown) => boxSecretReadRows(value, metadata, boundary),
      ]);
    }
  }
  return boxSecretReadRows(result, metadata, boundary);
}

function settleSecretReadResult(result: unknown, pinnedThen?: Function): Promise<unknown> {
  if (result !== null && typeof result === 'object' && isNativePromise(result)) return result;
  return new NativePromise((resolve, reject) => {
    if (result === null || typeof result !== 'object') {
      resolve(result);
      return;
    }
    let then = pinnedThen;
    try {
      then ??= optionalInheritedFunctionDataProperty(result, 'then');
      if (then === undefined) {
        resolve(result);
        return;
      }
      witnessReflectApply(then, result, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function failClosedExecutionBoundary(boundary: SecretReadBoundary): SecretReadBoundary {
  const empty = emptyReadBoundary();
  return mergeReadBoundaries(boundary, {
    boxEveryResultValue: true,
    declaredSecretRead: empty.declaredSecretRead,
    opaqueResultKeys: empty.opaqueResultKeys,
    rawWholeRowSecret: empty.rawWholeRowSecret,
    secretColumnKeys: empty.secretColumnKeys,
    secretColumnNames: empty.secretColumnNames,
    secretColumnScopeKnown: empty.secretColumnScopeKnown,
    secretResultKeys: empty.secretResultKeys,
  });
}

function readBoundaryForArgs(
  args: readonly unknown[],
  metadata: SecretReadMetadata,
  directSqlRead: boolean,
  options: SecretReadBoundaryOptions,
): SecretReadBoundary {
  if (!directSqlRead) return emptyReadBoundary();
  for (let index = 0; index < args.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(args, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      return { ...emptyReadBoundary(), rawWholeRowSecret: true };
    }
    const arg = descriptor.value;
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
  const declaration = witnessWeakMapGet(declaredSecretReadCapabilities, statement);
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

function isNativePromise(value: object): value is Promise<unknown> {
  return witnessReflectApply<boolean>(nativeFunctionHasInstance, NativePromise, [value]);
}

function mergeReadBoundaries(
  left: SecretReadBoundary,
  right: SecretReadBoundary,
): SecretReadBoundary {
  return {
    boxEveryResultValue: left.boxEveryResultValue || right.boxEveryResultValue,
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
    boxEveryResultValue: false,
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
    const result = witnessReflectApply<unknown>(columns, statement, []);
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
  const config = optionalOwnDataValue(value, 'config');
  const internal = optionalOwnDataValue(value, '_');
  const configFields =
    config !== null && typeof config === 'object'
      ? optionalOwnDataValue(config, 'fields')
      : undefined;
  if (isPlainRecord(configFields)) return configFields;
  const internalFields =
    internal !== null && typeof internal === 'object'
      ? optionalOwnDataValue(internal, 'selectedFields')
      : undefined;
  if (isPlainRecord(internalFields)) return internalFields;
  const selectedFields = optionalOwnDataValue(value, 'selectedFields');
  return isPlainRecord(selectedFields) ? selectedFields : undefined;
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
    witnessDefineProperty(words, words.length, {
      configurable: true,
      enumerable: true,
      value: word,
      writable: true,
    });
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

function trimSecurityString(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isSecurityWhitespace(value[start]!)) start += 1;
  while (end > start && isSecurityWhitespace(value[end - 1]!)) end -= 1;
  let trimmed = '';
  for (let index = start; index < end; index += 1) trimmed += value[index];
  return trimmed;
}

function isSecurityWhitespace(value: string): boolean {
  return (
    value === ' ' ||
    value === '\t' ||
    value === '\n' ||
    value === '\r' ||
    value === '\f' ||
    value === '\v' ||
    value === '\u00a0' ||
    value === '\u1680' ||
    (value >= '\u2000' && value <= '\u200a') ||
    value === '\u2028' ||
    value === '\u2029' ||
    value === '\u202f' ||
    value === '\u205f' ||
    value === '\u3000' ||
    value === '\ufeff'
  );
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
  if (typeof value === 'string') {
    return witnessFreeze({ params: snapshotSqlCarrierParams(params), text: value });
  }
  const toSQL = isObjectLike(value)
    ? optionalInheritedFunctionDataProperty(value, 'toSQL')
    : undefined;
  if (toSQL !== undefined && isObjectLike(value)) {
    try {
      const result = witnessReflectApply<unknown>(toSQL, value, []);
      if (isObjectLike(result)) {
        const sql = optionalOwnDataValue(result, 'sql');
        const resultParams = optionalOwnDataValue(result, 'params');
        if (typeof sql === 'string') {
          return witnessFreeze({
            params: snapshotSqlCarrierParams(
              witnessIsArray(resultParams) ? resultParams : params,
            ),
            text: sql,
          });
        }
      }
    } catch {
      return undefined;
    }
  }
  const text = sqlTextFromValue(value);
  if (text !== undefined) {
    return witnessFreeze({ params: snapshotSqlCarrierParams(params), text });
  }
  return undefined;
}

function snapshotSqlCarrierParams(params: readonly unknown[]): readonly unknown[] {
  const snapshot: unknown[] = [];
  for (let index = 0; index < params.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(params, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Secret read SQL parameters must be a dense own-data array.');
    }
    witnessDefineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return witnessFreeze(snapshot);
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
