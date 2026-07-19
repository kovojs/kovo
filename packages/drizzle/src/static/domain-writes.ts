import {
  Node,
  SyntaxKind,
  type BindingElement,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
  type Type as MorphType,
} from 'ts-morph';
import { withParsedSourceFile } from './tables.js';
import {
  RAW_SQL_WRITE_RECEIVER_SINK_METHODS,
  type DomainWriteProperty,
  type ExtractedFunction,
  type ReceiverParameterRequirement,
  type SourceFileInput,
  UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER,
  UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER,
  callbackFunctionFromReference,
  computedPropertyNameExpression,
  isKovoDrizzleTrustedSqlCall,
  isKovoServerCalleeExpression,
  lineForIndex,
  objectPropertyInitializer,
  propertyNameText,
  projectSourceFileName,
  resolvedSymbolKey,
  staticMutationDeclarationFromCall,
  singleReturnExpression,
  staticBindingElementReference,
  staticLiteralReferenceFromExpression,
  staticObjectFactoryReturnExpression,
  stringArrayPropertyFromObject,
  symbolForCallbackReference,
  symbolForStaticTypePath,
  unwrappedStaticExpressionNode,
} from '../static.js';
import {
  directDrizzleReceiverCallSurface,
  isLikelyDrizzleReceiver,
  isProjectDrizzleReceiverContainerExpression,
} from './receiver-surface.js';
import { staticAccessExpression, staticAccessName } from './summaries.js';

/** @internal */ export function functionReceiverParametersByKey(
  functions: Iterable<Pick<ExtractedFunction, 'key' | 'receiverParameters'>>,
): ReadonlyMap<string, readonly ReceiverParameterRequirement[]> {
  return new Map([...functions].map((fn) => [fn.key, fn.receiverParameters]));
}

/** @internal */ export function unresolvedDomainWriteCallbacks(
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
      // SPEC §11.1 (bugz-3 L11): match the @kovojs/server `domain` binding (bare/alias/namespace).
      if (!isKovoServerCalleeExpression(expression, 'domain')) continue;

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

/** @internal */ export interface DomainWriteObjectResolution {
  body?: ObjectLiteralExpression;
  unresolved: boolean;
}

/** @internal */ export function domainWriteObject(
  argument: Node | undefined,
): DomainWriteObjectResolution {
  if (!argument) return { unresolved: true };
  return domainWriteObjectFromNode(argument, new Set()) ?? { unresolved: true };
}

/** @internal */ export function domainWriteObjectFromNode(
  node: Node,
  seen: Set<string>,
): DomainWriteObjectResolution | undefined {
  // SPEC §10-§11: domain action objects are executable mutation surfaces; static aliases are
  // followed through ts-morph symbols, while opaque aliases stay visible as KV406.
  const expression = unwrappedStaticExpressionNode(node);
  // SPEC §10.3: `domain('cart')` is the public invalidation-domain value form, not a
  // domain action object. It contributes no write callbacks and must not become KV406.
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return { unresolved: false };
  }
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

/** @internal */ export function domainWriteObjectFromDeclaration(
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

/** @internal */ export function unresolvedComputedDomainWriteProperties(
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

/** @internal */ export interface UnresolvedDomainWriteSpread {
  memberName: string;
  siteNode: Node;
}

/** @internal */ export function unresolvedDomainWriteSpreads(
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
        const declaration = declarations[0];
        // A shared syntactic Project can resolve namespace-spread members across source files,
        // making the member name more precise than the old `<spread>` fallback. External members
        // still belong to this local spread: callers pair `siteNode` with the containing file's
        // snapshotted source, so an external declaration offset would produce a false line. Keep a
        // same-file declaration because its member-specific source location is valid and useful.
        const siteNode =
          declaration?.getSourceFile().getFilePath() === property.getSourceFile().getFilePath()
            ? declaration
            : property;
        unresolved.push({ memberName, siteNode });
      }
    }
  }

  return unresolved;
}

/** @internal */ export function domainWriteSpreadHasUnresolvedBranch(expression: Node): boolean {
  if (!Node.isConditionalExpression(expression)) {
    const type = expression.getType();
    return type.isAny() || type.isUnknown() || typeHasOpaqueStringMembers(type);
  }

  return [expression.getWhenTrue(), expression.getWhenFalse()].some((branch) =>
    domainWriteSpreadHasUnresolvedBranch(unwrappedStaticExpressionNode(branch)),
  );
}

/** @internal */ export function typeHasOpaqueStringMembers(type: MorphType): boolean {
  // SPEC §10.2/§11.1: string-indexed objects can hide arbitrary loader/action members. Without
  // concrete property declarations, keep that surface visible as KV406 instead of assuming empty.
  return type.getStringIndexType() !== undefined;
}

/** @internal */ export function domainWriteProperties(
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

/** @internal */ export function domainWritePropertiesFromSpread(
  property: Node,
  seen: Set<string>,
): DomainWriteProperty[] {
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

/** @internal */ export function domainWritePropertiesFromExpression(
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

/** @internal */ export function domainWritePropertyFromDeclaration(
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

/** @internal */ export function domainWritePropertyFromBindingElement(
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

/** @internal */ export function domainWritePropertyFromShorthandAssignment(
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

/** @internal */ export function writeCallbackFunction(
  initializer: Node | undefined,
): ReturnType<CallExpression['getArguments']>[number] | null {
  if (!initializer) return null;
  const writeCall = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(writeCall)) return null;
  const expression = writeCall.getExpression();
  // SPEC §11.1 (bugz-3 L11): match the @kovojs/server `write` binding (bare/alias/namespace).
  if (!isKovoServerCalleeExpression(expression, 'write')) return null;

  for (const argument of writeCall.getArguments().toReversed()) {
    const callback = writeCallbackArgumentFunction(argument);
    if (callback) return callback;
  }

  return null;
}

/** @internal */ export function rawTablesByDomainWriteCallback(
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
      // SPEC §11.1 (bugz-3 L11): match the @kovojs/server `domain` binding (bare/alias/namespace).
      if (!isKovoServerCalleeExpression(expression, 'domain')) continue;

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

/** @internal */ export function rawTablesFromWriteInitializer(
  initializer: Node | undefined,
): string[] {
  if (!initializer) return [];
  const writeCall = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(writeCall)) return [];
  const expression = writeCall.getExpression();
  // SPEC §11.1 (bugz-3 L11): match the @kovojs/server `write` binding (bare/alias/namespace).
  if (!isKovoServerCalleeExpression(expression, 'write')) return [];

  for (const argument of writeCall.getArguments()) {
    const object = unwrappedStaticExpressionNode(argument);
    if (!Node.isObjectLiteralExpression(object)) continue;
    const tables = stringArrayPropertyFromObject(object, 'tables');
    if (tables.length > 0) return tables;
  }

  return [];
}

/** @internal */ export function rawWriteSqlTrustByDomainWriteCallback(
  file: SourceFileInput,
): ReadonlyMap<string, RawWriteSqlTrust> {
  return withParsedSourceFile(file, (sourceFile) => {
    const trustByWrite = new Map<string, RawWriteSqlTrust>();

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const domainName = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(domainName) || !initializer) continue;
      const domainCall = unwrappedStaticExpressionNode(initializer);
      if (!Node.isCallExpression(domainCall)) continue;
      const expression = domainCall.getExpression();
      if (!isKovoServerCalleeExpression(expression, 'domain')) continue;

      const domainObject = domainWriteObject(domainCall.getArguments()[0]);
      if (!domainObject.body) continue;

      for (const property of domainWriteProperties(domainObject.body)) {
        if (rawTablesFromWriteInitializer(property.initializer).length === 0) continue;
        const callback = writeActionCallbackFunction(property.initializer);
        if (!callback) continue;
        const trust = rawWriteSqlTrustForCallback(callback, file);
        if (trust.hasRawSqlSink) {
          trustByWrite.set(`${domainName.getText()}.${property.memberName}`, trust);
        }
      }
    }

    return trustByWrite;
  });
}

/** @internal */ export interface RawWriteSqlTrust {
  hasRawSqlSink: boolean;
  site?: string;
  trusted: boolean;
}

/** @internal */ export function forEachMutationConfig(
  sourceFile: SourceFile,
  visit: (key: string, config: ObjectLiteralExpression) => void,
): void {
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const call = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(call)) continue;
    const mutation = staticMutationDeclarationFromCall(declaration, call);
    if (!mutation || !Node.isObjectLiteralExpression(mutation.bodyArgument)) continue;
    visit(mutation.key, mutation.bodyArgument);
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)) continue;
    if (!isKovoServerCalleeExpression(call.getExpression(), 'mutation')) continue;

    const [keyArgument, configArgument] = call.getArguments();
    if (
      !(
        (Node.isStringLiteral(keyArgument) || Node.isNoSubstitutionTemplateLiteral(keyArgument)) &&
        Node.isObjectLiteralExpression(configArgument)
      )
    ) {
      continue;
    }

    visit(keyArgument.getLiteralText(), configArgument);
  }
}

/** @internal */ export function rawTablesFromMutationRegistry(
  config: ObjectLiteralExpression,
): string[] {
  const registry = objectPropertyInitializer(config, 'registry');
  if (!registry) return [];
  const registryObject = unwrappedStaticExpressionNode(registry);
  if (!Node.isObjectLiteralExpression(registryObject)) return [];
  return stringArrayPropertyFromObject(registryObject, 'tables');
}

/** @internal */ export function mutationHandlerCallback(
  config: ObjectLiteralExpression,
): Node | undefined {
  for (const property of config.getProperties()) {
    if (Node.isMethodDeclaration(property)) {
      if (propertyNameText(property.getNameNode()) === 'handler') return property;
      continue;
    }

    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== 'handler') continue;

    const initializer = property.getInitializer();
    if (!initializer) continue;
    const expression = unwrappedStaticExpressionNode(initializer);
    if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
      return expression;
    }
    return referencedWriteCallbackFunction(expression);
  }

  return undefined;
}

/** @internal */ export function rawTablesByMutationHandler(
  file: SourceFileInput,
): ReadonlyMap<string, readonly string[]> {
  return withParsedSourceFile(projectSourceFileInput(file), (sourceFile) => {
    const rawTables = new Map<string, string[]>();
    const localFunctions = rawSqlLocalFunctionsByName(sourceFile);

    forEachMutationConfig(sourceFile, (key, config) => {
      const tables = rawTablesFromMutationRegistry(config);
      if (tables.length === 0) return;

      rawTables.set(key, tables);
      const callback = mutationHandlerCallback(config);
      if (!callback) return;

      for (const helperName of rawSqlLocalHelperCallNamesReceivingDriver(
        callback,
        localFunctions,
        new Set(),
      )) {
        rawTables.set(helperName, mergedRawTables(rawTables.get(helperName), tables));
      }
    });

    return rawTables;
  });
}

/** @internal */ export function rawWriteSqlTrustByMutationHandler(
  file: SourceFileInput,
): ReadonlyMap<string, RawWriteSqlTrust> {
  return withParsedSourceFile(projectSourceFileInput(file), (sourceFile) => {
    const trustByMutation = new Map<string, RawWriteSqlTrust>();

    forEachMutationConfig(sourceFile, (key, config) => {
      if (rawTablesFromMutationRegistry(config).length === 0) return;
      const callback = mutationHandlerCallback(config);
      if (!callback) return;
      const trust = rawWriteSqlTrustForCallback(callback, file);
      if (trust.hasRawSqlSink) trustByMutation.set(key, trust);
    });

    return trustByMutation;
  });
}

function projectSourceFileInput(file: SourceFileInput): SourceFileInput {
  const fileName = projectSourceFileName(file.fileName);
  return fileName === file.fileName ? file : { ...file, fileName };
}

/** @internal */ export function mergedRawTables(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

/** @internal */ export function rawWriteSqlTrustForCallback(
  callback: Node,
  file: SourceFileInput,
): RawWriteSqlTrust {
  return rawWriteSqlTrustForNode(
    callback,
    file,
    rawSqlLocalFunctionsByName(callback.getSourceFile()),
    new Set(),
  );
}

function rawWriteSqlTrustForNode(
  node: Node,
  file: SourceFileInput,
  localFunctions: ReadonlyMap<string, Node>,
  visited: Set<string>,
): RawWriteSqlTrust {
  const rawSqlSinkCalls = node.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface || !RAW_SQL_WRITE_RECEIVER_SINK_METHODS.has(surface.name)) return false;
    return sqlSinkReceiverCanCarrySql(call.getExpression(), surface.name);
  });
  const firstUntrusted = rawSqlSinkCalls.find((call) => !isTrustedSqlArgument(call));
  const siteCall = firstUntrusted ?? rawSqlSinkCalls[0];

  let trust: RawWriteSqlTrust = {
    hasRawSqlSink: rawSqlSinkCalls.length > 0,
    ...(siteCall
      ? { site: `${file.fileName}:${lineForIndex(file.source, siteCall.getStart())}` }
      : {}),
    trusted: rawSqlSinkCalls.length > 0 && !firstUntrusted,
  };

  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!rawSqlHelperCallReceivesDriver(call)) continue;
    const helper = rawSqlLocalHelperCallTarget(call, localFunctions);
    if (!helper) continue;
    const helperName = rawSqlLocalHelperCallName(call);
    if (!helperName || visited.has(helperName)) continue;
    visited.add(helperName);
    trust =
      mergedRawWriteSqlTrust(
        trust,
        rawWriteSqlTrustForNode(helper, file, localFunctions, visited),
      ) ?? trust;
  }

  return trust;
}

/** @internal */ export function rawSqlLocalFunctionsByName(
  sourceFile: SourceFile,
): ReadonlyMap<string, Node> {
  const functions = new Map<string, Node>();
  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    const body = declaration.getBody();
    if (name && body) functions.set(name, body);
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const expression = unwrappedStaticExpressionNode(initializer);
    if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) continue;
    functions.set(name.getText(), expression.getBody());
  }
  return functions;
}

function rawSqlLocalHelperCallTarget(
  call: CallExpression,
  localFunctions: ReadonlyMap<string, Node>,
): Node | undefined {
  const name = rawSqlLocalHelperCallName(call);
  return name ? localFunctions.get(name) : undefined;
}

function rawSqlLocalHelperCallName(call: CallExpression): string | undefined {
  const expression = unwrappedStaticExpressionNode(call.getExpression());
  return Node.isIdentifier(expression) ? expression.getText() : undefined;
}

function rawSqlHelperCallReceivesDriver(call: CallExpression): boolean {
  return call.getArguments().some(rawSqlReceiverArgument);
}

/** @internal */ export function rawSqlLocalHelperCallNamesReceivingDriver(
  node: Node,
  localFunctions: ReadonlyMap<string, Node>,
  visited: Set<string>,
): Set<string> {
  const names = new Set<string>();
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!rawSqlHelperCallReceivesDriver(call)) continue;
    const helperName = rawSqlLocalHelperCallName(call);
    if (!helperName || visited.has(helperName)) continue;
    const helper = localFunctions.get(helperName);
    if (!helper) continue;

    visited.add(helperName);
    names.add(helperName);
    for (const nestedName of rawSqlLocalHelperCallNamesReceivingDriver(
      helper,
      localFunctions,
      visited,
    )) {
      names.add(nestedName);
    }
  }
  return names;
}

function rawSqlReceiverArgument(argument: Node): boolean {
  const expression = unwrappedStaticExpressionNode(argument);
  if (Node.isIdentifier(expression)) return isLikelyDrizzleReceiver(expression.getText());
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const name = staticAccessName(expression);
    if (name && isLikelyDrizzleReceiver(name)) return true;
  }
  return isProjectDrizzleReceiverContainerExpression(expression);
}

function isTrustedSqlArgument(call: CallExpression): boolean {
  const argument = call.getArguments()[0];
  if (!argument) return false;
  const expression = unwrappedStaticExpressionNode(argument);
  if (!Node.isCallExpression(expression)) return false;
  return isKovoDrizzleTrustedSqlCall(expression);
}

function sqlSinkReceiverCanCarrySql(expression: Node, methodName: string): boolean {
  const receiver = staticAccessExpression(expression);
  if (!receiver) return false;
  const receiverExpression = unwrappedStaticExpressionNode(receiver);
  // SQLite drivers expose `db.values(sql)` as an execution sink, while Drizzle insert builders
  // expose `db.insert(table).values(row)`. The builder receiver is a call expression; do not turn
  // ordinary row payloads into KV422 SQL text diagnostics.
  if (Node.isCallExpression(receiverExpression)) return false;
  if (!AMBIGUOUS_RAW_SQL_RECEIVER_SINK_METHODS.has(methodName)) return true;
  return sqlSinkReceiverLooksLikeDriver(receiverExpression);
}

function sqlSinkReceiverLooksLikeDriver(receiver: Node): boolean {
  if (Node.isIdentifier(receiver) && isLikelyDrizzleReceiver(receiver.getText())) return true;
  if (Node.isPropertyAccessExpression(receiver) || Node.isElementAccessExpression(receiver)) {
    const name = staticAccessName(receiver);
    if (name && isLikelyDrizzleReceiver(name)) return true;
  }
  return isProjectDrizzleReceiverContainerExpression(receiver);
}

/** @internal */ export function mergedRawWriteSqlTrust(
  left: RawWriteSqlTrust | undefined,
  right: RawWriteSqlTrust | undefined,
): RawWriteSqlTrust | undefined {
  if (!left) return right;
  if (!right) return left;

  return {
    hasRawSqlSink: left.hasRawSqlSink || right.hasRawSqlSink,
    ...(left.site || right.site ? { site: left.site ?? right.site } : {}),
    trusted: (!left.hasRawSqlSink || left.trusted) && (!right.hasRawSqlSink || right.trusted),
  };
}

const AMBIGUOUS_RAW_SQL_RECEIVER_SINK_METHODS = new Set(['values']);

/** @internal */ export function writeActionCallbackFunction(
  initializer: Node | undefined,
  seen: Set<string> = new Set(),
): ReturnType<CallExpression['getArguments']>[number] | null {
  return writeActionCallbackResolution(initializer, seen).callbacks[0] ?? null;
}

/** @internal */ export interface WriteActionCallbackResolution {
  callbacks: Node[];
  unresolved: boolean;
}

/** @internal */ export function writeActionCallbackResolution(
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

/** @internal */ export function writeActionCallbackFromDeclaration(
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

/** @internal */ export function writeActionCallbackFromBindingElement(
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

/** @internal */ export function writeCallbackArgumentFunction(argument: Node): Node | null {
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

/** @internal */ export function referencedWriteCallbackFunction(
  identifier: Node,
): Node | undefined {
  // SPEC §10-§11: mutation touch facts must come from an executable local callback body; cross
  // module project references are followed through ts-morph aliases instead of by-name fallback.
  return callbackFunctionFromReference(identifier, new Set());
}

/** @internal */ export function extractedFunctionKey(
  name: string,
  callback: Node,
  keyNode: Node = callback,
): string {
  return (
    resolvedSymbolKey(keyNode.getSymbol()) ??
    `${callback.getSourceFile().getFilePath()}:${callback.getStart()}:${name}`
  );
}
