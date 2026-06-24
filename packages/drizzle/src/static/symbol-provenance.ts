import { Node, SyntaxKind, type BindingName } from 'ts-morph';

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
}

/** @internal */
export interface SymbolProvenanceContextOptions {
  inputRoots?: readonly Node[];
  serverRoots?: readonly Node[];
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
  const aliases = new Map<string, SymbolProvenance>();
  const context: SymbolProvenanceContext = { aliases, inputSymbolKeys, serverSymbolKeys };

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
