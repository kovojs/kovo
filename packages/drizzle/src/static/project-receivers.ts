import {
  Node,
  SyntaxKind,
  type BindingElement,
  type CallExpression,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type SourceFile,
  type Type as MorphType,
} from 'ts-morph';
import {
  domainWriteObject,
  domainWriteProperties,
  extractedFunctionKey,
  writeActionCallbackFunction,
} from './domain-writes.js';
import {
  boundReceiverMethodAccessName,
  directDrizzleReceiverCallSurface,
  externalHelperCallSurface,
  extractLocalFunctionCallsFromBody,
  extractOpaqueLocalHelperReceiverCallsFromBody,
  extractReceiverMethodAliasCallsFromBody,
  extractTransactionCallbackLocalFunctionCallsFromBody,
  extractUnresolvedTransactionCallbackCallsFromBody,
  isProjectDrizzleReceiverContainerExpression,
  isUnclassifiedDirectDrizzleReceiverMethod,
  localFunctionKeyForReference,
  projectReceiverReferenceInArgument,
  receiverCarrierSymbolKeysForBody,
  symbolForIdentifierReference,
  type ExternalDbArgumentCall,
} from './receiver-surface.js';
import { projectUnmodeledRelationNameForNode, propertyNameText } from './schema.js';
import {
  TOUCH_BODY_ITERATION_CALLBACK_METHODS,
  objectAssignmentPropertyName,
  objectAssignmentTargetNode,
  sessionProvenanceContextForNodes,
  type ExtractedFunction,
  type ExtractedReadCall,
  type ExtractedWriteCall,
  type ReceiverParameterRequirement,
  type SourceFileInput,
  COMPUTED_DRIZZLE_RECEIVER_METHOD,
  IGNORED_LOCAL_CALL_NAMES,
  UNRESOLVED_READ_SOURCE_EXPRESSION,
  appendReadSourceSummaries,
  callbackFunctionFromBindingElement,
  callbackFunctionFromPropertyDeclaration,
  callbackParameterSymbolKeys,
  extractPredicateFactsFromWriteChain,
  extractReadSourcesFromWriteChain,
  functionBody,
  isDrizzleDatabaseType,
  isDrizzleDatabaseTypeAnnotation,
  isDrizzleReceiver,
  isDrizzleWriteCall,
  isReadSourceCall,
  isSelectQueryCallName,
  lineForIndex,
  queryCallChainReceiver,
  resolvedSymbolKey,
  staticAccessExpression,
  staticAccessName,
  staticExpressionPath,
  unwrappedFunctionExpression,
  unwrappedStaticExpressionNode,
  writeCallChainReceiver,
  writeInstanceKeyComparisons,
} from '../static.js';

/** @internal */ export function projectFunctionsForFile(
  file: SourceFileInput,
  projectFunctionExtractions: ReadonlyMap<string, ReadonlyMap<string, ExtractedFunction>>,
): ExtractedFunction[] {
  // SPEC §10-§11: project-mode summaries are derived from ts-morph project symbols directly,
  // without falling back to source-mode receiver-name heuristics.
  return [...(projectFunctionExtractions.get(file.fileName)?.values() ?? [])];
}

/** @internal */ export interface ProjectDrizzleReceivers {
  names: ReadonlySet<string>;
  symbolKeys: ReadonlySet<string>;
}

/** @internal */ export interface QueryReceiverReferences {
  names: ReadonlySet<string>;
  projectContainers?: boolean;
  symbolKeys: ReadonlySet<string>;
}

/** @internal */ export interface DomainWriteProperty {
  initializer: Node | undefined;
  keyNode: Node;
  memberName: string;
}

/** @internal */ export function projectDomainWriteCallbacks(
  sourceFile: SourceFile,
): Map<string, { body: Node; fn: Node; key: string; name: string }> {
  const callbacks = new Map<string, { body: Node; fn: Node; key: string; name: string }>();

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const domainName = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(domainName) || !initializer) continue;
    const domainCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(domainCall)) continue;
    const expression = domainCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

    const domainObject = domainWriteObject(domainCall.getArguments()[0]);
    if (!domainObject.body) continue;

    for (const property of domainWriteProperties(domainObject.body)) {
      const callback = writeActionCallbackFunction(property.initializer);
      if (!callback) continue;

      const name = `${domainName.getText()}.${property.memberName}`;
      callbacks.set(name, {
        body: functionBody(callback),
        fn: callback,
        key: extractedFunctionKey(name, callback, property.keyNode),
        name,
      });
    }
  }

  return callbacks;
}

/** @internal */ export function projectObjectLiteralCallbacks(
  sourceFile: SourceFile,
): { body: Node; fn: Node; key: string; name: string }[] {
  const callbacks: { body: Node; fn: Node; key: string; name: string }[] = [];

  for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const property of object.getProperties()) {
      if (Node.isMethodDeclaration(property)) {
        const name = propertyNameText(property.getNameNode());
        if (!name) continue;

        callbacks.push({
          body: functionBody(property),
          fn: property,
          key: extractedFunctionKey(name, property, property.getNameNode()),
          name,
        });
        continue;
      }

      if (!Node.isPropertyAssignment(property)) continue;
      const name = propertyNameText(property.getNameNode());
      const initializer = property.getInitializer();
      if (!name || !initializer) continue;

      const expression = unwrappedStaticExpressionNode(initializer);
      if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) continue;

      callbacks.push({
        body: functionBody(expression),
        fn: expression,
        key: extractedFunctionKey(name, expression, property.getNameNode()),
        name,
      });
    }
  }

  return callbacks;
}

/** @internal */ export function projectClassStaticMemberCallbacks(
  sourceFile: SourceFile,
): { body: Node; fn: Node; key: string; name: string }[] {
  // SPEC §10.2/§11.1: class static helper members are executable surfaces only when ts-morph
  // can resolve their symbol. They are summary-only facts for loader/action helper propagation,
  // not public mutation graph entries.
  const callbacks: { body: Node; fn: Node; key: string; name: string }[] = [];
  const classes = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassExpression),
  ];

  for (const classNode of classes) {
    for (const member of classNode.getMembers()) {
      if (Node.isMethodDeclaration(member)) {
        if (!member.isStatic()) continue;
        const name = propertyNameText(member.getNameNode());
        if (!name) continue;

        callbacks.push({
          body: functionBody(member),
          fn: member,
          key: extractedFunctionKey(name, member, member.getNameNode()),
          name,
        });
        continue;
      }

      if (!Node.isPropertyDeclaration(member) || !member.isStatic()) continue;
      const name = propertyNameText(member.getNameNode());
      const callback = callbackFunctionFromPropertyDeclaration(member, new Set());
      if (!name || !callback) continue;

      callbacks.push({
        body: functionBody(callback),
        fn: callback,
        key: extractedFunctionKey(name, callback, member.getNameNode()),
        name,
      });
    }
  }

  return callbacks;
}

/** @internal */ export function projectDrizzleReceivers(callback: Node): ProjectDrizzleReceivers {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return { names: new Set(), symbolKeys: new Set() };
  }

  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  for (const param of callback.getParameters()) {
    appendProjectDrizzleReceiverParameterBinding(param, names, symbolKeys);
  }
  appendProjectDrizzleReceiverBindingsFromBody(functionBody(callback), { names, symbolKeys });
  appendProjectTransactionReceiverAliases(callback, { names, symbolKeys });
  return { names, symbolKeys };
}

/** @internal */ export function projectReceiverParameterRequirements(
  callback: Node,
): ReceiverParameterRequirement[] {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return [];
  }

  return callback.getParameters().flatMap((parameter, index) => {
    const names = new Set<string>();
    const symbolKeys = new Set<string>();
    appendProjectDrizzleReceiverParameterBinding(parameter, names, symbolKeys);
    return names.size > 0 || symbolKeys.size > 0
      ? [{ index, names: [...names], symbolKeys: [...symbolKeys] }]
      : [];
  });
}

/** @internal */ export function appendProjectDrizzleReceiverParameterBinding(
  parameter: ParameterDeclaration,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  const name = parameter.getNameNode();
  appendProjectDrizzleReceiverBinding(name, names, symbolKeys);
  if (Node.isIdentifier(name)) return;

  appendProjectDrizzleReceiverBindingAliasForType(name, parameter, parameter.getType(), {
    names,
    symbolKeys,
  });
}

/** @internal */ export function appendProjectDrizzleReceiverBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (Node.isIdentifier(name)) {
    if (!isDrizzleReceiver(name)) return;

    names.add(name.getText());
    const symbolKey = resolvedSymbolKey(name.getSymbol());
    if (symbolKey) symbolKeys.add(symbolKey);
    return;
  }

  if (Node.isArrayBindingPattern(name)) {
    for (const element of name.getElements()) {
      if (!Node.isBindingElement(element)) continue;
      if (isRestBindingElement(element)) continue;
      appendProjectDrizzleReceiverBinding(element.getNameNode(), names, symbolKeys);
    }
    return;
  }
  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    if (isRestBindingElement(element)) continue;
    appendProjectDrizzleReceiverBinding(element.getNameNode(), names, symbolKeys);
  }
}

/** @internal */ export function appendProjectDrizzleReceiverBindingsFromBody(
  body: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §11.1: body-local receiver aliases are accepted only when their binding type resolves to
  // Drizzle or when project symbols prove a direct alias of an already-proven Drizzle receiver.
  let changed = true;

  while (changed) {
    const before = receivers.names.size + receivers.symbolKeys.size;

    for (const declaration of touchBodyVariableDeclarations(body)) {
      appendProjectDrizzleReceiverBinding(
        declaration.getNameNode(),
        receivers.names,
        receivers.symbolKeys,
      );
      appendProjectDrizzleReceiverInitializerAlias(declaration, receivers);
      appendProjectDrizzleReceiverBindingInitializerAliases(declaration, receivers);
    }

    appendProjectDrizzleReceiverAssignmentAliases(body, receivers);
    changed = receivers.names.size + receivers.symbolKeys.size !== before;
  }
}

/** @internal */ export function appendProjectDrizzleReceiverInitializerAlias(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  const binding = declaration.getNameNode();
  if (!Node.isIdentifier(binding)) return;

  const initializer = declaration.getInitializer();
  if (!initializer) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!isProjectDrizzleReceiverIdentifier(expression, receivers)) return;

  appendProjectDrizzleReceiverAliasIdentifier(binding, receivers);
}

/** @internal */ export function appendProjectDrizzleReceiverBindingInitializerAliases(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  const binding = declaration.getNameNode();
  const initializer = declaration.getInitializer();
  if (!initializer) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isObjectBindingPattern(binding)) {
    appendProjectDrizzleReceiverObjectBindingAliasesForType(
      binding,
      expression,
      expression.getType(),
      receivers,
    );
    return;
  }
  if (Node.isArrayBindingPattern(binding)) {
    appendProjectDrizzleReceiverArrayBindingAliasesForType(
      binding,
      expression,
      expression.getType(),
      receivers,
    );
  }
}

/** @internal */ export function appendProjectDrizzleReceiverAssignmentAliases(
  body: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!isTouchBodyNode(expression, body)) continue;
    if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

    const left = unwrappedStaticExpressionNode(expression.getLeft());
    const right = unwrappedStaticExpressionNode(expression.getRight());
    if (Node.isObjectLiteralExpression(left)) {
      appendProjectDrizzleReceiverObjectAssignmentAliases(left, right, receivers);
      continue;
    }
    if (Node.isArrayLiteralExpression(left)) {
      appendProjectDrizzleReceiverArrayAssignmentAliases(left, right, receivers);
      continue;
    }

    if (!Node.isIdentifier(left)) continue;
    if (!isProjectDrizzleReceiverIdentifier(right, receivers)) continue;

    appendProjectDrizzleReceiverAliasIdentifier(left, receivers);
  }
}

/** @internal */ export function appendProjectDrizzleReceiverArrayBindingAliasesForType(
  binding: Node,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isArrayBindingPattern(binding)) return;

  binding.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element)) return;
    if (isRestBindingElement(element)) return;

    const elementType = projectArrayElementType(sourceType, index);
    if (!elementType) return;

    appendProjectDrizzleReceiverBindingAliasForType(
      element.getNameNode(),
      location,
      elementType,
      receivers,
    );
  });
}

/** @internal */ export function appendProjectDrizzleReceiverObjectBindingAliasesForType(
  binding: Node,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const propertyName = objectBindingElementPropertyName(element);
    if (!propertyName) continue;

    const propertyType = projectObjectPropertyType(sourceType, location, propertyName);
    if (!propertyType) continue;

    appendProjectDrizzleReceiverBindingAliasForType(
      element.getNameNode(),
      location,
      propertyType,
      receivers,
    );
  }
}

/** @internal */ export function appendProjectDrizzleReceiverBindingAliasForType(
  target: Node,
  location: Node,
  targetType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (Node.isIdentifier(target)) {
    if (!isDrizzleDatabaseType(targetType)) return;

    appendProjectDrizzleReceiverAliasIdentifier(target, receivers);
    return;
  }

  if (Node.isObjectBindingPattern(target)) {
    appendProjectDrizzleReceiverObjectBindingAliasesForType(
      target,
      location,
      targetType,
      receivers,
    );
    return;
  }

  if (Node.isArrayBindingPattern(target)) {
    appendProjectDrizzleReceiverArrayBindingAliasesForType(target, location, targetType, receivers);
  }
}

/** @internal */ export function appendProjectDrizzleReceiverObjectAssignmentAliases(
  assignment: ObjectLiteralExpression,
  source: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: destructuring assignment from a typed context is project proof when the
  // assigned property type is a Postgres Drizzle database receiver.
  appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
    assignment,
    source,
    source.getType(),
    receivers,
  );
}

/** @internal */ export function appendProjectDrizzleReceiverArrayAssignmentAliases(
  assignment: Node,
  source: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: tuple destructuring assignment is exact only when ts-morph proves the element
  // type is a Postgres Drizzle database receiver.
  if (!Node.isArrayLiteralExpression(assignment)) return;
  appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
    assignment,
    source,
    source.getType(),
    receivers,
  );
}

/** @internal */ export function appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
  assignment: Node,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isArrayLiteralExpression(assignment)) return;

  assignment.getElements().forEach((element, index) => {
    const target = unwrappedStaticExpressionNode(element);
    const elementType = projectArrayElementType(sourceType, index);
    if (!elementType) return;

    if (Node.isIdentifier(target)) {
      if (!isDrizzleDatabaseType(elementType)) return;

      appendProjectDrizzleReceiverAliasIdentifier(target, receivers);
      return;
    }

    if (Node.isObjectLiteralExpression(target)) {
      appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
        target,
        location,
        elementType,
        receivers,
      );
      return;
    }

    if (Node.isArrayLiteralExpression(target)) {
      appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
        target,
        location,
        elementType,
        receivers,
      );
    }
  });
}

/** @internal */ export function appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
  assignment: ObjectLiteralExpression,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  for (const property of assignment.getProperties()) {
    const propertyName = objectAssignmentPropertyName(property);
    if (!propertyName) continue;

    const target = objectAssignmentTargetNode(property);
    if (!target) continue;

    const propertyType = projectObjectPropertyType(sourceType, location, propertyName);
    if (!propertyType) continue;

    if (Node.isIdentifier(target)) {
      if (!isDrizzleDatabaseType(propertyType)) continue;

      appendProjectDrizzleReceiverAliasIdentifier(target, receivers);
      continue;
    }

    if (Node.isObjectLiteralExpression(target)) {
      appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
        target,
        location,
        propertyType,
        receivers,
      );
      continue;
    }

    if (Node.isArrayLiteralExpression(target)) {
      appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
        target,
        location,
        propertyType,
        receivers,
      );
    }
  }
}

/** @internal */ export function projectObjectPropertyType(
  sourceType: MorphType,
  location: Node,
  propertyName: string,
): MorphType | undefined {
  return sourceType.getProperty(propertyName)?.getTypeAtLocation(location);
}

/** @internal */ export function projectArrayElementType(
  sourceType: MorphType,
  index: number,
): MorphType | undefined {
  return sourceType.getTupleElements()[index] ?? sourceType.getArrayElementType();
}

/** @internal */ export function objectBindingElementPropertyName(
  element: BindingElement,
): string | undefined {
  return propertyNameText(element.getPropertyNameNode() ?? element.getNameNode());
}

/** @internal */ export function isRestBindingElement(element: BindingElement): boolean {
  // SPEC §11.1: a rest binding is a receiver container, not the receiver itself. Project-mode
  // exact facts must come from typed member/element access off that container.
  return element.compilerNode.dotDotDotToken !== undefined;
}

/** @internal */ export function appendProjectDrizzleReceiverAliasIdentifier(
  identifier: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isIdentifier(identifier)) return;

  receivers.names.add(identifier.getText());
  const symbolKey = resolvedSymbolKey(identifier.getSymbol());
  if (symbolKey) receivers.symbolKeys.add(symbolKey);
}

/** @internal */ export function appendProjectTransactionReceiverAliases(
  callback: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: transaction callback aliases are proven from typed receiver call sites.
  let changed = true;

  while (changed) {
    changed = false;

    for (const call of callback.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (staticAccessName(expression) !== 'transaction') continue;

      const receiver = staticAccessExpression(expression);
      if (!isProjectDrizzleReceiverIdentifier(receiver, receivers)) continue;

      const transactionCallback = call
        .getArguments()
        .find((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
      if (
        !transactionCallback ||
        (!Node.isArrowFunction(transactionCallback) &&
          !Node.isFunctionExpression(transactionCallback))
      ) {
        continue;
      }

      const alias = transactionCallback.getParameters()[0]?.getNameNode();
      if (!Node.isIdentifier(alias)) continue;

      const symbolKey = resolvedSymbolKey(alias.getSymbol());
      if (symbolKey ? receivers.symbolKeys.has(symbolKey) : receivers.names.has(alias.getText())) {
        continue;
      }

      receivers.names.add(alias.getText());
      if (symbolKey) receivers.symbolKeys.add(symbolKey);
      changed = true;
    }
  }
}

/** @internal */ export function extractProjectDrizzleWriteCalls(
  body: Node,
  file: SourceFileInput,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  unmodeledRelationNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
  receivers: ProjectDrizzleReceivers,
  paramSymbolKeys: ReadonlySet<string>,
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];
  const sessionContext = sessionProvenanceContextForNodes(body.getSourceFile(), [body]);

  for (const call of touchBodyCallExpressions(body)) {
    if (!isDrizzleWriteCall(call)) continue;

    const expression = call.getExpression();
    const operation = staticAccessName(expression);
    const receiver = staticAccessExpression(expression);
    if (!operation || !receiver) continue;
    // SPEC §11.1 (part-4 D1): a CTE-prefixed write `db.with(cte).update(t)` has the
    // CallExpression `db.with(cte)` as its receiver. Resolve through chained `.with()`
    // (mirroring the read-side `queryCallChainReceiver`) so the write still touches the
    // domain; an unresolved CallExpression receiver fails closed as KV406 below.
    const resolvedReceiver = writeCallChainReceiver(receiver);
    if (!isProjectDrizzleReceiverIdentifier(resolvedReceiver, receivers)) continue;

    const tableArgument = call.getArguments()[0];
    if (!tableArgument) continue;

    const chain = drizzleWriteChainRoot(call);
    const tableExpression =
      projectTableNameForNode(tableArgument, tableNamesBySymbol, namespaceTableNames) ??
      projectUnmodeledRelationNameForNode(tableArgument, unmodeledRelationNamesBySymbol) ??
      UNRESOLVED_READ_SOURCE_EXPRESSION;

    const resolveWriteTableIdentifier = (node: Node) =>
      projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames);

    calls.push({
      index: 0,
      instanceKeyComparisons: writeInstanceKeyComparisons(
        chain,
        resolveWriteTableIdentifier,
        sessionContext,
      ),
      operation,
      predicateFacts: extractPredicateFactsFromWriteChain(
        chain,
        resolveWriteTableIdentifier,
        paramSymbolKeys,
        sessionContext,
      ),
      readSources: extractReadSourcesFromWriteChain(
        chain,
        operation,
        (node) =>
          projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames) ??
          UNRESOLVED_READ_SOURCE_EXPRESSION,
      ),
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      tableExpression: tableExpression.trim(),
    });
  }

  return calls;
}

/** @internal */ export function extractProjectSelectReadCalls(
  body: Node,
  file: SourceFileInput,
  receivers: ProjectDrizzleReceivers,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): ExtractedReadCall[] {
  const bodyStart = bodySourceStart(body);
  const calls: ExtractedReadCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const read = selectReadCall(call);
    if (!read || !isProjectDrizzleReceiverIdentifier(read.receiver, receivers)) continue;

    calls.push({
      index: Math.max(0, call.getStart() - bodyStart),
      operation: 'select',
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      tableExpression:
        projectTableNameForNode(read.table, tableNamesBySymbol, namespaceTableNames) ??
        UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  return calls;
}

/** @internal */ export function extractProjectRelationalReadCalls(
  body: Node,
  file: SourceFileInput,
  receivers: ProjectDrizzleReceivers,
  relationalTableNames: ReadonlyMap<string, string>,
): ExtractedReadCall[] {
  const bodyStart = bodySourceStart(body);
  const calls: ExtractedReadCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const read = relationalReadCall(call);
    if (!read || !isProjectDrizzleReceiverIdentifier(read.receiver, receivers)) continue;

    calls.push({
      index: Math.max(0, call.getStart() - bodyStart),
      operation: 'relational-query',
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      tableExpression:
        relationalTableNames.get(read.tableExpression) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  return calls;
}

/** @internal */ export function extractProjectUnresolvedCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  localFunctionNames: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: project-mode unresolved surfaces must be tied to typed Drizzle receivers.
  const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(body, (node) =>
    isProjectDrizzleReceiverIdentifier(node, receivers),
  );
  return [
    ...extractProjectExternalDbArgumentCalls(
      body,
      receivers,
      localFunctionNames,
      carrierSymbolKeys,
    ),
    ...extractOpaqueLocalHelperReceiverCallsFromBody(
      body,
      localFunctionNames,
      localFunctionsByKey,
      (argument) =>
        projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !== undefined ||
        isDrizzleReceiver(argument),
      (argument) => projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys),
    ),
    ...extractReceiverMethodAliasCallsFromBody(body, (node) =>
      isProjectDrizzleReceiverIdentifier(node, receivers),
    ),
    ...extractUnresolvedTransactionCallbackCallsFromBody(
      body,
      localFunctionNames,
      localFunctionsByKey,
      (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
    ),
    ...extractOpaqueClosureProjectReceiverCallsFromBody(body, receivers, carrierSymbolKeys),
    ...extractProjectUnclassifiedDrizzleReceiverCalls(body, receivers),
    ...extractProjectDrizzleReceiverContainerCalls(body),
  ];
}

/** @internal */ export function extractOpaqueClosureProjectReceiverCallsFromBody(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  carrierSymbolKeys: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of callExpressionsInNode(body)) {
    if (isTouchBodyNode(call, body)) continue;
    const opaqueClosure = opaqueTouchClosureAncestor(call, body);
    if (!opaqueClosure) continue;

    const directWrite = isDrizzleWriteCall(call)
      ? directDrizzleReceiverCallSurface(call)
      : undefined;
    const hasDirectWrite =
      directWrite !== undefined &&
      isProjectDrizzleReceiverIdentifier(directWrite.receiver, receivers);
    const helper = externalHelperCallSurface(call);
    const helperName = helper?.name;
    const helperCarriesReceiver =
      helper !== undefined &&
      !IGNORED_LOCAL_CALL_NAMES.has(helper.name) &&
      call
        .getArguments()
        .some((argument) =>
          projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys),
        );

    if (!hasDirectWrite && !helperCarriesReceiver) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) {
      calls.push({
        index,
        name: directWrite?.name ?? helperName ?? 'callback',
      });
    }
  }

  return uniqueExternalDbArgumentCalls(calls);
}

/** @internal */ export function opaqueTouchClosureAncestor(
  node: Node,
  body: Node,
): Node | undefined {
  for (const ancestor of node.getAncestors()) {
    if (ancestor === body) return undefined;
    if (!isFunctionLikeNode(ancestor)) continue;
    if (isInlineTransactionCallback(ancestor) || isInlineIterationCallback(ancestor)) continue;
    return ancestor;
  }

  return undefined;
}

/** @internal */ export function uniqueExternalDbArgumentCalls(
  calls: readonly ExternalDbArgumentCall[],
): ExternalDbArgumentCall[] {
  const seen = new Set<string>();
  const unique: ExternalDbArgumentCall[] = [];

  for (const call of calls) {
    const key = `${call.index}:${call.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(call);
  }

  return unique;
}

/** @internal */ export function extractProjectExternalDbArgumentCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  localFunctionNames: ReadonlySet<string>,
  carrierSymbolKeys: ReadonlySet<string> = receiverCarrierSymbolKeysForBody(body, (node) =>
    isProjectDrizzleReceiverIdentifier(node, receivers),
  ),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of touchBodyCallExpressions(body)) {
    if (
      boundReceiverMethodAccessName(call, (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      )
    ) {
      continue;
    }

    const surface = externalHelperCallSurface(call);
    if (!surface) continue;

    const { name } = surface;
    if (IGNORED_LOCAL_CALL_NAMES.has(name) || localFunctionNames.has(name)) continue;
    if (localFunctionKeyForReference(surface.reference, localFunctionNames)) {
      continue;
    }
    if (
      !call
        .getArguments()
        .some((arg) => projectReceiverReferenceInArgument(arg, receivers, carrierSymbolKeys))
    ) {
      continue;
    }

    calls.push({ index: call.getStart() - bodyStart, name });
  }

  return calls;
}

/** @internal */ export function extractProjectUnclassifiedDrizzleReceiverCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of touchBodyCallExpressions(body)) {
    const surface = projectUnclassifiedCallSurface(call);
    if (!surface || !isProjectDrizzleReceiverIdentifier(surface.receiver, receivers)) continue;

    calls.push({ index: call.getStart() - bodyStart, name: surface.name });
  }

  return calls;
}

/** @internal */ export function extractProjectDrizzleReceiverContainerCalls(
  body: Node,
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of touchBodyCallExpressions(body)) {
    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface) continue;
    if (!isProjectDrizzleReceiverContainerCallReceiver(surface.receiver)) continue;

    calls.push({ index: call.getStart() - bodyStart, name: surface.name });
  }

  return calls;
}

/** @internal */ export function isProjectDrizzleReceiverContainerCallReceiver(
  node: Node,
): boolean {
  // SPEC §11.1: project-mode containers that merely contain a Drizzle receiver are opaque
  // surfaces. Exact facts require a proven receiver member such as `context.db`.
  if (isProjectDrizzleReceiverMemberExpression(node)) return false;
  if (isDrizzleReceiver(node)) return false;
  return isProjectDrizzleReceiverContainerExpression(node);
}

/** @internal */ export function projectUnclassifiedCallSurface(
  call: CallExpression,
): { name: string; receiver: Node } | undefined {
  // SPEC §10-§11: only the relational query API (`db.query.<table>.find*`) is classified as a
  // read surface. Other typed receiver `find*` calls remain visible as KV406.
  const surface = directDrizzleReceiverCallSurface(call);
  if (!surface) return undefined;
  const { name } = surface;
  if ((name === 'findMany' || name === 'findFirst') && relationalReadCall(call)) {
    return undefined;
  }

  if (!isUnclassifiedDirectDrizzleReceiverMethod(name)) return undefined;
  return surface;
}

/** @internal */ export function relationalReadCall(
  call: CallExpression,
): { receiver: Node; tableExpression: string } | undefined {
  const expression = call.getExpression();
  const method = staticAccessName(expression);
  if (method !== 'findMany' && method !== 'findFirst') return undefined;

  const tableAccess = staticAccessExpression(expression);
  if (!tableAccess) return undefined;

  const queryAccess = staticAccessExpression(tableAccess);
  if (!queryAccess || staticAccessName(queryAccess) !== 'query') return undefined;

  const receiver = staticAccessExpression(queryAccess);
  if (!receiver) return undefined;

  return {
    receiver,
    tableExpression: staticAccessName(tableAccess) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
  };
}

/** @internal */ export function selectReadCall(
  call: CallExpression,
): { receiver: Node; table: Node } | undefined {
  // SPEC §10-§11: standalone Drizzle select reads are touch-graph facts; unresolved table
  // expressions become KV406 instead of silently disappearing.
  if (!isReadSourceCall(call)) return undefined;
  if (!isSelectQueryCallName(queryBuilderRootCallName(call))) return undefined;
  if (isNestedInWriteReadSource(call)) return undefined;

  const receiver = queryCallChainReceiver(call);
  const table = call.getArguments()[0];
  if (!receiver || !table) return undefined;

  return { receiver, table };
}

/** @internal */ export function queryBuilderRootCallName(
  call: CallExpression,
): string | undefined {
  let current: CallExpression | undefined = call;
  let name: string | undefined;

  while (current) {
    name = staticAccessName(current.getExpression()) ?? name;
    const receiver = staticAccessExpression(current.getExpression());
    current = Node.isCallExpression(receiver) ? receiver : undefined;
  }

  return name;
}

/** @internal */ export function isNestedInWriteReadSource(call: CallExpression): boolean {
  for (const ancestor of call.getAncestors()) {
    if (!Node.isCallExpression(ancestor)) continue;
    if (ancestor === call) continue;
    if (ancestor.getDescendantsOfKind(SyntaxKind.CallExpression).some(isDrizzleWriteCall)) {
      return true;
    }
  }

  return false;
}

/** @internal */ export function bodySourceStart(body: Node): number {
  return Node.isBlock(body) ? body.getStart() + 1 : body.getStart();
}

/** @internal */ export function singleReturnExpression(declaration: Node): Node | undefined {
  if (!Node.isGetAccessorDeclaration(declaration)) return undefined;

  const body = declaration.getBody();
  if (!body || !Node.isBlock(body)) return undefined;

  const statements = body.getStatements();
  if (statements.length !== 1) return undefined;

  const statement = statements[0];
  if (!statement || !Node.isReturnStatement(statement)) return undefined;

  return statement.getExpression();
}

/** @internal */ export function callExpressionsInNode(body: Node): CallExpression[] {
  return [
    ...(Node.isCallExpression(body) ? [body] : []),
    ...body.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
}

/** @internal */ export function touchBodyCallExpressions(body: Node): CallExpression[] {
  return callExpressionsInNode(body).filter((call) => isTouchBodyNode(call, body));
}

/** @internal */ export function touchBodyVariableDeclarations(
  body: Node,
): ReturnType<SourceFile['getVariableDeclarations']> {
  return body
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => isTouchBodyNode(declaration, body));
}

/** @internal */ export function isTouchBodyNode(node: Node, body: Node): boolean {
  if (node === body) return true;

  for (const ancestor of node.getAncestors()) {
    if (ancestor === body) return true;
    if (!isFunctionLikeNode(ancestor)) continue;
    if (isInlineTransactionCallback(ancestor)) continue;
    if (isInlineIterationCallback(ancestor)) continue;
    return false;
  }

  return true;
}

/** @internal */ export function isFunctionLikeNode(node: Node): boolean {
  return (
    Node.isArrowFunction(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node)
  );
}

/** @internal */ export function isInlineTransactionCallback(callback: Node): boolean {
  const parent = callback.getParent();
  if (!Node.isCallExpression(parent)) return false;
  if (!parent.getArguments().includes(callback)) return false;

  return staticAccessName(parent.getExpression()) === 'transaction';
}

/** @internal */ export function isInlineIterationCallback(callback: Node): boolean {
  const parent = callback.getParent();
  if (!Node.isCallExpression(parent)) return false;
  if (!parent.getArguments().includes(callback)) return false;

  const method = staticAccessName(parent.getExpression());
  return method ? TOUCH_BODY_ITERATION_CALLBACK_METHODS.has(method) : false;
}

/** @internal */ export function isProjectDrizzleReceiverIdentifier(
  node: Node | undefined,
  receivers: { names: ReadonlySet<string>; symbolKeys: ReadonlySet<string> },
): boolean {
  if (!node) return false;
  if (!Node.isIdentifier(node)) {
    // SPEC §11.1: project-mode member receivers such as `ctx.db` are exact facts when
    // ts-morph proves the member type is the pinned Postgres Drizzle database type.
    return isProjectDrizzleReceiverMemberExpression(node);
  }

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  if (symbolKey) return receivers.symbolKeys.has(symbolKey);

  return receivers.names.has(node.getText());
}

/** @internal */ export function isProjectDrizzleReceiverMemberExpression(
  node: Node | undefined,
): boolean {
  if (!node || (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node))) {
    return false;
  }

  return isDrizzleReceiver(node);
}

/** @internal */ export function drizzleWriteChainRoot(call: CallExpression): Node {
  let chain: Node = call;

  while (true) {
    const parent = chain.getParent();

    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === chain) {
      chain = parent;
      continue;
    }
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === chain) {
      chain = parent;
      continue;
    }

    return chain;
  }
}

/** @internal */ export function projectTableNameForNode(
  node: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames = new Map(),
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (expression !== node) {
    return projectTableNameForNode(expression, tableNamesBySymbol, namespaceTableNames);
  }

  if (Node.isPropertyAccessExpression(node)) {
    const tableName = projectTableNameForSymbol(node.getNameNode(), tableNamesBySymbol);
    if (tableName) {
      const basePath = staticExpressionPath(node.getExpression());
      return basePath ? `${basePath}.${tableName}` : tableName;
    }
    const namespaceTableName = projectNamespaceAccessTableName(node, namespaceTableNames);
    if (namespaceTableName) return namespaceTableName;
  }
  if (Node.isElementAccessExpression(node)) {
    const namespaceTableName = projectNamespaceAccessTableName(node, namespaceTableNames);
    if (namespaceTableName) return namespaceTableName;

    const tableName = projectTableNameForSymbol(node, tableNamesBySymbol);
    if (tableName) {
      const basePath = staticExpressionPath(node.getExpression());
      return basePath ? `${basePath}.${tableName}` : tableName;
    }
  }

  return projectTableNameForSymbol(node, tableNamesBySymbol);
}

/** @internal */ export function projectTableNameForSymbol(
  node: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string | undefined {
  const symbolKey = resolvedSymbolKey(node.getSymbol());
  if (!symbolKey) return undefined;
  return tableNamesBySymbol.get(symbolKey);
}

/** @internal */ export type ProjectNamespaceTableNames = ReadonlyMap<
  string,
  ReadonlyMap<string, string>
>;

/** @internal */ export function projectNamespaceTableNamesByLocal(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ProjectNamespaceTableNames {
  const namespaces = new Map<string, Map<string, string>>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const local = declaration.getNamespaceImport()?.getText();
    const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
    if (!local || !moduleSourceFile) continue;

    const exportedTables = projectExportedTableNamesByName(moduleSourceFile, tableNamesBySymbol);
    if (exportedTables.size > 0) namespaces.set(local, exportedTables);
  }

  return namespaces;
}

/** @internal */ export function projectExportedTableNamesByName(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): Map<string, string> {
  const tables = new Map<string, string>();

  for (const symbol of sourceFile.getExportSymbols()) {
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(symbol) ?? '');
    if (tableName) tables.set(symbol.getName(), tableName);
  }

  return tables;
}

/** @internal */ export function projectNamespaceAccessTableName(
  access: Node,
  namespaceTableNames: ProjectNamespaceTableNames,
): string | undefined {
  if (!Node.isElementAccessExpression(access) && !Node.isPropertyAccessExpression(access)) {
    return undefined;
  }

  const base = access.getExpression();
  if (!Node.isIdentifier(base)) return undefined;

  const table = staticAccessName(access);
  if (!table) return undefined;

  const tableName = namespaceTableNames.get(base.getText())?.get(table);
  return tableName ? `${base.getText()}.${tableName}` : undefined;
}
