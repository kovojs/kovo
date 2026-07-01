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
): string | null {
  const aliases = localAliasesForExpression(expression, model);
  const referencedAliases = aliases.filter((alias) => expression.references.includes(alias.name));
  if (referencedAliases.some((alias) => alias.expression === undefined)) return null;
  if (aliases.length === 0) {
    return referencesAreDeriveInputs(expression.references, ['state'])
      ? expression.expression
      : null;
  }
  const referencedAliasNames = new Set(referencedAliases.map((alias) => alias.name));
  const remainingReferences = expression.references.filter(
    (name) => !referencedAliasNames.has(name),
  );
  if (!referencesAreDeriveInputs(remainingReferences, ['state'])) return null;
  if (
    referencedAliases.some((alias) => !referencesAreDeriveInputs(alias.references ?? [], ['state']))
  ) {
    return null;
  }

  let expanded = expression.expression;
  for (const alias of [...aliases]
    .filter(isExpressionAlias)
    .sort((left, right) => right.name.length - left.name.length)) {
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
  references?: readonly string[];
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
    const aliasExpression = ts.isIdentifier(declaration.initializer)
      ? canonicalExpressionForAccesses(accesses)
      : undefined;
    aliases.push({
      accesses,
      ...(aliasExpression ? { expression: aliasExpression } : {}),
      name,
      ...(aliasExpression ? { references: referenceRootsForAccesses(accesses) } : {}),
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
      (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) &&
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
  pattern: ts.BindingPattern,
  initializer: ts.Expression,
  references: ReadonlySet<string>,
  prefix: readonly BindingPathSegment[],
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  const initializerExpression = initializerExpressionFromExpression(sourceFile, initializer);
  if (!initializerExpression) return [];

  for (const [index, element] of pattern.elements.entries()) {
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken) continue;

    const propertyName = ts.isObjectBindingPattern(pattern)
      ? bindingPropertyName(element)
      : index.toString();
    if (propertyName === null) continue;

    const segment: BindingPathSegment = ts.isObjectBindingPattern(pattern)
      ? { kind: 'property', value: propertyName }
      : { kind: 'index', value: propertyName };
    const path = [...prefix, segment];
    if (ts.isIdentifier(element.name)) {
      const name = element.name.text;
      if (!references.has(name)) continue;
      const resolvedPath = bindingPathAccessPath(initializerExpression.accessPath, path);
      const resolvedExpression = bindingPathExpression(initializerExpression.expression, path);
      aliases.push({
        accesses: [
          {
            end: element.name.getEnd(),
            path: resolvedPath,
            start: element.name.getStart(sourceFile),
            terminalName: path.at(-1)?.value ?? name,
          },
        ],
        expression: resolvedExpression,
        name,
        references: referenceRootsForAccessPath(initializerExpression.accessPath),
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

interface InitializerExpression {
  accessPath: string;
  expression: string;
}

type BindingPathSegment = { kind: 'index'; value: string } | { kind: 'property'; value: string };

function initializerExpressionFromExpression(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
): InitializerExpression | null {
  if (ts.isIdentifier(initializer)) {
    return { accessPath: initializer.text, expression: initializer.text };
  }
  const accessPath = exactInitializerPath(propertyAccessPathModels(sourceFile, initializer));
  if (!accessPath) return null;
  return { accessPath, expression: initializer.getText(sourceFile) };
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
  if (
    ts.isComputedPropertyName(propertyName) &&
    (ts.isStringLiteralLike(propertyName.expression) ||
      ts.isNumericLiteral(propertyName.expression))
  ) {
    return propertyName.expression.text;
  }
  return null;
}

function bindingPathAccessPath(root: string, path: readonly BindingPathSegment[]): string {
  const suffix = path.map((segment) => segment.value).join('.');
  return suffix ? `${root}.${suffix}` : root;
}

function bindingPathExpression(root: string, path: readonly BindingPathSegment[]): string {
  return path.reduce((expression, segment) => {
    if (segment.kind === 'index') return `${expression}[${segment.value}]`;
    if (/^[A-Za-z_$][\w$]*$/.test(segment.value)) return `${expression}.${segment.value}`;
    return `${expression}[${JSON.stringify(segment.value)}]`;
  }, root);
}

function canonicalExpressionForAccesses(
  accesses: readonly PropertyAccessPathModel[],
): string | undefined {
  const path = exactInitializerPath(accesses);
  return path ?? undefined;
}

function referencesAreDeriveInputs(
  references: readonly string[],
  inputs: readonly string[],
): boolean {
  const allowed = new Set([...inputs, ...safeGlobalIdentifiers]);
  return references.every((name) => allowed.has(name));
}

function referenceRootsForAccesses(
  accesses: readonly PropertyAccessPathModel[],
): readonly string[] {
  return [...new Set(accesses.flatMap((access) => referenceRootsForAccessPath(access.path)))];
}

function referenceRootsForAccessPath(path: string): readonly string[] {
  const [root] = path.split(/[.[\]]/, 1);
  return root ? [root] : [];
}

const safeGlobalIdentifiers = [
  'Array',
  'BigInt',
  'Boolean',
  'Date',
  'Intl',
  'JSON',
  'Math',
  'Number',
  'Object',
  'RegExp',
  'String',
  'encodeURIComponent',
  'decodeURIComponent',
] as const;

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
