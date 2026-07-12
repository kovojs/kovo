import { createRequire } from 'node:module';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import type {
  DeleteStatement,
  InsertStatement,
  QName,
  Statement,
  TruncateTableStatement,
  UpdateStatement,
  WithRecursiveStatement,
  WithStatement,
  WithStatementBinding,
} from 'pgsql-ast-parser';
import {
  createWitnessSet,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessGetOwnPropertyDescriptors,
  witnessIsArray,
  witnessObjectKeys,
  witnessOwnKeys,
  witnessSetAdd,
  witnessSetForEach,
  witnessSetHas,
  witnessWeakSetAdd,
  witnessWeakSetHas,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

const nativeArraySort = Array.prototype.sort;

const require = createRequire(import.meta.url);
let pgsqlAstParser: typeof import('pgsql-ast-parser') | undefined;

function sqlParser(): typeof import('pgsql-ast-parser') {
  pgsqlAstParser ??= require('pgsql-ast-parser') as typeof import('pgsql-ast-parser');
  return pgsqlAstParser;
}

/** Runtime SQL parser configuration for production write-table enforcement. */
export interface ParseSqlWriteTablesOptions {
  dialect?: 'postgres' | 'sqlite' | undefined;
}

export const UNTABLED_SQL_WRITE: unique symbol = Symbol('kovo:untabled-sql-write');
export type ParsedSqlWriteTarget = string | typeof UNTABLED_SQL_WRITE;
export type SqlWriteTargets = readonly ParsedSqlWriteTarget[];
export type SqlClassifierVerdict<UnsafeDetail = never> =
  | { readonly kind: 'proven-safe' }
  | { readonly detail: UnsafeDetail; readonly kind: 'proven-unsafe' }
  | { readonly kind: 'unproven'; readonly reason: string };

/** Parse a SQL statement into the physical tables it mutates (SPEC §10.3/§11.2). */
export const parseSqlWriteTables = securityClassifier(
  'server.sql.parse-write-tables',
  function (statement: string, options: ParseSqlWriteTablesOptions = {}): ParsedSqlWriteTarget[] {
    const verdict = classifyStatement(statement, options);
    if (verdict.kind === 'proven-safe') return [];
    if (verdict.kind === 'unproven') return [UNTABLED_SQL_WRITE];
    const targets: ParsedSqlWriteTarget[] = [];
    for (let index = 0; index < verdict.detail.length; index += 1) {
      appendSqlClassifierValue(targets, verdict.detail[index]!);
    }
    return targets;
  },
);

/**
 * Classify executable SQL as a proven read, proven write, or unproven statement
 * (SPEC §10.2/§10.3/§11.2). SELECT/VALUES/SHOW/WITH are reads only when every
 * function call is in the reviewed pure-function allowlist.
 */
export const classifyStatement = securityClassifier(
  'server.sql.classify-statement',
  function (
    statement: string,
    options: ParseSqlWriteTablesOptions = {},
  ): SqlClassifierVerdict<SqlWriteTargets> {
    const lexicalWrite = unparsedSqliteWriteStatement(statement);
    if (lexicalWrite) {
      return {
        kind: 'unproven',
        reason: 'sqlite statement kind cannot be structurally table-proven',
      };
    }

    const sql = options.dialect === 'sqlite' ? normalizeSqlitePlaceholders(statement) : statement;
    let parsedStatements: Statement[];
    try {
      parsedStatements = sqlParser().parse(sql);
    } catch (error) {
      return {
        kind: 'unproven',
        reason: `SQL parser could not prove statement safety: ${formatErrorMessage(error)}`,
      };
    }

    const verdicts: SqlClassifierVerdict<SqlWriteTargets>[] = [];
    for (let index = 0; index < parsedStatements.length; index += 1) {
      appendSqlClassifierValue(
        verdicts,
        classifyParsedStatement(parsedStatements[index]!, createWitnessSet(), options.dialect),
      );
    }
    return combineStatementVerdicts(verdicts);
  },
);

function normalizeSqlitePlaceholders(statement: string): string {
  let normalized = '';
  let parameterIndex = 0;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    const next = statement[index + 1];

    if (char === "'") {
      const [value, end] = readQuoted(statement, index, "'");
      normalized += value;
      index = end;
      continue;
    }

    if (char === '"') {
      const [value, end] = readQuoted(statement, index, '"');
      normalized += value;
      index = end;
      continue;
    }

    if (char === '-' && next === '-') {
      const end = intrinsicStringIndexOf(statement, '\n', index + 2);
      if (end === -1) return normalized + intrinsicStringSlice(statement, index);
      normalized += intrinsicStringSlice(statement, index, end + 1);
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = intrinsicStringIndexOf(statement, '*/', index + 2);
      if (end === -1) return normalized + intrinsicStringSlice(statement, index);
      normalized += intrinsicStringSlice(statement, index, end + 2);
      index = end + 1;
      continue;
    }

    if (char === '?') {
      let digitEnd = index + 1;
      while (isAsciiDigit(statement[digitEnd] ?? '')) digitEnd += 1;
      const explicitIndex = intrinsicStringSlice(statement, index + 1, digitEnd);
      parameterIndex =
        explicitIndex === '' ? parameterIndex + 1 : parseUnsignedDecimal(explicitIndex);
      normalized += `$${parameterIndex}`;
      index = digitEnd - 1;
      continue;
    }

    normalized += char;
  }

  return normalized;
}

function readQuoted(
  statement: string,
  start: number,
  quote: "'" | '"',
): [value: string, end: number] {
  let index = start + 1;
  while (index < statement.length) {
    if (statement[index] === quote) {
      if (statement[index + 1] === quote) {
        index += 2;
        continue;
      }
      return [intrinsicStringSlice(statement, start, index + 1), index];
    }
    index += 1;
  }
  return [intrinsicStringSlice(statement, start), statement.length - 1];
}

const classifyParsedStatement = securityClassifier(
  'server.sql.classify-write-statement',
  function (
    statement: Statement | WithStatementBinding,
    cteAliases: ReadonlySet<string>,
    dialect: ParseSqlWriteTablesOptions['dialect'],
  ): SqlClassifierVerdict<SqlWriteTargets> {
    switch (statement.type) {
      case 'insert':
        return writeVerdict(
          statement,
          writeTablesForInsert(statement, cteAliases, dialect),
          dialect,
        );
      case 'update':
        return writeVerdict(
          statement,
          writeTablesForUpdate(statement, cteAliases, dialect),
          dialect,
        );
      case 'delete':
        return writeVerdict(
          statement,
          writeTablesForDelete(statement, cteAliases, dialect),
          dialect,
        );
      case 'truncate table':
        return writeVerdict(statement, writeTablesForTruncate(statement), dialect);
      case 'with':
        return classifyWith(statement, cteAliases, dialect);
      case 'with recursive':
        return classifyWithRecursive(statement, cteAliases, dialect);
      case 'select':
      case 'show':
      case 'union':
      case 'union all':
      case 'values':
        return classifyReadStatement(statement, dialect);
      case 'alter enum':
      case 'alter index':
      case 'alter sequence':
      case 'alter table':
      case 'begin':
      case 'comment':
      case 'commit':
      case 'create composite type':
      case 'create enum':
      case 'create extension':
      case 'create function':
      case 'create index':
      case 'create materialized view':
      case 'create schema':
      case 'create sequence':
      case 'create table':
      case 'create view':
      case 'deallocate':
      case 'do':
      case 'drop function':
      case 'drop index':
      case 'drop sequence':
      case 'drop table':
      case 'drop trigger':
      case 'drop type':
      case 'prepare':
      case 'raise':
      case 'refresh materialized view':
      case 'rollback':
      case 'set':
      case 'set names':
      case 'set timezone':
      case 'start transaction':
      case 'tablespace':
        return {
          kind: 'unproven',
          reason: `${statement.type} has no provable raw-SQL table allowlist target`,
        };
      default:
        statement satisfies never;
        return {
          kind: 'unproven',
          reason: 'unknown SQL statement kind',
        };
    }
  },
);

function writeVerdict(
  statement: Statement | WithStatementBinding,
  targets: ParsedSqlWriteTarget[],
  dialect: ParseSqlWriteTablesOptions['dialect'],
): SqlClassifierVerdict<SqlWriteTargets> {
  const unprovenCalls = unprovenSqlFunctionCalls(statement, dialect);
  if (unprovenCalls.length > 0) {
    return {
      kind: 'unproven',
      reason: `SQL write contains non-allowlisted function call(s): ${unprovenCalls.join(', ')}`,
    };
  }

  let containsUntabledWrite = false;
  for (let index = 0; index < targets.length; index += 1) {
    if (targets[index] === UNTABLED_SQL_WRITE) containsUntabledWrite = true;
  }
  if (targets.length === 0 || containsUntabledWrite) {
    return {
      kind: 'unproven',
      reason: 'write statement did not expose a resolvable table target',
    };
  }
  return { kind: 'proven-unsafe', detail: uniqueSortedSqlTargets(targets) };
}

function classifyReadStatement(
  statement: Statement | WithStatementBinding,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): SqlClassifierVerdict<SqlWriteTargets> {
  const unprovenCalls = unprovenSqlFunctionCalls(statement, dialect);
  if (unprovenCalls.length > 0) {
    return {
      kind: 'unproven',
      reason: `SQL read contains non-allowlisted function call(s): ${unprovenCalls.join(', ')}`,
    };
  }
  return { kind: 'proven-safe' };
}

function writeTablesForInsert(
  statement: InsertStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): ParsedSqlWriteTarget[] {
  return directAndNestedWriteTables(
    tableName(statement.into),
    [statement.insert, statement.onConflict, statement.returning],
    cteAliases,
    dialect,
  );
}

function writeTablesForUpdate(
  statement: UpdateStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): ParsedSqlWriteTarget[] {
  return directAndNestedWriteTables(
    tableName(statement.table),
    [statement.from, statement.sets, statement.where, statement.returning],
    cteAliases,
    dialect,
  );
}

function writeTablesForDelete(
  statement: DeleteStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): ParsedSqlWriteTarget[] {
  return directAndNestedWriteTables(
    tableName(statement.from),
    [statement.where, statement.returning],
    cteAliases,
    dialect,
  );
}

function directAndNestedWriteTables(
  direct: ParsedSqlWriteTarget,
  values: readonly unknown[],
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): ParsedSqlWriteTarget[] {
  const targets: ParsedSqlWriteTarget[] = [];
  appendSqlClassifierValue(targets, direct);
  const nested = writeTablesForNestedStatements(values, cteAliases, dialect);
  for (let index = 0; index < nested.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(nested, index);
    appendSqlClassifierValue(
      targets,
      descriptor === undefined || !('value' in descriptor) ? UNTABLED_SQL_WRITE : descriptor.value,
    );
  }
  return targets;
}

function writeTablesForTruncate(statement: TruncateTableStatement): ParsedSqlWriteTarget[] {
  const targets: ParsedSqlWriteTarget[] = [];
  for (let index = 0; index < statement.tables.length; index += 1) {
    appendSqlClassifierValue(targets, tableName(statement.tables[index]!));
  }
  return targets;
}

function writeTablesForWith(
  statement: WithStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): SqlClassifierVerdict<SqlWriteTargets> {
  let aliases = cteAliases;
  const verdicts: SqlClassifierVerdict<SqlWriteTargets>[] = [];

  for (let index = 0; index < statement.bind.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(statement.bind, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      appendSqlClassifierValue(verdicts, {
        kind: 'unproven',
        reason: 'WITH binding list is not a dense own-data carrier',
      });
      continue;
    }
    const binding = descriptor.value;
    appendSqlClassifierValue(
      verdicts,
      classifyParsedStatement(binding.statement, aliases, dialect),
    );
    aliases = withAliases(aliases, [binding.alias.name]);
  }

  appendSqlClassifierValue(verdicts, classifyParsedStatement(statement.in, aliases, dialect));
  return combineStatementVerdicts(verdicts);
}

function classifyWith(
  statement: WithStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): SqlClassifierVerdict<SqlWriteTargets> {
  return writeTablesForWith(statement, cteAliases, dialect);
}

function classifyWithRecursive(
  statement: WithRecursiveStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): SqlClassifierVerdict<SqlWriteTargets> {
  const aliases = withAliases(cteAliases, [statement.alias.name]);
  const bindVerdict = classifyParsedStatement(statement.bind, aliases, dialect);
  const inVerdict = classifyParsedStatement(statement.in, aliases, dialect);
  return combineStatementVerdicts([bindVerdict, inVerdict]);
}

function withAliases(
  currentAliases: ReadonlySet<string>,
  addedAliases: readonly string[],
): ReadonlySet<string> {
  const aliases = createWitnessSet<string>();
  witnessSetForEach(currentAliases as Set<string>, (alias) => witnessSetAdd(aliases, alias));
  for (let index = 0; index < addedAliases.length; index += 1) {
    witnessSetAdd(aliases, addedAliases[index]!);
  }
  return aliases;
}

function writeTablesForNestedStatements(
  values: readonly unknown[],
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): ParsedSqlWriteTarget[] {
  const targets: ParsedSqlWriteTarget[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const nested = writeTablesForNestedStatement(values[index], cteAliases, dialect);
    for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
      appendSqlClassifierValue(targets, nested[nestedIndex]!);
    }
  }
  return targets;
}

function writeTablesForNestedStatement(
  value: unknown,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): ParsedSqlWriteTarget[] {
  if (witnessIsArray(value)) {
    const targets: ParsedSqlWriteTarget[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        appendSqlClassifierValue(targets, UNTABLED_SQL_WRITE);
        continue;
      }
      const nested = writeTablesForNestedStatement(descriptor.value, cteAliases, dialect);
      for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
        appendSqlClassifierValue(targets, nested[nestedIndex]!);
      }
    }
    return targets;
  }
  if (!value || typeof value !== 'object') return [];

  if (isStatement(value)) {
    const verdict = classifyParsedStatement(value, cteAliases, dialect);
    if (verdict.kind !== 'proven-unsafe') return [];
    const targets: ParsedSqlWriteTarget[] = [];
    for (let index = 0; index < verdict.detail.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(verdict.detail, index);
      appendSqlClassifierValue(
        targets,
        descriptor === undefined || !('value' in descriptor)
          ? UNTABLED_SQL_WRITE
          : descriptor.value,
      );
    }
    return targets;
  }

  const targets: ParsedSqlWriteTarget[] = [];
  const keys = witnessObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, keys[index]!);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const nested = writeTablesForNestedStatement(descriptor.value, cteAliases, dialect);
    for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
      appendSqlClassifierValue(targets, nested[nestedIndex]!);
    }
  }
  return targets;
}

function combineStatementVerdicts(
  verdicts: readonly SqlClassifierVerdict<SqlWriteTargets>[],
): SqlClassifierVerdict<SqlWriteTargets> {
  const unsafeTargets: ParsedSqlWriteTarget[] = [];
  for (let index = 0; index < verdicts.length; index += 1) {
    const verdict = verdicts[index]!;
    if (verdict.kind === 'unproven') return verdict;
    if (verdict.kind !== 'proven-unsafe') continue;
    for (let targetIndex = 0; targetIndex < verdict.detail.length; targetIndex += 1) {
      appendSqlClassifierValue(unsafeTargets, verdict.detail[targetIndex]!);
    }
  }
  if (unsafeTargets.length > 0) {
    return {
      kind: 'proven-unsafe',
      detail: uniqueSortedSqlTargets(unsafeTargets),
    };
  }

  return { kind: 'proven-safe' };
}

const COMMON_PROVEN_PURE_SQL_FUNCTIONS = stringSet([
  'abs',
  'avg',
  'coalesce',
  'concat',
  'count',
  'date',
  'greatest',
  'ifnull',
  'json_array',
  'json_extract',
  'json_object',
  'jsonb_build_array',
  'jsonb_build_object',
  'least',
  'length',
  'lower',
  'max',
  'min',
  'nullif',
  'round',
  'substr',
  'substring',
  'sum',
  'trim',
  'upper',
]);

const POSTGRES_PROVEN_PURE_SQL_FUNCTIONS = extendStringSet(COMMON_PROVEN_PURE_SQL_FUNCTIONS, [
  'current_date',
  'current_time',
  'current_timestamp',
  'json_agg',
  'json_build_array',
  'json_build_object',
  'now',
  'to_json',
  'to_jsonb',
]);

const SQLITE_PROVEN_PURE_SQL_FUNCTIONS = extendStringSet(COMMON_PROVEN_PURE_SQL_FUNCTIONS, [
  'datetime',
  'json_group_array',
  'json_group_object',
  'strftime',
]);

function unprovenSqlFunctionCalls(
  value: unknown,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): string[] {
  const calls = createWitnessSet<string>();
  collectUnprovenSqlFunctionCalls(value, dialect, calls, createWitnessWeakSet<object>());
  const snapshot: string[] = [];
  witnessSetForEach(calls, (call) => appendSqlClassifierValue(snapshot, call));
  return witnessReflectApply(nativeArraySort, snapshot, []);
}

function collectUnprovenSqlFunctionCalls(
  value: unknown,
  dialect: ParseSqlWriteTablesOptions['dialect'],
  calls: Set<string>,
  seen: WeakSet<object>,
): void {
  if (!value || typeof value !== 'object') return;
  if (witnessWeakSetHas(seen, value)) return;
  witnessWeakSetAdd(seen, value);

  if (isSqlFunctionCall(value)) {
    const name = sqlFunctionName(value.function);
    if (!isProvenPureSqlFunction(value.function, dialect)) witnessSetAdd(calls, name);
  }

  const descriptors = witnessGetOwnPropertyDescriptors(value);
  const keys = witnessOwnKeys(descriptors);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(descriptors, keys[keyIndex]!);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const property = descriptor.value as PropertyDescriptor;
    if (!('value' in property)) continue;
    const child = property.value;
    if (witnessIsArray(child)) {
      for (let index = 0; index < child.length; index += 1) {
        const item = witnessGetOwnPropertyDescriptor(child, index);
        if (item !== undefined && 'value' in item) {
          collectUnprovenSqlFunctionCalls(item.value, dialect, calls, seen);
        }
      }
    } else {
      collectUnprovenSqlFunctionCalls(child, dialect, calls, seen);
    }
  }
}

function isSqlFunctionCall(value: object): value is { type: 'call'; function: QName } {
  return (
    'type' in value &&
    value.type === 'call' &&
    'function' in value &&
    typeof value.function === 'object' &&
    value.function !== null &&
    'name' in value.function &&
    typeof value.function.name === 'string'
  );
}

function isProvenPureSqlFunction(
  name: QName,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): boolean {
  const functionName = asciiLower(name.name);
  if (name.schema !== undefined && asciiLower(name.schema) !== 'pg_catalog') return false;
  if (dialect === 'sqlite') return witnessSetHas(SQLITE_PROVEN_PURE_SQL_FUNCTIONS, functionName);
  if (dialect === 'postgres')
    return witnessSetHas(POSTGRES_PROVEN_PURE_SQL_FUNCTIONS, functionName);
  return (
    witnessSetHas(POSTGRES_PROVEN_PURE_SQL_FUNCTIONS, functionName) ||
    witnessSetHas(SQLITE_PROVEN_PURE_SQL_FUNCTIONS, functionName)
  );
}

function sqlFunctionName(name: QName): string {
  return name.schema === undefined ? name.name : `${name.schema}.${name.name}`;
}

const SQL_STATEMENT_TYPES = stringSet([
  'alter enum',
  'alter index',
  'alter sequence',
  'alter table',
  'begin',
  'comment',
  'commit',
  'create composite type',
  'create enum',
  'create extension',
  'create function',
  'create index',
  'create materialized view',
  'create schema',
  'create sequence',
  'create table',
  'create view',
  'deallocate',
  'delete',
  'do',
  'drop function',
  'drop index',
  'drop sequence',
  'drop table',
  'drop trigger',
  'drop type',
  'insert',
  'prepare',
  'raise',
  'refresh materialized view',
  'rollback',
  'select',
  'set',
  'set names',
  'set timezone',
  'show',
  'start transaction',
  'tablespace',
  'truncate table',
  'union',
  'union all',
  'update',
  'values',
  'with',
  'with recursive',
]);

function stringSet(values: readonly string[]): Set<string> {
  const set = createWitnessSet<string>();
  for (let index = 0; index < values.length; index += 1) witnessSetAdd(set, values[index]!);
  return set;
}

function extendStringSet(base: Set<string>, values: readonly string[]): Set<string> {
  const set = createWitnessSet<string>();
  witnessSetForEach(base, (value) => witnessSetAdd(set, value));
  for (let index = 0; index < values.length; index += 1) witnessSetAdd(set, values[index]!);
  return set;
}

function uniqueSortedSqlTargets(values: readonly ParsedSqlWriteTarget[]): ParsedSqlWriteTarget[] {
  const seen = createWitnessSet<ParsedSqlWriteTarget>();
  const snapshot: ParsedSqlWriteTarget[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (witnessSetHas(seen, value)) continue;
    witnessSetAdd(seen, value);
    appendSqlClassifierValue(snapshot, value);
  }
  return witnessReflectApply(nativeArraySort, snapshot, [compareSqlWriteTargets]);
}

function appendSqlClassifierValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isStatement(value: object): value is Statement {
  return (
    'type' in value &&
    typeof value.type === 'string' &&
    witnessSetHas(SQL_STATEMENT_TYPES, value.type)
  );
}

function tableName(identifier: QName): string {
  return identifier.schema ? `${identifier.schema}.${identifier.name}` : identifier.name;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareSqlWriteTargets(left: ParsedSqlWriteTarget, right: ParsedSqlWriteTarget): number {
  const leftKey = sqlWriteTargetSortKey(left);
  const rightKey = sqlWriteTargetSortKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function sqlWriteTargetSortKey(target: ParsedSqlWriteTarget): string {
  return target === UNTABLED_SQL_WRITE ? '\0' : target;
}

const unparsedSqliteWriteStatement = securityClassifier(
  'server.sql.unparsed-sqlite-write',
  function (statement: string): boolean {
    const head = firstSqlToken(statement);
    if (
      head === 'attach' ||
      head === 'detach' ||
      head === 'pragma' ||
      head === 'reindex' ||
      head === 'vacuum'
    ) {
      return true;
    }
    return false;
  },
);

function firstSqlToken(statement: string): string | undefined {
  let index = 0;
  for (;;) {
    while (index < statement.length && isSqlWhitespace(statement[index]!)) index += 1;
    if (statement[index] === '-' && statement[index + 1] === '-') {
      const end = intrinsicStringIndexOf(statement, '\n', index + 2);
      if (end === -1) return undefined;
      index = end + 1;
      continue;
    }
    if (statement[index] === '/' && statement[index + 1] === '*') {
      const end = intrinsicStringIndexOf(statement, '*/', index + 2);
      if (end === -1) return undefined;
      index = end + 2;
      continue;
    }
    break;
  }
  let token = '';
  while (index < statement.length && isAsciiLetter(statement[index]!)) {
    token += asciiLowerCharacter(statement[index]!);
    index += 1;
  }
  return token === '' ? undefined : token;
}

function intrinsicStringIndexOf(value: string, search: string, start = 0): number {
  if (search.length === 0) return start <= value.length ? start : value.length;
  for (let index = start; index + search.length <= value.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < search.length; offset += 1) {
      if (value[index + offset] !== search[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function intrinsicStringSlice(value: string, start: number, end = value.length): string {
  let result = '';
  const boundedStart = start < 0 ? 0 : start > value.length ? value.length : start;
  const boundedEnd = end < boundedStart ? boundedStart : end > value.length ? value.length : end;
  for (let index = boundedStart; index < boundedEnd; index += 1) result += value[index]!;
  return result;
}

function parseUnsignedDecimal(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = value[index]!;
    if (!isAsciiDigit(digit)) return 0;
    let numeric = 0;
    while (`${numeric}` !== digit && numeric < 9) numeric += 1;
    result = result * 10 + numeric;
  }
  return result;
}

function asciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += asciiLowerCharacter(value[index]!);
  }
  return result;
}

function asciiLowerCharacter(value: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === value) return lower[index]!;
  }
  return value;
}

function isAsciiLetter(value: string): boolean {
  const lower = asciiLowerCharacter(value);
  return lower >= 'a' && lower <= 'z';
}

function isAsciiDigit(value: string): boolean {
  return value >= '0' && value <= '9';
}

function isSqlWhitespace(value: string): boolean {
  return (
    value === ' ' ||
    value === '\t' ||
    value === '\n' ||
    value === '\r' ||
    value === '\f' ||
    value === '\v' ||
    value === '\u00a0' ||
    value === '\u1680' ||
    (value >= '\u2000' && value <= '\u200a') ||
    value === '\u2028' ||
    value === '\u2029' ||
    value === '\u202f' ||
    value === '\u205f' ||
    value === '\u3000' ||
    value === '\ufeff'
  );
}
