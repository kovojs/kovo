import { diagnosticDefinitions } from './diagnostics.js';

// SPEC §6.6/§744: brands are defense-in-depth, not the enforcement mechanism, so they MUST NOT be
// forgeable from outside this module. Module-private `Symbol()` instances cannot be reconstructed
// via `Symbol.for('kovo.sql.*')` from app or attacker code; only the `stamp*` helpers exported here
// can apply them. (The static AST analyzer of §11.1/§11.2 remains the by-construction proof; this
// runtime guard is the fail-closed floor of §10.2.)
const parameterizedSqlBrand = Symbol('kovo.sql.parameterized');
const staticSqlBrand = Symbol('kovo.sql.static');
const trustedSqlBrand = Symbol('kovo.sql.trusted');
const rawSqlChunkBrand = Symbol('kovo.sql.raw-chunk');
const sqlSafetyMetadataBrand = Symbol('kovo.sql.metadata');

/** @internal */
export type SqlSafetyMode = 'enforce' | 'off' | 'warn';

/** @internal */
export interface ParameterizedSql {
  readonly __kovoSqlBrand?: 'parameterized';
}

/** @internal */
export interface StaticSqlText {
  readonly __kovoSqlBrand?: 'static';
}

/** @internal */
export interface TrustedSql {
  readonly __kovoSqlBrand?: 'trusted';
}

interface SqlSafetyMetadata {
  containsRawChunk?: boolean;
  justification?: string;
}

/** @internal */
export function stampParameterizedSql<T extends object>(
  value: T,
  metadata: SqlSafetyMetadata = {},
): T & ParameterizedSql {
  stamp(value, parameterizedSqlBrand, true);
  stampSqlSafetyMetadata(value, metadata);
  return value as T & ParameterizedSql;
}

/** @internal */
export function stampStaticSql<T extends object>(
  value: T,
  metadata: SqlSafetyMetadata = {},
): T & StaticSqlText {
  stamp(value, staticSqlBrand, true);
  stampSqlSafetyMetadata(value, metadata);
  return value as T & StaticSqlText;
}

/** @internal */
export function stampTrustedSql<T extends object>(value: T, justification: string): T & TrustedSql {
  stamp(value, trustedSqlBrand, true);
  stampSqlSafetyMetadata(value, { ...sqlSafetyMetadata(value), justification });
  return value as T & TrustedSql;
}

/** @internal */
export function stampRawSqlChunk<T extends object>(value: T): T {
  stamp(value, rawSqlChunkBrand, true);
  stampSqlSafetyMetadata(value, { ...sqlSafetyMetadata(value), containsRawChunk: true });
  return value;
}

/** @internal */
export function sqlSafetyMetadata(value: unknown): SqlSafetyMetadata {
  if (typeof value !== 'object' || value === null) return {};
  const metadata = (value as Record<PropertyKey, unknown>)[sqlSafetyMetadataBrand];
  return typeof metadata === 'object' && metadata !== null ? (metadata as SqlSafetyMetadata) : {};
}

/** @internal */
export function mergeSqlSafetyMetadata(values: readonly unknown[]): SqlSafetyMetadata {
  return values.reduce<SqlSafetyMetadata>((merged, value) => {
    const metadata = sqlSafetyMetadata(value);
    return {
      ...merged,
      ...(metadata.containsRawChunk ? { containsRawChunk: true } : {}),
      ...(metadata.justification === undefined ? {} : { justification: metadata.justification }),
    };
  }, {});
}

/** @internal */
export function validateSqlIdentifier(identifier: string, allow?: readonly string[]): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$.]{0,127}$/.test(identifier)) {
    throw new Error(
      `KV422: ${diagnosticDefinitions.KV422.message} Invalid SQL identifier ${JSON.stringify(identifier)}.`,
    );
  }
  if (allow && !allow.includes(identifier)) {
    throw new Error(
      `KV422: ${diagnosticDefinitions.KV422.message} SQL identifier ${JSON.stringify(identifier)} is outside the declared allowlist.`,
    );
  }
  return identifier;
}

/** @internal */
export function validateSqlAllow(value: string, allow: readonly string[]): string {
  if (!allow.includes(value)) {
    throw new Error(
      `KV422: ${diagnosticDefinitions.KV422.message} SQL fragment ${JSON.stringify(value)} is outside the declared allowlist.`,
    );
  }
  return value;
}

/** @internal */
export function isSqlHandleProperty(prop: PropertyKey): boolean {
  return prop === 'pglite' || prop === 'sqlite' || prop === 'client' || prop === '$client';
}

/** @internal */
export function isPreparedStatementExecutionMethod(prop: PropertyKey): boolean {
  return prop === 'all' || prop === 'get' || prop === 'run' || prop === 'iterate';
}

/** @internal */
export function isDbAdapterLike(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<PropertyKey, unknown>;

  return (
    isSqlHandleLike(value) ||
    isSqlHandleLike(record.pglite) ||
    isSqlHandleLike(record.sqlite) ||
    isSqlHandleLike(record.client) ||
    isSqlHandleLike(record.$client) ||
    typeof record.read === 'function' ||
    typeof record.write === 'function' ||
    typeof record.sql === 'function' ||
    (typeof record.exec === 'function' && typeof record.query === 'function') ||
    typeof record.execute === 'function'
  );
}

/** @internal */
export function isSqlHandleLike(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<PropertyKey, unknown>;
  return [
    typeof record.prepare === 'function',
    typeof record.execute === 'function',
    typeof record.transaction === 'function',
    typeof record.exec === 'function',
    typeof record.query === 'function',
  ].some(Boolean);
}

/** @internal */
export interface SqlStatementValidationResult {
  message?: string;
  ok: boolean;
}

/** @internal */
export function validateManagedSqlStatement(statement: unknown): SqlStatementValidationResult {
  if (typeof statement === 'string') {
    return unsafeSqlResult(
      'raw string statements are not accepted on Kovo-managed DB handles; use sql`...`, staticSql`...`, or a separated { text, values } carrier.',
    );
  }

  if (typeof statement !== 'object' || statement === null) {
    return unsafeSqlResult('SQL statements must be branded SQL objects or separated carriers.');
  }

  if (isTrustedSql(statement)) return { ok: true };

  const metadata = sqlSafetyMetadata(statement);
  if (metadata.containsRawChunk) {
    return unsafeSqlResult('sql.raw(...) chunks require trustedSql(..., { justification }).');
  }

  if (isParameterizedSql(statement) || isStaticSql(statement)) return { ok: true };
  if (isSeparatedSqlCarrier(statement)) return { ok: true };

  // SPEC §10.2: an object that exposes assembled SQL *text* (a `.text`/`.sql` string) but keeps it
  // un-separated from bound parameters — no `values`/`params`/`args` array — and carries no Kovo
  // brand is the forgeable raw-string escape in carrier clothing (e.g. `{ text: "select ..." + x }`).
  // It would have been KV422 as a bare string; routing it through a `.text` field MUST NOT launder
  // it. `isSeparatedSqlCarrier` already cleared genuinely parameterized carriers above, so reaching
  // here with assembled text means the parameters are missing: reject fail-closed.
  if (carriesUnseparatedSqlText(statement)) {
    return unsafeSqlResult(
      'an object carrying assembled SQL text ({ text }/{ sql }) without a separated values/params/args array is not accepted; supply parameters, or use sql`...`, staticSql`...`, or trustedSql(...).',
    );
  }

  // Drizzle builders and native SQL objects are object-shaped and intentionally accepted at
  // runtime; static analysis owns provenance for Drizzle-native raw poisoning.
  return { ok: true };
}

function unsafeSqlResult(message: string): SqlStatementValidationResult {
  return {
    ok: false,
    message: `KV422: ${diagnosticDefinitions.KV422.message} ${message}`,
  };
}

function isParameterizedSql(value: object): boolean {
  return (value as Record<PropertyKey, unknown>)[parameterizedSqlBrand] === true;
}

function isStaticSql(value: object): boolean {
  return (value as Record<PropertyKey, unknown>)[staticSqlBrand] === true;
}

function isTrustedSql(value: object): boolean {
  return (value as Record<PropertyKey, unknown>)[trustedSqlBrand] === true;
}

function isSeparatedSqlCarrier(value: object): boolean {
  const record = value as Record<PropertyKey, unknown>;
  const hasText = typeof record.text === 'string';
  const hasSql = typeof record.sql === 'string';
  if (!hasText && !hasSql) return false;

  return Array.isArray(record.values) || Array.isArray(record.params) || Array.isArray(record.args);
}

// True when the object exposes a `.text`/`.sql` *string* (assembled SQL text). Callers reach this
// only after `isSeparatedSqlCarrier` rejected the value, so a `true` here means the text is present
// without a separated parameter array — the unsafe shape KV422 must catch. Drizzle's native SQL
// objects expose `.sql` as a method/getter and carry no `.text` string, so they do not trip this.
function carriesUnseparatedSqlText(value: object): boolean {
  const record = value as Record<PropertyKey, unknown>;
  return typeof record.text === 'string' || typeof record.sql === 'string';
}

function stampSqlSafetyMetadata(value: object, metadata: SqlSafetyMetadata): void {
  stamp(value, sqlSafetyMetadataBrand, metadata);
}

function stamp(value: object, key: symbol, propertyValue: unknown): void {
  Object.defineProperty(value, key, {
    configurable: true,
    enumerable: false,
    value: propertyValue,
  });
}
