import * as ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { deriveMutationKey } from '../mutation-names.js';
import { ensureTypescriptRuntime } from '../ts-api.js';
import type { MutationInputFieldCoercion, MutationInputFieldFact } from '../types.js';
import { propertyNameText } from './ast.js';

ensureTypescriptRuntime(ts);

const MUTATION_FACTORY_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const SCHEMA_IDENTITY = frameworkExport('@kovojs/server', 's');

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
  if (!isKovoMutationCallee(sourceFile, initializer.expression)) return null;

  const [keyArg, optionsArg] = initializer.arguments;
  const key = keyArg && ts.isStringLiteralLike(keyArg) ? keyArg.text : null;
  const definitionArg = key === null ? keyArg : optionsArg;
  if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) return null;

  const input = objectPropertyExpression(definitionArg, 'input');
  const fields = input ? mutationInputFields(sourceFile, input) : [];
  if (fields.length === 0) return null;

  return {
    fields,
    key: key ?? deriveMutationKey(sourceFile.fileName, node.name.text),
    localName: node.name.text,
  };
}

function isKovoMutationCallee(sourceFile: ts.SourceFile, expression: ts.Expression): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    MUTATION_FACTORY_IDENTITY,
    { legacyGlobals: [MUTATION_FACTORY_IDENTITY] },
  );
}

function mutationInputFields(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): MutationInputFieldFact[] {
  const input = unwrapTsExpression(expression);
  if (!input || !ts.isCallExpression(input)) return [];
  if (schemaMethodName(sourceFile, input) !== 'object') return [];

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

function schemaExpressionHasCall(expression: ts.Expression, methodName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && schemaMethodName(node.getSourceFile(), node) === methodName) {
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
    if (ts.isCallExpression(node)) {
      const name = schemaMethodName(node.getSourceFile(), node);
      if (name === 'enum') {
        coercion = 'string';
        return;
      }
      if (name === 'file') {
        coercion = 'file';
        return;
      }
      if (name === 'string' || name === 'number' || name === 'boolean') {
        coercion = name;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return coercion;
}

function schemaMethodName(sourceFile: ts.SourceFile, call: ts.CallExpression): string | null {
  const callee = unwrapTsExpression(call.expression);
  if (!callee || !ts.isPropertyAccessExpression(callee)) return null;
  if (
    isKovoSchemaReceiver(sourceFile, callee.expression) ||
    isKovoSchemaExpression(sourceFile, callee.expression)
  ) {
    return callee.name.text;
  }
  return null;
}

function isKovoSchemaExpression(sourceFile: ts.SourceFile, expression: ts.Expression): boolean {
  const current = unwrapTsExpression(expression);
  if (!current) return false;
  if (ts.isCallExpression(current)) return schemaMethodName(sourceFile, current) !== null;
  if (ts.isPropertyAccessExpression(current)) {
    return (
      isKovoSchemaReceiver(sourceFile, current.expression) ||
      isKovoSchemaExpression(sourceFile, current.expression)
    );
  }
  return isKovoSchemaReceiver(sourceFile, current);
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
