import { sql as drizzleSql } from 'drizzle-orm';
import {
  mergeSqlSafetyMetadata,
  stampParameterizedSql,
  stampRawSqlChunk,
  stampStaticSql,
  stampTrustedSql,
  validateSqlAllow,
  validateSqlIdentifier,
} from '@kovojs/core/internal/sql-safety';

export type {
  KovoAnalyzerFunctionSummary,
  KovoAnalyzerPrivateScopeKind,
  KovoAdminAssignment,
  KovoColumnRef,
  KovoDomainTableAnnotation,
  KovoFanAnnotation,
  KovoGovernedColumnAnnotation,
  KovoSecretColumnAnnotation,
  KovoServerValue,
  KovoTableAnnotation,
  KovoTableExtraConfig,
  KovoViewAnnotation,
  KovoViewExtraConfig,
  KovoViewExtraConfigAnnotation,
} from './drizzle-surface.js';
export { adminAssign, kovo, kovoAnalyzerSummary, serverValue } from './drizzle-surface.js';

/**
 * Kovo-branded parameterized SQL value accepted by framework-managed DB handles.
 *
 * Produced by {@link sql}; scalar interpolations are bound parameters rather than SQL text.
 */
export interface KovoParameterizedSql {
  readonly __kovoSqlBrand?: 'parameterized';
}

/**
 * Kovo-branded literal SQL text accepted by framework-managed DB handles.
 *
 * Produced by {@link staticSql}, {@link sql.identifier}, and {@link sql.allow}.
 */
export interface KovoStaticSql {
  readonly __kovoSqlBrand?: 'static';
}

/**
 * Kovo-branded audited raw SQL accepted by framework-managed DB handles.
 *
 * Produced only by {@link trustedSql}; use it for reviewed raw-SQL escape hatches with a
 * source-visible justification.
 */
export interface KovoTrustedSql {
  readonly __kovoSqlBrand?: 'trusted';
}

type SqlTag = ((strings: TemplateStringsArray, ...values: unknown[]) => KovoParameterizedSql) & {
  allow(value: string, allow: readonly string[]): KovoStaticSql;
  identifier(value: string, options?: { allow?: readonly string[] }): KovoStaticSql;
  join(parts: readonly unknown[], separator?: unknown): KovoParameterizedSql;
  raw(value: string): KovoStaticSql;
};

/**
 * Kovo-owned SQL tag. Scalar interpolations remain bound parameters through Drizzle's
 * serializer; Kovo stamps the resulting SQL object so managed DB guards can reject raw strings
 * while still accepting parameterized builders (SPEC §10.2/§10.3 SQL safety).
 */
export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const statement = drizzleSql(strings, ...values);
  return stampParameterizedSql(statement, mergeSqlSafetyMetadata(values));
}) as unknown as SqlTag;

sql.raw = (value: string) => {
  const raw = drizzleSql.raw(value);
  stampRawSqlChunk(raw);
  return stampStaticSql(raw, { containsRawChunk: true });
};

sql.identifier = (value: string, options: { allow?: readonly string[] } = {}) => {
  const identifier = validateSqlIdentifier(value, options.allow);
  const factory = (drizzleSql as unknown as { identifier?: (value: string) => object }).identifier;
  const statement =
    typeof factory === 'function'
      ? factory(identifier)
      : drizzleSql.raw(quoteSqlIdentifier(identifier));
  return stampStaticSql(statement);
};

sql.allow = (value: string, allow: readonly string[]) => {
  const fragment = validateSqlAllow(value, allow);
  return stampStaticSql(drizzleSql.raw(fragment));
};

sql.join = (parts: readonly unknown[], separator: unknown = drizzleSql.raw(', ')) => {
  const factory = (
    drizzleSql as unknown as { join?: (parts: unknown[], separator?: unknown) => object }
  ).join;
  const statement =
    typeof factory === 'function'
      ? factory([...parts], separator)
      : drizzleSql`${parts.reduce<unknown[]>((items, part, index) => {
          if (index > 0) items.push(separator);
          items.push(part);
          return items;
        }, [])}`;
  return stampParameterizedSql(statement, mergeSqlSafetyMetadata([...parts, separator]));
};

/**
 * Literal-only SQL text. Use this for static DDL or prepared statement text; interpolations are
 * intentionally rejected so dynamic values must flow through `sql` placeholders instead.
 */
export function staticSql(strings: TemplateStringsArray, ...values: never[]): KovoStaticSql {
  if (values.length > 0) {
    throw new Error('staticSql accepts literal-only SQL text; use sql`...` for parameters.');
  }
  return stampStaticSql(drizzleSql.raw(strings.join('')));
}

/**
 * Audited raw-SQL escape hatch. This is the only Kovo brand that may execute a statement
 * containing `sql.raw(...)` chunks on managed DB handles.
 */
export function trustedSql<T extends object>(
  statement: T,
  options: { justification: string },
): T & KovoTrustedSql {
  if (!options.justification.trim()) {
    throw new Error('trustedSql requires a non-empty justification.');
  }
  return stampTrustedSql(statement, options.justification);
}

function quoteSqlIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.');
}
