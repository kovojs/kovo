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
import type {
  MassAssignmentFact,
  QueryWriteReachabilityFact,
  ToctouFact,
} from '@kovojs/core/internal/graph';
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
  isDrizzleReceiver,
  isDrizzleWriteCall,
  isFunctionLikeNode,
  isKovoServerCalleeExpression,
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
  serverSummaryKeysForSourceFile,
  sessionProvenanceContextForNodes,
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
  staticAccessExpression,
  staticAccessName,
  staticExpressionRootIdentifier,
  symbolForIdentifierReference,
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
        const tableSynthetic = tableSyntheticNameForDerivation(synthetic);
        if (extraction.conditionalTableTargetsBySyntheticName.has(tableSynthetic)) return undefined;
        return extraction.realTableNameBySynthetic.get(tableSynthetic) ?? synthetic;
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

function tableSyntheticNameForDerivation(synthetic: string): string {
  const namespaceIndex = synthetic.lastIndexOf('.');
  return namespaceIndex === -1 ? synthetic : synthetic.slice(namespaceIndex + 1);
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

/**
 * Parse a single binary `sql`` `` template into an Arith value. SPEC §10.3/§11.1 (KV429).
 *
 * A self-referential SET (`stock = stock - 1`) is the way real drizzle expresses column
 * arithmetic, and a constant operand can be spelled two effect-identical ways:
 *
 *   sql`${col} - ${qty}` / sql`${col} - ${1}`   operand INTERPOLATED (`${…}`)
 *   sql`${col} - 1`       / sql`1 + ${col}`      operand a BARE literal in template text
 *
 * A bare numeric literal has NO AST node of its own — the value lives in the
 * TemplateHead/Tail literal text next to the operator — so the original lowering (which
 * required two interpolations) silently dropped `${col} - 1` to Opaque and let it ESCAPE
 * the KV429 lost-update gate, while `${col} - ${1}` tripped it. Two effect-identical
 * statements got different safety verdicts purely on interpolation style (audit trap #5).
 *
 * This reads the bare operand from the SAME typed literal-text fact the operator extraction
 * already uses and normalizes it to the SAME `const` SymbolicValue the interpolated `${1}`
 * spelling produces, so both spellings lower identically. ONLY plain numeric constants are
 * recognized in bare position — a non-numeric bare token (a SQL identifier/keyword/column)
 * stays Opaque, so column refs and request values are never mistaken for constants.
 */
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

  const headText = template.getHead().getLiteralText();
  const spans = template.getTemplateSpans();

  const lower = (operand: Node): SymbolicValue =>
    symbolicValueFromExpression(
      operand,
      paramSymbolKeys,
      sessionContext,
      selfColumn,
      symbolContext,
    );
  const arith = (
    left: SymbolicValue,
    op: ArithOp,
    right: SymbolicValue,
  ): SymbolicValue | undefined =>
    left.kind === 'opaque' || right.kind === 'opaque'
      ? undefined
      : { kind: 'arith', left, op, right };

  // Both operands interpolated: `sql`${A} <op> ${B}`` (incl. `${1}` as a const operand).
  if (spans.length === 2) {
    if (headText.trim() !== '') return undefined;
    const [first, second] = spans;
    if (!first || !second) return undefined;
    if (second.getLiteral().getLiteralText().trim() !== '') return undefined;
    const op = arithOperator(first.getLiteral().getLiteralText().trim());
    if (!op) return undefined;
    return arith(lower(first.getExpression()), op, lower(second.getExpression()));
  }

  // One operand interpolated, the other a BARE numeric literal carried in the template text.
  if (spans.length === 1) {
    const [span] = spans;
    if (!span) return undefined;
    const tailText = span.getLiteral().getLiteralText();

    // Right-bare: `sql`${A} <op> <const>`` — head empty, `<op> <const>` in the tail text.
    if (headText.trim() === '') {
      const bare = bareLiteralOperand(tailText, 'suffix');
      if (!bare) return undefined;
      return arith(lower(span.getExpression()), bare.op, bare.operand);
    }

    // Left-bare: `sql`<const> <op> ${B}`` — `<const> <op>` in the head text, tail empty.
    if (tailText.trim() === '') {
      const bare = bareLiteralOperand(headText, 'prefix');
      if (!bare) return undefined;
      return arith(bare.operand, bare.op, lower(span.getExpression()));
    }
  }

  return undefined;
}

/**
 * SPEC §10.3/§11.1 (KV429, audit trap #5). Extract a bare `<op> <numeric>` (suffix, the
 * tail of `${col} - 1`) or `<numeric> <op>` (prefix, the head of `1 + ${col}`) from a
 * `sql`` `` template literal-text fragment, normalizing the numeric to the SAME `const`
 * SymbolicValue the interpolated `${1}` spelling lowers to. Returns `undefined` (→ Opaque)
 * for anything but a single operator followed/preceded by a plain numeric literal, so only
 * constants — never columns or request values — are recognized in bare position.
 */
function bareLiteralOperand(
  text: string,
  position: 'prefix' | 'suffix',
): { op: ArithOp; operand: SymbolicValue } | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  // The operator is the leading char (suffix `- 1`) or trailing char (prefix `1 +`).
  const opChar = position === 'suffix' ? trimmed[0] : trimmed[trimmed.length - 1];
  const op = opChar === undefined ? undefined : arithOperator(opChar);
  if (!op) return undefined;
  const numericText = position === 'suffix' ? trimmed.slice(1) : trimmed.slice(0, -1);
  const value = numericLiteralTextValue(numericText);
  if (value === undefined) return undefined;
  return { op, operand: { kind: 'const', value } };
}

/**
 * Strictly parse a plain numeric literal token (the bare-literal twin of a `${1}` operand,
 * which lowers via `literalJsonValue` to `{ kind: 'const' }`). Validates the token shape
 * BEFORE coercing so non-numeric text (a SQL identifier, an empty fragment) is never
 * coerced to `0`/`NaN` and mistaken for a constant. SPEC §10.3/§11.1 (KV429).
 */
function numericLiteralTextValue(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (
    !/^[+-]?(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.test(
      trimmed,
    )
  ) {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
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

// ── §11.1 mass-assignment write-provenance gate (KV438) ──────────────────────
//
// Builds on the Stage-1 write extractor's machinery (table resolution, write-chain
// payload parsing, the symbol-provenance engine) but applies a DIFFERENT, fail-closed
// adapter: the symbolic-effect extractor over-approximates opaque→opaque, whereas the
// mass-assignment gate must over-approximate opaque→REJECT for a GOVERNED column. A
// governed column receiving a request-input value (directly, aliased, destructured, or
// spread) — or an unprovable value — is the blocking KV438 finding (SPEC §10.3/§11.1).
//
// Governed columns: the table's `key` (instance/primary key), its `owner` principal
// column (both AUTO-governed), and every column named in `kovo({ governed })`.
//
// Two-tier escape (author-assertion, audit-grade):
//   serverValue(value, reason)   — discharges a NON-input value (serverValue(input.x,…) still fails).
//   adminAssign(value, reason)   — the louder audited path for a deliberate privileged write.
// Helper false-positives are resolved by `kovoAnalyzerSummary(fn, { returns: { kind: 'server' } })`,
// which the symbol-provenance engine reads as `server` provenance.

/**
 * SPEC §10.3/§11.1 — flag every write that lands request-input (or unprovable)
 * provenance on a governed column. Fail-closed: a value the analyzer cannot prove is
 * server-derived/literal/escaped is rejected on a governed column. Returns the
 * `MassAssignmentFact[]` the graph emission turns into blocking KV438 errors.
 *
 * @internal
 */
export function extractMassAssignmentFromProject(
  options: TouchGraphProjectOptions,
): MassAssignmentFact[] {
  const extraction = createDeriveExtraction(options);
  try {
    const governedByTable = new Map<string, GovernedTableInfo>();
    for (const table of extraction.tablesBySyntheticName.values()) {
      const info = governedTableInfo(table);
      if (info) governedByTable.set(table.annotation.name, info);
    }
    if (governedByTable.size === 0) return [];

    const facts: MassAssignmentFact[] = [];
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
        const tableSynthetic = tableSyntheticNameForDerivation(synthetic);
        if (extraction.conditionalTableTargetsBySyntheticName.has(tableSynthetic)) return undefined;
        return extraction.realTableNameBySynthetic.get(tableSynthetic) ?? synthetic;
      };
      const serverSummaryKeys = serverSummaryKeysForSourceFile(sourceFile);
      const privilegedHelpers = privilegedWriteHelperNames(sourceFile);

      for (const callback of deriveWriteCallbacks(sourceFile)) {
        const receivers = projectDrizzleReceivers(callback.fn);
        const sessionContext = sessionProvenanceContextForNodes(sourceFile, [callback.body]);
        const symbolContext = symbolProvenanceContextForNodes([callback.body], {
          inputRoots: callbackInputRootNodes(callback.fn),
          serverSummaryKeys,
        });
        const passwordSinkSymbolKeys = passwordSinkAliasKeysForNodes(
          [callback.body],
          privilegedHelpers,
        );
        const encryptedAtRestSymbolKeys = encryptedAtRestAliasKeysForNodes(
          [callback.body],
          privilegedHelpers,
        );
        const name = callback.key ?? '<anonymous>';
        for (const call of touchBodyCallExpressions(callback.body)) {
          facts.push(
            ...massAssignmentFactsForWriteCall(call, {
              file,
              governedByTable,
              name,
              receivers,
              resolveTable,
              sessionContext,
              symbolContext,
              passwordSinkSymbolKeys,
              encryptedAtRestSymbolKeys,
              privilegedHelpers,
            }),
          );
        }
      }
    });
    return dedupeMassAssignmentFacts(facts);
  } finally {
    extraction.dispose();
  }
}

interface GovernedTableInfo {
  /** The §10.1 domain (for the finding fact). */
  domain: string;
  /** The governed column set, or `'*'` when `kovo({ governed: true })` governs all columns. */
  governed: ReadonlySet<string> | '*';
  /** OPP-04 columns that must flow through the authenticated-encryption sink before write. */
  confidentialAtRestColumns: ReadonlySet<string> | '*';
  /** Password-storage columns must be written only through the blessed argon2id sink. */
  passwordColumns: ReadonlySet<string>;
}

function governedTableInfo(table: ExtractedTable): GovernedTableInfo | undefined {
  const annotation = table.annotation;
  if (!('domain' in annotation)) return undefined;
  const passwordColumns = new Set(Object.keys(table.columns).filter(isPasswordColumnName));
  const governedAnnotation = (annotation as { governed?: true | readonly string[] }).governed;
  const confidentialAtRestAnnotation = (
    annotation as { confidentialAtRest?: true | readonly string[] }
  ).confidentialAtRest;
  const confidentialAtRestColumns =
    confidentialAtRestAnnotation === true
      ? '*'
      : new Set(
          Array.isArray(confidentialAtRestAnnotation)
            ? confidentialAtRestAnnotation.filter(
                (column): column is string => typeof column === 'string',
              )
            : [],
        );
  if (governedAnnotation === true) {
    return {
      confidentialAtRestColumns,
      domain: annotation.domain,
      governed: '*',
      passwordColumns,
    };
  }

  const governed = new Set<string>();
  // AUTO-governed: the instance/primary key, the principal owner column, password storage,
  // and columns declared confidential-at-rest.
  const key =
    'key' in annotation && typeof annotation.key === 'string' ? annotation.key : undefined;
  const owner =
    'owner' in annotation && typeof annotation.owner === 'string' ? annotation.owner : undefined;
  if (key) governed.add(key);
  if (owner) governed.add(owner);
  for (const column of passwordColumns) governed.add(column);
  if (confidentialAtRestColumns === '*') {
    for (const column of Object.keys(table.columns)) governed.add(column);
  } else {
    for (const column of confidentialAtRestColumns) governed.add(column);
  }
  if (Array.isArray(governedAnnotation)) {
    for (const column of governedAnnotation) {
      if (typeof column === 'string') governed.add(column);
    }
  }
  return governed.size > 0
    ? { confidentialAtRestColumns, domain: annotation.domain, governed, passwordColumns }
    : undefined;
}

interface MassAssignmentCallContext {
  file: SourceFileInput;
  governedByTable: ReadonlyMap<string, GovernedTableInfo>;
  name: string;
  receivers: ProjectDrizzleReceivers;
  resolveTable: (node: Node) => string | undefined;
  sessionContext: SessionProvenanceContext;
  symbolContext: SymbolProvenanceContext;
  passwordSinkSymbolKeys: ReadonlySet<string>;
  encryptedAtRestSymbolKeys: ReadonlySet<string>;
  privilegedHelpers: PrivilegedWriteHelpers;
}

interface PrivilegedWriteHelpers {
  adminAssign: ReadonlySet<string>;
  encryptAtRest: ReadonlySet<string>;
  encryptionNamespaces: ReadonlySet<string>;
  hashPassword: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
  passwordNamespaces: ReadonlySet<string>;
  serverValue: ReadonlySet<string>;
}

function massAssignmentFactsForWriteCall(
  call: CallExpression,
  context: MassAssignmentCallContext,
): MassAssignmentFact[] {
  if (!isDrizzleWriteCall(call)) return [];
  const expression = call.getExpression();
  const operation = staticAccessName(expression);
  const receiver = staticAccessExpression(expression);
  if (!operation || !receiver) return [];
  if (!isProjectDrizzleReceiverIdentifier(receiver, context.receivers)) return [];
  if (operation !== 'insert' && operation !== 'update') return [];

  const tableArgument = call.getArguments()[0];
  if (!tableArgument) return [];
  const table = context.resolveTable(tableArgument);
  if (!table) return [];
  const info = context.governedByTable.get(table);
  if (!info) return [];

  const chain = drizzleWriteChainRoot(call);
  const site = `${context.file.fileName}:${lineForIndex(context.file.source, call.getStart())}`;
  const facts: MassAssignmentFact[] = [];

  // INSERT `.values({...})` + UPDATE `.set({...})`; also UPSERT `.onConflictDoUpdate({ set })`.
  const payloadMethods: ('set' | 'values')[] = operation === 'insert' ? ['values'] : ['set'];
  for (const method of payloadMethods) {
    facts.push(...massAssignmentFactsForPayload(chain, method, info, site, context, table));
  }
  const conflictSet = chainOnConflictSetObject(chain);
  if (conflictSet) {
    facts.push(...massAssignmentFactsForObject(conflictSet, 'set', info, site, context, table));
  }
  return facts;
}

function massAssignmentFactsForPayload(
  chain: Node,
  method: 'set' | 'values',
  info: GovernedTableInfo,
  site: string,
  context: MassAssignmentCallContext,
  table: string,
): MassAssignmentFact[] {
  const call = chainCallByName(chain, method);
  const argument = call?.getArguments()[0];
  if (!argument) return [];
  const object = unwrappedStaticExpressionNode(argument);

  // `.values(input)` / `.set(input)` — a NON-object-literal payload. The whole row is
  // populated from one expression; if it carries input/unprovable provenance it can set
  // ANY governed column. Fail-closed: reject the spread on a governed table (the design's
  // usability cliff), unless the payload is provably server-derived.
  if (!Node.isObjectLiteralExpression(object)) {
    return spreadMassAssignmentFacts(object, info, site, context, table, method);
  }
  return massAssignmentFactsForObject(object, method, info, site, context, table);
}

function massAssignmentFactsForObject(
  object: ObjectLiteralExpression,
  via: 'set' | 'values',
  info: GovernedTableInfo,
  site: string,
  context: MassAssignmentCallContext,
  table: string,
): MassAssignmentFact[] {
  const facts: MassAssignmentFact[] = [];
  for (const property of object.getProperties()) {
    // `{ ...input }` spread inside the payload object — same fail-closed treatment.
    if (Node.isSpreadAssignment(property)) {
      facts.push(
        ...spreadMassAssignmentFacts(
          property.getExpression(),
          info,
          site,
          context,
          table,
          'spread',
        ),
      );
      continue;
    }
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const column = propertyNameText(property.getNameNode());
    if (!column || !governs(info, column)) continue;
    const valueNode = Node.isShorthandPropertyAssignment(property)
      ? property.getNameNode()
      : property.getInitializer();
    if (!valueNode) continue;

    const verdict = confidentialAtRestColumn(info, column)
      ? confidentialAtRestValueVerdict(valueNode, context)
      : passwordColumn(info, column)
        ? passwordValueVerdict(valueNode, context)
        : governedValueVerdict(valueNode, context);
    if (verdict.ok) continue;
    facts.push({
      column,
      domain: info.domain,
      name: context.name,
      provenance: verdict.provenance,
      site,
      via,
      ...(verdict.detail ? { detail: verdict.detail } : {}),
    });
  }
  return facts;
}

/**
 * A `.values(input)` / `.set(input)` / `{ ...input }` spread on a governed table. The
 * spread can populate any governed column, so a non-server-provable spread is rejected
 * wholesale (one finding per governed column it could reach is noisy; we emit a single
 * `via:'spread'` finding keyed on the offending expression). A spread proven `server`
 * (e.g. a `kovoAnalyzerSummary('server')` row-builder) passes.
 */
function spreadMassAssignmentFacts(
  expression: Node,
  info: GovernedTableInfo,
  site: string,
  context: MassAssignmentCallContext,
  table: string,
  via: 'set' | 'spread' | 'values',
): MassAssignmentFact[] {
  const verdict = governedValueVerdict(expression, context);
  const hasConfidentialAtRest =
    info.confidentialAtRestColumns === '*' || info.confidentialAtRestColumns.size > 0;
  if (verdict.ok && info.passwordColumns.size === 0 && !hasConfidentialAtRest) return [];
  return [
    {
      column: governedColumnsLabel(info, table),
      domain: info.domain,
      name: context.name,
      provenance:
        (info.passwordColumns.size > 0 || hasConfidentialAtRest) && verdict.ok
          ? 'unknown'
          : verdict.provenance,
      site,
      via,
      ...(verdict.detail ? { detail: verdict.detail } : {}),
    },
  ];
}

interface GovernedValueVerdict {
  detail?: string;
  ok: boolean;
  provenance: 'input' | 'unknown';
}

/**
 * Classify a value flowing into a governed column. Fail-closed:
 *  - `serverValue(x, reason)` passes only when `x` is NON-input (serverValue(input.x,…) fails).
 *  - `adminAssign(x, reason)` is the audited privileged write — always passes (recorded).
 *  - literal / `server` (req.session/guard/tenant or a `kovoAnalyzerSummary('server')` helper) passes.
 *  - `input` provenance → reject (`input`).
 *  - anything else (unprovable / opaque helper) → reject (`unknown`, fail-closed).
 */
function governedValueVerdict(
  node: Node,
  context: MassAssignmentCallContext,
): GovernedValueVerdict {
  const expression = unwrappedStaticExpressionNode(node);

  if (Node.isCallExpression(expression)) {
    const callee = unwrappedStaticExpressionNode(expression.getExpression());
    // adminAssign(value, reason): the audited privileged write — always passes (recorded).
    if (isPrivilegedHelperCall(callee, 'adminAssign', context.privilegedHelpers)) {
      return { ok: true, provenance: 'input' };
    }
    if (isPrivilegedHelperCall(callee, 'serverValue', context.privilegedHelpers)) {
      const inner = expression.getArguments()[0];
      // serverValue discharges only a NON-input argument; serverValue(input.x,…) still fails.
      if (!inner) return { ok: true, provenance: 'unknown' };
      const innerVerdict = governedValueVerdict(inner, context);
      return innerVerdict.provenance === 'input'
        ? {
            ok: false,
            provenance: 'input',
            ...(innerVerdict.detail ? { detail: innerVerdict.detail } : {}),
          }
        : { ok: true, provenance: 'unknown' };
    }
  }

  // Literal → safe (e.g. a server-seeded constant).
  if (symbolicLiteralValue(expression) !== undefined) return { ok: true, provenance: 'unknown' };

  // Server provenance via session/guard/tenant (req.session.userId etc.) → safe.
  if (privateScopeForExpression(expression, context.sessionContext)) {
    return { ok: true, provenance: 'unknown' };
  }
  // A `kovoAnalyzerSummary('server')` helper call resolves to `server` provenance.
  const symbolProvenance = symbolProvenanceForExpression(expression, context.symbolContext);
  if (symbolProvenance.kind === 'server') return { ok: true, provenance: 'unknown' };
  if (symbolProvenance.kind === 'literal') return { ok: true, provenance: 'unknown' };
  if (symbolProvenance.kind === 'input') {
    return {
      ok: false,
      provenance: 'input',
      detail:
        symbolProvenance.path && symbolProvenance.path.length > 0
          ? symbolProvenance.path
          : expression.getText(),
    };
  }
  // Unknown provenance on a governed column is fail-closed (opaque helper / un-narrowable spread).
  return { ok: false, provenance: 'unknown', detail: expression.getText() };
}

/**
 * Password columns are a KV438 specialization for SPEC §6.6/OPP-10: stored password
 * values are writable only through Kovo's first-party argon2id sink. Ordinary
 * server-derived/literal/admin escapes are not sufficient for password persistence.
 */
function passwordValueVerdict(
  node: Node,
  context: MassAssignmentCallContext,
): GovernedValueVerdict {
  const expression = unwrappedAwaitedStaticExpressionNode(node);
  if (Node.isCallExpression(expression) && isBlessedPasswordHashCall(expression, context)) {
    return { ok: true, provenance: 'unknown' };
  }
  if (Node.isIdentifier(expression)) {
    const symbolKey = symbolKeyForNode(expression);
    if (symbolKey && context.passwordSinkSymbolKeys.has(symbolKey)) {
      return { ok: true, provenance: 'unknown' };
    }
  }
  const provenance = symbolProvenanceForExpression(expression, context.symbolContext);
  if (provenance.kind === 'input') {
    return {
      ok: false,
      provenance: 'input',
      detail:
        provenance.path && provenance.path.length > 0 ? provenance.path : expression.getText(),
    };
  }
  return { ok: false, provenance: 'unknown', detail: expression.getText() };
}

/**
 * OPP-04 confidential-at-rest writes are anchored on the destination column
 * declaration. A value for such a column must flow through the blessed
 * authenticated-encryption sink or the explicit audited privileged-write escape;
 * plaintext request, literal, server-derived, and opaque values fail closed.
 */
function confidentialAtRestValueVerdict(
  node: Node,
  context: MassAssignmentCallContext,
): GovernedValueVerdict {
  const expression = unwrappedAwaitedStaticExpressionNode(node);
  if (Node.isCallExpression(expression)) {
    const callee = unwrappedStaticExpressionNode(expression.getExpression());
    if (isPrivilegedHelperCall(callee, 'adminAssign', context.privilegedHelpers)) {
      return { ok: true, provenance: 'input' };
    }
    if (isBlessedEncryptAtRestCall(expression, context)) {
      return { ok: true, provenance: 'unknown' };
    }
  }
  if (Node.isIdentifier(expression)) {
    const symbolKey = symbolKeyForNode(expression);
    if (symbolKey && context.encryptedAtRestSymbolKeys.has(symbolKey)) {
      return { ok: true, provenance: 'unknown' };
    }
  }
  const provenance = symbolProvenanceForExpression(expression, context.symbolContext);
  if (provenance.kind === 'input') {
    return {
      ok: false,
      provenance: 'input',
      detail:
        provenance.path && provenance.path.length > 0 ? provenance.path : expression.getText(),
    };
  }
  return { ok: false, provenance: 'unknown', detail: expression.getText() };
}

function isPrivilegedHelperCall(
  callee: Node,
  helper: 'adminAssign' | 'serverValue',
  helpers: PrivilegedWriteHelpers,
): boolean {
  if (Node.isIdentifier(callee)) return helpers[helper].has(callee.getText());
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  return (
    Node.isIdentifier(receiver) &&
    helpers.namespaces.has(receiver.getText()) &&
    callee.getName() === helper
  );
}

function isBlessedEncryptAtRestCall(
  expression: CallExpression,
  context: MassAssignmentCallContext,
): boolean {
  return isBlessedEncryptAtRestCallWithHelpers(expression, context.privilegedHelpers);
}

function isBlessedPasswordHashCall(
  expression: CallExpression,
  context: MassAssignmentCallContext,
): boolean {
  return isBlessedPasswordHashCallWithHelpers(expression, context.privilegedHelpers);
}

function encryptedAtRestAliasKeysForNodes(
  bodies: readonly Node[],
  helpers: PrivilegedWriteHelpers,
): ReadonlySet<string> {
  const aliases = new Set<string>();
  const isEncryptedExpression = (node: Node): boolean => {
    const expression = unwrappedAwaitedStaticExpressionNode(node);
    if (
      Node.isCallExpression(expression) &&
      isBlessedEncryptAtRestCallWithHelpers(expression, helpers)
    ) {
      return true;
    }
    if (!Node.isIdentifier(expression)) return false;
    const symbolKey = symbolKeyForNode(expression);
    return symbolKey !== undefined && aliases.has(symbolKey);
  };

  for (const body of bodies) {
    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isEncryptedExpression(initializer)) continue;
      const binding = declaration.getNameNode();
      if (!Node.isIdentifier(binding)) continue;
      const symbolKey = symbolKeyForNode(binding);
      if (symbolKey) aliases.add(symbolKey);
    }
    for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getText() !== '=') continue;
      if (!isEncryptedExpression(assignment.getRight())) continue;
      const left = assignment.getLeft();
      if (!Node.isIdentifier(left)) continue;
      const symbolKey = symbolKeyForNode(left);
      if (symbolKey) aliases.add(symbolKey);
    }
  }
  return aliases;
}

function isBlessedEncryptAtRestCallWithHelpers(
  expression: CallExpression,
  helpers: PrivilegedWriteHelpers,
): boolean {
  const callee = unwrappedStaticExpressionNode(expression.getExpression());
  if (Node.isIdentifier(callee)) {
    return helpers.encryptAtRest.has(callee.getText());
  }
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  return (
    Node.isIdentifier(receiver) &&
    helpers.encryptionNamespaces.has(receiver.getText()) &&
    callee.getName() === 'encryptAtRest'
  );
}

function passwordSinkAliasKeysForNodes(
  bodies: readonly Node[],
  helpers: PrivilegedWriteHelpers,
): ReadonlySet<string> {
  const aliases = new Set<string>();
  const isPasswordSinkExpression = (node: Node): boolean => {
    const expression = unwrappedAwaitedStaticExpressionNode(node);
    if (
      Node.isCallExpression(expression) &&
      isBlessedPasswordHashCallWithHelpers(expression, helpers)
    ) {
      return true;
    }
    if (!Node.isIdentifier(expression)) return false;
    const symbolKey = symbolKeyForNode(expression);
    return symbolKey !== undefined && aliases.has(symbolKey);
  };

  for (const body of bodies) {
    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isPasswordSinkExpression(initializer)) continue;
      const binding = declaration.getNameNode();
      if (!Node.isIdentifier(binding)) continue;
      const symbolKey = symbolKeyForNode(binding);
      if (symbolKey) aliases.add(symbolKey);
    }
    for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getText() !== '=') continue;
      if (!isPasswordSinkExpression(assignment.getRight())) continue;
      const left = assignment.getLeft();
      if (!Node.isIdentifier(left)) continue;
      const symbolKey = symbolKeyForNode(left);
      if (symbolKey) aliases.add(symbolKey);
    }
  }
  return aliases;
}

function isBlessedPasswordHashCallWithHelpers(
  expression: CallExpression,
  helpers: PrivilegedWriteHelpers,
): boolean {
  const callee = unwrappedStaticExpressionNode(expression.getExpression());
  if (Node.isIdentifier(callee)) {
    return helpers.hashPassword.has(callee.getText());
  }
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  return (
    Node.isIdentifier(receiver) &&
    helpers.passwordNamespaces.has(receiver.getText()) &&
    callee.getName() === 'hashPassword'
  );
}

function privilegedWriteHelperNames(sourceFile: SourceFile): PrivilegedWriteHelpers {
  const adminAssign = new Set<string>();
  const encryptAtRest = new Set<string>();
  const encryptionNamespaces = new Set<string>();
  const hashPassword = new Set<string>();
  const serverValue = new Set<string>();
  const namespaces = new Set<string>();
  const passwordNamespaces = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier !== '@kovojs/server' && specifier !== '@kovojs/server/write-governance') {
      continue;
    }
    const namespace = declaration.getNamespaceImport();
    if (namespace) {
      namespaces.add(namespace.getText());
      if (specifier === '@kovojs/server') {
        encryptionNamespaces.add(namespace.getText());
        passwordNamespaces.add(namespace.getText());
      }
    }
    for (const named of declaration.getNamedImports()) {
      const imported = named.getName();
      const local = named.getAliasNode()?.getText() ?? imported;
      if (imported === 'adminAssign') adminAssign.add(local);
      if (specifier === '@kovojs/server' && imported === 'encryptAtRest') encryptAtRest.add(local);
      if (specifier === '@kovojs/server' && imported === 'hashPassword') hashPassword.add(local);
      if (imported === 'serverValue') serverValue.add(local);
    }
  }
  return {
    adminAssign,
    encryptAtRest,
    encryptionNamespaces,
    hashPassword,
    namespaces,
    passwordNamespaces,
    serverValue,
  };
}

function symbolicLiteralValue(node: Node): JsonValue | undefined {
  return literalJsonValue(node)?.value;
}

function governs(info: GovernedTableInfo, column: string): boolean {
  return info.governed === '*' || info.governed.has(column);
}

function passwordColumn(info: GovernedTableInfo, column: string): boolean {
  return info.passwordColumns.has(column);
}

function confidentialAtRestColumn(info: GovernedTableInfo, column: string): boolean {
  return info.confidentialAtRestColumns === '*' || info.confidentialAtRestColumns.has(column);
}

function isPasswordColumnName(column: string): boolean {
  return /^(?:password|passwordHash|passwordDigest)$/u.test(column);
}

function unwrappedAwaitedStaticExpressionNode(node: Node): Node {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isAwaitExpression(expression)
    ? unwrappedStaticExpressionNode(expression.getExpression())
    : expression;
}

function symbolKeyForNode(node: Node): string | undefined {
  return Node.isIdentifier(node)
    ? resolvedSymbolKey(symbolForIdentifierReference(node) ?? node.getSymbol())
    : resolvedSymbolKey(node.getSymbol());
}

function governedColumnsLabel(info: GovernedTableInfo, table: string): string {
  if (info.governed === '*') return '*';
  const columns = [...info.governed].sort();
  return columns.length > 0 ? columns.join('+') : table;
}

/** `onConflictDoUpdate({ set: {…} })` → the upsert `set` object literal (else undefined). */
function chainOnConflictSetObject(chain: Node): ObjectLiteralExpression | undefined {
  const call = chainCallByName(chain, 'onConflictDoUpdate');
  const config = call?.getArguments()[0];
  if (!config) return undefined;
  const object = unwrappedStaticExpressionNode(config);
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const setProperty = object
    .getProperties()
    .find(
      (property): property is PropertyAssignment =>
        Node.isPropertyAssignment(property) && propertyNameText(property.getNameNode()) === 'set',
    );
  const setObject = setProperty?.getInitializer();
  return setObject && Node.isObjectLiteralExpression(setObject) ? setObject : undefined;
}

function dedupeMassAssignmentFacts(facts: readonly MassAssignmentFact[]): MassAssignmentFact[] {
  const seen = new Set<string>();
  const deduped: MassAssignmentFact[] = [];
  for (const fact of facts) {
    const dedupeKey = `${fact.site}\0${fact.name}\0${fact.domain}\0${fact.column}\0${fact.via}\0${fact.provenance}\0${fact.detail ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(fact);
  }
  return deduped.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.domain.localeCompare(right.domain) ||
      left.column.localeCompare(right.column) ||
      left.site.localeCompare(right.site) ||
      left.via.localeCompare(right.via),
  );
}

// ── KV429 TOCTOU / lost-update gate (single-row, declared atomic/version) ─────
//
// SPEC §10.3/§11.1, secure-framework Phase 6. A self-referential single-row write to a
// DECLARED `atomic` column — `set({ stock: stock - qty })` (lowered to a SymbolicValue
// `arith` over a `col` self-reference) — whose `where()` carries NO eq-predicate on the
// atomic column OR on a declared `version` column is a lost-update race: two concurrent
// read-decide-write requests survive auth/validation and overwrite each other. The
// compare-and-set / version guard lives in the WHERE; its presence discharges KV429.
//
// Honest ceiling (single-row only): a write whose `match` is opaque (range/IN/no key) or
// multi-row is NOT flagged — multi-row/aggregate invariants need SERIALIZABLE + retry and
// are nobody's by-construction. The DB CHECK/unique constraint is the fail-closed backstop.

/**
 * SPEC §10.3/§11.1 (KV429) — every single-row self-referential write to a declared
 * `atomic` column whose `where()` lacks a compare-and-set/`version` guard on that column.
 * Reuses the Stage-1 symbolic-effect lowering. Returns the facts the graph emission turns
 * into blocking KV429 errors.
 *
 * @internal
 */
export function extractToctouFromProject(options: TouchGraphProjectOptions): ToctouFact[] {
  const extraction = createDeriveExtraction(options);
  try {
    const concurrencyByTable = new Map<string, ConcurrencyTableInfo>();
    for (const table of extraction.tablesBySyntheticName.values()) {
      const info = concurrencyTableInfo(table);
      if (info) concurrencyByTable.set(table.annotation.name, info);
    }
    if (concurrencyByTable.size === 0) return [];

    const facts: ToctouFact[] = [];
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
        const tableSynthetic = tableSyntheticNameForDerivation(synthetic);
        if (extraction.conditionalTableTargetsBySyntheticName.has(tableSynthetic)) return undefined;
        return extraction.realTableNameBySynthetic.get(tableSynthetic) ?? synthetic;
      };

      for (const callback of deriveWriteCallbacks(sourceFile)) {
        const receivers = projectDrizzleReceivers(callback.fn);
        const paramSymbolKeys = callbackParameterSymbolKeys(callback.fn);
        const sessionContext = sessionProvenanceContextForNodes(sourceFile, [callback.body]);
        const symbolContext = symbolProvenanceContextForNodes([callback.body], {
          inputRoots: callbackInputRootNodes(callback.fn),
        });
        for (const call of touchBodyCallExpressions(callback.body)) {
          const result = symbolicEffectForWriteCall(call, {
            file,
            paramSymbolKeys,
            receivers,
            resolveTable,
            sessionContext,
            symbolContext,
            ...(callback.key ? { writeKey: callback.key } : {}),
          });
          if (!result || result.effect.op !== 'update') continue;
          const info = concurrencyByTable.get(result.effect.table);
          if (!info) continue;
          for (const fact of toctouFactsForEffect(result.effect, info, result.site, callback.key)) {
            facts.push(fact);
          }
        }
      }
    });
    return dedupeToctouFacts(facts);
  } finally {
    extraction.dispose();
  }
}

interface ConcurrencyTableInfo {
  atomic: ReadonlySet<string>;
  version: ReadonlySet<string>;
}

function concurrencyTableInfo(table: ExtractedTable): ConcurrencyTableInfo | undefined {
  const annotation = table.annotation as {
    atomic?: readonly string[];
    version?: readonly string[];
  };
  const atomic = new Set(
    (annotation.atomic ?? []).filter((c): c is string => typeof c === 'string'),
  );
  const version = new Set(
    (annotation.version ?? []).filter((c): c is string => typeof c === 'string'),
  );
  return atomic.size > 0 || version.size > 0 ? { atomic, version } : undefined;
}

function toctouFactsForEffect(
  effect: Extract<SymbolicEffect, { op: 'update' }>,
  info: ConcurrencyTableInfo,
  site: string,
  name: string | undefined,
): ToctouFact[] {
  const facts: ToctouFact[] = [];
  // The set of columns the WHERE guards by an eq-predicate. An opaque/multi-row match
  // guards nothing the gate can prove — but it is also NOT a single-row CAS, so a
  // self-referential write under an opaque match still needs the version guard we cannot
  // see; we conservatively DO NOT flag opaque/non-keys matches (honest single-row ceiling).
  if (effect.match.kind !== 'keys') return facts;
  const guardedColumns = new Set(effect.match.eq.map((eq) => eq.column));
  // A version column guarded anywhere in the WHERE discharges the CAS obligation only
  // when the same write also updates a declared version column (SPEC §10.3 KV429).
  const versionGuardedAndUpdated = [...info.version].some(
    (column) => guardedColumns.has(column) && effect.sets[column],
  );

  for (const column of info.atomic) {
    const setValue = effect.sets[column];
    if (!setValue || !valueReadsColumn(setValue, column)) continue;
    // Read-then-write on the atomic column: safe only if the WHERE eq-guards the atomic
    // column itself (true CAS) OR a declared version column.
    if (guardedColumns.has(column) || versionGuardedAndUpdated) continue;
    facts.push({ column, site, table: effect.table, ...(name ? { name } : {}) });
  }
  return facts;
}

/** Whether a SymbolicValue reads `column` of the written row (self-reference) — the read half of read-then-write. */
function valueReadsColumn(value: SymbolicValue, column: string): boolean {
  if (value.kind === 'col') return value.column === column;
  if (value.kind === 'arith') {
    return valueReadsColumn(value.left, column) || valueReadsColumn(value.right, column);
  }
  return false;
}

function dedupeToctouFacts(facts: readonly ToctouFact[]): ToctouFact[] {
  const seen = new Set<string>();
  const deduped: ToctouFact[] = [];
  for (const fact of facts) {
    const dedupeKey = `${fact.site}\0${fact.table}\0${fact.column}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(fact);
  }
  return deduped.sort(
    (left, right) =>
      left.site.localeCompare(right.site) ||
      left.table.localeCompare(right.table) ||
      left.column.localeCompare(right.column),
  );
}

// ── KV433 read-only query handle (Stage-2 static no-write-reachable) ──────────
//
// SPEC §6.6/§9.4, secure-framework Phase 5. A `query('name', { load })` loader is a
// read surface; reaching a Drizzle write (insert/update/delete/execute/run/batch) from it is the
// confused-deputy case (a state change on an idempotent GET). Stage 2 is the
// by-construction half: a static proof that a loader body contains no DIRECTLY-reachable
// Drizzle write. `query.elevated('name', …)` is the audited escape (a GET that must be
// idempotent-safe-to-repeat). Honest scope: this detects writes DIRECTLY in the loader
// body. The fully interprocedural case (a loader calling an imported `domain()` function
// that writes through a captured handle) needs the bottom-up write-summaries that are NOT
// built; that residue is a documented gap, not covered here. Stage 1 is the shipped managed
// read-only proxy handle where Kovo owns `context.db`; it is a runtime floor, while this
// direct static check is the by-construction gate.

const KV433_DIRECT_WRITE_OPERATIONS = new Set([
  'batch',
  'delete',
  'execute',
  'insert',
  'run',
  'update',
]);

/**
 * SPEC §6.6/§9.4 (KV433 Stage 2) — every `query()` loader whose body directly reaches a
 * Drizzle write, minus `query.elevated(...)` loaders (the audited escape). Returns the
 * write-reachability facts the graph emission turns into blocking KV433 errors.
 *
 * @internal
 */
export function extractQueryWriteReachabilityFromProject(
  options: TouchGraphProjectOptions,
): QueryWriteReachabilityFact[] {
  const extraction = createDeriveExtraction(options);
  try {
    const facts: QueryWriteReachabilityFact[] = [];
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
        const tableSynthetic = tableSyntheticNameForDerivation(synthetic);
        return extraction.realTableNameBySynthetic.get(tableSynthetic) ?? synthetic;
      };

      for (const loader of readOnlyQueryLoaders(sourceFile)) {
        const receivers = mergeProjectDrizzleReceivers(
          projectDrizzleReceivers(loader.fn),
          moduleScopeDrizzleReceivers(sourceFile),
        );
        for (const call of touchBodyCallExpressions(functionBody(loader.fn))) {
          const expression = call.getExpression();
          const operation = staticAccessName(expression);
          const receiver = staticAccessExpression(expression);
          if (!operation || !receiver) continue;
          if (!KV433_DIRECT_WRITE_OPERATIONS.has(operation)) continue;
          if (!isProjectDrizzleReceiverIdentifier(receiver, receivers)) continue;
          const tableArgument = call.getArguments()[0];
          const table =
            (tableArgument && resolveTable(tableArgument)) || UNRESOLVED_READ_SOURCE_EXPRESSION;
          facts.push({
            operation,
            query: loader.name,
            site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
            table,
          });
        }
      }
    });
    return facts.sort(
      (left, right) =>
        left.query.localeCompare(right.query) ||
        left.site.localeCompare(right.site) ||
        left.operation.localeCompare(right.operation),
    );
  } finally {
    extraction.dispose();
  }
}

function moduleScopeDrizzleReceivers(sourceFile: SourceFile): ProjectDrizzleReceivers {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const declarationList = declaration.getParent();
    const statement = declarationList?.getParent();
    if (!statement || !Node.isSourceFile(statement.getParent())) continue;
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;
    if (!isDrizzleReceiver(name)) continue;
    names.add(name.getText());
    const key = resolvedSymbolKey(name.getSymbol());
    if (key) symbolKeys.add(key);
  }
  return { names, symbolKeys };
}

function mergeProjectDrizzleReceivers(
  first: ProjectDrizzleReceivers,
  second: ProjectDrizzleReceivers,
): ProjectDrizzleReceivers {
  return {
    names: new Set([...first.names, ...second.names]),
    symbolKeys: new Set([...first.symbolKeys, ...second.symbolKeys]),
  };
}

/** `query('name', { load })` loaders, excluding `query.elevated(...)` (the audited GET-write escape). */
function readOnlyQueryLoaders(sourceFile: SourceFile): { fn: Node; name: string }[] {
  const loaders: { fn: Node; name: string }[] = [];
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const queryCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(queryCall)) continue;
    const expression = queryCall.getExpression();
    // `query(...)` is a read surface; `query.elevated(...)` is the audited escape.
    // SPEC §11.1 (bugz-3 H1): match the @kovojs/server `query` binding (bare/alias/namespace).
    if (!isKovoServerCalleeExpression(expression, 'query')) continue;

    const [queryArgument, bodyArgument] = queryCall.getArguments();
    if (!queryArgument || !Node.isStringLiteral(queryArgument)) continue;
    const body = queryBodyObjectLiteral(bodyArgument, 'project').body;
    if (!body) continue;
    const fn = queryLoadCallbackFunctions(body, 'project')[0];
    if (!fn) continue;
    loaders.push({ fn, name: queryArgument.getLiteralText() });
  }
  return loaders;
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
    // SPEC §11.1 (bugz-3 H1): match the @kovojs/server `query` binding (bare/alias/namespace).
    if (!isKovoServerCalleeExpression(expression, 'query')) continue;

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
  let unwrapped = shape;
  while (
    unwrapped &&
    typeof unwrapped === 'object' &&
    !Array.isArray(unwrapped) &&
    'kind' in unwrapped
  ) {
    unwrapped = (unwrapped as QueryShapeWrapper).shape;
  }
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
