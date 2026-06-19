export const DRIZZLE_TABLE_FACTORY_NAMES = new Set(['pgTable']);

export const DRIZZLE_DATABASE_TYPE_NAMES = new Set([
  'NodePgDatabase',
  'PgDatabase',
  'PgliteDatabase',
  'PostgresJsDatabase',
]);

export const KOVO_EXTRA_CONFIG_CALL_NAME = 'kovo';

export interface KovoFanAnnotation {
  domain: string;
  via: string;
  when?: 'delete' | 'insert' | 'update';
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

/**
 * Annotate a Drizzle table with the invalidation domain it belongs to (or mark
 * it `exempt`). Used in a table's extra-config callback so the compiler can
 * extract the touch graph from queries and writes against that table — the
 * Drizzle-blessed path to schema-as-domain-registry (SPEC §10.1).
 *
 * @param annotation - A `{ domain, key? }` binding, or `{ exempt: true }`.
 * @returns A `KovoTableExtraConfig` to return from the table's extra-config callback.
 * @example
 * import { kovo } from '@kovojs/drizzle';
 *
 * export const cartConfig = () => kovo({ domain: 'cart', key: 'id' });
 */
export function kovo(annotation: KovoTableAnnotation): KovoTableExtraConfig {
  return Object.assign((() => []) as (self: unknown) => [], annotation) as KovoTableExtraConfig;
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
