import type * as TypeScript from 'typescript';

/** @internal Canonical package identity used by compiler/static gates. */
export type FrameworkIdentityModule =
  | '@kovojs/browser'
  | '@kovojs/core'
  | '@kovojs/drizzle'
  | '@kovojs/server'
  | 'drizzle-orm';

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
  | 'isNamedExports'
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
  's',
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
const CORE_EXPORTS = new Set(['component', 'publishToClient', 'trustedReveal']);
const DRIZZLE_EXPORTS = new Set(['sql']);
const DRIZZLE_ORM_EXPORTS = new Set([
  'avg',
  'avgDistinct',
  'count',
  'countDistinct',
  'max',
  'min',
  'sql',
  'sum',
  'sumDistinct',
]);

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
  const visit = (node: TypeScript.Node): void => {
    if (isExpressionNode(ts, node)) {
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
  if (specifier === '@kovojs/browser' && BROWSER_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/browser', exportName);
  }
  if (specifier === '@kovojs/core' && CORE_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/core', exportName);
  }
  if (specifier === '@kovojs/drizzle' && DRIZZLE_EXPORTS.has(exportName)) {
    return frameworkExport('@kovojs/drizzle', exportName);
  }
  if (specifier === 'drizzle-orm' && DRIZZLE_ORM_EXPORTS.has(exportName)) {
    return frameworkExport('drizzle-orm', exportName);
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
      if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) continue;
      const exportClause = statement.exportClause;
      if (exportClause && ts.isNamedExports(exportClause)) {
        for (const element of exportClause.elements) {
          if (element.name.text !== exportName) continue;
          const importedName = element.propertyName?.text ?? element.name.text;
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
