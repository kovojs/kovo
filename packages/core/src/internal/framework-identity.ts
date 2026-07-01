import type * as TypeScript from 'typescript';

/** @internal Canonical Kovo package identity used by compiler/static gates. */
export type FrameworkIdentityModule = '@kovojs/browser' | '@kovojs/core' | '@kovojs/server';

/** @internal Canonical framework export identity after import/subpath/re-export normalization. */
export interface FrameworkExportIdentity {
  readonly exportName: string;
  readonly module: FrameworkIdentityModule;
}

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
  | 'isAsExpression'
  | 'isBindingElement'
  | 'isBlock'
  | 'isCallExpression'
  | 'isClassDeclaration'
  | 'isExportDeclaration'
  | 'isExportSpecifier'
  | 'isExpressionStatement'
  | 'isFunctionDeclaration'
  | 'isFunctionExpression'
  | 'isIdentifier'
  | 'isImportDeclaration'
  | 'isImportSpecifier'
  | 'isInterfaceDeclaration'
  | 'isModuleBlock'
  | 'isNamedImports'
  | 'isNamespaceImport'
  | 'isNonNullExpression'
  | 'isObjectBindingPattern'
  | 'isParameter'
  | 'isParenthesizedExpression'
  | 'isPropertyAccessExpression'
  | 'isSatisfiesExpression'
  | 'isSourceFile'
  | 'isStringLiteralLike'
  | 'isTypeAliasDeclaration'
  | 'isTypeAssertionExpression'
  | 'isVariableDeclaration'
  | 'isVariableStatement'
  | 'SyntaxKind'
>;

const SERVER_DATA_EXPORTS = new Set([
  'domain',
  'mutation',
  'query',
  'Reader',
  'tag',
  'task',
  'write',
]);
const SERVER_ROUTING_EXPORTS = new Set([
  'endpoint',
  'href',
  'layout',
  'Link',
  'notFound',
  'publicAccess',
  'redirect',
  'respond',
  'rootedFiles',
  'route',
  'verifiedAccess',
  'webhook',
]);
const SERVER_RENDERING_EXPORTS = new Set(['safeRichHtml', 'trustedHtml', 'trustedUrl']);
const SERVER_ROOT_ONLY_EXPORTS = new Set(['rootedFiles']);
const BROWSER_EXPORTS = new Set(['safeRichHtml', 'trustedHtml', 'trustedUrl']);
const CORE_EXPORTS = new Set(['component', 'trustedReveal']);

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

/** @internal Return the call expression whose span exactly matches a parser model span. */
export function callExpressionAtSpan(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  span: { readonly end: number; readonly start: number },
): TypeScript.CallExpression | undefined {
  let found: TypeScript.CallExpression | undefined;
  const visit = (node: TypeScript.Node): void => {
    if (found) return;
    if (node.getStart(sourceFile) > span.start || node.getEnd() < span.end) return;
    if (
      ts.isCallExpression(node) &&
      node.getStart(sourceFile) === span.start &&
      node.getEnd() === span.end
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** @internal Return the expression whose span exactly matches a parser model span. */
export function expressionAtSpan(
  ts: FrameworkIdentityTypeScript,
  sourceFile: TypeScript.SourceFile,
  span: { readonly end: number; readonly start: number },
): TypeScript.Expression | undefined {
  let found: TypeScript.Expression | undefined;
  const visit = (node: TypeScript.Node): void => {
    if (found) return;
    if (node.getStart(sourceFile) > span.start || node.getEnd() < span.end) return;
    if (
      isExpressionNode(ts, node) &&
      node.getStart(sourceFile) === span.start &&
      node.getEnd() === span.end
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
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

  if (ts.isIdentifier(node)) {
    const declaration = declarationForIdentifier(ts, sourceFile, node);
    if (declaration) {
      return declarationIdentity(ts, sourceFile, declaration, options, seen, depth + 1);
    }
    return legacyGlobalIdentity(node.text, options);
  }

  if (ts.isPropertyAccessExpression(node)) {
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

  return undefined;
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
    return specifierExportIdentity(importDeclaration.moduleSpecifier.text, importedName);
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
          return specifierExportIdentity(importDeclaration.moduleSpecifier.text, member);
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

  return undefined;
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
    for (const declaration of namedDeclarations(ts, node)) add(declaration.name, declaration.node);
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

function namedDeclarations(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.Node,
): { readonly name: string; readonly node: TypeScript.Node }[] {
  if (ts.isImportDeclaration(node)) return importDeclarationBindings(ts, node);
  if (ts.isVariableDeclaration(node)) {
    if (ts.isIdentifier(node.name)) return [{ name: node.name.text, node }];
    if (ts.isObjectBindingPattern(node.name)) return objectBindingElements(ts, node.name);
  }
  if (ts.isFunctionDeclaration(node) && node.name) return [{ name: node.name.text, node }];
  if (ts.isClassDeclaration(node) && node.name) return [{ name: node.name.text, node }];
  if (ts.isInterfaceDeclaration(node)) return [{ name: node.name.text, node }];
  if (ts.isTypeAliasDeclaration(node)) return [{ name: node.name.text, node }];
  return [];
}

function importDeclarationBindings(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.ImportDeclaration,
): { readonly name: string; readonly node: TypeScript.Node }[] {
  const clause = node.importClause;
  if (!clause) return [];
  const declarations: { name: string; node: TypeScript.Node }[] = [];
  if (clause.name) declarations.push({ name: clause.name.text, node: clause });
  const bindings = clause.namedBindings;
  if (!bindings) return declarations;
  if (ts.isNamespaceImport(bindings)) {
    declarations.push({ name: bindings.name.text, node: bindings });
    return declarations;
  }
  if (!ts.isNamedImports(bindings)) return declarations;
  for (const element of bindings.elements) {
    declarations.push({ name: element.name.text, node: element });
  }
  return declarations;
}

function objectBindingElements(
  ts: FrameworkIdentityTypeScript,
  pattern: TypeScript.ObjectBindingPattern,
): { readonly name: string; readonly node: TypeScript.Node }[] {
  return pattern.elements.flatMap((element) =>
    ts.isIdentifier(element.name) ? [{ name: element.name.text, node: element }] : [],
  );
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
  if (specifier === '@kovojs/browser' && BROWSER_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/browser', exportName);
  }
  if (specifier === '@kovojs/core' && CORE_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/core', exportName);
  }
  if (specifier === '@kovojs/server/api/data' && SERVER_DATA_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/server', exportName);
  }
  if (specifier === '@kovojs/server/api/routing' && SERVER_ROUTING_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/server', exportName);
  }
  if (specifier === '@kovojs/server/api/rendering' && SERVER_RENDERING_EXPORTS.has(exportName)) {
    return serverRenderingIdentity(exportName);
  }
  if (specifier === '@kovojs/server') {
    if (
      SERVER_DATA_EXPORTS.has(exportName) ||
      SERVER_ROUTING_EXPORTS.has(exportName) ||
      SERVER_ROOT_ONLY_EXPORTS.has(exportName)
    ) {
      return frameworkExport('@kovojs/server', exportName);
    }
    if (SERVER_RENDERING_EXPORTS.has(exportName)) return serverRenderingIdentity(exportName);
  }
  return undefined;
}

function serverRenderingIdentity(exportName: string): FrameworkExportIdentity {
  return exportName === 'trustedHtml' || exportName === 'trustedUrl'
    ? frameworkExport('@kovojs/browser', exportName)
    : frameworkExport('@kovojs/server', exportName);
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

function isExpressionNode(
  ts: FrameworkIdentityTypeScript,
  node: TypeScript.Node,
): node is TypeScript.Expression {
  return (
    ts.isIdentifier(node) ||
    ts.isCallExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  );
}
