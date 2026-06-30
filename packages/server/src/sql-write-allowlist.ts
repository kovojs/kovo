import { createRequire } from 'node:module';

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
const pgsqlAstParser = require('pgsql-ast-parser') as typeof import('pgsql-ast-parser');

/** Runtime SQL parser configuration for production write-table enforcement. */
export interface ParseSqlWriteTablesOptions {
  dialect?: 'postgres' | 'sqlite' | undefined;
}

/** Parse a SQL statement into the physical tables it mutates (SPEC §10.3/§11.2). */
export function parseSqlWriteTables(
  statement: string,
  options: ParseSqlWriteTablesOptions = {},
): string[] {
  const sql = options.dialect === 'sqlite' ? normalizeSqlitePlaceholders(statement) : statement;
  return [
    ...new Set(
      pgsqlAstParser.parse(sql).flatMap((parsed) => writeTablesForStatement(parsed, new Set())),
    ),
  ].sort();
}

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

function writeTablesForStatement(
  statement: Statement | WithStatementBinding,
  cteAliases: ReadonlySet<string>,
): string[] {
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
    default:
      return [];
  }
}

function writeTablesForInsert(
  statement: InsertStatement,
  cteAliases: ReadonlySet<string>,
): string[] {
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
): string[] {
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
): string[] {
  return [
    tableName(statement.from),
    ...writeTablesForNestedStatements([statement.where, statement.returning], cteAliases),
  ];
}

function writeTablesForTruncate(statement: TruncateTableStatement): string[] {
  return statement.tables.map((table) => tableName(table));
}

function writeTablesForWith(statement: WithStatement, cteAliases: ReadonlySet<string>): string[] {
  let aliases = cteAliases;
  const tables: string[] = [];

  for (const binding of statement.bind) {
    tables.push(...writeTablesForStatement(binding.statement, aliases));
    aliases = withAliases(aliases, [binding.alias.name]);
  }

  return [...tables, ...writeTablesForStatement(statement.in, aliases)];
}

function writeTablesForWithRecursive(
  statement: WithRecursiveStatement,
  cteAliases: ReadonlySet<string>,
): string[] {
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
): string[] {
  return values.flatMap((value) => writeTablesForNestedStatement(value, cteAliases));
}

function writeTablesForNestedStatement(value: unknown, cteAliases: ReadonlySet<string>): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => writeTablesForNestedStatement(item, cteAliases));
  }
  if (!value || typeof value !== 'object') return [];

  if (isStatement(value)) {
    return writeTablesForStatement(value, cteAliases);
  }

  return Object.values(value).flatMap((item) => writeTablesForNestedStatement(item, cteAliases));
}

function isStatement(value: object): value is Statement {
  return 'type' in value && typeof value.type === 'string';
}

function tableName(identifier: QName): string {
  return identifier.name;
}
