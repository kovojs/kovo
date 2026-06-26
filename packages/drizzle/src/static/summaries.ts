import { diagnosticDefinitionText, diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type { KovoDomainTableAnnotation, KovoFanAnnotation } from '../drizzle-surface.js';
import type {
  ReadSummaryInput,
  TouchGraphDiagnostic,
  UnresolvedSummaryInput,
  WriteSummaryInput,
} from '../graph.js';
import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type BindingElement,
  type CallExpression,
  type FunctionExpression,
  type ObjectLiteralExpression,
  type SourceFile,
  type VariableDeclaration,
} from 'ts-morph';
import {
  isQueryReceiverIdentifier,
  queryCallbackBodies,
  staticAccessSegments,
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
  type OwnerPrivateScopeKey,
  type OwnerScopeKey,
  type QueryFact,
  type QueryInstanceKeyComparison,
  type QueryInstanceKeyOperand,
  type QueryReceiverReferences,
  type QueryShape,
  type PrivateScopeProvenance,
  type SessionProvenanceContext,
  type SourceFileInput,
  type UnmodeledRelationFact,
  KV411_MESSAGE,
  UNRESOLVED_READ_SOURCE_EXPRESSION,
  isDomainExtractedTableAnnotation,
  isExemptExtractedTableAnnotation,
  isRestBindingElement,
  isUnmappedTableAnnotation,
  lineForIndex,
  propertyNameText,
  resolvedSymbolKey,
  unmodeledRelationFromExpression,
} from '../static.js';

/** @internal */ export function queryReadDomains(
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

/** @internal */ export function exemptQueryReadDiagnostics(
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

/**
 * SPEC §10.2/§11.1: an opaque/raw query read that takes the declared-opaque-read escape — it
 * declares an `output` schema AND a `reads:` set (so the generic "unclassified Drizzle receiver"
 * KV406 is suppressed) — but whose `reads:` resolves to NO invalidation domain has an empty folded
 * read set: no write can ever invalidate it (silent staleness). This is the fully-raw case
 * (`db.execute(sql`…`)` with no analyzable builder, or a `reads:` naming only unmapped tables /
 * non-domain values). SPEC §10.2 — "a KV410 projection with no `reads:` declaration is itself a
 * KV410 error" — and a `reads:` that resolves to no domain is no usable declaration. Require a
 * resolvable, non-empty read set; otherwise the seam stays invisible to invalidation.
 *
 * KV411 (an exempt `reads:` entry) is the more specific diagnostic for an exempt table, so callers
 * suppress this KV410 when the exempt check already fired.
 *
 * @internal
 */
export function opaqueReadWithoutResolvableReadsDiagnostics(
  query: string,
  hasOutputSchema: boolean,
  declaredReadExpressions: readonly string[],
  declaredReadDomains: readonly string[],
  resolvedReads: readonly string[],
  site: string,
): TouchGraphDiagnostic[] {
  const declaredOpaqueRead =
    hasOutputSchema && (declaredReadExpressions.length > 0 || declaredReadDomains.length > 0);
  if (!declaredOpaqueRead || resolvedReads.length > 0) return [];

  const definition = diagnosticDefinitions.KV410;
  const message = diagnosticDefinitionText('KV410', { preferHelp: true });
  return [
    {
      code: 'KV410',
      message: `${message} ${query} declares an opaque read whose reads: set resolves to no invalidation domain; declare a resolvable reads: domain set so the read folds into the query read set (§11.1).`,
      severity: definition.severity,
      site,
    },
  ];
}

/** @internal */ export function unmodeledRelationReadDiagnostics(
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

/** @internal */ export function queryTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): string[] {
  return [
    ...queryJoinTableExpressions(body, receiverReferences, options.readTableIdentifier),
    ...queryRelationalTableExpressions(body, receiverReferences, options.relationalTableName),
  ];
}

/** @internal */ export interface QueryReadResolutionOptions {
  readTableIdentifier?: (node: Node) => string | undefined;
  relationalTableName?: (name: string) => string | undefined;
}

/** @internal */ export function queryJoinTableExpressions(
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

/** @internal */ export function queryRelationalTableExpressions(
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

/** @internal */ export function unresolvedQueryReadDiagnostics(
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

/** @internal */ export function unresolvedRelationalQueryReadDiagnostics(
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

/** @internal */ export function queryBodyCallExpressions<T>(
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

/** @internal */ export function queryReceiverMode(
  receiverReferences: QueryReceiverReferences,
): 'project' | 'source' {
  return receiverReferences.projectContainers ? 'project' : 'source';
}

/** @internal */ export function isQueryCallOnReceiver(
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
): boolean {
  // SPEC §11.1: read facts must originate from the Drizzle receiver, not lookalike builders.
  const receiver = queryCallChainReceiver(call);
  return isQueryReceiverIdentifier(receiver, receiverReferences);
}

/** @internal */ export function queryCallChainReceiver(call: CallExpression): Node | undefined {
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
/** @internal */ export function writeCallChainReceiver(
  receiver: Node | undefined,
): Node | undefined {
  let current = receiver;

  while (current && Node.isCallExpression(current)) {
    if (staticAccessName(current.getExpression()) !== 'with') break;
    current = staticAccessExpression(current.getExpression());
  }

  return current;
}

/** @internal */ export function callSourceOrder(call: CallExpression): number {
  const expression = call.getExpression();
  return Node.isPropertyAccessExpression(expression)
    ? expression.getNameNode().getStart()
    : call.getStart();
}

/** @internal */ export function isQueryReadCallName(name: string): boolean {
  return (
    name === 'from' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

/** @internal */ export function isJoinReadCallName(name: string): boolean {
  return name === 'join' || isQueryReadCallName(name);
}

/** @internal */ export function staticExpressionPath(
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

/** @internal */ export function staticExpressionRootIdentifier(node: Node): Node | undefined {
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

/** @internal */ export function unwrappedStaticExpressionNode(node: Node): Node {
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

/** @internal */ export function unwrappedFunctionExpression(
  node: Node,
): ArrowFunction | FunctionExpression | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)
    ? expression
    : undefined;
}

/** @internal */ export function queryInstanceKey(
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
/** @internal */ export function querySessionAnchoredDomains(
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
 * Narrow Authorization-gates-DATA proof for owner-table reads (OPP-28): the owner
 * column itself must be compared against the matching session/principal private
 * symbol, e.g. `{ owner:userId }` with `eq(orders.userId, req.session.userId)`.
 * This is deliberately stricter than `querySessionAnchoredDomains`, which accepts a
 * session predicate on any column of the table.
 */
/** @internal */ export function queryOwnerSessionAnchoredDomains(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly string[] {
  const domains = new Set<string>();
  for (const scoped of queryOwnerPrivateScopedKeys(comparisons, tables)) {
    domains.add(scoped.domain);
  }
  return [...domains].sort();
}

/** @internal */ export function queryOwnerPrivateScopedKeys(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly OwnerPrivateScopeKey[] {
  const keys = new Map<string, OwnerPrivateScopeKey>();
  for (const comparison of comparisons.instanceKey) {
    const scoped = ownerPrivateScopedKeyFromEqOperands(comparison.left, comparison.right, tables);
    if (scoped) keys.set(`${scoped.domain}\0${scoped.privateKey}`, scoped);
  }
  return [...keys.values()].sort(
    (left, right) =>
      left.domain.localeCompare(right.domain) || left.privateKey.localeCompare(right.privateKey),
  );
}

function ownerPrivateScopedKeyFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): OwnerPrivateScopeKey | null {
  const candidates = [
    { privateKey: right.privateKey, tableKey: left.tableKey },
    { privateKey: left.privateKey, tableKey: right.tableKey },
  ];

  for (const candidate of candidates) {
    if (!candidate.privateKey || !candidate.tableKey) continue;
    const domain = resolvedQueryOwnerTableDomainForPrincipal(
      candidate.tableKey,
      candidate.privateKey,
      tables,
    );
    if (domain) return { domain, privateKey: candidate.privateKey };
  }

  return null;
}

function resolvedQueryOwnerTableDomainForPrincipal(
  key: { key: string; tableIdentifier: string },
  privateKey: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | null {
  for (const table of tables.get(key.tableIdentifier) ?? []) {
    if (
      !isDomainExtractedTableAnnotation(table.annotation) ||
      typeof table.annotation.owner !== 'string'
    ) {
      continue;
    }
    if (key.key !== table.annotation.owner) continue;
    if (!privateScopeMatchesOwner(privateKey, table.annotation.owner)) continue;
    return table.annotation.domain;
  }

  return null;
}

function privateScopeMatchesOwner(privateKey: string, owner: string): boolean {
  return privateKey === `session:${owner}` || privateKey === `guard:${owner}`;
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
/** @internal */ export function queryArgScopedDomains(
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

/** @internal */ export function queryArgScopedDomainKeys(
  comparisons: QueryInstanceKeyComparisons,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly OwnerScopeKey[] {
  const keys = new Map<string, OwnerScopeKey>();
  for (const comparison of comparisons.argCandidates) {
    for (const scoped of argScopedDomainKeysFromEqOperands(
      comparison.left,
      comparison.right,
      tables,
    )) {
      keys.set(`${scoped.domain}\0${scoped.key}`, scoped);
    }
  }
  return [...keys.values()].sort(
    (left, right) => left.domain.localeCompare(right.domain) || left.key.localeCompare(right.key),
  );
}

function argScopedDomainKeysFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): readonly OwnerScopeKey[] {
  const candidates = [
    { inputKey: right.inputKey, tableKey: left.tableKey },
    { inputKey: left.inputKey, tableKey: right.tableKey },
  ];

  const keys: OwnerScopeKey[] = [];
  for (const candidate of candidates) {
    if (!candidate.inputKey || !candidate.tableKey) continue;
    const domain = resolvedQueryOwnerTableDomain(candidate.tableKey, tables);
    if (domain) keys.push({ domain, key: candidate.inputKey });
  }

  return keys;
}

/**
 * SPEC §10.3 / KV414 (join-keyed bypass): true when any `eq(...)` operand pair in the
 * predicate tree (incl. `or(...)` branches) compares a TABLE COLUMN against a
 * client-visible `input.*` arg — regardless of which table the column belongs to
 * (owner or not). This is the arg-reachability signal `scopeAuditsFromQueryFacts` uses
 * to close the join-keyed IDOR bypass: an owner table joined into the read set, keyed
 * only through a non-owner table's `input.*` predicate, is still client-pivotable and
 * must fail closed. Contrast `queryArgScopedDomains`, which only fires when the arg key
 * lands on an OWNER table's own column.
 */
/** @internal */ export function queryHasClientArgPredicate(
  comparisons: QueryInstanceKeyComparisons,
): boolean {
  return comparisons.argCandidates.some(
    (comparison) =>
      eqOperandsAreTableColumnArgKeyed(comparison.left, comparison.right) ||
      eqOperandsAreTableColumnArgKeyed(comparison.right, comparison.left),
  );
}

function eqOperandsAreTableColumnArgKeyed(
  tableOperand: QueryInstanceKeyOperand,
  argOperand: QueryInstanceKeyOperand,
): boolean {
  return tableOperand.tableKey !== undefined && argOperand.inputKey !== undefined;
}

/** @internal */ export function argScopedDomainFromEqOperands(
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
/** @internal */ export function resolvedQueryOwnerTableDomain(
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
/** @internal */ export function resolvedQueryTableDomain(
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

/** @internal */ export function sessionAnchoredDomainFromEqOperands(
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
 * - `argCandidates`: every direct comparison operand pair anywhere in the predicate
 *   tree, INCLUDING under `or(...)` (A2, fail-closed), range predicates such as
 *   `gt/gte/lt/lte/between`, and negated membership. An arg-keyed owner operand in
 *   any branch is an `args`-scope candidate that must surface KV414, but an `or`-branch or
 *   non-equality comparison does NOT pin a row, so these never discharge an
 *   instance key or owner/principal session proof.
 */
/** @internal */ export function queryInstanceKeyComparisons(
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

    // A2 fail-closed: any direct comparison operand anywhere (incl. `or(...)`,
    // range predicates, and negated membership) is an `args`/`session` scope
    // candidate, never an instance-key.
    argCandidates.push(...allEqOperandPairs(predicate).map(toComparison));
  }

  return { argCandidates, instanceKey };
}

/** @internal */ export interface QueryInstanceKeyComparisons {
  argCandidates: readonly QueryInstanceKeyComparison[];
  instanceKey: readonly QueryInstanceKeyComparison[];
}

/**
 * Every direct comparison operand pair nested anywhere under a predicate node (SPEC
 * §11.1, KV414 fail-closed). Used only for `args` scope candidacy — `or(...)`
 * branches, non-equality/range comparisons, and negated membership are included
 * here but must never discharge an instance key or owner-principal session proof.
 */
/** @internal */ export function allEqOperandPairs(predicate: Node): EqPredicateConjunct[] {
  return pnfAllEqOperandPairs(predicatePnf(predicate));
}

/** @internal */ export function queryInstanceKeyOperand(
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
/** @internal */ export function queryPrivateScopeKeyOperand(
  expression: Node,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
): Pick<QueryInstanceKeyOperand, 'privateKey' | 'sessionKey'> {
  const provenance =
    privateScopeForExpression(expression, sessionContext) ??
    summarizedStaticCallPrivateScope(expression, sessionContext) ??
    conditionalExpressionPrivateScope(expression, sessionContext) ??
    binaryExpressionPrivateScope(expression, sessionContext);
  if (!provenance) {
    const tupleElement = localConstTupleElementPrivateScope(expression, sessionContext);
    if (tupleElement) {
      return {
        privateKey: privateScopeKey(tupleElement),
        ...(tupleElement.kind === 'session' ? { sessionKey: tupleElement.path } : {}),
      };
    }

    const destructuredTupleElement = localConstArrayBindingPrivateScope(expression, sessionContext);
    if (destructuredTupleElement) {
      return {
        privateKey: privateScopeKey(destructuredTupleElement),
        ...(destructuredTupleElement.kind === 'session'
          ? { sessionKey: destructuredTupleElement.path }
          : {}),
      };
    }

    const destructuredObjectProperty = localConstObjectBindingPrivateScope(
      expression,
      sessionContext,
    );
    if (destructuredObjectProperty) {
      return {
        privateKey: privateScopeKey(destructuredObjectProperty),
        ...(destructuredObjectProperty.kind === 'session'
          ? { sessionKey: destructuredObjectProperty.path }
          : {}),
      };
    }

    const constLiteralAccess = localConstLiteralAccessPrivateScope(expression, sessionContext);
    if (constLiteralAccess) {
      return {
        privateKey: privateScopeKey(constLiteralAccess),
        ...(constLiteralAccess.kind === 'session' ? { sessionKey: constLiteralAccess.path } : {}),
      };
    }

    const frozenScalar = localConstFrozenScalarPrivateScope(expression, sessionContext);
    if (frozenScalar) {
      return {
        privateKey: privateScopeKey(frozenScalar),
        ...(frozenScalar.kind === 'session' ? { sessionKey: frozenScalar.path } : {}),
      };
    }

    const staticScalar = localConstStaticScalarPrivateScope(expression, sessionContext);
    if (staticScalar) {
      return {
        privateKey: privateScopeKey(staticScalar),
        ...(staticScalar.kind === 'session' ? { sessionKey: staticScalar.path } : {}),
      };
    }

    // SPEC §11.1 / KV414 (minimal session-via-local tracing): recognize a session
    // value bound to a local const and then used in the scoping predicate, e.g.
    // `const uid = req.session.userId; …where(eq(orders.userId, uid))`. The shared
    // session-provenance alias table conservatively marks every alias `requiresGuard`,
    // so an alias of a NON-NULLABLE session access (no guard genuinely required) is
    // dropped and the read falls through to the `args`/IDOR branch — a false KV414 on
    // a properly-scoped app. Recover it here, fail-closed: only a DIRECT,
    // non-nullable session access discharges; a nullable session local still requires
    // (and is gated by) the dominating guard the shared tracer already enforces.
    const local = localBoundNonNullableSessionScope(expression);
    if (!local) return {};
    return { privateKey: `session:${local}`, sessionKey: local };
  }
  return {
    privateKey: privateScopeKey(provenance),
    ...(provenance.kind === 'session' ? { sessionKey: provenance.path } : {}),
  };
}

function localConstTupleElementPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isElementAccessExpression(node)) return undefined;

  const argument = node.getArgumentExpression();
  if (!Node.isNumericLiteral(argument)) return undefined;
  const index = Number(argument.getText());
  if (!Number.isInteger(index) || index < 0) return undefined;

  const base = unwrappedStaticExpressionNode(node.getExpression());
  if (!Node.isIdentifier(base)) return undefined;

  const symbol = symbolForIdentifierReference(base) ?? base.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = declaration.getInitializer();
  const tuple = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  if (!tuple || !Node.isArrayLiteralExpression(tuple)) return undefined;

  const value = tuple.getElements()[index];
  if (!value || Node.isSpreadElement(value)) return undefined;
  return staticWrapperValuePrivateScope(value, sessionContext);
}

function localConstArrayBindingPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isBindingElement(declaration)) return undefined;
  if (isRestBindingElement(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;
  if (declaration.getInitializer()) return undefined;

  const pattern = declaration.getParent();
  if (!Node.isArrayBindingPattern(pattern)) return undefined;
  const variable = pattern.getParent();
  if (!Node.isVariableDeclaration(variable)) return undefined;
  const declarationList = variable.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const index = pattern.getElements().findIndex((element) => element === declaration);
  if (index < 0) return undefined;

  const initializer = variable.getInitializer();
  const tuple = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  if (!tuple || !Node.isArrayLiteralExpression(tuple)) return undefined;

  const value = tuple.getElements()[index];
  if (!value || Node.isSpreadElement(value)) return undefined;
  return staticWrapperValuePrivateScope(value, sessionContext);
}

function localConstObjectBindingPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isBindingElement(declaration)) return undefined;
  if (isRestBindingElement(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;
  if (declaration.getInitializer()) return undefined;

  const binding = objectBindingPathAndVariable(declaration);
  if (!binding) return undefined;
  const { path, variable } = binding;
  const declarationList = variable.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = variable.getInitializer();
  const baseScope = initializer && staticWrapperValuePrivateScope(initializer, sessionContext);
  if (baseScope) {
    return {
      ...baseScope,
      path: appendPrivateScopePath(baseScope.path, path.join('.')),
    };
  }

  const object = initializer ? localConstLiteralRootValue(initializer) : undefined;
  if (!object || !Node.isObjectLiteralExpression(object)) return undefined;

  return objectLiteralStaticPathPrivateScope(object, path, sessionContext);
}

function objectBindingPathAndVariable(
  declaration: Node & { getNameNode(): Node },
): { path: string[]; variable: VariableDeclaration } | undefined {
  if (!Node.isBindingElement(declaration)) return undefined;
  const path: string[] = [];
  let element: BindingElement | undefined = declaration;

  while (element) {
    if (isRestBindingElement(element) || element.getInitializer()) return undefined;
    const propertyName = objectBindingPropertyName(element);
    if (!propertyName) return undefined;
    path.unshift(propertyName);

    const pattern = element.getParent();
    if (!Node.isObjectBindingPattern(pattern)) return undefined;
    const parent = pattern.getParent();
    if (Node.isVariableDeclaration(parent)) return { path, variable: parent };
    if (!Node.isBindingElement(parent)) return undefined;
    element = parent;
  }

  return undefined;
}

function localConstLiteralAccessPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const staticPropertyAccess = localConstLiteralStaticAccessPrivatePropertyScope(
    expression,
    sessionContext,
  );
  if (staticPropertyAccess) return staticPropertyAccess;

  const value = localConstLiteralStaticAccessValue(expression);
  if (!value) return undefined;
  return staticWrapperValuePrivateScope(value, sessionContext);
}

function localConstLiteralStaticAccessPrivatePropertyScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) {
    return undefined;
  }

  const property = staticAccessName(node);
  if (!property) return undefined;

  const baseValue = localConstLiteralStaticAccessValue(node.getExpression());
  if (!baseValue) return undefined;
  const provenance = staticWrapperValuePrivateScope(baseValue, sessionContext);
  if (!provenance) return undefined;

  return {
    ...provenance,
    path: appendPrivateScopePath(provenance.path, property),
  };
}

function appendPrivateScopePath(base: string, segment: string): string {
  return base.length === 0 ? segment : `${base}.${segment}`;
}

function localConstLiteralStaticAccessValue(expression: Node, depth = 0): Node | undefined {
  if (depth > 4) return undefined;
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) {
    return undefined;
  }

  const base = localConstLiteralStaticAccessBaseValue(node.getExpression(), depth + 1);
  if (!base) return undefined;
  const baseValue = localConstLiteralAliasValue(base) ?? base;
  if (Node.isObjectLiteralExpression(baseValue)) {
    const property = staticAccessName(node);
    return property ? objectLiteralSingleStaticPropertyValue(baseValue, property) : undefined;
  }
  if (!Node.isArrayLiteralExpression(baseValue) || !Node.isElementAccessExpression(node)) {
    return undefined;
  }

  const argument = node.getArgumentExpression();
  if (!Node.isNumericLiteral(argument)) return undefined;
  const index = Number(argument.getText());
  if (!Number.isInteger(index) || index < 0) return undefined;
  const value = baseValue.getElements()[index];
  return value && !Node.isSpreadElement(value) ? value : undefined;
}

function localConstFrozenScalarPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = declaration.getInitializer();
  const value = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  if (!value || !isObjectFreezeCall(value)) return undefined;

  const argument = singleObjectFreezeArgument(value);
  return argument ? staticWrapperValuePrivateScope(argument, sessionContext) : undefined;
}

function localConstStaticScalarPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = declaration.getInitializer();
  return initializer ? staticWrapperValuePrivateScope(initializer, sessionContext) : undefined;
}

function localConstLiteralStaticAccessBaseValue(expression: Node, depth: number): Node | undefined {
  if (depth > 4) return undefined;
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return localConstLiteralStaticAccessValue(node, depth + 1);
  }
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = declaration.getInitializer();
  const value = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  return literalStaticWrapperValue(value);
}

function localConstLiteralAliasValue(value: Node): Node | undefined {
  const node = unwrappedStaticExpressionNode(value);
  return Node.isIdentifier(node) ? localConstLiteralRootValue(node) : undefined;
}

function localConstLiteralRootValue(expression: Node): Node | undefined {
  const value = unwrappedStaticExpressionNode(expression);
  const literal = literalStaticWrapperValue(value);
  if (literal) return literal;
  if (!Node.isIdentifier(value)) return undefined;

  const symbol = symbolForIdentifierReference(value) ?? value.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = declaration.getInitializer();
  return initializer
    ? literalStaticWrapperValue(unwrappedStaticExpressionNode(initializer))
    : undefined;
}

function objectLiteralStaticPathPrivateScope(
  object: ObjectLiteralExpression,
  path: readonly string[],
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  let value: Node | undefined = object;
  for (const [index, segment] of path.entries()) {
    const current = unwrappedStaticExpressionNode(value);
    if (!Node.isObjectLiteralExpression(current)) {
      const provenance = staticWrapperValuePrivateScope(current, sessionContext);
      if (provenance) {
        return {
          ...provenance,
          path: appendPrivateScopePath(provenance.path, path.slice(index).join('.')),
        };
      }
      const alias = localConstLiteralAliasValue(current);
      if (!alias || !Node.isObjectLiteralExpression(alias)) return undefined;
      value = alias;
      continue;
    }
    value = objectLiteralSingleStaticPropertyValue(current, segment);
    if (!value) return undefined;
  }
  return staticWrapperValuePrivateScope(value, sessionContext);
}

function staticWrapperValuePrivateScope(
  value: Node | undefined,
  sessionContext: SessionProvenanceContext,
  depth = 0,
): PrivateScopeProvenance | undefined {
  if (!value || depth > 4) return undefined;
  const node = unwrappedStaticExpressionNode(value);
  if (isObjectFreezeCall(node)) {
    const argument = singleObjectFreezeArgument(node);
    return argument
      ? staticWrapperValuePrivateScope(argument, sessionContext, depth + 1)
      : undefined;
  }
  const conditional = conditionalExpressionPrivateScope(node, sessionContext, depth + 1);
  if (conditional) return conditional;
  const binary = binaryExpressionPrivateScope(node, sessionContext, depth + 1);
  if (binary) return binary;
  if (!Node.isIdentifier(node)) {
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      const provenance = staticWrapperAccessPrivateScope(node, sessionContext, depth + 1);
      if (provenance || staticAccessRootVariableDeclaration(node)) return provenance;
    }
    return (
      privateScopeForExpression(node, sessionContext) ??
      summarizedStaticCallPrivateScope(node, sessionContext)
    );
  }

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) {
    return privateScopeForExpression(node, sessionContext);
  }
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = declaration.getInitializer();
  return initializer
    ? staticWrapperValuePrivateScope(initializer, sessionContext, depth + 1)
    : undefined;
}

function staticWrapperAccessPrivateScope(
  node: Node,
  sessionContext: SessionProvenanceContext,
  depth: number,
): PrivateScopeProvenance | undefined {
  if (depth > 4) return undefined;
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) {
    return undefined;
  }

  const property = staticAccessName(node);
  if (!property) return undefined;
  const accessValue = localConstLiteralStaticAccessValue(node);
  if (accessValue) return staticWrapperValuePrivateScope(accessValue, sessionContext, depth + 1);

  const base = node.getExpression();
  const baseDeclaration = staticAccessRootVariableDeclaration(base);
  if (!baseDeclaration) return undefined;

  const declarationList = baseDeclaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const baseScope = staticWrapperValuePrivateScope(base, sessionContext, depth + 1);
  return baseScope
    ? { ...baseScope, path: appendPrivateScopePath(baseScope.path, property) }
    : undefined;
}

function staticAccessRootVariableDeclaration(node: Node): VariableDeclaration | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return staticAccessRootVariableDeclaration(expression.getExpression());
  }
  if (!Node.isIdentifier(expression)) return undefined;

  const symbol = symbolForIdentifierReference(expression) ?? expression.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  return declaration && Node.isVariableDeclaration(declaration) ? declaration : undefined;
}

function literalStaticWrapperValue(value: Node | undefined): Node | undefined {
  if (!value) return undefined;
  if (Node.isObjectLiteralExpression(value) || Node.isArrayLiteralExpression(value)) return value;

  if (!isObjectFreezeCall(value)) return undefined;
  const argument = singleObjectFreezeArgument(value);
  if (!argument) return undefined;
  const frozen = unwrappedStaticExpressionNode(argument);
  return frozen && (Node.isObjectLiteralExpression(frozen) || Node.isArrayLiteralExpression(frozen))
    ? frozen
    : undefined;
}

function isObjectFreezeCall(value: Node): value is CallExpression {
  if (!Node.isCallExpression(value)) return false;
  const expression = unwrappedStaticExpressionNode(value.getExpression());
  if (!Node.isPropertyAccessExpression(expression)) return false;
  if (expression.getName() !== 'freeze') return false;
  const receiver = unwrappedStaticExpressionNode(expression.getExpression());
  return Node.isIdentifier(receiver) && receiver.getText() === 'Object';
}

function singleObjectFreezeArgument(value: CallExpression): Node | undefined {
  const args = value.getArguments();
  return args.length === 1 ? args[0] : undefined;
}

function objectBindingPropertyName(
  declaration: Node & { getNameNode(): Node },
): string | undefined {
  if (!Node.isBindingElement(declaration)) return undefined;
  const name = declaration.getPropertyNameNode() ?? declaration.getNameNode();
  return staticPlainPropertyName(name);
}

function objectLiteralSingleStaticPropertyValue(
  object: ObjectLiteralExpression,
  name: string,
): Node | undefined {
  let value: Node | undefined;
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) return undefined;

    if (Node.isPropertyAssignment(property)) {
      if (staticPlainPropertyName(property.getNameNode()) !== name) continue;
      if (value) return undefined;
      value = property.getInitializer();
      continue;
    }

    if (Node.isShorthandPropertyAssignment(property)) {
      if (staticPlainPropertyName(property.getNameNode()) !== name) continue;
      if (value) return undefined;
      value = property.getNameNode();
    }
  }
  return value;
}

function staticPlainPropertyName(name: Node): string | undefined {
  if (name.getKind() === SyntaxKind.ComputedPropertyName) return undefined;
  return propertyNameText(name);
}

function summarizedStaticCallPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
): PrivateScopeProvenance | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isCallExpression(node)) return undefined;

  const callee = unwrappedStaticExpressionNode(node.getExpression());
  const key = resolvedSymbolKey(symbolForIdentifierReference(callee) ?? callee.getSymbol());
  const name = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
  return (
    (key ? sessionContext.helpers.get(key) : undefined) ??
    (name ? sessionContext.helpers.get(`name:${name}`) : undefined)
  );
}

function conditionalExpressionPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
  depth = 0,
): PrivateScopeProvenance | undefined {
  if (depth > 4) return undefined;
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isConditionalExpression(node)) return undefined;

  const whenTrue = staticWrapperValuePrivateScope(node.getWhenTrue(), sessionContext, depth + 1);
  const whenFalse = staticWrapperValuePrivateScope(node.getWhenFalse(), sessionContext, depth + 1);
  if (!whenTrue || !whenFalse) return undefined;
  if (privateScopeKey(whenTrue) !== privateScopeKey(whenFalse)) return undefined;
  return whenTrue;
}

function binaryExpressionPrivateScope(
  expression: Node,
  sessionContext: SessionProvenanceContext,
  depth = 0,
): PrivateScopeProvenance | undefined {
  if (depth > 4) return undefined;
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isBinaryExpression(node)) return undefined;

  const operator = node.getOperatorToken().getKind();
  if (
    operator !== SyntaxKind.QuestionQuestionToken &&
    operator !== SyntaxKind.BarBarToken &&
    operator !== SyntaxKind.AmpersandAmpersandToken
  ) {
    return undefined;
  }

  const left = staticWrapperValuePrivateScope(node.getLeft(), sessionContext, depth + 1);
  const right = staticWrapperValuePrivateScope(node.getRight(), sessionContext, depth + 1);
  if (!left || !right) return undefined;
  if (privateScopeKey(left) !== privateScopeKey(right)) return undefined;
  return left;
}

/**
 * The session path of a local `const` bound DIRECTLY to a non-nullable session access
 * (SPEC §11.1, KV414 session-via-local tracing). Returns e.g. `userId` for
 * `const uid = req.session.userId` and then matches a later `eq(col, uid)`. Fail-closed:
 * returns undefined for any nullable/optional-chained session access, a reassigned
 * binding, a destructuring pattern, or a non-`session` segment — those keep the
 * shared session-provenance guard requirement instead of being silently discharged.
 */
function localBoundNonNullableSessionScope(expression: Node): string | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  // `const` only — a `let`/`var` binding can be reassigned away from the session value.
  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const initializer = declaration.getInitializer();
  if (!initializer) return undefined;
  return directNonNullableSessionScopePath(initializer);
}

/**
 * The `session.<path>` of a DIRECT, non-nullable session access expression, or
 * undefined. Mirrors the shared `directPrivateScope`/`requiresGuard` semantics but is
 * restricted to the `session` scope and the non-nullable case (no `?.`, no
 * `null`/`undefined` in the accessed scope's static type), so this fallback never
 * discharges an access that genuinely needs a dominating guard.
 */
function directNonNullableSessionScopePath(node: Node): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const segments = staticAccessSegments(node);
  if (!segments) return undefined;
  const index = segments.path.indexOf('session');
  if (index < 0) return undefined;
  const path = segments.path.slice(index + 1).join('.');
  if (path.length === 0) return undefined;
  if (sessionAccessRequiresGuard(expression)) return undefined;
  return path;
}

function sessionAccessRequiresGuard(node: Node): boolean {
  if (node.getText().includes('?.')) return true;
  const sessionExpression = sessionSegmentExpression(node);
  if (!sessionExpression) return true;
  const type = sessionExpression.getType();
  const nullable = (type as { isNullable?: () => boolean }).isNullable?.();
  if (nullable) return true;
  return /\bnull\b|\bundefined\b/.test(type.getText());
}

function sessionSegmentExpression(node: Node): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (staticAccessName(expression) === 'session') return expression;
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return sessionSegmentExpression(expression.getExpression());
  }
  return undefined;
}

/** @internal */ export function queryTableKeyOperand(
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

/** @internal */ export function queryInputKeyOperand(
  expression: Node,
): Pick<QueryInstanceKeyOperand, 'inputKey'> {
  // SPEC §10.3 (KV414 IDOR): recognize the validated-input bag at ANY depth — `input.id`,
  // `input.session.userId`, `input.a.b.c` — so a NESTED input value whose field name
  // happens to be `session`/`guard`/`tenant` is still classified as a client arg (the
  // args/IDOR branch) instead of being mistaken for trusted session scope (H5). The
  // depth-1 `input.x` case keys identically to before (`arg:x`).
  const segments = staticAccessSegments(expression);
  if (
    segments &&
    segments.path.length > 0 &&
    Node.isIdentifier(segments.root) &&
    segments.root.getText() === 'input'
  ) {
    return { inputKey: `arg:${segments.path.join('.')}` };
  }

  const destructuredKey = localDestructuredInputKey(expression);
  return destructuredKey ? { inputKey: `arg:${destructuredKey}` } : {};
}

function localDestructuredInputKey(expression: Node): string | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = symbolForIdentifierReference(node) ?? node.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isBindingElement(declaration)) return undefined;
  if (isRestBindingElement(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;

  const pattern = declaration.getParent();
  if (!Node.isObjectBindingPattern(pattern)) return undefined;

  const variable = pattern.getParent();
  if (!Node.isVariableDeclaration(variable)) return undefined;
  const declarationList = variable.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;

  const initializer = variable.getInitializer();
  const source = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  if (!source || !Node.isIdentifier(source) || source.getText() !== 'input') return undefined;

  const property = declaration.getPropertyNameNode();
  const key = property ? propertyNameText(property) : declaration.getNameNode().getText();
  return key && !key.includes('.') ? key : undefined;
}

/** @internal */ export function compositeQueryInstanceKey(
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

/** @internal */ export function valueKeyForTableColumnComparison(
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

/** @internal */ export function directSummaryForFunction(
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

/** @internal */ export function materializedViewRefreshFactsForFunction(
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

/** @internal */ export function isAsyncMaterializedViewAnnotation(
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

/** @internal */ export function appendReadSourceSummaries(
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

/** @internal */ export function appendForeignKeyCascadeWriteSummaries(
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

/** @internal */ export function isTouchingForeignKeyAction(
  action: string | undefined,
): action is string {
  return action === 'cascade' || action === 'set null' || action === 'set default';
}

/** @internal */ export function foreignKeyTargetsTable(
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

/** @internal */ export function appendDeclaredFanOutWriteSummaries(
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

/** @internal */ export function appendMissingTriggerFanOutDiagnostics(
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

/** @internal */ export function fanAnnotationsForOperation(
  table: KovoDomainTableAnnotation & { name: string },
  operation: string,
): readonly KovoFanAnnotation[] {
  if (operation !== 'delete' && operation !== 'insert' && operation !== 'update') return [];
  return (table.fans ?? []).filter((fan) => fan.when === undefined || fan.when === operation);
}

/** @internal */ export function triggerTableNamesFromSource(source: string): ReadonlySet<string> {
  const tables = new Set<string>();
  const triggerPattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER[\s\S]*?\bON\s+("?)([A-Za-z_][\w]*)\1/gi;

  for (const match of source.matchAll(triggerPattern)) {
    const table = match[2];
    if (table) tables.add(table);
  }

  return tables;
}

/** @internal */ export function functionTouchSummariesForFile(
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

/** @internal */ export function mergeSummary(
  target: FunctionTouchSummary,
  source: FunctionTouchSummary,
): boolean {
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

/** @internal */ export function pushUnique<T>(
  target: T[],
  source: readonly T[],
  keyFor: (item: T) => string,
): boolean {
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

/** @internal */ export function readSummaryKey(read: ReadSummaryInput): string {
  return [
    read.operation,
    read.table.name,
    read.site,
    read.readKey ?? '',
    read.predicate ?? '',
    read.branch ?? '',
  ].join('\0');
}

/** @internal */ export function unresolvedSummaryKey(unresolved: UnresolvedSummaryInput): string {
  return [
    unresolved.code ?? '',
    unresolved.operation,
    unresolved.site,
    unresolved.domain ?? '',
  ].join('\0');
}

/** @internal */ export function writeSummaryKey(write: WriteSummaryInput): string {
  return [
    write.operation,
    write.table.name,
    write.site,
    write.writeKey ?? '',
    write.predicate ?? '',
    write.branch ?? '',
  ].join('\0');
}

/** @internal */ export function extractReadSourcesFromWriteChain(
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

/** @internal */ export function writeReadSourceOperation(
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

/** @internal */ export function callExpressionContinuesToChain(
  call: CallExpression,
  chain: Node,
): boolean {
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

/** @internal */ export function isReadSourceCall(call: CallExpression): boolean {
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

/** @internal */ export function propertyAccessCallName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  return staticAccessName(expression);
}

/** @internal */ export function staticAccessName(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;

  const argument = node.getArgumentExpression();
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralText();
  }
  if (Node.isNumericLiteral(argument)) return argument.getText();
  return undefined;
}

/** @internal */ export function staticAccessExpression(node: Node): Node | undefined {
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return node.getExpression();
  }
  return undefined;
}

/** @internal */ export function predicateSummaryFromFacts(
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

/** @internal */ export function isPrivateScopeKey(key: string): boolean {
  return key.startsWith('guard:') || key.startsWith('session:') || key.startsWith('tenant:');
}

/** @internal */ export function tableKeyColumns(key: string): string[] {
  return key
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
}

/** @internal */ export function extractPredicateFactsFromWriteChain(
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
 * instance-key/`session` candidates) and `allEqOperandPairs` (every direct
 * comparison operand, incl. `or()` branches, non-equality/range forms, and
 * negated membership → fail-closed `args` candidates), with the same
 * `input.*`/`req.session.*`/table-column operand classifier the read side uses — so a
 * write keyed by a client arg against an owner table emits a `kind:'write'` scope
 * audit (the write half of KV414 the framework previously never produced).
 */
/** @internal */ export function writeInstanceKeyComparisons(
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

/** @internal */ export function extractParameterizedKeys(
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

/** @internal */ export interface EqPredicateConjunct {
  left: Node;
  right: Node;
}

/** @internal */ export type PredicatePnf =
  | { expr: string; kind: 'and'; nodes: readonly PredicatePnf[] }
  | { kind: 'eq'; left: Node; right: Node }
  | { kind: 'non-eq-comparison'; left: Node; right: Node }
  | { kind: 'non-eq-membership'; left: Node; rights: readonly Node[] }
  | { expr: string; kind: 'opaque' }
  | { expr: string; kind: 'or'; nodes: readonly PredicatePnf[] };

/** @internal */ export function predicatePnf(node: Node): PredicatePnf {
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

  if (name === 'inArray') {
    const [left, right] = expression.getArguments();
    const onlyElement = right ? singleLiteralArrayElement(right) : undefined;
    if (left && onlyElement) return { kind: 'eq', left, right: onlyElement };
    return (
      nonliteralMembershipPnf(expression, 'inArray') ?? {
        expr: expression.getText(),
        kind: 'opaque',
      }
    );
  }

  if (name === 'ne' || name === 'gt' || name === 'gte' || name === 'lt' || name === 'lte') {
    const [left, right] = expression.getArguments();
    return left && right
      ? { kind: 'non-eq-comparison', left, right }
      : { expr: expression.getText(), kind: 'opaque' };
  }

  if (name === 'between') {
    const [left, lower, upper] = expression.getArguments();
    return left && lower && upper
      ? {
          expr: expression.getText(),
          kind: 'and',
          nodes: [
            { kind: 'non-eq-comparison', left, right: lower },
            { kind: 'non-eq-comparison', left, right: upper },
          ],
        }
      : { expr: expression.getText(), kind: 'opaque' };
  }

  if (name === 'notInArray') {
    return (
      nonEqMembershipPnf(expression) ??
      nonliteralMembershipPnf(expression, 'notInArray') ?? {
        expr: expression.getText(),
        kind: 'opaque',
      }
    );
  }

  if (name === 'not') {
    const [argument] = expression.getArguments();
    const negatedMembership = argument
      ? (nonEqMembershipPnf(argument, 'inArray') ?? nonliteralMembershipPnf(argument, 'inArray'))
      : undefined;
    if (negatedMembership) return negatedMembership;

    const pnf = argument ? predicatePnf(argument) : undefined;
    if (pnf?.kind === 'eq') return { kind: 'non-eq-comparison', left: pnf.left, right: pnf.right };
    return pnf && !pnfContainsEq(pnf) ? pnf : { expr: expression.getText(), kind: 'opaque' };
  }

  if (name !== 'eq') return { expr: expression.getText(), kind: 'opaque' };
  const [left, right] = expression.getArguments();
  return left && right
    ? { kind: 'eq', left, right }
    : { expr: expression.getText(), kind: 'opaque' };
}

function pnfContainsEq(pnf: PredicatePnf): boolean {
  if (pnf.kind === 'eq') return true;
  if (pnf.kind === 'and' || pnf.kind === 'or') return pnf.nodes.some(pnfContainsEq);
  return false;
}

function nonEqMembershipPnf(
  node: Node,
  expectedName?: 'inArray' | 'notInArray',
): PredicatePnf | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return undefined;

  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee)) return undefined;
  const name = callee.getText();
  if (expectedName ? name !== expectedName : name !== 'notInArray') return undefined;

  const [left, right] = expression.getArguments();
  const elements = right ? literalArrayElements(right) : undefined;
  if (!left || !elements || elements.length === 0) return undefined;
  return { kind: 'non-eq-membership', left, rights: elements };
}

function nonliteralMembershipPnf(
  node: Node,
  expectedName: 'inArray' | 'notInArray',
): PredicatePnf | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return undefined;

  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee) || callee.getText() !== expectedName) return undefined;

  const [left, right] = expression.getArguments();
  if (!left || !right || Node.isArrayLiteralExpression(unwrappedStaticExpressionNode(right))) {
    return undefined;
  }
  return { kind: 'non-eq-membership', left, rights: [right] };
}

function singleLiteralArrayElement(node: Node): Node | undefined {
  const elements = literalArrayElements(node);
  return elements?.length === 1 ? elements[0] : undefined;
}

function literalArrayElements(node: Node): readonly Node[] | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isArrayLiteralExpression(expression)) return undefined;

  const elements = expression.getElements();
  if (elements.some(Node.isSpreadElement)) return undefined;
  return elements;
}

/** @internal */ export function pnfExactConjuncts(
  pnf: PredicatePnf,
): EqPredicateConjunct[] | null {
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

/** @internal */ export function eqPredicateConjuncts(node: Node): EqPredicateConjunct[] | null {
  return pnfExactConjuncts(predicatePnf(node));
}

/** @internal */ export function pnfAllEqOperandPairs(pnf: PredicatePnf): EqPredicateConjunct[] {
  if (pnf.kind === 'eq' || pnf.kind === 'non-eq-comparison') {
    return [{ left: pnf.left, right: pnf.right }];
  }
  if (pnf.kind === 'non-eq-membership') {
    return pnf.rights.map((right) => ({ left: pnf.left, right }));
  }
  if (pnf.kind === 'and' || pnf.kind === 'or') return pnf.nodes.flatMap(pnfAllEqOperandPairs);
  return [];
}

/** @internal */ export function tableKeyReferences(
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

/** @internal */ export function tableKeyReference(
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

/** @internal */ export function dedupePredicateFacts(
  facts: readonly ExtractedPredicateFact[],
): ExtractedPredicateFact[] {
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

/** @internal */ export function argumentKey(
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
