import {
  parse,
  type DeleteStatement,
  type Expr,
  type From,
  type InsertStatement,
  type QName,
  type SelectStatement,
  type Statement,
  type TruncateTableStatement,
  type UpdateStatement,
  type WithRecursiveStatement,
  type WithStatement,
  type WithStatementBinding,
} from 'pgsql-ast-parser';

import type { ObservedDbOperation } from './verifier-observation.js';
import {
  verifierArrayJoin,
  verifierArrayPush,
  verifierGetOwnPropertyDescriptor,
  verifierIsArray,
  verifierNumber,
  verifierObjectKeys,
  verifierSet,
  verifierSetAdd,
  verifierSetForEach,
  verifierSetHas,
  verifierStringIndexOf,
  verifierStringSlice,
} from './verifier-security-intrinsics.js';

/** @internal Parsed read/write operation extracted from a SQL statement. */
export type ParsedSqlOperation = Pick<
  ObservedDbOperation,
  'kind' | 'mutationRead' | 'rowKey' | 'table'
>;

/** @internal SQL parser configuration for the runtime verifier (SPEC.md §11.2). */
export interface ParseSqlOperationsOptions {
  dialect?: 'postgres' | 'sqlite' | undefined;
}

/** @internal Parse a SQL statement into the read/write operations it performs (SPEC.md §11.2). */
export function parseSqlOperations(
  statement: string,
  options: ParseSqlOperationsOptions = {},
): ParsedSqlOperation[] {
  const dialectDescriptor = verifierGetOwnPropertyDescriptor(options, 'dialect');
  if (dialectDescriptor !== undefined && !('value' in dialectDescriptor)) {
    throw new TypeError('SQL verifier dialect must be a stable own data property.');
  }
  const dialect =
    dialectDescriptor !== undefined && 'value' in dialectDescriptor
      ? dialectDescriptor.value
      : undefined;
  const dialectStatement =
    dialect === 'sqlite' ? normalizeSqlitePlaceholders(statement) : statement;
  const parsedStatements = parse(dialectStatement);
  const operations: ParsedSqlOperation[] = [];
  for (let index = 0; index < parsedStatements.length; index += 1) {
    appendOperations(
      operations,
      operationsForStatement(
        arrayEntry(parsedStatements, index, 'parsed SQL statements'),
        verifierSet(),
      ),
    );
  }
  return operations;
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
      const end = verifierStringIndexOf(statement, '\n', index + 2);
      if (end === -1) return normalized + verifierStringSlice(statement, index);
      normalized += verifierStringSlice(statement, index, end + 1);
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = verifierStringIndexOf(statement, '*/', index + 2);
      if (end === -1) return normalized + verifierStringSlice(statement, index);
      normalized += verifierStringSlice(statement, index, end + 2);
      index = end + 1;
      continue;
    }

    if (char === '?') {
      let digitEnd = index + 1;
      while (isAsciiDigit(statement[digitEnd] ?? '')) digitEnd += 1;
      const explicitIndex = verifierStringSlice(statement, index + 1, digitEnd);
      parameterIndex = explicitIndex === '' ? parameterIndex + 1 : verifierNumber(explicitIndex);
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
      return [verifierStringSlice(statement, start, index + 1), index];
    }
    index += 1;
  }
  return [verifierStringSlice(statement, start), statement.length - 1];
}

function operationsForStatement(
  statement: Statement | WithStatementBinding,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  switch (statement.type) {
    case 'select':
    case 'union':
    case 'union all':
    case 'values':
    case 'with':
    case 'with recursive':
      return operationsForSelect(statement, cteAliases);
    case 'insert':
      return operationsForInsert(statement, cteAliases);
    case 'update':
      return operationsForUpdate(statement, cteAliases);
    case 'delete':
      return operationsForDelete(statement, cteAliases);
    case 'truncate table':
      return operationsForTruncate(statement);
    case 'create table':
      return operationsForTableWrite(statement.name);
    case 'alter table':
      return operationsForTableWrite(statement.table);
    case 'create index':
      return operationsForTableWrite(statement.table);
    case 'drop table':
      return operationsForTableWrites(statement.names);
    case 'begin':
    case 'commit':
    case 'rollback':
    case 'start transaction':
    case 'show':
      return [];
    default:
      // SPEC §11.2: a parser-recognized statement must never disappear from the
      // coverage oracle. Conservatively model every unclassified statement as an
      // unscoped write so assertCovered() fails closed after the adapter call.
      return unmodeledStatementWrite(statement.type);
  }
}

function operationsForTableWrite(table: QName): ParsedSqlOperation[] {
  return [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      table: tableName(table),
    },
  ];
}

function operationsForTableWrites(tables: readonly QName[]): ParsedSqlOperation[] {
  const operations: ParsedSqlOperation[] = [];
  for (let index = 0; index < tables.length; index += 1) {
    appendOperations(
      operations,
      operationsForTableWrite(arrayEntry(tables, index, 'SQL DDL tables')),
    );
  }
  return operations;
}

function unmodeledStatementWrite(type: string): ParsedSqlOperation[] {
  return [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      table: `<unmodeled:${type}>`,
    },
  ];
}

function operationsForSelect(
  statement: SelectStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  switch (statement.type) {
    case 'select': {
      const rowKey = rowKeyFromWhere(statement.where);
      const operations: ParsedSqlOperation[] = [];
      appendOperations(operations, operationsForFrom(statement.from ?? [], rowKey, cteAliases));
      appendOperations(
        operations,
        operationsForNestedStatements([statement.columns, statement.where], cteAliases),
      );
      return operations;
    }
    case 'union':
    case 'union all': {
      const operations: ParsedSqlOperation[] = [];
      appendOperations(operations, operationsForSelect(statement.left, cteAliases));
      appendOperations(operations, operationsForSelect(statement.right, cteAliases));
      return operations;
    }
    case 'with':
      return operationsForWith(statement, cteAliases);
    case 'with recursive':
      return operationsForWithRecursive(statement, cteAliases);
    case 'values':
      return [];
  }
}

function operationsForInsert(
  statement: InsertStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const operations: ParsedSqlOperation[] = [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      table: tableName(statement.into),
    },
  ];
  appendOperations(
    operations,
    markMutationReads(operationsForSelect(statement.insert, cteAliases)),
  );
  // KV407 soundness: `ON CONFLICT DO UPDATE SET col=(subquery)` and
  // `RETURNING (subquery)` read other tables; without walking them a
  // cross-domain read hides from coverage (SPEC.md §11.2).
  appendOperations(
    operations,
    markMutationReads(
      operationsForNestedStatements([statement.onConflict, statement.returning], cteAliases),
    ),
  );
  return operations;
}

function operationsForUpdate(
  statement: UpdateStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const rowKey = rowKeyFromWhere(statement.where);
  const operations: ParsedSqlOperation[] = [
    { kind: 'write', mutationRead: undefined, rowKey, table: tableName(statement.table) },
  ];
  appendOperations(
    operations,
    markMutationReads(
      operationsForFrom(statement.from ? [statement.from] : [], rowKey, cteAliases),
    ),
  );
  appendOperations(
    operations,
    markMutationReads(
      operationsForNestedStatements(
        // KV407 soundness: `RETURNING (subquery)` reads other tables (SPEC.md §11.2).
        [statement.sets, statement.where, statement.returning],
        cteAliases,
      ),
    ),
  );
  return operations;
}

function operationsForDelete(
  statement: DeleteStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const operations: ParsedSqlOperation[] = [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: rowKeyFromWhere(statement.where),
      table: tableName(statement.from),
    },
  ];
  // KV407 soundness: `RETURNING (subquery)` reads other tables (SPEC.md §11.2).
  appendOperations(
    operations,
    markMutationReads(
      operationsForNestedStatements([statement.where, statement.returning], cteAliases),
    ),
  );
  return operations;
}

function operationsForTruncate(statement: TruncateTableStatement): ParsedSqlOperation[] {
  // SPEC.md §11.2 meta-soundness: TRUNCATE is a destructive write per named
  // table. Without an explicit write op an uncovered `truncate products` would
  // parse to zero ops and pass `assertCovered()` green (E1).
  const operations: ParsedSqlOperation[] = [];
  for (let index = 0; index < statement.tables.length; index += 1) {
    const table = arrayEntry(statement.tables, index, 'TRUNCATE tables');
    verifierArrayPush(operations, {
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      table: tableName(table),
    });
  }
  return operations;
}

function operationsForWith(
  statement: WithStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  let aliases = cteAliases;
  const operations: ParsedSqlOperation[] = [];

  for (let index = 0; index < statement.bind.length; index += 1) {
    const binding = arrayEntry(statement.bind, index, 'WITH bindings');
    appendOperations(operations, operationsForStatement(binding.statement, aliases));
    aliases = withAliases(aliases, [binding.alias.name]);
  }

  appendOperations(operations, operationsForStatement(statement.in, aliases));
  return operations;
}

function operationsForWithRecursive(
  statement: WithRecursiveStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const aliases = withAliases(cteAliases, [statement.alias.name]);
  const operations: ParsedSqlOperation[] = [];
  appendOperations(operations, operationsForSelect(statement.bind, aliases));
  appendOperations(operations, operationsForStatement(statement.in, aliases));
  return operations;
}

function withAliases(
  currentAliases: ReadonlySet<string>,
  addedAliases: readonly string[],
): ReadonlySet<string> {
  const aliases = verifierSet<string>();
  verifierSetForEach(currentAliases, (alias) => verifierSetAdd(aliases, alias));
  for (let index = 0; index < addedAliases.length; index += 1) {
    verifierSetAdd(aliases, arrayEntry(addedAliases, index, 'WITH aliases'));
  }
  return aliases;
}

function operationsForFrom(
  from: readonly From[],
  rowKey: string | undefined,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const operations: ParsedSqlOperation[] = [];
  for (let index = 0; index < from.length; index += 1) {
    const item = arrayEntry(from, index, 'SQL FROM sources');
    if (item.type === 'table') {
      const table = tableName(item.name);
      if (!verifierSetHas(cteAliases, table)) {
        verifierArrayPush(operations, { kind: 'read', mutationRead: undefined, rowKey, table });
      }
      continue;
    }

    if (item.type === 'statement') {
      appendOperations(operations, operationsForSelect(item.statement, cteAliases));
    }
  }
  return operations;
}

function operationsForNestedStatements(
  values: readonly unknown[],
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const operations: ParsedSqlOperation[] = [];
  for (let index = 0; index < values.length; index += 1) {
    appendOperations(
      operations,
      operationsForNestedStatement(arrayEntry(values, index, 'nested SQL values'), cteAliases),
    );
  }
  return operations;
}

function operationsForNestedStatement(
  value: unknown,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  if (verifierIsArray(value)) {
    const operations: ParsedSqlOperation[] = [];
    for (let index = 0; index < value.length; index += 1) {
      appendOperations(
        operations,
        operationsForNestedStatement(arrayEntry(value, index, 'nested SQL array'), cteAliases),
      );
    }
    return operations;
  }
  if (!value || typeof value !== 'object') return [];

  if (isSelectStatement(value)) {
    return operationsForSelect(value, cteAliases);
  }

  const operations: ParsedSqlOperation[] = [];
  const keys = verifierObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = arrayEntry(keys, index, 'nested SQL object keys');
    const descriptor = verifierGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    appendOperations(operations, operationsForNestedStatement(descriptor.value, cteAliases));
  }
  return operations;
}

function isSelectStatement(value: object): value is SelectStatement {
  return (
    'type' in value &&
    (value.type === 'select' ||
      value.type === 'union' ||
      value.type === 'union all' ||
      value.type === 'values' ||
      value.type === 'with' ||
      value.type === 'with recursive')
  );
}

function markMutationReads(operations: ParsedSqlOperation[]): ParsedSqlOperation[] {
  const marked: ParsedSqlOperation[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = arrayEntry(operations, index, 'mutation SQL operations');
    verifierArrayPush(marked, {
      kind: operation.kind,
      mutationRead: operation.kind === 'read' ? true : operation.mutationRead,
      rowKey: operation.rowKey,
      table: operation.table,
    });
  }
  return marked;
}

function rowKeyFromWhere(where: Expr | null | undefined): string | undefined {
  if (!where) return undefined;
  const unique = verifierSet<string>();
  const observed = rowKeysFromExpr(where);
  for (let index = 0; index < observed.length; index += 1) {
    verifierSetAdd(unique, arrayEntry(observed, index, 'SQL row keys'));
  }
  const keys: string[] = [];
  verifierSetForEach(unique, (key) => verifierArrayPush(keys, key));
  return keys.length > 0 ? verifierArrayJoin(keys, ', ') : undefined;
}

function rowKeysFromExpr(expression: Expr): string[] {
  if (expression.type !== 'binary') return [];

  if (expression.op === '=') {
    const left = refName(expression.left);
    const right = refName(expression.right);
    if (left && !right) return [left];
    if (right && !left) return [right];
    if (left) return [left];
    if (right) return [right];
  }

  const keys = rowKeysFromExpr(expression.left);
  appendStrings(keys, rowKeysFromExpr(expression.right));
  return keys;
}

function refName(expression: Expr): string | undefined {
  return expression.type === 'ref' && expression.name !== '*' ? expression.name : undefined;
}

function tableName(identifier: QName): string {
  return identifier.schema && identifier.schema !== 'public'
    ? `${identifier.schema}.${identifier.name}`
    : identifier.name;
}

function appendOperations(
  target: ParsedSqlOperation[],
  source: readonly ParsedSqlOperation[],
): void {
  for (let index = 0; index < source.length; index += 1) {
    verifierArrayPush(target, arrayEntry(source, index, 'SQL operations'));
  }
}

function appendStrings(target: string[], source: readonly string[]): void {
  for (let index = 0; index < source.length; index += 1) {
    verifierArrayPush(target, arrayEntry(source, index, 'SQL strings'));
  }
}

function arrayEntry<Value>(values: readonly Value[], index: number, label: string): Value {
  const descriptor = verifierGetOwnPropertyDescriptor(values, index);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label} must remain a dense own-data array.`);
  }
  return descriptor.value;
}

function isAsciiDigit(value: string): boolean {
  return value >= '0' && value <= '9';
}
