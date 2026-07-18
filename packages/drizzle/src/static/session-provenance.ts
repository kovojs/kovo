import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type BindingElement,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type ObjectBindingPattern,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from 'ts-morph';

import {
  propertyNameText,
  resolvedSymbolKey,
  staticAccessName,
  staticAccessSegments,
  symbolForIdentifierReference,
  unwrappedStaticExpressionNode,
  unsummarizedHelperReason,
  type PrivateScopeKind,
  type PrivateScopeProvenance,
  type SessionAlias,
  type SessionProvenanceContext,
} from '../static.js';
import { expressionResolvesToFrameworkExport, frameworkExport } from './framework-identity.js';
import { isDrizzleDatabaseTypeAnnotation } from './schema.js';

/** @internal */ export function emptySessionProvenanceContext(): SessionProvenanceContext {
  return { aliases: new Map(), helpers: new Map(), opaqueAliases: new Map() };
}

/** @internal */ export function sessionProvenanceContextForNodes(
  sourceFile: SourceFile,
  bodies: readonly Node[],
): SessionProvenanceContext {
  // SPEC §6.6/§10.3: an app-authored declaration is only a candidate marker. It
  // cannot mint private-scope provenance. The analyzer admits the helper below
  // only after proving an exact same-file, one-parameter/one-return projection.
  const helpers = analyzerHelperSummariesForSourceFile(sourceFile);
  const aliases = new Map<string, SessionAlias>();
  const opaqueAliases = new Map<string, string>();
  const context: SessionProvenanceContext = { aliases, helpers, opaqueAliases };

  for (const body of bodies) {
    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      addSessionAliasesForVariableDeclaration(declaration, context, aliases);
    }
  }

  return context;
}

function analyzerHelperSummariesForSourceFile(
  sourceFile: SourceFile,
): Map<string, PrivateScopeProvenance> {
  const summaries = new Map<string, PrivateScopeProvenance>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrappedStaticExpressionNode(call.getExpression());
    if (
      !expressionResolvesToFrameworkExport(
        callee,
        frameworkExport('@kovojs/drizzle', 'kovoAnalyzerSummary'),
      )
    ) {
      continue;
    }

    const [helper, summary] = call.getArguments();
    if (!helper || !summary) continue;

    const key = helperSymbolKeyForSummary(helper);
    const declared = analyzerSummaryReturnProvenance(summary);
    const proven = exactLocalPrivateScopeHelperProvenance(helper, sourceFile);
    if (!key || !declared || !proven) continue;
    if (privateScopeKey(declared) !== privateScopeKey(proven)) continue;
    summaries.set(key, proven);
  }
  addLocalHelperSummaryAliases(sourceFile, summaries);
  return summaries;
}

function helperSymbolKeyForSummary(node: Node): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const symbol = Node.isIdentifier(expression)
    ? symbolForIdentifierReference(expression)
    : expression.getSymbol();
  return resolvedSymbolKey(symbol);
}

type ExactLocalFunction =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | MethodDeclaration;

function exactLocalPrivateScopeHelperProvenance(
  node: Node,
  sourceFile: SourceFile,
): PrivateScopeProvenance | undefined {
  const helper = exactLocalFunctionDeclaration(node, sourceFile);
  if (!helper) return undefined;
  if (!Node.isArrowFunction(helper) && helper.getAsteriskToken()) return undefined;

  const parameters = helper.getParameters();
  if (parameters.length !== 1) return undefined;
  const parameterDeclaration = parameters[0];
  if (
    !parameterDeclaration ||
    parameterDeclaration.getInitializer() ||
    parameterDeclaration.getDotDotDotToken()
  ) {
    return undefined;
  }
  const parameter = parameterDeclaration.getNameNode();
  if (!parameter || !Node.isIdentifier(parameter)) return undefined;

  const returned = exactSingleReturnExpression(helper);
  if (!returned) return undefined;
  const segments = staticAccessSegments(returned);
  if (!segments || !Node.isIdentifier(segments.root)) return undefined;

  const parameterKey = resolvedSymbolKey(parameter.getSymbol());
  const rootKey = resolvedSymbolKey(symbolForIdentifierReference(segments.root));
  if (!parameterKey || rootKey !== parameterKey) return undefined;

  const privateScopeIndex = segments.path.findIndex(isPrivateScopeKind);
  if (privateScopeIndex < 0) return undefined;
  const kind = segments.path[privateScopeIndex];
  if (!isPrivateScopeKind(kind)) return undefined;
  return {
    kind,
    path: segments.path.slice(privateScopeIndex + 1).join('.'),
    requiresGuard: false,
  };
}

function exactLocalFunctionDeclaration(
  node: Node,
  sourceFile: SourceFile,
): ExactLocalFunction | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const symbol = Node.isIdentifier(expression)
    ? symbolForIdentifierReference(expression)
    : expression.getSymbol();
  const declarations = symbol
    ?.getDeclarations()
    .filter((declaration) => declaration.getSourceFile() === sourceFile);
  if (declarations?.length !== 1) return undefined;

  let declaration: Node | undefined = declarations[0];
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    declaration = declaration.getInitializer();
  }
  return declaration &&
    (Node.isArrowFunction(declaration) ||
      Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isMethodDeclaration(declaration))
    ? declaration
    : undefined;
}

function exactSingleReturnExpression(helper: ExactLocalFunction): Node | undefined {
  const body = helper.getBody();
  if (!body) return undefined;
  if (!Node.isBlock(body)) return body;
  const statements = body.getStatements();
  if (statements.length !== 1 || !Node.isReturnStatement(statements[0])) return undefined;
  return statements[0].getExpression();
}

function addLocalHelperSummaryAliases(
  sourceFile: SourceFile,
  summaries: Map<string, PrivateScopeProvenance>,
): void {
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;

    const declarationList = declaration.getParent();
    if (!Node.isVariableDeclarationList(declarationList)) continue;
    if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;

    const provenance = helperSummaryForStaticReference(initializer, summaries);
    if (!provenance) continue;

    const key = resolvedSymbolKey(symbolForIdentifierReference(name) ?? name.getSymbol());
    if (key) summaries.set(key, provenance);
  }
}

function helperSummaryForStaticReference(
  node: Node,
  summaries: ReadonlyMap<string, PrivateScopeProvenance>,
): PrivateScopeProvenance | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const key = resolvedSymbolKey(symbolForIdentifierReference(expression) ?? expression.getSymbol());
  return key ? summaries.get(key) : undefined;
}

function analyzerSummaryReturnProvenance(node: Node): PrivateScopeProvenance | undefined {
  const object = unwrappedStaticExpressionNode(node);
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const returns = objectLiteralPropertyInitializer(object, 'returns');
  const returnsObject = returns ? unwrappedStaticExpressionNode(returns) : undefined;
  if (!returnsObject || !Node.isObjectLiteralExpression(returnsObject)) return undefined;

  const kind = objectLiteralStringProperty(returnsObject, 'kind');
  const path = objectLiteralStringProperty(returnsObject, 'path');
  if (!isPrivateScopeKind(kind) || path === undefined) return undefined;

  return { kind, path, requiresGuard: false };
}

function objectLiteralPropertyInitializer(
  object: ObjectLiteralExpression,
  name: string,
): Node | undefined {
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;
    return property.getInitializer();
  }
  return undefined;
}

function objectLiteralStringProperty(
  object: ObjectLiteralExpression,
  name: string,
): string | undefined {
  const value = objectLiteralPropertyInitializer(object, name);
  const expression = value ? unwrappedStaticExpressionNode(value) : undefined;
  return Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)
    ? expression.getLiteralText()
    : undefined;
}

function isPrivateScopeKind(kind: string | undefined): kind is PrivateScopeKind {
  return kind === 'guard' || kind === 'session' || kind === 'tenant';
}

function addSessionAliasesForVariableDeclaration(
  declaration: VariableDeclaration,
  context: SessionProvenanceContext,
  aliases: Map<string, SessionAlias>,
): void {
  const initializer = declaration.getInitializer();
  if (!initializer) return;

  const nameNode = declaration.getNameNode();
  if (Node.isIdentifier(nameNode)) {
    const provenance =
      privateScopeForExpression(initializer, context) ??
      directPrivateScopeForExpression(initializer);
    const key = resolvedSymbolKey(symbolForIdentifierReference(nameNode) ?? nameNode.getSymbol());
    if (provenance && key) {
      aliases.set(key, {
        declaration,
        kind: provenance.kind,
        name: nameNode.getText(),
        path: provenance.path,
        requiresGuard: provenance.requiresGuard ?? true,
      });
    } else if (provenance) {
      aliases.set(`name:${nameNode.getText()}`, {
        declaration,
        kind: provenance.kind,
        name: nameNode.getText(),
        path: provenance.path,
        requiresGuard: provenance.requiresGuard ?? true,
      });
    } else {
      const opaqueReason = unsummarizedHelperReasonForExpression(initializer);
      if (opaqueReason && key) {
        context.opaqueAliases.set(key, opaqueReason);
      } else if (opaqueReason) {
        context.opaqueAliases.set(`name:${nameNode.getText()}`, opaqueReason);
      }
    }
    return;
  }

  if (!Node.isObjectBindingPattern(nameNode)) return;
  const base =
    privateScopeForExpression(initializer, context) ?? directPrivateScopeForExpression(initializer);
  // A base-less `const { session } = X` destructuring only resolves to private scope when
  // the destructured source `X` is itself a proven carrier (SPEC §6.5); `const { session }
  // = input` must NOT mint a session alias from a client-input field name (H3/H5 sibling).
  const sourceIsCarrier = base !== undefined || isPrivateScopeCarrierExpression(initializer);
  addPrivateScopeAliasesForObjectBindingPattern(nameNode, base, aliases, sourceIsCarrier);
}

function isPrivateScopeCarrierExpression(node: Node): boolean {
  const segments = staticAccessSegments(node);
  return segments !== undefined && isPrivateScopeCarrierRoot(segments.root);
}

function addPrivateScopeAliasesForObjectBindingPattern(
  pattern: ObjectBindingPattern,
  base: PrivateScopeProvenance | undefined,
  aliases: Map<string, SessionAlias>,
  sourceIsCarrier: boolean,
): void {
  for (const binding of privateScopeBindingsFromObjectBindingPattern(
    pattern,
    base,
    sourceIsCarrier,
  )) {
    const key = resolvedSymbolKey(
      symbolForIdentifierReference(binding.identifier) ?? binding.identifier.getSymbol(),
    );
    if (key) {
      aliases.set(key, {
        declaration: binding.declaration,
        kind: binding.provenance.kind,
        name: binding.identifier.getText(),
        path: binding.provenance.path,
        requiresGuard: binding.provenance.requiresGuard ?? true,
      });
    } else {
      aliases.set(`name:${binding.identifier.getText()}`, {
        declaration: binding.declaration,
        kind: binding.provenance.kind,
        name: binding.identifier.getText(),
        path: binding.provenance.path,
        requiresGuard: binding.provenance.requiresGuard ?? true,
      });
    }
  }
}

interface PrivateScopeBinding {
  declaration: BindingElement;
  identifier: Node & { getText(): string };
  provenance: PrivateScopeProvenance;
}

function privateScopeBindingsFromObjectBindingPattern(
  pattern: ObjectBindingPattern,
  base: PrivateScopeProvenance | undefined,
  sourceIsCarrier: boolean,
): PrivateScopeBinding[] {
  const bindings: PrivateScopeBinding[] = [];
  collectPrivateScopeBindingsFromObjectBindingPattern(
    pattern,
    base,
    sourceIsCarrier,
    [],
    [],
    bindings,
  );
  return bindings;
}

function collectPrivateScopeBindingsFromObjectBindingPattern(
  pattern: ObjectBindingPattern,
  base: PrivateScopeProvenance | undefined,
  sourceIsCarrier: boolean,
  segments: readonly string[],
  segmentElements: readonly BindingElement[],
  bindings: PrivateScopeBinding[],
): void {
  for (const element of pattern.getElements()) {
    const binding = element.getNameNode();
    const propertyName = element.getPropertyNameNode();
    const segment = propertyName ? propertyNameText(propertyName) : binding.getText();
    if (!segment) continue;

    const nextSegments = [...segments, segment];
    const nextSegmentElements = [...segmentElements, element];
    if (Node.isObjectBindingPattern(binding)) {
      collectPrivateScopeBindingsFromObjectBindingPattern(
        binding,
        base,
        sourceIsCarrier,
        nextSegments,
        nextSegmentElements,
        bindings,
      );
      continue;
    }
    if (!Node.isIdentifier(binding)) continue;

    const provenance = objectBindingPrivateScopeProvenance(
      base,
      sourceIsCarrier,
      nextSegments,
      nextSegmentElements,
    );
    if (!provenance) continue;
    bindings.push({ declaration: element, identifier: binding, provenance });
  }
}

function objectBindingPrivateScopeProvenance(
  base: PrivateScopeProvenance | undefined,
  sourceIsCarrier: boolean,
  segments: readonly string[],
  segmentElements: readonly BindingElement[],
): PrivateScopeProvenance | undefined {
  if (base) {
    const provenance: PrivateScopeProvenance = {
      kind: base.kind,
      path: joinPrivateScopePath(base.path, segments.join('.')),
    };
    if (base.requiresGuard !== undefined) provenance.requiresGuard = base.requiresGuard;
    return provenance;
  }

  // Without a base scope, the `session`/`guard`/`tenant` name match only holds when the
  // destructured source is a proven carrier (SPEC §6.5) — never a client-input bag.
  if (!sourceIsCarrier) return undefined;

  const privateIndex = segments.findIndex(isPrivateScopeKind);
  if (privateIndex < 0) return undefined;
  return {
    kind: segments[privateIndex] as PrivateScopeKind,
    path: segments.slice(privateIndex + 1).join('.'),
    requiresGuard: bindingElementValueRequiresGuard(segmentElements[privateIndex]),
  };
}

function bindingElementValueRequiresGuard(element: BindingElement | undefined): boolean {
  if (!element) return true;
  const type = element.getType();
  const nullable = (type as { isNullable?: () => boolean }).isNullable?.();
  if (nullable) return true;
  return /\bnull\b|\bundefined\b/.test(type.getText());
}

/** @internal */ export function privateScopeForExpression(
  node: Node,
  context: SessionProvenanceContext,
  depth = 0,
): PrivateScopeProvenance | undefined {
  if (depth > 4) return undefined;
  const expression = unwrappedStaticExpressionNode(node);

  const direct = directPrivateScopeForExpression(expression);
  if (direct) {
    return !direct.requiresGuard || directPrivateScopeGuardDominatesUse(direct, expression)
      ? { kind: direct.kind, path: direct.path }
      : undefined;
  }

  if (Node.isIdentifier(expression)) {
    const key = resolvedSymbolKey(
      symbolForIdentifierReference(expression) ?? expression.getSymbol(),
    );
    if (
      (key ? context.opaqueAliases.get(key) : undefined) ??
      context.opaqueAliases.get(`name:${expression.getText()}`)
    ) {
      return undefined;
    }
    const alias =
      (key ? context.aliases.get(key) : undefined) ??
      [...context.aliases.values()].find((candidate) => candidate.name === expression.getText());
    return alias && (!alias.requiresGuard || sessionAliasGuardDominatesUse(alias, expression))
      ? { kind: alias.kind, path: alias.path }
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const objectProperty = localObjectPropertyPrivateScope(expression, context, depth);
    if (objectProperty) return objectProperty;

    const base = privateScopeForExpression(expression.getExpression(), context, depth + 1);
    const name = staticAccessName(expression);
    return base && name
      ? { kind: base.kind, path: joinPrivateScopePath(base.path, name) }
      : undefined;
  }

  if (Node.isCallExpression(expression)) {
    const callee = unwrappedStaticExpressionNode(expression.getExpression());
    return privateScopeHelperCallCarrierIsProven(expression)
      ? helperSummaryForCallCallee(callee, context.helpers)
      : undefined;
  }

  return undefined;
}

/**
 * Exact call-site half of the private-helper proof. The verified helper's sole
 * parameter must receive the request/context carrier itself, never client input,
 * an object/container field, or another opaque expression (SPEC §6.6/§10.3).
 *
 * @internal
 */
export function privateScopeHelperCallCarrierIsProven(call: CallExpression): boolean {
  const carrier = call.getArguments()[0];
  return (
    carrier !== undefined &&
    isPrivateScopeCarrierRoot(carrier) &&
    privateScopeHelperCarrierBindingIsProven(carrier)
  );
}

function privateScopeHelperCarrierBindingIsProven(carrier: Node): boolean {
  const root = unwrappedStaticExpressionNode(carrier);
  if (Node.isThisExpression(root)) return true;
  if (!Node.isIdentifier(root)) return false;

  const symbol = symbolForIdentifierReference(root) ?? root.getSymbol();
  const parameters = symbol
    ?.getDeclarations()
    .filter((declaration): declaration is ParameterDeclaration =>
      Node.isParameterDeclaration(declaration),
    );
  if (parameters?.length !== 1) return false;
  const parameter = parameters[0];
  if (
    !parameter ||
    parameter.getInitializer() ||
    parameter.getDotDotDotToken() ||
    !Node.isIdentifier(parameter.getNameNode())
  ) {
    return false;
  }

  const callable = parameter.getParent();
  if (
    !Node.isArrowFunction(callable) &&
    !Node.isFunctionDeclaration(callable) &&
    !Node.isFunctionExpression(callable) &&
    !Node.isMethodDeclaration(callable)
  ) {
    return false;
  }
  const callableParameters = callable.getParameters();
  const index = callableParameters.indexOf(parameter);
  if (index < 0) return false;

  // Legacy/static Drizzle extraction callbacks place the managed DB receiver between
  // validated input and private request context. An allowed-name parameter before that
  // receiver is still attacker input even if the author calls it `request` or `ctx`.
  const receiverIndex = callableParameters.findIndex(isDrizzleDatabaseTypeAnnotation);
  if (receiverIndex >= 0) return index > receiverIndex;

  const frameworkRole = exactFrameworkPrivateScopeCarrierRole(callable, index);
  if (frameworkRole !== undefined) return frameworkRole;

  // Outside an exact framework callback, a leading parameter has no structural role
  // proving it is anything other than input. A later request/context parameter remains
  // compatible with the framework's `(input, context)` callback convention.
  return index > 0;
}

function exactFrameworkPrivateScopeCarrierRole(
  callable: ExactLocalFunction,
  index: number,
): boolean | undefined {
  const owner = Node.isMethodDeclaration(callable)
    ? callable
    : callable.getParentIfKind(SyntaxKind.PropertyAssignment);
  const record = owner?.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
  const declaration = record?.getParentIfKind(SyntaxKind.CallExpression);
  const callback = owner ? propertyNameText(owner.getNameNode()) : undefined;
  if (!declaration || !callback) return undefined;

  const exactFactory = (name: 'endpoint' | 'mutation' | 'query' | 'task' | 'webhook'): boolean =>
    expressionResolvesToFrameworkExport(
      declaration.getExpression(),
      frameworkExport('@kovojs/server', name),
    );
  if (exactFactory('endpoint') && callback === 'handler') return index === 0;
  if (exactFactory('mutation')) {
    if (callback === 'handler') return index === 1;
    if (callback === 'guard') return index === 0;
    return false;
  }
  if (exactFactory('query')) {
    if (callback === 'load') return index === 1;
    if (callback === 'guard') return index === 0;
    return false;
  }
  if (exactFactory('task') && callback === 'run') return index === 1;
  if (exactFactory('webhook') && callback === 'handler') return index === 1;
  return undefined;
}

/**
 * KV438's `serverValue(value, reason)` escape asks a narrower question than the
 * owner-scope audit: did `value` come from framework-owned private request scope
 * rather than client input? It intentionally ignores guard dominance and accepts
 * literal fallbacks for optional session reads, while leaving KV414's stricter
 * `privateScopeForExpression` path unchanged.
 */
/** @internal */ export function privateScopeSourceForExpression(
  node: Node,
  context: SessionProvenanceContext,
  depth = 0,
): PrivateScopeProvenance | undefined {
  if (depth > 8) return undefined;
  const expression = unwrappedStaticExpressionNode(node);

  const direct = directPrivateScopeForExpression(expression);
  if (direct) return { kind: direct.kind, path: direct.path };

  if (Node.isIdentifier(expression)) {
    const alias = privateScopeAliasForIdentifier(expression, context);
    if (alias && isConstVariableBindingDeclaration(alias.declaration)) {
      return { kind: alias.kind, path: alias.path };
    }

    const symbol = symbolForIdentifierReference(expression) ?? expression.getSymbol();
    const declaration = symbol?.getDeclarations()?.[0];
    if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
    if (!isConstVariableBindingDeclaration(declaration)) return undefined;
    const initializer = declaration.getInitializer();
    return initializer
      ? privateScopeSourceForExpression(initializer, context, depth + 1)
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const objectProperty = localObjectPropertyPrivateScope(expression, context, depth);
    if (objectProperty) return objectProperty;

    const base = privateScopeSourceForExpression(expression.getExpression(), context, depth + 1);
    const name = staticAccessName(expression);
    return base && name
      ? { kind: base.kind, path: joinPrivateScopePath(base.path, name) }
      : undefined;
  }

  if (Node.isBinaryExpression(expression) && isSafePrivateScopeFallbackExpression(expression)) {
    const left = expression.getLeft();
    const right = expression.getRight();
    const leftScope = privateScopeSourceForExpression(left, context, depth + 1);
    if (leftScope && literalFallbackExpression(right)) return leftScope;
    const rightScope = privateScopeSourceForExpression(right, context, depth + 1);
    if (rightScope && literalFallbackExpression(left)) return rightScope;
  }

  return undefined;
}

function isConstVariableBindingDeclaration(declaration: Node): boolean {
  const declarationList = Node.isVariableDeclaration(declaration)
    ? declaration.getParent()
    : declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList);
  return (
    !!declarationList &&
    Node.isVariableDeclarationList(declarationList) &&
    (declarationList.getDeclarationKind?.() ?? 'const') === 'const'
  );
}

function privateScopeAliasForIdentifier(
  expression: Node & { getText(): string },
  context: SessionProvenanceContext,
): SessionAlias | undefined {
  const key = resolvedSymbolKey(symbolForIdentifierReference(expression) ?? expression.getSymbol());
  return (
    (key ? context.aliases.get(key) : undefined) ??
    [...context.aliases.values()].find((candidate) => candidate.name === expression.getText())
  );
}

function isSafePrivateScopeFallbackExpression(node: Node): boolean {
  if (!Node.isBinaryExpression(node)) return false;
  const operator = node.getOperatorToken().getText();
  return operator === '??' || operator === '||';
}

function literalFallbackExpression(node: Node): boolean {
  const expression = unwrappedStaticExpressionNode(node);
  return (
    Node.isStringLiteral(expression) ||
    Node.isNoSubstitutionTemplateLiteral(expression) ||
    Node.isNumericLiteral(expression) ||
    expression.getKind() === SyntaxKind.TrueKeyword ||
    expression.getKind() === SyntaxKind.FalseKeyword ||
    expression.getKind() === SyntaxKind.NullKeyword
  );
}

function localObjectPropertyPrivateScope(
  node: Node,
  context: SessionProvenanceContext,
  depth: number,
): PrivateScopeProvenance | undefined {
  if (depth > 4) return undefined;
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) {
    return undefined;
  }

  const property = staticAccessName(node);
  if (!property) return undefined;

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
  const object = initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  if (!object || !Node.isObjectLiteralExpression(object)) return undefined;

  const value = objectLiteralStaticPropertyValue(object, property);
  if (!value) return undefined;
  return (
    privateScopeForExpression(value, context, depth + 1) ?? directPrivateScopeForExpression(value)
  );
}

function objectLiteralStaticPropertyValue(
  object: ObjectLiteralExpression,
  name: string,
): Node | undefined {
  let value: Node | undefined;
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) return undefined;

    if (Node.isPropertyAssignment(property)) {
      if (propertyNameText(property.getNameNode()) !== name) continue;
      if (value) return undefined;
      value = property.getInitializer();
      continue;
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      if (propertyNameText(property.getNameNode()) !== name) continue;
      if (value) return undefined;
      value = property.getNameNode();
    }
  }
  return value;
}

function helperSummaryForCallCallee(
  callee: Node,
  helpers: ReadonlyMap<string, PrivateScopeProvenance>,
): PrivateScopeProvenance | undefined {
  const key = resolvedSymbolKey(symbolForIdentifierReference(callee) ?? callee.getSymbol());
  return key ? helpers.get(key) : undefined;
}

/** @internal */ export function opaqueAliasReasonForExpression(
  node: Node,
  context: SessionProvenanceContext,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isIdentifier(expression)) return undefined;
  const key = resolvedSymbolKey(symbolForIdentifierReference(expression) ?? expression.getSymbol());
  return (
    (key ? context.opaqueAliases.get(key) : undefined) ??
    context.opaqueAliases.get(`name:${expression.getText()}`)
  );
}

function unsummarizedHelperReasonForExpression(node: Node): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isCallExpression(expression) ? unsummarizedHelperReason(expression) : undefined;
}

/**
 * SPEC §6.5/§10.3 (KV414 IDOR + KV438 mass-assignment): the request-context carrier
 * roots the framework exposes `session`/`guard`/`tenant` on. A `session`/`guard`/`tenant`
 * member is trusted *server* private scope ONLY when it hangs off one of these — the
 * value SPEC §6.5 surfaces as `req.session.*`. Mirrors the compiler's request-accessor
 * recognition (`validate/trusted-html-provenance.ts` `{req,request}` and
 * `validate/component-contracts.ts` `{ctx,context}`), unified here.
 */
const PRIVATE_SCOPE_CARRIER_ROOT_NAMES: ReadonlySet<string> = new Set([
  'req',
  'request',
  'ctx',
  'context',
]);

/**
 * True when the access root is a proven request/session/context carrier (or `this`).
 * Fail-closed: any other root — notably a validated-input binding like `input`/`args`,
 * whose static type and shape are byte-identical to a request carrier — is NOT a
 * carrier, so a `session`/`guard`/`tenant`-named *input field* (e.g.
 * `input.session.userId`, `input.tenant`) falls through to the symbol-provenance
 * input/args reject instead of laundering client data into server private scope (H3/H5).
 * Over-rejecting an unconventionally-named carrier is the safe SPEC §6.6 direction.
 */
function isPrivateScopeCarrierRoot(root: Node): boolean {
  const expression = unwrappedStaticExpressionNode(root);
  if (Node.isThisExpression(expression)) return true;
  if (!Node.isIdentifier(expression)) return false;
  return PRIVATE_SCOPE_CARRIER_ROOT_NAMES.has(expression.getText());
}

function directPrivateScopeForExpression(node: Node): PrivateScopeProvenance | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const segments = staticAccessSegments(node);
  if (!segments) return undefined;
  // Anchor the session/guard/tenant name match to a proven carrier root (SPEC §6.5):
  // an input-rooted `.session.`/`.guard.`/`.tenant.` access is client data, not server scope.
  if (!isPrivateScopeCarrierRoot(segments.root)) return undefined;
  for (const kind of ['guard', 'session', 'tenant'] as const) {
    const index = segments.path.indexOf(kind);
    if (index < 0) continue;
    return {
      kind,
      path: segments.path.slice(index + 1).join('.'),
      requiresGuard: privateScopeAccessRequiresGuard(expression, kind),
    };
  }
  return undefined;
}

function privateScopeAccessRequiresGuard(node: Node, kind: PrivateScopeKind): boolean {
  if (node.getText().includes('?.')) return true;
  const scopeExpression = privateScopeSegmentExpression(node, kind);
  if (!scopeExpression) return true;
  const type = scopeExpression.getType();
  const nullable = (type as { isNullable?: () => boolean }).isNullable?.();
  if (nullable) return true;
  const text = type.getText();
  return /\bnull\b|\bundefined\b/.test(text);
}

function privateScopeSegmentExpression(node: Node, kind: PrivateScopeKind): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (staticAccessName(expression) === kind) return expression;
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return privateScopeSegmentExpression(expression.getExpression(), kind);
  }
  return undefined;
}

/** @internal */ export function privateScopeKey(provenance: PrivateScopeProvenance): string {
  return `${provenance.kind}:${provenance.path}`;
}

function joinPrivateScopePath(base: string, segment: string): string {
  return base.length === 0 ? segment : `${base}.${segment}`;
}

function sessionAliasGuardDominatesUse(alias: SessionAlias, use: Node): boolean {
  const declared = blockStatementAncestor(alias.declaration);
  const used = blockStatementAncestor(use);
  if (!declared || !used || !sameSourceNode(declared.block, used.block)) {
    return false;
  }

  const statements = declared.block.getStatements();
  const declarationIndex = statements.findIndex((statement) =>
    sameSourceNode(statement, declared.statement),
  );
  const useIndex = statements.findIndex((statement) => sameSourceNode(statement, used.statement));
  if (declarationIndex < 0 || useIndex <= declarationIndex) {
    return false;
  }

  let guarded = false;
  for (const statement of statements.slice(declarationIndex + 1, useIndex)) {
    if (statementReassignsAlias(statement, alias.name)) return false;
    if (isAcceptedSessionGuard(statement, alias.name)) {
      guarded = true;
      continue;
    }
    if (!guarded && statementContainsAliasIdentifier(statement, alias.name)) {
      return false;
    }
    if (guarded && statementContainsAliasEscape(statement, alias.name)) return false;
  }

  return guarded;
}

function directPrivateScopeGuardDominatesUse(target: PrivateScopeProvenance, use: Node): boolean {
  const used = blockStatementAncestor(use);
  if (!used) return false;

  const statements = used.block.getStatements();
  const useIndex = statements.findIndex((statement) => sameSourceNode(statement, used.statement));
  if (useIndex <= 0) return false;

  let guarded = false;
  for (const statement of statements.slice(0, useIndex)) {
    if (isAcceptedDirectPrivateScopeGuard(statement, target)) {
      guarded = true;
      continue;
    }
    if (!statementContainsPrivateScope(statement, target)) continue;
    if (!guarded) return false;
    if (statementContainsPrivateScopeEscape(statement, target)) return false;
  }

  return guarded;
}

function blockStatementAncestor(
  node: Node,
): { block: Node & { getStatements(): Node[] }; statement: Node } | undefined {
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (parent && Node.isBlock(parent)) {
      return { block: parent as Node & { getStatements(): Node[] }, statement: current };
    }
    current = parent;
  }
  return undefined;
}

function sameSourceNode(left: Node, right: Node): boolean {
  return (
    left.getSourceFile().getFilePath() === right.getSourceFile().getFilePath() &&
    left.getStart() === right.getStart() &&
    left.getEnd() === right.getEnd()
  );
}

function isAcceptedSessionGuard(statement: Node, aliasName: string): boolean {
  if (!Node.isIfStatement(statement)) return false;
  if (!isFalsyIdentifierCheck(statement.getExpression(), aliasName)) return false;
  return statementExits(statement.getThenStatement());
}

function isAcceptedDirectPrivateScopeGuard(
  statement: Node,
  target: PrivateScopeProvenance,
): boolean {
  if (!Node.isIfStatement(statement)) return false;
  if (!isFalsyDirectPrivateScopeCheck(statement.getExpression(), target)) return false;
  return statementExits(statement.getThenStatement());
}

function isFalsyIdentifierCheck(expression: Node, aliasName: string): boolean {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isPrefixUnaryExpression(node)) return false;
  if (node.getOperatorToken() !== SyntaxKind.ExclamationToken) return false;
  const operand = unwrappedStaticExpressionNode(node.getOperand());
  return Node.isIdentifier(operand) && operand.getText() === aliasName;
}

function isFalsyDirectPrivateScopeCheck(expression: Node, target: PrivateScopeProvenance): boolean {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isPrefixUnaryExpression(node)) return false;
  if (node.getOperatorToken() !== SyntaxKind.ExclamationToken) return false;
  const operand = unwrappedStaticExpressionNode(node.getOperand());
  const direct = directPrivateScopeForExpression(operand);
  return direct !== undefined && privateScopeMatches(direct, target);
}

function statementExits(statement: Node): boolean {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const [first] = statement.getStatements();
    return first ? statementExits(first) : false;
  }
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = unwrappedStaticExpressionNode(statement.getExpression());
  if (!Node.isCallExpression(expression)) return false;
  const callee = unwrappedStaticExpressionNode(expression.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
  return name === 'fail' || name === 'redirect' || name === 'notFound';
}

function statementReassignsAlias(statement: Node, aliasName: string): boolean {
  const expressions = statement.getDescendantsOfKind(SyntaxKind.BinaryExpression);
  for (const expression of expressions) {
    const operatorKind = expression.getOperatorToken().getKind();
    if (
      operatorKind !== SyntaxKind.EqualsToken &&
      operatorKind !== SyntaxKind.PlusEqualsToken &&
      operatorKind !== SyntaxKind.MinusEqualsToken &&
      operatorKind !== SyntaxKind.AsteriskEqualsToken &&
      operatorKind !== SyntaxKind.SlashEqualsToken
    ) {
      continue;
    }
    const left = unwrappedStaticExpressionNode(expression.getLeft());
    if (Node.isIdentifier(left) && left.getText() === aliasName) return true;
  }

  for (const expression of statement.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression)) {
    const operator = expression.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    const operand = unwrappedStaticExpressionNode(expression.getOperand());
    if (Node.isIdentifier(operand) && operand.getText() === aliasName) return true;
  }
  for (const expression of statement.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression)) {
    const operator = expression.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    const operand = unwrappedStaticExpressionNode(expression.getOperand());
    if (Node.isIdentifier(operand) && operand.getText() === aliasName) return true;
  }

  return false;
}

function statementContainsAliasIdentifier(statement: Node, aliasName: string): boolean {
  return statement
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((identifier) => identifier.getText() === aliasName);
}

function statementContainsPrivateScope(statement: Node, target: PrivateScopeProvenance): boolean {
  return statement.getDescendants().some((node) => {
    const direct = directPrivateScopeForExpression(node);
    return direct !== undefined && privateScopeMatches(direct, target);
  });
}

function statementContainsPrivateScopeEscape(
  statement: Node,
  target: PrivateScopeProvenance,
): boolean {
  return statement.getDescendants().some((node) => {
    const direct = directPrivateScopeForExpression(node);
    return (
      direct !== undefined &&
      privateScopeMatches(direct, target) &&
      privateScopeUseEscapes(node, statement)
    );
  });
}

function privateScopeMatches(left: PrivateScopeProvenance, right: PrivateScopeProvenance): boolean {
  return left.kind === right.kind && left.path === right.path;
}

function statementContainsAliasEscape(statement: Node, aliasName: string): boolean {
  return statement
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some(
      (identifier) =>
        identifier.getText() === aliasName && privateScopeUseEscapes(identifier, statement),
    );
}

function privateScopeUseEscapes(use: Node, statement: Node): boolean {
  const call = nearestCallExpressionAncestor(use, statement);
  if (call) return !isPrivateScopeProofCall(call);

  const variable = nearestVariableDeclarationAncestor(use, statement);
  if (variable) {
    const initializer = variable.getInitializer();
    if (initializer && nodeContains(initializer, use)) return true;
  }

  return true;
}

function nearestCallExpressionAncestor(use: Node, boundary: Node): CallExpression | undefined {
  let current: Node | undefined = use;
  while (current && !sameSourceNode(current, boundary)) {
    if (Node.isCallExpression(current)) return current;
    current = current.getParent();
  }
  return undefined;
}

function nearestVariableDeclarationAncestor(
  use: Node,
  boundary: Node,
): VariableDeclaration | undefined {
  let current: Node | undefined = use;
  while (current && !sameSourceNode(current, boundary)) {
    if (Node.isVariableDeclaration(current)) return current;
    current = current.getParent();
  }
  return undefined;
}

function isPrivateScopeProofCall(call: CallExpression): boolean {
  const expression = unwrappedStaticExpressionNode(call.getExpression());
  const name = Node.isIdentifier(expression) ? expression.getText() : staticAccessName(expression);
  // Server-side Drizzle write payloads may consume guarded private scope before a
  // later predicate in the same handler. That is not an alias escape: the value
  // stays in server proof/write space and is not handed to an opaque helper.
  return (
    name === 'and' ||
    name === 'eq' ||
    name === 'gt' ||
    name === 'gte' ||
    name === 'inArray' ||
    name === 'isNotNull' ||
    name === 'isNull' ||
    name === 'lt' ||
    name === 'lte' ||
    name === 'not' ||
    name === 'or' ||
    name === 'set' ||
    name === 'values'
  );
}

function nodeContains(ancestor: Node, candidate: Node): boolean {
  return (
    ancestor.getSourceFile().getFilePath() === candidate.getSourceFile().getFilePath() &&
    ancestor.getStart() <= candidate.getStart() &&
    ancestor.getEnd() >= candidate.getEnd()
  );
}
