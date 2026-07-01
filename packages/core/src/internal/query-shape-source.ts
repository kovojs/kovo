import type * as TypeScript from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  registerFrameworkIdentityProject,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

type TypeScriptModule = typeof import('typescript');

/** @internal Compiler-compatible query shape used for KV302/KV435 validation. */
export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    }
  | {
      kind: 'nullable' | 'optional' | 'secret' | 'volatile-time';
      shape: QueryShape;
    }
  | {
      kind: 'table-row';
      shape: QueryShape;
      table: string;
    }
  | {
      kind: 'revealed';
      reveal: unknown;
      shape: QueryShape;
    };

/** @internal Compiler-compatible query-shape fact. */
export interface QueryShapeFact {
  query: string;
  shape: QueryShape;
  source: string;
}

/** @internal Shared source input for identity-aware query-shape extraction. */
export interface QueryShapeSourceFile {
  fileName: string;
  source: string;
}

const QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
const SCHEMA_IDENTITY = frameworkExport('@kovojs/server', 's');

/** @internal Extract declared non-Drizzle query output schemas from one source file. */
export function outputSchemaQueryShapeFactsFromSource(
  ts: TypeScriptModule,
  fileName: string,
  source: string,
): readonly QueryShapeFact[] {
  return outputSchemaQueryShapeFactsFromProject(ts, [{ fileName, source }]);
}

/** @internal Extract declared non-Drizzle query output schemas with project identity resolution. */
export function outputSchemaQueryShapeFactsFromProject(
  ts: TypeScriptModule,
  files: readonly QueryShapeSourceFile[],
  scanFiles: readonly QueryShapeSourceFile[] = files,
): readonly QueryShapeFact[] {
  const sourceFiles = files.map((file) =>
    ts.createSourceFile(
      file.fileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  );
  for (const sourceFile of sourceFiles) registerFrameworkIdentityProject(sourceFile, sourceFiles);

  const scanFileNames = new Set(scanFiles.map((file) => file.fileName));
  return sourceFiles
    .filter((sourceFile) => scanFileNames.has(sourceFile.fileName))
    .flatMap((sourceFile) => outputSchemaQueryShapeFactsFromSourceFile(ts, sourceFile));
}

/** @internal Merge projected query-shape facts from multiple analyzers. */
export function mergeQueryShapeFactSets(
  primary: readonly QueryShapeFact[],
  secondary: readonly QueryShapeFact[],
): QueryShapeFact[] {
  const secondaryByQuery = new Map(secondary.map((fact) => [fact.query, fact]));
  const primaryQueries = new Set(primary.map((fact) => fact.query));
  return [
    ...primary.map((fact) => mergeQueryShapeFact(fact, secondaryByQuery.get(fact.query))),
    ...secondary.filter((fact) => !primaryQueries.has(fact.query)),
  ].sort(
    (left, right) =>
      left.query.localeCompare(right.query) || left.source.localeCompare(right.source),
  );
}

function outputSchemaQueryShapeFactsFromSourceFile(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
): readonly QueryShapeFact[] {
  const facts: QueryShapeFact[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fact = outputSchemaQueryShapeFactFromVariable(ts, sourceFile, node);
      if (fact) facts.push(fact);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return facts;
}

function outputSchemaQueryShapeFactFromVariable(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.VariableDeclaration,
): QueryShapeFact | null {
  const initializer = unwrapTsExpression(ts, node.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!isQueryCallee(ts, sourceFile, initializer.expression)) return null;

  const declaration = staticQueryDeclaration(ts, node, initializer);
  if (!declaration) return null;
  const output = objectPropertyExpression(ts, declaration.definition, 'output');
  if (!output) return null;
  const shape = compilerQueryShapeFromSchemaExpression(ts, sourceFile, output);
  if (!shape || !isSubstantiveQueryShape(shape)) return null;

  const line = sourceFile.getLineAndCharacterOfPosition(output.getStart(sourceFile)).line + 1;
  return { query: declaration.query, shape, source: `${sourceFile.fileName}:${line}` };
}

function staticQueryDeclaration(
  ts: TypeScriptModule,
  node: TypeScript.VariableDeclaration,
  call: TypeScript.CallExpression,
): { definition: TypeScript.ObjectLiteralExpression; query: string } | null {
  const [firstArgument, secondArgument] = call.arguments;
  if (
    firstArgument &&
    (ts.isStringLiteralLike(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    const definition = unwrapTsExpression(ts, secondArgument);
    return definition && ts.isObjectLiteralExpression(definition)
      ? { definition, query: firstArgument.text }
      : null;
  }

  const definition = unwrapTsExpression(ts, firstArgument);
  if (!definition || !ts.isObjectLiteralExpression(definition)) return null;
  if (!ts.isIdentifier(node.name) || !isExportedVariableDeclaration(ts, node)) return null;
  return { definition, query: node.name.text };
}

function compilerQueryShapeFromSchemaExpression(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
): QueryShape | null {
  const current = unwrapTsExpression(ts, expression);
  if (!current) return null;
  if (ts.isCallExpression(current))
    return compilerQueryShapeFromSchemaCall(ts, sourceFile, current);
  if (ts.isPropertyAccessExpression(current)) {
    const receiverShape = compilerQueryShapeFromSchemaExpression(
      ts,
      sourceFile,
      current.expression,
    );
    if (!receiverShape) return null;
    if (current.name.text === 'optional') return { kind: 'optional', shape: receiverShape };
    if (current.name.text === 'nullable' || current.name.text === 'nullish') {
      return { kind: 'nullable', shape: receiverShape };
    }
    return receiverShape;
  }
  return null;
}

function compilerQueryShapeFromSchemaCall(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  call: TypeScript.CallExpression,
): QueryShape | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;

  const receiver = callee.expression;
  const method = callee.name.text;
  const receiverShape = compilerQueryShapeFromSchemaExpression(ts, sourceFile, receiver);
  if (receiverShape) {
    if (method === 'optional') return { kind: 'optional', shape: receiverShape };
    if (method === 'nullable' || method === 'nullish')
      return { kind: 'nullable', shape: receiverShape };
    return receiverShape;
  }

  if (!isKovoSchemaReceiver(ts, sourceFile, receiver)) return null;
  switch (method) {
    case 'array': {
      const item = call.arguments[0];
      const itemShape = item ? compilerQueryShapeFromSchemaExpression(ts, sourceFile, item) : null;
      return [itemShape ?? 'object'];
    }
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'object': {
      const shapeArg = call.arguments[0];
      if (!shapeArg) return {};
      const object = unwrapTsExpression(ts, shapeArg);
      if (!object || !ts.isObjectLiteralExpression(object)) return 'object';
      return compilerQueryShapeFromSchemaObject(ts, sourceFile, object);
    }
    case 'string':
    case 'enum':
      return 'string';
    default:
      return null;
  }
}

function isKovoSchemaReceiver(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    SCHEMA_IDENTITY,
    { legacyGlobals: [SCHEMA_IDENTITY] },
  );
}

function compilerQueryShapeFromSchemaObject(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  object: TypeScript.ObjectLiteralExpression,
): QueryShape {
  const shape: Record<string, QueryShape> = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(ts, property.name);
    if (!name) continue;
    const child = compilerQueryShapeFromSchemaExpression(ts, sourceFile, property.initializer);
    if (child) shape[name] = child;
  }
  return shape;
}

function objectPropertyExpression(
  ts: TypeScriptModule,
  object: TypeScript.ObjectLiteralExpression,
  propertyName: string,
): TypeScript.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(ts, property.name) === propertyName) return property.initializer;
  }
  return null;
}

function propertyNameText(ts: TypeScriptModule, name: TypeScript.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isQueryCallee(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    QUERY_IDENTITY,
    { legacyGlobals: [QUERY_IDENTITY] },
  );
}

function isExportedVariableDeclaration(
  ts: TypeScriptModule,
  declaration: TypeScript.VariableDeclaration,
): boolean {
  let current: TypeScript.Node = declaration;
  while (current.parent) {
    current = current.parent;
    if (ts.isVariableStatement(current)) {
      return (
        current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false
      );
    }
  }
  return false;
}

function unwrapTsExpression(
  ts: TypeScriptModule,
  expression: TypeScript.Expression | undefined,
): TypeScript.Expression | null {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}

function isSubstantiveQueryShape(shape: QueryShape): boolean {
  if (typeof shape === 'string') return shape !== 'object';
  if (Array.isArray(shape)) return shape.some(isSubstantiveQueryShape);
  if ('kind' in shape) return isSubstantiveQueryShape(shape.shape);
  return Object.keys(shape).length > 0;
}

function mergeQueryShapeFact(
  primary: QueryShapeFact,
  secondary: QueryShapeFact | undefined,
): QueryShapeFact {
  if (!secondary) return primary;
  return {
    ...primary,
    shape: mergeQueryShapes(primary.shape, secondary.shape),
    source: `${primary.source}; output ${secondary.source}`,
  };
}

function mergeQueryShapes(primary: QueryShape, secondary: QueryShape): QueryShape {
  if (Array.isArray(primary) && Array.isArray(secondary)) {
    const primaryItem = primary[0];
    const secondaryItem = secondary[0];
    return primaryItem && secondaryItem ? [mergeQueryShapes(primaryItem, secondaryItem)] : primary;
  }

  if (isPlainQueryShapeObject(primary) && isPlainQueryShapeObject(secondary)) {
    const merged: Record<string, QueryShape> = { ...secondary };
    for (const [key, value] of Object.entries(primary)) {
      const secondaryValue = secondary[key];
      merged[key] = secondaryValue ? mergeQueryShapes(value, secondaryValue) : value;
    }
    return merged;
  }

  return primary;
}

function isPlainQueryShapeObject(shape: QueryShape): shape is Record<string, QueryShape> {
  return typeof shape === 'object' && shape !== null && !Array.isArray(shape) && !('kind' in shape);
}
