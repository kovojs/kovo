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

/** @internal Parsed read/write operation extracted from a SQL statement. */
export type ParsedSqlOperation = Pick<
  ObservedDbOperation,
  'kind' | 'mutationRead' | 'rowKey' | 'table'
>;

/** @internal Parse a SQL statement into the read/write operations it performs (SPEC.md §11.2). */
export function parseSqlOperations(statement: string): ParsedSqlOperation[] {
  return parse(statement).flatMap((parsed) => operationsForStatement(parsed, new Set()));
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
    default:
      return [];
  }
}

function operationsForSelect(
  statement: SelectStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  switch (statement.type) {
    case 'select': {
      const rowKey = rowKeyFromWhere(statement.where);
      return [
        ...operationsForFrom(statement.from ?? [], rowKey, cteAliases),
        ...operationsForNestedStatements([statement.columns, statement.where], cteAliases),
      ];
    }
    case 'union':
    case 'union all':
      return [
        ...operationsForSelect(statement.left, cteAliases),
        ...operationsForSelect(statement.right, cteAliases),
      ];
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
  return [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      table: tableName(statement.into),
    },
    ...markMutationReads(operationsForSelect(statement.insert, cteAliases)),
    // KV407 soundness: `ON CONFLICT DO UPDATE SET col=(subquery)` and
    // `RETURNING (subquery)` read other tables; without walking them a
    // cross-domain read hides from coverage (SPEC.md §11.2).
    ...markMutationReads(
      operationsForNestedStatements([statement.onConflict, statement.returning], cteAliases),
    ),
  ];
}

function operationsForUpdate(
  statement: UpdateStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const rowKey = rowKeyFromWhere(statement.where);
  return [
    { kind: 'write', mutationRead: undefined, rowKey, table: tableName(statement.table) },
    ...markMutationReads(
      operationsForFrom(statement.from ? [statement.from] : [], rowKey, cteAliases),
    ),
    ...markMutationReads(
      operationsForNestedStatements(
        // KV407 soundness: `RETURNING (subquery)` reads other tables (SPEC.md §11.2).
        [statement.sets, statement.where, statement.returning],
        cteAliases,
      ),
    ),
  ];
}

function operationsForDelete(
  statement: DeleteStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  return [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: rowKeyFromWhere(statement.where),
      table: tableName(statement.from),
    },
    // KV407 soundness: `RETURNING (subquery)` reads other tables (SPEC.md §11.2).
    ...markMutationReads(
      operationsForNestedStatements([statement.where, statement.returning], cteAliases),
    ),
  ];
}

function operationsForTruncate(statement: TruncateTableStatement): ParsedSqlOperation[] {
  // SPEC.md §11.2 meta-soundness: TRUNCATE is a destructive write per named
  // table. Without an explicit write op an uncovered `truncate products` would
  // parse to zero ops and pass `assertCovered()` green (E1).
  return statement.tables.map((table) => ({
    kind: 'write' as const,
    mutationRead: undefined,
    rowKey: undefined,
    table: tableName(table),
  }));
}

function operationsForWith(
  statement: WithStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  let aliases = cteAliases;
  const operations: ParsedSqlOperation[] = [];

  for (const binding of statement.bind) {
    operations.push(...operationsForStatement(binding.statement, aliases));
    aliases = withAliases(aliases, [binding.alias.name]);
  }

  return [...operations, ...operationsForStatement(statement.in, aliases)];
}

function operationsForWithRecursive(
  statement: WithRecursiveStatement,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  const aliases = withAliases(cteAliases, [statement.alias.name]);
  return [
    ...operationsForSelect(statement.bind, aliases),
    ...operationsForStatement(statement.in, aliases),
  ];
}

function withAliases(
  currentAliases: ReadonlySet<string>,
  addedAliases: readonly string[],
): ReadonlySet<string> {
  return new Set([...currentAliases, ...addedAliases]);
}

function operationsForFrom(
  from: readonly From[],
  rowKey: string | undefined,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  return from.flatMap((item) => {
    if (item.type === 'table') {
      const table = tableName(item.name);
      return cteAliases.has(table)
        ? []
        : [{ kind: 'read', mutationRead: undefined, rowKey, table }];
    }

    if (item.type === 'statement') {
      return operationsForSelect(item.statement, cteAliases);
    }

    return [];
  });
}

function operationsForNestedStatements(
  values: readonly unknown[],
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  return values.flatMap((value) => operationsForNestedStatement(value, cteAliases));
}

function operationsForNestedStatement(
  value: unknown,
  cteAliases: ReadonlySet<string>,
): ParsedSqlOperation[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => operationsForNestedStatement(item, cteAliases));
  }
  if (!value || typeof value !== 'object') return [];

  if (isSelectStatement(value)) {
    return operationsForSelect(value, cteAliases);
  }

  return Object.values(value).flatMap((item) => operationsForNestedStatement(item, cteAliases));
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
  return operations.map((operation) => ({
    ...operation,
    mutationRead: operation.kind === 'read' ? true : operation.mutationRead,
  }));
}

function rowKeyFromWhere(where: Expr | null | undefined): string | undefined {
  const keys = where ? [...new Set(rowKeysFromExpr(where))] : [];
  return keys.length > 0 ? keys.join(', ') : undefined;
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

  return [...rowKeysFromExpr(expression.left), ...rowKeysFromExpr(expression.right)];
}

function refName(expression: Expr): string | undefined {
  return expression.type === 'ref' && expression.name !== '*' ? expression.name : undefined;
}

function tableName(identifier: QName): string {
  return identifier.name;
}
