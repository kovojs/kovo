import type { JsonValue } from '@kovojs/core';
import type {
  AlgebraicField,
  AlgebraicQueryShape,
  ArithOp,
  OrderByColumn,
  PuntReason,
  Rowset,
  RowsetFilter,
  RowWitness,
  SymbolicEffect,
  SymbolicMatch,
  SymbolicValue,
} from '@kovojs/core/internal/derivation';
import {
  Node,
  SyntaxKind,
  ts,
  type CallExpression,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type SourceFile,
  type VariableDeclaration,
} from 'ts-morph';

import {
  UNRESOLVED_READ_SOURCE_EXPRESSION,
  createProjectExtraction,
  drizzleWriteChainRoot,
  emptySessionProvenanceContext,
  functionBody,
  isDrizzleDatabaseTypeAnnotation,
  isDrizzleWriteCall,
  isFunctionLikeNode,
  isOpaqueProjection,
  isProjectDrizzleReceiverIdentifier,
  isSelectQueryCallName,
  lineForIndex,
  opaqueAliasReasonForExpression,
  pnfExactConjuncts,
  predicatePnf,
  privateScopeForExpression,
  projectClassStaticMemberCallbacks,
  projectDomainWriteCallbacks,
  projectDrizzleReceivers,
  projectNamespaceTableNamesByLocal,
  projectObjectLiteralCallbacks,
  projectTableNameForNode,
  projectTablesBySyntheticName,
  propertyAccessCallName,
  propertyNameText,
  queryBodyObjectLiteral,
  queryCallbackParameterNodes,
  queryLoadCallbackFunctions,
  resolvedSymbolKey,
  selectProjectionArgument,
  sessionProvenanceContextForNodes,
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
  staticAccessExpression,
  staticAccessName,
  staticExpressionRootIdentifier,
  touchBodyCallExpressions,
  unwrappedFunctionExpression,
  unwrappedStaticExpressionNode,
  type ExtractedTable,
  type ExtractedTableAnnotation,
  type PredicatePnf,
  type ProjectDrizzleReceivers,
  type ProjectExtraction,
  type QueryShape,
  type QueryShapeWrapper,
  type SessionProvenanceContext,
  type SourceFileInput,
  type SymbolProvenanceContext,
  type TouchGraphProjectOptions,
} from '../static.js';

// ───────────────────────────────────────────────────────────────────────────
// SPEC.md §10.5 derivation extraction (Stage 1 write→effect, Stage 2 query→shape).
//
// These project-mode extractors lower real Drizzle write/query source into the
// shared `SymbolicEffect` / `AlgebraicQueryShape` IR (`@kovojs/core/derivation`)
// that the source-agnostic Stage-3 deriver (`@kovojs/drizzle/internal/derive`) consumes.
// They REUSE the same ts-morph project, table-symbol resolution, write-chain
// predicate extraction, and select-shape classification used by the touch-graph
// and query-fact extractors above — never name/string heuristics (project mode
// only, v1-cleanup item 4). Per §10.5 these are conservative: anything that
// cannot be PROVEN traceable lowers to `Opaque`/punt so the deriver degrades
// rather than emitting an unsound prediction.
// ───────────────────────────────────────────────────────────────────────────

/** @internal One extracted Stage-1 effect with its source site and resolvable write key (domain.action). */
/** @internal */ export interface SymbolicEffectFact {
  effect: SymbolicEffect;
  site: string;
  /** The `domain.action` / function key when the write site is a resolvable handler. */
  writeKey?: string;
}

interface DeriveExtraction extends ProjectExtraction {
  realTableNameBySynthetic: ReadonlyMap<string, string>;
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>;
}

/** A discovered write/query callback: its body node plus an optional resolvable key. */
interface DeriveCallback {
  body: Node;
  fn: Node;
  key?: string;
}

/** The instance/primary-key column from a table annotation (null for exempt tables). */
function tableAnnotationKey(annotation: ExtractedTableAnnotation): string | null {
  return 'key' in annotation && typeof annotation.key === 'string' ? annotation.key : null;
}

function createDeriveExtraction(options: TouchGraphProjectOptions): DeriveExtraction {
  const base = createProjectExtraction(options);
  const tablesBySyntheticName = projectTablesBySyntheticName(base);
  const realTableNameBySynthetic = new Map<string, string>();
  for (const [synthetic, table] of tablesBySyntheticName) {
    realTableNameBySynthetic.set(synthetic, table.annotation.name);
  }
  return { ...base, realTableNameBySynthetic, tablesBySyntheticName };
}

/**
 * SPEC.md §10.5 Stage 1 — lower every project-mode Drizzle write call into the
 * symbolic `effect` grammar (`INSERT{vals} | UPDATE{match,sets} | DELETE{match}
 * | UPSERT{…}`). The `.values()` / `.set()` payloads (which the touch-graph
 * write extractor discards) are parsed here into `SymbolicValue`s; an
 * unresolvable table emits the unresolved marker so the deriver's `unsupported`
 * punt fires (never a crash).
 */
/** @internal */
/** @internal */ export function extractSymbolicEffectsFromProject(
  options: TouchGraphProjectOptions,
): SymbolicEffectFact[] {
  const extraction = createDeriveExtraction(options);
  try {
    const facts: SymbolicEffectFact[] = [];
    extraction.sourceFiles.forEach((sourceFile, index) => {
      const file = extraction.files[index];
      if (!file) return;

      const namespaceTableNames = projectNamespaceTableNamesByLocal(
        sourceFile,
        extraction.tableNamesBySymbol,
      );
      const resolveTable = (node: Node): string | undefined => {
        const synthetic = projectTableNameForNode(
          node,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
        );
        if (!synthetic) return undefined;
        return extraction.realTableNameBySynthetic.get(synthetic) ?? synthetic;
      };

      for (const callback of deriveWriteCallbacks(sourceFile)) {
        const receivers = projectDrizzleReceivers(callback.fn);
        const paramSymbolKeys = callbackParameterSymbolKeys(callback.fn);
        const sessionContext = sessionProvenanceContextForNodes(sourceFile, [callback.body]);
        const symbolContext = symbolProvenanceContextForNodes([callback.body], {
          inputRoots: callbackInputRootNodes(callback.fn),
        });
        for (const call of touchBodyCallExpressions(callback.body)) {
          const fact = symbolicEffectForWriteCall(call, {
            file,
            paramSymbolKeys,
            receivers,
            resolveTable,
            sessionContext,
            symbolContext,
            ...(callback.key ? { writeKey: callback.key } : {}),
          });
          if (fact) facts.push(fact);
        }
      }
    });
    return dedupeEffectFacts(facts);
  } finally {
    extraction.dispose();
  }
}

/** All callback bodies in a file that may carry a Drizzle write call, with resolvable keys. */
function deriveWriteCallbacks(sourceFile: SourceFile): DeriveCallback[] {
  const callbacks: DeriveCallback[] = [];
  const seen = new Set<number>();
  const push = (fn: Node | undefined, key?: string): void => {
    if (!fn) return;
    let body: Node;
    try {
      body = functionBody(fn);
    } catch {
      return;
    }
    if (seen.has(fn.getStart())) return;
    seen.add(fn.getStart());
    callbacks.push(key === undefined ? { body, fn } : { body, fn, key });
  };

  // domain({ action: write(async (db, ...) => { ... }) }) → key `domain.action`.
  for (const callback of projectDomainWriteCallbacks(sourceFile).values()) {
    push(callback.fn, callback.name);
  }
  // Top-level function declarations / variable-assigned callbacks.
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    push(fn, fn.getName());
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(name) || !initializer) continue;
    push(unwrappedFunctionExpression(initializer), name.getText());
  }
  // Object-literal method/property callbacks and class static members (no domain key).
  for (const callback of [
    ...projectObjectLiteralCallbacks(sourceFile),
    ...projectClassStaticMemberCallbacks(sourceFile),
  ]) {
    push(callback.fn);
  }

  return callbacks;
}

interface WriteCallContext {
  file: SourceFileInput;
  paramSymbolKeys: ReadonlySet<string>;
  receivers: ProjectDrizzleReceivers;
  resolveTable: (node: Node) => string | undefined;
  sessionContext: SessionProvenanceContext;
  symbolContext: SymbolProvenanceContext;
  writeKey?: string;
}

function symbolicEffectForWriteCall(
  call: CallExpression,
  context: WriteCallContext,
): SymbolicEffectFact | undefined {
  if (!isDrizzleWriteCall(call)) return undefined;

  const expression = call.getExpression();
  const operation = staticAccessName(expression);
  const receiver = staticAccessExpression(expression);
  if (!operation || !receiver) return undefined;
  if (!isProjectDrizzleReceiverIdentifier(receiver, context.receivers)) return undefined;

  const tableArgument = call.getArguments()[0];
  if (!tableArgument) return undefined;

  const table = context.resolveTable(tableArgument) ?? UNRESOLVED_READ_SOURCE_EXPRESSION;
  const chain = drizzleWriteChainRoot(call);
  const site = `${context.file.fileName}:${lineForIndex(context.file.source, call.getStart())}`;
  // INSERT `.values()` has no row to self-reference; UPDATE/UPSERT `.set()` may use
  // `t.col` of the WRITTEN table to mean the row's own column (e.g. `stock - quantity`).
  const selfColumn: SelfColumnResolver = (node) => {
    const column = writeColumnReference(node, context.resolveTable);
    if (!column) return undefined;
    const base = staticAccessExpression(unwrappedStaticExpressionNode(node));
    return base && context.resolveTable(base) === table ? column : undefined;
  };
  const toValue = (node: Node): SymbolicValue =>
    symbolicValueFromExpression(
      node,
      context.paramSymbolKeys,
      context.sessionContext,
      undefined,
      context.symbolContext,
    );
  const toSetValue = (node: Node): SymbolicValue =>
    symbolicValueFromExpression(
      node,
      context.paramSymbolKeys,
      context.sessionContext,
      selfColumn,
      context.symbolContext,
    );
  const writeKeyEntry = context.writeKey ? { writeKey: context.writeKey } : {};

  if (operation === 'insert') {
    const values = chainValuesObject(chain, 'values', toValue);
    const conflict = chainOnConflictSets(chain, toSetValue);
    if (conflict) {
      const match = chainMatch(
        chain,
        context.resolveTable,
        context.paramSymbolKeys,
        context.sessionContext,
        context.symbolContext,
      );
      return {
        effect: { match, op: 'upsert', sets: conflict, table, values },
        site,
        ...writeKeyEntry,
      };
    }
    return { effect: { op: 'insert', table, values }, site, ...writeKeyEntry };
  }

  if (operation === 'update') {
    const sets = chainValuesObject(chain, 'set', toSetValue);
    const match = chainMatch(
      chain,
      context.resolveTable,
      context.paramSymbolKeys,
      context.sessionContext,
      context.symbolContext,
    );
    return { effect: { match, op: 'update', sets, table }, site, ...writeKeyEntry };
  }

  if (operation === 'delete') {
    const match = chainMatch(
      chain,
      context.resolveTable,
      context.paramSymbolKeys,
      context.sessionContext,
      context.symbolContext,
    );
    return { effect: { match, op: 'delete', table }, site, ...writeKeyEntry };
  }

  return undefined;
}

/** Parse the object literal of a chained `.values({…})` / `.set({…})` into SymbolicValues. */
function chainValuesObject(
  chain: Node,
  method: 'set' | 'values',
  toValue: (node: Node) => SymbolicValue,
): Record<string, SymbolicValue> {
  const sets: Record<string, SymbolicValue> = {};
  const call = chainCallByName(chain, method);
  const argument = call?.getArguments()[0];
  if (!argument) return sets;
  const object = unwrappedStaticExpressionNode(argument);
  if (!Node.isObjectLiteralExpression(object)) return sets;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const column = propertyNameText(property.getNameNode());
    if (!column) continue;
    const valueNode = Node.isShorthandPropertyAssignment(property)
      ? property.getNameNode()
      : property.getInitializer();
    sets[column] = valueNode ? toValue(valueNode) : { kind: 'opaque', expr: column };
  }

  return sets;
}

/** `onConflictDoUpdate({ set: {…} })` → upsert sets (else undefined ⇒ plain INSERT). */
function chainOnConflictSets(
  chain: Node,
  toValue: (node: Node) => SymbolicValue,
): Record<string, SymbolicValue> | undefined {
  const call = chainCallByName(chain, 'onConflictDoUpdate');
  if (!call) return undefined;
  const config = call.getArguments()[0];
  if (!config) return {};
  const object = unwrappedStaticExpressionNode(config);
  if (!Node.isObjectLiteralExpression(object)) return {};

  const setProperty = object
    .getProperties()
    .find(
      (property): property is PropertyAssignment =>
        Node.isPropertyAssignment(property) && propertyNameText(property.getNameNode()) === 'set',
    );
  const setObject = setProperty ? setProperty.getInitializer() : undefined;
  if (!setObject || !Node.isObjectLiteralExpression(setObject)) return {};

  const sets: Record<string, SymbolicValue> = {};
  for (const property of setObject.getProperties()) {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const column = propertyNameText(property.getNameNode());
    if (!column) continue;
    const valueNode = Node.isShorthandPropertyAssignment(property)
      ? property.getNameNode()
      : property.getInitializer();
    sets[column] = valueNode ? toValue(valueNode) : { kind: 'opaque', expr: column };
  }
  return sets;
}

/** A write `match` from `.where(eq(t.key, expr))`; ranges/IN/non-key/sql ⇒ opaque ⇒ punt. */
function chainMatch(
  chain: Node,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext,
  symbolContext: SymbolProvenanceContext,
): SymbolicMatch {
  const whereCall = chainCallByName(chain, 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return { eq: [], kind: 'keys' };

  const eqMatches = keyEqMatchesFromPredicate(
    predicate,
    resolveTable,
    paramSymbolKeys,
    sessionContext,
    symbolContext,
  );
  if (eqMatches?.kind === 'matches') return { eq: eqMatches.matches, kind: 'keys' };
  if (eqMatches?.kind === 'or') return { arms: eqMatches.arms, kind: 'or' };
  if (eqMatches?.kind === 'opaque') {
    return {
      expr: eqMatches.expr,
      kind: 'opaque',
      ...(eqMatches.reason ? { reason: eqMatches.reason } : {}),
    };
  }
  return { expr: predicate.getText(), kind: 'opaque' };
}

type KeyEqMatchParseResult =
  | { kind: 'matches'; matches: { column: string; value: SymbolicValue }[] }
  | { arms: { eq: { column: string; value: SymbolicValue }[] }[]; kind: 'or' }
  | { expr: string; kind: 'opaque'; reason?: PuntReason };

/**
 * AND-of-`eq(t.col, value)` predicates → key matches, or `null` when ANY conjunct
 * is a non-eq predicate (range / IN / sql / function) ⇒ opaque match ⇒ punt.
 */
function keyEqMatchesFromPredicate(
  predicate: Node,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext,
  symbolContext: SymbolProvenanceContext,
): KeyEqMatchParseResult | null {
  return keyEqMatchesFromPnf(
    predicatePnf(predicate),
    resolveTable,
    paramSymbolKeys,
    sessionContext,
    symbolContext,
  );
}

function keyEqMatchesFromPnf(
  pnf: PredicatePnf,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext,
  symbolContext: SymbolProvenanceContext,
): KeyEqMatchParseResult | null {
  if (pnf.kind === 'or') {
    return keyEqDisjunctionMatchesFromPnf(
      pnf,
      resolveTable,
      paramSymbolKeys,
      sessionContext,
      symbolContext,
    );
  }

  return keyEqConjunctionMatchesFromPnf(
    pnf,
    resolveTable,
    paramSymbolKeys,
    sessionContext,
    symbolContext,
  );
}

function keyEqDisjunctionMatchesFromPnf(
  pnf: Extract<PredicatePnf, { kind: 'or' }>,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext,
  symbolContext: SymbolProvenanceContext,
): KeyEqMatchParseResult {
  const arms: { eq: { column: string; value: SymbolicValue }[] }[] = [];
  for (const arm of pnf.nodes) {
    const parsed = keyEqConjunctionMatchesFromPnf(
      arm,
      resolveTable,
      paramSymbolKeys,
      sessionContext,
      symbolContext,
    );
    if (!parsed || parsed.kind !== 'matches') {
      return {
        expr: pnf.expr,
        kind: 'opaque',
        reason: { code: 'mixed-disjunction', expr: pnf.expr },
      };
    }
    arms.push({ eq: parsed.matches });
  }
  return arms.length > 0
    ? { arms, kind: 'or' }
    : {
        expr: pnf.expr,
        kind: 'opaque',
        reason: { code: 'mixed-disjunction', expr: pnf.expr },
      };
}

function keyEqConjunctionMatchesFromPnf(
  pnf: PredicatePnf,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext,
  symbolContext: SymbolProvenanceContext,
): KeyEqMatchParseResult | null {
  const conjuncts = pnfExactConjuncts(pnf);
  if (!conjuncts) return null;

  const matches: { column: string; value: SymbolicValue }[] = [];
  for (const { left, right } of conjuncts) {
    const leftColumn = writeColumnReference(left, resolveTable);
    const rightColumn = writeColumnReference(right, resolveTable);
    const column = leftColumn ?? rightColumn;
    const valueNode = leftColumn ? right : left;
    if (!column || !valueNode) return null;

    const value = symbolicValueFromExpression(
      valueNode,
      paramSymbolKeys,
      sessionContext,
      undefined,
      symbolContext,
    );
    if (value.kind === 'opaque') {
      return value.expr.startsWith('unsummarized-helper:')
        ? { expr: value.expr, kind: 'opaque' }
        : null;
    }
    matches.push({ column, value });
  }

  return { kind: 'matches', matches };
}

/** Resolve a `t.col` / `t['col']` reference whose base resolves to a known table → its column. */
function writeColumnReference(
  node: Node,
  resolveTable: (node: Node) => string | undefined,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) {
    return undefined;
  }
  const base = expression.getExpression();
  if (!resolveTable(base)) return undefined;
  return staticAccessName(expression);
}

/** Optional self-reference resolver: `t.col` of the written table → its column name. */
type SelfColumnResolver = (node: Node) => string | undefined;

/**
 * SPEC.md §10.5 Stage-1 `value` grammar. Conservatively maps an expression node:
 * literal → Const; identifier/property-access traceable to a handler param/session
 * key → Param(path); `t.col` of the written table (in a SET) → ColRef; binary
 * `+ - * /` of mappable operands → Arith; everything else (calls, server
 * computation, untraceable identifiers) → Opaque (the deriver placeholders Opaque
 * INSERT cols and punts Opaque SET/match).
 */
function symbolicValueFromExpression(
  node: Node,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext = emptySessionProvenanceContext(),
  selfColumn?: SelfColumnResolver,
  symbolContext: SymbolProvenanceContext = symbolProvenanceContextForNodes([]),
): SymbolicValue {
  const expression = unwrappedStaticExpressionNode(node);

  // Const literals.
  const literal = literalJsonValue(expression);
  if (literal !== undefined) return { kind: 'const', value: literal.value };

  // ColRef self-reference: `t.col` of the written table (e.g. `stock - quantity`).
  const selfRef = selfColumn?.(expression);
  if (selfRef) return { column: selfRef, kind: 'col' };

  // Arith of mappable operands.
  if (Node.isBinaryExpression(expression)) {
    const op = arithOperator(expression.getOperatorToken().getText());
    if (op) {
      const left = symbolicValueFromExpression(
        expression.getLeft(),
        paramSymbolKeys,
        sessionContext,
        selfColumn,
        symbolContext,
      );
      const right = symbolicValueFromExpression(
        expression.getRight(),
        paramSymbolKeys,
        sessionContext,
        selfColumn,
        symbolContext,
      );
      if (left.kind !== 'opaque' && right.kind !== 'opaque') {
        return { kind: 'arith', left, op, right };
      }
    }
    return { kind: 'opaque', expr: expression.getText() };
  }

  // Param(path): identifier or property-access whose root resolves to a handler param.
  const paramPath = paramPathForExpression(expression, paramSymbolKeys);
  if (paramPath) return { kind: 'param', path: paramPath };

  const privateScope = privateScopeForExpression(expression, sessionContext);
  if (privateScope) return { kind: privateScope.kind, path: privateScope.path };

  const opaqueAliasReason = opaqueAliasReasonForExpression(expression, sessionContext);
  if (opaqueAliasReason) return { kind: 'opaque', expr: opaqueAliasReason };

  const symbolProvenance = symbolProvenanceForExpression(expression, symbolContext);
  if (symbolProvenance.kind === 'input') {
    return symbolProvenance.path !== undefined
      ? { kind: 'param', path: symbolProvenance.path }
      : { kind: 'opaque', expr: expression.getText() };
  }

  // Runtime-valid column arithmetic: `sql`${t.col} - ${quantity}`` (the way real
  // drizzle expresses a self-referential SET, since JS `-` on a column is invalid).
  const sqlArith = sqlTemplateArith(
    expression,
    paramSymbolKeys,
    sessionContext,
    selfColumn,
    symbolContext,
  );
  if (sqlArith) return sqlArith;

  if (Node.isCallExpression(expression)) {
    return { kind: 'opaque', expr: unsummarizedHelperReason(expression) };
  }

  return { kind: 'opaque', expr: expression.getText() };
}

function unsummarizedHelperReason(call: CallExpression): string {
  const callee = unwrappedStaticExpressionNode(call.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
  return name ? `unsummarized-helper:${name}` : 'unsummarized-helper';
}

/** Parse `sql`${A} <op> ${B}`` (a two-interpolation binary template) into an Arith value. */
function sqlTemplateArith(
  node: Node,
  paramSymbolKeys: ReadonlySet<string>,
  sessionContext: SessionProvenanceContext,
  selfColumn?: SelfColumnResolver,
  symbolContext: SymbolProvenanceContext = symbolProvenanceContextForNodes([]),
): SymbolicValue | undefined {
  if (!Node.isTaggedTemplateExpression(node)) return undefined;
  const tag = node.getTag();
  if (!Node.isIdentifier(tag) || tag.getText() !== 'sql') return undefined;
  const template = node.getTemplate();
  if (!Node.isTemplateExpression(template)) return undefined;
  if (template.getHead().getLiteralText().trim() !== '') return undefined;

  const spans = template.getTemplateSpans();
  if (spans.length !== 2) return undefined;
  const [first, second] = spans;
  if (!first || !second) return undefined;
  if (second.getLiteral().getLiteralText().trim() !== '') return undefined;

  const op = arithOperator(first.getLiteral().getLiteralText().trim());
  if (!op) return undefined;
  const left = symbolicValueFromExpression(
    first.getExpression(),
    paramSymbolKeys,
    sessionContext,
    selfColumn,
    symbolContext,
  );
  const right = symbolicValueFromExpression(
    second.getExpression(),
    paramSymbolKeys,
    sessionContext,
    selfColumn,
    symbolContext,
  );
  if (left.kind === 'opaque' || right.kind === 'opaque') return undefined;
  return { kind: 'arith', left, op, right };
}

/** Trace an identifier/property-access to a handler param and return its dot-path, else undefined. */
function paramPathForExpression(
  node: Node,
  paramSymbolKeys: ReadonlySet<string>,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isIdentifier(expression)) {
    return symbolIsParameter(expression, paramSymbolKeys) ? expression.getText() : undefined;
  }
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const name = staticAccessName(expression);
    if (!name) return undefined;
    const base = paramPathForExpression(expression.getExpression(), paramSymbolKeys);
    return base ? `${base}.${name}` : undefined;
  }
  return undefined;
}

function symbolIsParameter(node: Node, paramSymbolKeys: ReadonlySet<string>): boolean {
  // A shorthand `{ id }` name identifier resolves to the PROPERTY symbol, not the
  // referenced variable; use the shorthand's value symbol to reach the param.
  const parent = node.getParent();
  const symbol =
    parent && Node.isShorthandPropertyAssignment(parent)
      ? (parent.getValueSymbol() ?? node.getSymbol())
      : node.getSymbol();
  const symbolKey = resolvedSymbolKey(symbol);
  return symbolKey !== undefined && paramSymbolKeys.has(symbolKey);
}

/** Symbol keys of the leading non-receiver parameters of a write/handler callback. */
function callbackParameterSymbolKeys(fn: Node): Set<string> {
  const keys = new Set<string>();
  for (const parameter of queryCallbackParameterNodes(fn)) {
    if (isDrizzleDatabaseTypeAnnotation(parameter)) continue;
    const nameNode = parameter.getNameNode();
    // Destructured input — `handler({ productId, quantity }, request)` — binds each
    // field as a top-level $input param (path = the binding name, the $input field).
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const key = resolvedSymbolKey(element.getNameNode().getSymbol());
        if (key) keys.add(key);
      }
      continue;
    }
    const symbolKey = resolvedSymbolKey(nameNode.getSymbol());
    if (symbolKey) keys.add(symbolKey);
  }
  return keys;
}

function callbackInputRootNodes(fn: Node): Node[] {
  return queryCallbackParameterNodes(fn)
    .filter((parameter) => !isDrizzleDatabaseTypeAnnotation(parameter))
    .map((parameter) => parameter.getNameNode());
}

function arithOperator(token: string): ArithOp | undefined {
  if (token === '+' || token === '-' || token === '*' || token === '/') return token;
  return undefined;
}

function literalJsonValue(node: Node): { value: JsonValue } | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return { value: expression.getLiteralText() };
  }
  if (Node.isNumericLiteral(expression)) return { value: Number(expression.getLiteralText()) };
  if (expression.getKind() === SyntaxKind.TrueKeyword) return { value: true };
  if (expression.getKind() === SyntaxKind.FalseKeyword) return { value: false };
  if (expression.getKind() === SyntaxKind.NullKeyword) return { value: null };
  if (
    Node.isPrefixUnaryExpression(expression) &&
    expression.getOperatorToken() === SyntaxKind.MinusToken
  ) {
    const operand = expression.getOperand();
    if (Node.isNumericLiteral(operand)) return { value: -Number(operand.getLiteralText()) };
  }
  return undefined;
}

/** Find the chained call by method name within a write chain (`.values`, `.where`, …). */
function chainCallByName(chain: Node, method: string): CallExpression | undefined {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  return calls.find((call) => propertyAccessCallName(call) === method);
}

function dedupeEffectFacts(facts: readonly SymbolicEffectFact[]): SymbolicEffectFact[] {
  const seen = new Set<string>();
  const deduped: SymbolicEffectFact[] = [];
  for (const fact of facts) {
    const key = `${fact.site}\0${fact.writeKey ?? ''}\0${JSON.stringify(fact.effect)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }
  return deduped;
}

// ── Stage 2 (query → AlgebraicQueryShape) ────────────────────────────────────

interface QueryShapeContextForTable {
  columnsByTable: (table: string) => Readonly<Record<string, QueryShape>> | undefined;
  keyByTable: (table: string) => string | null;
  paramSymbolKeys: ReadonlySet<string>;
  resolveTable: (node: Node) => string | undefined;
  sessionContext: SessionProvenanceContext;
}

/**
 * SPEC.md §10.5 Stage 2 — classify each invalidated query's result into the
 * `field ::= Scalar | COUNT(R[,pred]) | SUM(R,arith) | AGG(R,projection)`
 * algebra (`R = rowset(filter chain, key, orderBy)`), layered OVER the existing
 * `extractQueryFactsFromProject` (which keeps the raw inferred shape the binding
 * validators depend on). Out-of-grammar shapes (window / GROUP BY+HAVING /
 * DISTINCT / raw `sql<T>` projection / interprocedural KV406) classify as
 * `opaque` carrying the matching §10.5 `PuntReason`.
 */
/** @internal */
/** @internal */ export function extractAlgebraicShapesFromProject(
  options: TouchGraphProjectOptions,
): AlgebraicQueryShape[] {
  const extraction = createDeriveExtraction(options);
  try {
    const keyByRealTable = new Map<string, string | null>();
    const columnsByRealTable = new Map<string, Readonly<Record<string, QueryShape>>>();
    for (const table of extraction.tablesBySyntheticName.values()) {
      keyByRealTable.set(table.annotation.name, tableAnnotationKey(table.annotation));
      columnsByRealTable.set(table.annotation.name, table.columns);
    }

    const shapes: AlgebraicQueryShape[] = [];
    extraction.sourceFiles.forEach((sourceFile, index) => {
      const file = extraction.files[index];
      if (!file) return;

      const namespaceTableNames = projectNamespaceTableNamesByLocal(
        sourceFile,
        extraction.tableNamesBySymbol,
      );
      const resolveTable = (node: Node): string | undefined => {
        const synthetic = projectTableNameForNode(
          node,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
        );
        if (!synthetic) return undefined;
        return extraction.realTableNameBySynthetic.get(synthetic) ?? synthetic;
      };
      const context: QueryShapeContextForTable = {
        columnsByTable: (table) => columnsByRealTable.get(table),
        keyByTable: (table) => keyByRealTable.get(table) ?? null,
        paramSymbolKeys: new Set(),
        resolveTable,
        sessionContext: emptySessionProvenanceContext(),
      };

      for (const { name, body, fn } of deriveQueryLoaders(sourceFile)) {
        const shape = algebraicShapeForLoader(name, body, fn, context);
        if (shape) shapes.push(shape);
      }
    });
    return shapes;
  } finally {
    extraction.dispose();
  }
}

/** Discover `query('name', { load(...) {...} })` definitions and their load callbacks. */
function deriveQueryLoaders(
  sourceFile: SourceFile,
): { body: ObjectLiteralExpression; fn: Node; name: string }[] {
  const loaders: { body: ObjectLiteralExpression; fn: Node; name: string }[] = [];
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const queryCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(queryCall)) continue;
    const expression = queryCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'query') continue;

    const [queryArgument, bodyArgument] = queryCall.getArguments();
    if (!queryArgument || !Node.isStringLiteral(queryArgument)) continue;
    const body = queryBodyObjectLiteral(bodyArgument, 'project').body;
    if (!body) continue;

    const callbacks = queryLoadCallbackFunctions(body, 'project');
    const fn = callbacks[0];
    if (!fn) continue;
    loaders.push({ body: body, fn, name: queryArgument.getLiteralText() });
  }
  return loaders;
}

function algebraicShapeForLoader(
  query: string,
  body: ObjectLiteralExpression,
  fn: Node,
  context: QueryShapeContextForTable,
): AlgebraicQueryShape | undefined {
  const loaderContext: QueryShapeContextForTable = {
    ...context,
    paramSymbolKeys: callbackParameterSymbolKeys(fn),
    sessionContext: sessionProvenanceContextForNodes(body.getSourceFile(), [functionBody(fn)]),
  };
  const returned = loaderReturnExpression(fn);
  if (!returned) return undefined;

  const fields: Record<string, AlgebraicField> = {};
  const rowsByTable: Record<string, RowWitness> = {};

  // Object-returning loader: classify each property as its own algebraic field.
  const object = unwrappedStaticExpressionNode(returned);
  if (Node.isObjectLiteralExpression(object)) {
    for (const property of object.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const path = propertyNameText(property.getNameNode());
      const valueNode = property.getInitializer();
      if (!path || !valueNode) continue;

      const classified = classifyField(path, valueNode, object, loaderContext);
      if (!classified) continue;
      fields[path] = classified.field;
      if (classified.rowWitness) {
        rowsByTable[classified.rowWitness.table] = {
          columns: classified.rowWitness.columns,
          ...(classified.rowWitness.rowset ? { rowset: classified.rowWitness.rowset } : {}),
          rowsPath: classified.rowWitness.rowsPath,
        };
      }
    }
  } else {
    // Single-select loader: the whole result is the rows array of one AGG field.
    const classified = classifyField('', object, undefined, loaderContext);
    if (classified) {
      fields[''] = classified.field;
      if (classified.rowWitness) {
        rowsByTable[classified.rowWitness.table] = {
          columns: classified.rowWitness.columns,
          ...(classified.rowWitness.rowset ? { rowset: classified.rowWitness.rowset } : {}),
          rowsPath: classified.rowWitness.rowsPath,
        };
      }
    }
  }

  if (Object.keys(fields).length === 0) return undefined;
  return {
    fields,
    query,
    ...(Object.keys(rowsByTable).length > 0 ? { rowsByTable } : {}),
  };
}

interface ClassifiedField {
  field: AlgebraicField;
  rowWitness?: RowWitness & { table: string };
}

/** Classify one result-object property into an AlgebraicField (+ optional rows witness). */
function classifyField(
  path: string,
  valueNode: Node,
  object: ObjectLiteralExpression | undefined,
  context: QueryShapeContextForTable,
): ClassifiedField | undefined {
  // Cursor: a property derived from the last row of a paginated rows sibling.
  const cursorRowset = object ? cursorRowsetForExpression(valueNode, object, context) : undefined;
  if (cursorRowset) return { field: { kind: 'cursor', rowset: cursorRowset } };

  // Real-loader scalar: a single-row scalar projection of an aggregate select,
  // e.g. `Number(rows[0]?.value ?? 0)` / `(await db.select({ value: sum(t.c) }))[0].value`,
  // where the runtime loader awaits + projects the [{ value }] aggregate result.
  const scalar = scalarProjectionField(valueNode, context);
  if (scalar) return scalar;

  const select = selectChainForExpression(valueNode);
  if (!select) return undefined;

  // DISTINCT shape ⇒ out-of-grammar punt.
  const selectName = staticAccessName(select.selectCall.getExpression());
  if (selectName === 'selectDistinct' || selectName === 'selectDistinctOn') {
    return { field: { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'distinct' } } };
  }
  // GROUP BY (+HAVING) ⇒ out-of-grammar punt.
  if (chainCallByName(select.chain, 'groupBy')) {
    return {
      field: { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'group-by-having' } },
    };
  }

  const table = tableForSelect(select, context.resolveTable);
  if (!table) {
    return {
      field: {
        kind: 'opaque',
        reason: { code: 'interprocedural', site: select.selectCall.getText() },
      },
    };
  }
  const rowset = rowsetForSelect(select, table, context);

  const projection = selectProjectionArgument(select.selectCall);
  if (!projection || !Node.isObjectLiteralExpression(projection)) {
    // `db.select()` without explicit projection ⇒ interprocedural / un-analyzable.
    return {
      field: {
        kind: 'opaque',
        reason: { code: 'interprocedural', site: select.selectCall.getText() },
      },
    };
  }

  // Aggregate / scalar single-field projections.
  const single = projection.getProperties();
  if (single.length === 1) {
    const property = single[0];
    if (property && Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      const aggregate = initializer
        ? aggregateField(initializer, rowset, table, context)
        : undefined;
      if (aggregate) return { field: aggregate };
    }
  }

  // Raw `sql<T>` projection anywhere ⇒ opaque-projection punt.
  for (const property of projection.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (initializer && isOpaqueProjection(initializer.compilerNode as ts.Expression)) {
      return {
        field: {
          kind: 'opaque',
          reason: { code: 'opaque-projection', expr: initializer.getText() },
        },
      };
    }
  }

  // Otherwise the property ships a full row array of `table` ⇒ AGG.
  const columns = projectionColumns(projection, table, context.resolveTable);
  if (!columns) {
    return {
      field: {
        kind: 'opaque',
        reason: { code: 'interprocedural', site: select.selectCall.getText() },
      },
    };
  }
  const columnTypes = projectionColumnTypes(columns.columns, table, context);
  const field: AlgebraicField = {
    kind: 'agg',
    projection: columns.columns,
    ...(rowset.key ? { rowKey: rowset.key } : {}),
    rowset,
    ...(Object.keys(columnTypes).length > 0 ? { columnTypes } : {}),
  };
  return {
    field,
    rowWitness: { columns: columns.columns, rowsPath: path, rowset, table },
  };
}

interface SelectChain {
  chain: Node;
  selectCall: CallExpression;
}

/** Resolve a `db.select(…).from(T)…` chain that produces a value (await-unwrapped). */
function selectChainForExpression(node: Node): SelectChain | undefined {
  const expression = resolveValueExpression(node);
  if (!Node.isCallExpression(expression)) return undefined;

  const selectCall = expression
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .concat([expression])
    .find((call) => isSelectQueryCallName(staticAccessName(call.getExpression())));
  if (!selectCall) return undefined;
  return { chain: expression, selectCall };
}

/** Unwrap await/parens and resolve a same-scope `const x = <expr>` identifier to its initializer. */
function resolveValueExpression(node: Node, depth = 0): Node {
  let expression = unwrappedStaticExpressionNode(node);
  if (Node.isAwaitExpression(expression)) {
    return resolveValueExpression(expression.getExpression(), depth);
  }
  if (Node.isIdentifier(expression) && depth < 4) {
    const declaration = expression
      .getSymbol()
      ?.getDeclarations()
      .find((candidate): candidate is VariableDeclaration => Node.isVariableDeclaration(candidate));
    const initializer = declaration?.getInitializer();
    if (initializer) return resolveValueExpression(initializer, depth + 1);
  }
  return expression;
}

function tableForSelect(
  select: SelectChain,
  resolveTable: (node: Node) => string | undefined,
): string | undefined {
  const fromCall = chainCallByName(select.chain, 'from');
  const tableArgument = fromCall?.getArguments()[0];
  return tableArgument ? resolveTable(tableArgument) : undefined;
}

function rowsetForSelect(
  select: SelectChain,
  table: string,
  context: QueryShapeContextForTable,
): Rowset {
  return {
    filters: selectFilters(select, table, context),
    key: context.keyByTable(table),
    orderBy: selectOrderBy(select, table, context),
    table,
  };
}

/** WHERE chain → rowset filters (eq with value, else non-eq/opaque). */
function selectFilters(
  select: SelectChain,
  table: string,
  context: QueryShapeContextForTable,
): RowsetFilter[] {
  const whereCall = chainCallByName(select.chain, 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return [];
  return filtersFromPredicate(predicate, table, context);
}

function filtersFromPredicate(
  predicate: Node,
  table: string,
  context: QueryShapeContextForTable,
): RowsetFilter[] {
  const node = unwrappedStaticExpressionNode(predicate);
  if (!Node.isCallExpression(node)) return [{ column: predicate.getText(), op: 'opaque' }];
  const callee = node.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : undefined;

  if (name === 'and') {
    return node
      .getArguments()
      .flatMap((argument) => filtersFromPredicate(argument, table, context));
  }

  const [left, right] = node.getArguments();
  const column =
    selectColumnReference(left, table, context.resolveTable) ??
    selectColumnReference(right, table, context.resolveTable);
  if (!column) return [{ column: node.getText(), op: 'opaque' }];

  if (name === 'eq') {
    const valueNode = selectColumnReference(left, table, context.resolveTable) ? right : left;
    const value = valueNode
      ? symbolicValueFromExpression(valueNode, context.paramSymbolKeys, context.sessionContext)
      : undefined;
    return value && value.kind !== 'opaque'
      ? [{ column, op: 'eq', value }]
      : [{ column, op: 'non-eq' }];
  }
  return [{ column, op: 'non-eq' }];
}

/** ORDER BY chain → ordered columns with per-column opacity (sql/expr orderBy ⇒ opaque). */
function selectOrderBy(
  select: SelectChain,
  table: string,
  context: QueryShapeContextForTable,
): OrderByColumn[] {
  const orderByCall = chainCallByName(select.chain, 'orderBy');
  if (!orderByCall) return [];

  const columns: OrderByColumn[] = [];
  for (const argument of orderByCall.getArguments()) {
    columns.push(orderByColumn(argument, table, context.resolveTable));
  }
  return columns;
}

function orderByColumn(
  argument: Node,
  table: string,
  resolveTable: (node: Node) => string | undefined,
): OrderByColumn {
  const node = unwrappedStaticExpressionNode(argument);
  // `desc(t.col)` / `asc(t.col)` direction wrappers.
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
    if (name === 'asc' || name === 'desc') {
      const inner = node.getArguments()[0];
      const column = inner ? selectColumnReference(inner, table, resolveTable) : undefined;
      if (column) return { column, direction: name };
    }
    return { column: node.getText(), direction: 'asc', opaque: true };
  }
  const column = selectColumnReference(node, table, resolveTable);
  if (column) return { column, direction: 'asc' };
  return { column: node.getText(), direction: 'asc', opaque: true };
}

/** Resolve a `t.col` reference whose base resolves to `table` → its column name. */
function selectColumnReference(
  node: Node | undefined,
  table: string,
  resolveTable: (node: Node) => string | undefined,
): string | undefined {
  if (!node) return undefined;
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) {
    return undefined;
  }
  if (resolveTable(expression.getExpression()) !== table) return undefined;
  return staticAccessName(expression);
}

/** Classify `count()` / `sum(t.col)` aggregate (or scalar single keyed-row column). */
function aggregateField(
  initializer: Node,
  rowset: Rowset,
  table: string,
  context: QueryShapeContextForTable,
): AlgebraicField | undefined {
  const expression = unwrappedStaticExpressionNode(initializer);

  // Window functions: `<agg>(…).over(…)` ⇒ out-of-grammar punt.
  if (Node.isCallExpression(expression) && propertyAccessCallName(expression) === 'over') {
    return { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'window' } };
  }

  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
    if (name === 'count') {
      // C4 (SPEC §10.5): Drizzle `count(t.col)` counts only NON-NULL values, unlike
      // `count()`/`count(*)`. Modeling it as COUNT(*) over-counts NULL-column INSERTs.
      // The deriver has no per-row null witness, so a column-argument count is opaque.
      if (expression.getArguments().length > 0) {
        return {
          kind: 'opaque',
          reason: { code: 'opaque-projection', expr: expression.getText() },
        };
      }
      // C3 (SPEC §10.5): the rowset carries the full filter chain; `pred` is a single
      // representative eq used by the fast-path. `deriveCount` re-checks the whole
      // chain so a multi-eq / non-eq filtered COUNT cannot mis-derive.
      const pred = rowset.filters.find((filter) => filter.op === 'eq');
      return { kind: 'count', ...(pred ? { pred } : {}), rowset };
    }
    if (name === 'sum' || name === 'sumDistinct') {
      const argument = expression.getArguments()[0];
      const column = argument
        ? selectColumnReference(argument, table, context.resolveTable)
        : undefined;
      if (!column) {
        return {
          kind: 'opaque',
          reason: { code: 'opaque-projection', expr: expression.getText() },
        };
      }
      return { arith: { column, kind: 'col' }, kind: 'sum', rowset };
    }
    if (name === 'avg' || name === 'max' || name === 'min') {
      return { kind: 'opaque', reason: { code: 'opaque-projection', expr: expression.getText() } };
    }
  }

  // A single `t.col` projection is a Scalar ONLY when the rowset is pinned to one
  // keyed row (`eq(key, …)`); otherwise it ships an array of rows ⇒ AGG (handled by
  // the caller's projection path). Returning undefined defers to that AGG path.
  const scalarColumn = selectColumnReference(expression, table, context.resolveTable);
  if (scalarColumn && rowsetPinsKey(rowset)) {
    return { column: scalarColumn, kind: 'scalar', rowset };
  }

  return undefined;
}

/**
 * Classify a real-loader scalar field: a single-row scalar projection of an
 * aggregate `db.select({ <col>: sum/count(…) })` result. Handles the runtime
 * shapes `(await select)[0].col`, `rows[0].col`, `rows[0]?.col`, optionally
 * wrapped in `Number(...)` / `... ?? default` / `!`. Returns the SUM/COUNT (or
 * keyed-row Scalar) field the projected column computes.
 */
function scalarProjectionField(
  valueNode: Node,
  context: QueryShapeContextForTable,
): ClassifiedField | undefined {
  const access = scalarProjectionAccess(valueNode);
  if (!access) return undefined;

  const select = selectChainForExpression(access.base);
  if (!select) return undefined;
  const table = tableForSelect(select, context.resolveTable);
  if (!table) return undefined;
  const projection = selectProjectionArgument(select.selectCall);
  if (!projection || !Node.isObjectLiteralExpression(projection)) return undefined;

  const rowset = rowsetForSelect(select, table, context);
  for (const property of projection.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== access.column) continue;
    const initializer = property.getInitializer();
    const field = initializer ? aggregateField(initializer, rowset, table, context) : undefined;
    if (field) return { field };
  }
  return undefined;
}

/** Match a `<base>[0](?.|.)<col>` first-row scalar projection (await/Number/?? wrappers stripped). */
function scalarProjectionAccess(node: Node): { base: Node; column: string } | undefined {
  const expression = unwrapScalarProjection(node);
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const column = expression.getName();
  const element = unwrappedStaticExpressionNode(expression.getExpression());
  if (!Node.isElementAccessExpression(element)) return undefined;
  const index = unwrappedStaticExpressionNode(element.getArgumentExpression() ?? element);
  if (!Node.isNumericLiteral(index) || index.getLiteralText() !== '0') return undefined;
  return { base: element.getExpression(), column };
}

/** Strip `Number(...)` / `String(...)` / `x ?? default` / `x!` / parens around a scalar projection. */
function unwrapScalarProjection(node: Node): Node {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isNonNullExpression(expression))
    return unwrapScalarProjection(expression.getExpression());
  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
    const argument = expression.getArguments()[0];
    if (argument && (name === 'Number' || name === 'String' || name === 'Boolean')) {
      return unwrapScalarProjection(argument);
    }
  }
  if (
    Node.isBinaryExpression(expression) &&
    expression.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken
  ) {
    return unwrapScalarProjection(expression.getLeft());
  }
  return expression;
}

/** True when the rowset's filter chain pins its instance key to one row (`eq(key, …)`). */
function rowsetPinsKey(rowset: Rowset): boolean {
  if (!rowset.key) return false;
  return rowset.filters.some((filter) => filter.op === 'eq' && filter.column === rowset.key);
}

interface ProjectionColumns {
  columns: string[];
}

/** All projected columns of `table` in an AGG row projection (null ⇒ un-analyzable column). */
function projectionColumns(
  projection: ObjectLiteralExpression,
  table: string,
  resolveTable: (node: Node) => string | undefined,
): ProjectionColumns | undefined {
  const columns: string[] = [];
  for (const property of projection.getProperties()) {
    if (!Node.isPropertyAssignment(property)) return undefined;
    const initializer = property.getInitializer();
    const column = initializer
      ? selectColumnReference(initializer, table, resolveTable)
      : undefined;
    const alias = propertyNameText(property.getNameNode());
    if (!column || !alias) return undefined;
    columns.push(alias);
  }
  return columns.length > 0 ? { columns } : undefined;
}

/** Per-column JSON types for AGG placeholders, from the table's column builders. */
function projectionColumnTypes(
  columns: readonly string[],
  table: string,
  context: QueryShapeContextForTable,
): Record<string, 'boolean' | 'number' | 'string'> {
  const tableColumns = context.columnsByTable(table) ?? {};
  const types: Record<string, 'boolean' | 'number' | 'string'> = {};
  for (const column of columns) {
    const jsonType = jsonScalarType(tableColumns[column]);
    if (jsonType) types[column] = jsonType;
  }
  return types;
}

function jsonScalarType(
  shape: QueryShape | undefined,
): 'boolean' | 'number' | 'string' | undefined {
  const unwrapped =
    shape && typeof shape === 'object' && !Array.isArray(shape) && 'kind' in shape
      ? (shape as QueryShapeWrapper).shape
      : shape;
  if (unwrapped === 'number') return 'number';
  if (unwrapped === 'boolean') return 'boolean';
  if (unwrapped === 'string') return 'string';
  if (unwrapped === 'object') return 'string';
  return undefined;
}

/**
 * Cursor detection: a property whose value reads from the last row of a paginated
 * (`.limit()`) rows array (e.g. `rows.at(-1)?.id`) — the §10.5 pagination cursor
 * field. Only classifies when the referenced rows array provably resolves to a
 * limited select over a known table; otherwise the field falls through.
 */
function cursorRowsetForExpression(
  valueNode: Node,
  _object: ObjectLiteralExpression,
  context: QueryShapeContextForTable,
): Rowset | undefined {
  const expression = unwrappedStaticExpressionNode(valueNode);
  // A cursor reads INTO a rows array (`rows.at(-1)?.col`), so a bare select chain
  // is NOT a cursor — require a member/call access whose root is the rows array.
  if (selectChainForExpression(expression)) return undefined;

  const rootIdentifier = staticExpressionRootIdentifier(expression);
  if (!rootIdentifier || !Node.isIdentifier(rootIdentifier)) return undefined;

  const select = selectChainForExpression(rootIdentifier);
  if (!select || !chainCallByName(select.chain, 'limit')) return undefined;
  const table = tableForSelect(select, context.resolveTable);
  if (!table) return undefined;
  return rowsetForSelect(select, table, context);
}

/** The single `return <expr>` expression of a loader callback body, if any. */
function loaderReturnExpression(fn: Node): Node | undefined {
  let body: Node;
  try {
    body = functionBody(fn);
  } catch {
    return undefined;
  }
  // Concise arrow body: `() => (<expr>)`.
  if (!Node.isBlock(body)) return body;

  // Direct `return <expr>` statements of THIS callback (not a nested closure).
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter((statement) => {
    const enclosing = statement.getFirstAncestor(
      (ancestor) => isFunctionLikeNode(ancestor) || Node.isMethodDeclaration(ancestor),
    );
    return enclosing === fn;
  });
  const target = returns[returns.length - 1];
  return target?.getExpression();
}
