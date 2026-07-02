import type * as TypeScript from 'typescript';
import {
  frameworkCatalogExportForModuleSpecifier,
  type FrameworkExportIdentity,
  type FrameworkIdentityModule,
} from './framework-identity-catalog.ts';

export {
  frameworkCatalogExportForModuleSpecifier,
  frameworkCatalogExportForSourcePath,
  frameworkCatalogExportsForModule,
  frameworkIdentityCatalog,
  type FrameworkExportIdentity,
  type FrameworkIdentityCatalogEntry,
  type FrameworkIdentityModule,
  type FrameworkIdentityScope,
} from './framework-identity-catalog.ts';

/** @internal Options for source-only framework identity resolution. */
export interface FrameworkIdentityOptions {
  /**
   * Compatibility for legacy fixtures that call Kovo globals without imports. The fallback is used
   * only when the identifier has no local/import declaration, so local lookalikes fail closed.
   */
  readonly legacyGlobals?: readonly FrameworkExportIdentity[];
}

/** @internal TypeScript APIs used without making @kovojs/core import TypeScript at runtime. */
export type FrameworkIdentityTypeScript = Pick<
  typeof TypeScript,
  | 'forEachChild'
  | 'isArrayLiteralExpression'
  | 'isArrowFunction'
  | 'isAsExpression'
  | 'isBindingElement'
  | 'isBlock'
  | 'isCallExpression'
  | 'isClassDeclaration'
  | 'isClassExpression'
  | 'isFunctionLike'
  | 'isExportDeclaration'
  | 'isExportSpecifier'
  | 'isExpressionStatement'
  | 'isElementAccessExpression'
  | 'isFunctionDeclaration'
  | 'isFunctionExpression'
  | 'isIdentifier'
  | 'isImportDeclaration'
  | 'isImportSpecifier'
  | 'isInterfaceDeclaration'
  | 'isModuleBlock'
  | 'isNamedExports'
  | 'isNamedImports'
  | 'isNamespaceImport'
  | 'isNewExpression'
  | 'isNonNullExpression'
  | 'isNumericLiteral'
  | 'isObjectBindingPattern'
  | 'isObjectLiteralExpression'
  | 'isParameter'
  | 'isParenthesizedExpression'
  | 'isPropertyAccessExpression'
  | 'isPropertyAssignment'
  | 'isPropertyDeclaration'
  | 'isReturnStatement'
  | 'isSatisfiesExpression'
  | 'isSourceFile'
  | 'isSpreadAssignment'
  | 'isStringLiteralLike'
  | 'isTypeAliasDeclaration'
  | 'isTypeAssertionExpression'
  | 'isVariableDeclaration'
  | 'isVariableStatement'
  | 'SyntaxKind'
>;

/** @internal Resolver behavior for an expression syntax kind. */
export type FrameworkIdentityExpressionKindResolution =
  | 'fail-closed'
  | 'resolve-call-expression'
  | 'resolve-element-access'
  | 'resolve-identifier'
  | 'resolve-new-expression'
  | 'resolve-property-access'
  | 'unwrap-expression';

/** @internal Completeness status for an expression-kind resolver row. */
export type FrameworkIdentityExpressionKindStatus = 'fails-closed' | 'resolved';

/** @internal One row in the resolver expression-kind table. */
export interface FrameworkIdentityExpressionKindRow {
  readonly kind: TypeScript.SyntaxKind | 'default';
  readonly resolution: FrameworkIdentityExpressionKindResolution;
  readonly status: FrameworkIdentityExpressionKindStatus;
}

const MAX_RESOLUTION_DEPTH = 12;

interface DeclarationIndexEntry {
  readonly declaration: TypeScript.Node;
  readonly start: number;
}

const declarationIndexCache = new WeakMap<
  TypeScript.SourceFile,
  WeakMap<TypeScript.Node, Map<string, readonly DeclarationIndexEntry[]>>
>();
const canonicalExpressionCache = new WeakMap<
  TypeScript.SourceFile,
  WeakMap<TypeScript.Expression, FrameworkExportIdentity | null>
>();
const callExpressionSpanCache = new WeakMap<
  TypeScript.SourceFile,
  Map<string, TypeScript.CallExpression>
>();
const expressionSpanCache = new WeakMap<
  TypeScript.SourceFile,
  Map<string, TypeScript.Expression>
>();
const frameworkIdentityProjectCache = new WeakMap<
  TypeScript.SourceFile,
  Map<string, TypeScript.SourceFile>
>();

/** @internal */
export function frameworkExport(
  module: FrameworkIdentityModule,
  exportName: string,
): FrameworkExportIdentity {
  return { exportName, module };
}

/** @internal */
export function frameworkExportEquals(
  left: FrameworkExportIdentity | undefined,
  right: FrameworkExportIdentity,
): boolean {
  return left?.module === right.module && left.exportName === right.exportName;
}

/** @internal */
export function frameworkExportIn(
  identity: FrameworkExportIdentity | undefined,
  expected: readonly FrameworkExportIdentity[],
): boolean {
  return expected.some((item) => frameworkExportEquals(identity, item));
}

/** @internal */
export function expressionResolvesToFrameworkExport(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
  expected: FrameworkExportIdentity,
  options: FrameworkIdentityOptions = {},
): boolean {
  return frameworkExportEquals(
    canonicalFrameworkExportForExpression(ts, sourceFile, expression, options),
    expected,
  );
}

/** @internal */
export function expressionResolvesToAnyFrameworkExport(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
  expected: readonly FrameworkExportIdentity[],
  options: FrameworkIdentityOptions = {},
): boolean {
  return frameworkExportIn(
    canonicalFrameworkExportForExpression(ts, sourceFile, expression, options),
    expected,
  );
}

/** @internal True for a static member access on a resolved framework export. */
export function expressionResolvesToFrameworkExportMember(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
  receiver: FrameworkExportIdentity,
  member: string,
  options: FrameworkIdentityOptions = {},
): boolean {
  const node = unwrapExpression(ts, expression);
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === member &&
    expressionResolvesToFrameworkExport(ts, sourceFile, node.expression, receiver, options)
  );
}

/** @internal */
export function canonicalFrameworkExportForExpression(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
  options: FrameworkIdentityOptions = {},
): FrameworkExportIdentity | undefined {
  if (options.legacyGlobals?.length) {
    return canonicalExpression(ts, sourceFile, expression, options, new Set(), 0);
  }

  const cacheKey = unwrapExpression(ts, expression);
  const cached = canonicalExpressionCache.get(sourceFile)?.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;

  const resolved = canonicalExpression(ts, sourceFile, cacheKey, options, new Set(), 0);
  canonicalExpressionCacheForSource(sourceFile).set(cacheKey, resolved ?? null);
  return resolved;
}

/** @internal Normalize an import/export module specifier plus imported name to a canonical export. */
export function frameworkExportForModuleSpecifier(
  specifier: string,
  exportName: string,
): FrameworkExportIdentity | undefined {
  return specifierExportIdentity(specifier, exportName);
}

/**
 * @internal Expression-kind coverage table for framework identity resolution.
 *
 * SPEC §5.2 and §11 require security recognition to fail closed: rows not listed
 * here use the explicit `default` row instead of silently resolving clean.
 */
export function frameworkIdentityExpressionKindRows(
  ts: FrameworkIdentityTypeScript,
): readonly FrameworkIdentityExpressionKindRow[] {
  return [
    ...frameworkIdentityExpressionSyntaxKinds(ts).map((kind) => ({
      kind,
      ...frameworkIdentityExpressionKindDisposition(ts, kind),
    })),
    { kind: 'default', resolution: 'fail-closed', status: 'fails-closed' },
  ];
}

function frameworkIdentityExpressionSyntaxKinds(
  ts: FrameworkIdentityTypeScript,
): readonly TypeScript.SyntaxKind[] {
  // Mirrors TypeScript's internal isExpressionKind classifier. SPEC §6.6 and §11 require every
  // security recognizer to resolve by provenance or fail closed; keeping a row for every expression
  // kind makes a missing resolver branch visible instead of silently treating it as clean.
  return uniqueSyntaxKinds([
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.ElementAccessExpression,
    ts.SyntaxKind.NewExpression,
    ts.SyntaxKind.CallExpression,
    ts.SyntaxKind.JsxElement,
    ts.SyntaxKind.JsxSelfClosingElement,
    ts.SyntaxKind.JsxFragment,
    ts.SyntaxKind.TaggedTemplateExpression,
    ts.SyntaxKind.ArrayLiteralExpression,
    ts.SyntaxKind.ParenthesizedExpression,
    ts.SyntaxKind.ObjectLiteralExpression,
    ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.PrivateIdentifier,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateExpression,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.ThisKeyword,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.SuperKeyword,
    ts.SyntaxKind.NonNullExpression,
    ts.SyntaxKind.ExpressionWithTypeArguments,
    ts.SyntaxKind.MetaProperty,
    ts.SyntaxKind.ImportKeyword,
    ts.SyntaxKind.MissingDeclaration,
    ts.SyntaxKind.PrefixUnaryExpression,
    ts.SyntaxKind.PostfixUnaryExpression,
    ts.SyntaxKind.DeleteExpression,
    ts.SyntaxKind.TypeOfExpression,
    ts.SyntaxKind.VoidExpression,
    ts.SyntaxKind.AwaitExpression,
    ts.SyntaxKind.TypeAssertionExpression,
    ts.SyntaxKind.ConditionalExpression,
    ts.SyntaxKind.YieldExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.BinaryExpression,
    ts.SyntaxKind.SpreadElement,
    ts.SyntaxKind.AsExpression,
    ts.SyntaxKind.OmittedExpression,
    ts.SyntaxKind.CommaListExpression,
    ts.SyntaxKind.PartiallyEmittedExpression,
    ts.SyntaxKind.SatisfiesExpression,
  ]);
}

function uniqueSyntaxKinds(
  kinds: readonly TypeScript.SyntaxKind[],
): readonly TypeScript.SyntaxKind[] {
  return [...new Set(kinds)];
}

/** @internal Register extra local source files that source-only identity resolution may inspect. */
export function registerFrameworkIdentityProject(
  sourceFile: TypeScript.SourceFile,
  files: readonly TypeScript.SourceFile[],
): void {
  if (files.length === 0) return;
  const project = new Map<string, TypeScript.SourceFile>();
  for (const name of sourceFileLookupNames(sourceFile.fileName)) project.set(name, sourceFile);
  for (const file of files) {
    for (const name of sourceFileLookupNames(file.fileName)) project.set(name, file);
  }
  frameworkIdentityProjectCache.set(sourceFile, project);
  for (const file of files) frameworkIdentityProjectCache.set(file, project);
}

/** @internal Return the call expression whose span exactly matches a parser model span. */
export function callExpressionAtSpan(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  span: { readonly end: number; readonly start: number },
): TypeScript.CallExpression | undefined {
  return callExpressionSpanIndex(ts, sourceFile).get(spanCacheKey(span));
}

/** @internal Return the expression whose span exactly matches a parser model span. */
export function expressionAtSpan(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  span: { readonly end: number; readonly start: number },
): TypeScript.Expression | undefined {
  return expressionSpanIndex(ts, sourceFile).get(spanCacheKey(span));
}

function canonicalExpression(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const node = unwrapExpression(ts, expression);

  switch (frameworkIdentityExpressionKindResolution(ts, node.kind)) {
    case 'resolve-identifier': {
      if (!ts.isIdentifier(node)) return undefined;
      const declaration = declarationForIdentifier(ts, sourceFile, node);
      if (declaration) {
        return declarationIdentity(ts, sourceFile, declaration, options, seen, depth + 1);
      }
      return legacyGlobalIdentity(node.text, options);
    }

    case 'resolve-property-access': {
      if (!ts.isPropertyAccessExpression(node)) return undefined;
      return namespaceMemberIdentity(
        ts,
        sourceFile,
        node.expression,
        node.name.text,
        options,
        seen,
        depth + 1,
      );
    }

    case 'resolve-element-access': {
      if (!ts.isElementAccessExpression(node)) return undefined;
      const member = elementAccessMemberName(ts, node);
      return member
        ? namespaceMemberIdentity(ts, sourceFile, node.expression, member, options, seen, depth + 1)
        : undefined;
    }

    case 'resolve-call-expression': {
      if (!ts.isCallExpression(node)) return undefined;
      return callReturnIdentity(ts, sourceFile, node, options, seen, depth + 1);
    }

    case 'resolve-new-expression': {
      if (!ts.isNewExpression(node)) return undefined;
      return newExpressionIdentity(ts, sourceFile, node, options, seen, depth + 1);
    }

    case 'fail-closed':
    case 'unwrap-expression':
      return undefined;
  }
}

function declarationIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  declaration: TypeScript.Node,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;

  if (ts.isImportSpecifier(declaration)) {
    const importDeclaration = declaration.parent.parent.parent;
    if (!ts.isImportDeclaration(importDeclaration)) return undefined;
    if (!ts.isStringLiteralLike(importDeclaration.moduleSpecifier)) return undefined;
    const importedName = declaration.propertyName?.text ?? declaration.name.text;
    const specifier = importDeclaration.moduleSpecifier.text;
    return (
      specifierExportIdentity(specifier, importedName) ??
      localModuleExportIdentity(ts, sourceFile, specifier, importedName, options, seen, depth + 1)
    );
  }

  if (ts.isVariableDeclaration(declaration)) {
    const key = `var:${declaration.getStart(sourceFile)}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    return declaration.initializer
      ? canonicalExpression(ts, sourceFile, declaration.initializer, options, seen, depth + 1)
      : undefined;
  }

  if (ts.isBindingElement(declaration)) {
    const key = `binding:${declaration.getStart(sourceFile)}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const member = propertyNameText(ts, declaration.propertyName ?? declaration.name);
    const variable = enclosingVariableDeclaration(ts, declaration);
    if (!member || !variable?.initializer) return undefined;
    return namespaceMemberIdentity(
      ts,
      sourceFile,
      variable.initializer,
      member,
      options,
      seen,
      depth + 1,
    );
  }

  return undefined;
}

function namespaceMemberIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  receiver: TypeScript.Expression,
  member: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const expression = unwrapExpression(ts, receiver);

  if (ts.isIdentifier(expression)) {
    const declaration = declarationForIdentifier(ts, sourceFile, expression);
    if (declaration) {
      if (ts.isNamespaceImport(declaration)) {
        const importDeclaration = declaration.parent.parent;
        if (
          ts.isImportDeclaration(importDeclaration) &&
          ts.isStringLiteralLike(importDeclaration.moduleSpecifier)
        ) {
          const specifier = importDeclaration.moduleSpecifier.text;
          return (
            specifierExportIdentity(specifier, member) ??
            localModuleExportIdentity(ts, sourceFile, specifier, member, options, seen, depth + 1)
          );
        }
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const key = `namespace-var:${declaration.getStart(sourceFile)}:${member}`;
        if (seen.has(key)) return undefined;
        seen.add(key);
        return namespaceMemberIdentity(
          ts,
          sourceFile,
          declaration.initializer,
          member,
          options,
          seen,
          depth + 1,
        );
      }
      const receiverIdentity = declarationIdentity(
        ts,
        sourceFile,
        declaration,
        options,
        seen,
        depth + 1,
      );
      return receiverIdentity?.exportName === member ? receiverIdentity : undefined;
    }
    return undefined;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const receiverIdentity = canonicalExpression(
      ts,
      sourceFile,
      expression,
      options,
      seen,
      depth + 1,
    );
    return receiverIdentity?.exportName === member ? receiverIdentity : undefined;
  }

  if (ts.isElementAccessExpression(expression)) {
    const receiverIdentity = canonicalExpression(
      ts,
      sourceFile,
      expression,
      options,
      seen,
      depth + 1,
    );
    return receiverIdentity?.exportName === member ? receiverIdentity : undefined;
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return objectLiteralMemberIdentity(
      ts,
      sourceFile,
      expression,
      member,
      options,
      seen,
      depth + 1,
    );
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return arrayLiteralMemberIdentity(ts, sourceFile, expression, member, options, seen, depth + 1);
  }

  if (ts.isNewExpression(expression)) {
    return newExpressionMemberIdentity(
      ts,
      sourceFile,
      expression,
      member,
      options,
      seen,
      depth + 1,
    );
  }

  return undefined;
}

function objectLiteralMemberIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  object: TypeScript.ObjectLiteralExpression,
  member: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const key = `object:${object.getStart(sourceFile)}:${member}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (property === undefined) continue;
    if (ts.isPropertyAssignment(property)) {
      const propertyName = propertyNameText(ts, property.name);
      if (propertyName !== member) continue;
      return canonicalExpression(ts, sourceFile, property.initializer, options, seen, depth + 1);
    }
    if (ts.isSpreadAssignment(property)) {
      const spreadIdentity = namespaceMemberIdentity(
        ts,
        sourceFile,
        property.expression,
        member,
        options,
        seen,
        depth + 1,
      );
      if (spreadIdentity) return spreadIdentity;
    }
  }

  return undefined;
}

function arrayLiteralMemberIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  array: TypeScript.ArrayLiteralExpression,
  member: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const index = Number(member);
  if (!Number.isInteger(index) || index < 0) return undefined;
  const element = array.elements[index];
  if (element === undefined) return undefined;
  const key = `array:${array.getStart(sourceFile)}:${member}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  return canonicalExpression(ts, sourceFile, element, options, seen, depth + 1);
}

function callReturnIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  call: TypeScript.CallExpression,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const key = `call:${call.getStart(sourceFile)}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  const callee = unwrapExpression(ts, call.expression);
  if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
    return functionReturnIdentity(ts, sourceFile, callee, options, seen, depth + 1);
  }
  if (!ts.isIdentifier(callee)) return undefined;
  const declaration = declarationForIdentifier(ts, sourceFile, callee);
  if (declaration === undefined) return undefined;
  if (ts.isFunctionDeclaration(declaration)) {
    return functionReturnIdentity(ts, sourceFile, declaration, options, seen, depth + 1);
  }
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
    return undefined;
  }
  const initializer = unwrapExpression(ts, declaration.initializer);
  if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return undefined;
  return functionReturnIdentity(ts, sourceFile, initializer, options, seen, depth + 1);
}

function functionReturnIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  fn: TypeScript.ArrowFunction | TypeScript.FunctionDeclaration | TypeScript.FunctionExpression,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH || fn.body === undefined) return undefined;
  if (!ts.isBlock(fn.body)) {
    return canonicalExpression(ts, sourceFile, fn.body, options, seen, depth + 1);
  }
  for (const statement of fn.body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      return canonicalExpression(ts, sourceFile, statement.expression, options, seen, depth + 1);
    }
  }
  return undefined;
}

function newExpressionIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.NewExpression,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  return canonicalExpression(ts, sourceFile, expression.expression, options, seen, depth + 1);
}

function newExpressionMemberIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.NewExpression,
  member: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const classDeclaration = classLikeForNewExpression(
    ts,
    sourceFile,
    expression,
    options,
    seen,
    depth + 1,
  );
  if (classDeclaration === undefined) return undefined;
  const key = `new-member:${classDeclaration.getStart(sourceFile)}:${member}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  for (const classMember of classDeclaration.members) {
    if (!ts.isPropertyDeclaration(classMember) || classMember.initializer === undefined) continue;
    if (propertyNameText(ts, classMember.name) !== member) continue;
    return canonicalExpression(ts, sourceFile, classMember.initializer, options, seen, depth + 1);
  }
  return undefined;
}

function classLikeForNewExpression(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.NewExpression,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): TypeScript.ClassDeclaration | TypeScript.ClassExpression | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const callee = unwrapExpression(ts, expression.expression);
  if (ts.isClassExpression(callee)) return callee;
  if (!ts.isIdentifier(callee)) return undefined;
  const declaration = declarationForIdentifier(ts, sourceFile, callee);
  if (declaration === undefined) return undefined;
  if (ts.isClassDeclaration(declaration)) return declaration;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
    return undefined;
  }
  const initializer = unwrapExpression(ts, declaration.initializer);
  return ts.isClassExpression(initializer) ? initializer : undefined;
}

function declarationForIdentifier(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  identifier: TypeScript.Identifier,
): TypeScript.Node | undefined {
  const name = identifier.text;
  const position = identifier.getStart(sourceFile);
  let cursor: TypeScript.Node | undefined = identifier.parent;

  while (cursor) {
    const parameter = parameterDeclarationInScope(ts, cursor, name, position);
    if (parameter) return parameter;

    if (ts.isBlock(cursor) || ts.isModuleBlock(cursor) || ts.isSourceFile(cursor)) {
      const declaration = declarationInContainerBefore(ts, sourceFile, cursor, name, position);
      if (declaration) return declaration;
    }
    cursor = cursor.parent;
  }

  return undefined;
}

function parameterDeclarationInScope(
  ts: FrameworkIdentityTypeScript,
  scope: TypeScript.Node,
  name: string,
  position: number,
): TypeScript.ParameterDeclaration | undefined {
  if (!isFunctionLikeWithParameters(ts, scope)) return undefined;
  if (scope.getStart(scope.getSourceFile()) >= position) return undefined;
  return scope.parameters.find((parameter) => bindingNameBinds(ts, parameter.name, name));
}

function declarationInContainerBefore(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  container: TypeScript.Node,
  name: string,
  position: number,
): TypeScript.Node | undefined {
  const declarations = declarationIndexForContainer(ts, sourceFile, container).get(name);
  if (!declarations) return undefined;

  let found: TypeScript.Node | undefined;
  for (const entry of declarations) {
    if (entry.start >= position) break;
    found = entry.declaration;
  }
  return found;
}

function declarationIndexForContainer(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  container: TypeScript.Node,
): Map<string, readonly DeclarationIndexEntry[]> {
  let sourceCache = declarationIndexCache.get(sourceFile);
  if (!sourceCache) {
    sourceCache = new WeakMap();
    declarationIndexCache.set(sourceFile, sourceCache);
  }

  const cached = sourceCache.get(container);
  if (cached) return cached;

  const index = new Map<string, DeclarationIndexEntry[]>();
  const add = (name: string, declaration: TypeScript.Node): void => {
    const bucket = index.get(name);
    const entry = { declaration, start: declaration.getStart(sourceFile) };
    if (bucket) bucket.push(entry);
    else index.set(name, [entry]);
  };

  const visit = (node: TypeScript.Node): void => {
    addNamedDeclarations(ts, node, add);
    if (
      node !== container &&
      (isFunctionLikeWithParameters(ts, node) || ts.isClassDeclaration(node))
    ) {
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(container, visit);
  for (const bucket of index.values()) {
    bucket.sort((left, right) => left.start - right.start);
  }
  sourceCache.set(container, index);
  return index;
}

function canonicalExpressionCacheForSource(
  sourceFile: TypeScript.SourceFile,
): WeakMap<TypeScript.Expression, FrameworkExportIdentity | null> {
  let sourceCache = canonicalExpressionCache.get(sourceFile);
  if (!sourceCache) {
    sourceCache = new WeakMap();
    canonicalExpressionCache.set(sourceFile, sourceCache);
  }
  return sourceCache;
}

function callExpressionSpanIndex(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
): Map<string, TypeScript.CallExpression> {
  const cached = callExpressionSpanCache.get(sourceFile);
  if (cached) return cached;

  const index = new Map<string, TypeScript.CallExpression>();
  const visit = (node: TypeScript.Node): void => {
    if (ts.isCallExpression(node)) index.set(nodeSpanCacheKey(sourceFile, node), node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  callExpressionSpanCache.set(sourceFile, index);
  return index;
}

function expressionSpanIndex(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
): Map<string, TypeScript.Expression> {
  const cached = expressionSpanCache.get(sourceFile);
  if (cached) return cached;

  const index = new Map<string, TypeScript.Expression>();
  const expressionKinds = new Set(frameworkIdentityExpressionSyntaxKinds(ts));
  const visit = (node: TypeScript.Node): void => {
    if (isFrameworkIdentityExpressionNode(node, expressionKinds)) {
      const key = nodeSpanCacheKey(sourceFile, node);
      if (!index.has(key)) index.set(key, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  expressionSpanCache.set(sourceFile, index);
  return index;
}

function nodeSpanCacheKey(sourceFile: TypeScript.SourceFile, node: TypeScript.Node): string {
  return `${node.getStart(sourceFile)}:${node.getEnd()}`;
}

function spanCacheKey(span: { readonly end: number; readonly start: number }): string {
  return `${span.start}:${span.end}`;
}

function addNamedDeclarations(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.Node,
  add: (name: string, declaration: TypeScript.Node) => void,
): void {
  if (ts.isImportDeclaration(node)) {
    addImportDeclarationBindings(ts, node, add);
    return;
  }
  if (ts.isVariableDeclaration(node)) {
    if (ts.isIdentifier(node.name)) {
      add(node.name.text, node);
      return;
    }
    if (ts.isObjectBindingPattern(node.name)) addObjectBindingElements(ts, node.name, add);
    return;
  }
  if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node);
  if (ts.isClassDeclaration(node) && node.name) add(node.name.text, node);
  if (ts.isInterfaceDeclaration(node)) add(node.name.text, node);
  if (ts.isTypeAliasDeclaration(node)) add(node.name.text, node);
}

function addImportDeclarationBindings(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.ImportDeclaration,
  add: (name: string, declaration: TypeScript.Node) => void,
): void {
  const clause = node.importClause;
  if (!clause) return;
  if (clause.name) add(clause.name.text, clause);
  const bindings = clause.namedBindings;
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    add(bindings.name.text, bindings);
    return;
  }
  if (!ts.isNamedImports(bindings)) return;
  for (const element of bindings.elements) {
    add(element.name.text, element);
  }
}

function addObjectBindingElements(
  ts: FrameworkIdentityTypeScript,
  pattern: TypeScript.ObjectBindingPattern,
  add: (name: string, declaration: TypeScript.Node) => void,
): void {
  for (const element of pattern.elements) {
    if (ts.isIdentifier(element.name)) add(element.name.text, element);
  }
}

function bindingNameBinds(
  ts: FrameworkIdentityTypeScript,
  binding: TypeScript.BindingName,
  name: string,
): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  if (ts.isObjectBindingPattern(binding)) {
    return binding.elements.some((element) => bindingNameBinds(ts, element.name, name));
  }
  return false;
}

function enclosingVariableDeclaration(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.Node,
): TypeScript.VariableDeclaration | undefined {
  let cursor: TypeScript.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isVariableDeclaration(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

function specifierExportIdentity(
  specifier: string,
  exportName: string,
): FrameworkExportIdentity | undefined {
  return frameworkCatalogExportForModuleSpecifier(specifier, exportName);
}

function localModuleExportIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  specifier: string,
  exportName: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH || !isRelativeSpecifier(specifier)) return undefined;
  const target = resolveProjectSourceFile(sourceFile, specifier);
  if (!target) return undefined;

  const key = `module:${target.fileName}:${exportName}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  return exportedIdentity(ts, target, exportName, options, seen, depth + 1);
}

function exportedIdentity(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  exportName: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): FrameworkExportIdentity | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      const exportClause = statement.exportClause;
      if (exportClause && ts.isNamedExports(exportClause)) {
        for (const element of exportClause.elements) {
          if (element.name.text !== exportName) continue;
          const importedName = element.propertyName?.text ?? element.name.text;
          if (moduleSpecifier === undefined) {
            return declarationIdentity(
              ts,
              sourceFile,
              declarationForExportedLocal(
                ts,
                sourceFile,
                importedName,
                statement.getStart(sourceFile),
              ) ?? element,
              options,
              seen,
              depth + 1,
            );
          }
          if (!ts.isStringLiteralLike(moduleSpecifier)) continue;
          const specifier = moduleSpecifier.text;
          return (
            specifierExportIdentity(specifier, importedName) ??
            localModuleExportIdentity(
              ts,
              sourceFile,
              specifier,
              importedName,
              options,
              seen,
              depth + 1,
            )
          );
        }
      }
      if (!exportClause) {
        if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) continue;
        const specifier = moduleSpecifier.text;
        const starIdentity =
          specifierExportIdentity(specifier, exportName) ??
          localModuleExportIdentity(
            ts,
            sourceFile,
            specifier,
            exportName,
            options,
            seen,
            depth + 1,
          );
        if (starIdentity) return starIdentity;
      }
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(ts, statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
        return declarationIdentity(ts, sourceFile, declaration, options, seen, depth + 1);
      }
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(ts, statement) &&
      statement.name?.text === exportName
    ) {
      return undefined;
    }
  }

  return undefined;
}

function declarationForExportedLocal(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  name: string,
  exportPosition: number,
): TypeScript.Node | undefined {
  const declaration = declarationInContainerBefore(
    ts,
    sourceFile,
    sourceFile,
    name,
    exportPosition,
  );
  return declaration && !ts.isExportSpecifier(declaration) ? declaration : undefined;
}

function frameworkIdentityExpressionKindResolution(
  ts: FrameworkIdentityTypeScript,
  kind: TypeScript.SyntaxKind,
): FrameworkIdentityExpressionKindResolution {
  switch (kind) {
    case ts.SyntaxKind.Identifier:
      return 'resolve-identifier';
    case ts.SyntaxKind.PropertyAccessExpression:
      return 'resolve-property-access';
    case ts.SyntaxKind.ElementAccessExpression:
      return 'resolve-element-access';
    case ts.SyntaxKind.CallExpression:
      return 'resolve-call-expression';
    case ts.SyntaxKind.NewExpression:
      return 'resolve-new-expression';
    case ts.SyntaxKind.ParenthesizedExpression:
    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.SatisfiesExpression:
    case ts.SyntaxKind.TypeAssertionExpression:
    case ts.SyntaxKind.NonNullExpression:
      return 'unwrap-expression';
    default:
      return 'fail-closed';
  }
}

function frameworkIdentityExpressionKindDisposition(
  ts: FrameworkIdentityTypeScript,
  kind: TypeScript.SyntaxKind,
): {
  readonly resolution: FrameworkIdentityExpressionKindResolution;
  readonly status: FrameworkIdentityExpressionKindStatus;
} {
  const resolution = frameworkIdentityExpressionKindResolution(ts, kind);
  return {
    resolution,
    status: resolution === 'fail-closed' ? 'fails-closed' : 'resolved',
  };
}

function resolveProjectSourceFile(
  importingSourceFile: TypeScript.SourceFile,
  specifier: string,
): TypeScript.SourceFile | undefined {
  const project = frameworkIdentityProjectCache.get(importingSourceFile);
  if (!project) return undefined;
  const baseDir = directoryName(importingSourceFile.fileName);
  const base = normalizePath(`${baseDir}${baseDir ? '/' : ''}${specifier}`);
  for (const candidate of sourceFileLookupNames(base)) {
    const file = project.get(candidate);
    if (file) return file;
  }
  return undefined;
}

function hasExportModifier(ts: FrameworkIdentityTypeScript, node: TypeScript.Node): boolean {
  const modifiers = (node as { readonly modifiers?: readonly TypeScript.Modifier[] }).modifiers;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function sourceFileLookupNames(fileName: string): readonly string[] {
  const normalized = normalizePath(fileName);
  const withoutExtension = normalized.replace(/\.(?:[cm]?[jt]sx?|d\.ts)$/u, '');
  return normalized === withoutExtension ? [normalized] : [normalized, withoutExtension];
}

function directoryName(fileName: string): string {
  const normalized = normalizePath(fileName);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/gu, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function legacyGlobalIdentity(
  name: string,
  options: FrameworkIdentityOptions,
): FrameworkExportIdentity | undefined {
  return options.legacyGlobals?.find((identity) => identity.exportName === name);
}

function propertyNameText(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.Node,
): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function elementAccessMemberName(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.ElementAccessExpression,
): string | undefined {
  if (ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  if (ts.isNumericLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

function unwrapExpression(
  ts: FrameworkIdentityTypeScript,
  expression: TypeScript.Expression,
): TypeScript.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isFunctionLikeWithParameters(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.Node,
): node is
  | TypeScript.FunctionDeclaration
  | TypeScript.FunctionExpression
  | TypeScript.ArrowFunction {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    node.kind === ts.SyntaxKind.ArrowFunction
  );
}

function isFrameworkIdentityExpressionNode(
  node: TypeScript.Node,
  expressionKinds: ReadonlySet<TypeScript.SyntaxKind>,
): node is TypeScript.Expression {
  return expressionKinds.has(node.kind);
}
