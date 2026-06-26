import * as ts from 'typescript';

import type * as CoreGraph from '@kovojs/core/internal/graph';

import { parseSourceFile } from './parse.js';

/** @internal One authored module that may contain framework-owned `tool()` declarations. */
export interface AgentToolModuleSource {
  fileName: string;
  source: string;
}

/**
 * @internal Produce sound, directly reachable sink rows from framework-owned `tool()` handlers.
 *
 * This scanner intentionally accepts a narrow subset: a named `tool` import from `@kovojs/server`,
 * a literal `name`, and direct handler-body reads/calls that are visible in the parsed AST. It does
 * not inspect raw source text after parse and it skips nested function bodies, so callbacks and
 * interprocedural paths remain outside the enforced subset until a dedicated analyzer proves them.
 */
export function agentToolSinksFromSource(
  moduleSource: AgentToolModuleSource,
): CoreGraph.AgentToolReachableSinkFact[] {
  const sourceFile = parseSourceFile(moduleSource.fileName, moduleSource.source);
  const toolLocalNames = frameworkToolImportNames(sourceFile);
  if (toolLocalNames.size === 0) return [];

  const facts: CoreGraph.AgentToolReachableSinkFact[] = [];
  const visit = (node: ts.Node): void => {
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

    facts.push(...handlerSinkFacts(sourceFile, name, handler));
  };

  visit(sourceFile);
  return facts.sort(compareAgentToolSinkFact);
}

function frameworkToolImportNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/server') continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
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
  body: ts.ConciseBody,
): CoreGraph.AgentToolReachableSinkFact[] {
  const facts: CoreGraph.AgentToolReachableSinkFact[] = [];

  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;

    const egress = egressSinkFact(sourceFile, tool, node);
    if (egress) facts.push(egress);

    const secret = secretReadSinkFact(sourceFile, tool, node);
    if (secret) facts.push(secret);

    ts.forEachChild(node, visit);
  };

  visit(body);
  return facts;
}

function egressSinkFact(
  sourceFile: ts.SourceFile,
  tool: string,
  node: ts.Node,
): CoreGraph.AgentToolReachableSinkFact | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  if (node.expression.text !== 'fetch') return undefined;

  const [url] = node.arguments;
  if (!url || !ts.isStringLiteralLike(url)) return undefined;

  const target = urlHost(url.text);
  if (target === undefined) return undefined;

  return {
    capability: `egress:${target}`,
    evidence: 'static-tool-body-fetch',
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
): CoreGraph.AgentToolReachableSinkFact | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  if (!ts.isIdentifier(node.name)) return undefined;

  const env = node.expression;
  if (!ts.isPropertyAccessExpression(env) || env.name.text !== 'env') return undefined;
  if (!ts.isIdentifier(env.expression) || env.expression.text !== 'process') return undefined;

  const target = `env.${node.name.text}`;
  return {
    capability: 'secrets.read',
    evidence: 'static-tool-body-env',
    grade: 'sound',
    kind: 'secret-read',
    site: siteForNode(sourceFile, node),
    target,
    tool,
  };
}

function handlerBody(definition: ts.ObjectLiteralExpression): ts.ConciseBody | undefined {
  const property = propertyNamed(definition, 'handler');
  if (property === undefined) return undefined;

  if (ts.isMethodDeclaration(property)) return property.body;
  if (!ts.isPropertyAssignment(property)) return undefined;

  const initializer = property.initializer;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer.body;
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
