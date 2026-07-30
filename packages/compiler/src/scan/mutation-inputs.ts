import type * as TS from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { compilerOwnedAppContractFactoryEquals } from '../app-contract-resolver.js';
import { deriveMutationKey } from '../mutation-names.js';
import { typescriptRuntime as ts } from '../ts-api.js';
import type { MutationInputFieldCoercion, MutationInputFieldFact } from '../types.js';
import { propertyNameText } from './ast.js';

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

  const visit = (node: TS.Node): void => {
    const fact = mutationInputFactFromVariable(sourceFile, node);
    if (fact) facts.set(fact.localName, fact);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

function mutationInputFactFromVariable(
  sourceFile: TS.SourceFile,
  node: TS.Node,
): LocalMutationInputFact | null {
  if (!ts.isVariableDeclaration(node)) return null;
  if (!ts.isIdentifier(node.name)) return null;
  const initializer = unwrapTsExpression(node.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!isKovoMutationCallee(sourceFile, initializer.expression)) return null;

  const [keyArg, optionsArg] = initializer.arguments;
  const key = keyArg && ts.isStringLiteralLike(keyArg) ? keyArg.text : null;
  const rawDefinitionArg = key === null ? keyArg : optionsArg;
  const definitionArg = unwrapTsExpression(rawDefinitionArg);
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

function isKovoMutationCallee(sourceFile: TS.SourceFile, expression: TS.Expression): boolean {
  return (
    compilerOwnedAppContractFactoryEquals(
      ts as FrameworkIdentityTypeScript,
      sourceFile,
      expression,
      MUTATION_FACTORY_IDENTITY,
    ) ||
    expressionResolvesToFrameworkExport(
      ts as FrameworkIdentityTypeScript,
      sourceFile,
      expression,
      MUTATION_FACTORY_IDENTITY,
      { legacyGlobals: [MUTATION_FACTORY_IDENTITY] },
    )
  );
}

function mutationInputFields(
  sourceFile: TS.SourceFile,
  expression: TS.Expression,
): MutationInputFieldFact[] {
  const input = resolveMutationInputSchema(sourceFile, expression);
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

function resolveMutationInputSchema(
  sourceFile: TS.SourceFile,
  expression: TS.Expression,
): TS.Expression | null {
  const input = unwrapTsExpression(expression);
  if (!input || !ts.isIdentifier(input)) return input;

  let declaration: TS.VariableDeclaration | undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const candidate of statement.declarationList.declarations) {
      if (!ts.isIdentifier(candidate.name) || candidate.name.text !== input.text) continue;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      declaration = candidate;
    }
  }
  if (
    mutationInputTopLevelValueBindingCount(sourceFile, input.text) !== 1 ||
    !declaration?.initializer
  ) {
    return null;
  }
  if (mutationInputSchemaBindingIsMutated(sourceFile, input.text)) return null;
  const initializer = unwrapTsExpression(declaration.initializer);
  return initializer && ts.isCallExpression(initializer) ? initializer : null;
}

function mutationInputTopLevelValueBindingCount(
  sourceFile: TS.SourceFile,
  bindingName: string,
): number {
  let count = 0;
  const countBindingName = (name: TS.BindingName): void => {
    if (ts.isIdentifier(name)) {
      if (name.text === bindingName) count += 1;
      return;
    }
    for (const element of name.elements) {
      if (element && ts.isBindingElement(element)) countBindingName(element.name);
    }
  };
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        countBindingName(declaration.name);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === bindingName
    ) {
      count += 1;
      continue;
    }
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name?.text === bindingName) count += 1;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === bindingName) {
      count += 1;
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && element.name.text === bindingName) count += 1;
      }
    }
  }
  return count;
}

function mutationInputSchemaBindingIsMutated(
  sourceFile: TS.SourceFile,
  bindingName: string,
): boolean {
  let mutated = false;
  const containsBinding = (node: TS.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === bindingName) return true;
    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && containsBinding(child)) found = true;
    });
    return found;
  };
  const visit = (node: TS.Node): void => {
    if (mutated) return;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const aliasInitializer = unwrapTsExpression(node.initializer);
      if (
        aliasInitializer &&
        ts.isIdentifier(aliasInitializer) &&
        aliasInitializer.text === bindingName &&
        (!ts.isIdentifier(node.name) || node.name.text !== bindingName)
      ) {
        mutated = true;
        return;
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      containsBinding(node.left)
    ) {
      mutated = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      containsBinding(node.operand)
    ) {
      mutated = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ((node.expression.expression.text === 'Object' &&
        (node.expression.name.text === 'assign' ||
          node.expression.name.text === 'defineProperty' ||
          node.expression.name.text === 'defineProperties' ||
          node.expression.name.text === 'setPrototypeOf')) ||
        (node.expression.expression.text === 'Reflect' &&
          (node.expression.name.text === 'defineProperty' ||
            node.expression.name.text === 'deleteProperty' ||
            node.expression.name.text === 'set' ||
            node.expression.name.text === 'setPrototypeOf'))) &&
      node.arguments[0] &&
      containsBinding(node.arguments[0])
    ) {
      mutated = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mutated;
}

function objectPropertyExpression(
  object: TS.ObjectLiteralExpression,
  propertyName: string,
): TS.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }
  return null;
}

function schemaExpressionHasCall(expression: TS.Expression, methodName: string): boolean {
  let found = false;
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node) && schemaMethodName(node.getSourceFile(), node) === methodName) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function schemaExpressionCoercion(expression: TS.Expression): MutationInputFieldCoercion {
  let coercion: MutationInputFieldCoercion = 'unknown';

  const visit = (node: TS.Node): void => {
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

function schemaMethodName(sourceFile: TS.SourceFile, call: TS.CallExpression): string | null {
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

function isKovoSchemaExpression(sourceFile: TS.SourceFile, expression: TS.Expression): boolean {
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

function isKovoSchemaReceiver(sourceFile: TS.SourceFile, expression: TS.Expression): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    SCHEMA_IDENTITY,
    { legacyGlobals: [SCHEMA_IDENTITY] },
  );
}

function unwrapTsExpression(expression: TS.Expression | undefined): TS.Expression | null {
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
