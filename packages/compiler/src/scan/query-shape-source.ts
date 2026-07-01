import * as ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import type { QueryShape, QueryShapeFact } from '../types.js';

const QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
const SCHEMA_IDENTITY = frameworkExport('@kovojs/server', 's');

/**
 * @internal Merge projected query-shape facts from multiple analyzers. Primary facts win for
 * fields they prove; secondary facts fill in fields that only a declared output schema exposes.
 */
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

/**
 * @internal Extract declared non-Drizzle query output schemas into compiler query-shape facts.
 */
export function outputSchemaQueryShapeFactsFromSource(
  fileName: string,
  source: string,
): readonly QueryShapeFact[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts: QueryShapeFact[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fact = outputSchemaQueryShapeFactFromVariable(sourceFile, node);
      if (fact) facts.push(fact);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return facts;
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

function outputSchemaQueryShapeFactFromVariable(
  sourceFile: ts.SourceFile,
  node: ts.VariableDeclaration,
): QueryShapeFact | null {
  const initializer = unwrapTsExpression(node.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!isQueryCallee(sourceFile, initializer.expression)) return null;

  const declaration = staticQueryDeclaration(node, initializer);
  if (!declaration) return null;
  const output = objectPropertyExpression(declaration.definition, 'output');
  if (!output) return null;
  const shape = compilerQueryShapeFromSchemaExpression(sourceFile, output);
  if (!shape || !isSubstantiveQueryShape(shape)) return null;

  const line = sourceFile.getLineAndCharacterOfPosition(output.getStart(sourceFile)).line + 1;
  return {
    query: declaration.query,
    shape,
    source: `${sourceFile.fileName}:${line}`,
  };
}

function staticQueryDeclaration(
  node: ts.VariableDeclaration,
  call: ts.CallExpression,
): { definition: ts.ObjectLiteralExpression; query: string } | null {
  const [firstArgument, secondArgument] = call.arguments;
  if (
    firstArgument &&
    (ts.isStringLiteralLike(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    const definition = unwrapTsExpression(secondArgument);
    return definition && ts.isObjectLiteralExpression(definition)
      ? { definition, query: firstArgument.text }
      : null;
  }

  const definition = unwrapTsExpression(firstArgument);
  if (!definition || !ts.isObjectLiteralExpression(definition)) return null;
  if (!ts.isIdentifier(node.name) || !isExportedVariableDeclaration(node)) return null;
  return { definition, query: node.name.text };
}

function compilerQueryShapeFromSchemaExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): QueryShape | null {
  const current = unwrapTsExpression(expression);
  if (!current) return null;
  if (ts.isCallExpression(current)) return compilerQueryShapeFromSchemaCall(sourceFile, current);
  if (ts.isPropertyAccessExpression(current)) {
    const receiverShape = compilerQueryShapeFromSchemaExpression(sourceFile, current.expression);
    if (!receiverShape) return null;
    // Schema modifiers are structural methods after the receiver has resolved to a Kovo schema.
    if (current.name.text === 'optional') return { kind: 'optional', shape: receiverShape };
    if (current.name.text === 'nullable' || current.name.text === 'nullish') {
      return { kind: 'nullable', shape: receiverShape };
    }
    return receiverShape;
  }
  return null;
}

function compilerQueryShapeFromSchemaCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): QueryShape | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;

  const receiver = callee.expression;
  const method = callee.name.text;
  const receiverShape = compilerQueryShapeFromSchemaExpression(sourceFile, receiver);

  if (receiverShape) {
    // Chained schema modifiers remain structural once the receiver's schema shape is proven.
    if (method === 'optional') return { kind: 'optional', shape: receiverShape };
    if (method === 'nullable' || method === 'nullish') {
      return { kind: 'nullable', shape: receiverShape };
    }
    return receiverShape;
  }

  if (!isKovoSchemaReceiver(sourceFile, receiver)) return null;
  switch (method) {
    case 'array': {
      const item = call.arguments[0];
      const itemShape = item ? compilerQueryShapeFromSchemaExpression(sourceFile, item) : null;
      return [itemShape ?? 'object'];
    }
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'object': {
      const shapeArg = call.arguments[0];
      if (!shapeArg) return {};
      const object = unwrapTsExpression(shapeArg);
      if (!object || !ts.isObjectLiteralExpression(object)) return 'object';
      return compilerQueryShapeFromSchemaObject(sourceFile, object);
    }
    case 'string':
    case 'enum':
      return 'string';
    default:
      return null;
  }
}

function isKovoSchemaReceiver(sourceFile: ts.SourceFile, expression: ts.Expression): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    SCHEMA_IDENTITY,
    { legacyGlobals: [SCHEMA_IDENTITY] },
  );
}

function compilerQueryShapeFromSchemaObject(
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
): QueryShape {
  const shape: Record<string, QueryShape> = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (!name) continue;
    const child = compilerQueryShapeFromSchemaExpression(sourceFile, property.initializer);
    if (child) shape[name] = child;
  }
  return shape;
}

function objectPropertyExpression(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isQueryCallee(sourceFile: ts.SourceFile, expression: ts.Expression): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    QUERY_IDENTITY,
  );
}

function isExportedVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
  let current: ts.Node = declaration;
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

function unwrapTsExpression(expression: ts.Expression | undefined): ts.Expression | null {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
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
