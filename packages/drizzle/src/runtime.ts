import { sql as drizzleSql, type SQL } from 'drizzle-orm';
import {
  mergeSqlSafetyMetadata,
  stampParameterizedSql,
  stampRawSqlChunk,
  stampSqlIdentifier,
  stampSqlKeyword,
  stampStaticSql,
  stampTrustedSql,
  validateSqlAllow,
  validateSqlIdentifier,
} from '@kovojs/core/internal/sql-safety';

export type {
  KovoAnalyzerFunctionSummary,
  KovoAnalyzerPrivateScopeKind,
  KovoColumnRef,
  KovoConfidentialAtRestColumnAnnotation,
  KovoConcurrencyColumnAnnotation,
  KovoDomainRef,
  KovoDomainTableAnnotation,
  KovoFanAnnotation,
  KovoGovernedColumnAnnotation,
  KovoSecretColumnAnnotation,
  KovoTableAnnotation,
  KovoTableExtraConfig,
  KovoViewAnnotation,
  KovoViewExtraConfig,
  KovoViewExtraConfigAnnotation,
} from './drizzle-surface.js';
export { kovo, kovoAnalyzerSummary } from './drizzle-surface.js';
export { extractKovoRuntimeDbMetadata } from './runtime-metadata.js';
export type {
  KovoRuntimeDbColumnSource,
  KovoRuntimeDbMetadata,
  KovoRuntimeDbTable,
} from './runtime-metadata.js';
// KV429 (SPEC §10.3/§11.1): compare-and-set helper — folds check+act into one UPDATE…WHERE
// so a lost-update race is impossible by construction. Zero rowsAffected → CasConflict;
// ≥1 rowsAffected → CasSuccess. Pair with StaleVersionError from @kovojs/server.
export { compareAndSet } from './cas.js';
export type { CasConflict, CasResult, CasSuccess, DrizzleUpdateResult } from './cas.js';

/**
 * Kovo-branded parameterized SQL value accepted by framework-managed DB handles.
 *
 * Produced by {@link sql}; scalar interpolations are bound parameters rather than SQL text.
 */
export interface KovoParameterizedSql<T = unknown> extends SQL<T> {
  /**
   * Version-tolerant Drizzle `SQLWrapper` bridge. Apps may resolve a different
   * Drizzle minor than this package's dev dependency; returning `any` keeps the
   * wrapper structurally accepted by those sinks while runtime still returns the
   * concrete Drizzle SQL object produced below.
   */
  getSQL(): any;
  readonly __kovoSqlBrand?: 'parameterized';
}

/**
 * Kovo-branded literal SQL text accepted by framework-managed DB handles.
 *
 * Produced by {@link staticSql}, {@link sql.identifier}, and {@link sql.allow}.
 */
export interface KovoStaticSql<T = unknown> extends SQL<T> {
  /** See {@link KovoParameterizedSql.getSQL}. */
  getSQL(): any;
  readonly __kovoSqlBrand?: 'static';
}

/**
 * Kovo-branded audited raw SQL accepted by framework-managed DB handles.
 *
 * Produced only by {@link trustedSql}; use it for reviewed raw-SQL escape hatches with a
 * source-visible justification.
 */
export interface KovoTrustedSql<T = unknown> extends SQL<T> {
  /** See {@link KovoParameterizedSql.getSQL}. */
  getSQL(): any;
  readonly __kovoSqlBrand?: 'trusted';
}

/**
 * Kovo-branded SQL identifier fragment accepted by framework-managed DB handles.
 *
 * Produced by {@link sql.identifier}; dynamic values are grammar-checked and may be constrained
 * by an allowlist before the witness is minted.
 */
export interface KovoSqlIdentifier<T = unknown> extends KovoStaticSql<T> {
  readonly __kovoSqlIdentifierBrand?: 'identifier';
}

/**
 * Kovo-branded SQL keyword/clause fragment accepted by framework-managed DB handles.
 *
 * Produced by {@link sql.allow}; the value must match the supplied static allowlist.
 */
export interface KovoSqlKeyword<T = unknown> extends KovoStaticSql<T> {
  readonly __kovoSqlKeywordBrand?: 'keyword';
}

type SqlTag = (<T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => KovoParameterizedSql<T>) & {
  allow<T = unknown>(value: string, allow: readonly string[]): KovoSqlKeyword<T>;
  identifier<T = unknown>(
    value: string,
    options?: { allow?: readonly string[] },
  ): KovoSqlIdentifier<T>;
  join<T = unknown>(parts: readonly unknown[], separator?: unknown): KovoParameterizedSql<T>;
  raw<T = unknown>(value: string): KovoStaticSql<T>;
};

/**
 * Kovo-owned SQL tag. Scalar interpolations remain bound parameters through Drizzle's
 * serializer; Kovo stamps the resulting SQL object so managed DB guards can reject raw strings
 * while still accepting parameterized builders (SPEC §10.2/§10.3 SQL safety).
 */
export const sql = (<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
  const statement = drizzleSql<T>(strings, ...values);
  return stampParameterizedSql(statement, mergeSqlSafetyMetadata(values));
}) as unknown as SqlTag;

sql.raw = <T = unknown>(value: string) => {
  const raw = drizzleSql.raw(value) as SQL<T>;
  stampRawSqlChunk(raw);
  return stampStaticSql(raw, { containsRawChunk: true });
};

sql.identifier = <T = unknown>(value: string, options: { allow?: readonly string[] } = {}) => {
  const identifier = validateSqlIdentifier(value, options.allow);
  const factory = (
    drizzleSql as unknown as { identifier?: <TResult = unknown>(value: string) => SQL<TResult> }
  ).identifier;
  const statement =
    typeof factory === 'function'
      ? factory<T>(identifier)
      : (drizzleSql.raw(quoteSqlIdentifier(identifier)) as SQL<T>);
  return stampSqlIdentifier(statement);
};

sql.allow = <T = unknown>(value: string, allow: readonly string[]) => {
  const fragment = validateSqlAllow(value, allow);
  return stampSqlKeyword(drizzleSql.raw(fragment) as SQL<T>);
};

sql.join = <T = unknown>(parts: readonly unknown[], separator: unknown = drizzleSql.raw(', ')) => {
  const factory = (
    drizzleSql as unknown as {
      join?: <TResult = unknown>(parts: unknown[], separator?: unknown) => SQL<TResult>;
    }
  ).join;
  const statement =
    typeof factory === 'function'
      ? factory<T>([...parts], separator)
      : drizzleSql<T>`${parts.reduce<unknown[]>((items, part, index) => {
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
export function staticSql<T = unknown>(
  strings: TemplateStringsArray,
  ...values: never[]
): KovoStaticSql<T> {
  if (values.length > 0) {
    throw new Error('staticSql accepts literal-only SQL text; use sql`...` for parameters.');
  }
  return stampStaticSql(drizzleSql.raw(strings.join('')) as SQL<T>);
}

/**
 * Audited raw-SQL escape hatch. This is the only Kovo brand that may execute a statement
 * containing `sql.raw(...)` chunks on managed DB handles.
 */
export function trustedSql<TResult = unknown, T extends SQL<TResult> = SQL<TResult>>(
  statement: T,
  options: { justification: string },
): T & KovoTrustedSql<TResult> {
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
