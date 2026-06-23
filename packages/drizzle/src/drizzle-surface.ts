export const DRIZZLE_TABLE_FACTORY_NAMES = new Set(['pgTable', 'sqliteTable']);

export const DRIZZLE_DATABASE_TYPE_NAMES = new Set([
  'BaseSQLiteDatabase',
  'BetterSQLite3Database',
  'BunSQLiteDatabase',
  'LibSQLDatabase',
  'NodePgDatabase',
  'PgDatabase',
  'PgliteDatabase',
  'PostgresJsDatabase',
  'SQLJsDatabase',
]);

export const KOVO_EXTRA_CONFIG_CALL_NAME = 'kovo';

/** Private server-side provenance kinds that the analyzer may use as proof inputs. */
export type KovoAnalyzerPrivateScopeKind = 'guard' | 'session' | 'tenant';

/**
 * A declared analyzer summary for a pure helper. The helper body is not inspected
 * for provenance; the static analyzer consumes this typed declaration instead.
 */
export interface KovoAnalyzerFunctionSummary {
  returns: {
    kind: KovoAnalyzerPrivateScopeKind;
    path: string;
  };
}

/**
 * A column reference inside a Kovo annotation: either the column name as a
 * string, or a `(table) => table.column` selector (the Drizzle idiom, SPEC
 * §10.1). The selector is read statically by the compiler and is never called at
 * runtime — the compiler resolves and validates the referenced column — so
 * renaming the column surfaces at the annotation site.
 */
export type KovoColumnRef = string | ((table: Record<string, unknown>) => unknown);

/**
 * A fan-out invalidation edge for a table's `fans`: when a write touches this table,
 * also invalidate the named `domain` reached `via` the given relation, optionally scoped
 * to a write `when` (`insert`/`update`/`delete`). The element type of `KovoTableAnnotation.fans`
 * and `KovoDomainTableAnnotation.fans` (SPEC §10.1 / KV413 declared engine-side-effect edges).
 */
export interface KovoFanAnnotation {
  domain: string;
  via: KovoColumnRef;
  when?: 'delete' | 'insert' | 'update';
}

/** Declares the backing invalidation domain and refresh mode for a Drizzle view relation. */
export interface KovoViewAnnotation {
  of: string;
  refresh?: 'async' | 'sync';
}

/** A Kovo annotation on a Drizzle table: a `domain` (with optional row `key` and principal `owner`), or an `exempt` marker. */
export type KovoTableAnnotation =
  | {
      domain: string;
      fans?: readonly KovoFanAnnotation[];
      key?: KovoColumnRef;
      owner?: KovoColumnRef;
    }
  | {
      exempt: true;
    };

/** A Kovo annotation for a Drizzle view or materialized view declaration. */
export interface KovoViewExtraConfigAnnotation {
  view: KovoViewAnnotation;
}

export type KovoAnnotation = KovoTableAnnotation | KovoViewExtraConfigAnnotation;

/** The domain-bearing form of a table annotation: its `domain`, optional `key` column, and optional principal `owner` column (SPEC §10.1). */
export interface KovoDomainTableAnnotation {
  domain: string;
  fans?: readonly KovoFanAnnotation[];
  key?: KovoColumnRef;
  owner?: KovoColumnRef;
}

/** The value `kovo(...)` returns: a Drizzle extra-config callback carrying the annotation. */
export type KovoTableExtraConfig = KovoDomainTableAnnotation &
  ((self: unknown) => []) & {
    exempt?: true;
  };

/** The value `kovo({ view })` returns for a Drizzle view/materialized-view declaration. */
export type KovoViewExtraConfig = KovoViewExtraConfigAnnotation & ((self: unknown) => []);

/**
 * Annotate a Drizzle table with the invalidation domain it belongs to, mark it
 * `exempt`, or declare a view/materialized-view backing domain. Used in a
 * relation's extra-config callback so the compiler can extract touch/read graph
 * facts from queries and writes — the Drizzle-blessed path to
 * schema-as-domain-registry (SPEC §10.1).
 *
 * @param annotation - A `{ domain, key?, owner? }` binding (`owner` names the
 *   principal-owning column for the §10.3 IDOR audit), `{ exempt: true }`, or
 *   `{ view: { of, refresh? } }` binding.
 * @returns A Drizzle extra-config callback carrying the Kovo annotation.
 * @example
 * import { kovo } from '@kovojs/drizzle';
 *
 * export const cartConfig = () => kovo({ domain: 'cart', key: (t) => t.id });
 */
export function kovo(annotation: KovoViewExtraConfigAnnotation): KovoViewExtraConfig;
export function kovo(annotation: KovoTableAnnotation): KovoTableExtraConfig;
export function kovo(annotation: KovoAnnotation): KovoTableExtraConfig | KovoViewExtraConfig {
  return Object.assign((() => []) as (self: unknown) => [], annotation) as
    | KovoTableExtraConfig
    | KovoViewExtraConfig;
}

/**
 * Declare a typed provenance summary for a same-package helper that participates
 * in server-side invalidation or optimistic-update proof. The runtime value is
 * the original helper; only the analyzer consumes the summary object.
 *
 * @param helper - The pure helper being summarized.
 * @param summary - A typed private-scope provenance summary.
 * @returns The original helper, unchanged at runtime.
 * @example
 * import { kovoAnalyzerSummary } from '@kovojs/drizzle';
 *
 * kovoAnalyzerSummary(requireSessionId, { returns: { kind: 'session', path: 'id' } });
 */
export function kovoAnalyzerSummary<T extends (...args: never[]) => unknown>(
  helper: T,
  summary: KovoAnalyzerFunctionSummary,
): T {
  void summary;
  return helper;
}

export function isDrizzleDatabaseTypeName(name: string): boolean {
  return DRIZZLE_DATABASE_TYPE_NAMES.has(name) || /^Neon.*Database$/.test(name);
}

export function isDrizzleTableFactoryName(name: string): boolean {
  return DRIZZLE_TABLE_FACTORY_NAMES.has(name);
}

export function isKovoExtraConfigCallName(name: string): boolean {
  return name === KOVO_EXTRA_CONFIG_CALL_NAME;
}

export function isDomainTableAnnotation(
  annotation: KovoTableAnnotation & { name?: string },
): annotation is KovoDomainTableAnnotation & { name: string } {
  return 'domain' in annotation;
}

export function isExemptTableAnnotation(
  annotation: KovoTableAnnotation & { name?: string },
): annotation is { exempt: true; name: string } {
  return 'exempt' in annotation && annotation.exempt === true;
}
