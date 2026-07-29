import type { KovoRuntimeDbMetadata } from '@kovojs/drizzle/internal/runtime-metadata';
import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { type AnyPgColumn, type AnyPgTable } from 'drizzle-orm/pg-core';

import { registeredGeneratedTableSecurityManifest } from './generated-table-security-registry.js';
import type { RuntimeTableSecurityWireTable } from './internal/runtime-registry-wire.js';
import {
  postgresOwnerColumnPolicyTerm,
  renderPostgresOwnerPolicyPredicate,
  type FrameworkPostgresOwnerPolicyAudit,
} from './postgres-authorization-correspondence.js';
import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessObjectKeys,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import { snapshotFrameworkNativeDrizzleOwnerGuardTableForExecution } from './sql-safe-handle.js';

interface FrameworkPostgresOwnerGuardBinding {
  readonly keyColumn: AnyPgColumn;
  readonly keyUniqueness: 'primary' | 'unique';
  readonly ownerColumn: AnyPgColumn;
  readonly ownerPolicy: FrameworkPostgresOwnerPolicyAudit;
  readonly schemaName: string;
  readonly table: AnyPgTable;
}

interface FrameworkPostgresOwnerGuardSchema {
  readonly bindingsByKeyColumn: WeakMap<object, FrameworkPostgresOwnerGuardBinding>;
}

interface FrameworkPostgresOwnerGuardRequestDb {
  readonly executionDb: object;
  readonly principal: string;
  readonly schema: FrameworkPostgresOwnerGuardSchema;
}

export interface FrameworkPostgresOwnerGuardColumnSnapshot {
  readonly keyColumn: object;
  readonly ownerPolicy: FrameworkPostgresOwnerPolicyAudit;
}

const frameworkPostgresOwnerGuardSchemas = createWitnessWeakMap<
  object,
  FrameworkPostgresOwnerGuardSchema
>();
const frameworkPostgresOwnerGuardRequestDbs = createWitnessWeakMap<
  object,
  FrameworkPostgresOwnerGuardRequestDb
>();

/**
 * Authenticate the public `guards.owns(keyOf, table.keyColumn)` argument against the compiler-owned
 * manifest that generated this app boot. This step carries no row-lookup authority: the exact live
 * schema identity and principal-scoped database handle are independently required at evaluation.
 *
 * @internal SPEC §10.3 finite generated owner-policy correspondence.
 */
export function snapshotFrameworkPostgresOwnerGuardColumn(
  keyColumn: unknown,
): FrameworkPostgresOwnerGuardColumnSnapshot {
  if (typeof keyColumn !== 'object' || keyColumn === null) {
    throw invalidOwnerGuardColumn();
  }
  const tableDescriptor = witnessGetOwnPropertyDescriptor(keyColumn, 'table');
  if (tableDescriptor === undefined || !('value' in tableDescriptor)) {
    throw invalidOwnerGuardColumn();
  }
  const table = tableDescriptor.value;
  if (typeof table !== 'object' || table === null) throw invalidOwnerGuardColumn();

  let tableName: string;
  let columns: Record<string, AnyPgColumn>;
  try {
    tableName = witnessReflectApply(getTableName, undefined, [table as AnyPgTable]);
    columns = witnessReflectApply(getTableColumns, undefined, [table as AnyPgTable]);
  } catch {
    throw invalidOwnerGuardColumn();
  }
  const manifest = registeredGeneratedTableSecurityManifest();
  if (manifest === undefined) {
    throw new TypeError(
      'guards.owns() requires the compiler-generated table-security manifest; direct library and non-generated runtimes must use guards.unprovenOwns() (SPEC §10.3).',
    );
  }
  const manifestTable = manifestTableByName(manifest.tables, tableName);
  if (
    manifestTable === undefined ||
    manifestTable.dialect !== 'postgres' ||
    manifestTable.domain === undefined ||
    manifestTable.key === undefined ||
    manifestTable.key.uniqueness === 'none' ||
    manifestTable.owner === undefined ||
    manifestTable.ownerVia !== undefined
  ) {
    throw new TypeError(
      'guards.owns() proves only compiler-declared single-key direct-owner Postgres tables; use guards.unprovenOwns() for SQLite, ownerVia, composite, or custom ownership (SPEC §10.3).',
    );
  }

  assertManifestTableRuntimeShape(table, columns, manifestTable.columns);
  const liveKeyColumn = ownDataObject(table, manifestTable.key.columnKey);
  const liveOwnerColumn = ownDataObject(table, manifestTable.owner.columnKey);
  if (
    liveKeyColumn !== keyColumn ||
    liveOwnerColumn === undefined ||
    !columnMatchesManifestUniqueness(keyColumn, manifestTable.key.uniqueness) ||
    !columnsContainIdentity(columns, keyColumn) ||
    !columnsContainIdentity(columns, liveOwnerColumn) ||
    ownDataString(keyColumn, 'name') !== manifestTable.key.columnName ||
    ownDataString(liveOwnerColumn, 'name') !== manifestTable.owner.columnName
  ) {
    throw invalidOwnerGuardColumn();
  }

  const term = postgresOwnerColumnPolicyTerm({
    columnName: manifestTable.owner.columnName,
    tableName: manifestTable.name,
  });
  return witnessFreeze({
    keyColumn,
    ownerPolicy: witnessFreeze({
      columnName: term.columnName,
      domain: manifestTable.domain,
      emissionSite: 'owner' as const,
      keyColumnName: manifestTable.key.columnName,
      predicate: renderPostgresOwnerPolicyPredicate(term),
      tableName: term.tableName,
    }),
  });
}

/**
 * Bind one compiler-validated runtime schema to stable native Drizzle query identities.
 * No app callback or lookup function crosses this door.
 *
 * @internal Called only by createPostgresAppRuntimeDb after full manifest/runtime comparison.
 */
export function registerFrameworkPostgresOwnerGuardSchema(
  metadata: KovoRuntimeDbMetadata,
  tables: readonly AnyPgTable[],
): void {
  const manifest = registeredGeneratedTableSecurityManifest();
  if (manifest === undefined) return;
  const bindingsByKeyColumn = createWitnessWeakMap<object, FrameworkPostgresOwnerGuardBinding>();

  for (let index = 0; index < tables.length; index += 1) {
    const table = denseArrayValue(tables, index, 'Postgres owner-guard schema tables');
    const tableName = witnessReflectApply<string>(getTableName, undefined, [table]);
    const manifestTable = manifestTableByName(manifest.tables, tableName);
    if (
      manifestTable === undefined ||
      manifestTable.dialect !== 'postgres' ||
      manifestTable.domain === undefined ||
      manifestTable.key === undefined ||
      manifestTable.key.uniqueness === 'none' ||
      manifestTable.owner === undefined ||
      manifestTable.ownerVia !== undefined
    ) {
      continue;
    }
    const keySource = witnessMapGet(metadata.keySourcesByTable, tableName);
    const ownerSource = witnessMapGet(metadata.ownerSourcesByTable, tableName);
    if (
      keySource === undefined ||
      ownerSource === undefined ||
      keySource.columnKey !== manifestTable.key.columnKey ||
      keySource.columnName !== manifestTable.key.columnName ||
      keySource.uniqueness !== manifestTable.key.uniqueness ||
      ownerSource.columnKey !== manifestTable.owner.columnKey ||
      ownerSource.columnName !== manifestTable.owner.columnName
    ) {
      throw new TypeError(
        `KV414: compiler/runtime owner-guard schema mismatch for ${tableName} (SPEC §10.3).`,
      );
    }
    const sourceKeyColumn = ownDataObject(table, keySource.columnKey);
    const sourceOwnerColumn = ownDataObject(table, ownerSource.columnKey);
    // A non-proved table remains a valid managed schema; it simply receives no proof binding.
    if (
      sourceKeyColumn === undefined ||
      !columnMatchesManifestUniqueness(sourceKeyColumn, keySource.uniqueness)
    ) {
      continue;
    }
    if (sourceOwnerColumn === undefined) {
      throw new TypeError(
        `KV414: compiler/runtime owner-guard owner identity diverged for ${tableName} (SPEC §10.3).`,
      );
    }
    const keyIdentity = witnessMapGet(metadata.columnSources, sourceKeyColumn);
    const ownerIdentity = witnessMapGet(metadata.columnSources, sourceOwnerColumn);
    if (
      keyIdentity === undefined ||
      keyIdentity.key !== keySource.columnKey ||
      keyIdentity.column !== keySource.columnName ||
      keyIdentity.table !== tableName ||
      ownerIdentity === undefined ||
      ownerIdentity.key !== ownerSource.columnKey ||
      ownerIdentity.column !== ownerSource.columnName ||
      ownerIdentity.table !== tableName ||
      ownerIdentity.schema !== keyIdentity.schema
    ) {
      throw new TypeError(
        `KV414: compiler/runtime owner-guard column identity diverged for ${tableName} (SPEC §10.3).`,
      );
    }

    // This framework-owned evaluator emits only these two manifest-proven column identities.
    // Reconstructing the whole Drizzle table would unnecessarily carry unrelated DDL/default SQL
    // into the SELECT sink (SPEC §6.6 C9/C15, §10.3 finite owner-policy correspondence).
    const stable = snapshotFrameworkNativeDrizzleOwnerGuardTableForExecution(
      table,
      tableName,
      keyIdentity.schema,
      sourceKeyColumn,
      keySource.columnKey,
      keySource.columnName,
      sourceOwnerColumn,
      ownerSource.columnKey,
      ownerSource.columnName,
    );
    const stableTable = stable.table as AnyPgTable;
    const stableKeyColumn = stable.keyColumn as AnyPgColumn;
    const stableOwnerColumn = stable.ownerColumn as AnyPgColumn;
    const term = postgresOwnerColumnPolicyTerm({
      columnName: ownerSource.columnName,
      tableName,
    });
    witnessWeakMapSet(
      bindingsByKeyColumn,
      sourceKeyColumn,
      witnessFreeze({
        keyColumn: stableKeyColumn,
        keyUniqueness: keySource.uniqueness,
        ownerColumn: stableOwnerColumn,
        ownerPolicy: witnessFreeze({
          columnName: term.columnName,
          domain: manifestTable.domain,
          emissionSite: 'owner' as const,
          keyColumnName: keySource.columnName,
          predicate: renderPostgresOwnerPolicyPredicate(term),
          tableName: term.tableName,
        }),
        schemaName: keyIdentity.schema === undefined ? 'public' : keyIdentity.schema,
        table: stableTable,
      }),
    );
  }

  witnessWeakMapSet(
    frameworkPostgresOwnerGuardSchemas,
    metadata as object,
    witnessFreeze({ bindingsByKeyColumn }),
  );
}

/**
 * Register one exact principal-scoped raw DB identity. Privileged role-setting handles are never
 * enrolled, so a framework guard cannot accidentally prove through admin/system authority.
 *
 * @internal Called while constructing a managed Postgres request handle.
 */
export function registerFrameworkPostgresOwnerGuardRequestDb(
  db: unknown,
  metadata: KovoRuntimeDbMetadata,
  scope: { readonly principal?: string; readonly roleSetting?: string },
  executionDb: unknown = db,
): void {
  if (
    typeof db !== 'object' ||
    db === null ||
    typeof executionDb !== 'object' ||
    executionDb === null ||
    scope.roleSetting !== undefined
  ) {
    return;
  }
  if (scope.principal === undefined || scope.principal === '') return;
  const schema = witnessWeakMapGet(frameworkPostgresOwnerGuardSchemas, metadata as object);
  if (schema === undefined) return;
  witnessWeakMapSet(
    frameworkPostgresOwnerGuardRequestDbs,
    db,
    witnessFreeze({ executionDb, principal: scope.principal, schema }),
  );
}

/**
 * Enroll one exact framework-composed lifecycle wrapper from an already registered request DB.
 * This is deliberately one hop: arbitrary wrappers cannot recover authority by exposing a raw
 * target that eventually reaches a registered handle (SPEC §10.3).
 *
 * @internal Called only at the request lifecycle's managed-handle composition point.
 */
export function registerFrameworkPostgresOwnerGuardDerivedRequestDb(
  db: unknown,
  source: unknown,
): void {
  if (
    (typeof db !== 'object' && typeof db !== 'function') ||
    db === null ||
    (typeof source !== 'object' && typeof source !== 'function') ||
    source === null
  ) {
    return;
  }
  // `managedDb(..., 'read')` may return an already-enrolled, sealed engine-reader handle. Preserve
  // that exact execution identity: the lifecycle also sees the writer-scoped source provider, but
  // it must never replace the reader registration selected for this request (SPEC §10.3).
  if (witnessWeakMapGet(frameworkPostgresOwnerGuardRequestDbs, db) !== undefined) return;
  const registration = witnessWeakMapGet(frameworkPostgresOwnerGuardRequestDbs, source);
  if (registration !== undefined) {
    witnessWeakMapSet(frameworkPostgresOwnerGuardRequestDbs, db, registration);
  }
}

/** Evaluate the fixed direct-owner lookup through the exact managed request DB. @internal */
export async function evaluateFrameworkPostgresOwnerGuard(
  request: unknown,
  key: unknown,
  snapshot: FrameworkPostgresOwnerGuardColumnSnapshot,
  principal: string | undefined,
): Promise<boolean> {
  if (principal === undefined || principal === '') return false;
  const requestDb = ownDataObject(request, 'db');
  if (requestDb === undefined) return false;
  // SPEC §10.3: the proof is bound to the exact principal-scoped request handle. Never inherit
  // authority from a raw target hidden behind a different, unregistered managed wrapper.
  const requestRegistration = witnessWeakMapGet(frameworkPostgresOwnerGuardRequestDbs, requestDb);
  if (requestRegistration === undefined || requestRegistration.principal !== principal)
    return false;
  const binding = witnessWeakMapGet(
    requestRegistration.schema.bindingsByKeyColumn,
    snapshot.keyColumn,
  );
  if (binding === undefined || !sameOwnerPolicy(binding.ownerPolicy, snapshot.ownerPolicy)) {
    return false;
  }

  const executionDb = requestRegistration.executionDb;
  const rows = await executeOwnerGuardQuery(executionDb, binding, key, principal);
  if (!witnessIsArray(rows) || denseArrayLength(rows, 'Postgres owner-guard rows') !== 1) {
    return false;
  }
  const row = denseArrayValue(rows, 0, 'Postgres owner-guard rows');
  return ownDataValue(row, 'owner') === principal;
}

function manifestTableByName(
  tables: readonly RuntimeTableSecurityWireTable[],
  name: string,
): RuntimeTableSecurityWireTable | undefined {
  for (let index = 0; index < tables.length; index += 1) {
    const table = denseArrayValue(tables, index, 'compiler table-security manifest');
    if (table.name === name) return table;
  }
  return undefined;
}

function columnMatchesManifestUniqueness(
  column: unknown,
  uniqueness: 'none' | 'primary' | 'unique',
): boolean {
  const primary = ownDataValue(column, 'primary') === true;
  const unique = ownDataValue(column, 'isUnique') === true;
  return uniqueness === 'primary'
    ? primary
    : uniqueness === 'unique'
      ? !primary && unique
      : !primary && !unique;
}

async function executeOwnerGuardQuery(
  executionDb: object,
  binding: FrameworkPostgresOwnerGuardBinding,
  key: unknown,
  principal: string,
): Promise<unknown> {
  const executeDescriptor = witnessGetOwnPropertyDescriptor(executionDb, 'execute');
  const execute =
    executeDescriptor !== undefined && 'value' in executeDescriptor
      ? executeDescriptor.value
      : (executionDb as { readonly execute?: unknown }).execute;
  if (typeof execute !== 'function') return undefined;
  try {
    const result = await witnessReflectApply<Promise<unknown> | unknown>(execute, executionDb, [
      // The catalog proof and row read deliberately share one statement. The target-table scan's
      // AccessShare lock prevents a concurrent constraint drop from interleaving between proof and
      // use, while all app-derived values remain parameters (SPEC §6.6 C9/C15, §10.3).
      sql`select ${binding.ownerColumn} as "owner"
          from ${binding.table}
         where exists (
           select 1
             from pg_catalog.pg_constraint as constraint_row
             join pg_catalog.pg_class as relation_row
               on relation_row.oid = constraint_row.conrelid
             join pg_catalog.pg_namespace as namespace_row
               on namespace_row.oid = relation_row.relnamespace
             join pg_catalog.pg_attribute as key_column
               on key_column.attrelid = relation_row.oid
              and key_column.attnum = constraint_row.conkey[1]
             join pg_catalog.pg_index as index_row
               on index_row.indexrelid = constraint_row.conindid
              and index_row.indrelid = relation_row.oid
             join pg_catalog.pg_class as index_relation
               on index_relation.oid = index_row.indexrelid
             join pg_catalog.pg_am as access_method
               on access_method.oid = index_relation.relam
             join pg_catalog.pg_opclass as opclass_row
               on opclass_row.oid = index_row.indclass[0]
            where namespace_row.nspname = ${binding.schemaName}
              and relation_row.relname = ${binding.ownerPolicy.tableName}
              and constraint_row.contype = ${binding.keyUniqueness === 'primary' ? 'p' : 'u'}
              and constraint_row.convalidated
              and not constraint_row.condeferrable
              and not constraint_row.condeferred
              and cardinality(constraint_row.conkey) = 1
              and key_column.attname = ${binding.ownerPolicy.keyColumnName}
              and access_method.amname = 'btree'
              and index_row.indisunique
              and index_row.indisvalid
              and index_row.indisready
              and index_row.indimmediate
              and not index_row.indisexclusion
              and index_row.indnkeyatts = 1
              and index_row.indnatts = 1
              and index_row.indkey[0] = key_column.attnum
              and index_row.indcollation[0] = key_column.attcollation
              and index_row.indexprs is null
              and index_row.indpred is null
              and opclass_row.opcdefault
              and opclass_row.opcmethod = access_method.oid
         )
           and ${binding.keyColumn} = ${key}
           and ${binding.ownerColumn} = ${principal}
         limit 2`,
    ]);
    return witnessIsArray(result) ? result : ownDataValue(result, 'rows');
  } catch {
    return undefined;
  }
}

function assertManifestTableRuntimeShape(
  table: object,
  configColumns: Record<string, AnyPgColumn>,
  manifestColumns: readonly { readonly key: string; readonly name: string }[],
): void {
  const columnKeys = witnessObjectKeys(configColumns);
  if (denseArrayLength(columnKeys, 'Postgres table column keys') !== manifestColumns.length) {
    throw invalidOwnerGuardColumn();
  }
  for (let index = 0; index < manifestColumns.length; index += 1) {
    const expected = denseArrayValue(manifestColumns, index, 'compiler table columns');
    const column = ownDataObject(table, expected.key);
    if (
      column === undefined ||
      ownDataString(column, 'name') !== expected.name ||
      !columnsContainIdentity(configColumns, column)
    ) {
      throw invalidOwnerGuardColumn();
    }
  }
}

function columnsContainIdentity(columns: Record<string, AnyPgColumn>, expected: unknown): boolean {
  const keys = witnessObjectKeys(columns);
  const length = denseArrayLength(keys, 'Postgres table column keys');
  for (let index = 0; index < length; index += 1) {
    const key = denseArrayValue(keys, index, 'Postgres table column keys');
    if (ownDataValue(columns, key) === expected) return true;
  }
  return false;
}

function ownDataObject(value: unknown, property: PropertyKey): object | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
    return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'object' &&
    descriptor.value !== null
    ? descriptor.value
    : undefined;
}

function ownDataString(value: unknown, property: PropertyKey): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
    return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function ownDataValue(value: unknown, property: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
    return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function denseArrayLength(value: readonly unknown[], label: string): number {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    !Number.isSafeInteger(descriptor.value) ||
    descriptor.value < 0
  ) {
    throw new TypeError(`${label} must be a dense own-data array.`);
  }
  return descriptor.value;
}

function denseArrayValue<Value>(value: readonly Value[], index: number, label: string): Value {
  const descriptor = witnessGetOwnPropertyDescriptor(value, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must be a dense own-data array.`);
  }
  return descriptor.value;
}

function sameOwnerPolicy(
  left: FrameworkPostgresOwnerPolicyAudit,
  right: FrameworkPostgresOwnerPolicyAudit,
): boolean {
  return (
    left.columnName === right.columnName &&
    left.domain === right.domain &&
    left.emissionSite === right.emissionSite &&
    left.keyColumnName === right.keyColumnName &&
    left.predicate === right.predicate &&
    left.tableName === right.tableName
  );
}

function invalidOwnerGuardColumn(): TypeError {
  return new TypeError(
    'guards.owns() requires the exact declared key column from a compiler-generated direct-owner Postgres table (SPEC §10.3).',
  );
}
