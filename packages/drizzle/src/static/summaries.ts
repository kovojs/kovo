import { diagnosticDefinitionText, diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type { KovoDomainTableAnnotation, KovoFanAnnotation } from '../drizzle-surface.js';
import type { ReadSummaryInput, TouchGraphDiagnostic, UnresolvedSummaryInput, WriteSummaryInput } from '../graph.js';
import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';
import {
  isQueryReceiverIdentifier,
  queryCallbackBodies,
  type QueryShapeSelection,
} from './query-shapes.js';
import {
  isSourceDestructuredReceiverIdentifier,
  symbolForIdentifierReference,
} from './receiver-surface.js';
import { callExpressionsInNode, touchBodyCallExpressions } from './project-receivers.js';
import {
  emptySessionProvenanceContext,
  opaqueAliasReasonForExpression,
  privateScopeForExpression,
  privateScopeKey,
  sessionProvenanceContextForNodes,
} from './session-provenance.js';
import {
  type ExtractedForeignKey,
  type ExtractedFunction,
  type ExtractedPredicateFact,
  type ExtractedPredicateSummary,
  type ExtractedQueryDefinition,
  type ExtractedReadCall,
  type ExtractedReadSource,
  type ExtractedTable,
  type ExtractedTableAnnotation,
  type ExtractedWriteCall,
  type FunctionTouchSummary,
  type MaterializedViewRefreshFact,
  type QueryFact,
  type QueryInstanceKeyComparison,
  type QueryInstanceKeyOperand,
  type QueryReceiverReferences,
  type QueryShape,
  type SessionProvenanceContext,
  type SourceFileInput,
  type UnmodeledRelationFact,
  KV411_MESSAGE,
  UNRESOLVED_READ_SOURCE_EXPRESSION,
  isDomainExtractedTableAnnotation,
  isExemptExtractedTableAnnotation,
  isUnmappedTableAnnotation,
  lineForIndex,
  resolvedSymbolKey,
  unmodeledRelationFromExpression,
} from '../static.js';

export function queryReadDomains(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const domains = new Set<string>();

  for (const tableExpression of tableExpressions) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
      domains.add(table.annotation.domain);
    }
  }

  return [...domains].sort();
}

export function exemptQueryReadDiagnostics(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const exemptTables = new Set<string>();

  for (const tableExpression of tableExpressions) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (isExemptExtractedTableAnnotation(table.annotation))
        exemptTables.add(table.annotation.name);
    }
  }

  if (exemptTables.size === 0) return [];

  return [
    {
      code: 'KV411',
      message: `${KV411_MESSAGE}. Tables: ${[...exemptTables].sort().join(', ')}.`,
      severity: 'error',
      site,
    },
  ];
}

export function unmodeledRelationReadDiagnostics(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const relations = tableExpressions
    .filter((expression) => (tables.get(expression) ?? []).length === 0)
    .map(unmodeledRelationFromExpression)
    .filter((relation): relation is UnmodeledRelationFact => relation !== undefined);
  if (relations.length === 0) return [];

  return [...new Map(relations.map((relation) => [relation.expression, relation])).values()]
    .sort(
      (left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind),
    )
    .map((relation) => ({
      code: 'KV412' as const,
      message: `${diagnosticDefinitions.KV412.message} ${relation.kind} ${relation.name} has no derived or declared domain.`,
      severity: diagnosticDefinitions.KV412.severity,
      site,
    }));
}

export function queryTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): string[] {
  return [
    ...queryJoinTableExpressions(body, receiverReferences, options.readTableIdentifier),
    ...queryRelationalTableExpressions(body, receiverReferences, options.relationalTableName),
  ];
}

export interface QueryReadResolutionOptions {
  readTableIdentifier?: (node: Node) => string | undefined;
  relationalTableName?: (name: string) => string | undefined;
}

export function queryJoinTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier?: (node: Node) => string | undefined,
): string[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const tableArgument = call.getArguments()[0];
    const table = readTableIdentifier
      ? tableArgument
        ? readTableIdentifier(tableArgument)
        : undefined
      : staticExpressionPath(tableArgument);
    return table ? [table] : [];
  });
}

export function queryRelationalTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
): string[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    if (!tableAccess) return [];
    const table = staticAccessName(tableAccess);
    if (!table) return [];

    const queryAccess = staticAccessExpression(tableAccess);
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    const receiver = staticAccessExpression(queryAccess);
    // SPEC §10-§11: non-DB objects must not fabricate relational read/KV406 facts.
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];

    const resolvedTable = relationalTableName ? relationalTableName(table) : table;
    return resolvedTable ? [resolvedTable] : [];
  });
}

export function unresolvedQueryReadDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = queryBodyCallExpressions(
    body,
    queryReceiverMode(receiverReferences),
    (call) => {
      const name = propertyAccessCallName(call);
      if (!name || !isQueryReadCallName(name)) return [];
      if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

      const tableArgument = call.getArguments()[0];
      const table = options.readTableIdentifier
        ? tableArgument
          ? options.readTableIdentifier(tableArgument)
          : undefined
        : staticExpressionPath(tableArgument);
      if (table) return [];

      return [
        {
          code: 'KV406' as const,
          message: `${diagnosticDefinitions.KV406.message} Query read source for db.${name}() could not be resolved to a Drizzle table.`,
          severity: diagnosticDefinitions.KV406.severity,
          site: '',
        },
      ];
    },
  );

  diagnostics.push(
    ...unresolvedRelationalQueryReadDiagnostics(
      body,
      receiverReferences,
      options.relationalTableName,
    ),
  );
  return diagnostics;
}

export function unresolvedRelationalQueryReadDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
): TouchGraphDiagnostic[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    const table = tableAccess ? staticAccessName(tableAccess) : undefined;
    if (!tableAccess || (table && (!relationalTableName || relationalTableName(table)))) {
      return [];
    }
    const queryAccess = staticAccessExpression(tableAccess);
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    const receiver = staticAccessExpression(queryAccess);
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];

    return [
      {
        code: 'KV406' as const,
        message: `${diagnosticDefinitions.KV406.message} Query relational read source could not be resolved to a Drizzle table.`,
        severity: diagnosticDefinitions.KV406.severity,
        site: '',
      },
    ];
  });
}

export function queryBodyCallExpressions<T>(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source',
  extract: (call: CallExpression) => readonly T[],
): T[] {
  // SPEC §10-§11: query facts come from executable query-loader callback surfaces; nested helper
  // bodies are summarized only when called instead of fabricating reads from declarations.
  return queryCallbackBodies(body, mode)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
    .flatMap(extract);
}

export function queryReceiverMode(receiverReferences: QueryReceiverReferences): 'project' | 'source' {
  return receiverReferences.projectContainers ? 'project' : 'source';
}

export function isQueryCallOnReceiver(
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
): boolean {
  // SPEC §11.1: read facts must originate from the Drizzle receiver, not lookalike builders.
  const receiver = queryCallChainReceiver(call);
  return isQueryReceiverIdentifier(receiver, receiverReferences);
}

export function queryCallChainReceiver(call: CallExpression): Node | undefined {
  let receiver = staticAccessExpression(call.getExpression());

  while (receiver && Node.isCallExpression(receiver)) {
    receiver = staticAccessExpression(receiver.getExpression());
  }

  return receiver;
}

/**
 * SPEC §11.1 (part-4 D1): resolve a write call's receiver through chained CTE
 * prefixes (`db.with(cte).insert(t)` ⇒ receiver `db`). Only `.with(...)` link
 * calls are unwound; any other CallExpression receiver is returned as-is so it
 * fails closed (not a project receiver identifier ⇒ KV406 surface).
 */
export function writeCallChainReceiver(receiver: Node | undefined): Node | undefined {
  let current = receiver;

  while (current && Node.isCallExpression(current)) {
    if (staticAccessName(current.getExpression()) !== 'with') break;
    current = staticAccessExpression(current.getExpression());
  }

  return current;
}

export function callSourceOrder(call: CallExpression): number {
  const expression = call.getExpression();
  return Node.isPropertyAccessExpression(expression)
    ? expression.getNameNode().getStart()
    : call.getStart();
}

export function isQueryReadCallName(name: string): boolean {
  return (
    name === 'from' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

export function isJoinReadCallName(name: string): boolean {
  return name === 'join' || isQueryReadCallName(name);
}

export function staticExpressionPath(
  node: Node | undefined,
  resolveIdentifier?: (node: Node) => string | undefined,
): string | undefined {
  if (!node) return undefined;
  const expression = unwrappedStaticExpressionNode(node);
  if (expression !== node) return staticExpressionPath(expression, resolveIdentifier);

  const resolved = resolveIdentifier?.(node);
  if (resolved) return resolved;
  if (Node.isIdentifier(node)) return resolveIdentifier?.(node) ?? node.getText();
  if (Node.isPropertyAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression(), resolveIdentifier);
    return base ? `${base}.${node.getName()}` : undefined;
  }
  if (Node.isElementAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression(), resolveIdentifier);
    const name = staticAccessName(node);
    return base && name ? `${base}.${name}` : undefined;
  }
  return undefined;
}

export function staticExpressionRootIdentifier(node: Node): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isIdentifier(expression)) return expression;
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return staticExpressionRootIdentifier(expression.getExpression());
  }
  if (Node.isCallExpression(expression)) {
    return staticExpressionRootIdentifier(expression.getExpression());
  }
  return undefined;
}

export function unwrappedStaticExpressionNode(node: Node): Node {
  let current = node;

  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }

  return current;
}

export function unwrappedFunctionExpression(node: Node): ArrowFunction | FunctionExpression | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)
    ? expression
    : undefined;
}

export function queryInstanceKey(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  // SPEC §10-§11: query keys must come from real predicates, not comment/string text.
  // Only `and(...)`/top-level conjuncts (not `or(...)` branches) discharge a unique key.
  return compositeQueryInstanceKey(comparisons.instanceKey, tables);
}

/**
 * The domains a query's `where` predicates anchor to `req.session.*` (SPEC §11.1
 * session-traceability). A read of an owner-annotated domain anchored this way is
 * session-scoped (not IDOR), so it discharges KV414.
 */
export function querySessionAnchoredDomains(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly string[] {
  const domains = new Set<string>();
  for (const comparison of comparisons.instanceKey) {
    const domain = sessionAnchoredDomainFromEqOperands(comparison.left, comparison.right, tables);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

/**
 * SPEC §10.3 / KV414 (A3): the owner-annotated domains a query's `where` predicates
 * select through a client-visible `input.*` arg compared against ANY column of that
 * domain's table — not only the declared `key` column. This is the canonical IDOR
 * signal regardless of whether the keyed column is `key:` or `owner:` (e.g.
 * `where(eq(orders.userId, input.userId))` on `{ key: id, owner: userId }`). Includes
 * `or(...)`-branch operands (A2, fail-closed). The declared-key match in
 * `queryInstanceKey` still governs instanceKey/invalidation granularity.
 */
export function queryArgScopedDomains(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly string[] {
  const domains = new Set<string>();
  for (const comparison of comparisons.argCandidates) {
    const domain = argScopedDomainFromEqOperands(comparison.left, comparison.right, tables);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

export function argScopedDomainFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  const candidates = [
    { inputKey: right.inputKey, tableKey: left.tableKey },
    { inputKey: left.inputKey, tableKey: right.tableKey },
  ];

  for (const candidate of candidates) {
    if (!candidate.inputKey || !candidate.tableKey) continue;
    // A3 is purely an `owner:`-table IDOR signal — restrict to owner-annotated tables
    // so a non-owner arg read (the common safe case, e.g. `eq(products.sku, input.sku)`)
    // never pollutes the fact. The owner-domain filter in `scopeAuditsFromQueryFacts`
    // would drop a non-owner domain anyway; this keeps the fact precise.
    const domain = resolvedQueryOwnerTableDomain(candidate.tableKey, tables);
    if (domain) return domain;
  }

  return null;
}

/**
 * Resolve a `tableIdentifier.column` reference to the domain of an `owner:`-annotated
 * table regardless of which column is named (SPEC §10.1/§10.3). Contrast
 * `resolvedQueryTableKey`, which requires the declared `key:` column — A3 needs the
 * domain for an `args` predicate on ANY column of an owner table (the owner column is
 * usually not the key column), so it matches on table identity + owner-ness.
 */
export function resolvedQueryOwnerTableDomain(
  key: { key: string; tableIdentifier: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  for (const table of tables.get(key.tableIdentifier) ?? []) {
    if (
      isDomainExtractedTableAnnotation(table.annotation) &&
      typeof table.annotation.owner === 'string'
    ) {
      return table.annotation.domain;
    }
  }

  return null;
}

/**
 * Resolve a `tableIdentifier.column` reference to its domain regardless of which
 * column is named (SPEC §10.1). Contrast `resolvedQueryTableKey`, which requires the
 * declared `key:` column — used for session-anchoring detection on any domain table
 * column (matching prior declared-key behavior, now column-agnostic).
 */
export function resolvedQueryTableDomain(
  key: { key: string; tableIdentifier: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  for (const table of tables.get(key.tableIdentifier) ?? []) {
    if (isDomainExtractedTableAnnotation(table.annotation)) {
      return table.annotation.domain;
    }
  }

  return null;
}

export function sessionAnchoredDomainFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  const candidates = [
    { sessionKey: right.sessionKey, tableKey: left.tableKey },
    { sessionKey: left.sessionKey, tableKey: right.tableKey },
  ];

  for (const candidate of candidates) {
    if (!candidate.sessionKey || !candidate.tableKey) continue;
    // SPEC §11.1 (A3 symmetry): match on table identity, ANY column — not only the
    // declared `key:` column. An owner table is usually keyed `key:id, owner:userId`,
    // and the safe pattern `where(eq(orders.userId, req.session.userId))` anchors the
    // OWNER column to the session, so the declared-key-only check missed it and the
    // read fell through to the `args` IDOR branch (a false KV414 on a safe app).
    const domain = resolvedQueryTableDomain(candidate.tableKey, tables);
    if (domain) return domain;
  }

  return null;
}

/**
 * SPEC §11.1 / KV414: the `where()`-predicate `eq(...)` operand comparisons of a query.
 *
 * Two tiers, both reusing the write side's `eqPredicateConjuncts` (~:9736):
 * - `instanceKey`: top-level/`and(...)` conjuncts only — these may discharge a unique
 *   single-row instance key and a `session` scope.
 * - `argCandidates`: every `eq(...)` operand pair anywhere in the predicate tree,
 *   INCLUDING under `or(...)` (A2, fail-closed). An arg-keyed owner operand in any
 *   branch is an `args`-scope candidate that must surface KV414, but an `or`-branch
 *   does NOT pin a row, so these never discharge an instance key.
 */
export function queryInstanceKeyComparisons(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier?: (node: Node) => string | undefined,
): QueryInstanceKeyComparisons {
  const instanceKey: QueryInstanceKeyComparison[] = [];
  const argCandidates: QueryInstanceKeyComparison[] = [];
  const sessionContext = sessionProvenanceContextForNodes(
    body.getSourceFile(),
    queryCallbackBodies(body, queryReceiverMode(receiverReferences)),
  );

  for (const predicate of queryBodyCallExpressions(
    body,
    queryReceiverMode(receiverReferences),
    (call) => {
      if (propertyAccessCallName(call) !== 'where') return [];
      if (!isQueryCallOnReceiver(call, receiverReferences)) return [];
      const argument = call.getArguments()[0];
      return argument ? [argument] : [];
    },
  )) {
    const toComparison = ({ left, right }: EqPredicateConjunct): QueryInstanceKeyComparison => ({
      left: queryInstanceKeyOperand(left, readTableIdentifier, sessionContext),
      right: queryInstanceKeyOperand(right, readTableIdentifier, sessionContext),
    });

    // A2: `and(...)`/top-level `eq` conjuncts may discharge a unique instance key.
    const conjuncts = eqPredicateConjuncts(predicate);
    if (conjuncts) instanceKey.push(...conjuncts.map(toComparison));

    // A2 fail-closed: any `eq` operand anywhere (incl. `or(...)` branches) is an
    // `args`/`session` scope candidate, never an instance-key.
    argCandidates.push(...allEqOperandPairs(predicate).map(toComparison));
  }

  return { argCandidates, instanceKey };
}

export interface QueryInstanceKeyComparisons {
  argCandidates: readonly QueryInstanceKeyComparison[];
  instanceKey: readonly QueryInstanceKeyComparison[];
}

/**
 * Every `eq(...)` operand pair nested anywhere under a predicate node (SPEC §11.1,
 * KV414 fail-closed). Used only for `args`/`session` scope candidacy — `or(...)`
 * branches are included here but must never discharge an instance key.
 */
export function allEqOperandPairs(predicate: Node): EqPredicateConjunct[] {
  return pnfAllEqOperandPairs(predicatePnf(predicate));
}

export function queryInstanceKeyOperand(
  expression: Node,
  readTableIdentifier?: (node: Node) => string | undefined,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): QueryInstanceKeyOperand {
  return {
    ...queryTableKeyOperand(expression, readTableIdentifier),
    ...queryInputKeyOperand(expression),
    ...queryPrivateScopeKeyOperand(expression, sessionContext),
  };
}

/**
 * Detects private-scope predicate operands (SPEC §11.1): static session/tenant/
 * guard access or a same-package helper with an explicit analyzer summary. Private
 * values participate in proof but are erased from client-visible keys.
 */
export function queryPrivateScopeKeyOperand(
  expression: Node,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): Pick<QueryInstanceKeyOperand, 'privateKey' | 'sessionKey'> {
  const provenance = privateScopeForExpression(expression, sessionContext);
  if (!provenance) return {};
  return {
    privateKey: privateScopeKey(provenance),
    ...(provenance.kind === 'session' ? { sessionKey: provenance.path } : {}),
  };
}

export function queryTableKeyOperand(
  expression: Node,
  readTableIdentifier?: (node: Node) => string | undefined,
): Pick<QueryInstanceKeyOperand, 'tableKey'> {
  const key = staticAccessName(expression);
  const tableIdentifier = staticExpressionPath(
    staticAccessExpression(expression),
    readTableIdentifier,
  );
  if (!tableIdentifier || !key) return {};

  return {
    tableKey: {
      key,
      tableIdentifier,
    },
  };
}

export function queryInputKeyOperand(expression: Node): Pick<QueryInstanceKeyOperand, 'inputKey'> {
  const node = staticAccessExpression(expression);
  if (!Node.isIdentifier(node) || node.getText() !== 'input') return {};

  const key = staticAccessName(expression);
  return key ? { inputKey: `arg:${key}` } : {};
}

export function compositeQueryInstanceKey(
  comparisons: readonly QueryInstanceKeyComparison[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  for (const [tableIdentifier, tableEntries] of tables) {
    for (const table of tableEntries) {
      if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
      if (typeof table.annotation.key !== 'string') continue;

      const keyColumns = tableKeyColumns(table.annotation.key);
      const valuesByColumn = new Map<string, string>();
      for (const comparison of comparisons) {
        const candidate = valueKeyForTableColumnComparison(comparison, tableIdentifier);
        if (!candidate || !keyColumns.includes(candidate.column)) continue;
        valuesByColumn.set(candidate.column, candidate.valueKey);
      }
      if (!keyColumns.every((column) => valuesByColumn.has(column))) continue;

      const publicKeys = keyColumns
        .map((column) => valuesByColumn.get(column))
        .filter((valueKey): valueKey is string => valueKey !== undefined)
        .filter((valueKey) => !isPrivateScopeKey(valueKey));
      if (publicKeys.length === 0) continue;

      return { instanceKey: { domain: table.annotation.domain, key: publicKeys.join(',') } };
    }
  }

  return null;
}

export function valueKeyForTableColumnComparison(
  comparison: QueryInstanceKeyComparison,
  tableIdentifier: string,
): { column: string; valueKey: string } | null {
  const candidates = [
    { tableKey: comparison.left.tableKey, value: comparison.right },
    { tableKey: comparison.right.tableKey, value: comparison.left },
  ];

  for (const candidate of candidates) {
    if (!candidate.tableKey || candidate.tableKey.tableIdentifier !== tableIdentifier) continue;
    const valueKey = candidate.value.inputKey ?? candidate.value.privateKey;
    if (!valueKey) continue;
    return { column: candidate.tableKey.key, valueKey };
  }

  return null;
}

export function directSummaryForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): FunctionTouchSummary {
  const reads: ReadSummaryInput[] = [];
  const writes: WriteSummaryInput[] = [];
  const unresolved: UnresolvedSummaryInput[] = [];
  const triggerTables = triggerTableNamesFromSource(file.source);

  // SPEC §11.1: visible Drizzle read surfaces belong in the touch graph, not KV406.
  for (const call of fn.readCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptExtractedTableAnnotation(table.annotation)) continue;
        if (isUnmappedTableAnnotation(table.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: call.operation,
            site,
          });
          continue;
        }
        reads.push({
          operation: call.operation,
          site,
          table: table.annotation,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  for (const call of fn.writeCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    appendReadSourceSummaries(reads, unresolved, call, site, tables, unresolvedIdentifiers);

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptExtractedTableAnnotation(table.annotation)) continue;
        if (isUnmappedTableAnnotation(table.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: call.operation,
            site,
          });
          continue;
        }
        const writePredicate = predicateSummaryFromFacts(
          call.predicateFacts,
          call.tableExpression,
          table.annotation,
        );
        writes.push({
          operation: call.operation,
          site,
          table: table.annotation,
          ...(writePredicate.predicate ? { predicate: writePredicate.predicate } : {}),
          ...(writePredicate.key ? { writeKey: writePredicate.key } : {}),
        });
        appendForeignKeyCascadeWriteSummaries(writes, call, site, table.annotation, tables);
        appendDeclaredFanOutWriteSummaries(writes, call, site, table.annotation);
        appendMissingTriggerFanOutDiagnostics(
          unresolved,
          call,
          site,
          table.annotation,
          triggerTables,
        );
      }
      if (unresolvedIdentifiers.has(call.tableExpression)) {
        unresolved.push({
          operation: call.operation,
          site,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  for (const call of fn.unresolvedCalls) {
    unresolved.push({
      operation: call.name,
      site: `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`,
    });
  }

  return { reads, unresolved, writes };
}

export function materializedViewRefreshFactsForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): MaterializedViewRefreshFact[] {
  const facts: MaterializedViewRefreshFact[] = [];

  for (const call of fn.writeCalls) {
    if (call.operation !== 'refreshMaterializedView') continue;

    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    for (const table of tables.get(call.tableExpression) ?? []) {
      const annotation = table.annotation;
      if (!isAsyncMaterializedViewAnnotation(annotation)) continue;

      facts.push({
        domain: annotation.domain,
        mutation: fn.name,
        optimisticStatus: 'await-fragment',
        refresh: 'async',
        site,
        view: annotation.name,
      });
    }
  }

  return facts;
}

export function isAsyncMaterializedViewAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is KovoDomainTableAnnotation & {
  name: string;
  relation: 'materialized-view';
  refresh: 'async';
} {
  return (
    'domain' in annotation &&
    'relation' in annotation &&
    annotation.relation === 'materialized-view' &&
    annotation.refresh === 'async'
  );
}

export function appendReadSourceSummaries(
  reads: ReadSummaryInput[],
  unresolved: UnresolvedSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): void {
  // SPEC §11.1: insert-select/update-from reads are independently visible even when the write
  // target itself is opaque and must degrade to KV406.
  for (const readSource of call.readSources) {
    const readTables = tables.get(readSource.tableExpression) ?? [];
    if (readTables.length > 0) {
      for (const readTable of readTables) {
        if (isExemptExtractedTableAnnotation(readTable.annotation)) continue;
        if (isUnmappedTableAnnotation(readTable.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: readSource.operation,
            site,
          });
          continue;
        }
        const readPredicate = predicateSummaryFromFacts(
          call.predicateFacts,
          readSource.tableExpression,
          readTable.annotation,
        );
        reads.push({
          operation: readSource.operation,
          ...(readPredicate.predicate ? { predicate: readPredicate.predicate } : {}),
          ...(readPredicate.key ? { readKey: readPredicate.key } : {}),
          site,
          table: readTable.annotation,
        });
      }
      if (unresolvedIdentifiers.has(readSource.tableExpression)) {
        unresolved.push({
          operation: readSource.operation,
          site,
        });
      }
      continue;
    }

    unresolved.push({
      operation: readSource.operation,
      site,
    });
  }
}

export function appendForeignKeyCascadeWriteSummaries(
  writes: WriteSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  parentTable: ExtractedTableAnnotation,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): void {
  if (!isDomainExtractedTableAnnotation(parentTable)) return;

  const action =
    call.operation === 'delete' ? 'onDelete' : call.operation === 'update' ? 'onUpdate' : null;
  if (!action) return;

  // SPEC §11.1 (part-4 D2): a CASCADE child is itself deleted/updated, so the DB
  // re-fires that child's own referential actions — the fan-out is a transitive
  // closure, not one hop. `set null`/`set default` are terminal (the row is mutated,
  // not deleted, so it does not re-trigger its own ON DELETE cascades). `walked`
  // guards FK cycles (the parent is pre-seeded since its own touch is emitted by the
  // caller); `emitted` dedupes touches across diamond/cycle fan-out paths.
  const walked = new Set<KovoDomainTableAnnotation & { name: string }>([parentTable]);
  const emitted = new Set<KovoDomainTableAnnotation & { name: string }>([parentTable]);
  let frontier: (KovoDomainTableAnnotation & { name: string })[] = [parentTable];

  while (frontier.length > 0) {
    const next: (KovoDomainTableAnnotation & { name: string })[] = [];

    for (const ancestor of frontier) {
      for (const entries of tables.values()) {
        for (const childTable of entries) {
          if (!isDomainExtractedTableAnnotation(childTable.annotation)) continue;

          for (const foreignKey of childTable.foreignKeys ?? []) {
            const foreignKeyAction =
              action === 'onDelete' ? foreignKey.onDelete : foreignKey.onUpdate;
            if (!isTouchingForeignKeyAction(foreignKeyAction)) continue;
            if (!foreignKeyTargetsTable(foreignKey, ancestor, tables)) continue;

            if (!emitted.has(childTable.annotation)) {
              emitted.add(childTable.annotation);
              writes.push({
                operation: `${call.operation}-${foreignKeyAction}`,
                site,
                table: childTable.annotation,
              });
            }

            // Only a `cascade` child re-fires its own referential actions (the row is
            // deleted/updated and triggers further cascades). Walk each child once.
            if (foreignKeyAction === 'cascade' && !walked.has(childTable.annotation)) {
              walked.add(childTable.annotation);
              next.push(childTable.annotation);
            }
          }
        }
      }
    }

    frontier = next;
  }
}

export function isTouchingForeignKeyAction(action: string | undefined): action is string {
  return action === 'cascade' || action === 'set null' || action === 'set default';
}

export function foreignKeyTargetsTable(
  foreignKey: ExtractedForeignKey,
  parentTable: KovoDomainTableAnnotation & { name: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): boolean {
  return (tables.get(foreignKey.targetTableExpression) ?? []).some(
    (targetTable) =>
      isDomainExtractedTableAnnotation(targetTable.annotation) &&
      targetTable.annotation.name === parentTable.name,
  );
}

export function appendDeclaredFanOutWriteSummaries(
  writes: WriteSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  table: ExtractedTableAnnotation,
): void {
  if (!isDomainExtractedTableAnnotation(table)) return;

  for (const fan of fanAnnotationsForOperation(table, call.operation)) {
    writes.push({
      operation: `${call.operation}-fan`,
      site,
      table: {
        domain: fan.domain,
        name: typeof fan.via === 'string' ? fan.via : fan.domain,
      },
    });
  }
}

export function appendMissingTriggerFanOutDiagnostics(
  unresolved: UnresolvedSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  table: ExtractedTableAnnotation,
  triggerTables: ReadonlySet<string>,
): void {
  if (!isDomainExtractedTableAnnotation(table)) return;
  if (!triggerTables.has(table.name)) return;
  if (fanAnnotationsForOperation(table, call.operation).length > 0) return;

  unresolved.push({
    code: 'KV413',
    domain: table.domain,
    operation: 'trigger-fan-out',
    site,
  });
}

export function fanAnnotationsForOperation(
  table: KovoDomainTableAnnotation & { name: string },
  operation: string,
): readonly KovoFanAnnotation[] {
  if (operation !== 'delete' && operation !== 'insert' && operation !== 'update') return [];
  return (table.fans ?? []).filter((fan) => fan.when === undefined || fan.when === operation);
}

export function triggerTableNamesFromSource(source: string): ReadonlySet<string> {
  const tables = new Set<string>();
  const triggerPattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER[\s\S]*?\bON\s+("?)([A-Za-z_][\w]*)\1/gi;

  for (const match of source.matchAll(triggerPattern)) {
    const table = match[2];
    if (table) tables.add(table);
  }

  return tables;
}

export function functionTouchSummariesForFile(
  file: SourceFileInput,
  functions: readonly ExtractedFunction[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): Map<string, FunctionTouchSummary> {
  const functionsByKey = new Map(functions.map((fn) => [fn.key, fn]));
  const callsByKey = new Map(
    functions.map((fn) => [fn.key, fn.localCalls.filter((call) => functionsByKey.has(call))]),
  );
  const summaries = new Map(
    functions.map((fn) => [
      fn.key,
      directSummaryForFunction(fn, file, tables, unresolvedIdentifiers),
    ]),
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (const fn of functions) {
      const summary = summaries.get(fn.key);
      if (!summary) continue;

      for (const call of callsByKey.get(fn.key) ?? []) {
        const calleeSummary = summaries.get(call);
        if (!calleeSummary) continue;

        if (mergeSummary(summary, calleeSummary)) changed = true;
      }
    }
  }

  return summaries;
}

export function mergeSummary(target: FunctionTouchSummary, source: FunctionTouchSummary): boolean {
  let changed = false;

  changed =
    pushUnique(
      target.rawTables ?? (target.rawTables = []),
      source.rawTables ?? [],
      (table) => table,
    ) || changed;
  changed = pushUnique(target.reads, source.reads, readSummaryKey) || changed;
  changed = pushUnique(target.unresolved, source.unresolved, unresolvedSummaryKey) || changed;
  changed = pushUnique(target.writes, source.writes, writeSummaryKey) || changed;

  return changed;
}

export function pushUnique<T>(target: T[], source: readonly T[], keyFor: (item: T) => string): boolean {
  const keys = new Set(target.map(keyFor));
  let changed = false;

  for (const item of source) {
    const key = keyFor(item);
    if (keys.has(key)) continue;

    keys.add(key);
    target.push(item);
    changed = true;
  }

  return changed;
}

export function readSummaryKey(read: ReadSummaryInput): string {
  return [
    read.operation,
    read.table.name,
    read.site,
    read.readKey ?? '',
    read.predicate ?? '',
    read.branch ?? '',
  ].join('\0');
}

export function unresolvedSummaryKey(unresolved: UnresolvedSummaryInput): string {
  return [
    unresolved.code ?? '',
    unresolved.operation,
    unresolved.site,
    unresolved.domain ?? '',
  ].join('\0');
}

export function writeSummaryKey(write: WriteSummaryInput): string {
  return [
    write.operation,
    write.table.name,
    write.site,
    write.writeKey ?? '',
    write.predicate ?? '',
    write.branch ?? '',
  ].join('\0');
}

export function extractReadSourcesFromWriteChain(
  chain: Node,
  operation: string,
  tableExpressionText: (node: Node) => string,
): ExtractedReadSource[] {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const hasInsertSelect =
    operation === 'insert' && calls.some((call) => propertyAccessCallName(call) === 'select');
  const sources: ExtractedReadSource[] = [];

  for (const call of calls) {
    if (!isReadSourceCall(call)) continue;
    const sourceOperation = writeReadSourceOperation(call, chain, operation);
    if (!sourceOperation) continue;

    const tableArgument = call.getArguments()[0];
    const tableExpression = tableArgument ? tableExpressionText(tableArgument) : '';

    sources.push({
      operation: sourceOperation,
      tableExpression: tableExpression || UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  // SPEC §10-§11: an opaque write read source is visible as KV406, not guessed.
  return sources.length > 0 || !hasInsertSelect
    ? sources
    : [{ operation: 'insert-select', tableExpression: UNRESOLVED_READ_SOURCE_EXPRESSION }];
}

export function writeReadSourceOperation(
  call: CallExpression,
  chain: Node,
  operation: string,
): ExtractedReadSource['operation'] | undefined {
  if (operation === 'insert') {
    return callExpressionsInNode(chain).some(
      (candidate) => propertyAccessCallName(candidate) === 'select',
    )
      ? 'insert-select'
      : undefined;
  }

  // SPEC §11.1: drizzle Postgres `delete()` has no `.from()`/`.using()` chain method (PgDeleteBase
  // exposes only where/returning), so a `from(R)` descended from a delete chain is necessarily
  // inside a `.where()` predicate subquery and contributes R to the READ set as a `delete-predicate`
  // source instead of being silently dropped.
  if (operation === 'delete') {
    return callExpressionContinuesToChain(call, chain) ? undefined : 'delete-predicate';
  }

  if (operation !== 'update') return undefined;
  return callExpressionContinuesToChain(call, chain) ? 'update-from' : 'update-predicate';
}

export function callExpressionContinuesToChain(call: CallExpression, chain: Node): boolean {
  let current: Node = call;

  while (current !== chain) {
    const parent = current.getParent();
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === current) {
      current = parent;
      continue;
    }
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === current) {
      current = parent;
      continue;
    }
    return false;
  }

  return true;
}

export function isReadSourceCall(call: CallExpression): boolean {
  const name = propertyAccessCallName(call);
  return (
    name === 'from' ||
    name === 'join' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

export function propertyAccessCallName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  return staticAccessName(expression);
}

export function staticAccessName(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;

  const argument = node.getArgumentExpression();
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralText();
  }
  if (Node.isNumericLiteral(argument)) return argument.getText();
  return undefined;
}

export function staticAccessExpression(node: Node): Node | undefined {
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return node.getExpression();
  }
  return undefined;
}

export function predicateSummaryFromFacts(
  facts: readonly ExtractedPredicateFact[],
  tableIdentifier: string,
  table: KovoDomainTableAnnotation,
): ExtractedPredicateSummary {
  if (typeof table.key !== 'string') return {};

  const keyColumns = tableKeyColumns(table.key);
  const keyFacts = keyColumns.map((key) =>
    facts.find((fact) => fact.tableIdentifier === tableIdentifier && fact.key === key),
  );
  const argumentKeys = keyFacts.map((fact) => fact?.argumentKey);
  if (
    argumentKeys.length === keyColumns.length &&
    argumentKeys.every((argumentKey): argumentKey is string => argumentKey !== undefined)
  ) {
    const publicArgumentKeys = argumentKeys.filter(
      (argumentKey) => !isPrivateScopeKey(argumentKey),
    );
    return publicArgumentKeys.length > 0 ? { key: publicArgumentKeys.join(',') } : {};
  }

  return keyFacts.some((fact) => fact?.predicate === 'non-eq') ? { predicate: 'non-eq' } : {};
}

export function isPrivateScopeKey(key: string): boolean {
  return key.startsWith('guard:') || key.startsWith('session:') || key.startsWith('tenant:');
}

export function tableKeyColumns(key: string): string[] {
  return key
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
}

export function extractPredicateFactsFromWriteChain(
  chain: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string> = new Set(),
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): ExtractedPredicateFact[] {
  const facts: ExtractedPredicateFact[] = [];
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const whereCall = calls.find((call) => propertyAccessCallName(call) === 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return facts;
  const pnf = predicatePnf(predicate);

  const parameterizedKeys = extractParameterizedKeys(
    pnf,
    resolveIdentifier,
    paramSymbolKeys,
    sessionContext,
  );
  facts.push(...parameterizedKeys);

  if (!pnfExactConjuncts(pnf)) {
    for (const reference of tableKeyReferences(predicate, resolveIdentifier)) {
      facts.push({ ...reference, predicate: 'non-eq' });
    }
  }

  return dedupePredicateFacts(facts);
}

/**
 * Classify a write chain's `where()` predicate operands the same way as a query read
 * (SPEC §10.3, KV414 A1/A2/A3). Reuses `eqPredicateConjuncts` (`and()`/top-level →
 * instance-key/`session` candidates) and `allEqOperandPairs` (every `eq` operand,
 * incl. `or()` branches → fail-closed `args` candidates), with the same
 * `input.*`/`req.session.*`/table-column operand classifier the read side uses — so a
 * write keyed by a client arg against an owner table emits a `kind:'write'` scope
 * audit (the write half of KV414 the framework previously never produced).
 */
export function writeInstanceKeyComparisons(
  chain: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): QueryInstanceKeyComparisons {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const whereCall = calls.find((call) => propertyAccessCallName(call) === 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return { argCandidates: [], instanceKey: [] };
  const pnf = predicatePnf(predicate);

  const toComparison = ({ left, right }: EqPredicateConjunct): QueryInstanceKeyComparison => ({
    left: queryInstanceKeyOperand(left, resolveIdentifier, sessionContext),
    right: queryInstanceKeyOperand(right, resolveIdentifier, sessionContext),
  });

  return {
    argCandidates: pnfAllEqOperandPairs(pnf).map(toComparison),
    instanceKey: (pnfExactConjuncts(pnf) ?? []).map(toComparison),
  };
}

export function extractParameterizedKeys(
  pnf: PredicatePnf,
  resolveIdentifier?: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string> = new Set(),
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): ExtractedPredicateFact[] {
  const conjuncts = pnfExactConjuncts(pnf);
  if (!conjuncts) return [];

  const facts: ExtractedPredicateFact[] = [];
  for (const { left, right } of conjuncts) {
    const leftKey = tableKeyReference(left, resolveIdentifier);
    const rightArgument = argumentKey(right, paramSymbolKeys, sessionContext);
    if (leftKey) {
      facts.push(
        rightArgument
          ? { ...leftKey, argumentKey: rightArgument }
          : { ...leftKey, predicate: 'non-eq' },
      );
      continue;
    }

    const rightKey = tableKeyReference(right, resolveIdentifier);
    const leftArgument = argumentKey(left, paramSymbolKeys, sessionContext);
    if (rightKey) {
      facts.push(
        leftArgument
          ? { ...rightKey, argumentKey: leftArgument }
          : { ...rightKey, predicate: 'non-eq' },
      );
    }
  }

  return facts;
}

export interface EqPredicateConjunct {
  left: Node;
  right: Node;
}

export type PredicatePnf =
  | { expr: string; kind: 'and'; nodes: readonly PredicatePnf[] }
  | { kind: 'eq'; left: Node; right: Node }
  | { expr: string; kind: 'opaque' }
  | { expr: string; kind: 'or'; nodes: readonly PredicatePnf[] };

export function predicatePnf(node: Node): PredicatePnf {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return { expr: expression.getText(), kind: 'opaque' };

  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee)) return { expr: expression.getText(), kind: 'opaque' };
  const name = callee.getText();

  if (name === 'and' || name === 'or') {
    return {
      expr: expression.getText(),
      kind: name,
      nodes: expression.getArguments().map((argument) => predicatePnf(argument)),
    };
  }

  if (name !== 'eq') return { expr: expression.getText(), kind: 'opaque' };
  const [left, right] = expression.getArguments();
  return left && right
    ? { kind: 'eq', left, right }
    : { expr: expression.getText(), kind: 'opaque' };
}

export function pnfExactConjuncts(pnf: PredicatePnf): EqPredicateConjunct[] | null {
  if (pnf.kind === 'eq') return [{ left: pnf.left, right: pnf.right }];
  if (pnf.kind === 'and') {
    const conjuncts: EqPredicateConjunct[] = [];
    for (const child of pnf.nodes) {
      const nested = pnfExactConjuncts(child);
      if (!nested) return null;
      conjuncts.push(...nested);
    }
    return conjuncts;
  }
  return null;
}

export function eqPredicateConjuncts(node: Node): EqPredicateConjunct[] | null {
  return pnfExactConjuncts(predicatePnf(node));
}

export function pnfAllEqOperandPairs(pnf: PredicatePnf): EqPredicateConjunct[] {
  if (pnf.kind === 'eq') return [{ left: pnf.left, right: pnf.right }];
  if (pnf.kind === 'and' || pnf.kind === 'or') return pnf.nodes.flatMap(pnfAllEqOperandPairs);
  return [];
}

export function tableKeyReferences(
  node: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact[] {
  const references: ExtractedPredicateFact[] = [];
  const ownReference = tableKeyReference(node, resolveIdentifier);
  if (ownReference) references.push(ownReference);

  for (const descendant of node.getDescendants()) {
    const reference = tableKeyReference(descendant, resolveIdentifier);
    if (reference) references.push(reference);
  }

  return dedupePredicateFacts(references);
}

export function tableKeyReference(
  node: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact | undefined {
  const path = staticExpressionPath(node, resolveIdentifier);
  if (!path) return undefined;

  const keyStart = path.lastIndexOf('.');
  if (keyStart <= 0 || keyStart === path.length - 1) return undefined;

  return {
    key: path.slice(keyStart + 1),
    tableIdentifier: path.slice(0, keyStart),
  };
}

export function dedupePredicateFacts(facts: readonly ExtractedPredicateFact[]): ExtractedPredicateFact[] {
  const seen = new Set<string>();
  const deduped: ExtractedPredicateFact[] = [];

  for (const fact of facts) {
    const key = [fact.tableIdentifier, fact.key, fact.argumentKey ?? '', fact.predicate ?? ''].join(
      '\0',
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }

  return deduped;
}

export function argumentKey(
  expression: Node,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): string | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  const provenance = privateScopeForExpression(node, sessionContext);
  if (provenance) return privateScopeKey(provenance);

  if (Node.isIdentifier(node)) {
    const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
    return symbolKey && paramSymbolKeys.has(symbolKey) ? `arg:${node.getText()}` : undefined;
  }
  if (!Node.isPropertyAccessExpression(node)) return undefined;

  const base = unwrappedStaticExpressionNode(node.getExpression());
  if (!Node.isIdentifier(base)) return undefined;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(base));
  if (!symbolKey || !paramSymbolKeys.has(symbolKey)) return undefined;

  return `arg:${node.getName()}`;
}

