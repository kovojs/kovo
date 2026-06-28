import { createRequire } from 'node:module';
import * as ts from 'typescript';

import type { LiveTargetFact } from '../types.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

const liveTargetWireModule = '@kovojs/server/internal/wire';
const liveTargetWireImports = [
  'componentLiveTargetRenderer',
  'registerGeneratedLiveTargetRenderer',
] as const;

export interface EmitLiveTargetRendererExportsOptions {
  componentExpression: string;
  liveTargetFacts: readonly LiveTargetFact[];
  source: string;
}

export function appendLiveTargetRendererExports(
  options: EmitLiveTargetRendererExportsOptions,
): string {
  if (options.liveTargetFacts.length === 0) return options.source;

  const sourceWithImport = insertLiveTargetRendererImport(options.source);
  const exports = options.liveTargetFacts
    .map((fact) => liveTargetRendererExport(options.componentExpression, fact))
    .join('\n\n');

  return `${sourceWithImport.trimEnd()}\n\n${exports}\n`;
}

function insertLiveTargetRendererImport(source: string): string {
  const sourceFile = ts.createSourceFile(
    'lowered.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const wireImport = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === liveTargetWireModule,
  );
  if (wireImport && ts.isImportDeclaration(wireImport)) {
    const augmentedSource = augmentLiveTargetRendererImport(source, wireImport);
    if (augmentedSource) return augmentedSource;
  }

  const importDeclarationEnd =
    sourceFile.statements.findLast((statement) => ts.isImportDeclaration(statement))?.end ?? 0;
  const importLine = `import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '${liveTargetWireModule}';\n`;

  if (importDeclarationEnd > 0) {
    const prefix = source.slice(0, importDeclarationEnd);
    const suffix = source.slice(importDeclarationEnd);
    return `${prefix}\n${importLine}${suffix}`;
  }

  return `${importLine}${source}`;
}

function augmentLiveTargetRendererImport(
  source: string,
  declaration: ts.ImportDeclaration,
): string | null {
  const namedBindings = declaration.importClause?.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return null;

  const importedNames = new Set(namedBindings.elements.map((element) => element.name.text));
  const missing = liveTargetWireImports.filter((name) => !importedNames.has(name));
  if (missing.length === 0) return source;

  const insertion = `${namedBindings.elements.length > 0 ? ', ' : ''}${missing.join(', ')}`;
  const insertionPoint =
    namedBindings.elements.length > 0
      ? namedBindings.elements[namedBindings.elements.length - 1]?.end
      : namedBindings.getStart() + 1;
  if (insertionPoint === undefined) return null;

  return `${source.slice(0, insertionPoint)}${insertion}${source.slice(insertionPoint)}`;
}

function liveTargetRendererExport(componentExpression: string, fact: LiveTargetFact): string {
  const exportName = liveTargetRendererExportName(componentExpression);
  const queries = liveTargetRendererQueries(fact);
  const optionLines = [
    `  component: ${componentExpression},`,
    `  componentId: ${JSON.stringify(fact.component)},`,
    ...(queries ? [queries] : []),
  ];

  return `export const ${exportName} = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
${optionLines.join('\n')}
}));`;
}

function liveTargetRendererExportName(componentExpression: string): string {
  return `${componentExpression.replaceAll(/[^A-Za-z0-9_$]/g, '_')}$liveTargetRenderer`;
}

function liveTargetRendererQueries(fact: LiveTargetFact): string {
  const bindings = fact.queryBindings
    .map(liveTargetRendererQueryBinding)
    .filter((binding): binding is string => binding !== null);
  if (bindings.length === 0) return '';

  return `  queries: [
${bindings.join(',\n')}
  ],`;
}

function liveTargetRendererQueryBinding(
  binding: LiveTargetFact['queryBindings'][number],
): string | null {
  if (!isExecutableQueryExpression(binding.queryExpression)) return null;

  const args =
    binding.argsExpression && binding.argsParam
      ? `, args: (${binding.argsParam}) => ${binding.argsExpression}`
      : '';
  return `    { name: ${JSON.stringify(binding.name)}, query: ${binding.queryExpression}${args} }`;
}

function isExecutableQueryExpression(expressionSource: string): boolean {
  const sourceFile = ts.createSourceFile(
    'query-binding-expression.ts',
    `const __query = ${expressionSource};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return false;
  const initializer = statement.declarationList.declarations[0]?.initializer;
  if (!initializer) return false;

  return isRuntimeQueryReference(initializer);
}

function isRuntimeQueryReference(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) return true;
  if (ts.isCallExpression(expression)) return isRuntimeQueryReference(expression.expression);
  return false;
}
