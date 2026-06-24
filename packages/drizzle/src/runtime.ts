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
  KovoAtomicColumnAnnotation,
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

const KOVO_CONFLICT_BRAND = '__kovoMutationConflict';

export interface KovoConflictOptions<Code extends string = 'CONFLICT', Payload = unknown> {
  code?: Code;
  payload?: Payload;
}

export interface KovoCompareAndSetOptions<
  Result,
  Code extends string = 'CONFLICT',
  Payload = unknown,
> extends KovoConflictOptions<Code, Payload> {
  affectedRows?: (result: Result) => number | bigint;
}

/**
 * Runtime error thrown by typed atomic-write helpers when a guarded update affects
 * zero rows. `@kovojs/server` maps this structural shape to a typed HTTP 409
 * mutation failure so enhanced forms re-render through the normal failure target
 * (SPEC §10.3 lifecycle; Phase 6 TOCTOU primitive).
 */
export class KovoConflictError<Code extends string = 'CONFLICT', Payload = unknown> extends Error {
  readonly [KOVO_CONFLICT_BRAND] = true;
  readonly code: Code;
  readonly payload: Payload;
  readonly status = 409;

  constructor(options: KovoConflictOptions<Code, Payload> = {}) {
    const code = options.code ?? ('CONFLICT' as Code);
    super(code);
    this.name = 'KovoConflictError';
    this.code = code;
    this.payload = options.payload as Payload;
  }
}

/**
 * Build a typed optimistic-concurrency conflict. Mutation handlers may return or
 * throw this value; {@link compareAndSet} throws it automatically for zero-row
 * guarded updates.
 */
export function kovoConflict<const Code extends string = 'CONFLICT', Payload = unknown>(
  options: KovoConflictOptions<Code, Payload> = {},
): KovoConflictError<Code, Payload> {
  return new KovoConflictError(options);
}

/** Return true for Kovo's structural conflict shape, even across package copies. */
export function isKovoConflictError(value: unknown): value is KovoConflictError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[KOVO_CONFLICT_BRAND] === true &&
    (value as Record<string, unknown>)['status'] === 409 &&
    typeof (value as Record<string, unknown>)['code'] === 'string'
  );
}

/**
 * Execute an atomic compare-and-set / version-guarded update and convert a
 * zero-row outcome into a typed conflict.
 *
 * Pass a Drizzle update promise or a thunk returning one. The update must fold
 * the check into its `WHERE` clause, for example:
 *
 * `compareAndSet(db.update(products).set({ stock: sql`${products.stock} - ${qty}` }).where(and(eq(products.id, id), gte(products.stock, qty))).returning({ id: products.id }))`
 *
 * The helper understands common driver row-count fields (`rowCount`,
 * `rowsAffected`, `affectedRows`, `changes`, `count`) and returned-row arrays.
 * For custom drivers, provide `affectedRows`.
 */
export async function compareAndSet<
  Result,
  const Code extends string = 'CONFLICT',
  Payload = unknown,
>(
  operation: PromiseLike<Result> | (() => PromiseLike<Result> | Result),
  options: KovoCompareAndSetOptions<Result, Code, Payload> = {},
): Promise<Result> {
  const result = await (typeof operation === 'function' ? operation() : operation);
  const affected = options.affectedRows?.(result) ?? inferAffectedRows(result);

  if (affected === undefined) {
    throw new TypeError(
      'compareAndSet could not infer affected rows; use .returning(...) or pass affectedRows.',
    );
  }
  if (affected === 0n || affected === 0) {
    throw kovoConflict({
      ...(options.code === undefined ? {} : { code: options.code }),
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });
  }
  return result;
}

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

function inferAffectedRows(result: unknown): bigint | number | undefined {
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'number' || typeof result === 'bigint') return result;
  if (typeof result !== 'object' || result === null) return undefined;

  for (const key of ['rowCount', 'rowsAffected', 'affectedRows', 'changes', 'count']) {
    const value = (result as Record<string, unknown>)[key];
    if (typeof value === 'number' || typeof value === 'bigint') return value;
  }

  return undefined;
}
