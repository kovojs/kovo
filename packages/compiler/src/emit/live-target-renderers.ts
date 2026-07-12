import * as ts from 'typescript';

import {
  compilerCreateSet,
  compilerJsonStringify,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSlice,
} from '../compiler-security-intrinsics.js';
import type { LiveTargetFact } from '../types.js';
import { ensureTypescriptRuntime } from '../ts-api.js';

ensureTypescriptRuntime(ts);

const compilerTsCreateSourceFile = ts.createSourceFile;
const compilerTsIsCallExpression = ts.isCallExpression;
const compilerTsIsIdentifier = ts.isIdentifier;
const compilerTsIsImportDeclaration = ts.isImportDeclaration;
const compilerTsIsNamedImports = ts.isNamedImports;
const compilerTsIsPropertyAccessExpression = ts.isPropertyAccessExpression;
const compilerTsIsStringLiteral = ts.isStringLiteral;
const compilerTsIsVariableStatement = ts.isVariableStatement;

const liveTargetWireModule = '@kovojs/server/internal/wire';
const liveTargetWireImports = [
  'componentLiveTargetRenderer',
  'registerGeneratedLiveTargetRenderer',
] as const;

export interface EmitLiveTargetRendererExportsOptions {
  componentExpression: string;
  componentExpressionForFact?: (fact: LiveTargetFact) => string;
  liveTargetFacts: readonly LiveTargetFact[];
  source: string;
}

export function appendLiveTargetRendererExports(
  options: EmitLiveTargetRendererExportsOptions,
): string {
  const facts = compilerSnapshotDenseArray(options.liveTargetFacts, 'Live-target renderer facts');
  if (facts.length === 0) return options.source;

  const sourceWithImport = insertLiveTargetRendererImport(options.source);
  const exports: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    exports[exports.length] = liveTargetRendererExport(
      options.componentExpressionForFact?.(fact) ?? options.componentExpression,
      fact,
    );
  }

  return `${compilerRegExpReplace(/\s+$/g, sourceWithImport, '')}\n\n${joinRendererStrings(exports, '\n\n')}\n`;
}

function insertLiveTargetRendererImport(source: string): string {
  const sourceFile = compilerTsCreateSourceFile(
    'lowered.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let wireImport: ts.ImportDeclaration | undefined;
  const statements = compilerSnapshotDenseArray(sourceFile.statements, 'Live-target source statements');
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (
      compilerTsIsImportDeclaration(statement) &&
      compilerTsIsStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === liveTargetWireModule
    ) {
      wireImport = statement;
      break;
    }
  }
  if (wireImport) {
    const augmentedSource = augmentLiveTargetRendererImport(source, wireImport);
    if (augmentedSource) return augmentedSource;
  }

  let importDeclarationEnd = 0;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (compilerTsIsImportDeclaration(statement)) importDeclarationEnd = statement.end;
  }
  const importLine = `import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '${liveTargetWireModule}';\n`;

  if (importDeclarationEnd > 0) {
    const prefix = compilerStringSlice(source, 0, importDeclarationEnd);
    const suffix = compilerStringSlice(source, importDeclarationEnd);
    return `${prefix}\n${importLine}${suffix}`;
  }

  return `${importLine}${source}`;
}

function augmentLiveTargetRendererImport(
  source: string,
  declaration: ts.ImportDeclaration,
): string | null {
  const namedBindings = declaration.importClause?.namedBindings;
  if (!namedBindings || !compilerTsIsNamedImports(namedBindings)) return null;

  const importedNames = compilerCreateSet<string>();
  const elements = compilerSnapshotDenseArray(namedBindings.elements, 'Live-target named imports');
  for (let index = 0; index < elements.length; index += 1) {
    compilerSetAdd(importedNames, elements[index]!.name.text);
  }
  const missing: string[] = [];
  for (let index = 0; index < liveTargetWireImports.length; index += 1) {
    const name = liveTargetWireImports[index]!;
    if (!compilerSetHas(importedNames, name)) missing[missing.length] = name;
  }
  if (missing.length === 0) return source;

  const insertion = `${elements.length > 0 ? ', ' : ''}${joinRendererStrings(missing, ', ')}`;
  const insertionPoint =
    elements.length > 0
      ? elements[elements.length - 1]?.end
      : namedBindings.getStart() + 1;
  if (insertionPoint === undefined) return null;

  return `${compilerStringSlice(source, 0, insertionPoint)}${insertion}${compilerStringSlice(source, insertionPoint)}`;
}

function liveTargetRendererExport(componentExpression: string, fact: LiveTargetFact): string {
  const exportName = liveTargetRendererExportName(componentExpression);
  const queries = liveTargetRendererQueries(fact);
  const optionLines = [
    `  component: ${componentExpression},`,
    `  componentId: ${rendererJsonSource(fact.component, 'Live-target component id')},`,
  ];
  if (queries) optionLines[optionLines.length] = queries;

  return `export const ${exportName} = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
${joinRendererStrings(optionLines, '\n')}
}));`;
}

function liveTargetRendererExportName(componentExpression: string): string {
  return `${compilerRegExpReplace(/[^A-Za-z0-9_$]/g, componentExpression, '_')}$liveTargetRenderer`;
}

function liveTargetRendererQueries(fact: LiveTargetFact): string {
  const facts = compilerSnapshotDenseArray(fact.queryBindings, 'Live-target query bindings');
  const bindings: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const binding = liveTargetRendererQueryBinding(facts[index]!);
    if (binding !== null) bindings[bindings.length] = binding;
  }
  if (bindings.length === 0) return '';

  return `  queries: [
${joinRendererStrings(bindings, ',\n')}
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
  return `    { name: ${rendererJsonSource(binding.name, 'Live-target query name')}, query: ${binding.queryExpression}${args} }`;
}

function isExecutableQueryExpression(expressionSource: string): boolean {
  const sourceFile = compilerTsCreateSourceFile(
    'query-binding-expression.ts',
    `const __query = ${expressionSource};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !compilerTsIsVariableStatement(statement)) return false;
  const initializer = statement.declarationList.declarations[0]?.initializer;
  if (!initializer) return false;

  return isRuntimeQueryReference(initializer);
}

function isRuntimeQueryReference(expression: ts.Expression): boolean {
  if (compilerTsIsIdentifier(expression) || compilerTsIsPropertyAccessExpression(expression)) {
    return true;
  }
  if (compilerTsIsCallExpression(expression)) return isRuntimeQueryReference(expression.expression);
  return false;
}

function joinRendererStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function rendererJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}
