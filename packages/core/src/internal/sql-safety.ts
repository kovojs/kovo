import { diagnosticDefinitions } from './diagnostics.js';
import { blessSink, isBlessedSink } from './sink-policy.js';

// SPEC §6.6/§744: brands are defense-in-depth, not the enforcement mechanism, so they MUST NOT be
// forgeable from outside the shared sink-policy witness substrate; only the `stamp*` helpers
// exported here can apply them. (The static AST analyzer of §11.1/§11.2 remains the
// by-construction proof; this runtime guard is the fail-closed floor of §10.2.)
type SqlBlessedSink =
  | 'parameterized-sql'
  | 'static-sql'
  | 'trusted-sql'
  | 'sql-identifier'
  | 'sql-keyword';

const rawSqlChunkBrand = Symbol('kovo.sql.raw-chunk');
const sqlSafetyMetadataBrand = Symbol('kovo.sql.metadata');
const managedSqlStatements = new WeakSet<object>();

/** @internal */
export type SqlSafetyMode = 'enforce';

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

/** @internal */
export interface SqlIdentifier {
  readonly __kovoSqlIdentifierBrand?: 'identifier';
}

/** @internal */
export interface SqlKeyword {
  readonly __kovoSqlKeywordBrand?: 'keyword';
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
  blessSql('parameterized-sql', value);
  stampSqlSafetyMetadata(value, metadata);
  return value as T & ParameterizedSql;
}

/** @internal */
export function stampStaticSql<T extends object>(
  value: T,
  metadata: SqlSafetyMetadata = {},
): T & StaticSqlText {
  blessSql('static-sql', value);
  stampSqlSafetyMetadata(value, metadata);
  return value as T & StaticSqlText;
}

/** @internal */
export function stampTrustedSql<T extends object>(value: T, justification: string): T & TrustedSql {
  blessSql('trusted-sql', value);
  stampSqlSafetyMetadata(value, { ...sqlSafetyMetadata(value), justification });
  return value as T & TrustedSql;
}

/** @internal Framework-owned SQL carrier reconstructed after a caller statement passed validation. */
export function frameworkTrustedSqlCarrier(
  value: { readonly text: string; readonly values: readonly unknown[] },
  justification: string,
): { readonly text: string; readonly values: readonly unknown[] } & TrustedSql {
  if (!justification.trim()) {
    throw new Error('frameworkTrustedSqlCarrier requires a non-empty justification.');
  }
  return Object.freeze(
    stampTrustedSql({ text: value.text, values: [...value.values] }, justification),
  );
}

/** @internal */
export function stampSqlIdentifier<T extends object>(value: T): T & StaticSqlText & SqlIdentifier {
  blessSql('sql-identifier', value);
  return stampStaticSql(value) as T & StaticSqlText & SqlIdentifier;
}

/** @internal */
export function stampSqlKeyword<T extends object>(value: T): T & StaticSqlText & SqlKeyword {
  blessSql('sql-keyword', value);
  return stampStaticSql(value) as T & StaticSqlText & SqlKeyword;
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
    typeof record.all === 'function',
    typeof record.get === 'function',
    typeof record.run === 'function',
    typeof record.values === 'function',
  ].some(Boolean);
}

/** @internal */
export interface SqlStatementValidationResult {
  message?: string;
  ok: boolean;
}

/** @internal */
export type ManagedSqlDialect = 'postgres' | 'sqlite' | undefined;

/** @internal */
export type ManagedSqlProvenance =
  | 'branded-query-chunks'
  | 'plain-separated-carrier'
  | 'trusted-separated-carrier';

/** @internal */
export interface ManagedSqlStatement {
  readonly dialect: ManagedSqlDialect;
  readonly provenance: ManagedSqlProvenance;
  readonly sql: string;
  readonly text: string;
  readonly values: readonly unknown[];
}

/** @internal */
export function validateManagedSqlStatement(statement: unknown): SqlStatementValidationResult {
  const snapshot = snapshotManagedSqlStatement(statement);
  if (snapshot.ok) return { ok: true };
  if (snapshot.message !== undefined) return unsafeSqlResult(snapshot.message);

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

  return unsafeSqlResult(
    'unbranded object-shaped SQL is not accepted on Kovo-managed DB handles; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), a separated { text, values } carrier, or trustedSql(...).',
  );
}

/** @internal */
export type ManagedSqlSnapshotResult =
  | { readonly ok: true; readonly statement: ManagedSqlStatement }
  | { readonly message?: string; readonly ok: false };

/** @internal */
export function snapshotManagedSqlStatement(
  statement: unknown,
  dialect?: ManagedSqlDialect,
): ManagedSqlSnapshotResult {
  if (isManagedSqlStatement(statement)) {
    const redialect =
      statement.dialect === dialect || dialect === undefined
        ? statement
        : Object.freeze({ ...statement, dialect });
    managedSqlStatements.add(redialect);
    return {
      ok: true,
      statement: redialect,
    };
  }
  if (typeof statement !== 'object' || statement === null) return { ok: false };
  const unsafeSurface = unsafeSqlCarrierSurface(statement);
  if (unsafeSurface !== undefined) {
    return {
      message: `${unsafeSurface} SQL carriers are not accepted on Kovo-managed DB handles; the framework reconstructs the DB driver carrier from validated { text, values } only (SPEC §10.3).`,
      ok: false,
    };
  }

  const record = statement as Record<PropertyKey, unknown>;
  const textSnapshot = snapshotSqlText(record);
  const parameterSnapshot = snapshotSqlParameters(record);
  const queryChunks = dataPropertyValue(record, 'queryChunks');

  if (isTrustedSql(statement) || isParameterizedSql(statement) || isStaticSql(statement)) {
    if (!isTrustedSql(statement) && sqlSafetyMetadata(statement).containsRawChunk) {
      return {
        message: 'sql.raw(...) chunks require trustedSql(..., { justification }).',
        ok: false,
      };
    }
    if (textSnapshot.ok) {
      return managedSqlSnapshot(
        textSnapshot.value,
        parameterSnapshot.ok ? parameterSnapshot.value : [],
        dialect,
        {
          allowEmptyValues: true,
          provenance: 'trusted-separated-carrier',
        },
      );
    }
    if (Array.isArray(queryChunks)) {
      const values = parameterSnapshot.ok ? parameterSnapshot.value : [];
      return managedSqlSnapshot(sqlFromQueryChunks(queryChunks), values, dialect, {
        allowEmptyValues: true,
        provenance: 'branded-query-chunks',
      });
    }
    return { ok: false };
  }

  if (!textSnapshot.ok || !parameterSnapshot.ok) {
    return !textSnapshot.ok && textSnapshot.message !== undefined
      ? { message: textSnapshot.message, ok: false }
      : !parameterSnapshot.ok && parameterSnapshot.message !== undefined
        ? { message: parameterSnapshot.message, ok: false }
        : { ok: false };
  }

  return managedSqlSnapshot(textSnapshot.value, parameterSnapshot.value, dialect, {
    allowEmptyValues: false,
    provenance: 'plain-separated-carrier',
  });
}

/** @internal */
export function isManagedSqlStatement(value: unknown): value is ManagedSqlStatement {
  return typeof value === 'object' && value !== null && managedSqlStatements.has(value);
}

function unsafeSqlResult(message: string): SqlStatementValidationResult {
  return {
    ok: false,
    message: `KV422: ${diagnosticDefinitions.KV422.message} ${message}`,
  };
}

function isParameterizedSql(value: object): boolean {
  return isSqlBlessed('parameterized-sql', value);
}

function isStaticSql(value: object): boolean {
  return isSqlBlessed('static-sql', value);
}

function isTrustedSql(value: object): boolean {
  return isSqlBlessed('trusted-sql', value);
}

function isSeparatedSqlCarrier(value: object): boolean {
  return snapshotManagedSqlStatement(value).ok;
}

// True when the object exposes a `.text`/`.sql` *string* (assembled SQL text). Callers reach this
// only after `isSeparatedSqlCarrier` rejected the value, so a `true` here means the text is present
// without a separated parameter array — the unsafe shape KV422 must catch. Drizzle's native SQL
// objects expose `.sql` as a method/getter and carry no `.text` string, so they do not trip this.
function carriesUnseparatedSqlText(value: object): boolean {
  const record = value as Record<PropertyKey, unknown>;
  return (
    typeof dataPropertyValue(record, 'text') === 'string' ||
    typeof dataPropertyValue(record, 'sql') === 'string'
  );
}

function snapshotSqlText(
  record: Record<PropertyKey, unknown>,
): { ok: true; value: string } | { message?: string; ok: false } {
  return (
    snapshotNamedSqlText(record, 'text') ?? snapshotNamedSqlText(record, 'sql') ?? { ok: false }
  );
}

function snapshotNamedSqlText(
  record: Record<PropertyKey, unknown>,
  property: 'sql' | 'text',
): { ok: true; value: string } | { message: string; ok: false } | undefined {
  const value = dataPropertyValue(record, property);
  if (value === ACCESSOR_OR_PROXY_PROPERTY) {
    return {
      ok: false,
      message: `separated SQL carriers with accessor/proxy .${property} properties are not accepted; pass a plain data property so the framework can snapshot statement identity before validation.`,
    };
  }
  if (value === undefined) return undefined;
  return typeof value === 'string'
    ? { ok: true, value }
    : {
        ok: false,
        message: `separated SQL carrier .${property} must be a string data property.`,
      };
}

function snapshotSqlParameters(
  record: Record<PropertyKey, unknown>,
): { ok: true; value: readonly unknown[] } | { message?: string; ok: false } {
  return (
    snapshotNamedSqlParameters(record, 'values') ??
    snapshotNamedSqlParameters(record, 'params') ??
    snapshotNamedSqlParameters(record, 'args') ?? { ok: false }
  );
}

function snapshotNamedSqlParameters(
  record: Record<PropertyKey, unknown>,
  property: 'args' | 'params' | 'values',
): { ok: true; value: readonly unknown[] } | { message: string; ok: false } | undefined {
  const value = dataPropertyValue(record, property);
  if (value === ACCESSOR_OR_PROXY_PROPERTY) {
    return {
      ok: false,
      message: `separated SQL carriers with accessor/proxy .${property} properties are not accepted; pass a plain data array so the framework can snapshot statement identity before validation.`,
    };
  }
  if (value === undefined) return undefined;
  return Array.isArray(value)
    ? { ok: true, value: Object.freeze([...value]) }
    : {
        ok: false,
        message: `separated SQL carrier .${property} must be an array data property.`,
      };
}

const ACCESSOR_OR_PROXY_PROPERTY = Symbol('kovo.sql.accessor-or-proxy-property');

function unsafeSqlCarrierSurface(value: object): 'submit-bearing' | 'thenable' | undefined {
  if (hasCallableOrAccessor(value, 'submit')) return 'submit-bearing';
  if (hasCallableOrAccessor(value, 'then')) return 'thenable';
  return undefined;
}

function hasCallableOrAccessor(value: object, property: 'submit' | 'then'): boolean {
  if (!(property in value)) return false;
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) return true;
      return typeof descriptor.value === 'function';
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function dataPropertyValue(
  record: Record<PropertyKey, unknown>,
  property: 'args' | 'params' | 'queryChunks' | 'sql' | 'text' | 'values',
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) return ACCESSOR_OR_PROXY_PROPERTY;
  return descriptor.value;
}

function managedSqlSnapshot(
  text: string,
  values: readonly unknown[],
  dialect: ManagedSqlDialect,
  options: { allowEmptyValues: boolean; provenance: ManagedSqlProvenance },
): ManagedSqlSnapshotResult {
  if (!options.allowEmptyValues && values.length === 0) return { ok: false };
  if (!options.allowEmptyValues && !hasSqlBindMarker(text)) return { ok: false };
  const statement = Object.freeze({
    dialect,
    provenance: options.provenance,
    sql: text,
    text,
    values: Object.freeze([...values]),
  });
  managedSqlStatements.add(statement);
  return {
    ok: true,
    statement,
  };
}

function sqlFromQueryChunks(chunks: readonly unknown[]): string {
  let sql = '';
  let parameterIndex = 0;
  const nextParameter = () => `$${++parameterIndex}`;

  for (const chunk of chunks) {
    sql += sqlFromQueryChunk(chunk, nextParameter);
  }

  return sql;
}

function sqlFromQueryChunk(chunk: unknown, nextParameter: () => string): string {
  if (typeof chunk === 'string' || typeof chunk === 'number' || typeof chunk === 'boolean') {
    return nextParameter();
  }
  if (typeof chunk !== 'object' || chunk === null) return nextParameter();

  const record = chunk as Record<PropertyKey, unknown>;
  const chunkValue = Object.getOwnPropertyDescriptor(record, 'value')?.value;
  if (Array.isArray(chunkValue) && chunkValue.every((item) => typeof item === 'string')) {
    return chunkValue.join('');
  }
  if (typeof chunkValue === 'string' && Object.prototype.hasOwnProperty.call(record, 'brand')) {
    return chunkValue;
  }

  const nested = dataPropertyValue(record, 'queryChunks');
  if (Array.isArray(nested)) {
    return nested.map((item) => sqlFromQueryChunk(item, nextParameter)).join('');
  }

  return nextParameter();
}

function hasSqlBindMarker(sqlText: string): boolean {
  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const next = sqlText[index + 1];

    if (char === "'") {
      index = skipSqlSingleQuotedString(sqlText, index);
      continue;
    }
    if (char === '"') {
      index = skipSqlDoubleQuotedIdentifier(sqlText, index);
      continue;
    }
    if (char === '-' && next === '-') {
      index = skipSqlLineComment(sqlText, index);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipSqlBlockComment(sqlText, index);
      continue;
    }

    if (char === '?') return true;
    if (char === '$' && isSqlParameterNameStart(next)) return true;
    if (
      (char === ':' || char === '@') &&
      isSqlParameterNameStart(next) &&
      sqlText[index - 1] !== ':'
    ) {
      return true;
    }
  }

  return false;
}

function skipSqlSingleQuotedString(sqlText: string, start: number): number {
  for (let index = start + 1; index < sqlText.length; index += 1) {
    if (sqlText[index] !== "'") continue;
    if (sqlText[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index;
  }
  return sqlText.length;
}

function skipSqlDoubleQuotedIdentifier(sqlText: string, start: number): number {
  for (let index = start + 1; index < sqlText.length; index += 1) {
    if (sqlText[index] !== '"') continue;
    if (sqlText[index + 1] === '"') {
      index += 1;
      continue;
    }
    return index;
  }
  return sqlText.length;
}

function skipSqlLineComment(sqlText: string, start: number): number {
  const newline = sqlText.indexOf('\n', start + 2);
  return newline === -1 ? sqlText.length : newline;
}

function skipSqlBlockComment(sqlText: string, start: number): number {
  const end = sqlText.indexOf('*/', start + 2);
  return end === -1 ? sqlText.length : end + 1;
}

function isSqlParameterNameStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function stampSqlSafetyMetadata(value: object, metadata: SqlSafetyMetadata): void {
  stamp(value, sqlSafetyMetadataBrand, { ...sqlSafetyMetadata(value), ...metadata });
}

function blessSql(sink: SqlBlessedSink, value: object): void {
  blessSink(sink, value);
}

function isSqlBlessed(sink: SqlBlessedSink, value: object): boolean {
  return isBlessedSink(sink, value);
}

function stamp(value: object, key: symbol, propertyValue: unknown): void {
  Object.defineProperty(value, key, {
    configurable: true,
    enumerable: false,
    value: propertyValue,
  });
}
