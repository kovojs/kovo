import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';

import {
  runtimeArrayAppend,
  runtimeArrayIsArray,
  runtimeArrayLength,
  runtimeArrayValue,
  runtimeFreeze,
  runtimeMap,
  runtimeMapForEach,
  runtimeMapGet,
  runtimeMapHas,
  runtimeMapSet,
  runtimeObjectKeys,
  runtimeObjectSymbols,
  runtimeOwnDataValue,
  runtimeRegExpTest,
  runtimeSealMap,
  runtimeSealSet,
  runtimeSet,
  runtimeSetAdd,
  runtimeSetForEach,
  runtimeSetHas,
  runtimeSetSize,
  runtimeSnapshotArray,
} from './runtime-security-intrinsics.js';

/** Drizzle table object accepted by `extractKovoRuntimeDbMetadata`. */
export type KovoRuntimeDbTable =
  | Parameters<typeof getPgTableConfig>[0]
  | Parameters<typeof getSqliteTableConfig>[0];
type KovoRuntimeDbColumn = {
  name: string;
};
type KovoRuntimeDbTableConfig = {
  columns: readonly KovoRuntimeDbColumn[];
  name: string;
};
type KovoRuntimeColumnRef = string | ((table: Record<string, unknown>) => unknown);
type KovoRuntimeColumnAnnotation = true | KovoRuntimeColumnRef | readonly unknown[];
type KovoRuntimeDomainAnnotation = {
  authzPolicy?: unknown;
  confidentialAtRest?: KovoRuntimeColumnAnnotation;
  domain: unknown;
  governed?: KovoRuntimeColumnAnnotation;
  key?: KovoRuntimeColumnRef;
  owner?: KovoRuntimeColumnRef;
  ownerVia?: {
    fk?: unknown;
    parent?: unknown;
    parentKey?: unknown;
  };
  public?: true;
  reference?: true;
};

/** Drizzle-derived runtime source metadata for one physical database column. */
export interface KovoRuntimeDbColumnSource {
  /** Physical database column name. */
  column: string;
  /** Drizzle selection key for the column. */
  key: string;
  /** Whether the column is declared secret in Kovo metadata. */
  secret: boolean;
  /** Physical database table name. */
  table: string;
}

/** Drizzle-derived runtime authorization classification for one physical database table. */
export type KovoRuntimeAuthorizationClassification =
  | 'authzPolicy'
  | 'owned'
  | 'ownedVia'
  | 'public'
  | 'reference';

/** Direct owner-column metadata for one physical database table. */
export interface KovoRuntimeOwnerSource {
  /** Drizzle selection key for the owner column. */
  columnKey: string;
  /** Physical database owner column name. */
  columnName: string;
  /** Physical database table name. */
  table: string;
}

/** Transitive owner metadata for one child table whose owner comes from a parent table. */
export interface KovoRuntimeOwnerViaSource {
  /** Drizzle selection key for the child foreign-key column. */
  fkColumnKey: string;
  /** Physical database child foreign-key column name. */
  fkColumnName: string;
  /** Physical database parent table name. */
  parentTable: string;
  /** Drizzle selection key for the parent key column reached by the child FK. */
  parentKeyColumnKey: string;
  /** Physical database parent key column name reached by the child FK. */
  parentKeyColumnName: string;
  /** Physical database child table name. */
  table: string;
}

/** Drizzle-derived metadata consumed by the server read-confidentiality boundary. */
export interface KovoRuntimeDbMetadata {
  /** Every known Drizzle column key in the schema. */
  allColumnKeys: ReadonlySet<string>;
  /** Runtime authorization classifications grouped by physical table. */
  authorizationClassificationsByTable: ReadonlyMap<
    string,
    readonly KovoRuntimeAuthorizationClassification[]
  >;
  /** Runtime object identity map for Drizzle column objects used in SQL expressions. */
  columnSources: ReadonlyMap<object, KovoRuntimeDbColumnSource>;
  /** Governed Drizzle column keys grouped by physical table. */
  governedColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Governed physical column names grouped by physical table. */
  governedColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Owner-column facts grouped by physical table. */
  ownerSourcesByTable: ReadonlyMap<string, KovoRuntimeOwnerSource>;
  /** Transitive owner facts grouped by physical child table. */
  ownerViaSourcesByTable: ReadonlyMap<string, KovoRuntimeOwnerViaSource>;
  /** Every physical table in the extracted Drizzle schema. */
  schemaTableNames: ReadonlySet<string>;
  /** Secret Drizzle column keys. */
  secretColumnKeys: ReadonlySet<string>;
  /** Secret physical column names. */
  secretColumnNames: ReadonlySet<string>;
  /** Secret Drizzle column keys grouped by physical table. */
  secretColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Secret physical column names grouped by physical table. */
  secretColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Physical tables containing at least one secret column. */
  secretTableNames: ReadonlySet<string>;
}

/**
 * Extract Kovo runtime database metadata from Drizzle table objects.
 *
 * The returned table/column facts are data consumed by `@kovojs/server` read-boundary helpers;
 * the security decision itself stays in the server package (SPEC §10.3/§11.2).
 */
export function extractKovoRuntimeDbMetadata(tables: readonly unknown[]): KovoRuntimeDbMetadata {
  const tableSnapshot = runtimeSnapshotArray(tables, 'Kovo Drizzle runtime schema tables');
  const allColumnKeys = runtimeSet<string>();
  const authorizationClassificationsByTable = runtimeMap<
    string,
    readonly KovoRuntimeAuthorizationClassification[]
  >();
  const columnSources = runtimeMap<object, KovoRuntimeDbColumnSource>();
  const governedColumnKeysByTable = runtimeMap<string, ReadonlySet<string>>();
  const governedColumnNamesByTable = runtimeMap<string, ReadonlySet<string>>();
  const ownerSourcesByTable = runtimeMap<string, KovoRuntimeOwnerSource>();
  const ownerViaSourcesByTable = runtimeMap<string, KovoRuntimeOwnerViaSource>();
  const schemaTableNames = runtimeSet<string>();
  const secretColumnKeys = runtimeSet<string>();
  const secretColumnNames = runtimeSet<string>();
  const secretColumnKeysByTable = runtimeMap<string, ReadonlySet<string>>();
  const secretColumnNamesByTable = runtimeMap<string, ReadonlySet<string>>();
  const secretTableNames = runtimeSet<string>();

  for (let tableIndex = 0; tableIndex < tableSnapshot.length; tableIndex += 1) {
    const table = runtimeArrayValue(
      tableSnapshot,
      tableIndex,
      'Kovo Drizzle runtime schema tables',
    );
    const config = getRuntimeTableConfig(table);
    runtimeSetAdd(schemaTableNames, config.name);
    const columnKeys = columnKeysByDbName(table as KovoRuntimeDbTable, config.columns);
    runtimeMapForEach(columnKeys, (key) => runtimeSetAdd(allColumnKeys, key));
    const domainAnnotation = kovoDomainAnnotation(table as KovoRuntimeDbTable);
    const classifications = authorizationClassificationsForAnnotation(domainAnnotation);
    if (classifications.length > 0) {
      runtimeMapSet(authorizationClassificationsByTable, config.name, classifications);
    }
    const ownerSource = ownerSourceForTable(
      domainAnnotation,
      table as KovoRuntimeDbTable,
      config.name,
      columnKeys,
    );
    if (ownerSource !== undefined) runtimeMapSet(ownerSourcesByTable, config.name, ownerSource);
    const ownerViaSource = ownerViaSourceForTable(
      domainAnnotation,
      table as KovoRuntimeDbTable,
      config.name,
      columnKeys,
    );
    if (ownerViaSource !== undefined) {
      runtimeMapSet(ownerViaSourcesByTable, config.name, ownerViaSource);
    }
    const tableGovernedColumnKeys = governedColumnKeysForTable(
      domainAnnotation,
      table as KovoRuntimeDbTable,
      columnKeys,
    );
    const tableGovernedColumnNames = runtimeSet<string>();
    runtimeSetForEach(tableGovernedColumnKeys, (key) =>
      runtimeSetAdd(tableGovernedColumnNames, dbNameForColumnKey(table as KovoRuntimeDbTable, key)),
    );
    if (runtimeSetSize(tableGovernedColumnKeys) > 0) {
      runtimeMapSet(
        governedColumnKeysByTable,
        config.name,
        runtimeSealSet(tableGovernedColumnKeys),
      );
      runtimeMapSet(
        governedColumnNamesByTable,
        config.name,
        runtimeSealSet(tableGovernedColumnNames),
      );
    }

    const secretAnnotation = kovoSecretAnnotation(table as KovoRuntimeDbTable);
    const tableSecretColumnKeys = runtimeSet<string>();
    const tableSecretColumnNames = runtimeSet<string>();
    const secretKeys =
      secretAnnotation === undefined
        ? []
        : secretAnnotation === true
          ? mapValuesSnapshot(columnKeys, 'Kovo Drizzle secret columns')
          : kovoSecretColumnKeys(secretAnnotation, table as KovoRuntimeDbTable, columnKeys);

    for (let index = 0; index < secretKeys.length; index += 1) {
      const key = runtimeArrayValue(secretKeys, index, 'Kovo Drizzle secret columns');
      runtimeSetAdd(secretColumnKeys, key);
      runtimeSetAdd(tableSecretColumnKeys, key);
      const column = ownPropertyValue(table as object, key);
      const dbName = columnName(column) ?? key;
      runtimeSetAdd(secretColumnNames, dbName);
      runtimeSetAdd(tableSecretColumnNames, dbName);
    }

    if (secretAnnotation !== undefined) {
      runtimeSetAdd(secretTableNames, config.name);
      runtimeMapSet(secretColumnKeysByTable, config.name, runtimeSealSet(tableSecretColumnKeys));
      runtimeMapSet(secretColumnNamesByTable, config.name, runtimeSealSet(tableSecretColumnNames));
    }

    runtimeMapForEach(columnKeys, (key, dbName) => {
      const column = ownPropertyValue(table as object, key);
      if (!isColumnLike(column)) return;
      runtimeMapSet(
        columnSources,
        column,
        runtimeFreeze({
          column: dbName,
          key,
          secret:
            runtimeSetHas(tableSecretColumnKeys, key) ||
            runtimeSetHas(tableSecretColumnNames, dbName),
          table: config.name,
        }),
      );
    });
  }

  return runtimeFreeze({
    allColumnKeys: runtimeSealSet(allColumnKeys),
    authorizationClassificationsByTable: runtimeSealMap(authorizationClassificationsByTable),
    columnSources: runtimeSealMap(columnSources),
    governedColumnKeysByTable: runtimeSealMap(governedColumnKeysByTable),
    governedColumnNamesByTable: runtimeSealMap(governedColumnNamesByTable),
    ownerSourcesByTable: runtimeSealMap(ownerSourcesByTable),
    ownerViaSourcesByTable: runtimeSealMap(ownerViaSourcesByTable),
    schemaTableNames: runtimeSealSet(schemaTableNames),
    secretColumnKeys: runtimeSealSet(secretColumnKeys),
    secretColumnKeysByTable: runtimeSealMap(secretColumnKeysByTable),
    secretColumnNames: runtimeSealSet(secretColumnNames),
    secretColumnNamesByTable: runtimeSealMap(secretColumnNamesByTable),
    secretTableNames: runtimeSealSet(secretTableNames),
  });
}

function getRuntimeTableConfig(table: unknown): KovoRuntimeDbTableConfig {
  try {
    return getSqliteTableConfig(table as Parameters<typeof getSqliteTableConfig>[0]);
  } catch {
    return getPgTableConfig(table as Parameters<typeof getPgTableConfig>[0]);
  }
}

function columnKeysByDbName(
  table: KovoRuntimeDbTable,
  columns: readonly KovoRuntimeDbColumn[],
): Map<string, string> {
  const keys = runtimeMap<string, string>();
  const tableKeys = runtimeObjectKeys(table as unknown as object);
  for (let index = 0; index < tableKeys.length; index += 1) {
    const key = runtimeArrayValue(tableKeys, index, 'Kovo Drizzle table keys');
    const value = ownPropertyValue(table as unknown as object, key);
    const name = columnName(value);
    if (name !== undefined) runtimeMapSet(keys, name, key);
  }
  const columnSnapshot = runtimeSnapshotArray(columns, 'Kovo Drizzle table columns');
  for (let index = 0; index < columnSnapshot.length; index += 1) {
    const column = runtimeArrayValue(columnSnapshot, index, 'Kovo Drizzle table columns');
    const name = columnName(column);
    if (name !== undefined && !runtimeMapHas(keys, name)) runtimeMapSet(keys, name, name);
  }
  return keys;
}

function kovoSecretAnnotation(
  table: KovoRuntimeDbTable,
): true | string | readonly unknown[] | undefined {
  const annotation = kovoDomainAnnotation(table);
  const secret = annotationValue(annotation, 'secret');
  if (secret === true || typeof secret === 'string' || runtimeArrayIsArray(secret)) return secret;
  return undefined;
}

function kovoDomainAnnotation(table: KovoRuntimeDbTable): KovoRuntimeDomainAnnotation | undefined {
  const stringKeys = runtimeObjectKeys(table as unknown as object);
  for (let index = 0; index < stringKeys.length; index += 1) {
    const key = runtimeArrayValue(stringKeys, index, 'Kovo Drizzle table keys');
    const annotation = domainAnnotationValue(ownPropertyValue(table as unknown as object, key));
    if (annotation !== undefined) return annotation;
  }
  const symbolKeys = runtimeObjectSymbols(table as unknown as object);
  for (let index = 0; index < symbolKeys.length; index += 1) {
    const key = runtimeArrayValue(symbolKeys, index, 'Kovo Drizzle table symbols');
    const annotation = domainAnnotationValue(ownPropertyValue(table as unknown as object, key));
    if (annotation !== undefined) return annotation;
  }
  return undefined;
}

function kovoSecretColumnKeys(
  annotation: string | readonly unknown[],
  table: KovoRuntimeDbTable,
  columnKeys: ReadonlyMap<string, string>,
): string[] {
  const refs = runtimeArrayIsArray(annotation) ? annotation : runtimeFreeze([annotation]);
  return columnKeysForRefs(refs, table, columnKeys, 'Kovo Drizzle secret annotation');
}

function governedColumnKeysForTable(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  table: KovoRuntimeDbTable,
  columnKeys: ReadonlyMap<string, string>,
): Set<string> {
  const governed = runtimeSet<string>();
  if (annotation === undefined) return governed;
  const governedAnnotation = annotationValue(annotation, 'governed');
  const confidentialAtRestAnnotation = annotationValue(annotation, 'confidentialAtRest');
  const key = columnKeyForRef(annotationValue(annotation, 'key'), table, columnKeys);
  const owner = columnKeyForRef(annotationValue(annotation, 'owner'), table, columnKeys);
  if (key !== undefined) runtimeSetAdd(governed, key);
  if (owner !== undefined) runtimeSetAdd(governed, owner);
  runtimeMapForEach(columnKeys, (columnKey) => {
    const dbName = dbNameForColumnKey(table, columnKey);
    if (isPasswordColumnName(columnKey) || isPasswordColumnName(dbName)) {
      runtimeSetAdd(governed, columnKey);
    }
  });
  const confidentialKeys = columnKeysForAnnotation(confidentialAtRestAnnotation, table, columnKeys);
  for (let index = 0; index < confidentialKeys.length; index += 1) {
    runtimeSetAdd(
      governed,
      runtimeArrayValue(confidentialKeys, index, 'Kovo Drizzle confidential columns'),
    );
  }
  const governedKeys = columnKeysForAnnotation(governedAnnotation, table, columnKeys);
  for (let index = 0; index < governedKeys.length; index += 1) {
    runtimeSetAdd(
      governed,
      runtimeArrayValue(governedKeys, index, 'Kovo Drizzle governed columns'),
    );
  }
  return governed;
}

function authorizationClassificationsForAnnotation(
  annotation: KovoRuntimeDomainAnnotation | undefined,
): readonly KovoRuntimeAuthorizationClassification[] {
  if (annotation === undefined) return [];
  const classifications: KovoRuntimeAuthorizationClassification[] = [];
  if (annotationValue(annotation, 'owner') !== undefined) {
    runtimeArrayAppend(classifications, 'owned', 'Kovo Drizzle authorization classifications');
  }
  if (annotationValue(annotation, 'ownerVia') !== undefined) {
    runtimeArrayAppend(classifications, 'ownedVia', 'Kovo Drizzle authorization classifications');
  }
  if (annotationValue(annotation, 'authzPolicy') !== undefined) {
    runtimeArrayAppend(
      classifications,
      'authzPolicy',
      'Kovo Drizzle authorization classifications',
    );
  }
  if (annotationValue(annotation, 'public') === true) {
    runtimeArrayAppend(classifications, 'public', 'Kovo Drizzle authorization classifications');
  }
  if (annotationValue(annotation, 'reference') === true) {
    runtimeArrayAppend(classifications, 'reference', 'Kovo Drizzle authorization classifications');
  }
  return runtimeFreeze(classifications);
}

function ownerSourceForTable(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  table: KovoRuntimeDbTable,
  tableName: string,
  columnKeys: ReadonlyMap<string, string>,
): KovoRuntimeOwnerSource | undefined {
  const owner = annotationValue(annotation, 'owner');
  if (owner === undefined) return undefined;
  const columnKey = columnKeyForRef(owner, table, columnKeys);
  if (columnKey === undefined) return undefined;
  return runtimeFreeze({
    columnKey,
    columnName: dbNameForColumnKey(table, columnKey),
    table: tableName,
  });
}

function ownerViaSourceForTable(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  table: KovoRuntimeDbTable,
  tableName: string,
  columnKeys: ReadonlyMap<string, string>,
): KovoRuntimeOwnerViaSource | undefined {
  const ownerViaValue = annotationValue(annotation, 'ownerVia');
  if (typeof ownerViaValue !== 'object' || ownerViaValue === null) return undefined;
  const parent = runtimeOwnDataValue(ownerViaValue, 'parent');
  if (!parent.found || parent.value === undefined) return undefined;
  const parentTable = parent.value as KovoRuntimeDbTable;
  const parentConfig = getRuntimeTableConfig(parentTable);
  const parentColumnKeys = columnKeysByDbName(parentTable, parentConfig.columns);
  const fk = runtimeOwnDataValue(ownerViaValue, 'fk');
  const parentKey = runtimeOwnDataValue(ownerViaValue, 'parentKey');
  const fkColumnKey = columnKeyForRef(fk.found ? fk.value : undefined, table, columnKeys);
  const parentKeyColumnKey = columnKeyForRef(
    parentKey.found ? parentKey.value : undefined,
    parentTable,
    parentColumnKeys,
  );
  if (fkColumnKey === undefined || parentKeyColumnKey === undefined) return undefined;
  return runtimeFreeze({
    fkColumnKey,
    fkColumnName: dbNameForColumnKey(table, fkColumnKey),
    parentKeyColumnKey,
    parentKeyColumnName: dbNameForColumnKey(parentTable, parentKeyColumnKey),
    parentTable: parentConfig.name,
    table: tableName,
  });
}

function columnKeysForAnnotation(
  annotation: unknown,
  table: KovoRuntimeDbTable,
  columnKeys: ReadonlyMap<string, string>,
): string[] {
  if (annotation === true) {
    return mapValuesSnapshot(columnKeys, 'Kovo Drizzle annotation columns');
  }
  if (typeof annotation === 'string' || typeof annotation === 'function') {
    const key = columnKeyForRef(annotation, table, columnKeys);
    return key === undefined ? [] : [key];
  }
  if (!runtimeArrayIsArray(annotation)) return [];
  return columnKeysForRefs(annotation, table, columnKeys, 'Kovo Drizzle column annotation');
}

function columnKeyForRef(
  ref: unknown,
  table: KovoRuntimeDbTable,
  columnKeys: ReadonlyMap<string, string>,
): string | undefined {
  if (typeof ref === 'string') return runtimeMapGet(columnKeys, ref) ?? ref;
  if (typeof ref !== 'function') return undefined;
  try {
    const selected = ref(table as unknown as Record<string, unknown>);
    const name = columnName(selected);
    return name === undefined ? undefined : (runtimeMapGet(columnKeys, name) ?? name);
  } catch {
    return undefined;
  }
}

function annotationValue(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  key: keyof KovoRuntimeDomainAnnotation | 'secret',
): unknown {
  if (annotation === undefined) return undefined;
  const value = runtimeOwnDataValue(annotation, key);
  return value.found ? value.value : undefined;
}

function dbNameForColumnKey(table: KovoRuntimeDbTable, key: string): string {
  return columnName(ownPropertyValue(table as object, key)) ?? key;
}

function isPasswordColumnName(column: string): boolean {
  return runtimeRegExpTest(/^(?:password|passwordHash|passwordDigest)$/u, column);
}

function isColumnLike(value: unknown): value is { name: string } {
  return columnName(value) !== undefined;
}

function columnName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const name = runtimeOwnDataValue(value, 'name');
  return name.found && typeof name.value === 'string' ? name.value : undefined;
}

function ownPropertyValue(value: object, property: PropertyKey): unknown {
  const result = runtimeOwnDataValue(value, property);
  return result.found ? result.value : undefined;
}

function domainAnnotationValue(value: unknown): KovoRuntimeDomainAnnotation | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  const domain = runtimeOwnDataValue(value, 'domain');
  return domain.found ? (value as KovoRuntimeDomainAnnotation) : undefined;
}

function columnKeysForRefs(
  refs: readonly unknown[],
  table: KovoRuntimeDbTable,
  columnKeys: ReadonlyMap<string, string>,
  label: string,
): string[] {
  const keys: string[] = [];
  const length = runtimeArrayLength(refs, label);
  for (let index = 0; index < length; index += 1) {
    const ref = runtimeArrayValue(refs, index, label);
    const key = columnKeyForRef(ref, table, columnKeys);
    if (key !== undefined) runtimeArrayAppend(keys, key, label);
  }
  return keys;
}

function mapValuesSnapshot<Key, Value>(map: ReadonlyMap<Key, Value>, label: string): Value[] {
  const values: Value[] = [];
  runtimeMapForEach(map, (value) => runtimeArrayAppend(values, value, label));
  return values;
}
