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
const sqlSafetyMetadataByValue = new WeakMap<object, Readonly<SqlSafetyMetadata>>();
const pinnedSqlCarriers = new WeakMap<object, PinnedSqlCarrier>();

type PinnedSqlChunk =
  | Readonly<{ kind: 'parameter'; value: unknown }>
  | Readonly<{ kind: 'text'; value: string }>;

type PinnedSqlCarrier =
  | Readonly<{
      chunks: readonly PinnedSqlChunk[];
      kind: 'recipe';
    }>
  | Readonly<{
      kind: 'fixed';
      text: string;
      values: readonly unknown[];
    }>;

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

/** Construction facts consumed once while minting a parameterized SQL witness. */
type ParameterizedSqlConstruction =
  | Readonly<{
      kind: 'join';
      parts: readonly unknown[];
      separator?: unknown;
    }>
  | Readonly<{
      kind: 'template';
      strings: readonly string[];
      values: readonly unknown[];
    }>;

/** Construction facts consumed once while minting a static SQL witness. */
type StaticSqlConstruction = Readonly<{
  kind: 'text';
  text: string;
}>;

/** @internal */
export function stampParameterizedSql<T extends object>(
  value: T,
  metadata: SqlSafetyMetadata = {},
  construction?: ParameterizedSqlConstruction,
): T & ParameterizedSql {
  blessSql('parameterized-sql', value);
  stampSqlSafetyMetadata(value, metadata);
  pinSqlCarrier(value, construction);
  return value as T & ParameterizedSql;
}

/** @internal */
export function stampStaticSql<T extends object>(
  value: T,
  metadata: SqlSafetyMetadata = {},
  construction?: StaticSqlConstruction,
): T & StaticSqlText {
  blessSql('static-sql', value);
  stampSqlSafetyMetadata(value, metadata);
  pinSqlCarrier(value, construction);
  return value as T & StaticSqlText;
}

/** @internal */
export function stampTrustedSql<T extends object>(value: T, justification: string): T & TrustedSql {
  blessSql('trusted-sql', value);
  stampSqlSafetyMetadata(value, { ...sqlSafetyMetadata(value), justification });
  pinSqlCarrier(value);
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
export function stampSqlIdentifier<T extends object>(
  value: T,
  text?: string,
): T & StaticSqlText & SqlIdentifier {
  blessSql('sql-identifier', value);
  return stampStaticSql(value, {}, text === undefined ? undefined : { kind: 'text', text }) as T &
    StaticSqlText &
    SqlIdentifier;
}

/** @internal */
export function stampSqlKeyword<T extends object>(
  value: T,
  text?: string,
): T & StaticSqlText & SqlKeyword {
  blessSql('sql-keyword', value);
  return stampStaticSql(value, {}, text === undefined ? undefined : { kind: 'text', text }) as T &
    StaticSqlText &
    SqlKeyword;
}

/** @internal */
export function stampRawSqlChunk<T extends object>(value: T, text?: string): T {
  stamp(value, rawSqlChunkBrand, true);
  stampSqlSafetyMetadata(value, { ...sqlSafetyMetadata(value), containsRawChunk: true });
  pinSqlCarrier(value, text === undefined ? undefined : { kind: 'text', text });
  return value;
}

/** @internal */
export function sqlSafetyMetadata(value: unknown): SqlSafetyMetadata {
  if (typeof value !== 'object' || value === null) return {};
  return sqlSafetyMetadataByValue.get(value) ?? {};
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
  | 'pinned-kovo-recipe'
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

  const metadata = sqlSafetyMetadata(statement);
  if (metadata.containsRawChunk) {
    return unsafeSqlResult('sql.raw(...) chunks require trustedSql(..., { justification }).');
  }
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

  const trusted = isTrustedSql(statement);
  if (trusted || isParameterizedSql(statement) || isStaticSql(statement)) {
    // SPEC §6.6/§10.3 C9/C15: the witness authenticates the immutable construction-time recipe,
    // never the later state of the mutable third-party Drizzle object. In particular, do not read
    // queryChunks/text/sql here: app code can replace those public properties without losing the
    // identity witness.
    if (!trusted && sqlSafetyMetadata(statement).containsRawChunk) {
      return {
        message: 'sql.raw(...) chunks require trustedSql(..., { justification }).',
        ok: false,
      };
    }
    const pinned = pinnedSqlCarriers.get(statement);
    if (pinned === undefined) {
      return {
        message:
          'branded SQL carrier has no immutable framework-owned construction recipe; rebuild it through @kovojs/drizzle sql/staticSql/trustedSql (SPEC §6.6/§10.3 C15).',
        ok: false,
      };
    }
    const rendered = renderPinnedSqlCarrier(pinned);
    return managedSqlSnapshot(rendered.text, rendered.values, dialect, {
      allowEmptyValues: true,
      provenance: pinned.kind === 'fixed' ? 'trusted-separated-carrier' : 'pinned-kovo-recipe',
    });
  }

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

function pinSqlCarrier(
  value: object,
  construction?: ParameterizedSqlConstruction | StaticSqlConstruction,
): void {
  // A witness pins exactly once. Later trustedSql(...) wrapping may add audited authority, but it
  // cannot reinterpret public properties that changed since the original Kovo constructor ran.
  if (pinnedSqlCarriers.has(value)) return;
  const pinned =
    construction === undefined
      ? pinnedSqlCarrierFromCurrentData(value)
      : construction.kind === 'text'
        ? pinnedSqlRecipe([{ kind: 'text', value: construction.text }])
        : construction.kind === 'template'
          ? pinnedSqlTemplate(construction.strings, construction.values)
          : pinnedSqlJoin(construction.parts, construction.separator);
  if (pinned !== undefined) pinnedSqlCarriers.set(value, pinned);
}

function pinnedSqlTemplate(
  strings: readonly string[],
  values: readonly unknown[],
): PinnedSqlCarrier | undefined {
  if (strings.length !== values.length + 1) return undefined;
  const chunks: PinnedSqlChunk[] = [];
  for (let index = 0; index < strings.length; index += 1) {
    chunks.push({ kind: 'text', value: strings[index] ?? '' });
    if (index < values.length && !appendPinnedSqlInterpolation(chunks, values[index])) {
      return undefined;
    }
  }
  return pinnedSqlRecipe(chunks);
}

function pinnedSqlJoin(
  parts: readonly unknown[],
  separator: unknown,
): PinnedSqlCarrier | undefined {
  const chunks: PinnedSqlChunk[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) {
      if (separator === undefined) {
        chunks.push({ kind: 'text', value: ', ' });
      } else if (!appendPinnedSqlInterpolation(chunks, separator)) {
        return undefined;
      }
    }
    if (!appendPinnedSqlInterpolation(chunks, parts[index])) return undefined;
  }
  return pinnedSqlRecipe(chunks);
}

function appendPinnedSqlInterpolation(chunks: PinnedSqlChunk[], value: unknown): boolean {
  if (typeof value === 'object' && value !== null) {
    const nested = pinnedSqlCarriers.get(value);
    if (nested?.kind === 'recipe') {
      chunks.push(...nested.chunks);
      return true;
    }
    // Kovo can pin its own recursively composed SQL values. An unpinned SQLWrapper remains useful
    // to Drizzle builders, but direct managed execution cannot reconstruct it without invoking or
    // rereading a mutable third-party object, so leave the outer carrier unpinned and fail closed.
    if (nested?.kind === 'fixed' || hasSqlWrapperSurface(value)) return false;
  }
  chunks.push({ kind: 'parameter', value });
  return true;
}

function pinnedSqlCarrierFromCurrentData(value: object): PinnedSqlCarrier | undefined {
  const record = value as Record<PropertyKey, unknown>;
  const text = snapshotSqlText(record);
  if (text.ok) {
    const parameters = snapshotSqlParameters(record);
    return Object.freeze({
      kind: 'fixed',
      text: text.value,
      values: Object.freeze(parameters.ok ? [...parameters.value] : []),
    });
  }

  const queryChunks = dataPropertyValue(record, 'queryChunks');
  if (!Array.isArray(queryChunks)) return undefined;
  const seen = new WeakSet<object>([value]);
  const chunks: PinnedSqlChunk[] = [];
  for (const chunk of queryChunks) {
    if (!appendPinnedQueryChunk(chunks, chunk, seen)) return undefined;
  }
  return pinnedSqlRecipe(chunks);
}

function appendPinnedQueryChunk(
  chunks: PinnedSqlChunk[],
  chunk: unknown,
  seen: WeakSet<object>,
): boolean {
  if (typeof chunk !== 'object' || chunk === null) {
    chunks.push({ kind: 'parameter', value: chunk });
    return true;
  }

  const pinned = pinnedSqlCarriers.get(chunk);
  if (pinned?.kind === 'recipe') {
    chunks.push(...pinned.chunks);
    return true;
  }
  if (pinned?.kind === 'fixed') return false;

  const record = chunk as Record<PropertyKey, unknown>;
  const chunkValue = Object.getOwnPropertyDescriptor(record, 'value')?.value;
  if (Array.isArray(chunkValue) && chunkValue.every((item) => typeof item === 'string')) {
    chunks.push({ kind: 'text', value: chunkValue.join('') });
    return true;
  }
  if (typeof chunkValue === 'string' && Object.prototype.hasOwnProperty.call(record, 'brand')) {
    chunks.push({ kind: 'text', value: chunkValue });
    return true;
  }

  const nested = dataPropertyValue(record, 'queryChunks');
  if (Array.isArray(nested)) {
    if (seen.has(chunk)) return false;
    seen.add(chunk);
    for (const item of nested) {
      if (!appendPinnedQueryChunk(chunks, item, seen)) return false;
    }
    return true;
  }

  if (hasSqlWrapperSurface(chunk)) return false;
  chunks.push({ kind: 'parameter', value: chunk });
  return true;
}

function pinnedSqlRecipe(chunks: readonly PinnedSqlChunk[]): PinnedSqlCarrier {
  return Object.freeze({
    chunks: Object.freeze(
      chunks.map((chunk) =>
        Object.freeze(
          chunk.kind === 'text'
            ? { kind: 'text' as const, value: chunk.value }
            : { kind: 'parameter' as const, value: chunk.value },
        ),
      ),
    ),
    kind: 'recipe',
  });
}

function renderPinnedSqlCarrier(pinned: PinnedSqlCarrier): {
  readonly text: string;
  readonly values: readonly unknown[];
} {
  if (pinned.kind === 'fixed') return { text: pinned.text, values: pinned.values };
  let text = '';
  const values: unknown[] = [];
  for (const chunk of pinned.chunks) {
    if (chunk.kind === 'text') {
      text += chunk.value;
    } else {
      values.push(chunk.value);
      text += `$${values.length}`;
    }
  }
  return { text, values };
}

function hasSqlWrapperSurface(value: object): boolean {
  try {
    let current: object | null = value;
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, 'getSQL');
      if (descriptor !== undefined) {
        return !('value' in descriptor) || typeof descriptor.value === 'function';
      }
      current = Object.getPrototypeOf(current) as object | null;
      if (current === Object.prototype) break;
    }
    return false;
  } catch {
    return true;
  }
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
  const pinned = Object.freeze({ ...sqlSafetyMetadata(value), ...metadata });
  sqlSafetyMetadataByValue.set(value, pinned);
  stamp(value, sqlSafetyMetadataBrand, pinned);
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
