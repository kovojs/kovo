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
 * a literal `name`, direct handler-body reads/calls, and direct calls to top-level same-module helper
 * functions that are visible in the parsed AST. It does not inspect raw source text after parse and
 * it skips nested function bodies, so callbacks and dynamic paths remain outside the enforced subset
 * until a dedicated analyzer proves them.
 */
export function agentToolSinksFromSource(
  moduleSource: AgentToolModuleSource,
): CoreGraph.AgentToolReachableSinkFact[] {
  const sourceFile = parseSourceFile(moduleSource.fileName, moduleSource.source);
  const toolLocalNames = frameworkToolImportNames(sourceFile);
  if (toolLocalNames.size === 0) return [];

  const moduleFacts = summarizeModule(sourceFile);
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

    const handler = handlerBody(definition);
    if (handler === undefined) return;

    facts.push(...handlerSinkFacts(sourceFile, name, handler, moduleFacts));
  };

  visit(sourceFile);
  return uniqueAgentToolSinkFacts(facts).sort(compareAgentToolSinkFact);
}

interface ModuleFacts {
  helpers: ReadonlyMap<string, ts.FunctionLikeDeclaration>;
  topLevelBindings: ReadonlySet<string>;
}

function summarizeModule(sourceFile: ts.SourceFile): ModuleFacts {
  const helpers = new Map<string, ts.FunctionLikeDeclaration>();
  const topLevelBindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportBindingNames(statement, topLevelBindings);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelBindings.add(statement.name.text);
      helpers.set(statement.name.text, statement);
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
        helpers.set(declaration.name.text, declaration.initializer);
      }
    }
  }

  return { helpers, topLevelBindings };
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
  sourceFile: ts.SourceFile,
  tool: string,
  handler: ts.FunctionLikeDeclaration,
  moduleFacts: ModuleFacts,
): CoreGraph.AgentToolReachableSinkFact[] {
  if (!handler.body) return [];
  return reachableSinkFacts(sourceFile, tool, handler, moduleFacts, new Set(), 'handler');
}

function reachableSinkFacts(
  sourceFile: ts.SourceFile,
  tool: string,
  fn: ts.FunctionLikeDeclaration,
  moduleFacts: ModuleFacts,
  activeHelpers: ReadonlySet<string>,
  origin: 'handler' | 'helper',
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

    const helperName = calledHelperName(node, moduleFacts.helpers, blockedNames);
    if (helperName !== undefined && !activeHelpers.has(helperName)) {
      facts.push(
        ...reachableSinkFacts(
          sourceFile,
          tool,
          moduleFacts.helpers.get(helperName)!,
          moduleFacts,
          new Set([...activeHelpers, helperName]),
          'helper',
        ),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
  return facts;
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

function calledHelperName(
  node: ts.Node,
  helpers: ReadonlyMap<string, ts.FunctionLikeDeclaration>,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;

  const name = node.expression.text;
  if (blockedNames.has(name)) return undefined;
  return helpers.has(name) ? name : undefined;
}

function egressSinkFact(
  sourceFile: ts.SourceFile,
  tool: string,
  node: ts.Node,
  blockedNames: ReadonlySet<string>,
  origin: 'handler' | 'helper',
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
    evidence: origin === 'handler' ? 'static-tool-body-fetch' : 'static-tool-helper-fetch',
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
  origin: 'handler' | 'helper',
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
    evidence: origin === 'handler' ? 'static-tool-body-env' : 'static-tool-helper-env',
    grade: 'sound',
    kind: 'secret-read',
    site: siteForNode(sourceFile, node),
    target,
    tool,
  };
}

function handlerBody(
  definition: ts.ObjectLiteralExpression,
): ts.FunctionLikeDeclaration | undefined {
  const property = propertyNamed(definition, 'handler');
  if (property === undefined) return undefined;

  if (ts.isMethodDeclaration(property)) return property;
  if (!ts.isPropertyAssignment(property)) return undefined;

  const initializer = property.initializer;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer;
  }

  return undefined;
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
