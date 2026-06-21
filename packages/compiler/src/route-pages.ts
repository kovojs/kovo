import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import * as ts from 'typescript';

import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type {
  CompileRouteModuleOptions,
  CompileRouteModuleResult,
  RoutePageComponentFact,
  RoutePageCssFact,
  RoutePageComponentPropFact,
  RoutePageFact,
  RoutePageLayoutFact,
  RouteNavigationSegmentFact,
} from './types.js';
import type { StaticLiteralValue } from './scan/object.js';
import { applySourceReplacements, replaceExtension, type SourceReplacement } from './shared.js';
import { compileArtifactFileNames } from './types.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

interface CompiledRoutePage {
  fact: RoutePageFact;
  pageReplacement: SourceReplacement;
}

interface RoutePageHandler {
  node: ts.Node;
  replacementEnd: number;
  replacementPrefix: string;
  replacementStart: number;
  sourceExpression: string;
}

interface RouteLayoutModel {
  localName: string;
  parent?: string;
  parentLength?: number;
  parentStart?: number;
  queries: readonly string[];
  start: number;
}

interface RouteComponentImportModel {
  exportName?: string;
  sourceFileName: string;
}

const navigationSegmentStampAttributes = new Set([
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
]);

/** Compile route-page JSX composition facts (SPEC.md §4.5/§9.1). */
export function compileRouteModule(options: CompileRouteModuleOptions): CompileRouteModuleResult {
  const sourceFile = ts.createSourceFile(
    options.fileName,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routePages: CompiledRoutePage[] = [];
  const layouts = routeLayoutModels(sourceFile);
  const componentImports = componentImportModels(options.fileName, sourceFile);
  const diagnostics: CompilerDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    const routePage = routePageFromCall(
      options.fileName,
      options.source,
      sourceFile,
      node,
      layouts,
      componentImports,
      diagnostics,
    );
    if (routePage) routePages.push(routePage);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  const routePageFacts = routePages.map((routePage) => routePage.fact);
  diagnostics.push(
    ...routeAuthoringSurfaceDiagnostics(options.fileName, options.source, sourceFile),
  );

  const artifactFileName = options.artifactFileName ?? routeArtifactFileName(options.fileName);

  return {
    diagnostics,
    files:
      routePages.length === 0
        ? []
        : [
            {
              fileName: artifactFileName,
              kind: 'route',
              source: emitCompiledRouteModule({
                artifactFileName,
                routePages,
                componentImportRewrites: options.componentImportRewrites ?? [],
                source: options.source,
                sourceFile,
              }),
            },
          ],
    routePageFacts,
  };
}

function routePageFromCall(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  layouts: ReadonlyMap<string, RouteLayoutModel>,
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
  diagnostics: CompilerDiagnostic[],
): CompiledRoutePage | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'route') return null;

  const [pathArg, definitionArg] = node.arguments;
  if (!pathArg || !ts.isStringLiteralLike(pathArg)) return null;
  if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) return null;

  const pageHandler = objectPageHandler(definitionArg, 'page', sourceFile);
  if (!pageHandler) return null;

  const components = routePageComponentFacts(
    fileName,
    source,
    sourceFile,
    pageHandler.node,
    componentImports,
    diagnostics,
  );
  if (components.length === 0 && !containsJsx(pageHandler.node)) return null;
  const routeLayouts = routeLayoutFacts(
    fileName,
    source,
    sourceFile,
    definitionArg,
    layouts,
    diagnostics,
  );
  const navigationSegments = routeNavigationSegments(pathArg.text, components, routeLayouts);
  const css = routePageCssFact(components, componentImports);
  const fact = {
    ...(css === undefined ? {} : { css }),
    components,
    fileName,
    ...(routeLayouts.length > 0 ? { layouts: routeLayouts } : {}),
    navigationSegments,
    route: pathArg.text,
  };

  return {
    fact,
    pageReplacement: {
      end: pageHandler.replacementEnd,
      replacement: `${pageHandler.replacementPrefix}__kovoDefineCompiledRoutePage(${JSON.stringify(fact)}, ${pageHandler.sourceExpression})`,
      start: pageHandler.replacementStart,
    },
  };
}

function routePageCssFact(
  components: readonly RoutePageComponentFact[],
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
): RoutePageCssFact | undefined {
  const sourceFileNames = uniqueSorted(
    components.flatMap((component) => {
      const componentImport = componentImports.get(component.localName);
      return componentImport ? [compileArtifactFileNames(componentImport.sourceFileName).css] : [];
    }),
  );

  return sourceFileNames.length === 0 ? undefined : { sourceFileNames };
}

function routeNavigationSegments(
  routePath: string,
  components: readonly RoutePageComponentFact[],
  layouts: readonly RoutePageLayoutFact[],
): RouteNavigationSegmentFact[] {
  return [
    ...layouts.map((layout) => ({
      id: `layout:${layout.localName}`,
      kind: 'layout' as const,
      localName: layout.localName,
      queries: layout.queries,
    })),
    {
      components: components.map((component) => component.localName),
      id: `page:${routePath}`,
      kind: 'page' as const,
      localName: 'page',
    },
  ];
}

function componentImportModels(
  routeFileName: string,
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, RouteComponentImportModel> {
  const imports = new Map<string, RouteComponentImportModel>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const sourceFileName = componentImportSourceFileName(
      routeFileName,
      statement.moduleSpecifier.text,
    );
    if (!sourceFileName) continue;

    const importClause = statement.importClause;
    if (!importClause) continue;
    if (importClause.name) imports.set(importClause.name.text, { sourceFileName });
    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      const exportName = element.propertyName?.text;
      imports.set(element.name.text, {
        ...(exportName && exportName !== element.name.text ? { exportName } : {}),
        sourceFileName,
      });
    }
  }

  return imports;
}

function componentImportSourceFileName(routeFileName: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;

  const absolute = resolve(dirname(routeFileName), specifier);
  return normalizeRouteFileName(sourceSpecifierToTsx(absolute));
}

function sourceSpecifierToTsx(fileName: string): string {
  if (fileName.endsWith('.jsx')) return replaceExtension(fileName, '.tsx');
  if (fileName.endsWith('.js')) return replaceExtension(fileName, '.tsx');
  return fileName;
}

function normalizeRouteFileName(fileName: string): string {
  return relative('', fileName).replaceAll('\\', '/');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function routeLayoutModels(sourceFile: ts.SourceFile): ReadonlyMap<string, RouteLayoutModel> {
  const layouts = new Map<string, RouteLayoutModel>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'layout'
    ) {
      const [definition] = node.initializer.arguments;
      if (definition && ts.isObjectLiteralExpression(definition)) {
        const parent = layoutParentName(definition);
        layouts.set(node.name.text, {
          localName: node.name.text,
          ...(parent === null
            ? {}
            : { parent: parent.name, parentLength: parent.length, parentStart: parent.start }),
          queries: layoutQueryNames(definition),
          start: node.name.getStart(sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return layouts;
}

function routeLayoutFacts(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  routeDefinition: ts.ObjectLiteralExpression,
  layouts: ReadonlyMap<string, RouteLayoutModel>,
  diagnostics: CompilerDiagnostic[],
): RoutePageLayoutFact[] {
  const layoutName = routeLayoutName(routeDefinition, sourceFile);
  if (!layoutName) return [];

  const chain: RoutePageLayoutFact[] = [];
  const seen = new Set<string>();
  let current: { length: number; name: string; start: number } | undefined = layoutName;

  while (current) {
    if (seen.has(current.name)) {
      diagnostics.push(
        layoutChainDiagnostic(
          fileName,
          source,
          current.start,
          current.length,
          `Cyclic layout parent chain at '${current.name}'.`,
        ),
      );
      return [];
    }
    seen.add(current.name);
    const layoutModel = layouts.get(current.name);
    if (!layoutModel) {
      diagnostics.push(
        layoutChainDiagnostic(
          fileName,
          source,
          current.start,
          current.length,
          `Route layout '${current.name}' does not resolve to a local layout() declaration.`,
        ),
      );
      return [];
    }
    chain.unshift({ localName: layoutModel.localName, queries: layoutModel.queries });
    current =
      layoutModel.parent === undefined
        ? undefined
        : {
            length: layoutModel.parentLength ?? layoutModel.parent.length,
            name: layoutModel.parent,
            start: layoutModel.parentStart ?? layoutModel.start,
          };
  }

  return chain;
}

function routeLayoutName(
  routeDefinition: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): { length: number; name: string; start: number } | null {
  const value = objectPropertyInitializer(routeDefinition, 'layout');
  return value && ts.isIdentifier(value)
    ? { length: value.getWidth(sourceFile), name: value.text, start: value.getStart(sourceFile) }
    : null;
}

function layoutParentName(
  layoutDefinition: ts.ObjectLiteralExpression,
): { length: number; name: string; start: number } | null {
  const value = objectPropertyInitializer(layoutDefinition, 'parent');
  return value && ts.isIdentifier(value)
    ? { length: value.getWidth(), name: value.text, start: value.getStart() }
    : null;
}

function layoutChainDiagnostic(
  fileName: string,
  source: string,
  start: number,
  length: number,
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'KV303', source, start, length),
    help: [
      diagnosticDefinitions.KV303.help,
      'Route layouts must be statically reconstructible from local layout() declarations so layout queries, boundaries, and navigation segment metadata can be derived.',
    ].join('\n'),
    message: `${diagnosticDefinitions.KV303.message} ${detail}`,
  };
}

function layoutQueryNames(layoutDefinition: ts.ObjectLiteralExpression): string[] {
  const value = objectPropertyInitializer(layoutDefinition, 'queries');
  if (!value || !ts.isObjectLiteralExpression(value)) return [];
  return value.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];
    const name = propertyNameText(property.name);
    return name ? [name] : [];
  });
}

function objectPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === name) {
      return property.initializer;
    }
  }
  return null;
}

function objectPageHandler(
  object: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): RoutePageHandler | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === name) {
      const start = property.initializer.getStart(sourceFile);
      return {
        node: property.initializer,
        replacementEnd: property.initializer.getEnd(),
        replacementPrefix: '',
        replacementStart: start,
        sourceExpression: sourceFile.text.slice(start, property.initializer.getEnd()),
      };
    }

    if (ts.isMethodDeclaration(property) && propertyNameText(property.name) === name) {
      return {
        node: property,
        replacementEnd: property.getEnd(),
        replacementPrefix: `${name}: `,
        replacementStart: property.getStart(sourceFile),
        sourceExpression: methodDeclarationFunctionExpression(property, sourceFile),
      };
    }
  }
  return null;
}

function methodDeclarationFunctionExpression(
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
): string {
  const asyncKeyword = method.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
  )
    ? 'async '
    : '';
  const typeParameters =
    method.typeParameters && method.typeParameters.length > 0
      ? `<${method.typeParameters.map((parameter) => parameter.getText(sourceFile)).join(', ')}>`
      : '';
  const parameters = method.parameters.map((parameter) => parameter.getText(sourceFile)).join(', ');
  const returnType = method.type ? `: ${method.type.getText(sourceFile)}` : '';
  const body = method.body?.getText(sourceFile) ?? '{}';
  return `${asyncKeyword}function ${propertyNameText(method.name) ?? 'page'}${typeParameters}(${parameters})${returnType} ${body}`;
}

function containsJsx(root: ts.Node): boolean {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(root);
  return found;
}

function routePageComponentFacts(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  root: ts.Node,
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
  diagnostics: CompilerDiagnostic[],
): RoutePageComponentFact[] {
  const facts: RoutePageComponentFact[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const tag = jsxTagName(node.openingElement.tagName);
      if (tag && componentTagName(tag)) {
        diagnostics.push(
          ...routePageComponentSpreadDiagnostics(
            fileName,
            source,
            sourceFile,
            tag,
            node.openingElement.attributes,
          ),
        );
        facts.push(
          routePageComponentFact(sourceFile, tag, node.openingElement.attributes, componentImports),
        );
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTagName(node.tagName);
      if (tag && componentTagName(tag)) {
        diagnostics.push(
          ...routePageComponentSpreadDiagnostics(
            fileName,
            source,
            sourceFile,
            tag,
            node.attributes,
          ),
        );
        facts.push(routePageComponentFact(sourceFile, tag, node.attributes, componentImports));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  return facts;
}

function routePageComponentSpreadDiagnostics(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  localName: string,
  attributes: ts.JsxAttributes,
): CompilerDiagnostic[] {
  return attributes.properties.filter(ts.isJsxSpreadAttribute).map((attribute) => ({
    ...diagnosticFor(
      fileName,
      'KV303',
      source,
      attribute.getStart(sourceFile),
      attribute.getWidth(sourceFile),
    ),
    help: [
      diagnosticDefinitions.KV303.help,
      'Route component props must be statically reconstructible so route query, live target, and navigation segment metadata can be derived.',
      'Fix: pass named props directly, for example `<QuestionDetail questionId={params.id} />`, instead of spreading an object.',
    ].join('\n'),
    message: `${diagnosticDefinitions.KV303.message} Route component '${localName}' uses spread props that cannot be represented in generated route metadata.`,
  }));
}

function routePageComponentFact(
  sourceFile: ts.SourceFile,
  localName: string,
  attributes: ts.JsxAttributes,
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
): RoutePageComponentFact {
  const allProps = routePageComponentProps(sourceFile, attributes);
  const key = allProps.find((prop) => prop.name === 'key');
  const props = allProps.filter((prop) => prop.name !== 'key');
  const propsExpression = routePagePropsExpression(props);
  const exportName = componentImports.get(localName)?.exportName;

  return {
    ...(exportName ? { exportName } : {}),
    ...(key ? { keyExpression: key.expression } : {}),
    localName,
    props,
    propsExpression,
    serializedPropsExpression: `JSON.stringify(${propsExpression})`,
  };
}

function routePageComponentProps(
  sourceFile: ts.SourceFile,
  attributes: ts.JsxAttributes,
): RoutePageComponentPropFact[] {
  return attributes.properties.flatMap((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return [];
    if (!ts.isIdentifier(attribute.name)) return [];
    const name = attribute.name.text;

    if (attribute.initializer === undefined) {
      return [{ expression: 'true', name, staticValue: true }];
    }

    if (ts.isStringLiteral(attribute.initializer)) {
      return [
        {
          expression: attribute.initializer.getText(sourceFile),
          name,
          staticValue: attribute.initializer.text,
        },
      ];
    }

    if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return [];

    const expression = attribute.initializer.expression;
    const staticValue = staticLiteralValue(expression);
    const propertyAccesses = propertyAccessPaths(expression);
    return [
      {
        expression: expression.getText(sourceFile),
        name,
        ...(propertyAccesses.length > 0 ? { propertyAccesses } : {}),
        ...(staticValue === undefined ? {} : { staticValue }),
      },
    ];
  });
}

function routePagePropsExpression(props: readonly RoutePageComponentPropFact[]): string {
  if (props.length === 0) return '{}';
  return `{ ${props.map((prop) => `${prop.name}: ${prop.expression}`).join(', ')} }`;
}

function componentTagName(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

function jsxTagName(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.getText();
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
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

function staticLiteralValue(expression: ts.Expression): StaticLiteralValue | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
  if (ts.isPrefixUnaryExpression(unwrapped) && ts.isNumericLiteral(unwrapped.operand)) {
    if (unwrapped.operator === ts.SyntaxKind.MinusToken) return -Number(unwrapped.operand.text);
    if (unwrapped.operator === ts.SyntaxKind.PlusToken) return Number(unwrapped.operand.text);
  }
  return undefined;
}

function propertyAccessPaths(expression: ts.Expression): string[] {
  const paths: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const path = propertyAccessPath(node);
      if (path) paths.push(path);
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return [...new Set(paths)];
}

function propertyAccessPath(expression: ts.PropertyAccessExpression): string | null {
  const receiver = propertyAccessReceiverSegments(expression.expression);
  if (!receiver) return null;
  return [...receiver, expression.name.text].join('.');
}

function propertyAccessReceiverSegments(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const path = propertyAccessPath(expression);
  return path ? path.split('.') : null;
}

function emitCompiledRouteModule(options: {
  artifactFileName: string;
  componentImportRewrites: readonly { localName: string; specifier: string }[];
  routePages: readonly CompiledRoutePage[];
  source: string;
  sourceFile: ts.SourceFile;
}): string {
  const replacements: SourceReplacement[] = options.routePages.map(
    (routePage) => routePage.pageReplacement,
  );
  const lowered = applySourceReplacements(options.source, [
    ...routeImportReplacements(
      options.sourceFile,
      options.artifactFileName,
      options.componentImportRewrites,
    ),
    ...replacements,
  ]);
  const importSource =
    "import { defineCompiledRoutePage as __kovoDefineCompiledRoutePage } from '@kovojs/server/internal/route';\n";
  const insertAt = routeModuleImportInsertionIndex(lowered);

  return [
    `// @kovojs-ir - lowered route module generated by @kovojs/compiler (SPEC.md section 4.5). Do not edit.\n`,
    lowered.slice(0, insertAt),
    importSource,
    lowered.slice(insertAt),
  ].join('');
}

function routeModuleImportInsertionIndex(source: string): number {
  const shebang = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0;
  const leading = source.slice(shebang);
  const jsxImportSource = leading.match(/^\/\*\*?\s*@jsxImportSource[\s\S]*?\*\/\s*/);
  if (jsxImportSource) return shebang + jsxImportSource[0].length;
  return shebang;
}

function routeAuthoringSurfaceDiagnostics(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      appLocalGeneratedImport(node.moduleSpecifier.text)
    ) {
      diagnostics.push({
        ...diagnosticFor(
          fileName,
          'KV235',
          source,
          node.moduleSpecifier.getStart(sourceFile),
          node.moduleSpecifier.getWidth(sourceFile),
        ),
        help: [
          diagnosticDefinitions.KV235.help,
          'Route/layout source should import the authored component, for example `../components/question-list.js`; the route compiler rewrites the generated route artifact to the lowered component module.',
        ].join('\n'),
        message: `${diagnosticDefinitions.KV235.message} app-local generated component import ${node.moduleSpecifier.getText(sourceFile)} in route/layout source.`,
      });
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      navigationSegmentStampAttributes.has(node.name.text)
    ) {
      diagnostics.push({
        ...diagnosticFor(
          fileName,
          'KV235',
          source,
          node.name.getStart(sourceFile),
          node.name.getWidth(sourceFile),
        ),
        help: [
          diagnosticDefinitions.KV235.help,
          'Navigation segment stamps are compiler-derived from route(), layout(), and the target document used by enhanced navigation.',
          'Fix: remove the kovo-nav-* attribute and keep the route/layout/component source as authored JSX.',
          'SPEC §8 makes enhanced navigation loader-owned; app TSX does not author segment stamps or persistence policy.',
        ].join('\n'),
        message: `${diagnosticDefinitions.KV235.message} hand-authored navigation segment stamp ${node.name.text}.`,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}

function appLocalGeneratedImport(specifier: string): boolean {
  return /^\.{1,2}\/(?:.*\/)?generated\//.test(specifier);
}

function routeArtifactFileName(fileName: string): string {
  return replaceExtension(fileName, '.kovo-route.tsx');
}

function routeImportReplacements(
  sourceFile: ts.SourceFile,
  artifactFileName: string,
  componentImportRewrites: readonly { localName: string; specifier: string }[],
): SourceReplacement[] {
  const replacements: SourceReplacement[] = [];
  const rewriteByLocalName = new Map(
    componentImportRewrites.map((rewrite) => [rewrite.localName, rewrite.specifier]),
  );

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const rewritten = ts.isImportDeclaration(node)
        ? componentImportRewriteSpecifier(node, rewriteByLocalName)
        : null;
      const rebased =
        rewritten ?? rebaseRelativeSpecifier(specifier, sourceFile.fileName, artifactFileName);
      if (rebased && rebased !== specifier) {
        replacements.push({
          end: node.moduleSpecifier.getEnd(),
          replacement: JSON.stringify(rebased),
          start: node.moduleSpecifier.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return replacements;
}

function componentImportRewriteSpecifier(
  node: ts.ImportDeclaration,
  rewriteByLocalName: ReadonlyMap<string, string>,
): string | null {
  const namedBindings = node.importClause?.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return null;

  const matches = namedBindings.elements.flatMap((element) => {
    const localName = element.name.text;
    const specifier = rewriteByLocalName.get(localName);
    return specifier ? [specifier] : [];
  });
  const unique = [...new Set(matches)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

function rebaseRelativeSpecifier(
  specifier: string,
  sourceFileName: string,
  artifactFileName: string,
): string | null {
  if (!specifier.startsWith('.')) return null;

  const absoluteTarget = resolve(dirname(sourceFileName), specifier);
  const relativeTarget = normalizePath(relative(dirname(artifactFileName), absoluteTarget));
  return relativeTarget.startsWith('.') ? relativeTarget : `./${relativeTarget}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
