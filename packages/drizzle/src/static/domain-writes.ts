import {
  Node,
  type BindingElement,
  type CallExpression,
  type ObjectLiteralExpression,
  type Type as MorphType,
} from 'ts-morph';
import { withParsedSourceFile } from './tables.js';
import {
  type DomainWriteProperty,
  type ExtractedFunction,
  type ReceiverParameterRequirement,
  type SourceFileInput,
  UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER,
  UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER,
  callbackFunctionFromReference,
  computedPropertyNameExpression,
  lineForIndex,
  objectPropertyInitializer,
  propertyNameText,
  resolvedSymbolKey,
  singleReturnExpression,
  staticBindingElementReference,
  staticLiteralReferenceFromExpression,
  staticObjectFactoryReturnExpression,
  stringArrayPropertyFromObject,
  symbolForCallbackReference,
  symbolForStaticTypePath,
  unwrappedStaticExpressionNode,
} from '../static.js';

export function functionReceiverParametersByKey(
  functions: Iterable<Pick<ExtractedFunction, 'key' | 'receiverParameters'>>,
): ReadonlyMap<string, readonly ReceiverParameterRequirement[]> {
  return new Map([...functions].map((fn) => [fn.key, fn.receiverParameters]));
}

export function unresolvedDomainWriteCallbacks(
  file: SourceFileInput,
): { mergeWithExact: boolean; name: string; site: string }[] {
  return withParsedSourceFile(file, (sourceFile) => {
    const unresolved: { mergeWithExact: boolean; name: string; site: string }[] = [];

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const domainName = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(domainName) || !initializer) continue;
      const domainCall = unwrappedStaticExpressionNode(initializer);
      if (!Node.isCallExpression(domainCall)) continue;
      const expression = domainCall.getExpression();
      if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

      const domainArgument = domainCall.getArguments()[0];
      const domainObject = domainWriteObject(domainArgument);
      if (domainObject.unresolved && domainArgument) {
        unresolved.push({
          mergeWithExact: false,
          name: `${domainName.getText()}.${UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER}`,
          site: `${file.fileName}:${lineForIndex(file.source, domainArgument.getStart())}`,
        });
      }
      if (!domainObject.body) continue;

      for (const computed of unresolvedComputedDomainWriteProperties(domainObject.body)) {
        unresolved.push({
          mergeWithExact: false,
          name: `${domainName.getText()}.${UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER}`,
          site: `${file.fileName}:${lineForIndex(file.source, computed.siteNode.getStart())}`,
        });
      }

      for (const spread of unresolvedDomainWriteSpreads(domainObject.body)) {
        unresolved.push({
          mergeWithExact: false,
          name: `${domainName.getText()}.${spread.memberName}`,
          site: `${file.fileName}:${lineForIndex(file.source, spread.siteNode.getStart())}`,
        });
      }

      for (const property of domainWriteProperties(domainObject.body)) {
        const callbackResolution = writeActionCallbackResolution(property.initializer);
        const initializer = property.initializer
          ? unwrappedStaticExpressionNode(property.initializer)
          : undefined;
        if (
          !callbackResolution.unresolved ||
          (callbackResolution.callbacks.length > 0 && !Node.isConditionalExpression(initializer))
        ) {
          continue;
        }

        const siteNode = property.initializer ?? property.keyNode;
        const mergeWithExact =
          callbackResolution.callbacks.length > 0 && Node.isConditionalExpression(initializer);

        unresolved.push({
          mergeWithExact,
          name: `${domainName.getText()}.${property.memberName}`,
          site: `${file.fileName}:${lineForIndex(file.source, siteNode.getStart())}`,
        });
      }
    }

    return unresolved;
  });
}

export interface DomainWriteObjectResolution {
  body?: ObjectLiteralExpression;
  unresolved: boolean;
}

export function domainWriteObject(argument: Node | undefined): DomainWriteObjectResolution {
  if (!argument) return { unresolved: true };
  return domainWriteObjectFromNode(argument, new Set()) ?? { unresolved: true };
}

export function domainWriteObjectFromNode(
  node: Node,
  seen: Set<string>,
): DomainWriteObjectResolution | undefined {
  // SPEC §10-§11: domain action objects are executable mutation surfaces; static aliases are
  // followed through ts-morph symbols, while opaque aliases stay visible as KV406.
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isObjectLiteralExpression(expression)) return { body: expression, unresolved: false };

  const factoryReturn = staticObjectFactoryReturnExpression(expression, seen);
  if (factoryReturn) {
    const body = domainWriteObjectFromNode(factoryReturn, seen);
    if (body) return body;
  }

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    const body = domainWriteObjectFromNode(literalReference, seen);
    if (body) return body;
  }

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return { unresolved: true };
  seen.add(key);

  for (const declaration of symbolForCallbackReference(expression)?.getDeclarations() ?? []) {
    const body = domainWriteObjectFromDeclaration(declaration, seen);
    if (body) return body;
  }

  // SPEC §10.4: a typed domain-action factory can still hide mutation callbacks from static
  // extraction. Unresolved non-literal action objects must therefore degrade to KV406.
  return { unresolved: true };
}

export function domainWriteObjectFromDeclaration(
  declaration: Node,
  seen: Set<string>,
): DomainWriteObjectResolution | undefined {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
  }

  if (Node.isPropertyDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    const expression = singleReturnExpression(declaration);
    return expression ? domainWriteObjectFromNode(expression, seen) : undefined;
  }

  if (Node.isPropertyAssignment(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return domainWriteObjectFromNode(declaration.getNameNode(), seen);
  }

  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === declaration) {
      const initializer = parent.getInitializer();
      return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
    }
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      const initializer = parent.getInitializer();
      return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
    }
    if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      return domainWriteObjectFromNode(parent.getNameNode(), seen);
    }
  }

  return undefined;
}

export function unresolvedComputedDomainWriteProperties(
  object: ObjectLiteralExpression,
): { siteNode: Node }[] {
  const unresolved: { siteNode: Node }[] = [];

  for (const property of object.getProperties()) {
    if (
      !Node.isMethodDeclaration(property) &&
      !Node.isPropertyAssignment(property) &&
      !Node.isShorthandPropertyAssignment(property)
    ) {
      continue;
    }
    const name = property.getNameNode();
    if (!computedPropertyNameExpression(name) || propertyNameText(name, true)) continue;

    unresolved.push({ siteNode: property });
  }

  return unresolved;
}

export interface UnresolvedDomainWriteSpread {
  memberName: string;
  siteNode: Node;
}

export function unresolvedDomainWriteSpreads(
  object: ObjectLiteralExpression,
): UnresolvedDomainWriteSpread[] {
  const unresolved: UnresolvedDomainWriteSpread[] = [];

  for (const property of object.getProperties()) {
    if (!Node.isSpreadAssignment(property)) continue;
    // SPEC §10-§11: an opaque domain action spread can contain hidden write(...) callbacks, so it
    // must stay visible as KV406 instead of disappearing from the mutation graph.
    const expression = unwrappedStaticExpressionNode(property.getExpression());
    const spreadProperties = domainWritePropertiesFromSpread(property, new Set());
    const resolvedMembers = new Set(
      spreadProperties.map((spreadProperty) => spreadProperty.memberName),
    );
    const type = expression.getType();
    const hasUnresolvedBranch = domainWriteSpreadHasUnresolvedBranch(expression);
    if (hasUnresolvedBranch || typeHasOpaqueStringMembers(type)) {
      unresolved.push({
        memberName: UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER,
        siteNode: property,
      });
    }
    if (
      !hasUnresolvedBranch &&
      !typeHasOpaqueStringMembers(type) &&
      spreadProperties.length === 0 &&
      (type.isAny() || type.isUnknown())
    ) {
      unresolved.push({
        memberName: UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER,
        siteNode: property,
      });
      continue;
    }

    for (const symbol of type.getProperties()) {
      const memberName = symbol.getName();
      if (resolvedMembers.has(memberName)) continue;
      const declarations = symbol.getDeclarations();
      if (
        declarations.every(
          (declaration) => !domainWritePropertyFromDeclaration(memberName, declaration, new Set()),
        )
      ) {
        unresolved.push({ memberName, siteNode: declarations[0] ?? property });
      }
    }
  }

  return unresolved;
}

export function domainWriteSpreadHasUnresolvedBranch(expression: Node): boolean {
  if (!Node.isConditionalExpression(expression)) {
    const type = expression.getType();
    return type.isAny() || type.isUnknown() || typeHasOpaqueStringMembers(type);
  }

  return [expression.getWhenTrue(), expression.getWhenFalse()].some((branch) =>
    domainWriteSpreadHasUnresolvedBranch(unwrappedStaticExpressionNode(branch)),
  );
}

export function typeHasOpaqueStringMembers(type: MorphType): boolean {
  // SPEC §10.2/§11.1: string-indexed objects can hide arbitrary loader/action members. Without
  // concrete property declarations, keep that surface visible as KV406 instead of assuming empty.
  return type.getStringIndexType() !== undefined;
}

export function domainWriteProperties(
  object: ObjectLiteralExpression,
  seen: Set<string> = new Set(),
): DomainWriteProperty[] {
  const properties = new Map<string, DomainWriteProperty>();

  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      for (const spreadProperty of domainWritePropertiesFromSpread(property, seen)) {
        properties.set(spreadProperty.memberName, spreadProperty);
      }
      continue;
    }

    if (Node.isMethodDeclaration(property)) {
      const memberName = propertyNameText(property.getNameNode(), true);
      if (!memberName) continue;

      properties.set(memberName, {
        initializer: undefined,
        keyNode: property.getNameNode(),
        memberName,
      });
      continue;
    }

    if (Node.isShorthandPropertyAssignment(property)) {
      const memberName = propertyNameText(property.getNameNode(), true);
      if (!memberName) continue;

      properties.set(
        memberName,
        domainWritePropertyFromShorthandAssignment(property, seen) ?? {
          initializer: property.getNameNode(),
          keyNode: property.getNameNode(),
          memberName,
        },
      );
      continue;
    }

    if (!Node.isPropertyAssignment(property)) continue;
    const memberName = propertyNameText(property.getNameNode(), true);
    if (!memberName) continue;

    properties.set(memberName, {
      initializer: property.getInitializer(),
      keyNode: property.getNameNode(),
      memberName,
    });
  }

  return [...properties.values()];
}

export function domainWritePropertiesFromSpread(property: Node, seen: Set<string>): DomainWriteProperty[] {
  if (!Node.isSpreadAssignment(property)) return [];

  const expression = unwrappedStaticExpressionNode(property.getExpression());
  if (Node.isConditionalExpression(expression)) {
    // SPEC §10-§11: conditional action spreads are mutation surfaces. Each static branch is
    // resolved through ts-morph symbols; unresolved branches are reported by
    // `unresolvedDomainWriteSpreads` instead of fabricated here.
    return [
      ...domainWritePropertiesFromExpression(
        unwrappedStaticExpressionNode(expression.getWhenTrue()),
        seen,
      ),
      ...domainWritePropertiesFromExpression(
        unwrappedStaticExpressionNode(expression.getWhenFalse()),
        seen,
      ),
    ];
  }

  return domainWritePropertiesFromExpression(expression, seen);
}

export function domainWritePropertiesFromExpression(
  expression: Node,
  seen: Set<string>,
): DomainWriteProperty[] {
  if (Node.isObjectLiteralExpression(expression)) {
    return domainWriteProperties(expression, seen);
  }

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    return domainWritePropertiesFromExpression(
      unwrappedStaticExpressionNode(literalReference),
      seen,
    );
  }

  const key = resolvedSymbolKey(expression.getSymbol()) ?? expression.getText();
  if (seen.has(key)) return [];
  seen.add(key);

  const properties: DomainWriteProperty[] = [];
  for (const symbol of expression.getType().getProperties()) {
    const memberName = symbol.getName();
    for (const declaration of symbol.getDeclarations()) {
      const domainProperty = domainWritePropertyFromDeclaration(memberName, declaration, seen);
      if (domainProperty) {
        properties.push(domainProperty);
        break;
      }
    }
  }

  seen.delete(key);
  return properties;
}

export function domainWritePropertyFromDeclaration(
  memberName: string,
  declaration: Node,
  seen: Set<string>,
): DomainWriteProperty | undefined {
  if (Node.isBindingElement(declaration)) {
    const property = domainWritePropertyFromBindingElement(memberName, declaration, seen);
    if (property) return property;
  }

  if (Node.isVariableDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(name) || !initializer) return undefined;
    if (!writeActionCallbackFunction(initializer, seen)) return undefined;

    return {
      initializer,
      keyNode: name,
      memberName,
    };
  }

  if (Node.isPropertyDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!initializer) return undefined;
    if (!writeActionCallbackFunction(initializer, seen)) return undefined;

    return {
      initializer,
      keyNode: name,
      memberName,
    };
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const expression = singleReturnExpression(declaration);
    if (!expression) return undefined;
    if (!writeActionCallbackFunction(expression, seen)) return undefined;

    return {
      initializer: expression,
      keyNode: name,
      memberName,
    };
  }

  if (Node.isPropertyAssignment(declaration)) {
    return {
      initializer: declaration.getInitializer(),
      keyNode: declaration.getNameNode(),
      memberName,
    };
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return {
      initializer: declaration.getObjectAssignmentInitializer(),
      keyNode: declaration.getNameNode(),
      memberName,
    };
  }

  if (Node.isSpreadAssignment(declaration)) {
    return domainWritePropertiesFromSpread(declaration, seen).find(
      (property) => property.memberName === memberName,
    );
  }

  return undefined;
}

export function domainWritePropertyFromBindingElement(
  memberName: string,
  declaration: BindingElement,
  seen: Set<string>,
): DomainWriteProperty | undefined {
  // SPEC §11.1: destructured action aliases are resolved from ts-morph static member facts, so
  // `domain({ add })` does not fall back to source-name compatibility extraction.
  const binding = staticBindingElementReference(declaration);
  if (!binding) return undefined;

  const keyNode = declaration.getNameNode();
  if (binding.literalReference && writeActionCallbackFunction(binding.literalReference, seen)) {
    return {
      initializer: binding.literalReference,
      keyNode,
      memberName,
    };
  }

  const symbol = symbolForStaticTypePath(
    unwrappedStaticExpressionNode(binding.initializer),
    binding.path,
    declaration,
  );
  for (const referencedDeclaration of symbol?.getDeclarations() ?? []) {
    const property = domainWritePropertyFromDeclaration(memberName, referencedDeclaration, seen);
    if (property) {
      return {
        ...property,
        keyNode,
        memberName,
      };
    }
  }

  return undefined;
}

export function domainWritePropertyFromShorthandAssignment(
  declaration: Node,
  seen: Set<string>,
): DomainWriteProperty | undefined {
  if (!Node.isShorthandPropertyAssignment(declaration)) return undefined;

  const memberName = propertyNameText(declaration.getNameNode(), true);
  if (!memberName) return undefined;

  for (const referencedDeclaration of symbolForCallbackReference(
    declaration.getNameNode(),
  )?.getDeclarations() ?? []) {
    const property = domainWritePropertyFromDeclaration(memberName, referencedDeclaration, seen);
    if (property) return property;
  }

  return undefined;
}

export function writeCallbackFunction(
  initializer: Node | undefined,
): ReturnType<CallExpression['getArguments']>[number] | null {
  if (!initializer) return null;
  const writeCall = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(writeCall)) return null;
  const expression = writeCall.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'write') return null;

  for (const argument of writeCall.getArguments().toReversed()) {
    const callback = writeCallbackArgumentFunction(argument);
    if (callback) return callback;
  }

  return null;
}

export function rawTablesByDomainWriteCallback(
  file: SourceFileInput,
): ReadonlyMap<string, readonly string[]> {
  return withParsedSourceFile(file, (sourceFile) => {
    const rawTables = new Map<string, string[]>();

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
        const tables = rawTablesFromWriteInitializer(property.initializer);
        if (tables.length > 0) {
          rawTables.set(`${domainName.getText()}.${property.memberName}`, tables);
        }
      }
    }

    return rawTables;
  });
}

export function rawTablesFromWriteInitializer(initializer: Node | undefined): string[] {
  if (!initializer) return [];
  const writeCall = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(writeCall)) return [];
  const expression = writeCall.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'write') return [];

  for (const argument of writeCall.getArguments()) {
    const object = unwrappedStaticExpressionNode(argument);
    if (!Node.isObjectLiteralExpression(object)) continue;
    const tables = stringArrayPropertyFromObject(object, 'tables');
    if (tables.length > 0) return tables;
  }

  return [];
}

export function writeActionCallbackFunction(
  initializer: Node | undefined,
  seen: Set<string> = new Set(),
): ReturnType<CallExpression['getArguments']>[number] | null {
  return writeActionCallbackResolution(initializer, seen).callbacks[0] ?? null;
}

export interface WriteActionCallbackResolution {
  callbacks: Node[];
  unresolved: boolean;
}

export function writeActionCallbackResolution(
  initializer: Node | undefined,
  seen: Set<string> = new Set(),
): WriteActionCallbackResolution {
  if (!initializer) return { callbacks: [], unresolved: true };

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isConditionalExpression(expression)) {
    // SPEC §10-§11: direct conditional domain action members are mutation surfaces. Exact static
    // write branches contribute touches, while opaque branches remain named KV406 entries.
    const branches = [expression.getWhenTrue(), expression.getWhenFalse()].map((branch) =>
      writeActionCallbackResolution(unwrappedStaticExpressionNode(branch), seen),
    );
    return {
      callbacks: branches.flatMap((branch) => branch.callbacks),
      unresolved: branches.some((branch) => branch.unresolved),
    };
  }

  const callback = writeCallbackFunction(expression);
  if (callback) return { callbacks: [callback], unresolved: false };

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return { callbacks: [], unresolved: true };
  seen.add(key);

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    return writeActionCallbackResolution(unwrappedStaticExpressionNode(literalReference), seen);
  }

  for (const declaration of symbolForCallbackReference(expression)?.getDeclarations() ?? []) {
    const referenced = writeActionCallbackFromDeclaration(declaration, seen);
    if (referenced) return { callbacks: [referenced], unresolved: false };
  }

  return { callbacks: [], unresolved: true };
}

export function writeActionCallbackFromDeclaration(
  declaration: Node,
  seen: Set<string>,
): ReturnType<CallExpression['getArguments']>[number] | null {
  if (Node.isBindingElement(declaration)) {
    return writeActionCallbackFromBindingElement(declaration, seen);
  }

  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    return writeActionCallbackFunction(declaration.getInitializer(), seen);
  }

  if (Node.isPropertyDeclaration(declaration)) {
    return writeActionCallbackFunction(declaration.getInitializer(), seen);
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    return writeActionCallbackFunction(singleReturnExpression(declaration), seen);
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return writeActionCallbackFunction(declaration.getNameNode(), seen);
  }

  if (!Node.isIdentifier(declaration)) return null;

  const parent = declaration.getParent();
  if (
    (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) &&
    parent.getNameNode() === declaration
  ) {
    return writeActionCallbackFunction(parent.getInitializer(), seen);
  }
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration) {
    return writeActionCallbackFunction(parent.getNameNode(), seen);
  }

  return null;
}

export function writeActionCallbackFromBindingElement(
  declaration: BindingElement,
  seen: Set<string>,
): ReturnType<CallExpression['getArguments']>[number] | null {
  const binding = staticBindingElementReference(declaration);
  if (!binding) return null;

  if (binding.literalReference) {
    const callback = writeActionCallbackFunction(binding.literalReference, seen);
    if (callback) return callback;
  }

  const symbol = symbolForStaticTypePath(
    unwrappedStaticExpressionNode(binding.initializer),
    binding.path,
    declaration,
  );
  for (const referencedDeclaration of symbol?.getDeclarations() ?? []) {
    const callback = writeActionCallbackFromDeclaration(referencedDeclaration, seen);
    if (callback) return callback;
  }

  return null;
}

export function writeCallbackArgumentFunction(argument: Node): Node | null {
  const expression = unwrappedStaticExpressionNode(argument);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  if (Node.isObjectLiteralExpression(expression)) {
    const run = objectPropertyInitializer(expression, 'run');
    if (run && (Node.isArrowFunction(run) || Node.isFunctionExpression(run))) return run;
  }
  const literalReference = staticLiteralReferenceFromExpression(expression);
  if (literalReference && literalReference !== expression) {
    return writeCallbackArgumentFunction(literalReference);
  }
  return referencedWriteCallbackFunction(expression) ?? null;
}

export function referencedWriteCallbackFunction(identifier: Node): Node | undefined {
  // SPEC §10-§11: mutation touch facts must come from an executable local callback body; cross
  // module project references are followed through ts-morph aliases instead of by-name fallback.
  return callbackFunctionFromReference(identifier, new Set());
}

export function extractedFunctionKey(name: string, callback: Node, keyNode: Node = callback): string {
  return (
    resolvedSymbolKey(keyNode.getSymbol()) ??
    `${callback.getSourceFile().getFilePath()}:${callback.getStart()}:${name}`
  );
}
