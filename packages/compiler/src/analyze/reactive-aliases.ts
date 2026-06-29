import ts from 'typescript';

import {
  propertyAccessPathModels,
  type ComponentModuleModel,
  type JsxExpressionModel,
  type PropertyAccessPathModel,
} from '../scan/parse.js';

interface LocalConstAlias {
  accesses: readonly PropertyAccessPathModel[];
  expression: string;
  name: string;
}

/** @internal Follow same-render-body `const x = state/query...` aliases for §4.9 coverage. */
export function reactivePropertyAccessesForJsxExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly PropertyAccessPathModel[] {
  const aliases = localConstAliasesForExpression(expression, model);
  if (aliases.length === 0) return expression.propertyAccesses;
  const aliasNames = new Set(aliases.map((alias) => alias.name));
  return [
    ...expression.propertyAccesses.filter(
      (access) => !aliasNames.has(access.path.split('.')[0] ?? ''),
    ),
    ...aliases.flatMap((alias) => alias.accesses),
  ];
}

/** @internal Expand same-render-body const aliases for generated client derives. */
export function reactiveExpressionForJsxExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): string {
  const aliases = localConstAliasesForExpression(expression, model);
  if (aliases.length === 0) return expression.expression;

  let expanded = expression.expression;
  for (const alias of [...aliases].sort((left, right) => right.name.length - left.name.length)) {
    expanded = expanded.replace(
      new RegExp(`\\b${escapeRegExp(alias.name)}\\b`, 'g'),
      `(${alias.expression})`,
    );
  }
  return expanded;
}

function localConstAliasesForExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly LocalConstAlias[] {
  const references = new Set(expression.references);
  if (references.size === 0) return [];

  const body = smallestFunctionBlockContaining(model.sourceFile, expression.start);
  if (!body) return [];

  const aliases: LocalConstAlias[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(model.sourceFile) >= expression.start) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (references.has(name) && isConstVariableDeclaration(node)) {
        const accesses = propertyAccessPathModels(model.sourceFile, node.initializer);
        if (accesses.length > 0 && !seen.has(name)) {
          seen.add(name);
          aliases.push({
            accesses,
            expression: node.initializer.getText(model.sourceFile),
            name,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return aliases;
}

function smallestFunctionBlockContaining(
  sourceFile: ts.SourceFile,
  position: number,
): ts.Block | null {
  let best: ts.Block | null = null;
  const visit = (node: ts.Node): void => {
    if (position < node.getStart(sourceFile) || position > node.getEnd()) return;
    best = functionBlockBody(node) ?? best;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function functionBlockBody(node: ts.Node): ts.Block | null {
  if (
    !(
      ts.isArrowFunction(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    )
  ) {
    return null;
  }
  return node.body && ts.isBlock(node.body) ? node.body : null;
}

function isFunctionOrClassLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
