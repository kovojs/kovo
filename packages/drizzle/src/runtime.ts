import { sql as drizzleSql, type SQL } from 'drizzle-orm';
import {
  invokeSqlConstructor,
  joinStaticSqlStrings,
  mergeSqlSafetyMetadata,
  snapshotSqlConstructorArray,
  stampParameterizedSql,
  stampRawSqlChunk,
  stampSqlIdentifier,
  stampSqlKeyword,
  stampStaticSql,
  stampTrustedSql,
  validateSqlAllow,
  validateSqlIdentifier,
} from '@kovojs/core/internal/sql-safety';

const DrizzleNativeNumber = globalThis.Number;
const DrizzleNativeObject = globalThis.Object;
const DrizzleNativeReflect = globalThis.Reflect;
const drizzleDefineProperty = DrizzleNativeObject.defineProperty;
const drizzleGetOwnPropertyDescriptor = DrizzleNativeObject.getOwnPropertyDescriptor;
const drizzleNumberIsSafeInteger = DrizzleNativeNumber.isSafeInteger;
const drizzleReflectApply = DrizzleNativeReflect.apply;

function drizzleApply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return drizzleReflectApply(fn, receiver, args) as Return;
}

function captureDrizzleSqlMethod(property: 'identifier' | 'join' | 'raw'): Function | undefined {
  const descriptor = drizzleApply<PropertyDescriptor | undefined>(
    drizzleGetOwnPropertyDescriptor,
    DrizzleNativeObject,
    [drizzleSql, property],
  );
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'function'
    ? descriptor.value
    : undefined;
}

const drizzleIdentifier = captureDrizzleSqlMethod('identifier');
const drizzleJoin = captureDrizzleSqlMethod('join');
const drizzleRaw = captureDrizzleSqlMethod('raw');
if (drizzleRaw === undefined) {
  throw new TypeError('The installed Drizzle version does not expose sql.raw().');
}

function commitDrizzleArrayValue<Value>(target: Value[], value: Value): boolean {
  const length = drizzleApply<PropertyDescriptor | undefined>(
    drizzleGetOwnPropertyDescriptor,
    DrizzleNativeObject,
    [target, 'length'],
  );
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !drizzleApply(drizzleNumberIsSafeInteger, DrizzleNativeNumber, [length.value]) ||
    length.value < 0 ||
    length.value >= 1_000_000
  ) {
    return false;
  }
  const index = length.value;
  drizzleApply(drizzleDefineProperty, DrizzleNativeObject, [
    target,
    index,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = drizzleApply<PropertyDescriptor | undefined>(
    drizzleGetOwnPropertyDescriptor,
    DrizzleNativeObject,
    [target, index],
  );
  return committed !== undefined && 'value' in committed && committed.value === value;
}

const drizzleArrayControlsSound = (() => {
  try {
    const control: string[] = [];
    return commitDrizzleArrayValue(control, 'drizzle-control') && control[0] === 'drizzle-control';
  } catch {
    return false;
  }
})();

function drizzleArrayAppend<Value>(target: Value[], value: Value): void {
  if (!drizzleArrayControlsSound || !commitDrizzleArrayValue(target, value)) {
    throw new TypeError('Kovo Drizzle SQL collection own-data append failed.');
  }
}

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
  KovoOwnerViaAnnotation,
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
  KovoRuntimeAuthorizationClassification,
  KovoRuntimeDbColumnSource,
  KovoRuntimeDbMetadata,
  KovoRuntimeDbTable,
  KovoRuntimeOwnerSource,
  KovoRuntimeOwnerViaSource,
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
  const stringSnapshot = snapshotSqlConstructorArray(strings, 'sql template strings');
  const valueSnapshot = snapshotSqlConstructorArray(values, 'sql template values');
  const args: unknown[] = [stringSnapshot];
  for (let index = 0; index < valueSnapshot.length; index += 1) {
    drizzleArrayAppend(args, valueSnapshot[index]);
  }
  const statement = invokeSqlConstructor<SQL<T>>(drizzleSql, undefined, args);
  return stampParameterizedSql(statement, mergeSqlSafetyMetadata(valueSnapshot), {
    kind: 'template',
    strings: stringSnapshot,
    values: valueSnapshot,
  });
}) as unknown as SqlTag;

sql.raw = <T = unknown>(value: string) => {
  const raw = drizzleApply<SQL<T>>(drizzleRaw, drizzleSql, [value]);
  stampRawSqlChunk(raw, value);
  return stampStaticSql(raw, { containsRawChunk: true }, { kind: 'text', text: value });
};

sql.identifier = <T = unknown>(value: string, options: { allow?: readonly string[] } = {}) => {
  const allow = drizzleOwnDataOption(options, 'allow', 'sql.identifier allowlist') as
    | readonly string[]
    | undefined;
  const identifier = validateSqlIdentifier(value, allow);
  const statement =
    drizzleIdentifier === undefined
      ? drizzleApply<SQL<T>>(drizzleRaw, drizzleSql, [quoteSqlIdentifier(identifier)])
      : drizzleApply<SQL<T>>(drizzleIdentifier, drizzleSql, [identifier]);
  return stampSqlIdentifier(statement, quoteSqlIdentifier(identifier));
};

sql.allow = <T = unknown>(value: string, allow: readonly string[]) => {
  const fragment = validateSqlAllow(value, allow);
  return stampSqlKeyword(drizzleApply<SQL<T>>(drizzleRaw, drizzleSql, [fragment]), fragment);
};

sql.join = <T = unknown>(parts: readonly unknown[], separator?: unknown) => {
  const partSnapshot = snapshotSqlConstructorArray(parts, 'sql.join parts');
  const drizzleSeparator = separator ?? drizzleApply<SQL>(drizzleRaw, drizzleSql, [', ']);
  if (drizzleJoin === undefined) {
    throw new TypeError('The installed Drizzle version does not expose sql.join().');
  }
  const statement = invokeSqlConstructor<SQL<T>>(drizzleJoin, drizzleSql, [
    partSnapshot,
    drizzleSeparator,
  ]);
  const metadataInputs: unknown[] = [];
  for (let index = 0; index < partSnapshot.length; index += 1) {
    drizzleArrayAppend(metadataInputs, partSnapshot[index]);
  }
  drizzleArrayAppend(metadataInputs, drizzleSeparator);
  return stampParameterizedSql(statement, mergeSqlSafetyMetadata(metadataInputs), {
    kind: 'join',
    parts: partSnapshot,
    separator,
  });
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
  const text = joinStaticSqlStrings(
    snapshotSqlConstructorArray(strings, 'staticSql template strings'),
  );
  return stampStaticSql(
    drizzleApply<SQL<T>>(drizzleRaw, drizzleSql, [text]),
    {},
    { kind: 'text', text },
  );
}

/**
 * Audited raw-SQL escape hatch. This is the only Kovo brand that may execute a statement
 * containing `sql.raw(...)` chunks on managed DB handles.
 */
export function trustedSql<TResult = unknown, T extends SQL<TResult> = SQL<TResult>>(
  statement: T,
  options: { justification: string },
): T & KovoTrustedSql<TResult> {
  const justification = drizzleOwnDataOption(options, 'justification', 'trustedSql justification');
  if (typeof justification !== 'string') {
    throw new TypeError('trustedSql justification must be an own string data property.');
  }
  return stampTrustedSql(statement, justification);
}

function drizzleOwnDataOption(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = drizzleApply<PropertyDescriptor | undefined>(
    drizzleGetOwnPropertyDescriptor,
    DrizzleNativeObject,
    [value, property],
  );
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be an own data property.`);
  return descriptor.value;
}

function quoteSqlIdentifier(identifier: string): string {
  let quoted = '"';
  for (let index = 0; index < identifier.length; index += 1) {
    const character = identifier[index] ?? '';
    quoted += character === '.' ? '"."' : character;
  }
  return `${quoted}"`;
}
