import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';

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

/** Drizzle-derived metadata consumed by the server read-confidentiality boundary. */
export interface KovoRuntimeDbMetadata {
  /** Every known Drizzle column key in the schema. */
  allColumnKeys: ReadonlySet<string>;
  /** Runtime object identity map for Drizzle column objects used in SQL expressions. */
  columnSources: ReadonlyMap<object, KovoRuntimeDbColumnSource>;
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
  const allColumnKeys = new Set<string>();
  const columnSources = new Map<object, KovoRuntimeDbColumnSource>();
  const secretColumnKeys = new Set<string>();
  const secretColumnNames = new Set<string>();
  const secretColumnKeysByTable = new Map<string, ReadonlySet<string>>();
  const secretColumnNamesByTable = new Map<string, ReadonlySet<string>>();
  const secretTableNames = new Set<string>();

  for (const table of tables) {
    const config = getRuntimeTableConfig(table);
    const columnKeys = columnKeysByDbName(table as KovoRuntimeDbTable, config.columns);
    for (const key of columnKeys.values()) allColumnKeys.add(key);

    const secretAnnotation = kovoSecretAnnotation(table as KovoRuntimeDbTable);
    const tableSecretColumnKeys = new Set<string>();
    const tableSecretColumnNames = new Set<string>();
    const secretKeys =
      secretAnnotation === undefined
        ? []
        : secretAnnotation === true
          ? [...columnKeys.values()]
          : kovoSecretColumnKeys(secretAnnotation, table as KovoRuntimeDbTable, columnKeys);

    for (const key of secretKeys) {
      secretColumnKeys.add(key);
      tableSecretColumnKeys.add(key);
      const column = Reflect.get(table as object, key);
      const dbName = isColumnLike(column) ? column.name : key;
      secretColumnNames.add(dbName);
      tableSecretColumnNames.add(dbName);
    }

    if (secretAnnotation !== undefined) {
      secretTableNames.add(config.name);
      secretColumnKeysByTable.set(config.name, tableSecretColumnKeys);
      secretColumnNamesByTable.set(config.name, tableSecretColumnNames);
    }

    for (const [dbName, key] of columnKeys) {
      const column = Reflect.get(table as object, key);
      if (!isColumnLike(column)) continue;
      columnSources.set(column, {
        column: dbName,
        key,
        secret: tableSecretColumnKeys.has(key) || tableSecretColumnNames.has(dbName),
        table: config.name,
      });
    }
  }

  return {
    allColumnKeys,
    columnSources,
    secretColumnKeys,
    secretColumnKeysByTable,
    secretColumnNames,
    secretColumnNamesByTable,
    secretTableNames,
  };
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
  const keys = new Map<string, string>();
  for (const [key, value] of Object.entries(table as unknown as Record<string, unknown>)) {
    if (isColumnLike(value)) keys.set(value.name, key);
  }
  for (const column of columns) {
    if (!keys.has(column.name)) keys.set(column.name, column.name);
  }
  return keys;
}

function kovoSecretAnnotation(
  table: KovoRuntimeDbTable,
): true | string | readonly unknown[] | undefined {
  for (const value of [
    ...Object.values(table as unknown as Record<string, unknown>),
    ...Object.getOwnPropertySymbols(table).map((symbol) => Reflect.get(table as object, symbol)),
  ]) {
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      'secret' in value
    ) {
      const secretValue = (value as { secret?: unknown }).secret;
      if (secretValue === true || typeof secretValue === 'string' || Array.isArray(secretValue)) {
        return secretValue;
      }
    }
  }
  return undefined;
}

function kovoSecretColumnKeys(
  annotation: string | readonly unknown[],
  table: KovoRuntimeDbTable,
  columnKeys: ReadonlyMap<string, string>,
): string[] {
  const refs = Array.isArray(annotation) ? annotation : [annotation];
  return refs.flatMap((ref) => {
    if (typeof ref === 'string') return [columnKeys.get(ref) ?? ref];
    if (typeof ref !== 'function') return [];
    try {
      const selected = ref(table);
      return isColumnLike(selected) ? [columnKeys.get(selected.name) ?? selected.name] : [];
    } catch {
      return [];
    }
  });
}

function isColumnLike(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}
