export const DRIZZLE_TABLE_FACTORY_NAMES = new Set(['pgTable']);

export const DRIZZLE_DATABASE_TYPE_NAMES = new Set([
  'NodePgDatabase',
  'PgDatabase',
  'PgliteDatabase',
  'PostgresJsDatabase',
]);

export const KOVO_EXTRA_CONFIG_CALL_NAME = 'kovo';

/**
 * A fan-out invalidation edge for a table's `fans`: when a write touches this table,
 * also invalidate the named `domain` reached `via` the given relation, optionally scoped
 * to a write `when` (`insert`/`update`/`delete`). The element type of `KovoTableAnnotation.fans`
 * and `KovoDomainTableAnnotation.fans` (SPEC §10.1 / KV413 declared engine-side-effect edges).
 */
export interface KovoFanAnnotation {
  domain: string;
  via: string;
  when?: 'delete' | 'insert' | 'update';
}

/** Declares the backing invalidation domain and refresh mode for a Drizzle view relation. */
export interface KovoViewAnnotation {
  of: string;
  refresh?: 'async' | 'sync';
}

/** A Kovo annotation on a Drizzle table: a `domain` (with optional row `key`), or an `exempt` marker. */
export type KovoTableAnnotation =
  | {
      domain: string;
      fans?: readonly KovoFanAnnotation[];
      key?: string;
    }
  | {
      exempt: true;
    };

/** A Kovo annotation for a Drizzle view or materialized view declaration. */
export interface KovoViewExtraConfigAnnotation {
  view: KovoViewAnnotation;
}

export type KovoAnnotation = KovoTableAnnotation | KovoViewExtraConfigAnnotation;

/** The domain-bearing form of a table annotation: its `domain` and optional `key` column. */
export interface KovoDomainTableAnnotation {
  domain: string;
  fans?: readonly KovoFanAnnotation[];
  key?: string;
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
 * @param annotation - A `{ domain, key? }` binding, `{ exempt: true }`, or
 *   `{ view: { of, refresh? } }` binding.
 * @returns A Drizzle extra-config callback carrying the Kovo annotation.
 * @example
 * import { kovo } from '@kovojs/drizzle';
 *
 * export const cartConfig = () => kovo({ domain: 'cart', key: 'id' });
 */
export function kovo(annotation: KovoViewExtraConfigAnnotation): KovoViewExtraConfig;
export function kovo(annotation: KovoTableAnnotation): KovoTableExtraConfig;
export function kovo(annotation: KovoAnnotation): KovoTableExtraConfig | KovoViewExtraConfig {
  return Object.assign((() => []) as (self: unknown) => [], annotation) as
    | KovoTableExtraConfig
    | KovoViewExtraConfig;
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
