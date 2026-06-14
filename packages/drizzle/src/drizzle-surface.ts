export const DRIZZLE_TABLE_FACTORY_NAMES = new Set(['pgTable']);

export const DRIZZLE_DATABASE_TYPE_NAMES = new Set([
  'NodePgDatabase',
  'PgDatabase',
  'PgliteDatabase',
  'PostgresJsDatabase',
]);

export const JISO_EXTRA_CONFIG_CALL_NAME = 'jiso';

/** A Jiso annotation on a Drizzle table: a `domain` (with optional row `key`), or an `exempt` marker. */
export type JisoTableAnnotation =
  | {
      domain: string;
      key?: string;
    }
  | {
      exempt: true;
    };

/** The domain-bearing form of a table annotation: its `domain` and optional `key` column. */
export interface JisoDomainTableAnnotation {
  domain: string;
  key?: string;
}

/** The value `jiso(...)` returns: a Drizzle extra-config callback carrying the annotation. */
export type JisoTableExtraConfig = JisoDomainTableAnnotation &
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
 * @returns A `JisoTableExtraConfig` to return from the table's extra-config callback.
 * @example
 * import { jiso } from '@jiso/drizzle';
 *
 * export const cartConfig = () => jiso({ domain: 'cart', key: 'id' });
 */
export function jiso(annotation: JisoTableAnnotation): JisoTableExtraConfig {
  return Object.assign((() => []) as (self: unknown) => [], annotation) as JisoTableExtraConfig;
}

export function isDrizzleDatabaseTypeName(name: string): boolean {
  return DRIZZLE_DATABASE_TYPE_NAMES.has(name) || /^Neon.*Database$/.test(name);
}

export function isDrizzleTableFactoryName(name: string): boolean {
  return DRIZZLE_TABLE_FACTORY_NAMES.has(name);
}

export function isJisoExtraConfigCallName(name: string): boolean {
  return name === JISO_EXTRA_CONFIG_CALL_NAME;
}

export function isDomainTableAnnotation(
  annotation: JisoTableAnnotation & { name?: string },
): annotation is JisoDomainTableAnnotation & { name: string } {
  return 'domain' in annotation;
}

export function isExemptTableAnnotation(
  annotation: JisoTableAnnotation & { name?: string },
): annotation is { exempt: true; name: string } {
  return 'exempt' in annotation && annotation.exempt === true;
}
