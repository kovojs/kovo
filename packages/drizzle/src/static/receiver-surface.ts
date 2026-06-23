import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type Symbol as MorphSymbol,
  type Type as MorphType,
} from 'ts-morph';
import { extractedFunctionKey } from './domain-writes.js';
import {
  type ExtractedFunction,
  type ProjectDrizzleReceivers,
  type QueryReceiverReferences,
  type ReceiverParameterRequirement,
  CLASSIFIED_DRIZZLE_RECEIVER_METHODS,
  COMPUTED_DRIZZLE_RECEIVER_METHOD,
  IGNORED_LOCAL_CALL_NAMES,
  UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS,
  aliasedSymbol,
  bodySourceStart,
  callbackFunctionFromBindingElement,
  callbackFunctionFromDeclaration,
  callbackFunctionFromProperty,
  callbackFunctionFromPropertyDeclaration,
  isDrizzleDatabaseType,
  isDrizzleWriteCall,
  isFunctionLikeNode,
  isProjectDrizzleReceiverIdentifier,
  isProjectDrizzleReceiverMemberExpression,
  isRestBindingElement,
  isTouchBodyNode,
  queryReceiverMode,
  queryCallbackBodies,
  isQueryReceiverIdentifier,
  objectAssignmentTargetNode,
  objectAssignmentPropertyName,
  propertyNameText,
  relationalReadCall,
  resolvedSymbolKey,
  selectReadCall,
  staticAccessExpression,
  staticAccessName,
  staticExpressionPath,
  staticExpressionRootIdentifier,
  symbolForCallbackReference,
  touchBodyCallExpressions,
  touchBodyVariableDeclarations,
  unwrappedStaticExpressionNode,
} from '../static.js';

export function extractLocalFunctionCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isReceiverArgument: (argument: Node) => boolean,
): string[] {
  const calls: string[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();

    const name = staticExpressionPath(expression) ?? expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name)) continue;

    const key = localFunctionKeyForReference(expression, localFunctionKeys);
    if (
      key &&
      !localFunctionCallSatisfiesReceiverRequirements(
        call,
        localFunctionsByKey.get(key)?.receiverParameters ?? [],
        isReceiverArgument,
      )
    ) {
      continue;
    }
    if (key && localFunctionKeys.has(key)) calls.push(key);
  }

  return [...new Set(calls)];
}

export function localFunctionCallSatisfiesReceiverRequirements(
  call: CallExpression,
  requirements: readonly ReceiverParameterRequirement[],
  isReceiverArgument: (argument: Node) => boolean,
): boolean {
  if (requirements.length === 0) return true;

  const args = call.getArguments();
  return requirements.every((requirement) => {
    const argument = args[requirement.index];
    return argument ? isReceiverArgument(argument) : false;
  });
}

export function extractTransactionCallbackLocalFunctionCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
): string[] {
  const calls: string[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const key = transactionCallbackLocalFunctionKey(call, localFunctionKeys, isReceiverIdentifier);
    if (!key) continue;
    if (
      !transactionCallbackSatisfiesReceiverRequirements(
        localFunctionsByKey.get(key)?.receiverParameters ?? [],
      )
    ) {
      continue;
    }

    calls.push(key);
  }

  return [...new Set(calls)];
}

export function extractUnresolvedTransactionCallbackCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface || surface.name !== 'transaction' || !isReceiverIdentifier(surface.receiver)) {
      continue;
    }

    if (transactionCallHasInlineCallback(call)) continue;

    const key = transactionCallbackLocalFunctionKey(call, localFunctionKeys, isReceiverIdentifier);
    if (
      key &&
      transactionCallbackSatisfiesReceiverRequirements(
        localFunctionsByKey.get(key)?.receiverParameters ?? [],
      )
    ) {
      continue;
    }

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name: 'transaction' });
  }

  return calls;
}

export function transactionCallbackLocalFunctionKey(
  call: CallExpression,
  localFunctionKeys: ReadonlySet<string>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
): string | undefined {
  const surface = directDrizzleReceiverCallSurface(call);
  if (!surface || surface.name !== 'transaction' || !isReceiverIdentifier(surface.receiver)) {
    return undefined;
  }

  const callback = call.getArguments()[0];
  if (!callback || Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    return undefined;
  }

  return localFunctionKeyForReference(callback, localFunctionKeys);
}

export function transactionCallHasInlineCallback(call: CallExpression): boolean {
  return call
    .getArguments()
    .some((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
}

export function transactionCallbackSatisfiesReceiverRequirements(
  requirements: readonly ReceiverParameterRequirement[],
): boolean {
  // SPEC §11.1: `transaction(callback)` supplies the proven Drizzle transaction receiver as the
  // callback's first argument. Other required receiver slots are not statically satisfied.
  return requirements.length > 0 && requirements.every((requirement) => requirement.index === 0);
}

export interface ExternalDbArgumentCall {
  index: number;
  name: string;
}

export function extractOpaqueLocalHelperReceiverCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isDirectReceiverArgument: (argument: Node) => boolean,
  receiverArgumentReference: (argument: Node) => Node | undefined,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();

    const key = localFunctionKeyForReference(expression, localFunctionKeys);
    if (!key || !localFunctionKeys.has(key)) continue;
    if (!call.getArguments().some((argument) => receiverArgumentReference(argument))) continue;

    const requirements = localFunctionsByKey.get(key)?.receiverParameters ?? [];
    if (
      requirements.length > 0 &&
      localFunctionCallSatisfiesReceiverRequirements(call, requirements, isDirectReceiverArgument)
    ) {
      continue;
    }

    const index = call.getStart() - bodyOffset;
    if (index >= 0) {
      calls.push({ index, name: staticExpressionPath(expression) ?? expression.getText() });
    }
  }

  return calls;
}

export interface ExternalHelperCallSurface {
  name: string;
  reference: Node;
}

export function externalHelperCallSurface(call: CallExpression): ExternalHelperCallSurface | undefined {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) {
    return { name: expression.getText(), reference: expression };
  }

  const name = staticExpressionPath(expression);
  return name ? { name, reference: expression } : undefined;
}

export function localFunctionKeyForReference(
  reference: Node,
  localFunctionKeys: ReadonlySet<string>,
): string | undefined {
  if (Node.isIdentifier(reference)) {
    return localFunctionKeyForIdentifier(reference, localFunctionKeys);
  }

  // SPEC §10.2/§11.1: local helper summaries follow static member references through
  // ts-morph symbols, so query loaders and mutations cannot hide Drizzle work behind object
  // containers while avoiding source-name compatibility guesses.
  const symbol = symbolForCallbackReference(reference);
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const directKey = localFunctionKeyForDeclaration(declaration);
    if (directKey && localFunctionKeys.has(directKey)) return directKey;

    const callback = callbackFunctionFromDeclaration(declaration);
    if (!callback) continue;

    const callbackKey = localFunctionKeyForCallback(callback);
    if (callbackKey && localFunctionKeys.has(callbackKey)) return callbackKey;
  }

  return undefined;
}

export function localFunctionKeyForIdentifier(
  identifier: Node,
  localFunctionKeys: ReadonlySet<string>,
): string | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;

  const symbolKey = resolvedSymbolKey(identifier.getSymbol());
  if (symbolKey && localFunctionKeys.has(symbolKey)) return symbolKey;

  const symbol = identifier.getSymbol()?.getAliasedSymbol() ?? identifier.getSymbol();
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const key = localFunctionKeyForDeclaration(declaration);
    if (key && localFunctionKeys.has(key)) return key;
  }

  return undefined;
}

export function localFunctionKeyForCallback(callback: Node): string | undefined {
  if (Node.isFunctionDeclaration(callback)) {
    const name = callback.getName();
    const nameNode = callback.getNameNode();
    return name && nameNode ? extractedFunctionKey(name, callback, nameNode) : undefined;
  }

  if (Node.isMethodDeclaration(callback)) {
    const name = propertyNameText(callback.getNameNode());
    return name ? extractedFunctionKey(name, callback, callback.getNameNode()) : undefined;
  }

  if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    const parent = callback.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const name = parent.getNameNode();
      return Node.isIdentifier(name)
        ? extractedFunctionKey(name.getText(), callback, name)
        : undefined;
    }
    if (Node.isPropertyAssignment(parent)) {
      const name = propertyNameText(parent.getNameNode());
      return name ? extractedFunctionKey(name, callback, parent.getNameNode()) : undefined;
    }
    if (Node.isPropertyDeclaration(parent)) {
      const name = propertyNameText(parent.getNameNode());
      return name ? extractedFunctionKey(name, callback, parent.getNameNode()) : undefined;
    }
  }

  return undefined;
}

export function localFunctionKeyForDeclaration(declaration: Node): string | undefined {
  if (Node.isFunctionDeclaration(declaration)) {
    const name = declaration.getName();
    const nameNode = declaration.getNameNode();
    return name && nameNode ? extractedFunctionKey(name, declaration, nameNode) : undefined;
  }

  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isFunctionDeclaration(parent)) {
      const name = parent.getName();
      return name ? extractedFunctionKey(name, parent, declaration) : undefined;
    }
    if (Node.isVariableDeclaration(parent)) {
      const initializer = parent.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) {
        return extractedFunctionKey(declaration.getText(), initializer, declaration);
      }
    }
    if (Node.isMethodDeclaration(parent) && parent.getNameNode() === declaration) {
      return extractedFunctionKey(declaration.getText(), parent, declaration);
    }
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      const callback = callbackFunctionFromProperty(parent, new Set());
      return callback ? localFunctionKeyForCallback(callback) : undefined;
    }
    if (Node.isPropertyDeclaration(parent) && parent.getNameNode() === declaration) {
      const callback = callbackFunctionFromPropertyDeclaration(parent, new Set());
      return callback ? localFunctionKeyForCallback(callback) : undefined;
    }
  }
  if (Node.isBindingElement(declaration)) {
    const callback = callbackFunctionFromBindingElement(declaration, new Set());
    return callback ? localFunctionKeyForCallback(callback) : undefined;
  }

  return undefined;
}

export function extractSourceReceiverSurfaceCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset = bodySourceStart(body),
  includeHelperCalls = true,
  isReceiverMemberExpression?: (node: Node) => boolean,
): ExternalDbArgumentCall[] {
  const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(body, isReceiverIdentifier);
  const aliases = receiverMethodAliasesForBody(body, isReceiverIdentifier);
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const direct = sourceReceiverCallSurface(call, isReceiverIdentifier, bodyOffset);
    if (direct) calls.push(direct);

    const alias = receiverMethodAliasCallName(call, aliases);
    const aliasIndex = call.getStart() - bodyOffset;
    if (alias && aliasIndex >= 0) calls.push({ index: aliasIndex, name: alias });

    if (!includeHelperCalls) continue;
    const helper = sourceReceiverHelperCallSurface(
      call,
      localFunctionKeys,
      isReceiverIdentifier,
      carrierSymbolKeys,
      bodyOffset,
      isReceiverMemberExpression,
    );
    if (helper) calls.push(helper);
  }

  return dedupeExternalDbArgumentCalls(calls).sort(
    (left, right) => left.index - right.index || left.name.localeCompare(right.name),
  );
}

export function sourceReceiverCallSurface(
  call: CallExpression,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset: number,
): ExternalDbArgumentCall | null {
  const index = call.getStart() - bodyOffset;
  if (index < 0) return null;

  if (isDrizzleWriteCall(call)) {
    const operation = staticAccessName(call.getExpression());
    const receiver = staticAccessExpression(call.getExpression());
    return operation && isReceiverIdentifier(receiver) ? { index, name: operation } : null;
  }

  const selectRead = selectReadCall(call);
  if (selectRead && isReceiverIdentifier(selectRead.receiver)) {
    return { index, name: 'select' };
  }

  const relationalRead = relationalReadCall(call);
  if (relationalRead && isReceiverIdentifier(relationalRead.receiver)) {
    return { index, name: 'relational-query' };
  }

  const surface = directDrizzleReceiverCallSurface(call);
  if (
    surface &&
    isReceiverIdentifier(surface.receiver) &&
    (surface.name === 'transaction' || isUnclassifiedDirectDrizzleReceiverMethod(surface.name))
  ) {
    return { index, name: surface.displayName ?? surface.name };
  }

  return null;
}

export function sourceReceiverHelperCallSurface(
  call: CallExpression,
  localFunctionKeys: ReadonlySet<string>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  carrierSymbolKeys: ReadonlySet<string>,
  bodyOffset: number,
  isReceiverMemberExpression?: (node: Node) => boolean,
): ExternalDbArgumentCall | null {
  const surface = externalHelperCallSurface(call);
  if (!surface) return null;
  if (boundReceiverMethodAccessName(call, isReceiverIdentifier)) return null;

  const { name } = surface;
  if (IGNORED_LOCAL_CALL_NAMES.has(name)) return null;

  if (
    !call
      .getArguments()
      .some((arg) =>
        receiverReferenceInArgument(
          arg,
          isReceiverIdentifier,
          carrierSymbolKeys,
          isReceiverMemberExpression,
        ),
      )
  ) {
    return null;
  }

  const index = call.getStart() - bodyOffset;
  if (index < 0) return null;

  return { index, name };
}

export function dedupeExternalDbArgumentCalls(
  calls: readonly ExternalDbArgumentCall[],
): ExternalDbArgumentCall[] {
  const seen = new Set<string>();
  const deduped: ExternalDbArgumentCall[] = [];

  for (const call of calls) {
    const key = `${call.index}\0${call.name}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(call);
  }

  return deduped;
}

export interface SourceReceiverAliasReferences extends QueryReceiverReferences {
  carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
}

export function sourceReceiverAliasReferencesForBody(
  body: Node,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): SourceReceiverAliasReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  const carrierProperties = new Map<string, Set<string>>();
  let changed = true;

  while (changed) {
    const before = sourceReceiverReferenceSize(names, symbolKeys, carrierProperties);

    for (const declaration of touchBodyVariableDeclarations(body)) {
      const binding = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!initializer) continue;

      const references = { carrierProperties, names, symbolKeys };
      if (Node.isObjectBindingPattern(binding) || Node.isArrayBindingPattern(binding)) {
        appendSourceReceiverAliasesFromCarrierBinding(binding, initializer, references);
        continue;
      }

      if (!Node.isIdentifier(binding)) continue;
      if (isSourceReceiverAliasExpression(initializer, isBaseReceiverIdentifier, references)) {
        appendSourceDestructuredReceiverIdentifier(binding, names, symbolKeys);
      }

      appendSourceReceiverCarrierProperties(
        binding,
        initializer,
        references,
        isBaseReceiverIdentifier,
      );
    }

    for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!isTouchBodyNode(expression, body)) continue;
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

      const left = unwrappedStaticExpressionNode(expression.getLeft());
      const references = { carrierProperties, names, symbolKeys };
      if (Node.isObjectLiteralExpression(left)) {
        appendSourceReceiverAliasesFromCarrierAssignment(left, expression.getRight(), references);
        continue;
      }
      if (Node.isArrayLiteralExpression(left)) {
        appendSourceReceiverAliasesFromCarrierAssignment(left, expression.getRight(), references);
        continue;
      }

      if (!Node.isIdentifier(left)) continue;

      const right = expression.getRight();
      if (isSourceReceiverAliasExpression(right, isBaseReceiverIdentifier, references)) {
        appendSourceDestructuredReceiverIdentifier(left, names, symbolKeys);
      }

      appendSourceReceiverCarrierProperties(left, right, references, isBaseReceiverIdentifier);
    }

    changed = sourceReceiverReferenceSize(names, symbolKeys, carrierProperties) !== before;
  }

  return { carrierProperties, names, symbolKeys };
}

export function appendSourceReceiverAliasesFromCarrierAssignment(
  assignment: Node,
  initializer: Node,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  // SPEC §11.1: source-mode destructuring assignment from a known carrier is still not exact
  // receiver proof, but later receiver work through the assigned aliases must stay visible.
  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isIdentifier(expression)) return;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  const carrierProperties = symbolKey ? references.carrierProperties.get(symbolKey) : undefined;
  if (!carrierProperties) return;

  if (Node.isArrayLiteralExpression(assignment)) {
    appendSourceReceiverAliasesFromArrayCarrierAssignment(
      assignment,
      carrierProperties,
      references,
    );
    return;
  }

  if (!Node.isObjectLiteralExpression(assignment)) return;

  for (const property of assignment.getProperties()) {
    const propertyName = objectAssignmentPropertyName(property);
    if (!propertyName) continue;

    const target = objectAssignmentTargetNode(property);
    if (!target) continue;

    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(target, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) {
      appendSourceReceiverAliasesFromNestedCarrierAssignment(target, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(target)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(target, nestedProperties, references);
  }
}

export function appendSourceReceiverAliasesFromArrayCarrierAssignment(
  assignment: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (!Node.isArrayLiteralExpression(assignment)) return;

  assignment.getElements().forEach((element, index) => {
    const propertyName = String(index);
    const target = unwrappedStaticExpressionNode(element);

    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(target, references.names, references.symbolKeys);
      return;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) return;

    if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) {
      appendSourceReceiverAliasesFromNestedCarrierAssignment(target, nestedProperties, references);
      return;
    }

    if (!Node.isIdentifier(target)) return;
    appendSourceReceiverCarrierPropertiesForTarget(target, nestedProperties, references);
  });
}

export function appendSourceReceiverAliasesFromNestedCarrierAssignment(
  assignment: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (Node.isArrayLiteralExpression(assignment)) {
    appendSourceReceiverAliasesFromArrayCarrierAssignment(
      assignment,
      carrierProperties,
      references,
    );
    return;
  }
  if (!Node.isObjectLiteralExpression(assignment)) return;

  for (const property of assignment.getProperties()) {
    const propertyName = objectAssignmentPropertyName(property);
    if (!propertyName) continue;

    const target = objectAssignmentTargetNode(property);
    if (!target) continue;

    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(target, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) {
      appendSourceReceiverAliasesFromNestedCarrierAssignment(target, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(target)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(target, nestedProperties, references);
  }
}

export function appendSourceReceiverCarrierPropertiesForTarget(
  target: Node,
  nestedProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
  },
): void {
  if (!Node.isIdentifier(target)) return;

  const targetSymbolKey = resolvedSymbolKey(symbolForIdentifierReference(target));
  if (!targetSymbolKey) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, targetSymbolKey);
  for (const nestedProperty of nestedProperties) {
    properties.add(nestedProperty);
  }
}

export function appendSourceReceiverAliasesFromCarrierBinding(
  binding: Node,
  initializer: Node,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isIdentifier(expression)) return;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  const carrierProperties = symbolKey ? references.carrierProperties.get(symbolKey) : undefined;
  if (!carrierProperties) return;

  if (Node.isArrayBindingPattern(binding)) {
    appendSourceReceiverAliasesFromArrayCarrierBinding(binding, carrierProperties, references);
    return;
  }

  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const propertyName = propertyNameText(element.getPropertyNameNode() ?? element.getNameNode());
    if (!propertyName) continue;

    const name = element.getNameNode();
    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(name, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      appendSourceReceiverAliasesFromNestedCarrierBinding(name, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(name)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(name, nestedProperties, references);
  }
}

export function appendSourceReceiverAliasesFromArrayCarrierBinding(
  binding: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (!Node.isArrayBindingPattern(binding)) return;

  binding.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element)) return;
    if (isRestBindingElement(element)) {
      appendSourceReceiverCarrierPropertiesForRestTarget(
        element.getNameNode(),
        carrierProperties,
        index,
        references,
      );
      return;
    }

    const propertyName = String(index);
    const name = element.getNameNode();
    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(name, references.names, references.symbolKeys);
      return;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) return;

    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      appendSourceReceiverAliasesFromNestedCarrierBinding(name, nestedProperties, references);
      return;
    }

    if (!Node.isIdentifier(name)) return;
    appendSourceReceiverCarrierPropertiesForTarget(name, nestedProperties, references);
  });
}

export function appendSourceReceiverCarrierPropertiesForRestTarget(
  target: Node,
  carrierProperties: ReadonlySet<string>,
  startIndex: number,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
  },
): void {
  if (!Node.isIdentifier(target)) return;

  const targetSymbolKey = resolvedSymbolKey(symbolForIdentifierReference(target));
  if (!targetSymbolKey) return;

  const remappedProperties = restCarrierProperties(carrierProperties, startIndex);
  if (remappedProperties.size === 0) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, targetSymbolKey);
  for (const property of remappedProperties) properties.add(property);
}

export function restCarrierProperties(
  carrierProperties: ReadonlySet<string>,
  startIndex: number,
): ReadonlySet<string> {
  const remapped = new Set<string>();

  for (const property of carrierProperties) {
    const [head, ...tail] = property.split('.');
    const index = Number(head);
    if (!Number.isInteger(index) || index < startIndex) continue;

    remapped.add([String(index - startIndex), ...tail].join('.'));
  }

  return remapped;
}

export function appendSourceReceiverAliasesFromNestedCarrierBinding(
  binding: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (Node.isArrayBindingPattern(binding)) {
    appendSourceReceiverAliasesFromArrayCarrierBinding(binding, carrierProperties, references);
    return;
  }
  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const propertyName = propertyNameText(element.getPropertyNameNode() ?? element.getNameNode());
    if (!propertyName) continue;

    const name = element.getNameNode();
    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(name, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      appendSourceReceiverAliasesFromNestedCarrierBinding(name, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(name)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(name, nestedProperties, references);
  }
}

export function appendSourceReceiverCarrierPropertiesFromArrayLiteral(
  binding: Node,
  array: Node,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): void {
  if (!Node.isIdentifier(binding) || !Node.isArrayLiteralExpression(array)) return;

  const bindingSymbolKey = resolvedSymbolKey(binding.getSymbol());
  if (!bindingSymbolKey) return;

  const receiverProperties = receiverCarrierPropertiesFromArrayLiteral(
    array,
    references,
    isBaseReceiverIdentifier,
  );
  if (receiverProperties.size === 0) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, bindingSymbolKey);
  for (const property of receiverProperties) {
    properties.add(property);
  }
}

export function sourceReceiverReferenceSize(
  names: ReadonlySet<string>,
  symbolKeys: ReadonlySet<string>,
  carrierProperties: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  return (
    names.size +
    symbolKeys.size +
    [...carrierProperties.values()].reduce((sum, properties) => sum + properties.size, 0)
  );
}

export function isSourceReceiverAliasExpression(
  node: Node,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
  references: QueryReceiverReferences,
): boolean {
  const expression = unwrappedStaticExpressionNode(node);
  return (
    isBaseReceiverIdentifier(expression) || isSourceReceiverAliasIdentifier(expression, references)
  );
}

export function appendSourceReceiverCarrierProperties(
  binding: Node,
  initializer: Node,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): void {
  if (!Node.isIdentifier(binding)) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrayLiteralExpression(expression)) {
    appendSourceReceiverCarrierPropertiesFromArrayLiteral(
      binding,
      expression,
      references,
      isBaseReceiverIdentifier,
    );
    return;
  }
  if (!Node.isObjectLiteralExpression(expression)) return;

  const bindingSymbolKey = resolvedSymbolKey(binding.getSymbol());
  if (!bindingSymbolKey) return;

  const receiverProperties = receiverCarrierPropertiesFromObjectLiteral(
    expression,
    references,
    isBaseReceiverIdentifier,
  );
  if (receiverProperties.size === 0) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, bindingSymbolKey);
  for (const property of receiverProperties) {
    properties.add(property);
  }
}

export function receiverCarrierPropertiesFromObjectLiteral(
  object: ObjectLiteralExpression,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  // SPEC §11.1: object-spread carrier copies preserve only properties still proven to contain a
  // Drizzle receiver after later object-literal overrides.
  const properties = new Set<string>();

  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spreadProperties = receiverCarrierSpreadProperties(property, references);
      if (spreadProperties) {
        for (const spreadProperty of spreadProperties) properties.add(spreadProperty);
      } else {
        properties.clear();
      }
      continue;
    }

    const propertyName = propertyNameText(property.getNameNode());
    if (!propertyName) {
      properties.clear();
      continue;
    }

    removeReceiverCarrierPropertyPath(properties, propertyName);
    for (const path of receiverCarrierPropertyPaths(
      property,
      references,
      isBaseReceiverIdentifier,
    )) {
      properties.add(path);
    }
  }

  return properties;
}

export function receiverCarrierPropertiesFromArrayLiteral(
  array: Node,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  if (!Node.isArrayLiteralExpression(array)) return new Set();

  const properties = new Set<string>();
  array.getElements().forEach((element, index) => {
    const propertyName = String(index);
    removeReceiverCarrierPropertyPath(properties, propertyName);
    for (const path of receiverCarrierPathsForValue(
      propertyName,
      element,
      references,
      isBaseReceiverIdentifier,
    )) {
      properties.add(path);
    }
  });

  return properties;
}

export function receiverCarrierSpreadProperties(
  property: Node,
  references: SourceReceiverAliasReferences,
): ReadonlySet<string> | undefined {
  if (!Node.isSpreadAssignment(property)) return undefined;

  const expression = unwrappedStaticExpressionNode(property.getExpression());
  if (!Node.isIdentifier(expression)) return undefined;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  return symbolKey ? references.carrierProperties.get(symbolKey) : undefined;
}

export function receiverCarrierPropertyPaths(
  property: ReturnType<ObjectLiteralExpression['getProperties']>[number],
  references: QueryReceiverReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  if (Node.isShorthandPropertyAssignment(property)) {
    const propertyName = propertyNameText(property.getNameNode());
    if (!propertyName) return new Set();

    const name = property.getNameNode();
    return receiverCarrierPathsForValue(propertyName, name, references, isBaseReceiverIdentifier);
  }

  if (!Node.isPropertyAssignment(property)) return new Set();

  const propertyName = propertyNameText(property.getNameNode());
  if (!propertyName) return new Set();

  const initializer = property.getInitializer();
  if (!initializer) return new Set();

  return receiverCarrierPathsForValue(
    propertyName,
    initializer,
    references,
    isBaseReceiverIdentifier,
  );
}

export function receiverCarrierPathsForValue(
  propertyName: string,
  value: Node,
  references: QueryReceiverReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  const expression = unwrappedStaticExpressionNode(value);
  const paths = new Set<string>();

  const nestedProperties = receiverCarrierPropertiesForExpression(expression, references);
  if (nestedProperties) {
    for (const path of prefixedReceiverCarrierProperties(propertyName, nestedProperties)) {
      paths.add(path);
    }
  }

  if (isSourceReceiverAliasExpression(expression, isBaseReceiverIdentifier, references)) {
    paths.add(propertyName);
  }

  if (Node.isObjectLiteralExpression(expression)) {
    for (const path of prefixedReceiverCarrierProperties(
      propertyName,
      receiverCarrierPropertiesFromObjectLiteral(
        expression,
        references as SourceReceiverAliasReferences,
        isBaseReceiverIdentifier,
      ),
    )) {
      paths.add(path);
    }
  }
  if (Node.isArrayLiteralExpression(expression)) {
    for (const path of prefixedReceiverCarrierProperties(
      propertyName,
      receiverCarrierPropertiesFromArrayLiteral(
        expression,
        references as SourceReceiverAliasReferences,
        isBaseReceiverIdentifier,
      ),
    )) {
      paths.add(path);
    }
  }

  return paths;
}

export function receiverCarrierPropertiesForExpression(
  expression: Node,
  references: QueryReceiverReferences,
): ReadonlySet<string> | undefined {
  if (!Node.isIdentifier(expression)) return undefined;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  return symbolKey
    ? (references as SourceReceiverAliasReferences).carrierProperties.get(symbolKey)
    : undefined;
}

export function prefixedReceiverCarrierProperties(
  propertyName: string,
  properties: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...properties].map((property) => `${propertyName}.${property}`));
}

export function receiverCarrierNestedProperties(
  properties: ReadonlySet<string>,
  propertyName: string,
): ReadonlySet<string> {
  const prefix = `${propertyName}.`;
  return new Set(
    [...properties]
      .filter((property) => property.startsWith(prefix))
      .map((property) => property.slice(prefix.length)),
  );
}

export function removeReceiverCarrierPropertyPath(properties: Set<string>, propertyName: string): void {
  properties.delete(propertyName);

  const prefix = `${propertyName}.`;
  for (const property of properties) {
    if (property.startsWith(prefix)) properties.delete(property);
  }
}

export function carrierPropertiesForSymbol(
  carrierProperties: ReadonlyMap<string, ReadonlySet<string>>,
  symbolKey: string,
): Set<string> {
  const mutable = carrierProperties as Map<string, Set<string>>;
  const properties = mutable.get(symbolKey);
  if (properties) return properties;

  const next = new Set<string>();
  mutable.set(symbolKey, next);
  return next;
}

export function isSourceReceiverAliasIdentifier(
  node: Node | undefined,
  references: QueryReceiverReferences,
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  if (symbolKey) return references.symbolKeys.has(symbolKey);
  return references.names.has(node.getText());
}

export function isSourceReceiverCarrierMemberExpression(
  node: Node | undefined,
  references: SourceReceiverAliasReferences,
): boolean {
  if (!node || (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node))) {
    return false;
  }

  const receiver = staticExpressionRootIdentifier(node);
  if (!receiver || !Node.isIdentifier(receiver)) return false;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(receiver));
  if (!symbolKey) return false;

  const carriedProperties = references.carrierProperties.get(symbolKey);
  if (!carriedProperties) return false;

  const rootPath = receiver.getText();
  const path = staticExpressionPath(node);
  if (!path || path === rootPath || !path.startsWith(`${rootPath}.`)) return false;

  return carriedProperties.has(path.slice(rootPath.length + 1));
}

export interface DirectDrizzleReceiverCallSurface {
  displayName?: string;
  name: string;
  receiver: Node;
}

export function directDrizzleReceiverCallSurface(
  call: CallExpression,
): DirectDrizzleReceiverCallSurface | undefined {
  const expression = unwrappedStaticExpressionNode(call.getExpression());
  const receiver = staticAccessExpression(expression);
  if (!receiver) return undefined;

  const name = staticAccessName(expression);
  if (name) return { name, receiver };

  if (Node.isElementAccessExpression(expression)) {
    // SPEC §10.2/§11.1: a computed method on a proven Drizzle receiver can hide raw SQL or writes,
    // so it must degrade to KV406 instead of disappearing from the static surface.
    return {
      displayName: expression.getText(),
      name: COMPUTED_DRIZZLE_RECEIVER_METHOD,
      receiver,
    };
  }

  return undefined;
}

export function extractReceiverMethodAliasCallsFromBody(
  body: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const aliases = receiverMethodAliasesForBody(body, isReceiverIdentifier);
  if (aliases.symbols.size === 0) return [];

  const calls: ExternalDbArgumentCall[] = [];
  for (const call of touchBodyCallExpressions(body)) {
    const method = receiverMethodAliasCallName(call, aliases);
    if (!method) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name: method });
  }

  return calls;
}

export function receiverMethodAliasCallName(
  call: CallExpression,
  aliases: ReceiverMethodAliases,
): string | undefined {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) {
    return receiverMethodAliasName(expression, aliases);
  }

  const root = staticExpressionRootIdentifier(expression);
  if (!root) return undefined;
  const alias = receiverMethodAliasName(root, aliases);
  if (alias !== 'query') return undefined;

  const method = staticAccessName(expression);
  return method === 'findFirst' || method === 'findMany' ? 'query' : undefined;
}

export function receiverMethodAliasName(
  identifier: Node,
  aliases: ReceiverMethodAliases,
): string | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(identifier));
  // SPEC §11.1: detached receiver aliases are symbol facts when parser identity is available;
  // same-name shadow bindings must not fall back to source-name compatibility.
  return symbolKey ? aliases.symbols.get(symbolKey) : undefined;
}

export interface ReceiverMethodAliases {
  symbols: ReadonlyMap<string, string>;
}

export function receiverMethodAliasesForBody(
  body: Node,
  isReceiverIdentifier: (node: Node) => boolean,
): ReceiverMethodAliases {
  const symbols = new Map<string, string>();

  let changed = true;
  while (changed) {
    const before = symbols.size;

    for (const declaration of touchBodyVariableDeclarations(body)) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;

      const binding = declaration.getNameNode();
      if (Node.isObjectBindingPattern(binding) && isReceiverIdentifier(initializer)) {
        appendReceiverMethodAliasesFromObjectPattern(binding, symbols);
        continue;
      }
      if (Node.isArrayBindingPattern(binding)) {
        appendReceiverMethodAliasesFromArrayPattern(
          binding,
          initializer,
          symbols,
          isReceiverIdentifier,
          { symbols },
        );
        continue;
      }

      if (!Node.isIdentifier(binding)) continue;
      const method = receiverMethodAliasExpressionName(initializer, isReceiverIdentifier, {
        symbols,
      });
      if (!method) continue;
      appendReceiverMethodAlias(symbols, binding, method);
    }

    for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!isTouchBodyNode(expression, body)) continue;
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

      const left = unwrappedStaticExpressionNode(expression.getLeft());
      const right = unwrappedStaticExpressionNode(expression.getRight());
      if (Node.isObjectLiteralExpression(left) && isReceiverIdentifier(right)) {
        appendReceiverMethodAliasesFromObjectAssignment(left, symbols);
        continue;
      }
      if (Node.isArrayLiteralExpression(left)) {
        appendReceiverMethodAliasesFromArrayAssignment(left, right, symbols, isReceiverIdentifier, {
          symbols,
        });
        continue;
      }

      if (!Node.isIdentifier(left)) continue;
      const method = receiverMethodAliasExpressionName(right, isReceiverIdentifier, {
        symbols,
      });
      if (!method) continue;
      appendReceiverMethodAlias(symbols, left, method);
    }

    changed = symbols.size !== before;
  }

  return { symbols };
}

export function appendReceiverMethodAliasesFromObjectPattern(
  binding: Node,
  symbols: Map<string, string>,
): void {
  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const alias = element.getNameNode();
    if (!Node.isIdentifier(alias)) continue;

    const method = propertyNameText(element.getPropertyNameNode() ?? alias);
    if (!method) continue;
    appendReceiverMethodAlias(symbols, alias, method);
  }
}

export function appendReceiverMethodAliasesFromArrayPattern(
  binding: Node,
  initializer: Node,
  symbols: Map<string, string>,
  isReceiverIdentifier: (node: Node) => boolean,
  aliases: ReceiverMethodAliases,
): void {
  if (!Node.isArrayBindingPattern(binding)) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isArrayLiteralExpression(expression)) return;

  const values = expression.getElements();
  binding.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element)) return;
    if (isRestBindingElement(element)) return;

    const alias = element.getNameNode();
    if (!Node.isIdentifier(alias)) return;

    const value = values[index];
    if (!value) return;

    const method = receiverMethodAliasExpressionName(value, isReceiverIdentifier, aliases);
    if (method) appendReceiverMethodAlias(symbols, alias, method);
  });
}

export function appendReceiverMethodAliasesFromObjectAssignment(
  assignment: Node,
  symbols: Map<string, string>,
): void {
  if (!Node.isObjectLiteralExpression(assignment)) return;

  for (const property of assignment.getProperties()) {
    if (Node.isShorthandPropertyAssignment(property)) {
      const alias = property.getNameNode();
      appendReceiverMethodAlias(symbols, alias, alias.getText());
      continue;
    }

    if (!Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (!initializer) continue;

    const alias = unwrappedStaticExpressionNode(initializer);
    if (!Node.isIdentifier(alias)) continue;

    const method = propertyNameText(property.getNameNode());
    if (!method) continue;
    appendReceiverMethodAlias(symbols, alias, method);
  }
}

export function appendReceiverMethodAliasesFromArrayAssignment(
  assignment: Node,
  initializer: Node,
  symbols: Map<string, string>,
  isReceiverIdentifier: (node: Node) => boolean,
  aliases: ReceiverMethodAliases,
): void {
  if (!Node.isArrayLiteralExpression(assignment)) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isArrayLiteralExpression(expression)) return;

  const values = expression.getElements();
  assignment.getElements().forEach((element, index) => {
    const alias = unwrappedStaticExpressionNode(element);
    if (!Node.isIdentifier(alias)) return;

    const value = values[index];
    if (!value) return;

    const method = receiverMethodAliasExpressionName(value, isReceiverIdentifier, aliases);
    if (method) appendReceiverMethodAlias(symbols, alias, method);
  });
}

export function receiverMethodAliasExpressionName(
  node: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  aliases: ReceiverMethodAliases,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const boundMethod = boundReceiverMethodAccessName(expression, isReceiverIdentifier);
  if (boundMethod) return boundMethod;

  if (Node.isIdentifier(expression)) return receiverMethodAliasName(expression, aliases);

  const receiver = staticAccessExpression(expression);
  if (!receiver || !isReceiverIdentifier(receiver)) return undefined;
  if (Node.isElementAccessExpression(expression)) {
    return staticAccessName(expression) ?? COMPUTED_DRIZZLE_RECEIVER_METHOD;
  }
  return staticAccessName(expression);
}

export function boundReceiverMethodAccessName(
  node: Node,
  isReceiverIdentifier: (node: Node) => boolean,
): string | undefined {
  if (!Node.isCallExpression(node)) return undefined;

  const bindAccess = unwrappedStaticExpressionNode(node.getExpression());
  if (staticAccessName(bindAccess) !== 'bind') return undefined;

  const methodAccess = staticAccessExpression(bindAccess);
  if (!methodAccess) return undefined;

  const receiver = staticAccessExpression(methodAccess);
  if (!receiver || !isReceiverIdentifier(receiver)) return undefined;

  // SPEC §10-§11: bound detached receiver methods can hide raw SQL or writes just like
  // destructured receiver methods, so they degrade through the same KV406 alias path.
  return staticAccessName(methodAccess) ?? COMPUTED_DRIZZLE_RECEIVER_METHOD;
}

export function appendReceiverMethodAlias(
  symbols: Map<string, string>,
  alias: Node,
  method: string,
): void {
  if (!Node.isIdentifier(alias)) return;
  const symbolKey = resolvedSymbolKey(alias.getSymbol());
  if (symbolKey) symbols.set(symbolKey, method);
}

export function isUnclassifiedDirectDrizzleReceiverMethod(name: string): boolean {
  // SPEC §10-§11: direct receiver calls not statically classified are explicit KV406 surfaces.
  return (
    UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS.has(name) ||
    !CLASSIFIED_DRIZZLE_RECEIVER_METHODS.has(name)
  );
}

export function projectReceiverReferenceInArgument(
  argument: Node,
  receivers: ProjectDrizzleReceivers,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
): Node | undefined {
  return receiverReferenceInArgument(
    argument,
    (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
    carrierSymbolKeys,
    isProjectDrizzleReceiverMemberExpression,
    isProjectDrizzleReceiverContainerExpression,
  );
}

export function queryReceiverReferenceInArgument(
  argument: Node,
  receiverReferences: QueryReceiverReferences,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  carrierReferences?: SourceReceiverAliasReferences,
): Node | undefined {
  return receiverReferenceInArgument(
    argument,
    (node) => isQueryReceiverIdentifier(node, receiverReferences),
    carrierSymbolKeys,
    carrierReferences
      ? (node) => isSourceReceiverCarrierMemberExpression(node, carrierReferences)
      : undefined,
    receiverReferences.projectContainers ? isProjectDrizzleReceiverContainerExpression : undefined,
  );
}

export function receiverReferenceInArgument(
  argument: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  isReceiverMemberExpression?: (node: Node) => boolean,
  isReceiverContainerExpression?: (node: Node) => boolean,
): Node | undefined {
  // SPEC §10-§11: opaque helper handoffs may hide Drizzle work, so receiver values passed inside
  // containers degrade to KV406 while classified receiver call chains remain separately analyzed.
  if (isFunctionLikeNode(argument)) return undefined;
  if (
    isReceiverArgumentReference(
      argument,
      argument,
      isReceiverIdentifier,
      carrierSymbolKeys,
      isReceiverMemberExpression,
      isReceiverContainerExpression,
    )
  ) {
    return argument;
  }

  for (const node of argument.getDescendants()) {
    if (isFunctionLikeNode(node)) continue;
    if (Node.isShorthandPropertyAssignment(node)) {
      const name = node.getNameNode();
      if (
        (isReceiverIdentifier(name) ||
          isReceiverCarrierIdentifier(name, carrierSymbolKeys) ||
          isReceiverContainerExpression?.(name) === true) &&
        !isIdentifierDeclarationPosition(name) &&
        !isInsideNestedFunction(name, argument)
      ) {
        return name;
      }
    }
    if (
      isReceiverArgumentReference(
        node,
        argument,
        isReceiverIdentifier,
        carrierSymbolKeys,
        isReceiverMemberExpression,
        isReceiverContainerExpression,
      )
    ) {
      return node;
    }
  }

  return undefined;
}

export function isReceiverArgumentReference(
  node: Node,
  argument: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  carrierSymbolKeys: ReadonlySet<string>,
  isReceiverMemberExpression?: (node: Node) => boolean,
  isReceiverContainerExpression?: (node: Node) => boolean,
): boolean {
  const isIdentifierReference =
    Node.isIdentifier(node) &&
    (isReceiverIdentifier(node) ||
      isReceiverCarrierIdentifier(node, carrierSymbolKeys) ||
      isReceiverContainerExpression?.(node) === true);
  const isMemberReference = isReceiverMemberExpression?.(node) === true;
  const isContainerReference =
    !Node.isObjectLiteralExpression(node) &&
    !Node.isArrayLiteralExpression(node) &&
    isReceiverContainerExpression?.(node) === true;
  if (!isIdentifierReference && !isMemberReference && !isContainerReference) {
    return false;
  }
  if (Node.isIdentifier(node) && isIdentifierDeclarationPosition(node)) return false;
  if (Node.isIdentifier(node) && isPropertyNamePosition(node)) return false;
  if (isAccessExpressionReceiver(node)) return false;
  if (isInsideNestedFunction(node, argument)) return false;
  return true;
}

export function isReceiverCarrierIdentifier(node: Node, carrierSymbolKeys: ReadonlySet<string>): boolean {
  if (!Node.isIdentifier(node) || carrierSymbolKeys.size === 0) return false;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  return symbolKey ? carrierSymbolKeys.has(symbolKey) : false;
}

export function isProjectDrizzleReceiverContainerExpression(node: Node | undefined): boolean {
  if (!node) return false;
  if (isFunctionLikeNode(node)) return false;
  if (isProjectDrizzleReceiverMemberExpression(node)) return false;

  // SPEC §11.1: opaque helper handoffs through factory-returned typed carriers are still visible
  // Drizzle surfaces when project facts prove the value contains a pinned Postgres receiver.
  return projectTypeContainsDrizzleReceiver(node.getType(), node, new Set(), 0);
}

export function projectTypeContainsDrizzleReceiver(
  type: MorphType,
  location: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  // SPEC §11.1: project-mode helper handoffs through typed containers stay visible as KV406 when
  // ts-morph proves a Postgres Drizzle database member, instead of relying on source carrier paths.
  if (depth > 4) return false;
  const typeText = type.getText(location);
  if (isDrizzleDatabaseType(type)) return true;
  if (seen.has(typeText)) return false;
  seen.add(typeText);

  for (const property of type.getProperties()) {
    const propertyType = property.getTypeAtLocation(location);
    if (isDrizzleDatabaseType(propertyType)) return true;
    if (projectTypeContainsDrizzleReceiver(propertyType, location, seen, depth + 1)) {
      return true;
    }
  }

  const arrayElementType = type.getArrayElementType();
  if (arrayElementType) {
    return projectTypeContainsDrizzleReceiver(arrayElementType, location, seen, depth + 1);
  }

  for (const elementType of type.getTupleElements()) {
    if (projectTypeContainsDrizzleReceiver(elementType, location, seen, depth + 1)) {
      return true;
    }
  }

  return false;
}

export function receiverCarrierSymbolKeysForBody(
  body: Node,
  isReceiverIdentifier: (node: Node) => boolean,
): ReadonlySet<string> {
  const carrierSymbolKeys = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (isInsideNestedFunction(declaration, body)) continue;

      const name = declaration.getNameNode();
      if (!Node.isIdentifier(name)) continue;

      const symbolKey = resolvedSymbolKey(name.getSymbol());
      const initializer = declaration.getInitializer();
      if (!symbolKey || !initializer || carrierSymbolKeys.has(symbolKey)) continue;

      if (receiverReferenceInArgument(initializer, isReceiverIdentifier, carrierSymbolKeys)) {
        carrierSymbolKeys.add(symbolKey);
        changed = true;
      }
    }

    for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!isTouchBodyNode(expression, body)) continue;
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

      const left = unwrappedStaticExpressionNode(expression.getLeft());
      if (!Node.isIdentifier(left)) continue;

      const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(left));
      if (!symbolKey || carrierSymbolKeys.has(symbolKey)) continue;

      if (
        receiverReferenceInArgument(expression.getRight(), isReceiverIdentifier, carrierSymbolKeys)
      ) {
        carrierSymbolKeys.add(symbolKey);
        changed = true;
      }
    }
  }

  return carrierSymbolKeys;
}

export function queryReceiverCarrierSymbolKeys(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): ReadonlySet<string> {
  const carrierSymbolKeys = new Set<string>();

  for (const callbackBody of queryCallbackBodies(body, queryReceiverMode(receiverReferences))) {
    for (const symbolKey of receiverCarrierSymbolKeysForBody(callbackBody, (node) =>
      isQueryReceiverIdentifier(node, receiverReferences),
    )) {
      carrierSymbolKeys.add(symbolKey);
    }
  }

  return carrierSymbolKeys;
}

export function isIdentifierDeclarationPosition(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  if (Node.isParameterDeclaration(parent) && parent.getNameNode() === node) return true;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === node) return true;
  if (Node.isBindingElement(parent) && parent.getNameNode() === node) return true;
  if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === node) return true;

  return false;
}

export function isPropertyNamePosition(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  if (Node.isPropertyAccessExpression(parent)) return true;
  if (
    (Node.isPropertyAssignment(parent) || Node.isMethodDeclaration(parent)) &&
    parent.getNameNode() === node
  ) {
    return true;
  }
  if (Node.isBindingElement(parent) && parent.getPropertyNameNode() === node) return true;

  return false;
}

export function isAccessExpressionReceiver(node: Node): boolean {
  const parent = node.getParent();
  return (
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
    parent.getExpression() === node
  );
}

export function isInsideNestedFunction(node: Node, boundary: Node): boolean {
  if (node === boundary) return false;

  for (const ancestor of node.getAncestors()) {
    if (ancestor === boundary) return false;
    if (isFunctionLikeNode(ancestor)) return true;
  }

  return false;
}

export function symbolForIdentifierReference(node: Node): MorphSymbol | undefined {
  if (Node.isIdentifier(node)) {
    const parent = node.getParent();
    if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node) {
      return aliasedSymbol(parent.getValueSymbol() ?? node.getSymbol());
    }
  }

  return aliasedSymbol(node.getSymbol());
}

export function receiverParameterDeclaration(declaration: Node): ParameterDeclaration | null {
  if (Node.isParameterDeclaration(declaration)) return declaration;
  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isParameterDeclaration(parent)) return parent;
  }

  return null;
}

// SPEC §11.1 (v1 scope): collect destructured receiver bindings for the FAIL-CLOSED KV406
// detector only. The db/tx name/property heuristic here never proves a receiver or produces a
// read/write fact; unprovenDestructuredReceiverReferences later drops any binding project mode
// already type-proved, so only un-analyzable destructured receivers reach the KV406 surface.
export function appendSourceDestructuredReceiverBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    if (isRestBindingElement(element)) continue;
    const binding = element.getNameNode();
    const propertyName = propertyNameText(element.getPropertyNameNode() ?? binding);

    if (!propertyName && Node.isIdentifier(binding) && isLikelyDrizzleReceiver(binding.getText())) {
      appendSourceDestructuredReceiverIdentifier(binding, names, symbolKeys);
      continue;
    }

    if (propertyName !== 'db' && propertyName !== 'tx') continue;
    if (Node.isIdentifier(binding)) {
      appendSourceDestructuredReceiverIdentifier(binding, names, symbolKeys);
    }
  }
}

export function appendSourceDestructuredReceiverIdentifier(
  binding: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (!Node.isIdentifier(binding)) return;
  names.add(binding.getText());
  const symbolKey = resolvedSymbolKey(binding.getSymbol());
  if (symbolKey) symbolKeys.add(symbolKey);
}

export function isSourceDestructuredReceiverIdentifier(
  node: Node | undefined,
  receiverReferences: QueryReceiverReferences,
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  if (symbolKey) return receiverReferences.symbolKeys.has(symbolKey);
  return receiverReferences.names.has(node.getText());
}

export function isLikelyDrizzleReceiver(name: string): boolean {
  // SPEC §11.1 (v1 scope): this canonical db/tx name heuristic is NOT receiver proof and never
  // produces a read/write fact. It only seeds the fail-closed KV406 detector for destructured
  // loader receiver slots that project-mode ts-morph could not type-prove.
  return /^(db|tx)$/.test(name);
}
