import { Table } from 'drizzle-orm';
import { PgDialect, type AnyPgTable } from 'drizzle-orm/pg-core';
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  runtimeArrayAppend,
  runtimeArrayIsArray,
  runtimeArrayLength,
  runtimeArrayValue,
  runtimeFreeze,
  runtimeGetOwnPropertyDescriptor,
  runtimeMap,
  runtimeMapForEach,
  runtimeMapGet,
  runtimeMapHas,
  runtimeMapSet,
  runtimeMapSize,
  runtimeObjectKeys,
  runtimeOwnDataValue,
  runtimeRegExpTest,
  runtimeReflectApply,
  runtimeSealMap,
  runtimeSealSet,
  runtimeSet,
  runtimeSetAdd,
  runtimeSetForEach,
  runtimeSetHas,
  runtimeSetSize,
  runtimeSnapshotArray,
} from './runtime-security-intrinsics.js';

const drizzleTableSymbols = requireDrizzleTableSymbols();
const drizzleColumns = drizzleTableSymbols.columns;
const drizzleExtraConfigBuilder = drizzleTableSymbols.extraConfigBuilder;
const drizzleExtraConfigColumns = drizzleTableSymbols.extraConfigColumns;
const drizzleName = drizzleTableSymbols.name;
const drizzleSchema = drizzleTableSymbols.schema;
const runtimeAuthzPolicyDialect = new PgDialect();
const runtimeAuthzPolicySqlToQuery = requireRuntimeAuthzPolicySqlToQuery();

/** Drizzle table object accepted by `extractKovoRuntimeDbMetadata`. */
export type KovoRuntimeDbTable = AnyPgTable | AnySQLiteTable;
type KovoRuntimeDbColumn = {
  name: string;
};
type KovoRuntimeDbTableConfig = {
  columns: readonly KovoRuntimeDbColumn[];
  name: string;
  schema: string | undefined;
};

/** @internal Compiler-derived physical/selection column identity used to bind runtime schema facts. */
export interface KovoRuntimeTableSecurityManifestColumn {
  key: string;
  name: string;
}

/** @internal Compiler-derived declared row-key source used to bind runtime schema facts. */
export interface KovoRuntimeTableSecurityManifestKey {
  columnKey: string;
  columnName: string;
  uniqueness: 'none' | 'primary' | 'unique';
}

/** @internal Compiler-derived direct-owner source used to bind runtime schema facts. */
export interface KovoRuntimeTableSecurityManifestOwner {
  columnKey: string;
  columnName: string;
}

/** @internal Compiler-derived transitive-owner source used to bind runtime schema facts. */
export interface KovoRuntimeTableSecurityManifestOwnerVia {
  fkColumnKey: string;
  fkColumnName: string;
  parentKeyColumnKey: string;
  parentKeyColumnName: string;
  parentTable: string;
}

/** @internal Exact compiler-derived authorization posture for one physical Drizzle table. */
export type KovoRuntimeTableSecurityManifestAuthzPolicy =
  | {
      justification: string;
      kind: 'guard-assertion';
    }
  | {
      kind: 'sql';
      sql: string;
    };

/** @internal Compiler-derived security facts for one physical Drizzle table. */
export interface KovoRuntimeTableSecurityManifestTable {
  authzPolicy?: KovoRuntimeTableSecurityManifestAuthzPolicy;
  authorizationClassifications: readonly KovoRuntimeAuthorizationClassification[];
  columns: readonly KovoRuntimeTableSecurityManifestColumn[];
  governedColumnKeys: readonly string[];
  key?: KovoRuntimeTableSecurityManifestKey;
  name: string;
  owner?: KovoRuntimeTableSecurityManifestOwner;
  ownerVia?: KovoRuntimeTableSecurityManifestOwnerVia;
  secretColumnKeys: readonly string[];
  secretDeclared: boolean;
}

/** @internal Compiler-owned table-security authority emitted ahead of app evaluation. */
export interface KovoRuntimeTableSecurityManifest {
  tables: readonly KovoRuntimeTableSecurityManifestTable[];
}
type KovoRuntimeTableFacts = {
  annotationColumnObjectsByKey: ReadonlyMap<string, object>;
  annotation: KovoRuntimeDomainAnnotation | undefined;
  columnKeys: ReadonlyMap<string, string>;
  columnObjectsByKey: ReadonlyMap<string, object>;
  config: KovoRuntimeDbTableConfig;
  table: KovoRuntimeDbTable;
};
type KovoRuntimeColumnRef = object;
type KovoRuntimeColumnAnnotation = true | KovoRuntimeColumnRef | readonly unknown[];
type KovoRuntimeDomainAnnotation = ((self: unknown) => unknown) & {
  atomic?: KovoRuntimeColumnAnnotation;
  authzPolicy?: unknown;
  confidentialAtRest?: KovoRuntimeColumnAnnotation;
  domain: unknown;
  fans?: readonly unknown[];
  governed?: KovoRuntimeColumnAnnotation;
  key?: KovoRuntimeColumnRef | readonly KovoRuntimeColumnRef[];
  owner?: KovoRuntimeColumnRef;
  ownerVia?: {
    fk?: unknown;
    parent?: unknown;
    parentKey?: unknown;
  };
  public?: true;
  reference?: true;
  secret?: KovoRuntimeColumnAnnotation;
  version?: KovoRuntimeColumnAnnotation;
};

function requireDrizzleTableSymbols(): {
  columns: symbol;
  extraConfigBuilder: symbol;
  extraConfigColumns: symbol;
  name: symbol;
  schema: symbol;
} {
  const symbolBag = runtimeOwnDataValue(Table, 'Symbol');
  if (
    !symbolBag.found ||
    (typeof symbolBag.value !== 'object' && typeof symbolBag.value !== 'function') ||
    symbolBag.value === null
  ) {
    throw new TypeError('The installed Drizzle version does not expose its table symbol bag.');
  }
  const requiredSymbols = {
    columns: 'Columns',
    extraConfigBuilder: 'ExtraConfigBuilder',
    extraConfigColumns: 'ExtraConfigColumns',
    name: 'Name',
    schema: 'Schema',
  } as const;
  const result = {} as {
    columns: symbol;
    extraConfigBuilder: symbol;
    extraConfigColumns: symbol;
    name: symbol;
    schema: symbol;
  };
  for (const resultKey of runtimeObjectKeys(requiredSymbols)) {
    const symbolName = requiredSymbols[resultKey as keyof typeof requiredSymbols];
    const symbol = runtimeOwnDataValue(symbolBag.value, symbolName);
    if (!symbol.found || typeof symbol.value !== 'symbol') {
      throw new TypeError(
        `The installed Drizzle version does not expose its table ${symbolName} key.`,
      );
    }
    result[resultKey as keyof typeof result] = symbol.value;
  }
  return runtimeFreeze(result);
}

function requireRuntimeAuthzPolicySqlToQuery(): PgDialect['sqlToQuery'] {
  const descriptor = runtimeGetOwnPropertyDescriptor(PgDialect.prototype, 'sqlToQuery');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError('The installed Drizzle version does not expose its Postgres SQL renderer.');
  }
  return descriptor.value as PgDialect['sqlToQuery'];
}

/** Drizzle-derived runtime source metadata for one physical database column. */
export interface KovoRuntimeDbColumnSource {
  /** Physical database column name. */
  column: string;
  /** Drizzle selection key for the column. */
  key: string;
  /** Whether the column is declared secret in Kovo metadata. */
  secret: boolean;
  /** Physical database schema, or `undefined` for the adapter's default schema. */
  schema: string | undefined;
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

/** Declared row-key metadata for one physical database table. */
export interface KovoRuntimeKeySource {
  /** Drizzle selection key for the declared row-key column. */
  columnKey: string;
  /** Physical database row-key column name. */
  columnName: string;
  /** Physical database table name. */
  table: string;
  /** Runtime column-builder constraint syntax, compared to compiler-owned source facts. */
  uniqueness: 'none' | 'primary' | 'unique';
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
  /** @internal Immutable compiler authority for exact custom authorization policy sinks. */
  compilerBoundAuthzPoliciesByTable?: ReadonlyMap<
    string,
    | {
        justification: string;
        kind: 'guard-assertion';
      }
    | {
        kind: 'sql';
        sql: string;
      }
  >;
  /** Runtime object identity map for Drizzle column objects used in SQL expressions. */
  columnSources: ReadonlyMap<object, KovoRuntimeDbColumnSource>;
  /** Governed Drizzle column keys grouped by physical table. */
  governedColumnKeysByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Governed physical column names grouped by physical table. */
  governedColumnNamesByTable: ReadonlyMap<string, ReadonlySet<string>>;
  /** Declared single-column row-key facts grouped by physical table. */
  keySourcesByTable: ReadonlyMap<string, KovoRuntimeKeySource>;
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
  return extractKovoRuntimeDbMetadataWithManifest(tables);
}

/** @internal Bind runtime Drizzle identity to compiler-owned table-security facts. */
export function extractCompilerBoundKovoRuntimeDbMetadata(
  tables: readonly unknown[],
  manifest: KovoRuntimeTableSecurityManifest,
): KovoRuntimeDbMetadata {
  return extractKovoRuntimeDbMetadataWithManifest(tables, manifest);
}

function extractKovoRuntimeDbMetadataWithManifest(
  tables: readonly unknown[],
  manifest?: KovoRuntimeTableSecurityManifest,
): KovoRuntimeDbMetadata {
  const expectedTables =
    manifest === undefined ? undefined : snapshotRuntimeTableSecurityManifest(manifest);
  const tableSnapshot = runtimeSnapshotArray(tables, 'Kovo Drizzle runtime schema tables');
  // Snapshot every table/column/annotation fact before the first app-owned selector runs. A
  // selector can close over any schema table, so per-table lazy snapshots still permit an earlier
  // callback to rewrite a later table's secret/owner facts.
  const factsByTable = runtimeMap<object, KovoRuntimeTableFacts>();
  const tableFacts: KovoRuntimeTableFacts[] = [];
  for (let tableIndex = 0; tableIndex < tableSnapshot.length; tableIndex += 1) {
    const table = runtimeArrayValue(
      tableSnapshot,
      tableIndex,
      'Kovo Drizzle runtime schema tables',
    ) as KovoRuntimeDbTable;
    const facts = snapshotRuntimeTableFacts(table);
    runtimeArrayAppend(tableFacts, facts, 'Kovo Drizzle runtime table facts');
    runtimeMapSet(factsByTable, table as object, facts);
  }
  if (expectedTables !== undefined) {
    assertRuntimeSchemaMatchesManifest(tableFacts, expectedTables);
  }
  // ownerVia may name a parent not repeated in the caller's table list. Capture that parent before
  // callbacks too, while keeping it out of the extracted schema-table inventory.
  for (let tableIndex = 0; tableIndex < tableFacts.length; tableIndex += 1) {
    const facts = runtimeArrayValue(tableFacts, tableIndex, 'Kovo Drizzle runtime table facts');
    const ownerVia = annotationValue(facts.annotation, 'ownerVia');
    if (typeof ownerVia !== 'object' || ownerVia === null) continue;
    const parent = runtimeOwnDataValue(ownerVia, 'parent');
    if (
      !parent.found ||
      (typeof parent.value !== 'object' && typeof parent.value !== 'function') ||
      parent.value === null ||
      runtimeMapHas(factsByTable, parent.value)
    ) {
      continue;
    }
    runtimeMapSet(
      factsByTable,
      parent.value,
      snapshotRuntimeTableFacts(parent.value as KovoRuntimeDbTable),
    );
  }
  for (let tableIndex = 0; tableIndex < tableFacts.length; tableIndex += 1) {
    assertConcreteRuntimeAnnotationIdentities(
      runtimeArrayValue(tableFacts, tableIndex, 'Kovo Drizzle runtime table facts'),
      factsByTable,
    );
  }
  const allColumnKeys = runtimeSet<string>();
  const authorizationClassificationsByTable = runtimeMap<
    string,
    readonly KovoRuntimeAuthorizationClassification[]
  >();
  const compilerBoundAuthzPoliciesByTable =
    expectedTables === undefined
      ? undefined
      : runtimeMap<string, KovoRuntimeTableSecurityManifestAuthzPolicy>();
  const columnSources = runtimeMap<object, KovoRuntimeDbColumnSource>();
  const governedColumnKeysByTable = runtimeMap<string, ReadonlySet<string>>();
  const governedColumnNamesByTable = runtimeMap<string, ReadonlySet<string>>();
  const keySourcesByTable = runtimeMap<string, KovoRuntimeKeySource>();
  const ownerSourcesByTable = runtimeMap<string, KovoRuntimeOwnerSource>();
  const ownerViaSourcesByTable = runtimeMap<string, KovoRuntimeOwnerViaSource>();
  const schemaTableNames = runtimeSet<string>();
  const secretColumnKeys = runtimeSet<string>();
  const secretColumnNames = runtimeSet<string>();
  const secretColumnKeysByTable = runtimeMap<string, ReadonlySet<string>>();
  const secretColumnNamesByTable = runtimeMap<string, ReadonlySet<string>>();
  const secretTableNames = runtimeSet<string>();

  for (let tableIndex = 0; tableIndex < tableFacts.length; tableIndex += 1) {
    const facts = runtimeArrayValue(tableFacts, tableIndex, 'Kovo Drizzle runtime table facts');
    const { annotation: domainAnnotation, columnKeys, config } = facts;
    runtimeSetAdd(schemaTableNames, config.name);
    runtimeMapForEach(columnKeys, (key) => runtimeSetAdd(allColumnKeys, key));
    const classifications = authorizationClassificationsForAnnotation(domainAnnotation);
    if (classifications.length > 0) {
      runtimeMapSet(authorizationClassificationsByTable, config.name, classifications);
    }
    const ownerSource = ownerSourceForTable(domainAnnotation, facts, config.name);
    if (ownerSource !== undefined) runtimeMapSet(ownerSourcesByTable, config.name, ownerSource);
    const keySource = keySourceForTable(domainAnnotation, facts, config.name);
    if (keySource !== undefined) runtimeMapSet(keySourcesByTable, config.name, keySource);
    const ownerViaSource = ownerViaSourceForTable(
      domainAnnotation,
      facts,
      config.name,
      factsByTable,
    );
    if (ownerViaSource !== undefined) {
      runtimeMapSet(ownerViaSourcesByTable, config.name, ownerViaSource);
    }
    const tableGovernedColumnKeys = governedColumnKeysForTable(domainAnnotation, facts);
    const tableGovernedColumnNames = runtimeSet<string>();
    runtimeSetForEach(tableGovernedColumnKeys, (key) =>
      runtimeSetAdd(tableGovernedColumnNames, dbNameForColumnKey(facts, key)),
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

    const secretAnnotation = kovoSecretAnnotation(domainAnnotation);
    const tableSecretColumnKeys = runtimeSet<string>();
    const tableSecretColumnNames = runtimeSet<string>();
    const secretKeys =
      secretAnnotation === undefined
        ? []
        : secretAnnotation === true
          ? mapValuesSnapshot(columnKeys, 'Kovo Drizzle secret columns')
          : kovoSecretColumnKeys(secretAnnotation, facts);

    for (let index = 0; index < secretKeys.length; index += 1) {
      const key = runtimeArrayValue(secretKeys, index, 'Kovo Drizzle secret columns');
      runtimeSetAdd(secretColumnKeys, key);
      runtimeSetAdd(tableSecretColumnKeys, key);
      const dbName = dbNameForColumnKey(facts, key);
      runtimeSetAdd(secretColumnNames, dbName);
      runtimeSetAdd(tableSecretColumnNames, dbName);
    }

    if (secretAnnotation !== undefined) {
      runtimeSetAdd(secretTableNames, config.name);
      runtimeMapSet(secretColumnKeysByTable, config.name, runtimeSealSet(tableSecretColumnKeys));
      runtimeMapSet(secretColumnNamesByTable, config.name, runtimeSealSet(tableSecretColumnNames));
    }

    if (expectedTables !== undefined) {
      const expected = runtimeMapGet(expectedTables, config.name);
      if (expected === undefined) throwRuntimeTableSecurityMismatch(config.name);
      const authzPolicy = runtimeAuthzPolicyForAnnotation(domainAnnotation, config.name);
      assertRuntimeTableSecurityFacts(expected, {
        authzPolicy,
        classifications,
        governedColumnKeys: tableGovernedColumnKeys,
        key: keySource,
        owner: ownerSource,
        ownerVia: ownerViaSource,
        secretColumnKeys: tableSecretColumnKeys,
        secretDeclared: secretAnnotation !== undefined,
      });
      if (expected.authzPolicy !== undefined && compilerBoundAuthzPoliciesByTable !== undefined) {
        runtimeMapSet(compilerBoundAuthzPoliciesByTable, config.name, expected.authzPolicy);
      }
    }

    runtimeMapForEach(columnKeys, (key, dbName) => {
      const column = runtimeMapGet(facts.columnObjectsByKey, key);
      if (column === undefined) return;
      runtimeMapSet(
        columnSources,
        column,
        runtimeFreeze({
          column: dbName,
          key,
          schema: config.schema,
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
    ...(compilerBoundAuthzPoliciesByTable === undefined
      ? {}
      : {
          compilerBoundAuthzPoliciesByTable: runtimeSealMap(compilerBoundAuthzPoliciesByTable),
        }),
    columnSources: runtimeSealMap(columnSources),
    governedColumnKeysByTable: runtimeSealMap(governedColumnKeysByTable),
    governedColumnNamesByTable: runtimeSealMap(governedColumnNamesByTable),
    keySourcesByTable: runtimeSealMap(keySourcesByTable),
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

function snapshotRuntimeTableSecurityManifest(
  manifest: KovoRuntimeTableSecurityManifest,
): ReadonlyMap<string, KovoRuntimeTableSecurityManifestTable> {
  if (typeof manifest !== 'object' || manifest === null || runtimeArrayIsArray(manifest)) {
    throw new TypeError('Kovo compiler table-security manifest must be an own-data record.');
  }
  const tablesValue = requiredRuntimeManifestValue(manifest, 'tables', 'manifest');
  if (!runtimeArrayIsArray(tablesValue)) {
    throw new TypeError('Kovo compiler table-security manifest.tables must be an array.');
  }
  const tables = runtimeSnapshotArray(tablesValue, 'Kovo compiler table-security tables');
  const byName = runtimeMap<string, KovoRuntimeTableSecurityManifestTable>();
  for (let index = 0; index < tables.length; index += 1) {
    const table = snapshotRuntimeTableSecurityManifestTable(
      runtimeArrayValue(tables, index, 'Kovo compiler table-security tables'),
      index,
    );
    if (runtimeMapHas(byName, table.name)) throwRuntimeTableSecurityMismatch(table.name);
    runtimeMapSet(byName, table.name, table);
  }
  return byName;
}

function snapshotRuntimeTableSecurityManifestTable(
  value: unknown,
  index: number,
): KovoRuntimeTableSecurityManifestTable {
  const label = `manifest.tables[${index}]`;
  if (typeof value !== 'object' || value === null || runtimeArrayIsArray(value)) {
    throw new TypeError(`Kovo compiler table-security ${label} must be an own-data record.`);
  }
  const name = requiredRuntimeManifestValue(value, 'name', label);
  const classificationsValue = requiredRuntimeManifestValue(
    value,
    'authorizationClassifications',
    label,
  );
  const columnsValue = requiredRuntimeManifestValue(value, 'columns', label);
  const governedValue = requiredRuntimeManifestValue(value, 'governedColumnKeys', label);
  const secretValue = requiredRuntimeManifestValue(value, 'secretColumnKeys', label);
  const secretDeclared = requiredRuntimeManifestValue(value, 'secretDeclared', label);
  if (
    typeof name !== 'string' ||
    !runtimeArrayIsArray(classificationsValue) ||
    !runtimeArrayIsArray(columnsValue) ||
    !runtimeArrayIsArray(governedValue) ||
    !runtimeArrayIsArray(secretValue) ||
    typeof secretDeclared !== 'boolean'
  ) {
    throw new TypeError(`Kovo compiler table-security ${label} contains invalid required facts.`);
  }

  const classificationsSource = runtimeSnapshotArray(
    classificationsValue,
    `${label}.authorizationClassifications`,
  );
  const authorizationClassifications: KovoRuntimeAuthorizationClassification[] = [];
  for (
    let classificationIndex = 0;
    classificationIndex < classificationsSource.length;
    classificationIndex += 1
  ) {
    const classification = runtimeArrayValue(
      classificationsSource,
      classificationIndex,
      `${label}.authorizationClassifications`,
    );
    if (!isRuntimeManifestClassification(classification)) {
      throw new TypeError(`Kovo compiler table-security ${label} has an invalid classification.`);
    }
    runtimeArrayAppend(
      authorizationClassifications,
      classification,
      `${label}.authorizationClassifications`,
    );
  }

  const columnsSource = runtimeSnapshotArray(columnsValue, `${label}.columns`);
  const columns: KovoRuntimeTableSecurityManifestColumn[] = [];
  for (let columnIndex = 0; columnIndex < columnsSource.length; columnIndex += 1) {
    const columnValue = runtimeArrayValue(columnsSource, columnIndex, `${label}.columns`);
    if (
      typeof columnValue !== 'object' ||
      columnValue === null ||
      runtimeArrayIsArray(columnValue)
    ) {
      throw new TypeError(`Kovo compiler table-security ${label} has an invalid column.`);
    }
    const key = requiredRuntimeManifestValue(columnValue, 'key', `${label}.columns`);
    const columnName = requiredRuntimeManifestValue(columnValue, 'name', `${label}.columns`);
    if (typeof key !== 'string' || typeof columnName !== 'string') {
      throw new TypeError(`Kovo compiler table-security ${label} has an invalid column.`);
    }
    runtimeArrayAppend(columns, runtimeFreeze({ key, name: columnName }), `${label}.columns`);
  }

  const authzPolicyValue = optionalRuntimeManifestValue(value, 'authzPolicy');
  const authzPolicy =
    authzPolicyValue === undefined
      ? undefined
      : snapshotRuntimeManifestAuthzPolicy(authzPolicyValue, `${label}.authzPolicy`);
  const hasAuthzPolicyClassification = runtimeManifestStringArrayIncludes(
    authorizationClassifications,
    'authzPolicy',
  );
  if (hasAuthzPolicyClassification !== (authzPolicy !== undefined)) {
    throwRuntimeTableSecurityMismatch(name);
  }
  const ownerValue = optionalRuntimeManifestValue(value, 'owner');
  const ownerViaValue = optionalRuntimeManifestValue(value, 'ownerVia');
  const keyValue = optionalRuntimeManifestValue(value, 'key');
  return runtimeFreeze({
    ...(authzPolicy === undefined ? {} : { authzPolicy }),
    authorizationClassifications: runtimeFreeze(authorizationClassifications),
    columns: runtimeFreeze(columns),
    governedColumnKeys: snapshotRuntimeManifestStrings(
      governedValue,
      `${label}.governedColumnKeys`,
    ),
    ...(keyValue === undefined
      ? {}
      : { key: snapshotRuntimeManifestKey(keyValue, `${label}.key`) }),
    name,
    ...(ownerValue === undefined
      ? {}
      : { owner: snapshotRuntimeManifestOwner(ownerValue, `${label}.owner`) }),
    ...(ownerViaValue === undefined
      ? {}
      : { ownerVia: snapshotRuntimeManifestOwnerVia(ownerViaValue, `${label}.ownerVia`) }),
    secretColumnKeys: snapshotRuntimeManifestStrings(secretValue, `${label}.secretColumnKeys`),
    secretDeclared,
  });
}

function snapshotRuntimeManifestKey(
  value: unknown,
  label: string,
): KovoRuntimeTableSecurityManifestKey {
  if (typeof value !== 'object' || value === null || runtimeArrayIsArray(value)) {
    throw new TypeError(`Kovo compiler table-security ${label} must be an own-data record.`);
  }
  const columnKey = requiredRuntimeManifestValue(value, 'columnKey', label);
  const columnName = requiredRuntimeManifestValue(value, 'columnName', label);
  const uniqueness = requiredRuntimeManifestValue(value, 'uniqueness', label);
  if (
    typeof columnKey !== 'string' ||
    typeof columnName !== 'string' ||
    (uniqueness !== 'none' && uniqueness !== 'primary' && uniqueness !== 'unique')
  ) {
    throw new TypeError(`Kovo compiler table-security ${label} contains invalid facts.`);
  }
  return runtimeFreeze({ columnKey, columnName, uniqueness });
}

function snapshotRuntimeManifestAuthzPolicy(
  value: unknown,
  label: string,
): KovoRuntimeTableSecurityManifestAuthzPolicy {
  if (typeof value !== 'object' || value === null || runtimeArrayIsArray(value)) {
    throw new TypeError(`Kovo compiler table-security ${label} must be an own-data record.`);
  }
  const kind = requiredRuntimeManifestValue(value, 'kind', label);
  if (kind === 'guard-assertion') {
    const justification = requiredRuntimeManifestValue(value, 'justification', label);
    if (typeof justification !== 'string') {
      throw new TypeError(`Kovo compiler table-security ${label} contains invalid facts.`);
    }
    return runtimeFreeze({ justification, kind });
  }
  if (kind === 'sql') {
    const sql = requiredRuntimeManifestValue(value, 'sql', label);
    if (typeof sql !== 'string') {
      throw new TypeError(`Kovo compiler table-security ${label} contains invalid facts.`);
    }
    return runtimeFreeze({ kind, sql });
  }
  throw new TypeError(`Kovo compiler table-security ${label} contains invalid facts.`);
}

function snapshotRuntimeManifestOwner(
  value: unknown,
  label: string,
): KovoRuntimeTableSecurityManifestOwner {
  if (typeof value !== 'object' || value === null || runtimeArrayIsArray(value)) {
    throw new TypeError(`Kovo compiler table-security ${label} must be an own-data record.`);
  }
  const columnKey = requiredRuntimeManifestValue(value, 'columnKey', label);
  const columnName = requiredRuntimeManifestValue(value, 'columnName', label);
  if (typeof columnKey !== 'string' || typeof columnName !== 'string') {
    throw new TypeError(`Kovo compiler table-security ${label} contains invalid facts.`);
  }
  return runtimeFreeze({ columnKey, columnName });
}

function snapshotRuntimeManifestOwnerVia(
  value: unknown,
  label: string,
): KovoRuntimeTableSecurityManifestOwnerVia {
  if (typeof value !== 'object' || value === null || runtimeArrayIsArray(value)) {
    throw new TypeError(`Kovo compiler table-security ${label} must be an own-data record.`);
  }
  const fkColumnKey = requiredRuntimeManifestValue(value, 'fkColumnKey', label);
  const fkColumnName = requiredRuntimeManifestValue(value, 'fkColumnName', label);
  const parentKeyColumnKey = requiredRuntimeManifestValue(value, 'parentKeyColumnKey', label);
  const parentKeyColumnName = requiredRuntimeManifestValue(value, 'parentKeyColumnName', label);
  const parentTable = requiredRuntimeManifestValue(value, 'parentTable', label);
  if (
    typeof fkColumnKey !== 'string' ||
    typeof fkColumnName !== 'string' ||
    typeof parentKeyColumnKey !== 'string' ||
    typeof parentKeyColumnName !== 'string' ||
    typeof parentTable !== 'string'
  ) {
    throw new TypeError(`Kovo compiler table-security ${label} contains invalid facts.`);
  }
  return runtimeFreeze({
    fkColumnKey,
    fkColumnName,
    parentKeyColumnKey,
    parentKeyColumnName,
    parentTable,
  });
}

function snapshotRuntimeManifestStrings(
  value: readonly unknown[],
  label: string,
): readonly string[] {
  const source = runtimeSnapshotArray(value, label);
  const strings: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = runtimeArrayValue(source, index, label);
    if (typeof entry !== 'string') {
      throw new TypeError(`Kovo compiler table-security ${label} must contain strings.`);
    }
    runtimeArrayAppend(strings, entry, label);
  }
  return runtimeFreeze(strings);
}

function requiredRuntimeManifestValue(value: object, property: string, label: string): unknown {
  const result = runtimeOwnDataValue(value, property);
  if (!result.found) {
    throw new TypeError(`Kovo compiler table-security ${label}.${property} must be own data.`);
  }
  return result.value;
}

function optionalRuntimeManifestValue(value: object, property: string): unknown {
  const result = runtimeOwnDataValue(value, property);
  return result.found ? result.value : undefined;
}

function assertRuntimeSchemaMatchesManifest(
  tableFacts: readonly KovoRuntimeTableFacts[],
  expectedTables: ReadonlyMap<string, KovoRuntimeTableSecurityManifestTable>,
): void {
  if (runtimeMapSize(expectedTables) !== tableFacts.length) {
    throwRuntimeTableSecurityMismatch('<schema>');
  }
  const seen = runtimeSet<string>();
  for (let index = 0; index < tableFacts.length; index += 1) {
    const facts = runtimeArrayValue(tableFacts, index, 'Kovo Drizzle runtime table facts');
    if (runtimeSetHas(seen, facts.config.name)) {
      throwRuntimeTableSecurityMismatch(facts.config.name);
    }
    runtimeSetAdd(seen, facts.config.name);
    const expected = runtimeMapGet(expectedTables, facts.config.name);
    if (expected === undefined || runtimeMapSize(facts.columnKeys) !== expected.columns.length) {
      throwRuntimeTableSecurityMismatch(facts.config.name);
    }
    for (let columnIndex = 0; columnIndex < expected.columns.length; columnIndex += 1) {
      const column = runtimeArrayValue(
        expected.columns,
        columnIndex,
        'Kovo compiler table-security columns',
      );
      if (runtimeMapGet(facts.columnKeys, column.name) !== column.key) {
        throwRuntimeTableSecurityMismatch(facts.config.name);
      }
    }
  }
}

function assertRuntimeTableSecurityFacts(
  expected: KovoRuntimeTableSecurityManifestTable,
  actual: {
    authzPolicy: KovoRuntimeTableSecurityManifestAuthzPolicy | undefined;
    classifications: readonly KovoRuntimeAuthorizationClassification[];
    governedColumnKeys: ReadonlySet<string>;
    key: KovoRuntimeKeySource | undefined;
    owner: KovoRuntimeOwnerSource | undefined;
    ownerVia: KovoRuntimeOwnerViaSource | undefined;
    secretColumnKeys: ReadonlySet<string>;
    secretDeclared: boolean;
  },
): void {
  if (
    !runtimeManifestAuthzPolicyEquals(expected.authzPolicy, actual.authzPolicy) ||
    !runtimeManifestStringArrayEquals(
      expected.authorizationClassifications,
      actual.classifications,
    ) ||
    !runtimeManifestSetEquals(expected.governedColumnKeys, actual.governedColumnKeys) ||
    !runtimeManifestSetEquals(expected.secretColumnKeys, actual.secretColumnKeys) ||
    expected.secretDeclared !== actual.secretDeclared ||
    !runtimeManifestKeyEquals(expected.key, actual.key) ||
    !runtimeManifestOwnerEquals(expected.owner, actual.owner) ||
    !runtimeManifestOwnerViaEquals(expected.ownerVia, actual.ownerVia)
  ) {
    throwRuntimeTableSecurityMismatch(expected.name);
  }
}

function runtimeManifestAuthzPolicyEquals(
  expected: KovoRuntimeTableSecurityManifestAuthzPolicy | undefined,
  actual: KovoRuntimeTableSecurityManifestAuthzPolicy | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  if (expected.kind !== actual.kind) return false;
  return expected.kind === 'guard-assertion'
    ? actual.kind === 'guard-assertion' && expected.justification === actual.justification
    : actual.kind === 'sql' && expected.sql === actual.sql;
}

function runtimeManifestStringArrayIncludes(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (runtimeArrayValue(values, index, 'Kovo compiler table-security strings') === expected) {
      return true;
    }
  }
  return false;
}

function runtimeManifestStringArrayEquals(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  if (expected.length !== actual.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (
      runtimeArrayValue(expected, index, 'Kovo compiler table-security strings') !==
      runtimeArrayValue(actual, index, 'Kovo Drizzle runtime table-security strings')
    ) {
      return false;
    }
  }
  return true;
}

function runtimeManifestSetEquals(
  expected: readonly string[],
  actual: ReadonlySet<string>,
): boolean {
  if (expected.length !== runtimeSetSize(actual)) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (
      !runtimeSetHas(actual, runtimeArrayValue(expected, index, 'Kovo compiler table-security set'))
    ) {
      return false;
    }
  }
  return true;
}

function runtimeManifestKeyEquals(
  expected: KovoRuntimeTableSecurityManifestKey | undefined,
  actual: KovoRuntimeKeySource | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  return (
    expected.columnKey === actual.columnKey &&
    expected.columnName === actual.columnName &&
    expected.uniqueness === actual.uniqueness
  );
}

function runtimeManifestOwnerEquals(
  expected: KovoRuntimeTableSecurityManifestOwner | undefined,
  actual: KovoRuntimeOwnerSource | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  return expected.columnKey === actual.columnKey && expected.columnName === actual.columnName;
}

function runtimeManifestOwnerViaEquals(
  expected: KovoRuntimeTableSecurityManifestOwnerVia | undefined,
  actual: KovoRuntimeOwnerViaSource | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  return (
    expected.fkColumnKey === actual.fkColumnKey &&
    expected.fkColumnName === actual.fkColumnName &&
    expected.parentKeyColumnKey === actual.parentKeyColumnKey &&
    expected.parentKeyColumnName === actual.parentKeyColumnName &&
    expected.parentTable === actual.parentTable
  );
}

function isRuntimeManifestClassification(
  value: unknown,
): value is KovoRuntimeAuthorizationClassification {
  return (
    value === 'authzPolicy' ||
    value === 'owned' ||
    value === 'ownedVia' ||
    value === 'public' ||
    value === 'reference'
  );
}

function throwRuntimeTableSecurityMismatch(table: string): never {
  throw new TypeError(
    `KV414: runtime Drizzle table security for ${table} does not match the compiler-derived manifest (SPEC §6.6/§10.3).`,
  );
}

function getRuntimeTableConfig(table: unknown): KovoRuntimeDbTableConfig {
  if (typeof table !== 'object' || table === null || runtimeArrayIsArray(table)) {
    throw new TypeError('Kovo Drizzle runtime metadata requires a concrete Drizzle table.');
  }
  const name = ownPropertyValue(table, drizzleName);
  const schema = ownPropertyValue(table, drizzleSchema);
  const columnRecord = ownPropertyValue(table, drizzleColumns);
  if (typeof columnRecord !== 'object' || columnRecord === null) {
    throw new TypeError('Kovo Drizzle runtime table has no concrete column record.');
  }
  const columns: KovoRuntimeDbColumn[] = [];
  const columnKeys = runtimeObjectKeys(columnRecord);
  for (let index = 0; index < columnKeys.length; index += 1) {
    const key = runtimeArrayValue(columnKeys, index, 'Kovo Drizzle runtime column keys');
    const column = ownPropertyValue(columnRecord, key);
    if (typeof column !== 'object' || column === null || columnName(column) === undefined) {
      throw new TypeError('Kovo Drizzle runtime table has an invalid concrete column.');
    }
    runtimeArrayAppend(columns, column as KovoRuntimeDbColumn, 'Kovo Drizzle runtime columns');
  }
  return { columns, name: name as string, schema: schema as string | undefined };
}

function snapshotRuntimeTableFacts(table: KovoRuntimeDbTable): KovoRuntimeTableFacts {
  const sourceConfig = getRuntimeTableConfig(table);
  if (typeof sourceConfig.name !== 'string') {
    throw new TypeError('Kovo Drizzle runtime table name must be a string.');
  }
  const schema = sourceConfig.schema;
  if (schema !== undefined && typeof schema !== 'string') {
    throw new TypeError('Kovo Drizzle runtime table schema must be a string when present.');
  }
  const columns = runtimeSnapshotArray(
    sourceConfig.columns,
    `Kovo Drizzle ${sourceConfig.name} runtime columns`,
  ) as readonly KovoRuntimeDbColumn[];
  const config = runtimeFreeze({ columns, name: sourceConfig.name, schema });
  const columnKeys = columnKeysByDbName(table, columns);
  const columnObjectsByKey = columnObjectsByKeyFromRecord(table as unknown as object, columnKeys);
  const extraConfigColumns = ownPropertyValue(
    table as unknown as object,
    drizzleExtraConfigColumns,
  );
  if (typeof extraConfigColumns !== 'object' || extraConfigColumns === null) {
    throw new TypeError(
      `Kovo Drizzle runtime table ${sourceConfig.name} has no concrete extra-config column record.`,
    );
  }
  const annotationColumnObjectsByKey = columnObjectsByKeyFromRecord(extraConfigColumns, columnKeys);
  return runtimeFreeze({
    annotationColumnObjectsByKey,
    annotation: kovoDomainAnnotation(table),
    columnKeys,
    columnObjectsByKey,
    config,
    table,
  });
}

function columnObjectsByKeyFromRecord(
  record: object,
  columnKeys: ReadonlyMap<string, string>,
): ReadonlyMap<string, object> {
  const columns = runtimeMap<string, object>();
  runtimeMapForEach(columnKeys, (key) => {
    const column = ownPropertyValue(record, key);
    if (typeof column === 'object' && column !== null) {
      runtimeMapSet(columns, key, column);
    }
  });
  return columns;
}

function assertConcreteRuntimeAnnotationIdentities(
  facts: KovoRuntimeTableFacts,
  factsByTable: ReadonlyMap<object, KovoRuntimeTableFacts>,
): void {
  const annotation = facts.annotation;
  if (annotation === undefined) return;

  assertRuntimeColumnAnnotation(annotationValue(annotation, 'atomic'), facts, 'atomic', {
    allowArray: true,
    allowTrue: false,
  });
  assertRuntimeColumnAnnotation(
    annotationValue(annotation, 'confidentialAtRest'),
    facts,
    'confidentialAtRest',
    { allowArray: true, allowTrue: true },
  );
  assertRuntimeColumnAnnotation(annotationValue(annotation, 'governed'), facts, 'governed', {
    allowArray: true,
    allowTrue: true,
  });
  assertRuntimeColumnAnnotation(annotationValue(annotation, 'key'), facts, 'key', {
    allowArray: true,
    allowTrue: false,
    requireNonEmptyArray: true,
  });
  assertRuntimeColumnAnnotation(annotationValue(annotation, 'owner'), facts, 'owner', {
    allowArray: false,
    allowTrue: false,
  });
  assertRuntimeColumnAnnotation(annotationValue(annotation, 'secret'), facts, 'secret', {
    allowArray: true,
    allowTrue: true,
  });
  assertRuntimeColumnAnnotation(annotationValue(annotation, 'version'), facts, 'version', {
    allowArray: true,
    allowTrue: false,
  });

  const ownerVia = annotationValue(annotation, 'ownerVia');
  if (ownerVia !== undefined) {
    if (typeof ownerVia !== 'object' || ownerVia === null || runtimeArrayIsArray(ownerVia)) {
      throwInvalidRuntimeAnnotationIdentity(facts, 'ownerVia');
    }
    const fk = runtimeOwnDataValue(ownerVia, 'fk');
    const parent = runtimeOwnDataValue(ownerVia, 'parent');
    const parentKey = runtimeOwnDataValue(ownerVia, 'parentKey');
    if (
      !fk.found ||
      columnKeyForRef(fk.value, facts) === undefined ||
      !parent.found ||
      typeof parent.value !== 'object' ||
      parent.value === null ||
      !parentKey.found
    ) {
      throwInvalidRuntimeAnnotationIdentity(facts, 'ownerVia');
    }
    const parentFacts = runtimeMapGet(factsByTable, parent.value);
    if (
      parentFacts === undefined ||
      columnKeyForPublicRef(parentKey.value, parentFacts) === undefined
    ) {
      throwInvalidRuntimeAnnotationIdentity(facts, 'ownerVia');
    }
  }

  const fans = annotationValue(annotation, 'fans');
  if (fans !== undefined) {
    if (!runtimeArrayIsArray(fans)) throwInvalidRuntimeAnnotationIdentity(facts, 'fans');
    const length = runtimeArrayLength(fans, `Kovo Drizzle ${facts.config.name} fans annotation`);
    for (let index = 0; index < length; index += 1) {
      const fan = runtimeArrayValue(
        fans,
        index,
        `Kovo Drizzle ${facts.config.name} fans annotation`,
      );
      if (typeof fan !== 'object' || fan === null || runtimeArrayIsArray(fan)) {
        throwInvalidRuntimeAnnotationIdentity(facts, 'fans');
      }
      const via = runtimeOwnDataValue(fan, 'via');
      if (!via.found || columnKeyForRef(via.value, facts) === undefined) {
        throwInvalidRuntimeAnnotationIdentity(facts, 'fans');
      }
    }
  }
}

function assertRuntimeColumnAnnotation(
  value: unknown,
  facts: KovoRuntimeTableFacts,
  field: string,
  options: {
    allowArray: boolean;
    allowTrue: boolean;
    requireNonEmptyArray?: boolean;
  },
): void {
  if (value === undefined) return;
  if (value === true) {
    if (options.allowTrue) return;
    throwInvalidRuntimeAnnotationIdentity(facts, field);
  }
  if (runtimeArrayIsArray(value)) {
    if (!options.allowArray) throwInvalidRuntimeAnnotationIdentity(facts, field);
    const length = runtimeArrayLength(
      value,
      `Kovo Drizzle ${facts.config.name} ${field} annotation`,
    );
    if (options.requireNonEmptyArray === true && length === 0) {
      throwInvalidRuntimeAnnotationIdentity(facts, field);
    }
    for (let index = 0; index < length; index += 1) {
      const ref = runtimeArrayValue(
        value,
        index,
        `Kovo Drizzle ${facts.config.name} ${field} annotation`,
      );
      if (columnKeyForRef(ref, facts) === undefined) {
        throwInvalidRuntimeAnnotationIdentity(facts, field);
      }
    }
    return;
  }
  if (columnKeyForRef(value, facts) === undefined) {
    throwInvalidRuntimeAnnotationIdentity(facts, field);
  }
}

function throwInvalidRuntimeAnnotationIdentity(facts: KovoRuntimeTableFacts, field: string): never {
  throw new TypeError(
    `Kovo Drizzle ${field} annotation for ${facts.config.name} must use the exact Drizzle column identity required by SPEC §10.1.`,
  );
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
  annotation: KovoRuntimeDomainAnnotation | undefined,
): true | object | readonly unknown[] | undefined {
  const secret = annotationValue(annotation, 'secret');
  if (
    secret === true ||
    (typeof secret === 'object' && secret !== null) ||
    runtimeArrayIsArray(secret)
  ) {
    return secret;
  }
  return undefined;
}

function runtimeAuthzPolicyForAnnotation(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  tableName: string,
): KovoRuntimeTableSecurityManifestAuthzPolicy | undefined {
  const authzPolicy = annotationValue(annotation, 'authzPolicy');
  if (authzPolicy === undefined) return undefined;
  if (typeof authzPolicy === 'string') {
    const snapshot: KovoRuntimeTableSecurityManifestAuthzPolicy = {
      justification: authzPolicy,
      kind: 'guard-assertion',
    };
    return runtimeFreeze(snapshot);
  }
  try {
    const query = runtimeReflectApply<unknown>(
      runtimeAuthzPolicySqlToQuery,
      runtimeAuthzPolicyDialect,
      [authzPolicy],
    );
    if (typeof query !== 'object' || query === null || runtimeArrayIsArray(query)) {
      throwRuntimeTableSecurityMismatch(tableName);
    }
    const sql = runtimeOwnDataValue(query, 'sql');
    const params = runtimeOwnDataValue(query, 'params');
    if (
      !sql.found ||
      typeof sql.value !== 'string' ||
      !params.found ||
      !runtimeArrayIsArray(params.value) ||
      runtimeArrayLength(params.value, 'Kovo Drizzle runtime authzPolicy parameters') !== 0
    ) {
      throwRuntimeTableSecurityMismatch(tableName);
    }
    const snapshot: KovoRuntimeTableSecurityManifestAuthzPolicy = {
      kind: 'sql',
      sql: sql.value,
    };
    return runtimeFreeze(snapshot);
  } catch {
    throwRuntimeTableSecurityMismatch(tableName);
  }
}

function kovoDomainAnnotation(table: KovoRuntimeDbTable): KovoRuntimeDomainAnnotation | undefined {
  // SPEC §10.1: the Drizzle table factory's exact extra-config callback is the runtime
  // annotation authority. Scanning arbitrary table values lets a witnessed-but-unrelated
  // kovo() value shadow the real callback, while module-local brands disappear when the app and
  // extractor are bundled as distinct copies. Drizzle's own cross-copy table key identifies the
  // callback without exposing a Kovo signing oracle or accepting unrelated table properties.
  const extraConfigBuilder = ownPropertyValue(
    table as unknown as object,
    drizzleExtraConfigBuilder,
  );
  if (typeof extraConfigBuilder !== 'function') return undefined;
  const extraConfigColumns = ownPropertyValue(
    table as unknown as object,
    drizzleExtraConfigColumns,
  );
  if (typeof extraConfigColumns !== 'object' || extraConfigColumns === null) {
    throw new TypeError('Kovo Drizzle runtime table has no concrete extra-config column record.');
  }
  // Invoke the exact callback with the exact record instead of probing dialect-specific
  // getTableConfig helpers. A wrong-dialect probe can initialize a Postgres annotation with
  // SQLite's public column record when mutable Object/Array controls are poisoned.
  runtimeReflectApply(extraConfigBuilder, undefined, [extraConfigColumns]);
  return domainAnnotationValue(extraConfigBuilder);
}

function kovoSecretColumnKeys(
  annotation: object | readonly unknown[],
  facts: KovoRuntimeTableFacts,
): string[] {
  const refs = runtimeArrayIsArray(annotation) ? annotation : runtimeFreeze([annotation]);
  return columnKeysForRefs(refs, facts, 'Kovo Drizzle secret annotation');
}

function governedColumnKeysForTable(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  facts: KovoRuntimeTableFacts,
): Set<string> {
  const { columnKeys } = facts;
  const governed = runtimeSet<string>();
  if (annotation === undefined) return governed;
  const governedAnnotation = annotationValue(annotation, 'governed');
  const confidentialAtRestAnnotation = annotationValue(annotation, 'confidentialAtRest');
  const keys = columnKeysForAnnotation(annotationValue(annotation, 'key'), facts);
  const owner = columnKeyForRef(annotationValue(annotation, 'owner'), facts);
  for (let index = 0; index < keys.length; index += 1) {
    runtimeSetAdd(governed, runtimeArrayValue(keys, index, 'Kovo Drizzle row-key columns'));
  }
  if (owner !== undefined) runtimeSetAdd(governed, owner);
  runtimeMapForEach(columnKeys, (columnKey) => {
    const dbName = dbNameForColumnKey(facts, columnKey);
    if (isPasswordColumnName(columnKey) || isPasswordColumnName(dbName)) {
      runtimeSetAdd(governed, columnKey);
    }
  });
  const confidentialKeys = columnKeysForAnnotation(confidentialAtRestAnnotation, facts);
  for (let index = 0; index < confidentialKeys.length; index += 1) {
    runtimeSetAdd(
      governed,
      runtimeArrayValue(confidentialKeys, index, 'Kovo Drizzle confidential columns'),
    );
  }
  const governedKeys = columnKeysForAnnotation(governedAnnotation, facts);
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
  facts: KovoRuntimeTableFacts,
  tableName: string,
): KovoRuntimeOwnerSource | undefined {
  const owner = annotationValue(annotation, 'owner');
  if (owner === undefined) return undefined;
  const columnKey = columnKeyForRef(owner, facts);
  if (columnKey === undefined) return undefined;
  return runtimeFreeze({
    columnKey,
    columnName: dbNameForColumnKey(facts, columnKey),
    table: tableName,
  });
}

function keySourceForTable(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  facts: KovoRuntimeTableFacts,
  tableName: string,
): KovoRuntimeKeySource | undefined {
  const key = annotationValue(annotation, 'key');
  if (key === undefined) return undefined;
  if (runtimeArrayIsArray(key)) return undefined;
  const columnKey = columnKeyForRef(key, facts);
  const column =
    columnKey === undefined ? undefined : runtimeMapGet(facts.columnObjectsByKey, columnKey);
  if (columnKey === undefined || column === undefined) {
    return undefined;
  }
  const primary = runtimeOwnDataValue(column, 'primary');
  const unique = runtimeOwnDataValue(column, 'isUnique');
  const uniqueness =
    primary.found && primary.value === true
      ? ('primary' as const)
      : unique.found && unique.value === true
        ? ('unique' as const)
        : ('none' as const);
  return runtimeFreeze({
    columnKey,
    columnName: dbNameForColumnKey(facts, columnKey),
    table: tableName,
    uniqueness,
  });
}

function ownerViaSourceForTable(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  facts: KovoRuntimeTableFacts,
  tableName: string,
  factsByTable: ReadonlyMap<object, KovoRuntimeTableFacts>,
): KovoRuntimeOwnerViaSource | undefined {
  const ownerViaValue = annotationValue(annotation, 'ownerVia');
  if (typeof ownerViaValue !== 'object' || ownerViaValue === null) return undefined;
  const parent = runtimeOwnDataValue(ownerViaValue, 'parent');
  if (!parent.found || parent.value === undefined) return undefined;
  const parentTable = parent.value as KovoRuntimeDbTable;
  const parentFacts = runtimeMapGet(factsByTable, parentTable as object);
  if (parentFacts === undefined) return undefined;
  const fk = runtimeOwnDataValue(ownerViaValue, 'fk');
  const parentKey = runtimeOwnDataValue(ownerViaValue, 'parentKey');
  const fkColumnKey = columnKeyForRef(fk.found ? fk.value : undefined, facts);
  const parentKeyColumnKey = columnKeyForPublicRef(
    parentKey.found ? parentKey.value : undefined,
    parentFacts,
  );
  if (fkColumnKey === undefined || parentKeyColumnKey === undefined) return undefined;
  return runtimeFreeze({
    fkColumnKey,
    fkColumnName: dbNameForColumnKey(facts, fkColumnKey),
    parentKeyColumnKey,
    parentKeyColumnName: dbNameForColumnKey(parentFacts, parentKeyColumnKey),
    parentTable: parentFacts.config.name,
    table: tableName,
  });
}

function columnKeysForAnnotation(annotation: unknown, facts: KovoRuntimeTableFacts): string[] {
  if (annotation === true) {
    return mapValuesSnapshot(facts.columnKeys, 'Kovo Drizzle annotation columns');
  }
  if (runtimeArrayIsArray(annotation)) {
    return columnKeysForRefs(annotation, facts, 'Kovo Drizzle column annotation');
  }
  if (
    typeof annotation === 'string' ||
    typeof annotation === 'function' ||
    (typeof annotation === 'object' && annotation !== null)
  ) {
    const key = columnKeyForRef(annotation, facts);
    return key === undefined ? [] : [key];
  }
  return [];
}

function columnKeyForRef(ref: unknown, facts: KovoRuntimeTableFacts): string | undefined {
  return columnKeyForExactRef(ref, facts.annotationColumnObjectsByKey);
}

function columnKeyForPublicRef(ref: unknown, facts: KovoRuntimeTableFacts): string | undefined {
  return columnKeyForExactRef(ref, facts.columnObjectsByKey);
}

function columnKeyForExactRef(
  ref: unknown,
  columnsByKey: ReadonlyMap<string, object>,
): string | undefined {
  if (typeof ref !== 'object' || ref === null) return undefined;
  let result: string | undefined;
  runtimeMapForEach(columnsByKey, (column, key) => {
    if (column === ref) result = key;
  });
  return result;
}

function annotationValue(
  annotation: KovoRuntimeDomainAnnotation | undefined,
  key: keyof KovoRuntimeDomainAnnotation | 'secret',
): unknown {
  if (annotation === undefined) return undefined;
  const value = runtimeOwnDataValue(annotation, key);
  return value.found ? value.value : undefined;
}

function dbNameForColumnKey(facts: KovoRuntimeTableFacts, key: string): string {
  let result = key;
  runtimeMapForEach(facts.columnKeys, (candidateKey, dbName) => {
    if (candidateKey === key) result = dbName;
  });
  return result;
}

function isPasswordColumnName(column: string): boolean {
  return runtimeRegExpTest(/^(?:password|passwordHash|passwordDigest)$/u, column);
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
  if (typeof value !== 'function' || !hasOwnDomain(value)) {
    return undefined;
  }
  return value;
}

function hasOwnDomain(value: Function): value is KovoRuntimeDomainAnnotation {
  return runtimeOwnDataValue(value, 'domain').found;
}

function columnKeysForRefs(
  refs: readonly unknown[],
  facts: KovoRuntimeTableFacts,
  label: string,
): string[] {
  const keys: string[] = [];
  const length = runtimeArrayLength(refs, label);
  for (let index = 0; index < length; index += 1) {
    const ref = runtimeArrayValue(refs, index, label);
    const key = columnKeyForRef(ref, facts);
    if (key !== undefined) runtimeArrayAppend(keys, key, label);
  }
  return keys;
}

function mapValuesSnapshot<Key, Value>(map: ReadonlyMap<Key, Value>, label: string): Value[] {
  const values: Value[] = [];
  runtimeMapForEach(map, (value) => runtimeArrayAppend(values, value, label));
  return values;
}
