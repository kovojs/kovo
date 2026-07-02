import { createRequire } from 'node:module';
import type { ClassifierVerdict } from '@kovojs/core/internal/classifier-verdict';
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
export type SqlClassifierVerdict<T> = ClassifierVerdict<T>;

/** Parse a SQL statement into the physical tables it mutates (SPEC §10.3/§11.2). */
export const parseSqlWriteTables = securityClassifier(
  'server.sql.parse-write-tables',
  function (statement: string, options: ParseSqlWriteTablesOptions = {}): ParsedSqlWriteTarget[] {
    const verdict = classifyStatement(statement, options);
    if (verdict.kind === 'proven-safe') return [];
    if (verdict.kind === 'unproven') return [UNTABLED_SQL_WRITE];
    return [...verdict.detail];
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

    return combineStatementVerdicts(
      parsedStatements.map((parsed) => classifyParsedStatement(parsed, new Set(), options.dialect)),
    );
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
      const end = statement.indexOf('\n', index + 2);
      if (end === -1) return normalized + statement.slice(index);
      normalized += statement.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = statement.indexOf('*/', index + 2);
      if (end === -1) return normalized + statement.slice(index);
      normalized += statement.slice(index, end + 2);
      index = end + 1;
      continue;
    }

    if (char === '?') {
      let digitEnd = index + 1;
      while (/\d/.test(statement[digitEnd] ?? '')) digitEnd += 1;
      const explicitIndex = statement.slice(index + 1, digitEnd);
      parameterIndex = explicitIndex === '' ? parameterIndex + 1 : Number(explicitIndex);
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
      return [statement.slice(start, index + 1), index];
    }
    index += 1;
  }
  return [statement.slice(start), statement.length - 1];
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
        return writeVerdict(writeTablesForInsert(statement, cteAliases));
      case 'update':
        return writeVerdict(writeTablesForUpdate(statement, cteAliases));
      case 'delete':
        return writeVerdict(writeTablesForDelete(statement, cteAliases));
      case 'truncate table':
        return writeVerdict(writeTablesForTruncate(statement));
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

function writeVerdict(targets: ParsedSqlWriteTarget[]): SqlClassifierVerdict<SqlWriteTargets> {
  if (targets.length === 0 || targets.includes(UNTABLED_SQL_WRITE)) {
    return {
      kind: 'unproven',
      reason: 'write statement did not expose a resolvable table target',
    };
  }
  return { kind: 'proven-unsafe', detail: [...new Set(targets)].sort(compareSqlWriteTargets) };
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
): ParsedSqlWriteTarget[] {
  return [
    tableName(statement.into),
    ...writeTablesForNestedStatements(
      [statement.insert, statement.onConflict, statement.returning],
      cteAliases,
    ),
  ];
}

function writeTablesForUpdate(
  statement: UpdateStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlWriteTarget[] {
  return [
    tableName(statement.table),
    ...writeTablesForNestedStatements(
      [statement.from, statement.sets, statement.where, statement.returning],
      cteAliases,
    ),
  ];
}

function writeTablesForDelete(
  statement: DeleteStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlWriteTarget[] {
  return [
    tableName(statement.from),
    ...writeTablesForNestedStatements([statement.where, statement.returning], cteAliases),
  ];
}

function writeTablesForTruncate(statement: TruncateTableStatement): ParsedSqlWriteTarget[] {
  return statement.tables.map((table) => tableName(table));
}

function writeTablesForWith(
  statement: WithStatement,
  cteAliases: ReadonlySet<string>,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): SqlClassifierVerdict<SqlWriteTargets> {
  let aliases = cteAliases;
  const verdicts: SqlClassifierVerdict<SqlWriteTargets>[] = [];

  for (const binding of statement.bind) {
    verdicts.push(classifyParsedStatement(binding.statement, aliases, dialect));
    aliases = withAliases(aliases, [binding.alias.name]);
  }

  verdicts.push(classifyParsedStatement(statement.in, aliases, dialect));
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
  return new Set([...currentAliases, ...addedAliases]);
}

function writeTablesForNestedStatements(
  values: readonly unknown[],
  cteAliases: ReadonlySet<string>,
): ParsedSqlWriteTarget[] {
  return values.flatMap((value) => writeTablesForNestedStatement(value, cteAliases));
}

function writeTablesForNestedStatement(
  value: unknown,
  cteAliases: ReadonlySet<string>,
): ParsedSqlWriteTarget[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => writeTablesForNestedStatement(item, cteAliases));
  }
  if (!value || typeof value !== 'object') return [];

  if (isStatement(value)) {
    const verdict = classifyParsedStatement(value, cteAliases, undefined);
    return verdict.kind === 'proven-unsafe' ? [...verdict.detail] : [];
  }

  return Object.values(value).flatMap((item) => writeTablesForNestedStatement(item, cteAliases));
}

function combineStatementVerdicts(
  verdicts: readonly SqlClassifierVerdict<SqlWriteTargets>[],
): SqlClassifierVerdict<SqlWriteTargets> {
  const unsafeTargets = verdicts.flatMap((verdict) =>
    verdict.kind === 'proven-unsafe' ? [...verdict.detail] : [],
  );
  if (unsafeTargets.length > 0) {
    return {
      kind: 'proven-unsafe',
      detail: [...new Set(unsafeTargets)].sort(compareSqlWriteTargets),
    };
  }

  const unproven = verdicts.find((verdict) => verdict.kind === 'unproven');
  if (unproven) return unproven;

  return { kind: 'proven-safe' };
}

const COMMON_PROVEN_PURE_SQL_FUNCTIONS = new Set<string>([
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

const POSTGRES_PROVEN_PURE_SQL_FUNCTIONS = new Set<string>([
  ...COMMON_PROVEN_PURE_SQL_FUNCTIONS,
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

const SQLITE_PROVEN_PURE_SQL_FUNCTIONS = new Set<string>([
  ...COMMON_PROVEN_PURE_SQL_FUNCTIONS,
  'datetime',
  'json_group_array',
  'json_group_object',
  'strftime',
]);

function unprovenSqlFunctionCalls(
  value: unknown,
  dialect: ParseSqlWriteTablesOptions['dialect'],
): string[] {
  const calls = new Set<string>();
  collectUnprovenSqlFunctionCalls(value, dialect, calls, new WeakSet<object>());
  return [...calls].sort();
}

function collectUnprovenSqlFunctionCalls(
  value: unknown,
  dialect: ParseSqlWriteTablesOptions['dialect'],
  calls: Set<string>,
  seen: WeakSet<object>,
): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (isSqlFunctionCall(value)) {
    const name = sqlFunctionName(value.function);
    if (!isProvenPureSqlFunction(value.function, dialect)) calls.add(name);
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) collectUnprovenSqlFunctionCalls(item, dialect, calls, seen);
      continue;
    }
    collectUnprovenSqlFunctionCalls(child, dialect, calls, seen);
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
  const functionName = name.name.toLowerCase();
  if (name.schema !== undefined && name.schema.toLowerCase() !== 'pg_catalog') return false;
  if (dialect === 'sqlite') return SQLITE_PROVEN_PURE_SQL_FUNCTIONS.has(functionName);
  if (dialect === 'postgres') return POSTGRES_PROVEN_PURE_SQL_FUNCTIONS.has(functionName);
  return (
    POSTGRES_PROVEN_PURE_SQL_FUNCTIONS.has(functionName) ||
    SQLITE_PROVEN_PURE_SQL_FUNCTIONS.has(functionName)
  );
}

function sqlFunctionName(name: QName): string {
  return name.schema === undefined ? name.name : `${name.schema}.${name.name}`;
}

const SQL_STATEMENT_TYPES = new Set<string>([
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

function isStatement(value: object): value is Statement {
  return 'type' in value && typeof value.type === 'string' && SQL_STATEMENT_TYPES.has(value.type);
}

function tableName(identifier: QName): string {
  return identifier.schema ? `${identifier.schema}.${identifier.name}` : identifier.name;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareSqlWriteTargets(left: ParsedSqlWriteTarget, right: ParsedSqlWriteTarget): number {
  return sqlWriteTargetSortKey(left).localeCompare(sqlWriteTargetSortKey(right));
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
  const match = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*([a-z]+)/iu.exec(statement);
  return match?.[1]?.toLowerCase();
}
