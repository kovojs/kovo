import { Node, SyntaxKind, type BindingName, type SourceFile } from 'ts-morph';

import {
  propertyNameText,
  resolvedSymbolKey,
  staticAccessName,
  symbolForIdentifierReference,
  unwrappedStaticExpressionNode,
} from '../static.js';

/** @internal */
export type SymbolProvenanceKind = 'input' | 'literal' | 'server' | 'unknown';

/** @internal */
export type SymbolProvenance =
  | { kind: 'input'; path?: string }
  | { kind: 'literal' }
  | { kind: 'server'; path?: string }
  | { kind: 'unknown' };

/** @internal */
export interface SymbolProvenanceContext {
  aliases: ReadonlyMap<string, SymbolProvenance>;
  inputSymbolKeys: ReadonlySet<string>;
  serverSymbolKeys: ReadonlySet<string>;
  /**
   * Symbol keys of same-package helpers declared
   * `kovoAnalyzerSummary(fn, { returns: { kind: 'server' } })`. A call to such a
   * helper resolves to `server` provenance — the audited interprocedural escape
   * for the write-provenance gate (SPEC §11.1). This is the ONLY way a
   * `CallExpression` produces non-`unknown` provenance; an unsummarized call stays
   * `unknown` (fail-closed), which is what keeps KV435/IDOR confidentiality sound.
   */
  serverSummaryKeys: ReadonlySet<string>;
}

/** @internal */
export interface SymbolProvenanceContextOptions {
  inputRoots?: readonly Node[];
  serverRoots?: readonly Node[];
  /** Symbol keys of `kovoAnalyzerSummary(fn, { returns: { kind: 'server' } })` helpers. */
  serverSummaryKeys?: Iterable<string>;
}

const inputProvenance: SymbolProvenance = { kind: 'input', path: '' };
const literalProvenance: SymbolProvenance = { kind: 'literal' };
const serverProvenance: SymbolProvenance = { kind: 'server', path: '' };
const unknownProvenance: SymbolProvenance = { kind: 'unknown' };

/** @internal */
export function symbolProvenanceContextForNodes(
  bodies: readonly Node[],
  options: SymbolProvenanceContextOptions = {},
): SymbolProvenanceContext {
  const inputSymbolKeys = new Set(symbolKeysForNodes(options.inputRoots ?? []));
  const serverSymbolKeys = new Set(symbolKeysForNodes(options.serverRoots ?? []));
  const serverSummaryKeys = new Set(options.serverSummaryKeys ?? []);
  const aliases = new Map<string, SymbolProvenance>();
  const context: SymbolProvenanceContext = {
    aliases,
    inputSymbolKeys,
    serverSymbolKeys,
    serverSummaryKeys,
  };

  for (const body of bodies) {
    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      assignBindingProvenance(
        declaration.getNameNode(),
        symbolProvenanceForExpression(initializer, context),
        aliases,
      );
    }

    for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getText() !== '=') continue;
      assignBindingProvenance(
        assignment.getLeft(),
        symbolProvenanceForExpression(assignment.getRight(), context),
        aliases,
      );
    }
  }

  return context;
}

/** @internal */
export function symbolProvenanceForExpression(
  node: Node,
  context: SymbolProvenanceContext,
  depth = 0,
): SymbolProvenance {
  if (depth > 8) return unknownProvenance;
  const expression = unwrappedStaticExpressionNode(node);

  if (literalValueNode(expression)) return literalProvenance;

  if (Node.isIdentifier(expression)) {
    const symbolKey = symbolKeyForNode(expression);
    if (symbolKey && context.aliases.has(symbolKey)) {
      return context.aliases.get(symbolKey) ?? unknownProvenance;
    }
    if (symbolKey && context.inputSymbolKeys.has(symbolKey)) return inputProvenance;
    if (symbolKey && context.serverSymbolKeys.has(symbolKey)) return serverProvenance;
    return unknownProvenance;
  }

  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const base = symbolProvenanceForExpression(expression.getExpression(), context, depth + 1);
    const name = staticAccessName(expression);
    return base.kind === 'literal'
      ? unknownProvenance
      : name
        ? appendSymbolProvenancePath(base, name)
        : base;
  }

  if (Node.isObjectLiteralExpression(expression)) {
    let provenance = literalProvenance;
    for (const property of expression.getProperties()) {
      if (Node.isSpreadAssignment(property)) return unknownProvenance;
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        if (!initializer) return unknownProvenance;
        provenance = joinSymbolProvenance(
          provenance,
          symbolProvenanceForExpression(initializer, context, depth + 1),
        );
        continue;
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        provenance = joinSymbolProvenance(
          provenance,
          symbolProvenanceForExpression(property.getNameNode(), context, depth + 1),
        );
        continue;
      }
      return unknownProvenance;
    }
    return provenance;
  }

  if (Node.isArrayLiteralExpression(expression)) {
    let provenance = literalProvenance;
    for (const element of expression.getElements()) {
      provenance = joinSymbolProvenance(
        provenance,
        symbolProvenanceForExpression(element, context, depth + 1),
      );
    }
    return provenance;
  }

  if (Node.isConditionalExpression(expression)) {
    return joinSymbolProvenance(
      symbolProvenanceForExpression(expression.getCondition(), context, depth + 1),
      symbolProvenanceForExpression(expression.getWhenTrue(), context, depth + 1),
      symbolProvenanceForExpression(expression.getWhenFalse(), context, depth + 1),
    );
  }

  if (Node.isBinaryExpression(expression)) {
    return joinSymbolProvenance(
      symbolProvenanceForExpression(expression.getLeft(), context, depth + 1),
      symbolProvenanceForExpression(expression.getRight(), context, depth + 1),
    );
  }

  if (Node.isPrefixUnaryExpression(expression)) {
    return symbolProvenanceForExpression(expression.getOperand(), context, depth + 1);
  }

  // Minimal interprocedural branch (SPEC §11.1): a call to a same-package helper
  // declared `kovoAnalyzerSummary(fn, { returns: { kind: 'server' } })` is server
  // provenance. EVERY other call stays `unknown` (fail-closed) — the argument
  // provenance is intentionally NOT propagated, so `serverHelper(input.x)` does not
  // launder input into server, and an unsummarized helper never escapes input. This
  // is the only `CallExpression` source of non-`unknown` provenance; it cannot relax
  // KV435/IDOR confidentiality (those consumers never populate `serverSummaryKeys`).
  if (Node.isCallExpression(expression) && context.serverSummaryKeys.size > 0) {
    const callee = unwrappedStaticExpressionNode(expression.getExpression());
    if (Node.isIdentifier(callee)) {
      const calleeKey = symbolKeyForNode(callee);
      if (calleeKey && context.serverSummaryKeys.has(calleeKey)) {
        return serverProvenance;
      }
    }
  }

  return unknownProvenance;
}

/** @internal */
export function provenServerProvenanceForExpression(
  node: Node,
  context: SymbolProvenanceContext,
): Extract<SymbolProvenance, { kind: 'server' }> | undefined {
  const provenance = symbolProvenanceForExpression(node, context);
  return provenance.kind === 'server' ? provenance : undefined;
}

/** @internal */
export function provenInputProvenanceForExpression(
  node: Node,
  context: SymbolProvenanceContext,
): Extract<SymbolProvenance, { kind: 'input' }> | undefined {
  const provenance = symbolProvenanceForExpression(node, context);
  return provenance.kind === 'input' ? provenance : undefined;
}

/** @internal */
export function joinSymbolProvenance(
  first: SymbolProvenance,
  ...rest: readonly SymbolProvenance[]
): SymbolProvenance {
  return [first, ...rest].reduce((left, right): SymbolProvenance => {
    if (left.kind === 'unknown' || right.kind === 'unknown') return unknownProvenance;
    if (left.kind === 'input' || right.kind === 'input') {
      return inputSymbolProvenance(
        left.kind === 'input' && right.kind === 'input' ? commonPath(left, right) : undefined,
      );
    }
    if (left.kind === 'server' || right.kind === 'server') {
      return serverSymbolProvenance(
        left.kind === 'server' && right.kind === 'server' ? commonPath(left, right) : undefined,
      );
    }
    return literalProvenance;
  });
}

/** @internal */
export function appendSymbolProvenancePath(
  provenance: SymbolProvenance,
  segment: string,
): SymbolProvenance {
  if (provenance.kind === 'input') {
    return inputSymbolProvenance(
      provenance.path === undefined ? undefined : joinPath(provenance.path, segment),
    );
  }
  if (provenance.kind === 'server') {
    return serverSymbolProvenance(
      provenance.path === undefined ? undefined : joinPath(provenance.path, segment),
    );
  }
  return provenance;
}

function inputSymbolProvenance(path: string | undefined): SymbolProvenance {
  return path === undefined ? { kind: 'input' } : { kind: 'input', path };
}

function serverSymbolProvenance(path: string | undefined): SymbolProvenance {
  return path === undefined ? { kind: 'server' } : { kind: 'server', path };
}

function assignBindingProvenance(
  binding: Node,
  provenance: SymbolProvenance,
  aliases: Map<string, SymbolProvenance>,
): void {
  if (Node.isIdentifier(binding)) {
    const key = symbolKeyForNode(binding);
    if (key) aliases.set(key, joinExistingAlias(aliases.get(key), provenance));
    return;
  }

  if (!Node.isObjectBindingPattern(binding)) return;
  for (const element of binding.getElements()) {
    const name = element.getNameNode();
    const propertyName = element.getPropertyNameNode();
    const field = propertyName ? propertyNameText(propertyName) : bindingNameText(name);
    if (!field) continue;
    assignBindingProvenance(name, appendSymbolProvenancePath(provenance, field), aliases);
  }
}

function commonPath(
  left: Extract<SymbolProvenance, { kind: 'input' | 'server' }>,
  right: Extract<SymbolProvenance, { kind: 'input' | 'server' }>,
): string | undefined {
  return left.path === right.path ? left.path : undefined;
}

function joinPath(base: string, segment: string): string {
  return base.length === 0 ? segment : `${base}.${segment}`;
}

function joinExistingAlias(
  current: SymbolProvenance | undefined,
  next: SymbolProvenance,
): SymbolProvenance {
  return current ? joinSymbolProvenance(current, next) : next;
}

/**
 * Symbol keys of same-package helpers declared
 * `kovoAnalyzerSummary(fn, { returns: { kind: 'server' } })`. Mirrors the session-
 * provenance analyzer-summary scan, but collects only the `server` kind for the
 * write-provenance gate (SPEC §11.1). Confidentiality consumers (KV435/IDOR) do not
 * call this, so the interprocedural `server` source never reaches them.
 *
 * @internal
 */
export function serverSummaryKeysForSourceFile(sourceFile: SourceFile): Set<string> {
  const keys = new Set<string>();
  const summaries = analyzerSummaryImports(sourceFile);
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrappedStaticExpressionNode(call.getExpression());
    if (!isAnalyzerSummaryCall(callee, summaries)) continue;

    const [helper, summary] = call.getArguments();
    if (!helper || !summary) continue;
    if (analyzerSummaryReturnKind(summary) !== 'server') continue;

    const helperExpression = unwrappedStaticExpressionNode(helper);
    const symbol = Node.isIdentifier(helperExpression)
      ? symbolForIdentifierReference(helperExpression)
      : helperExpression.getSymbol();
    const key = resolvedSymbolKey(symbol);
    if (key) keys.add(key);
  }
  return keys;
}

interface AnalyzerSummaryImports {
  names: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
}

function analyzerSummaryImports(sourceFile: SourceFile): AnalyzerSummaryImports {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== '@kovojs/drizzle') continue;
    const namespace = declaration.getNamespaceImport();
    if (namespace) namespaces.add(namespace.getText());
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === 'kovoAnalyzerSummary') {
        names.add(named.getAliasNode()?.getText() ?? 'kovoAnalyzerSummary');
      }
    }
  }
  return { names, namespaces };
}

function isAnalyzerSummaryCall(callee: Node, imports: AnalyzerSummaryImports): boolean {
  if (Node.isIdentifier(callee)) return imports.names.has(callee.getText());
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  return (
    Node.isIdentifier(receiver) &&
    imports.namespaces.has(receiver.getText()) &&
    callee.getName() === 'kovoAnalyzerSummary'
  );
}

function analyzerSummaryReturnKind(node: Node): string | undefined {
  const object = unwrappedStaticExpressionNode(node);
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const returns = objectLiteralPropertyInitializer(object, 'returns');
  const returnsObject = returns ? unwrappedStaticExpressionNode(returns) : undefined;
  if (!returnsObject || !Node.isObjectLiteralExpression(returnsObject)) return undefined;
  const kindNode = objectLiteralPropertyInitializer(returnsObject, 'kind');
  const kindExpression = kindNode ? unwrappedStaticExpressionNode(kindNode) : undefined;
  return kindExpression &&
    (Node.isStringLiteral(kindExpression) || Node.isNoSubstitutionTemplateLiteral(kindExpression))
    ? kindExpression.getLiteralText()
    : undefined;
}

function objectLiteralPropertyInitializer(node: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;
    return property.getInitializer();
  }
  return undefined;
}

function symbolKeysForNodes(nodes: readonly Node[]): string[] {
  return nodes.flatMap((node) => {
    if (Node.isObjectBindingPattern(node)) {
      return node
        .getElements()
        .map((element) => symbolKeyForNode(element.getNameNode()))
        .filter((key): key is string => key !== undefined);
    }
    const key = symbolKeyForNode(node);
    return key ? [key] : [];
  });
}

function symbolKeyForNode(node: Node): string | undefined {
  if (Node.isIdentifier(node)) {
    return resolvedSymbolKey(symbolForIdentifierReference(node) ?? node.getSymbol());
  }
  return resolvedSymbolKey(node.getSymbol());
}

function bindingNameText(node: BindingName): string | undefined {
  return Node.isIdentifier(node) ? node.getText() : staticAccessName(node);
}

function literalValueNode(node: Node): boolean {
  return (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    node.getKind() === SyntaxKind.TrueKeyword ||
    node.getKind() === SyntaxKind.FalseKeyword ||
    node.getKind() === SyntaxKind.NullKeyword
  );
}
