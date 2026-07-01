import {
  Node,
  SyntaxKind,
  type BindingElement,
  type SourceFile,
  type Symbol as MorphSymbol,
  type Type as MorphType,
} from 'ts-morph';

/** @internal */
export type CanonicalFrameworkModule =
  | '@kovojs/browser'
  | '@kovojs/core'
  | '@kovojs/drizzle'
  | '@kovojs/server'
  | 'drizzle-orm';

/** @internal */
export interface CanonicalFrameworkExportIdentity {
  exportName: string;
  module: CanonicalFrameworkModule;
}

/** @internal */
export interface FrameworkIdentityOptions {
  /**
   * Compatibility for long-standing analyzer fixtures that use undeclared globals
   * like `query(...)`/`kovo(...)`/`sql.raw(...)`. The fallback is used only when the
   * identifier has no local/imported declaration, so local lookalikes fail closed.
   */
  legacyGlobals?: readonly CanonicalFrameworkExportIdentity[];
}

const SERVER_EXPORTS = new Set([
  'adminAssign',
  'domain',
  'encryptAtRest',
  'endpoint',
  'hashPassword',
  'mutation',
  'query',
  'Reader',
  'route',
  's',
  'serverValue',
  'stream',
  'tag',
  'task',
  'webhook',
  'write',
]);

const DRIZZLE_EXPORTS = new Set(['kovo', 'kovoAnalyzerSummary', 'sql', 'staticSql', 'trustedSql']);
const BROWSER_EXPORTS = new Set(['trustedHtml', 'trustedUrl']);
const CORE_EXPORTS = new Set(['trustedReveal']);
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

const MODULE_EXPORTS: Readonly<Record<CanonicalFrameworkModule, ReadonlySet<string>>> = {
  '@kovojs/browser': BROWSER_EXPORTS,
  '@kovojs/core': CORE_EXPORTS,
  '@kovojs/drizzle': DRIZZLE_EXPORTS,
  '@kovojs/server': SERVER_EXPORTS,
  'drizzle-orm': DRIZZLE_ORM_EXPORTS,
};

const SERVER_MODULE_SPECIFIERS = new Set([
  '@kovojs/server',
  '@kovojs/server/api/data',
  '@kovojs/server/api/rendering',
  '@kovojs/server/api/routing',
  '@kovojs/server/write-governance',
]);

/** @internal */
export function frameworkExport(
  module: CanonicalFrameworkModule,
  exportName: string,
): CanonicalFrameworkExportIdentity {
  return { exportName, module };
}

/** @internal */
export function expressionResolvesToFrameworkExport(
  expression: Node,
  expected: CanonicalFrameworkExportIdentity,
  options: FrameworkIdentityOptions = {},
): boolean {
  const resolved = canonicalFrameworkExportForExpression(expression, options);
  return frameworkExportEquals(resolved, expected);
}

/** @internal */
export function symbolResolvesToFrameworkExport(
  symbol: MorphSymbol | undefined,
  expected: CanonicalFrameworkExportIdentity,
  options: FrameworkIdentityOptions = {},
): boolean {
  const resolved = canonicalFrameworkExportForSymbol(symbol, options);
  return frameworkExportEquals(resolved, expected);
}

/** @internal */
export function typeAliasResolvesToFrameworkExport(
  type: MorphType,
  expected: CanonicalFrameworkExportIdentity,
  options: FrameworkIdentityOptions = {},
): boolean {
  const symbols = [
    type.getAliasSymbol(),
    type.getSymbol(),
    type.getApparentType().getAliasSymbol(),
    type.getApparentType().getSymbol(),
  ];
  return symbols.some((symbol) => symbolResolvesToFrameworkExport(symbol, expected, options));
}

/** @internal */
export function canonicalFrameworkExportForExpression(
  expression: Node,
  options: FrameworkIdentityOptions = {},
): CanonicalFrameworkExportIdentity | undefined {
  return canonicalExpression(unwrappedExpression(expression), options, new Set(), 0);
}

/** @internal */
export function canonicalFrameworkExportForSymbol(
  symbol: MorphSymbol | undefined,
  options: FrameworkIdentityOptions = {},
): CanonicalFrameworkExportIdentity | undefined {
  return canonicalSymbol(symbol, options, new Set(), 0);
}

function canonicalExpression(
  expression: Node,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  if (depth > 12) return undefined;
  const node = unwrappedExpression(expression);

  if (Node.isIdentifier(node)) {
    const symbolIdentity = canonicalSymbol(symbolForIdentifier(node), options, seen, depth + 1);
    if (symbolIdentity) return symbolIdentity;

    const initializer = localConstIdentifierInitializer(node);
    if (initializer) return canonicalExpression(initializer, options, seen, depth + 1);

    const localBinding = localBindingIdentityByName(node, options, seen, depth + 1);
    if (localBinding) return localBinding;

    return legacyGlobalIdentity(node, options);
  }

  if (Node.isPropertyAccessExpression(node)) {
    const direct = canonicalSymbol(node.getSymbol(), options, seen, depth + 1);
    if (direct) return direct;
    return canonicalNamespaceMember(node.getExpression(), node.getName(), options, seen, depth + 1);
  }

  if (Node.isElementAccessExpression(node)) {
    const member = propertyNameText(node.getArgumentExpression());
    return member
      ? canonicalNamespaceMember(node.getExpression(), member, options, seen, depth + 1)
      : undefined;
  }

  return canonicalSymbol(node.getSymbol(), options, seen, depth + 1);
}

function canonicalSymbol(
  symbol: MorphSymbol | undefined,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  if (!symbol || depth > 12) return undefined;
  const key = symbolKey(symbol);
  if (seen.has(key)) return undefined;
  seen.add(key);

  const aliased = safeAliasedSymbol(symbol);
  if (aliased && aliased !== symbol) {
    const identity = canonicalSymbol(aliased, options, seen, depth + 1);
    if (identity) return identity;
  }

  for (const declaration of symbol.getDeclarations()) {
    const identity = canonicalDeclaration(declaration, options, seen, depth + 1);
    if (identity) return identity;
  }

  return undefined;
}

function canonicalDeclaration(
  declaration: Node,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  const sourceIdentity = sourceDeclarationIdentity(declaration);
  if (sourceIdentity) return sourceIdentity;

  if (Node.isImportSpecifier(declaration)) {
    const imported = declaration.getName();
    const importDeclaration = declaration.getImportDeclaration();
    const direct = moduleSpecifierIdentity(importDeclaration.getModuleSpecifierValue(), imported);
    if (direct) return direct;
    const moduleSourceFile = importDeclaration.getModuleSpecifierSourceFile();
    return moduleSourceFile
      ? moduleExportIdentity(moduleSourceFile, imported, options, seen, depth + 1)
      : undefined;
  }

  if (Node.isExportSpecifier(declaration)) {
    const exported = declaration.getName();
    const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
    const specifier = exportDeclaration?.getModuleSpecifierValue();
    if (specifier) {
      const direct = moduleSpecifierIdentity(specifier, declaration.getNameNode().getText());
      if (direct) return direct;
      const moduleSourceFile = exportDeclaration?.getModuleSpecifierSourceFile();
      return moduleSourceFile
        ? moduleExportIdentity(
            moduleSourceFile,
            declaration.getNameNode().getText(),
            options,
            seen,
            depth + 1,
          )
        : undefined;
    }
    return localExportIdentity(
      declaration.getSourceFile(),
      declaration.getNameNode().getText(),
      options,
      seen,
      depth + 1,
    );
  }

  if (Node.isBindingElement(declaration)) {
    return bindingElementIdentity(declaration, options, seen, depth + 1);
  }

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? canonicalExpression(initializer, options, seen, depth + 1) : undefined;
  }

  if (Node.isTypeAliasDeclaration(declaration)) {
    const typeNode = declaration.getTypeNode();
    return typeNode ? typeNodeIdentity(typeNode, options, seen, depth + 1) : undefined;
  }

  return undefined;
}

function moduleExportIdentity(
  sourceFile: SourceFile,
  exportedName: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  if (depth > 12) return undefined;
  const key = `${sourceFile.getFilePath()}:${exportedName}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  const direct = sourceFileExportIdentity(sourceFile, exportedName);
  if (direct) return direct;

  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
    const namedExports = declaration.getNamedExports();

    if (namedExports.length === 0) {
      if (specifier) {
        const directStar = moduleSpecifierIdentity(specifier, exportedName);
        if (directStar) return directStar;
      }
      if (moduleSourceFile) {
        const fromStar = moduleExportIdentity(
          moduleSourceFile,
          exportedName,
          options,
          seen,
          depth + 1,
        );
        if (fromStar) return fromStar;
      }
      continue;
    }

    for (const named of namedExports) {
      const exported = named.getAliasNode()?.getText() ?? named.getName();
      if (exported !== exportedName) continue;
      const local = named.getName();
      if (specifier) {
        const directNamed = moduleSpecifierIdentity(specifier, local);
        if (directNamed) return directNamed;
        if (moduleSourceFile) {
          const fromNamed = moduleExportIdentity(moduleSourceFile, local, options, seen, depth + 1);
          if (fromNamed) return fromNamed;
        }
        continue;
      }
      const localIdentity = localExportIdentity(sourceFile, local, options, seen, depth + 1);
      if (localIdentity) return localIdentity;
    }
  }

  return localExportIdentity(sourceFile, exportedName, options, seen, depth + 1);
}

function localExportIdentity(
  sourceFile: SourceFile,
  local: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  const direct = sourceFileExportIdentity(sourceFile, local);
  if (direct) return direct;

  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const named of declaration.getNamedImports()) {
      const localName = named.getAliasNode()?.getText() ?? named.getName();
      if (localName !== local) continue;
      const imported = named.getName();
      const directImport = moduleSpecifierIdentity(declaration.getModuleSpecifierValue(), imported);
      if (directImport) return directImport;
      const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
      if (moduleSourceFile) {
        const importedIdentity = moduleExportIdentity(
          moduleSourceFile,
          imported,
          options,
          seen,
          depth + 1,
        );
        if (importedIdentity) return importedIdentity;
      }
    }
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (declaration.getName() !== local) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const identity = canonicalExpression(initializer, options, seen, depth + 1);
    if (identity) return identity;
  }

  for (const declaration of sourceFile.getTypeAliases()) {
    if (declaration.getName() !== local) continue;
    const typeNode = declaration.getTypeNode();
    if (!typeNode) continue;
    const identity = typeNodeIdentity(typeNode, options, seen, depth + 1);
    if (identity) return identity;
  }

  return undefined;
}

function canonicalNamespaceMember(
  receiver: Node,
  member: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  const expression = unwrappedExpression(receiver);

  if (Node.isIdentifier(expression)) {
    const namespaceMember = namespaceMemberIdentityForIdentifier(
      expression,
      member,
      options,
      seen,
      depth + 1,
    );
    if (namespaceMember) return namespaceMember;

    const initializer = localConstIdentifierInitializer(expression);
    if (initializer) {
      const identity = canonicalNamespaceMember(initializer, member, options, seen, depth + 1);
      if (identity) return identity;
    }
  }

  const objectIdentity = canonicalExpression(expression, options, seen, depth + 1);
  if (objectIdentity && objectIdentity.exportName === member) return objectIdentity;

  return undefined;
}

function namespaceMemberIdentityForIdentifier(
  identifier: Node,
  member: string,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const local = identifier.getText();
  for (const declaration of identifier.getSourceFile().getImportDeclarations()) {
    const namespace = declaration.getNamespaceImport();
    if (!namespace || namespace.getText() !== local) continue;
    const specifier = declaration.getModuleSpecifierValue();
    const direct = moduleSpecifierIdentity(specifier, member);
    if (direct) return direct;
    const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
    if (moduleSourceFile) {
      const exported = moduleExportIdentity(moduleSourceFile, member, options, seen, depth + 1);
      if (exported) return exported;
    }
  }
  return undefined;
}

function bindingElementIdentity(
  binding: BindingElement,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  const property = binding.getPropertyNameNode();
  const member = propertyNameText(property ?? binding.getNameNode());
  if (!member) return undefined;

  const pattern = binding.getFirstAncestorByKind(SyntaxKind.ObjectBindingPattern);
  const variable = pattern?.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  const initializer = variable?.getInitializer();
  return initializer
    ? canonicalNamespaceMember(initializer, member, options, seen, depth + 1)
    : undefined;
}

function typeNodeIdentity(
  typeNode: Node,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  const typeReference = typeNode.asKind(SyntaxKind.TypeReference);
  if (typeReference) {
    return typeNameIdentity(typeReference.getTypeName(), options, seen, depth + 1);
  }
  return canonicalSymbol(typeNode.getSymbol(), options, seen, depth + 1);
}

function typeNameIdentity(
  typeName: Node,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  if (Node.isIdentifier(typeName)) return canonicalExpression(typeName, options, seen, depth + 1);
  if (Node.isQualifiedName(typeName)) {
    return canonicalNamespaceMember(
      typeName.getLeft(),
      typeName.getRight().getText(),
      options,
      seen,
      depth + 1,
    );
  }
  return canonicalSymbol(typeName.getSymbol(), options, seen, depth + 1);
}

function sourceDeclarationIdentity(
  declaration: Node,
): CanonicalFrameworkExportIdentity | undefined {
  const exportName = declarationName(declaration);
  if (!exportName) return undefined;
  return (
    sourcePathIdentity(declaration.getSourceFile().getFilePath(), exportName) ??
    ambientModuleDeclarationIdentity(declaration, exportName)
  );
}

function sourceFileExportIdentity(
  sourceFile: SourceFile,
  exportName: string,
): CanonicalFrameworkExportIdentity | undefined {
  return sourcePathIdentity(sourceFile.getFilePath(), exportName);
}

function sourcePathIdentity(
  filePath: string,
  exportName: string,
): CanonicalFrameworkExportIdentity | undefined {
  const normalized = filePath.replaceAll('\\', '/');
  if (
    (knownPackageSourceFile(normalized, 'server') || normalized.includes('/@kovojs/server/')) &&
    SERVER_EXPORTS.has(exportName)
  ) {
    return frameworkExport('@kovojs/server', exportName);
  }
  if (
    (knownPackageSourceFile(normalized, 'drizzle') || normalized.includes('/@kovojs/drizzle/')) &&
    DRIZZLE_EXPORTS.has(exportName)
  ) {
    return frameworkExport('@kovojs/drizzle', exportName);
  }
  if (
    (knownPackageSourceFile(normalized, 'browser') || normalized.includes('/@kovojs/browser/')) &&
    BROWSER_EXPORTS.has(exportName)
  ) {
    return frameworkExport('@kovojs/browser', exportName);
  }
  if (
    (knownPackageSourceFile(normalized, 'core') || normalized.includes('/@kovojs/core/')) &&
    CORE_EXPORTS.has(exportName)
  ) {
    return frameworkExport('@kovojs/core', exportName);
  }
  if (normalized.includes('drizzle-orm') && DRIZZLE_ORM_EXPORTS.has(exportName)) {
    return frameworkExport('drizzle-orm', exportName);
  }
  return undefined;
}

function ambientModuleDeclarationIdentity(
  declaration: Node,
  exportName: string,
): CanonicalFrameworkExportIdentity | undefined {
  const moduleDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ModuleDeclaration);
  const moduleName = moduleDeclaration?.getNameNode();
  return Node.isStringLiteral(moduleName)
    ? moduleSpecifierIdentity(moduleName.getLiteralText(), exportName)
    : undefined;
}

function knownPackageSourceFile(
  normalizedPath: string,
  packageName: 'browser' | 'core' | 'drizzle' | 'server',
): boolean {
  const relative = normalizedPath.split(`/packages/${packageName}/src/`)[1];
  if (!relative) return false;
  const withoutExtension = relative.replace(/\.[cm]?[jt]sx?$/, '');
  switch (packageName) {
    case 'browser':
      return withoutExtension === 'index' || withoutExtension === 'security-output';
    case 'core':
      return withoutExtension === 'index' || withoutExtension === 'secret';
    case 'drizzle':
      return withoutExtension === 'runtime' || withoutExtension === 'drizzle-surface';
    case 'server':
      return new Set([
        'api/data',
        'api/rendering',
        'api/routing',
        'confidential-at-rest',
        'domain',
        'index',
        'managed-db',
        'mutation',
        'password',
        'query',
        'route',
        'task',
        'write-governance',
      ]).has(withoutExtension);
  }
}

function moduleSpecifierIdentity(
  specifier: string | undefined,
  exportName: string,
): CanonicalFrameworkExportIdentity | undefined {
  const module = canonicalModuleSpecifier(specifier);
  if (!module) return undefined;
  return MODULE_EXPORTS[module].has(exportName) ? frameworkExport(module, exportName) : undefined;
}

function canonicalModuleSpecifier(
  specifier: string | undefined,
): CanonicalFrameworkModule | undefined {
  if (!specifier) return undefined;
  if (SERVER_MODULE_SPECIFIERS.has(specifier)) return '@kovojs/server';
  if (specifier === '@kovojs/drizzle') return '@kovojs/drizzle';
  if (specifier === '@kovojs/browser') return '@kovojs/browser';
  if (specifier === '@kovojs/core') return '@kovojs/core';
  if (specifier === 'drizzle-orm') return 'drizzle-orm';
  return undefined;
}

function legacyGlobalIdentity(
  identifier: Node,
  options: FrameworkIdentityOptions,
): CanonicalFrameworkExportIdentity | undefined {
  if (!Node.isIdentifier(identifier) || !options.legacyGlobals?.length) return undefined;
  const symbol = symbolForIdentifier(identifier);
  if (symbol && symbol.getDeclarations().length > 0) return undefined;
  if (identifierHasLocalBindingDeclaration(identifier)) return undefined;
  const name = identifier.getText();
  return options.legacyGlobals.find((identity) => identity.exportName === name);
}

function localBindingIdentityByName(
  identifier: Node,
  options: FrameworkIdentityOptions,
  seen: Set<string>,
  depth: number,
): CanonicalFrameworkExportIdentity | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const name = identifier.getText();
  const sourceFile = identifier.getSourceFile();

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const nameNode = declaration.getNameNode();
    if (Node.isIdentifier(nameNode) && nameNode.getText() === name) {
      const initializer = declaration.getInitializer();
      if (!initializer) return undefined;
      const identity = canonicalExpression(initializer, options, seen, depth + 1);
      if (identity) return identity;
    }
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const elementName = element.getNameNode();
        if (!Node.isIdentifier(elementName) || elementName.getText() !== name) continue;
        const identity = bindingElementIdentity(element, options, seen, depth + 1);
        if (identity) return identity;
      }
    }
  }

  return undefined;
}

function identifierHasLocalBindingDeclaration(identifier: Node): boolean {
  if (!Node.isIdentifier(identifier)) return false;
  const name = identifier.getText();
  const sourceFile = identifier.getSourceFile();

  if (
    sourceFile.getImportDeclarations().some((declaration) => {
      if (declaration.getDefaultImport()?.getText() === name) return true;
      if (declaration.getNamespaceImport()?.getText() === name) return true;
      return declaration
        .getNamedImports()
        .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === name);
    })
  ) {
    return true;
  }

  if (
    sourceFile.getFunctions().some((declaration) => declaration.getNameNode()?.getText() === name)
  ) {
    return true;
  }

  if (
    sourceFile.getClasses().some((declaration) => declaration.getNameNode()?.getText() === name)
  ) {
    return true;
  }

  if (
    sourceFile.getTypeAliases().some((declaration) => declaration.getNameNode().getText() === name)
  ) {
    return true;
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const nameNode = declaration.getNameNode();
    if (Node.isIdentifier(nameNode) && nameNode.getText() === name) return true;
    if (
      Node.isObjectBindingPattern(nameNode) &&
      nameNode.getElements().some((element) => {
        const elementName = element.getNameNode();
        return Node.isIdentifier(elementName) && elementName.getText() === name;
      })
    ) {
      return true;
    }
  }

  return false;
}

function frameworkExportEquals(
  left: CanonicalFrameworkExportIdentity | undefined,
  right: CanonicalFrameworkExportIdentity,
): boolean {
  return left?.module === right.module && left.exportName === right.exportName;
}

function safeAliasedSymbol(symbol: MorphSymbol): MorphSymbol | undefined {
  try {
    return symbol.getAliasedSymbol();
  } catch {
    return undefined;
  }
}

function symbolForIdentifier(identifier: Node): MorphSymbol | undefined {
  if (!Node.isIdentifier(identifier)) return identifier.getSymbol();
  const parent = identifier.getParent();
  if (parent && Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === identifier) {
    return parent.getObjectAssignmentInitializer()?.getSymbol() ?? identifier.getSymbol();
  }
  return identifier.getSymbol();
}

function symbolKey(symbol: MorphSymbol): string {
  const declarations = symbol
    .getDeclarations()
    .map((declaration) => `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`)
    .join('|');
  return `${symbol.getFullyQualifiedName()}:${declarations}`;
}

function declarationName(declaration: Node): string | undefined {
  if (Node.isImportSpecifier(declaration) || Node.isExportSpecifier(declaration)) {
    return declaration.getName();
  }
  if (Node.isVariableDeclaration(declaration)) return declaration.getName();
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isClassDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration)
  ) {
    return declaration.getName();
  }
  return undefined;
}

function localConstIdentifierInitializer(identifier: Node): Node | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const symbol = symbolForIdentifier(identifier);
  const declaration = symbol?.getDeclarations()?.[0];
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  if (!Node.isIdentifier(declaration.getNameNode())) return undefined;
  const declarationList = declaration.getParent();
  if (!Node.isVariableDeclarationList(declarationList)) return undefined;
  if ((declarationList.getDeclarationKind?.() ?? 'const') !== 'const') return undefined;
  return declaration.getInitializer();
}

function propertyNameText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isNumericLiteral(node)) return node.getText();
  return undefined;
}

function unwrappedExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}
