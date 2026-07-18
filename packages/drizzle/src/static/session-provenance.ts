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
  const prefix = segments.path.slice(0, privateScopeIndex);
  // The parameter is already the enrolled request/context carrier. Only a direct private member
  // or its exact `.request` projection can precede guard/session/tenant; arbitrary wrappers such
  // as `context.input.guard` are attacker-controlled data, not principal provenance.
  if (prefix.length > 1 || (prefix.length === 1 && prefix[0] !== 'request')) return undefined;
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
  if (Node.isVariableDeclaration(declaration)) {
    if (!isConstVariableBindingDeclaration(declaration)) return undefined;
    declaration = declaration.getInitializer();
  } else if (!Node.isFunctionDeclaration(declaration)) {
    // SPEC §6.6/§10.3: the positive grammar is deliberately limited to one direct,
    // immutable same-file callable binding. A method/property declaration lives behind a mutable
    // object identity: Object.assign/defineProperty, Reflect.set, aliases, and opaque mutators can
    // replace it without mutating the property's TypeScript symbol. Enumerating those write shapes
    // is not a proof, so object-carried summary targets fail closed unconditionally.
    return undefined;
  }
  const helper =
    declaration &&
    (Node.isArrowFunction(declaration) ||
      Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration))
      ? declaration
      : undefined;
  const symbolKey = resolvedSymbolKey(symbol);
  return helper && symbolKey && !sourceFileMutatesSymbol(sourceFile, symbolKey)
    ? helper
    : undefined;
}

function sourceFileMutatesSymbol(sourceFile: SourceFile, symbolKey: string): boolean {
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    if (nodeContainsSymbolKey(assignment.getLeft(), symbolKey)) return true;
  }
  for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
    if (nodeContainsSymbolKey(deletion.getExpression(), symbolKey)) return true;
  }
  for (const unary of sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression)) {
    const operator = unary.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    if (nodeContainsSymbolKey(unary.getOperand(), symbolKey)) return true;
  }
  for (const unary of sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression)) {
    const operator = unary.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    if (nodeContainsSymbolKey(unary.getOperand(), symbolKey)) return true;
  }
  return false;
}

function nodeContainsSymbolKey(node: Node, symbolKey: string): boolean {
  return [node, ...node.getDescendants()].some((candidate) => {
    const symbol = Node.isIdentifier(candidate)
      ? (symbolForIdentifierReference(candidate) ?? candidate.getSymbol())
      : candidate.getSymbol();
    return resolvedSymbolKey(symbol) === symbolKey;
  });
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
    const initializerExpression = unwrappedStaticExpressionNode(initializer);
    const provenance =
      isConstVariableBindingDeclaration(declaration) && !Node.isIdentifier(initializerExpression)
        ? (privateScopeForExpression(initializer, context) ??
          directPrivateScopeForExpression(initializer))
        : undefined;
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
  return segments !== undefined && privateScopeCarrierBindingIsProven(segments.root, node);
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
    if (!alias || !isConstVariableBindingDeclaration(alias.declaration)) return undefined;
    const stable = alias.requiresGuard
      ? sessionAliasGuardDominatesUse(alias, expression)
      : privateScopeAliasIsStableAtUse(alias, expression);
    return stable ? { kind: alias.kind, path: alias.path } : undefined;
  }

  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    // Direct framework-carrier chains were handled above. Extending a local object/container alias
    // would trust a mutable property cell that reflective or opaque writes can replace.
    return undefined;
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
  return carrier !== undefined && privateScopeCarrierBindingIsProven(carrier, call);
}

/** @internal Exact structural-role and whole-callback integrity proof for a private carrier use. */
export function privateScopeCarrierBindingIsProven(carrier: Node, auditedUse: Node): boolean {
  const root = unwrappedStaticExpressionNode(carrier);
  // SPEC §6.6/§10.3 admits only a structurally enrolled request/context parameter. `this` is the
  // caller-controlled receiver/definition object and cannot mint private principal provenance.
  if (Node.isThisExpression(root)) return false;
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

  const frameworkRole = exactFrameworkPrivateScopeCarrierRole(callable, index);
  if (frameworkRole !== true) return false;

  return privateScopeCarrierBindingIsStableAtUse(parameter, callable, auditedUse);
}

const PRIVATE_SCOPE_SAFE_CAPABILITY_RECEIVERS: ReadonlySet<string> = new Set([
  'cancel',
  'db',
  'fail',
  'fetch',
  'invalidate',
  'readonlyAppDb',
  'recordChange',
  'runMutation',
  'runQuery',
  'runTask',
  'schedule',
  'storage',
  'tx',
]);

const PRIVATE_SCOPE_SAFE_DRIZZLE_PROOF_CALLS: ReadonlySet<string> = new Set([
  'and',
  'eq',
  'gt',
  'gte',
  'inArray',
  'isNotNull',
  'isNull',
  'lt',
  'lte',
  'not',
  'or',
]);

function privateScopeCarrierBindingIsStableAtUse(
  parameter: ParameterDeclaration,
  callable: ExactLocalFunction,
  auditedUse: Node,
): boolean {
  const parameterName = parameter.getNameNode();
  if (!Node.isIdentifier(parameterName)) return false;
  const parameterKey = resolvedSymbolKey(parameterName.getSymbol());
  const body = callable.getBody();
  if (!parameterKey || !body) return false;

  // Binding immutability is necessary but not sufficient: replacing `context.request`, passing the
  // carrier to an opaque mutator, or first capturing it through an alias all invalidate private
  // provenance. Scan the exact enrolled callback body and admit only finite read/capability uses.
  if (sourceFileMutatesSymbol(callable.getSourceFile(), parameterKey)) return false;

  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer || !nodeContainsSymbolKey(initializer, parameterKey)) continue;
    if (nodeContains(initializer, auditedUse)) continue;
    return false;
  }

  for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    if (nodeContains(assignment, auditedUse)) continue;
    if (nodeContainsSymbolKey(assignment.getRight(), parameterKey)) return false;
  }

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (nodeContains(call, auditedUse)) continue;
    if (!call.getArguments().some((argument) => nodeContainsSymbolKey(argument, parameterKey))) {
      continue;
    }
    if (exactPrivateScopeProjectionCall(call, parameterKey)) continue;
    if (exactDrizzlePrivateScopeProofCall(call)) continue;
    return false;
  }

  for (const call of body.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (nodeContains(call, auditedUse)) continue;
    if (call.getArguments().some((argument) => nodeContainsSymbolKey(argument, parameterKey))) {
      return false;
    }
  }

  for (const tagged of body.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    if (nodeContains(tagged, auditedUse)) continue;
    if (nodeContainsSymbolKey(tagged.getTemplate(), parameterKey)) return false;
  }

  for (const reference of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const referenceKey = resolvedSymbolKey(
      symbolForIdentifierReference(reference) ?? reference.getSymbol(),
    );
    if (referenceKey !== parameterKey || nodeContains(auditedUse, reference)) continue;
    const call = nearestCallExpressionAncestor(reference, body);
    if (!call || !nodeContains(call.getExpression(), reference)) continue;
    const access = staticAccessSegments(call.getExpression());
    if (!access || resolvedSymbolKey(access.root.getSymbol()) !== parameterKey) return false;
    const receiver = access.path[0];
    if (!receiver || !PRIVATE_SCOPE_SAFE_CAPABILITY_RECEIVERS.has(receiver)) return false;
  }

  return true;
}

function exactPrivateScopeProjectionCall(call: CallExpression, parameterKey: string): boolean {
  const [firstArgument, ...remainingArguments] = call.getArguments();
  if (!firstArgument || remainingArguments.length !== 0) return false;
  const argument = unwrappedStaticExpressionNode(firstArgument);
  if (!Node.isIdentifier(argument)) return false;
  const argumentKey = resolvedSymbolKey(
    symbolForIdentifierReference(argument) ?? argument.getSymbol(),
  );
  if (argumentKey !== parameterKey) return false;
  return (
    exactLocalPrivateScopeHelperProvenance(call.getExpression(), call.getSourceFile()) !== undefined
  );
}

function exactDrizzlePrivateScopeProofCall(call: CallExpression): boolean {
  const callee = unwrappedStaticExpressionNode(call.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
  if (!name || !PRIVATE_SCOPE_SAFE_DRIZZLE_PROOF_CALLS.has(name)) return false;
  const symbol = Node.isIdentifier(callee)
    ? symbolForIdentifierReference(callee)
    : callee.getSymbol();
  return (
    symbol?.getDeclarations().some((declaration) => {
      const fileName = declaration.getSourceFile().getFilePath().replaceAll('\\', '/');
      if (fileName.includes('/drizzle-orm/')) return true;
      const imported = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      return imported?.getModuleSpecifierValue().startsWith('drizzle-orm') === true;
    }) === true
  );
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
    if (alias && privateScopeAliasIsStableAtUse(alias, expression)) {
      return { kind: alias.kind, path: alias.path };
    }

    const symbol = symbolForIdentifierReference(expression) ?? expression.getSymbol();
    const declaration = symbol?.getDeclarations()?.[0];
    if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
    if (!isConstVariableBindingDeclaration(declaration)) return undefined;
    if (!Node.isIdentifier(declaration.getNameNode())) return undefined;
    if (
      !privateScopeBindingIsStableAtUse(
        declaration,
        declaration.getNameNode().getText(),
        expression,
      )
    ) {
      return undefined;
    }
    const initializer = declaration.getInitializer();
    if (initializer && Node.isIdentifier(unwrappedStaticExpressionNode(initializer)))
      return undefined;
    return initializer
      ? privateScopeSourceForExpression(initializer, context, depth + 1)
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    // `serverValue` shares the same direct-carrier grammar. A const receiver does not make one of
    // its property cells immutable, so local object/tuple projections remain unknown.
    return undefined;
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

/**
 * SPEC §6.6/§10.3 finite local-value rule. `const` prevents rebinding but does not make an
 * object value immutable, so any use between capture and the audited sink is an escape/mutation
 * opportunity and closes provenance. This is intentionally stricter than a write-shape blacklist.
 *
 * @internal
 */
export function privateScopeAliasIsStableAtUse(alias: SessionAlias, use: Node): boolean {
  return privateScopeBindingIsStableAtUse(alias.declaration, alias.name, use);
}

/** @internal */ export function privateScopeIdentifierBindingIsStableAtUse(
  identifier: Node,
  use: Node,
): boolean {
  const expression = unwrappedStaticExpressionNode(identifier);
  if (!Node.isIdentifier(expression)) return false;
  const symbol = symbolForIdentifierReference(expression) ?? expression.getSymbol();
  const declaration = symbol?.getDeclarations()?.[0];
  return declaration && Node.isVariableDeclaration(declaration)
    ? privateScopeBindingIsStableAtUse(declaration, expression.getText(), use)
    : false;
}

function privateScopeBindingIsStableAtUse(declaration: Node, name: string, use: Node): boolean {
  if (!isConstVariableBindingDeclaration(declaration)) return false;

  const variable = Node.isVariableDeclaration(declaration)
    ? declaration
    : declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  const declarationList = variable?.getParentIfKind(SyntaxKind.VariableDeclarationList);
  if (!variable || !declarationList || declarationList.getDeclarations().length !== 1) return false;

  const declared = blockStatementAncestor(declaration);
  const used = blockStatementAncestor(use);
  if (!declared || !used || !sameSourceNode(declared.block, used.block)) return false;

  const statements = declared.block.getStatements();
  const declarationIndex = statements.findIndex((statement) =>
    sameSourceNode(statement, declared.statement),
  );
  const useIndex = statements.findIndex((statement) => sameSourceNode(statement, used.statement));
  if (declarationIndex < 0 || useIndex <= declarationIndex) return false;

  const nameNode =
    Node.isIdentifier(variable.getNameNode()) && variable.getNameNode().getText() === name
      ? variable.getNameNode()
      : Node.isBindingElement(declaration) &&
          Node.isIdentifier(declaration.getNameNode()) &&
          declaration.getNameNode().getText() === name
        ? declaration.getNameNode()
        : undefined;
  const bindingKey = nameNode
    ? resolvedSymbolKey(symbolForIdentifierReference(nameNode) ?? nameNode.getSymbol())
    : undefined;
  if (!bindingKey) return false;

  // Scan through the whole sink statement, not merely preceding statements. Query builders may
  // evaluate another argument before `.where(...)`, and they may retain an object parameter until
  // dispatch; either an earlier or later same-statement escape can therefore rewrite the value.
  return !use
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((candidate) => {
      if (sameSourceNode(candidate, use)) return false;
      if (
        candidate.getStart() < variable.getEnd() ||
        candidate.getEnd() > used.statement.getEnd()
      ) {
        return false;
      }
      const candidateKey = resolvedSymbolKey(
        symbolForIdentifierReference(candidate) ?? candidate.getSymbol(),
      );
      return candidateKey === bindingKey;
    });
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

function directPrivateScopeForExpression(node: Node): PrivateScopeProvenance | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const segments = staticAccessSegments(node);
  if (!segments) return undefined;
  // Anchor the session/guard/tenant match to the exact framework callback role and stable binding
  // (SPEC §6.5/§6.6). Parameter spelling is neither proof nor a restriction: validated input named
  // `context` stays input, while an exact framework carrier may use any local identifier.
  if (!privateScopeCarrierBindingIsProven(segments.root, expression)) return undefined;
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
