import ts from 'typescript';

import type {
  CapabilityClosureSourceFile,
  RawCapabilityKind,
  ScannedBindingAliasFact,
  ScannedBrowserHandlerFact,
  ScannedCallFact,
  ScannedCapabilityModule,
  ScannedExportBindingFact,
  ScannedGlobalCapabilityFact,
  ScannedImportBindingFact,
  ScannedImportFact,
} from '../security/capability-closure-model.js';
import { classifyRawCapabilityModuleSpecifier } from '../security/capability-closure-model.js';

const globalCapabilities = new Map<string, RawCapabilityKind>([
  ['Bun', 'process'],
  ['Deno', 'process'],
  ['EventSource', 'network'],
  ['Function', 'vm'],
  ['RTCPeerConnection', 'network'],
  ['SharedWorker', 'worker'],
  ['ShadowRealm', 'vm'],
  ['WebAssembly', 'vm'],
  ['WebSocket', 'network'],
  ['WebSocketStream', 'network'],
  ['WebTransport', 'network'],
  ['Worker', 'worker'],
  ['XMLHttpRequest', 'network'],
  ['eval', 'vm'],
  ['fetch', 'network'],
  ['importScripts', 'dynamic-loader'],
  ['module', 'dynamic-loader'],
  ['process', 'process'],
  ['require', 'dynamic-loader'],
]);

const globalNamespaceMembers = new Map<string, RawCapabilityKind>([
  ['Bun', 'process'],
  ['Deno', 'process'],
  ['EventSource', 'network'],
  ['Function', 'vm'],
  ['RTCPeerConnection', 'network'],
  ['SharedWorker', 'worker'],
  ['ShadowRealm', 'vm'],
  ['WebAssembly', 'vm'],
  ['WebSocket', 'network'],
  ['WebSocketStream', 'network'],
  ['WebTransport', 'network'],
  ['Worker', 'worker'],
  ['XMLHttpRequest', 'network'],
  ['eval', 'vm'],
  ['fetch', 'network'],
  ['importScripts', 'dynamic-loader'],
  ['module', 'dynamic-loader'],
  ['process', 'process'],
  ['require', 'dynamic-loader'],
]);

/** Scanner/source-text boundary for the capability-closed module graph (SPEC §5.2 rule 10). */
export function scanCapabilityClosureModules(
  files: readonly CapabilityClosureSourceFile[],
): ScannedCapabilityModule[] {
  return files.map(scanCapabilityClosureModule);
}

function scanCapabilityClosureModule(file: CapabilityClosureSourceFile): ScannedCapabilityModule {
  const scriptKind = scriptKindForFile(file.fileName);
  const sourceFile = ts.createSourceFile(
    file.fileName,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const aliases: ScannedBindingAliasFact[] = [];
  const browserHandlers: ScannedBrowserHandlerFact[] = [];
  const calls: ScannedCallFact[] = [];
  const exports: ScannedExportBindingFact[] = [];
  const globals: ScannedGlobalCapabilityFact[] = [];
  const importBindings: ScannedImportBindingFact[] = [];
  const imports: ScannedImportFact[] = [];

  collectStaticImportsAndExports(sourceFile, imports, importBindings, exports);
  collectBindingAliases(sourceFile, aliases);
  const callbackCarriers = callbackCarrierNames(sourceFile, importBindings);
  const globalAliases = globalNamespaceAliases(aliases);

  const scopes: readonly Set<string>[] = [];
  visitWithScopes(sourceFile, scopes, (node, activeScopes) => {
    if (ts.isCallExpression(node)) {
      collectCall(node, sourceFile, callbackCarriers, activeScopes, calls, imports);
    }
    if (ts.isJsxAttribute(node) && jsxAttributeIsHandler(node)) {
      browserHandlers.push({
        name: node.name.getText(sourceFile),
        site: sourceSite(sourceFile, node.getStart(sourceFile)),
      });
    }
    collectGlobalCapability(node, sourceFile, activeScopes, globalAliases, globals);
  });
  collectAliasGlobalCapabilities(aliases, globals);

  for (const imported of imports) {
    if (imported.specifier === undefined) continue;
    const capability = classifyRawCapabilityModuleSpecifier(imported.specifier);
    if (capability === undefined) continue;
    globals.push({
      capability,
      evidence: `raw module ${imported.specifier}`,
      site: imported.site,
    });
  }

  return {
    aliases,
    browserHandlers,
    calls,
    exports,
    fileName: file.fileName,
    globals: dedupeGlobals(globals),
    importBindings,
    imports,
  };
}

function collectStaticImportsAndExports(
  sourceFile: ts.SourceFile,
  imports: ScannedImportFact[],
  bindings: ScannedImportBindingFact[],
  exports: ScannedExportBindingFact[],
): void {
  const firstImport = sourceFile.statements.find((statement) => ts.isImportDeclaration(statement));
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      const importedNames: string[] = [];
      if (clause === undefined) importedNames.push('<module>');
      if (clause?.name) {
        importedNames.push('default');
        bindings.push({ imported: 'default', local: clause.name.text, specifier });
      }
      const namedBindings = clause?.namedBindings;
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        importedNames.push('*');
        bindings.push({
          imported: '*',
          local: namedBindings.name.text,
          namespace: true,
          specifier,
        });
      } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        if (namedBindings.elements.length === 0) importedNames.push('<module>');
        for (const element of namedBindings.elements) {
          if (element.isTypeOnly) continue;
          const imported = element.propertyName?.text ?? element.name.text;
          importedNames.push(imported);
          bindings.push({ imported, local: element.name.text, specifier });
        }
      }
      if (clause !== undefined && importedNames.length === 0) continue;
      imports.push({
        ...(statement === firstImport ? { firstImport: true } : {}),
        importedNames: uniqueSorted(importedNames),
        kind: 'import',
        site: sourceSite(sourceFile, statement.moduleSpecifier.getStart(sourceFile)),
        specifier,
      });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      const importedNames: string[] = [];
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        if (statement.exportClause.elements.length === 0) importedNames.push('<module>');
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          const imported = element.propertyName?.text ?? element.name.text;
          importedNames.push(imported);
          exports.push({
            exported: element.name.text,
            ...(specifier === undefined ? { local: imported } : { imported, specifier }),
          });
        }
        if (importedNames.length === 0) continue;
      } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        importedNames.push('*');
        exports.push({
          exported: statement.exportClause.name.text,
          imported: '*',
          ...(specifier === undefined ? {} : { specifier }),
        });
      } else {
        importedNames.push('*');
        exports.push({ ...(specifier === undefined ? {} : { specifier }), wildcard: true });
      }
      if (specifier !== undefined) {
        imports.push({
          importedNames: uniqueSorted(importedNames),
          kind: 're-export',
          site: sourceSite(sourceFile, statement.moduleSpecifier!.getStart(sourceFile)),
          specifier,
        });
      }
      continue;
    }

    if (hasExportModifier(statement)) {
      for (const name of declaredStatementNames(statement)) {
        exports.push({ exported: name, local: name });
      }
    }
    if (hasDefaultModifier(statement)) {
      const name = declarationName(statement);
      if (name !== undefined) exports.push({ exported: 'default', local: name });
    }
  }
}

function collectBindingAliases(
  sourceFile: ts.SourceFile,
  aliases: ScannedBindingAliasFact[],
): void {
  visitWithScopes(sourceFile, [], (node, scopes) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      collectAliasFromBindingName(
        node.name,
        expressionBindingKey(node.initializer),
        sourceSite(sourceFile, node.getStart(sourceFile)),
        expressionStartsAtUnshadowedGlobalNamespace(node.initializer, scopes),
        aliases,
      );
      if (ts.isObjectBindingPattern(node.name)) {
        const base = expressionBindingKey(node.initializer);
        if (base !== undefined) {
          for (const element of node.name.elements) {
            if (element.dotDotDotToken) continue;
            const target = bindingNameSingleIdentifier(element.name);
            const member = element.propertyName
              ? propertyNameText(element.propertyName)
              : bindingNameSingleIdentifier(element.name);
            if (target !== undefined && member !== undefined) {
              aliases.push({
                local: target,
                site: sourceSite(sourceFile, element.getStart(sourceFile)),
                source: `${base}.${member}`,
                ...(expressionStartsAtUnshadowedGlobalNamespace(node.initializer, scopes)
                  ? { sourceStartsAtUnshadowedGlobalNamespace: true }
                  : {}),
              });
            }
          }
        }
      }
      if (ts.isObjectLiteralExpression(node.initializer) && ts.isIdentifier(node.name)) {
        for (const property of node.initializer.properties) {
          if (ts.isShorthandPropertyAssignment(property)) {
            aliases.push({
              local: `${node.name.text}.${property.name.text}`,
              site: sourceSite(sourceFile, property.getStart(sourceFile)),
              source: property.name.text,
            });
          } else if (ts.isPropertyAssignment(property)) {
            const member = propertyNameText(property.name);
            const source = expressionBindingKey(property.initializer);
            if (member !== undefined && source !== undefined) {
              aliases.push({
                local: `${node.name.text}.${member}`,
                site: sourceSite(sourceFile, property.getStart(sourceFile)),
                source,
              });
            }
          }
        }
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const local = expressionBindingKey(node.left);
      const source = expressionBindingKey(node.right);
      if (local !== undefined && source !== undefined) {
        aliases.push({
          local,
          site: sourceSite(sourceFile, node.getStart(sourceFile)),
          source,
          ...(expressionStartsAtUnshadowedGlobalNamespace(node.right, scopes)
            ? { sourceStartsAtUnshadowedGlobalNamespace: true }
            : {}),
        });
      }
    }
  });
}

function collectAliasFromBindingName(
  name: ts.BindingName,
  source: string | undefined,
  site: string,
  sourceStartsAtUnshadowedGlobalNamespace: boolean,
  aliases: ScannedBindingAliasFact[],
): void {
  if (!ts.isIdentifier(name) || source === undefined || name.text === source) return;
  aliases.push({
    local: name.text,
    site,
    source,
    ...(sourceStartsAtUnshadowedGlobalNamespace
      ? { sourceStartsAtUnshadowedGlobalNamespace: true }
      : {}),
  });
}

function collectCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  callbackCarriers: ReadonlySet<string>,
  scopes: readonly Set<string>[],
  calls: ScannedCallFact[],
  imports: ScannedImportFact[],
): void {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const argument = node.arguments[0];
    imports.push({
      importedNames: ['*'],
      kind: 'dynamic-import',
      site: sourceSite(sourceFile, node.getStart(sourceFile)),
      ...(argument && ts.isStringLiteralLike(argument) ? { specifier: argument.text } : {}),
    });
    return;
  }

  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    !scopeBinds(scopes, 'require')
  ) {
    const argument = node.arguments[0];
    imports.push({
      importedNames: ['*'],
      kind: 'require',
      site: sourceSite(sourceFile, node.getStart(sourceFile)),
      ...(argument && ts.isStringLiteralLike(argument) ? { specifier: argument.text } : {}),
    });
    return;
  }

  const callee = expressionBindingKey(node.expression);
  if (callee === undefined) return;
  const first = node.arguments[0];
  const firstArgumentBinding = first === undefined ? undefined : expressionBindingKey(first);
  const assignedName = assignedCallName(node);
  calls.push({
    ...(assignedName === undefined ? {} : { assignedName }),
    callee,
    carriesCallback: node.arguments.some((argument) =>
      expressionCarriesCallback(argument, callbackCarriers),
    ),
    ...(firstArgumentBinding === undefined ? {} : { firstArgumentBinding }),
    ...(first && ts.isStringLiteralLike(first) ? { firstLiteral: first.text } : {}),
    hasCron: node.arguments.some(argumentHasCron),
    site: sourceSite(sourceFile, node.getStart(sourceFile)),
  });
}

function collectGlobalCapability(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scopes: readonly Set<string>[],
  globalAliases: ReadonlySet<string>,
  globals: ScannedGlobalCapabilityFact[],
): void {
  if (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    ts.isIdentifier(node.expression)
  ) {
    const namespace = node.expression.text;
    const directGlobal =
      namespace === 'globalThis' ||
      namespace === 'global' ||
      namespace === 'window' ||
      namespace === 'self';
    const member = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : undefined;
    const capability = member === undefined ? undefined : globalNamespaceMembers.get(member);
    if (
      capability !== undefined &&
      (directGlobal ? !scopeBinds(scopes, namespace) : globalAliases.has(namespace))
    ) {
      globals.push({
        capability,
        evidence: `${namespace}.${member}`,
        site: sourceSite(sourceFile, node.getStart(sourceFile)),
      });
    }
    if (capability !== undefined) {
      return;
    }
  }

  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'navigator' &&
    node.name.text === 'sendBeacon' &&
    !scopeBinds(scopes, 'navigator')
  ) {
    globals.push({
      capability: 'network',
      evidence: 'navigator.sendBeacon',
      site: sourceSite(sourceFile, node.getStart(sourceFile)),
    });
    return;
  }

  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'navigator' &&
    node.name.text === 'serviceWorker' &&
    !scopeBinds(scopes, 'navigator')
  ) {
    globals.push({
      capability: 'worker',
      evidence: 'navigator.serviceWorker',
      site: sourceSite(sourceFile, node.getStart(sourceFile)),
    });
    return;
  }

  if (!ts.isIdentifier(node) || !identifierIsValueReference(node)) return;
  if (scopeBinds(scopes, node.text)) return;
  const capability = globalCapabilities.get(node.text);
  if (capability === undefined) return;
  if (
    node.text === 'require' &&
    ts.isCallExpression(node.parent) &&
    node.parent.expression === node
  ) {
    return;
  }
  if (node.text === 'eval' && ts.isCallExpression(node.parent) && node.parent.expression !== node) {
    return;
  }
  globals.push({
    capability,
    evidence: `global ${node.text}`,
    site: sourceSite(sourceFile, node.getStart(sourceFile)),
  });
}

function visitWithScopes(
  node: ts.Node,
  scopes: readonly Set<string>[],
  callback: (node: ts.Node, scopes: readonly Set<string>[]) => void,
): void {
  const bindings = lexicalBindings(node);
  const activeScopes = bindings === undefined ? scopes : [...scopes, bindings];
  callback(node, activeScopes);
  ts.forEachChild(node, (child) => visitWithScopes(child, activeScopes, callback));
}

function lexicalBindings(node: ts.Node): Set<string> | undefined {
  const names = new Set<string>();
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    for (const statement of node.statements) {
      for (const name of declaredStatementNames(statement)) names.add(name);
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) names.add(clause.name.text);
        const namedBindings = clause?.namedBindings;
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
          names.add(namedBindings.name.text);
        } else if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) names.add(element.name.text);
        }
      }
    }
  } else if (ts.isFunctionLike(node)) {
    if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    for (const parameter of node.parameters) collectBindingNames(parameter.name, names);
  } else if (ts.isCatchClause(node) && node.variableDeclaration) {
    collectBindingNames(node.variableDeclaration.name, names);
  } else if (
    (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
    node.initializer &&
    ts.isVariableDeclarationList(node.initializer)
  ) {
    for (const declaration of node.initializer.declarations) {
      collectBindingNames(declaration.name, names);
    }
  } else {
    return undefined;
  }
  return names;
}

function declaredStatementNames(statement: ts.Statement): string[] {
  const names = new Set<string>();
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, names);
    }
  } else if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)) &&
    statement.name
  ) {
    names.add(statement.name.text);
  }
  return [...names];
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function callbackCarrierNames(
  sourceFile: ts.SourceFile,
  importBindings: readonly ScannedImportBindingFact[],
): ReadonlySet<string> {
  // Imported runtime values are opaque at this syntax boundary. Treat them as potential callbacks
  // when transferred through a local wrapper; the graph then follows their eager source module or
  // exact package verdict instead of allowing an imported callable by omission.
  const carriers = new Set(importBindings.map((binding) => binding.local));
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (
          expressionCarriesCallback(node.initializer, carriers) &&
          !carriers.has(node.name.text)
        ) {
          carriers.add(node.name.text);
          changed = true;
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && !carriers.has(node.name.text)) {
        carriers.add(node.name.text);
        changed = true;
      }
      if (ts.isFunctionLike(node)) {
        for (const parameter of node.parameters) {
          const names = new Set<string>();
          collectBindingNames(parameter.name, names);
          for (const name of names) {
            if (carriers.has(name)) continue;
            carriers.add(name);
            changed = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return carriers;
}

function expressionCarriesCallback(
  expression: ts.Expression,
  carriers: ReadonlySet<string>,
): boolean {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return true;
  if (ts.isIdentifier(expression)) return carriers.has(expression.text);
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const base = expressionBindingKey(expression.expression);
    return base !== undefined && carriers.has(base.split('.')[0]!);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return expressionCarriesCallback(expression.expression, carriers);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return expressionCarriesCallback(expression.expression, carriers);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (ts.isMethodDeclaration(property)) return true;
      if (ts.isPropertyAssignment(property)) {
        return expressionCarriesCallback(property.initializer, carriers);
      }
      if (ts.isShorthandPropertyAssignment(property)) return carriers.has(property.name.text);
      if (ts.isSpreadAssignment(property)) {
        return expressionCarriesCallback(property.expression, carriers);
      }
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some(
      (element) => !ts.isSpreadElement(element) && expressionCarriesCallback(element, carriers),
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      expressionCarriesCallback(expression.whenTrue, carriers) ||
      expressionCarriesCallback(expression.whenFalse, carriers)
    );
  }
  return false;
}

function argumentHasCron(expression: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expression)) return false;
  return expression.properties.some((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return false;
    }
    return propertyNameText(property.name) === 'cron';
  });
}

function jsxAttributeIsHandler(attribute: ts.JsxAttribute): boolean {
  const name = attribute.name.getText();
  return name.startsWith('on') || name.startsWith('on:');
}

function globalNamespaceAliases(aliases: readonly ScannedBindingAliasFact[]): ReadonlySet<string> {
  const canonical = new Set(['globalThis', 'global', 'window', 'self']);
  const namespaces = new Set(canonical);
  let changed = true;
  while (changed) {
    changed = false;
    for (const alias of aliases) {
      const sourceIsCanonical = canonical.has(alias.source);
      const sourceIsTrusted = sourceIsCanonical
        ? alias.sourceStartsAtUnshadowedGlobalNamespace === true
        : namespaces.has(alias.source);
      if (alias.local.includes('.') || !sourceIsTrusted || namespaces.has(alias.local)) {
        continue;
      }
      namespaces.add(alias.local);
      changed = true;
    }
  }
  return namespaces;
}

function collectAliasGlobalCapabilities(
  aliases: readonly ScannedBindingAliasFact[],
  globals: ScannedGlobalCapabilityFact[],
): void {
  const namespaces = globalNamespaceAliases(aliases);
  const canonical = new Set(['globalThis', 'global', 'window', 'self']);
  for (const alias of aliases) {
    const separator = alias.source.indexOf('.');
    if (separator < 0) continue;
    const namespace = alias.source.slice(0, separator);
    const member = alias.source.slice(separator + 1);
    if (
      canonical.has(namespace)
        ? alias.sourceStartsAtUnshadowedGlobalNamespace !== true
        : !namespaces.has(namespace)
    ) {
      continue;
    }
    const capability = globalNamespaceMembers.get(member);
    if (capability === undefined) continue;
    globals.push({ capability, evidence: alias.source, site: alias.site });
  }
}

function expressionStartsAtUnshadowedGlobalNamespace(
  expression: ts.Expression,
  scopes: readonly Set<string>[],
): boolean {
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapExpression(current.expression);
  }
  return (
    ts.isIdentifier(current) &&
    (current.text === 'globalThis' ||
      current.text === 'global' ||
      current.text === 'window' ||
      current.text === 'self') &&
    !scopeBinds(scopes, current.text)
  );
}

function expressionBindingKey(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = expressionBindingKey(unwrapped.expression);
    return base === undefined ? undefined : `${base}.${unwrapped.name.text}`;
  }
  if (
    ts.isElementAccessExpression(unwrapped) &&
    unwrapped.argumentExpression &&
    ts.isStringLiteralLike(unwrapped.argumentExpression)
  ) {
    const base = expressionBindingKey(unwrapped.expression);
    return base === undefined ? undefined : `${base}.${unwrapped.argumentExpression.text}`;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function assignedCallName(call: ts.CallExpression): string | undefined {
  const parent = call.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.left)
  ) {
    return parent.left.text;
  }
  return undefined;
}

function identifierIsValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertySignature(parent) && parent.name === identifier) ||
    (ts.isTypeReferenceNode(parent) && parent.typeName === identifier) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isBindingElement(parent) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    ((ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent)) &&
      parent.name === identifier)
  ) {
    return false;
  }
  return true;
}

function scopeBinds(scopes: readonly Set<string>[], name: string): boolean {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (scopes[index]!.has(name)) return true;
  }
  return false;
}

function sourceSite(sourceFile: ts.SourceFile, start: number): string {
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function bindingNameSingleIdentifier(name: ts.BindingName): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

function declarationName(node: ts.Node): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
    return node.name.text;
  }
  return undefined;
}

function scriptKindForFile(fileName: string): ts.ScriptKind {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (normalized.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function dedupeGlobals(
  facts: readonly ScannedGlobalCapabilityFact[],
): ScannedGlobalCapabilityFact[] {
  const seen = new Set<string>();
  const result: ScannedGlobalCapabilityFact[] = [];
  for (const fact of facts) {
    const key = `${fact.capability}\0${fact.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result.sort(
    (left, right) =>
      left.site.localeCompare(right.site) || left.evidence.localeCompare(right.evidence),
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
