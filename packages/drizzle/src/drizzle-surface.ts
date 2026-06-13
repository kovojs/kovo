export const DRIZZLE_TABLE_FACTORY_NAMES = new Set(['pgTable']);

export const DRIZZLE_DATABASE_TYPE_PATTERN =
  /\b(?:PgDatabase|NodePgDatabase|PostgresJsDatabase|PgliteDatabase|Neon.*Database)\b/;

export const JISO_EXTRA_CONFIG_CALL_NAME = 'jiso';

export type JisoTableAnnotation =
  | {
      domain: string;
      key?: string;
    }
  | {
      exempt: true;
    };

export interface JisoDomainTableAnnotation {
  domain: string;
  key?: string;
}

export type JisoTableExtraConfig = JisoDomainTableAnnotation &
  ((self: unknown) => []) & {
    exempt?: true;
  };

export function jiso(annotation: JisoTableAnnotation): JisoTableExtraConfig {
  return Object.assign((() => []) as (self: unknown) => [], annotation) as JisoTableExtraConfig;
}

export function isDrizzleDatabaseTypeText(typeText: string): boolean {
  return DRIZZLE_DATABASE_TYPE_PATTERN.test(typeText);
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
