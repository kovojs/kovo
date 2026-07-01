import {
  type ComponentModuleModel,
  type JsxExpressionModel,
  type LocalConstAliasModel,
  type PropertyAccessPathModel,
  propertyAccessPathModels,
} from '../scan/parse.js';
import * as ts from 'typescript';

/** @internal Follow same-render-body `const x = state/query...` aliases for §4.9 coverage. */
export function reactivePropertyAccessesForJsxExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly PropertyAccessPathModel[] {
  const aliases = localAliasesForExpression(expression, model);
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
  const aliases = localAliasesForExpression(expression, model).filter(isExpressionAlias);
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

interface ReactiveAliasModel {
  accesses: readonly PropertyAccessPathModel[];
  expression?: string;
  name: string;
  start: number;
}

function localAliasesForExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly ReactiveAliasModel[] {
  if (expression.references.length === 0) return [];
  return dedupeAliases([
    ...expression.localConstAliases,
    ...identifierConstReadAliasesForExpression(expression, model),
    ...functionDeclarationReadAliasesForExpression(expression, model),
    ...destructuredAliasesForExpression(expression, model),
  ]);
}

function identifierConstReadAliasesForExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly ReactiveAliasModel[] {
  const body = smallestFunctionBlockContaining(model.sourceFile, expression.start);
  if (!body) return [];

  const declarations = identifierConstDeclarationsBefore(model.sourceFile, body, expression.start);
  const functions = functionDeclarationsBefore(model.sourceFile, body, expression.start);
  const aliases: ReactiveAliasModel[] = [];
  for (const name of expression.references) {
    const declaration = declarations.get(name);
    if (!declaration?.initializer) continue;

    const accesses = resolvedInitializerAccesses(
      model.sourceFile,
      declaration.initializer,
      declarations,
      functions,
    );
    if (accesses.length === 0) continue;
    aliases.push({
      accesses,
      name,
      start: declaration.getStart(model.sourceFile),
    });
  }
  return aliases;
}

function functionDeclarationReadAliasesForExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly ReactiveAliasModel[] {
  const body = smallestFunctionBlockContaining(model.sourceFile, expression.start);
  if (!body) return [];

  const declarations = functionDeclarationsBefore(model.sourceFile, body, expression.start);
  const aliases: ReactiveAliasModel[] = [];
  for (const name of expression.references) {
    const declaration = declarations.get(name);
    if (!declaration?.body) continue;

    const accesses = propertyAccessPathModels(model.sourceFile, declaration.body);
    if (accesses.length === 0) continue;
    aliases.push({
      accesses,
      name,
      start: declaration.name?.getStart(model.sourceFile) ?? declaration.getStart(model.sourceFile),
    });
  }
  return aliases;
}

function destructuredAliasesForExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly ReactiveAliasModel[] {
  const references = new Set(expression.references);
  const body = smallestFunctionBlockContaining(model.sourceFile, expression.start);
  if (!body) return [];

  const aliases: ReactiveAliasModel[] = [];
  const visit = (node: ts.Node): void => {
    if (node.getStart(model.sourceFile) >= expression.start) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      aliases.push(
        ...bindingPatternAliases(model.sourceFile, node.name, node.initializer, references, []),
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return aliases;
}

function identifierConstDeclarationsBefore(
  sourceFile: ts.SourceFile,
  body: ts.Block,
  expressionStart: number,
): ReadonlyMap<string, ts.VariableDeclaration> {
  const declarations = new Map<string, ts.VariableDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return declarations;
}

function functionDeclarationsBefore(
  sourceFile: ts.SourceFile,
  body: ts.Block,
  expressionStart: number,
): ReadonlyMap<string, ts.FunctionDeclaration> {
  const declarations = new Map<string, ts.FunctionDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      declarations.set(node.name.text, node);
      return;
    }
    if (node !== body && isFunctionOrClassLike(node)) return;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return declarations;
}

function resolvedInitializerAccesses(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
  declarations: ReadonlyMap<string, ts.VariableDeclaration>,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
  seen: ReadonlySet<string> = new Set(),
): readonly PropertyAccessPathModel[] {
  const direct = propertyAccessPathModels(sourceFile, initializer);
  const nested = identifierReferences(initializer).flatMap((name) => {
    if (seen.has(name)) return [];
    const declaration = declarations.get(name);
    if (declaration?.initializer) {
      return resolvedInitializerAccesses(
        sourceFile,
        declaration.initializer,
        declarations,
        functions,
        new Set([...seen, name]),
      );
    }

    const fn = functions.get(name);
    if (fn?.body) return propertyAccessPathModels(sourceFile, fn.body);
    return [];
  });

  return dedupeAccesses([...direct, ...nested]);
}

function bindingPatternAliases(
  sourceFile: ts.SourceFile,
  pattern: ts.ObjectBindingPattern,
  initializer: ts.Expression,
  references: ReadonlySet<string>,
  prefix: readonly string[],
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  const initializerPath = initializerPathFromExpression(sourceFile, initializer);
  if (!initializerPath) return [];

  for (const element of pattern.elements) {
    if (element.dotDotDotToken) continue;

    const propertyName = bindingPropertyName(element);
    if (!propertyName) continue;

    const path = [...prefix, propertyName];
    if (ts.isIdentifier(element.name)) {
      const name = element.name.text;
      if (!references.has(name)) continue;
      const resolvedPath = `${initializerPath}.${path.join('.')}`;
      aliases.push({
        accesses: [
          {
            end: element.name.getEnd(),
            path: resolvedPath,
            start: element.name.getStart(sourceFile),
            terminalName: path.at(-1) ?? name,
          },
        ],
        name,
        start: element.getStart(sourceFile),
      });
      continue;
    }

    if (ts.isObjectBindingPattern(element.name)) {
      aliases.push(
        ...bindingPatternAliases(sourceFile, element.name, initializer, references, path),
      );
    }
  }

  return aliases;
}

function initializerPathFromExpression(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
): string | null {
  if (ts.isIdentifier(initializer)) return initializer.text;
  return exactInitializerPath(propertyAccessPathModels(sourceFile, initializer));
}

function exactInitializerPath(accesses: readonly PropertyAccessPathModel[]): string | null {
  const paths = [...new Set(accesses.map((access) => access.path))];
  return paths.length === 1 ? (paths[0] ?? null) : null;
}

function identifierReferences(root: ts.Node): readonly string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isDeclarationName(node)) return;
    if (ts.isIdentifier(node) && !isPropertyAccessName(node)) {
      names.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return [...new Set(names)];
}

function isDeclarationName(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ((ts.isVariableDeclaration(parent) && parent.name === node) ||
      (ts.isParameter(parent) && parent.name === node) ||
      (ts.isBindingElement(parent) && parent.name === node))
  );
}

function isPropertyAccessName(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
}

function bindingPropertyName(element: ts.BindingElement): string | null {
  const propertyName = element.propertyName;
  if (!propertyName && ts.isIdentifier(element.name)) return element.name.text;
  if (!propertyName) return null;
  if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) return propertyName.text;
  if (ts.isNumericLiteral(propertyName)) return propertyName.text;
  return null;
}

function smallestFunctionBlockContaining(
  sourceFile: ts.SourceFile,
  position: number,
): ts.Block | null {
  let best: ts.Block | null = null;
  const visit = (node: ts.Node): void => {
    if (position < node.getStart(sourceFile) || position > node.getEnd()) return;
    const body = functionBlockBody(node);
    if (body) best = body;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function functionBlockBody(node: ts.Node): ts.Block | null {
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
    node.body &&
    ts.isBlock(node.body)
  ) {
    return node.body;
  }
  return null;
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const
  );
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

function dedupeAliases(aliases: readonly ReactiveAliasModel[]): readonly ReactiveAliasModel[] {
  const seen = new Set<string>();
  const deduped: ReactiveAliasModel[] = [];
  for (const alias of aliases) {
    const key = `${alias.name}\0${alias.accesses.map((access) => access.path).join('\0')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(alias);
  }
  return deduped;
}

function dedupeAccesses(
  accesses: readonly PropertyAccessPathModel[],
): readonly PropertyAccessPathModel[] {
  const seen = new Set<string>();
  const deduped: PropertyAccessPathModel[] = [];
  for (const access of accesses) {
    if (seen.has(access.path)) continue;
    seen.add(access.path);
    deduped.push(access);
  }
  return deduped;
}

function isExpressionAlias(alias: ReactiveAliasModel): alias is LocalConstAliasModel {
  return alias.expression !== undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
