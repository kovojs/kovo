import { createRequire } from 'node:module';
import * as ts from 'typescript';

import type { MutationInputFieldCoercion, MutationInputFieldFact } from '../types.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

/** @internal Local mutation input facts extracted at the scanner/fact boundary. */
export interface LocalMutationInputFact {
  fields: readonly MutationInputFieldFact[];
  key: string;
  localName: string;
}

/**
 * @internal Extract mutation input schema facts from authored TypeScript/TSX.
 *
 * SPEC.md §5.2 keeps post-parse decisions on typed facts; this is the boundary
 * that turns source into mutation field facts for compiler diagnostics and
 * registry-backed example generators.
 */
export function mutationInputFactsFromSource(
  fileName: string,
  source: string,
): ReadonlyMap<string, LocalMutationInputFact> {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts = new Map<string, LocalMutationInputFact>();

  const visit = (node: ts.Node): void => {
    const fact = mutationInputFactFromVariable(sourceFile, node);
    if (fact) facts.set(fact.localName, fact);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

function mutationInputFactFromVariable(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): LocalMutationInputFact | null {
  if (!ts.isVariableDeclaration(node)) return null;
  if (!ts.isIdentifier(node.name)) return null;
  const initializer = unwrapTsExpression(node.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'mutation') {
    return null;
  }

  const [keyArg, optionsArg] = initializer.arguments;
  if (!keyArg || !ts.isStringLiteralLike(keyArg)) return null;
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return null;

  const input = objectPropertyExpression(optionsArg, 'input');
  const fields = input ? mutationInputFields(sourceFile, input) : [];
  if (fields.length === 0) return null;

  return {
    fields,
    key: keyArg.text,
    localName: node.name.text,
  };
}

function mutationInputFields(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): MutationInputFieldFact[] {
  const input = unwrapTsExpression(expression);
  if (!input || !ts.isCallExpression(input)) return [];
  if (!isPropertyCall(input.expression, 'object')) return [];

  const [shapeArg] = input.arguments;
  if (!shapeArg || !ts.isObjectLiteralExpression(shapeArg)) return [];

  return shapeArg.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];
    const name = propertyNameText(property.name);
    if (!name) return [];
    const defaulted = schemaExpressionHasCall(property.initializer, 'default');
    const optional = schemaExpressionHasCall(property.initializer, 'optional');
    return [
      {
        coercion: schemaExpressionCoercion(property.initializer),
        defaulted,
        name,
        optional,
        provenance: 'local-mutation',
        required: !defaulted && !optional,
        source: {
          fileName: sourceFile.fileName,
          length: property.end - property.getStart(sourceFile),
          start: property.getStart(sourceFile),
        },
      },
    ];
  });
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

function schemaExpressionHasCall(expression: ts.Expression, methodName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === methodName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function schemaExpressionCoercion(expression: ts.Expression): MutationInputFieldCoercion {
  let coercion: MutationInputFieldCoercion = 'unknown';

  const visit = (node: ts.Node): void => {
    if (coercion !== 'unknown') return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      if (ts.isIdentifier(receiver) && receiver.text === 's') {
        const name = node.expression.name.text;
        if (name === 'enum') {
          coercion = 'string';
          return;
        }
        if (name === 'string' || name === 'number' || name === 'boolean') {
          coercion = name;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return coercion;
}

function isPropertyCall(expression: ts.Expression, propertyName: string): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === propertyName;
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
