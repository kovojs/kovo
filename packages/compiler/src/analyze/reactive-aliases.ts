import {
  type ComponentModuleModel,
  type JsxExpressionModel,
  type LocalConstAliasModel,
  type PropertyAccessPathModel,
} from '../scan/parse.js';

/** @internal Follow same-render-body `const x = state/query...` aliases for §4.9 coverage. */
export function reactivePropertyAccessesForJsxExpression(
  expression: JsxExpressionModel,
  _model: ComponentModuleModel,
): readonly PropertyAccessPathModel[] {
  const aliases = localConstAliasesForExpression(expression);
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
  _model: ComponentModuleModel,
): string {
  const aliases = localConstAliasesForExpression(expression);
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
): readonly LocalConstAliasModel[] {
  if (expression.references.length === 0) return [];
  return expression.localConstAliases;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
