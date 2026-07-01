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

/** Parse a SQL statement into the physical tables it mutates (SPEC §10.3/§11.2). */
export const parseSqlWriteTables = securityClassifier(
  'server.sql.parse-write-tables',
  function (statement: string, options: ParseSqlWriteTablesOptions = {}): ParsedSqlWriteTarget[] {
    const lexicalWrite = unparsedSqliteWriteStatement(statement);
    if (lexicalWrite) return [UNTABLED_SQL_WRITE];

    const sql = options.dialect === 'sqlite' ? normalizeSqlitePlaceholders(statement) : statement;
    return [
      ...new Set(
        sqlParser()
          .parse(sql)
          .flatMap((parsed) => writeTablesForStatement(parsed, new Set())),
      ),
    ].sort(compareSqlWriteTargets);
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

const writeTablesForStatement = securityClassifier(
  'server.sql.classify-write-statement',
  function (
    statement: Statement | WithStatementBinding,
    cteAliases: ReadonlySet<string>,
  ): ParsedSqlWriteTarget[] {
    switch (statement.type) {
      case 'insert':
        return writeTablesForInsert(statement, cteAliases);
      case 'update':
        return writeTablesForUpdate(statement, cteAliases);
      case 'delete':
        return writeTablesForDelete(statement, cteAliases);
      case 'truncate table':
        return writeTablesForTruncate(statement);
      case 'with':
        return writeTablesForWith(statement, cteAliases);
      case 'with recursive':
        return writeTablesForWithRecursive(statement, cteAliases);
      case 'select':
      case 'show':
      case 'union':
      case 'union all':
      case 'values':
        return [];
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
        return [UNTABLED_SQL_WRITE];
      default:
        statement satisfies never;
        return [UNTABLED_SQL_WRITE];
    }
  },
);

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
): ParsedSqlWriteTarget[] {
  let aliases = cteAliases;
  const tables: ParsedSqlWriteTarget[] = [];

  for (const binding of statement.bind) {
    tables.push(...writeTablesForStatement(binding.statement, aliases));
    aliases = withAliases(aliases, [binding.alias.name]);
  }

  return [...tables, ...writeTablesForStatement(statement.in, aliases)];
}

function writeTablesForWithRecursive(
  statement: WithRecursiveStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlWriteTarget[] {
  return writeTablesForStatement(statement.in, withAliases(cteAliases, [statement.alias.name]));
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
    return writeTablesForStatement(value, cteAliases);
  }

  return Object.values(value).flatMap((item) => writeTablesForNestedStatement(item, cteAliases));
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
  return identifier.name;
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
