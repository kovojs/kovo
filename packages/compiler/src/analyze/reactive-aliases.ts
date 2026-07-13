import {
  type ComponentModuleModel,
  type JsxExpressionModel,
  type PropertyAccessPathModel,
  propertyAccessPathModels,
} from '../scan/parse.js';
import { unwrapExpression } from '../scan/ast.js';
import * as ts from 'typescript';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetForEach,
  compilerSetHas,
  compilerStringEndsWith,
  compilerStringIndexOf,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';

/** @internal Follow same-render-body `const x = state/query...` aliases for §4.9 coverage. */
export function reactivePropertyAccessesForJsxExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): readonly PropertyAccessPathModel[] {
  const aliases = localAliasesForExpression(expression, model);
  if (aliases.length === 0) return expression.propertyAccesses;
  const aliasNames = compilerCreateSet<string>();
  const aliasLength = compilerArrayLength(aliases, 'Reactive aliases');
  for (let index = 0; index < aliasLength; index += 1) {
    compilerSetAdd(aliasNames, ownArrayEntry(aliases, index, 'Reactive aliases').name);
  }
  const accesses: PropertyAccessPathModel[] = [];
  const directLength = compilerArrayLength(
    expression.propertyAccesses,
    'Reactive expression property accesses',
  );
  for (let index = 0; index < directLength; index += 1) {
    const access = ownArrayEntry(
      expression.propertyAccesses,
      index,
      'Reactive expression property accesses',
    );
    if (!compilerSetHas(aliasNames, referenceRootForAccessPath(access.path) ?? '')) {
      compilerArrayAppend(accesses, access, 'Reactive property accesses');
    }
  }
  for (let index = 0; index < aliasLength; index += 1) {
    appendArray(
      accesses,
      ownArrayEntry(aliases, index, 'Reactive aliases').accesses,
      'Reactive property accesses',
    );
  }
  return accesses;
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
  const identifierExpressionAliasNames = compilerCreateSet<string>();
  const identifierAliasLength = compilerArrayLength(identifierAliases, 'Identifier aliases');
  for (let index = 0; index < identifierAliasLength; index += 1) {
    const alias = ownArrayEntry(identifierAliases, index, 'Identifier aliases');
    if (alias.expression !== undefined) compilerSetAdd(identifierExpressionAliasNames, alias.name);
  }
  const combined: ReactiveAliasModel[] = [];
  const localAliasLength = compilerArrayLength(
    expression.localConstAliases,
    'Expression local const aliases',
  );
  for (let index = 0; index < localAliasLength; index += 1) {
    const alias = ownArrayEntry(
      expression.localConstAliases,
      index,
      'Expression local const aliases',
    );
    if (!compilerSetHas(identifierExpressionAliasNames, alias.name)) {
      compilerArrayAppend(combined, alias, 'Combined reactive aliases');
    }
  }
  appendArray(combined, identifierAliases, 'Combined reactive aliases');
  appendArray(
    combined,
    functionDeclarationReadAliasesBefore(model.sourceFile, functions),
    'Combined reactive aliases',
  );
  appendArray(combined, destructuredAliases, 'Combined reactive aliases');
  const aliases = dedupeAliases(combined);
  return aliasesReachableFromReferences(expression.references, aliases);
}

function identifierConstReadAliasesBefore(
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.VariableDeclaration>,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
  destructuredAliases: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  compilerMapForEach(declarations, (declaration, name) => {
    if (!declaration.initializer) return;

    const accesses = resolvedInitializerAccesses(
      sourceFile,
      declaration.initializer,
      declarations,
      functions,
      destructuredAliases,
    );
    if (accesses.length === 0) return;
    const aliasExpression = accessExpressionFromExpression(declaration.initializer);
    compilerArrayAppend(
      aliases,
      {
        accesses,
        ...(aliasExpression ? { expression: aliasExpression.expression } : {}),
        name,
        ...(aliasExpression ? { references: identifierReferences(declaration.initializer) } : {}),
        start: declaration.getStart(sourceFile),
      },
      'Identifier reactive aliases',
    );
  });
  return aliases;
}

function functionDeclarationReadAliasesBefore(
  sourceFile: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.FunctionDeclaration>,
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  compilerMapForEach(declarations, (declaration, name) => {
    if (!declaration.body) return;
    const accesses = propertyAccessPathModels(sourceFile, declaration.body);
    if (accesses.length === 0) return;
    compilerArrayAppend(
      aliases,
      {
        accesses,
        name,
        start: declaration.name?.getStart(sourceFile) ?? declaration.getStart(sourceFile),
      },
      'Function reactive aliases',
    );
  });
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
      const aliasReferences = references ?? identifierNameSet(bindingIdentifiers(node.name));
      appendArray(
        aliases,
        bindingPatternAliases(sourceFile, node.name, node.initializer, aliasReferences, []),
        'Destructured reactive aliases',
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
  const declarations = compilerCreateMap<string, ts.VariableDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (node !== body && isFunctionOrClassLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstVariableDeclaration(node)
    ) {
      compilerMapSet(declarations, node.name.text, node);
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
  const declarations = compilerCreateMap<string, ts.FunctionDeclaration>();
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) >= expressionStart) return;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      compilerMapSet(declarations, node.name.text, node);
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
  destructuredAliases?: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seen?: ReadonlySet<string>,
): readonly PropertyAccessPathModel[] {
  const destructured = destructuredAliases ?? compilerCreateMap();
  const visited = seen ?? compilerCreateSet<string>();
  const direct: PropertyAccessPathModel[] = [];
  const sourceAccesses = propertyAccessPathModels(sourceFile, initializer);
  const sourceAccessLength = compilerArrayLength(sourceAccesses, 'Initializer property accesses');
  for (let index = 0; index < sourceAccessLength; index += 1) {
    const access = ownArrayEntry(sourceAccesses, index, 'Initializer property accesses');
    const root = referenceRootForAccessPath(access.path);
    if (
      !root ||
      (compilerMapGet(declarations, root) === undefined &&
        compilerMapGet(destructured, root) === undefined)
    ) {
      compilerArrayAppend(direct, access, 'Direct initializer property accesses');
    }
  }
  const nested: PropertyAccessPathModel[] = [];
  const references = identifierReferences(initializer);
  const referenceLength = compilerArrayLength(references, 'Initializer references');
  for (let index = 0; index < referenceLength; index += 1) {
    const name = ownArrayEntry(references, index, 'Initializer references');
    if (compilerSetHas(visited, name)) continue;
    const destructuredCandidates = compilerMapGet(destructured, name);
    if (destructuredCandidates) {
      const candidateLength = compilerArrayLength(
        destructuredCandidates,
        'Destructured alias candidates',
      );
      for (let candidateIndex = 0; candidateIndex < candidateLength; candidateIndex += 1) {
        appendArray(
          nested,
          ownArrayEntry(destructuredCandidates, candidateIndex, 'Destructured alias candidates')
            .accesses,
          'Nested initializer property accesses',
        );
      }
      continue;
    }

    const declaration = compilerMapGet(declarations, name);
    if (declaration?.initializer) {
      const nextSeen = cloneStringSet(visited);
      compilerSetAdd(nextSeen, name);
      appendArray(
        nested,
        resolvedInitializerAccesses(
          sourceFile,
          declaration.initializer,
          declarations,
          functions,
          destructured,
          nextSeen,
        ),
        'Nested initializer property accesses',
      );
      continue;
    }

    const fn = compilerMapGet(functions, name);
    if (fn?.body) {
      appendArray(
        nested,
        propertyAccessPathModels(sourceFile, fn.body),
        'Nested initializer property accesses',
      );
    }
  }

  appendArray(direct, nested, 'Initializer property accesses');
  return dedupeAccesses(direct);
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

  const elementLength = compilerArrayLength(pattern.elements, 'Binding pattern elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = ownArrayEntry(pattern.elements, index, 'Binding pattern elements');
    if (ts.isOmittedExpression(element)) continue;
    if (element.dotDotDotToken) {
      appendArray(
        aliases,
        unresolvedBindingAliases(sourceFile, element.name, references, fallbackAccessPaths),
        'Binding pattern reactive aliases',
      );
      continue;
    }

    const propertyName = ts.isObjectBindingPattern(pattern)
      ? bindingPropertyName(element)
      : index.toString();
    if (propertyName === null) {
      appendArray(
        aliases,
        unresolvedBindingAliases(sourceFile, element.name, references, fallbackAccessPaths),
        'Binding pattern reactive aliases',
      );
      continue;
    }

    const segment: BindingPathSegment = ts.isObjectBindingPattern(pattern)
      ? { kind: 'property', value: propertyName }
      : { kind: 'index', value: propertyName };
    const path: BindingPathSegment[] = [];
    appendArray(path, prefix, 'Binding path segments');
    compilerArrayAppend(path, segment, 'Binding path segments');
    if (element.initializer) {
      const accessPaths = initializerExpression
        ? [bindingPathAccessPath(initializerExpression.accessPath, path)]
        : fallbackAccessPaths;
      appendArray(
        aliases,
        unresolvedBindingAliases(sourceFile, element.name, references, accessPaths),
        'Binding pattern reactive aliases',
      );
      continue;
    }
    if (ts.isIdentifier(element.name)) {
      const name = element.name.text;
      if (!compilerSetHas(references, name)) continue;
      if (!initializerExpression) {
        appendArray(
          aliases,
          unresolvedBindingAliases(sourceFile, element.name, references, fallbackAccessPaths),
          'Binding pattern reactive aliases',
        );
        continue;
      }
      const resolvedPath = bindingPathAccessPath(initializerExpression.accessPath, path);
      const resolvedExpression = bindingPathExpression(initializerExpression.expression, path);
      const terminal = ownArrayEntry(path, path.length - 1, 'Binding path segments').value;
      compilerArrayAppend(
        aliases,
        {
          accesses: [
            {
              end: element.name.getEnd(),
              path: resolvedPath,
              start: element.name.getStart(sourceFile),
              terminalName: terminal || name,
            },
          ],
          expression: resolvedExpression,
          name,
          references: referenceRootsForAccessPath(initializerExpression.accessPath),
          start: element.getStart(sourceFile),
        },
        'Binding pattern reactive aliases',
      );
      continue;
    }

    if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
      appendArray(
        aliases,
        bindingPatternAliases(sourceFile, element.name, initializer, references, path),
        'Binding pattern reactive aliases',
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

function elementAccessMember(
  expression: ts.ElementAccessExpression,
): { expression: string; path: string } | null {
  const argument = expression.argumentExpression;
  if (ts.isStringLiteralLike(argument)) {
    return { expression: `[${compilerJsonStringify(argument.text) ?? '""'}]`, path: argument.text };
  }
  if (ts.isNumericLiteral(argument)) {
    return { expression: `[${argument.text}]`, path: argument.text };
  }
  return null;
}

function markLastAccessPathSegmentOptional(path: string): string {
  const parts = compilerStringSplit(path, '.');
  const partLength = compilerArrayLength(parts, 'Reactive access path parts');
  if (partLength === 0) return path;
  const last = ownArrayEntry(parts, partLength - 1, 'Reactive access path parts');
  if (last) {
    parts[partLength - 1] = compilerStringEndsWith(last, '?') ? last : `${last}?`;
  }
  return compilerArrayJoin(parts, '.');
}

function unresolvedInitializerAccessPaths(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
): readonly string[] {
  const paths: string[] = [];
  const seen = compilerCreateSet<string>();
  const accesses = propertyAccessPathModels(sourceFile, initializer);
  const accessLength = compilerArrayLength(accesses, 'Unresolved initializer accesses');
  for (let index = 0; index < accessLength; index += 1) {
    const path = ownArrayEntry(accesses, index, 'Unresolved initializer accesses').path;
    if (compilerSetHas(seen, path)) continue;
    compilerSetAdd(seen, path);
    compilerArrayAppend(paths, path, 'Unresolved initializer paths');
  }
  return paths;
}

function unresolvedBindingAliases(
  sourceFile: ts.SourceFile,
  name: ts.BindingName,
  references: ReadonlySet<string>,
  accessPaths: readonly string[],
): readonly ReactiveAliasModel[] {
  const aliases: ReactiveAliasModel[] = [];
  const identifiers = bindingIdentifiers(name);
  const identifierLength = compilerArrayLength(identifiers, 'Binding identifiers');
  for (let identifierIndex = 0; identifierIndex < identifierLength; identifierIndex += 1) {
    const identifier = ownArrayEntry(identifiers, identifierIndex, 'Binding identifiers');
    if (!compilerSetHas(references, identifier.text)) continue;
    const accesses: PropertyAccessPathModel[] = [];
    const pathLength = compilerArrayLength(accessPaths, 'Unresolved binding access paths');
    for (let pathIndex = 0; pathIndex < pathLength; pathIndex += 1) {
      const accessPath = ownArrayEntry(accessPaths, pathIndex, 'Unresolved binding access paths');
      compilerArrayAppend(
        accesses,
        {
          end: identifier.getEnd(),
          path: accessPath,
          start: identifier.getStart(sourceFile),
          terminalName: lastAccessPathPart(accessPath),
        },
        'Unresolved binding accesses',
      );
    }
    compilerArrayAppend(
      aliases,
      { accesses, name: identifier.text, start: identifier.getStart(sourceFile) },
      'Unresolved binding aliases',
    );
  }
  return aliases;
}

function bindingIdentifiers(name: ts.BindingName): readonly ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const identifiers: ts.Identifier[] = [];
  const elementLength = compilerArrayLength(name.elements, 'Binding name elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = ownArrayEntry(name.elements, index, 'Binding name elements');
    if (ts.isOmittedExpression(element)) continue;
    appendArray(identifiers, bindingIdentifiers(element.name), 'Binding identifiers');
  }
  return identifiers;
}

function identifierReferences(root: ts.Node): readonly string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isDeclarationName(node)) return;
    if (ts.isIdentifier(node) && !isPropertyAccessName(node)) {
      compilerArrayAppend(names, node.text, 'Identifier references');
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return uniqueStrings(names, 'Identifier references');
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
  const values: string[] = [];
  const pathLength = compilerArrayLength(path, 'Binding path segments');
  for (let index = 0; index < pathLength; index += 1) {
    compilerArrayAppend(
      values,
      ownArrayEntry(path, index, 'Binding path segments').value,
      'Binding path values',
    );
  }
  const suffix = compilerArrayJoin(values, '.');
  return suffix ? `${root}.${suffix}` : root;
}

function bindingPathExpression(root: string, path: readonly BindingPathSegment[]): string {
  let expression = root;
  const pathLength = compilerArrayLength(path, 'Binding path segments');
  for (let index = 0; index < pathLength; index += 1) {
    const segment = ownArrayEntry(path, index, 'Binding path segments');
    if (segment.kind === 'index') {
      expression = `${expression}[${segment.value}]`;
    } else if (compilerRegExpTest(/^[A-Za-z_$][\w$]*$/u, segment.value)) {
      expression = `${expression}.${segment.value}`;
    } else {
      expression = `${expression}[${compilerJsonStringify(segment.value) ?? '""'}]`;
    }
  }
  return expression;
}

function referencesAreDeriveInputs(
  references: readonly string[],
  inputs: readonly string[],
): boolean {
  const allowed = compilerCreateSet<string>();
  addStringsToSet(allowed, inputs, 'Reactive derive inputs');
  addStringsToSet(allowed, safeGlobalIdentifiers, 'Safe global identifiers');
  const referenceLength = compilerArrayLength(references, 'Reactive expression references');
  for (let index = 0; index < referenceLength; index += 1) {
    if (
      !compilerSetHas(allowed, ownArrayEntry(references, index, 'Reactive expression references'))
    ) {
      return false;
    }
  }
  return true;
}

function referenceRootsForAccessPath(path: string): readonly string[] {
  const root = referenceRootForAccessPath(path);
  return root ? [root] : [];
}

function referenceRootForAccessPath(path: string): string | null {
  let boundary = path.length;
  const dot = compilerStringIndexOf(path, '.');
  const bracket = compilerStringIndexOf(path, '[');
  const close = compilerStringIndexOf(path, ']');
  if (dot >= 0 && dot < boundary) boundary = dot;
  if (bracket >= 0 && bracket < boundary) boundary = bracket;
  if (close >= 0 && close < boundary) boundary = close;
  const root = compilerStringSlice(path, 0, boundary);
  return root || null;
}

function aliasesReachableFromReferences(
  references: readonly string[],
  aliases: readonly ReactiveAliasModel[],
): readonly ReactiveAliasModel[] {
  const aliasesByName = aliasMap(aliases);
  const reached: ReactiveAliasModel[] = [];
  const seen = compilerCreateSet<string>();

  const visit = (name: string): void => {
    const candidates = compilerMapGet(aliasesByName, name);
    if (!candidates) return;
    const candidateLength = compilerArrayLength(candidates, 'Reactive alias candidates');
    for (let candidateIndex = 0; candidateIndex < candidateLength; candidateIndex += 1) {
      const alias = ownArrayEntry(candidates, candidateIndex, 'Reactive alias candidates');
      const key = `${alias.name}\0${alias.start}`;
      if (compilerSetHas(seen, key)) continue;
      compilerSetAdd(seen, key);
      compilerArrayAppend(reached, alias, 'Reachable reactive aliases');
      const nestedReferences = alias.references ?? [];
      const nestedLength = compilerArrayLength(nestedReferences, 'Reactive alias references');
      for (let index = 0; index < nestedLength; index += 1) {
        visit(ownArrayEntry(nestedReferences, index, 'Reactive alias references'));
      }
    }
  };

  const referenceLength = compilerArrayLength(references, 'Reactive expression references');
  for (let index = 0; index < referenceLength; index += 1) {
    visit(ownArrayEntry(references, index, 'Reactive expression references'));
  }
  return reached;
}

function lowerReactiveExpression(
  expression: string,
  references: readonly string[],
  aliasesByName: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seenAliases?: ReadonlySet<string>,
): string | null {
  if (referencesAreDeriveInputs(references, ['state'])) return expression;

  const visitedAliases = seenAliases ?? compilerCreateSet<string>();
  const replacements = compilerCreateMap<string, string>();
  const referenceLength = compilerArrayLength(references, 'Reactive expression references');
  for (let index = 0; index < referenceLength; index += 1) {
    const reference = ownArrayEntry(references, index, 'Reactive expression references');
    if (referencesAreDeriveInputs([reference], ['state'])) continue;
    const lowered = lowerAliasReference(reference, aliasesByName, visitedAliases);
    if (!lowered) return null;
    compilerMapSet(replacements, reference, parenthesizeForReplacement(lowered));
  }
  return replaceIdentifierReferences(expression, replacements);
}

function lowerAliasReference(
  name: string,
  aliasesByName: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seenAliases: ReadonlySet<string>,
): string | null {
  const aliases = compilerMapGet(aliasesByName, name);
  if (!aliases || aliases.length === 0) return null;

  const distinct = compilerCreateSet<string>();
  let result: string | null = null;
  const aliasLength = compilerArrayLength(aliases, 'Reactive alias candidates');
  for (let index = 0; index < aliasLength; index += 1) {
    const lowered = lowerAlias(
      ownArrayEntry(aliases, index, 'Reactive alias candidates'),
      aliasesByName,
      seenAliases,
    );
    if (lowered === null) return null;
    if (!compilerSetHas(distinct, lowered)) {
      if (result !== null) return null;
      compilerSetAdd(distinct, lowered);
      result = lowered;
    }
  }
  return result;
}

function lowerAlias(
  alias: ReactiveAliasModel,
  aliasesByName: ReadonlyMap<string, readonly ReactiveAliasModel[]>,
  seenAliases: ReadonlySet<string>,
): string | null {
  if (!alias.expression) return null;
  const key = `${alias.name}\0${alias.start}`;
  if (compilerSetHas(seenAliases, key)) return null;
  const nextSeen = cloneStringSet(seenAliases);
  compilerSetAdd(nextSeen, key);
  return lowerReactiveExpression(alias.expression, alias.references ?? [], aliasesByName, nextSeen);
}

function replaceIdentifierReferences(
  expression: string,
  replacements: ReadonlyMap<string, string>,
): string {
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
      const replacement = compilerMapGet(replacements, name);
      if (replacement && isReferenceIdentifierToken(expression, scanner.getTokenPos())) {
        compilerArrayAppend(
          edits,
          {
            end: scanner.getTextPos(),
            replacement,
            start: scanner.getTokenPos(),
          },
          'Reactive expression edits',
        );
      }
    }
    token = scanner.scan();
  }

  let rewritten = expression;
  const editLength = compilerArrayLength(edits, 'Reactive expression edits');
  for (let index = editLength - 1; index >= 0; index -= 1) {
    const edit = ownArrayEntry(edits, index, 'Reactive expression edits');
    rewritten = `${compilerStringSlice(rewritten, 0, edit.start)}${edit.replacement}${compilerStringSlice(rewritten, edit.end)}`;
  }
  return rewritten;
}

function parenthesizeForReplacement(expression: string): string {
  const trimmed = compilerStringTrim(expression);
  return hasSingleOuterParentheses(trimmed) ? trimmed : `(${trimmed})`;
}

function hasSingleOuterParentheses(expression: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    expression,
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
    if (char && !compilerRegExpTest(/\s/u, char)) return char;
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
  const seen = compilerCreateSet<string>();
  const deduped: ReactiveAliasModel[] = [];
  const aliasLength = compilerArrayLength(aliases, 'Reactive aliases');
  for (let aliasIndex = 0; aliasIndex < aliasLength; aliasIndex += 1) {
    const alias = ownArrayEntry(aliases, aliasIndex, 'Reactive aliases');
    const paths: string[] = [];
    const accessLength = compilerArrayLength(alias.accesses, 'Reactive alias accesses');
    for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
      compilerArrayAppend(
        paths,
        ownArrayEntry(alias.accesses, accessIndex, 'Reactive alias accesses').path,
        'Reactive alias access paths',
      );
    }
    const key = `${alias.name}\0${compilerArrayJoin(paths, '\0')}`;
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(deduped, alias, 'Deduplicated reactive aliases');
  }
  return deduped;
}

function aliasMap(
  aliases: readonly ReactiveAliasModel[],
): ReadonlyMap<string, readonly ReactiveAliasModel[]> {
  const mapped = compilerCreateMap<string, ReactiveAliasModel[]>();
  const aliasLength = compilerArrayLength(aliases, 'Reactive aliases');
  for (let index = 0; index < aliasLength; index += 1) {
    const alias = ownArrayEntry(aliases, index, 'Reactive aliases');
    const existing = compilerMapGet(mapped, alias.name);
    if (existing) {
      compilerArrayAppend(existing, alias, 'Named reactive aliases');
    } else {
      compilerMapSet(mapped, alias.name, [alias]);
    }
  }
  return mapped;
}

function dedupeAccesses(
  accesses: readonly PropertyAccessPathModel[],
): readonly PropertyAccessPathModel[] {
  const seen = compilerCreateSet<string>();
  const deduped: PropertyAccessPathModel[] = [];
  const accessLength = compilerArrayLength(accesses, 'Reactive property accesses');
  for (let index = 0; index < accessLength; index += 1) {
    const access = ownArrayEntry(accesses, index, 'Reactive property accesses');
    if (compilerSetHas(seen, access.path)) continue;
    compilerSetAdd(seen, access.path);
    compilerArrayAppend(deduped, access, 'Deduplicated reactive property accesses');
  }
  return deduped;
}

function identifierNameSet(identifiers: readonly ts.Identifier[]): Set<string> {
  const names = compilerCreateSet<string>();
  const identifierLength = compilerArrayLength(identifiers, 'Binding identifiers');
  for (let index = 0; index < identifierLength; index += 1) {
    compilerSetAdd(names, ownArrayEntry(identifiers, index, 'Binding identifiers').text);
  }
  return names;
}

function cloneStringSet(values: ReadonlySet<string>): Set<string> {
  const clone = compilerCreateSet<string>();
  compilerSetForEach(values, (value) => compilerSetAdd(clone, value));
  return clone;
}

function addStringsToSet(target: Set<string>, values: readonly string[], label: string): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') compilerFailClosed(`${label}[${index}] must be a string.`);
    compilerSetAdd(target, value);
  }
}

function appendArray<Value>(target: Value[], values: readonly Value[], label: string): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    compilerArrayAppend(target, ownArrayEntry(values, index, label), label);
  }
}

function ownArrayEntry<Value>(values: readonly Value[], index: number, label: string): Value {
  const value = compilerOwnDataValue(values, index, label) as Value | undefined;
  if (value === undefined) compilerFailClosed(`${label}[${index}] must be own data.`);
  return value;
}

function uniqueStrings(values: readonly string[], label: string): string[] {
  const seen = compilerCreateSet<string>();
  const result: string[] = [];
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    const value = ownArrayEntry(values, index, label);
    if (compilerSetHas(seen, value)) continue;
    compilerSetAdd(seen, value);
    compilerArrayAppend(result, value, label);
  }
  return result;
}

function lastAccessPathPart(path: string): string {
  const parts = compilerStringSplit(path, '.');
  const partLength = compilerArrayLength(parts, 'Reactive access path parts');
  return partLength === 0
    ? path
    : ownArrayEntry(parts, partLength - 1, 'Reactive access path parts');
}
