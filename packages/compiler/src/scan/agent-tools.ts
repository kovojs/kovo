import * as path from 'node:path';

import * as ts from 'typescript';

import type * as CoreGraph from '@kovojs/core/internal/graph';

import { parseSourceFile } from './parse.js';

/** @internal One authored module that may contain framework-owned `tool()` declarations. */
export interface AgentToolModuleSource {
  fileName: string;
  source: string;
}

/**
 * @internal Produce sound, reachable sink rows from framework-owned `tool()` handlers.
 *
 * This scanner intentionally accepts a narrow subset: a named `tool` import from `@kovojs/server`,
 * a literal `name`, direct handler-body reads/calls, direct calls to top-level same-module helper
 * functions that are visible in the parsed AST, directly-invoked inline function bodies, and local
 * helpers reached through static named/default imports including static local re-export barrels,
 * unique local `export *` barrels for named imports, default exports that alias a summarized local
 * helper, static namespace-property calls into exported local helpers, default object exports whose
 * properties statically point at summarized local helpers, handler properties that reference a
 * summarized local/imported helper function, and inline callbacks passed to a local/imported helper
 * that directly invokes that callback parameter. It does not inspect raw source text after parse and
 * it skips non-invoked nested function bodies, so ordinary callbacks, computed namespace access,
 * computed/spread object exports, export-star namespaces, ambiguous export-star names, and dynamic
 * paths remain outside the SPEC.md §6.6 sound subset until a dedicated analyzer proves them.
 */
export function agentToolSinksFromSource(
  moduleSource: AgentToolModuleSource,
  moduleSources: readonly AgentToolModuleSource[] = [moduleSource],
): CoreGraph.AgentToolReachableSinkFact[] {
  const modules = summarizeModules(moduleSources);
  const sourceFile = modules.sourceFiles.get(normalizeModuleFileName(moduleSource.fileName));
  if (!sourceFile) return [];

  const toolLocalNames = frameworkToolImportNames(sourceFile);
  if (toolLocalNames.size === 0) return [];

  const moduleFacts = modules.facts.get(sourceFile);
  if (!moduleFacts) return [];

  const facts: CoreGraph.AgentToolReachableSinkFact[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== sourceFile && ts.isFunctionLike(node)) return;

    if (!ts.isCallExpression(node) || !isIdentifierNamed(node.expression, toolLocalNames)) {
      ts.forEachChild(node, visit);
      return;
    }

    const [definition] = node.arguments;
    if (!definition || !ts.isObjectLiteralExpression(definition)) return;

    const name = stringPropertyValue(definition, 'name');
    if (name === undefined) return;

    const handler = handlerTarget(definition, moduleFacts);
    if (handler === undefined) return;

    facts.push(...handlerSinkFacts(name, handler));
  };

  visit(sourceFile);
  return uniqueAgentToolSinkFacts(facts).sort(compareAgentToolSinkFact);
}

interface ModuleFacts {
  ambiguousExportStarHelpers: ReadonlySet<string>;
  defaultObjectHelpers: ReadonlyMap<string, HelperDefinition>;
  helpers: ReadonlyMap<string, HelperDefinition>;
  namespaceImports: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>;
  sourceFile: ts.SourceFile;
  topLevelBindings: ReadonlySet<string>;
}

interface HelperDefinition {
  exported: boolean;
  id: string;
  moduleFacts: ModuleFacts;
  node: ts.FunctionLikeDeclaration;
  reachedThroughExportStar?: true;
}

interface HandlerTarget {
  moduleFacts: ModuleFacts;
  node: ts.FunctionLikeDeclaration;
  origin: AgentToolSinkOrigin;
}

interface ModuleSummaries {
  facts: ReadonlyMap<ts.SourceFile, ModuleFacts>;
  sourceFiles: ReadonlyMap<string, ts.SourceFile>;
}

function summarizeModules(moduleSources: readonly AgentToolModuleSource[]): ModuleSummaries {
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const moduleSource of moduleSources) {
    const fileName = normalizeModuleFileName(moduleSource.fileName);
    if (!sourceFiles.has(fileName)) {
      sourceFiles.set(fileName, parseSourceFile(moduleSource.fileName, moduleSource.source));
    }
  }

  const facts = new Map<ts.SourceFile, ModuleFacts>();
  for (const sourceFile of sourceFiles.values()) {
    facts.set(sourceFile, summarizeModule(sourceFile));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const moduleFacts of facts.values()) {
      changed = linkImportedHelpers(moduleFacts, sourceFiles, facts) || changed;
    }
  }

  return { facts, sourceFiles };
}

function summarizeModule(sourceFile: ts.SourceFile): ModuleFacts {
  const ambiguousExportStarHelpers = new Set<string>();
  const defaultObjectHelpers = new Map<string, HelperDefinition>();
  const helpers = new Map<string, HelperDefinition>();
  const namespaceImports = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  const topLevelBindings = new Set<string>();
  const moduleFacts: ModuleFacts = {
    ambiguousExportStarHelpers,
    defaultObjectHelpers,
    helpers,
    namespaceImports,
    sourceFile,
    topLevelBindings,
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportBindingNames(statement, topLevelBindings);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelBindings.add(statement.name.text);
      helpers.set(statement.name.text, {
        exported: hasExportModifier(statement) && !hasDefaultModifier(statement),
        id: helperId(sourceFile, statement.name.text),
        moduleFacts,
        node: statement,
      });
    }

    const defaultExportedFunction = defaultExportedFunctionHelper(statement);
    if (defaultExportedFunction) {
      helpers.set('default', {
        exported: true,
        id: helperId(sourceFile, 'default'),
        moduleFacts,
        node: defaultExportedFunction,
      });
      continue;
    }

    if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      topLevelBindings.add(statement.name.text);
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, topLevelBindings);
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        helpers.set(declaration.name.text, {
          exported: hasExportModifier(statement),
          id: helperId(sourceFile, declaration.name.text),
          moduleFacts,
          node: declaration.initializer,
        });
      }
    }
  }

  for (const statement of sourceFile.statements) {
    collectDefaultHelperAlias(statement, moduleFacts);
    collectDefaultObjectHelperBindings(statement, moduleFacts);
  }

  return moduleFacts;
}

function linkImportedHelpers(
  moduleFacts: ModuleFacts,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  facts: ReadonlyMap<ts.SourceFile, ModuleFacts>,
): boolean {
  const helpers = moduleFacts.helpers as Map<string, HelperDefinition>;
  const namespaceImports = moduleFacts.namespaceImports as Map<
    string,
    ReadonlyMap<string, HelperDefinition>
  >;
  let changed = false;

  for (const statement of moduleFacts.sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier))
        continue;
      if (statement.importClause?.isTypeOnly) continue;

      const importedSourceFile = importedLocalSourceFile(
        moduleFacts.sourceFile,
        statement.moduleSpecifier.text,
        sourceFiles,
      );
      if (!importedSourceFile) continue;

      const importedFacts = facts.get(importedSourceFile);
      if (!importedFacts) continue;

      const defaultBinding = statement.importClause?.name;
      if (
        defaultBinding &&
        (linkHelperBinding(helpers, defaultBinding.text, importedFacts.helpers.get('default')) ||
          linkNamespaceBinding(
            namespaceImports,
            defaultBinding.text,
            importedFacts.defaultObjectHelpers,
          ))
      ) {
        changed = true;
      }

      const bindings = statement.importClause?.namedBindings;
      if (!bindings) continue;

      if (ts.isNamespaceImport(bindings)) {
        const exportedHelpers = exportedHelperBindings(importedFacts.helpers);
        if (!helperBindingMapsEqual(namespaceImports.get(bindings.name.text), exportedHelpers)) {
          namespaceImports.set(bindings.name.text, exportedHelpers);
          changed = true;
        }
        continue;
      }

      if (!ts.isNamedImports(bindings)) continue;

      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;

        const importedName = element.propertyName?.text ?? element.name.text;
        const localName = element.name.text;
        if (linkHelperBinding(helpers, localName, importedFacts.helpers.get(importedName))) {
          changed = true;
        }
      }

      continue;
    }

    if (!ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.isTypeOnly) continue;

    const importedSourceFile = importedLocalSourceFile(
      moduleFacts.sourceFile,
      statement.moduleSpecifier.text,
      sourceFiles,
    );
    if (!importedSourceFile) continue;

    const importedFacts = facts.get(importedSourceFile);
    if (!importedFacts) continue;

    const exportClause = statement.exportClause;
    if (!exportClause) {
      for (const [exportedName, helper] of exportedHelperBindings(importedFacts.helpers, {
        includeExportStar: true,
      })) {
        if (linkExportStarHelperBinding(moduleFacts, exportedName, helper)) {
          changed = true;
        }
      }
      continue;
    }

    if (!ts.isNamedExports(exportClause)) continue;

    for (const element of exportClause.elements) {
      if (element.isTypeOnly) continue;

      const importedName = element.propertyName?.text ?? element.name.text;
      const exportedName = element.name.text;
      if (linkHelperBinding(helpers, exportedName, importedFacts.helpers.get(importedName))) {
        changed = true;
      }
    }
  }

  return changed;
}

function exportedHelperBindings(
  helpers: ReadonlyMap<string, HelperDefinition>,
  options: { includeExportStar: boolean } = { includeExportStar: false },
): ReadonlyMap<string, HelperDefinition> {
  const exportedHelpers = new Map<string, HelperDefinition>();
  for (const [name, helper] of helpers) {
    if (helper.exported && (options.includeExportStar || !helper.reachedThroughExportStar)) {
      exportedHelpers.set(name, helper);
    }
  }

  return exportedHelpers;
}

function linkExportStarHelperBinding(
  moduleFacts: ModuleFacts,
  localName: string,
  helper: HelperDefinition,
): boolean {
  if (!helper.exported) return false;
  if (moduleFacts.ambiguousExportStarHelpers.has(localName)) return false;

  const helpers = moduleFacts.helpers as Map<string, HelperDefinition>;
  const existing = helpers.get(localName);
  if (existing) {
    if (!existing.reachedThroughExportStar) return false;

    if (existing.id !== helper.id) {
      helpers.delete(localName);
      (moduleFacts.ambiguousExportStarHelpers as Set<string>).add(localName);
      return true;
    }

    return false;
  }

  helpers.set(localName, { ...helper, exported: true, reachedThroughExportStar: true });
  return true;
}

function helperBindingMapsEqual(
  left: ReadonlyMap<string, HelperDefinition> | undefined,
  right: ReadonlyMap<string, HelperDefinition>,
): boolean {
  if (!left || left.size !== right.size) return false;

  for (const [name, helper] of right) {
    if (left.get(name)?.id !== helper.id) return false;
  }

  return true;
}

function linkHelperBinding(
  helpers: Map<string, HelperDefinition>,
  localName: string,
  helper: HelperDefinition | undefined,
): boolean {
  if (!helper?.exported) return false;
  if (helpers.has(localName)) return false;

  helpers.set(localName, helper);
  return true;
}

function linkNamespaceBinding(
  namespaceImports: Map<string, ReadonlyMap<string, HelperDefinition>>,
  localName: string,
  helpers: ReadonlyMap<string, HelperDefinition>,
): boolean {
  if (helpers.size === 0) return false;
  if (namespaceImports.has(localName)) return false;

  namespaceImports.set(localName, helpers);
  return true;
}

function collectDefaultObjectHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): void {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return;

  const expression = unwrapParentheses(statement.expression);
  if (!ts.isObjectLiteralExpression(expression)) return;

  const helperBindings = new Map<string, HelperDefinition>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) return;
    if (ts.isShorthandPropertyAssignment(property)) {
      const helper = moduleFacts.helpers.get(property.name.text);
      if (!helper) return;
      helperBindings.set(property.name.text, exportedHelperAlias(helper));
      continue;
    }

    if (!ts.isPropertyAssignment(property)) return;
    if (property.name === undefined || ts.isComputedPropertyName(property.name)) return;

    const propertyName = staticPropertyName(property.name);
    if (propertyName === undefined) return;

    const initializer = unwrapParentheses(property.initializer);
    if (!ts.isIdentifier(initializer)) return;

    const helper = moduleFacts.helpers.get(initializer.text);
    if (!helper) return;

    helperBindings.set(propertyName, exportedHelperAlias(helper));
  }

  const defaultObjectHelpers = moduleFacts.defaultObjectHelpers as Map<string, HelperDefinition>;
  for (const [propertyName, helper] of helperBindings) {
    defaultObjectHelpers.set(propertyName, helper);
  }
}

function collectDefaultHelperAlias(statement: ts.Statement, moduleFacts: ModuleFacts): void {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return;

  const expression = unwrapParentheses(statement.expression);
  if (!ts.isIdentifier(expression)) return;

  const helper = moduleFacts.helpers.get(expression.text);
  if (!helper) return;

  (moduleFacts.helpers as Map<string, HelperDefinition>).set(
    'default',
    exportedHelperAlias(helper),
  );
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function exportedHelperAlias(helper: HelperDefinition): HelperDefinition {
  return helper.exported ? helper : { ...helper, exported: true };
}

function importedLocalSourceFile(
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
): ts.SourceFile | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;

  const fromDirectory = path.posix.dirname(normalizeModuleFileName(sourceFile.fileName));
  const resolved = path.posix.normalize(path.posix.join(fromDirectory, moduleSpecifier));
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    path.posix.join(resolved, 'index.ts'),
    path.posix.join(resolved, 'index.tsx'),
    path.posix.join(resolved, 'index.js'),
    path.posix.join(resolved, 'index.jsx'),
  ];

  for (const candidate of candidates) {
    const sourceFile = sourceFiles.get(candidate);
    if (sourceFile) return sourceFile;
  }

  return undefined;
}

function normalizeModuleFileName(fileName: string): string {
  return path.posix.normalize(fileName.replaceAll('\\', '/'));
}

function helperId(sourceFile: ts.SourceFile, name: string): string {
  return `${normalizeModuleFileName(sourceFile.fileName)}\0${name}`;
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

function defaultExportedFunctionHelper(
  statement: ts.Statement,
): ts.FunctionLikeDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(statement) &&
    hasExportModifier(statement) &&
    hasDefaultModifier(statement)
  ) {
    return statement;
  }

  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return undefined;

  const expression = unwrapParentheses(statement.expression);
  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    return expression;
  }

  return undefined;
}

function collectImportBindingNames(statement: ts.ImportDeclaration, names: Set<string>): void {
  const clause = statement.importClause;
  if (!clause) return;
  if (clause.name) names.add(clause.name.text);

  const bindings = clause.namedBindings;
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    names.add(bindings.name.text);
    return;
  }

  for (const element of bindings.elements) {
    names.add(element.name.text);
  }
}

function frameworkToolImportNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/server') continue;

    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      if ((element.propertyName?.text ?? element.name.text) === 'tool') {
        names.add(element.name.text);
      }
    }
  }

  return names;
}

function handlerSinkFacts(
  tool: string,
  handler: HandlerTarget,
): CoreGraph.AgentToolReachableSinkFact[] {
  if (!handler.node.body) return [];
  return reachableSinkFacts(
    handler.moduleFacts.sourceFile,
    tool,
    handler.node,
    handler.moduleFacts,
    new Set(),
    handler.origin,
  );
}

function reachableSinkFacts(
  sourceFile: ts.SourceFile,
  tool: string,
  fn: ts.FunctionLikeDeclaration,
  moduleFacts: ModuleFacts,
  activeHelpers: ReadonlySet<string>,
  origin: AgentToolSinkOrigin,
): CoreGraph.AgentToolReachableSinkFact[] {
  const body = fn.body;
  if (!body) return [];

  const facts: CoreGraph.AgentToolReachableSinkFact[] = [];
  const blockedNames = namesBlockedInFunctionBody(fn, moduleFacts.topLevelBindings);

  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;

    const egress = egressSinkFact(sourceFile, tool, node, blockedNames, origin);
    if (egress) facts.push(egress);

    const secret = secretReadSinkFact(sourceFile, tool, node, blockedNames, origin);
    if (secret) facts.push(secret);

    const inlineCall = directlyInvokedInlineFunction(node);
    if (inlineCall !== undefined) {
      facts.push(
        ...reachableSinkFacts(sourceFile, tool, inlineCall, moduleFacts, activeHelpers, 'inline'),
      );
    }

    const helper = calledHelper(node, moduleFacts, blockedNames);
    if (helper !== undefined && !activeHelpers.has(helper.id)) {
      const helperOrigin =
        origin === 'imported-helper'
          ? 'imported-helper'
          : helper.moduleFacts.sourceFile === moduleFacts.sourceFile
            ? 'helper'
            : 'imported-helper';
      facts.push(
        ...reachableSinkFacts(
          helper.moduleFacts.sourceFile,
          tool,
          helper.node,
          helper.moduleFacts,
          new Set([...activeHelpers, helper.id]),
          helperOrigin,
        ),
      );

      for (const callback of directlyInvokedCallbackArguments(node, helper)) {
        facts.push(
          ...reachableSinkFacts(
            sourceFile,
            tool,
            callback,
            moduleFacts,
            new Set([...activeHelpers, helper.id]),
            helperOrigin,
          ),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
  return facts;
}

type AgentToolSinkOrigin = 'handler' | 'helper' | 'imported-helper' | 'inline';

function directlyInvokedInlineFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (!ts.isCallExpression(node)) return undefined;

  const expression = unwrapParentheses(node.expression);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }

  return undefined;
}

function directlyInvokedCallbackArguments(
  node: ts.Node,
  helper: HelperDefinition,
): ts.FunctionLikeDeclaration[] {
  if (!ts.isCallExpression(node)) return [];

  const invokedParameters = directlyInvokedCallbackParameters(helper.node);
  if (invokedParameters.size === 0) return [];

  const callbacks: ts.FunctionLikeDeclaration[] = [];
  helper.node.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return;
    if (!invokedParameters.has(parameter.name.text)) return;

    const argument = node.arguments[index];
    if (!argument) return;

    const expression = unwrapParentheses(argument);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      callbacks.push(expression);
    }
  });

  return callbacks;
}

function directlyInvokedCallbackParameters(fn: ts.FunctionLikeDeclaration): ReadonlySet<string> {
  const body = fn.body;
  if (!body) return new Set();

  const candidateNames = new Set<string>();
  for (const parameter of fn.parameters) {
    if (ts.isIdentifier(parameter.name)) candidateNames.add(parameter.name.text);
  }
  if (candidateNames.size === 0) return new Set();

  const invokedNames = new Set<string>();
  const reassignedNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      candidateNames.has(node.expression.text)
    ) {
      invokedNames.add(node.expression.text);
    }

    const assignedName = assignedIdentifierName(node);
    if (assignedName !== undefined && candidateNames.has(assignedName)) {
      reassignedNames.add(assignedName);
    }

    ts.forEachChild(node, visit);
  };

  visit(body);

  for (const reassignedName of reassignedNames) {
    invokedNames.delete(reassignedName);
  }

  return invokedNames;
}

function assignedIdentifierName(node: ts.Node): string | undefined {
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isIdentifier(node.left)
  ) {
    return node.left.text;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isIdentifier(node.operand)
  ) {
    return node.operand.text;
  }

  return undefined;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  switch (kind) {
    case ts.SyntaxKind.FirstAssignment:
    case ts.SyntaxKind.PlusEqualsToken:
    case ts.SyntaxKind.MinusEqualsToken:
    case ts.SyntaxKind.AsteriskEqualsToken:
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
    case ts.SyntaxKind.SlashEqualsToken:
    case ts.SyntaxKind.PercentEqualsToken:
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.AmpersandEqualsToken:
    case ts.SyntaxKind.BarEqualsToken:
    case ts.SyntaxKind.CaretEqualsToken:
    case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
    case ts.SyntaxKind.BarBarEqualsToken:
    case ts.SyntaxKind.QuestionQuestionEqualsToken:
      return true;
    default:
      return false;
  }
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function namesBlockedInFunctionBody(
  fn: ts.FunctionLikeDeclaration,
  topLevelBindings: ReadonlySet<string>,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const parameter of fn.parameters) {
    collectBindingNames(parameter.name, names);
  }

  const body = fn.body;
  if (!body) return names;

  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      collectBindingNames(node.name, names);
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      names.add(node.name.text);
      return;
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(node.variableDeclaration.name, names);
    }

    ts.forEachChild(node, visit);
  };

  visit(body);

  for (const globalName of ['fetch', 'process']) {
    if (topLevelBindings.has(globalName)) names.add(globalName);
  }

  return names;
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingNames(element.name, names);
  }
}

function calledHelper(
  node: ts.Node,
  moduleFacts: ModuleFacts,
  blockedNames: ReadonlySet<string>,
): HelperDefinition | undefined {
  if (!ts.isCallExpression(node)) return undefined;

  if (ts.isPropertyAccessExpression(node.expression)) {
    const namespaceName = node.expression.expression;
    if (!ts.isIdentifier(namespaceName)) return undefined;
    if (blockedNames.has(namespaceName.text)) return undefined;

    const namespaceHelpers = moduleFacts.namespaceImports.get(namespaceName.text);
    return namespaceHelpers?.get(node.expression.name.text);
  }

  if (!ts.isIdentifier(node.expression)) return undefined;

  const name = node.expression.text;
  if (blockedNames.has(name)) return undefined;
  return moduleFacts.helpers.get(name);
}

function egressSinkFact(
  sourceFile: ts.SourceFile,
  tool: string,
  node: ts.Node,
  blockedNames: ReadonlySet<string>,
  origin: AgentToolSinkOrigin,
): CoreGraph.AgentToolReachableSinkFact | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  if (blockedNames.has('fetch')) return undefined;
  if (node.expression.text !== 'fetch') return undefined;

  const [url] = node.arguments;
  if (!url || !ts.isStringLiteralLike(url)) return undefined;

  const target = urlHost(url.text);
  if (target === undefined) return undefined;

  return {
    capability: `egress:${target}`,
    evidence: egressEvidence(origin),
    grade: 'sound',
    kind: 'egress',
    site: siteForNode(sourceFile, node),
    target,
    tool,
  };
}

function secretReadSinkFact(
  sourceFile: ts.SourceFile,
  tool: string,
  node: ts.Node,
  blockedNames: ReadonlySet<string>,
  origin: AgentToolSinkOrigin,
): CoreGraph.AgentToolReachableSinkFact | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (!ts.isIdentifier(node.name)) return undefined;

  const env = node.expression;
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== 'env') return undefined;
  if (!ts.isIdentifier(env.expression) || env.expression.text !== 'process') return undefined;
  if (blockedNames.has('process')) return undefined;

  const target = `env.${node.name.text}`;
  return {
    capability: 'secrets.read',
    evidence: secretReadEvidence(origin),
    grade: 'sound',
    kind: 'secret-read',
    site: siteForNode(sourceFile, node),
    target,
    tool,
  };
}

function egressEvidence(origin: AgentToolSinkOrigin): string {
  switch (origin) {
    case 'handler':
      return 'static-tool-body-fetch';
    case 'helper':
      return 'static-tool-helper-fetch';
    case 'imported-helper':
      return 'static-tool-imported-helper-fetch';
    case 'inline':
      return 'static-tool-inline-fetch';
  }
}

function secretReadEvidence(origin: AgentToolSinkOrigin): string {
  switch (origin) {
    case 'handler':
      return 'static-tool-body-env';
    case 'helper':
      return 'static-tool-helper-env';
    case 'imported-helper':
      return 'static-tool-imported-helper-env';
    case 'inline':
      return 'static-tool-inline-env';
  }
}

function handlerTarget(
  definition: ts.ObjectLiteralExpression,
  moduleFacts: ModuleFacts,
): HandlerTarget | undefined {
  const property = propertyNamed(definition, 'handler');
  if (property === undefined) return undefined;

  if (ts.isMethodDeclaration(property)) {
    return { moduleFacts, node: property, origin: 'handler' };
  }

  if (ts.isShorthandPropertyAssignment(property)) {
    return helperHandlerTarget(property.name.text, moduleFacts);
  }

  if (!ts.isPropertyAssignment(property)) return undefined;

  const initializer = property.initializer;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return { moduleFacts, node: initializer, origin: 'handler' };
  }

  if (ts.isIdentifier(initializer)) return helperHandlerTarget(initializer.text, moduleFacts);

  return undefined;
}

function helperHandlerTarget(name: string, moduleFacts: ModuleFacts): HandlerTarget | undefined {
  const helper = moduleFacts.helpers.get(name);
  if (!helper) return undefined;

  return {
    moduleFacts: helper.moduleFacts,
    node: helper.node,
    origin:
      helper.moduleFacts.sourceFile === moduleFacts.sourceFile ? 'handler' : 'imported-helper',
  };
}

function stringPropertyValue(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = propertyNamed(object, propertyName);
  if (!property || !ts.isPropertyAssignment(property)) return undefined;
  const initializer = property.initializer;
  return ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => {
    const name = property.name;
    return name !== undefined && ts.isIdentifier(name) && name.text === propertyName;
  });
}

function isIdentifierNamed(node: ts.Expression, names: ReadonlySet<string>): boolean {
  return ts.isIdentifier(node) && names.has(node.text);
}

function urlHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return undefined;
  }
}

function siteForNode(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

function compareAgentToolSinkFact(
  left: CoreGraph.AgentToolReachableSinkFact,
  right: CoreGraph.AgentToolReachableSinkFact,
): number {
  return (
    left.tool.localeCompare(right.tool) ||
    left.kind.localeCompare(right.kind) ||
    left.target.localeCompare(right.target) ||
    left.site.localeCompare(right.site)
  );
}

function uniqueAgentToolSinkFacts(
  facts: readonly CoreGraph.AgentToolReachableSinkFact[],
): CoreGraph.AgentToolReachableSinkFact[] {
  const seen = new Set<string>();
  const unique: CoreGraph.AgentToolReachableSinkFact[] = [];

  for (const fact of facts) {
    const key = [
      fact.tool,
      fact.kind,
      fact.target,
      fact.capability,
      fact.site,
      fact.evidence ?? '',
      fact.grade,
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }

  return unique;
}
