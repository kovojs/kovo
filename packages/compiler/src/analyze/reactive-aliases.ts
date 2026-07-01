import {
  type ComponentModuleModel,
  type JsxExpressionModel,
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
  return lowerReactiveExpression(expression.expression, expression.references, aliasMap(aliases));
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
  const body = smallestFunctionBlockContaining(model.sourceFile, expression.start);
  if (!body) return [];

  const declarations = identifierConstDeclarationsBefore(model.sourceFile, body, expression.start);
  const functions = functionDeclarationsBefore(model.sourceFile, body, expression.start);
  const destructuredAliases = destructuredAliasDeclarationsBefore(
    model.sourceFile,
    body,
    expression.start,
  );
  const identifierAliases = identifierConstReadAliasesBefore(
    model.sourceFile,
    declarations,
    functions,
    aliasMap(destructuredAliases),
  );
  const identifierExpressionAliasNames = new Set(
    identifierAliases.filter((alias) => alias.expression !== undefined).map((alias) => alias.name),
  );
  const aliases = dedupeAliases([
    ...expression.localConstAliases.filter(
      (alias) => !identifierExpressionAliasNames.has(alias.name),
    ),
    ...identifierAliases,
    ...functionDeclarationReadAliasesBefore(model.sourceFile, functions),
    ...destructuredAliases,
  ]);
  return aliasesReachableFromReferences(expression.references, aliases);
}

function identifierConstReadAliasesBefore(
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.VariableDeclaration>,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
  destructuredAliases: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  for (const [name, declaration] of declarations) {
    if (!declaration.initializer) continue;

    const accesses = resolvedInitializerAccesses(
      sourceFile,
      declaration.initializer,
      declarations,
      functions,
      destructuredAliases,
    );
    if (accesses.length === 0) continue;
    const aliasExpression = accessExpressionFromExpression(declaration.initializer);
    aliases.push({
      accesses,
      ...(aliasExpression ? { expression: aliasExpression.expression } : {}),
      name,
      ...(aliasExpression ? { references: identifierReferences(declaration.initializer) } : {}),
      start: declaration.getStart(sourceFile),
    });
  }
  return aliases;
}

function functionDeclarationReadAliasesBefore(
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  for (const [name, declaration] of declarations) {
    if (!declaration.body) continue;
    const accesses = propertyAccessPathModels(sourceFile, declaration.body);
    if (accesses.length === 0) continue;
    aliases.push({
      accesses,
      name,
      start: declaration.name?.getStart(sourceFile) ?? declaration.getStart(sourceFile),
    });
  }
  return aliases;
}

function destructuredAliasDeclarationsBefore(
  sourceFile: ts.SourceFile,
  body: ts.Block,
  expressionStart: number,
  references?: ReadonlySet<string>,
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      const aliasReferences =
        references ?? new Set(bindingIdentifiers(node.name).map((identifier) => identifier.text));
      aliases.push(
        ...bindingPatternAliases(sourceFile, node.name, node.initializer, aliasReferences, []),
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
  destructuredAliases: ReadonlyMap<string, readonly ReactiveAliasModel[]> = new Map(),
  seen: ReadonlySet<string> = new Set(),
): readonly PropertyAccessPathModel[] {
  const direct = propertyAccessPathModels(sourceFile, initializer).filter((access) => {
    const root = referenceRootForAccessPath(access.path);
    return !root || (!declarations.has(root) && !destructuredAliases.has(root));
  });
  const nested = identifierReferences(initializer).flatMap((name) => {
    if (seen.has(name)) return [];
    const destructured = destructuredAliases.get(name);
    if (destructured) return destructured.flatMap((alias) => alias.accesses);

    const declaration = declarations.get(name);
    if (declaration?.initializer) {
      return resolvedInitializerAccesses(
        sourceFile,
        declaration.initializer,
        declarations,
        functions,
        destructuredAliases,
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
  const initializerExpression = initializerExpressionFromExpression(initializer);
  const fallbackAccessPaths = initializerExpression
    ? [bindingPathAccessPath(initializerExpression.accessPath, prefix)]
    : unresolvedInitializerAccessPaths(sourceFile, initializer);
  if (fallbackAccessPaths.length === 0) return [];

  for (const [index, element] of pattern.elements.entries()) {
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken) {
      aliases.push(
        ...unresolvedBindingAliases(sourceFile, element.name, references, fallbackAccessPaths),
      );
      continue;
    }

    const propertyName = ts.isObjectBindingPattern(pattern)
      ? bindingPropertyName(element)
      : index.toString();
    if (propertyName === null) {
      aliases.push(
        ...unresolvedBindingAliases(sourceFile, element.name, references, fallbackAccessPaths),
      );
      continue;
    }

    const segment: BindingPathSegment = ts.isObjectBindingPattern(pattern)
      ? { kind: 'property', value: propertyName }
      : { kind: 'index', value: propertyName };
    const path = [...prefix, segment];
    if (ts.isIdentifier(element.name)) {
      const name = element.name.text;
      if (!references.has(name)) continue;
      if (!initializerExpression) {
        aliases.push(
          ...unresolvedBindingAliases(sourceFile, element.name, references, fallbackAccessPaths),
        );
        continue;
      }
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

    if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
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
  initializer: ts.Expression,
): InitializerExpression | null {
  return accessExpressionFromExpression(initializer);
}

function accessExpressionFromExpression(expression: ts.Expression): InitializerExpression | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return { accessPath: unwrapped.text, expression: unwrapped.text };
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const receiver = accessExpressionFromExpression(unwrapped.expression);
    if (!receiver) return null;
    const receiverPath = unwrapped.questionDotToken
      ? markLastAccessPathSegmentOptional(receiver.accessPath)
      : receiver.accessPath;
    return {
      accessPath: `${receiverPath}.${unwrapped.name.text}`,
      expression: `${receiver.expression}${unwrapped.questionDotToken ? '?.' : '.'}${
        unwrapped.name.text
      }`,
    };
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    const receiver = accessExpressionFromExpression(unwrapped.expression);
    const member = elementAccessMember(unwrapped);
    if (!receiver || !member) return null;
    return {
      accessPath: `${receiver.accessPath}.${member.path}`,
      expression: `${receiver.expression}${member.expression}`,
    };
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function elementAccessMember(
  expression: ts.ElementAccessExpression,
): { expression: string; path: string } | null {
  const argument = expression.argumentExpression;
  if (ts.isStringLiteralLike(argument)) {
    return { expression: `[${JSON.stringify(argument.text)}]`, path: argument.text };
  }
  if (ts.isNumericLiteral(argument)) {
    return { expression: `[${argument.text}]`, path: argument.text };
  }
  return null;
}

function markLastAccessPathSegmentOptional(path: string): string {
  const parts = path.split('.');
  const last = parts.at(-1);
  if (last) parts[parts.length - 1] = last.endsWith('?') ? last : `${last}?`;
  return parts.join('.');
}

function unresolvedInitializerAccessPaths(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
): readonly string[] {
  return [
    ...new Set(propertyAccessPathModels(sourceFile, initializer).map((access) => access.path)),
  ];
}

function unresolvedBindingAliases(
  sourceFile: ts.SourceFile,
  name: ts.BindingName,
  references: ReadonlySet<string>,
  accessPaths: readonly string[],
): readonly ReactiveAliasModel[] {
  return bindingIdentifiers(name)
    .filter((identifier) => references.has(identifier.text))
    .map((identifier) => ({
      accesses: accessPaths.map((accessPath) => ({
        end: identifier.getEnd(),
        path: accessPath,
        start: identifier.getStart(sourceFile),
        terminalName: accessPath.split('.').at(-1) ?? accessPath,
      })),
      name: identifier.text,
      start: identifier.getStart(sourceFile),
    }));
}

function bindingIdentifiers(name: ts.BindingName): readonly ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) => {
    if (ts.isOmittedExpression(element)) return [];
    return bindingIdentifiers(element.name);
  });
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

function referencesAreDeriveInputs(
  references: readonly string[],
  inputs: readonly string[],
): boolean {
  const allowed = new Set([...inputs, ...safeGlobalIdentifiers]);
  return references.every((name) => allowed.has(name));
}

function referenceRootsForAccessPath(path: string): readonly string[] {
  const root = referenceRootForAccessPath(path);
  return root ? [root] : [];
}

function referenceRootForAccessPath(path: string): string | null {
  const [root] = path.split(/[.[\]]/, 1);
  return root ?? null;
}

function aliasesReachableFromReferences(
  references: readonly string[],
  aliases: readonly ReactiveAliasModel[],
): readonly ReactiveAliasModel[] {
  const aliasesByName = aliasMap(aliases);
  const reached: ReactiveAliasModel[] = [];
  const seen = new Set<string>();

  const visit = (name: string): void => {
    const candidates = aliasesByName.get(name);
    if (!candidates) return;
    for (const alias of candidates) {
      const key = `${alias.name}\0${alias.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reached.push(alias);
      for (const reference of alias.references ?? []) visit(reference);
    }
  };

  for (const reference of references) visit(reference);
  return reached;
}

function lowerReactiveExpression(
  expression: string,
  references: readonly string[],
  aliasesByName: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seenAliases: ReadonlySet<string> = new Set(),
): string | null {
  if (referencesAreDeriveInputs(references, ['state'])) return expression;

  const replacements = new Map<string, string>();
  for (const reference of references) {
    if (referencesAreDeriveInputs([reference], ['state'])) continue;
    const lowered = lowerAliasReference(reference, aliasesByName, seenAliases);
    if (!lowered) return null;
    replacements.set(reference, parenthesizeForReplacement(lowered));
  }
  return replaceIdentifierReferences(expression, replacements);
}

function lowerAliasReference(
  name: string,
  aliasesByName: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seenAliases: ReadonlySet<string>,
): string | null {
  const aliases = aliasesByName.get(name);
  if (!aliases || aliases.length === 0) return null;

  const lowered = aliases.map((alias) => lowerAlias(alias, aliasesByName, seenAliases));
  if (lowered.some((value) => value === null)) return null;
  const distinct = [...new Set(lowered.filter((value): value is string => value !== null))];
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

function lowerAlias(
  alias: ReactiveAliasModel,
  aliasesByName: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seenAliases: ReadonlySet<string>,
): string | null {
  if (!alias.expression) return null;
  const key = `${alias.name}\0${alias.start}`;
  if (seenAliases.has(key)) return null;
  return lowerReactiveExpression(
    alias.expression,
    alias.references ?? [],
    aliasesByName,
    new Set([...seenAliases, key]),
  );
}

function replaceIdentifierReferences(
  expression: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0) return expression;

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    expression,
  );
  const edits: { end: number; replacement: string; start: number }[] = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.Identifier) {
      const name = scanner.getTokenText();
      const replacement = replacements.get(name);
      if (replacement && isReferenceIdentifierToken(expression, scanner.getTokenPos())) {
        edits.push({
          end: scanner.getTextPos(),
          replacement,
          start: scanner.getTokenPos(),
        });
      }
    }
    token = scanner.scan();
  }

  let rewritten = expression;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  }
  return rewritten;
}

function parenthesizeForReplacement(expression: string): string {
  const trimmed = expression.trim();
  return hasSingleOuterParentheses(trimmed) ? trimmed : `(${trimmed})`;
}

function hasSingleOuterParentheses(expression: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    expression,
    ts.ScriptKind.TS,
  );
  let depth = 0;
  let sawFirstToken = false;
  let sawOuterClose = false;
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (!sawFirstToken) {
      sawFirstToken = true;
      if (token !== ts.SyntaxKind.OpenParenToken) return false;
      depth = 1;
      token = scanner.scan();
      continue;
    }
    if (sawOuterClose) return false;
    if (token === ts.SyntaxKind.OpenParenToken) {
      depth += 1;
    } else if (token === ts.SyntaxKind.CloseParenToken) {
      depth -= 1;
      if (depth === 0) sawOuterClose = true;
      if (depth < 0) return false;
    }
    token = scanner.scan();
  }
  return sawOuterClose && depth === 0;
}

function isReferenceIdentifierToken(expression: string, start: number): boolean {
  if (previousNonWhitespace(expression, start) === '.') return false;
  return true;
}

function previousNonWhitespace(expression: string, start: number): string | null {
  for (let index = start - 1; index >= 0; index -= 1) {
    const char = expression[index];
    if (char && !/\s/.test(char)) return char;
  }
  return null;
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

function aliasMap(
  aliases: readonly ReactiveAliasModel[],
): ReadonlyMap<string, readonly ReactiveAliasModel[]> {
  const mapped = new Map<string, ReactiveAliasModel[]>();
  for (const alias of aliases) {
    const existing = mapped.get(alias.name);
    if (existing) {
      existing.push(alias);
    } else {
      mapped.set(alias.name, [alias]);
    }
  }
  return mapped;
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
