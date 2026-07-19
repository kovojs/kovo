import { dirname, relative, resolve } from 'node:path';
import * as ts from 'typescript';

import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import type { AccessDecisionFact } from '@kovojs/core/internal/graph';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import type {
  CompileRouteModuleOptions,
  CompileRouteModuleResult,
  RoutePageComponentFact,
  RoutePageCssFact,
  RoutePageComponentPropFact,
  RoutePageFact,
  RoutePageLayoutFact,
  RoutePageOutcomeFact,
  RouteRegionFact,
  RouteNavigationSegmentFact,
} from '../types.js';
import { propertyAccessPath, propertyNameText, unwrapExpression } from './ast.js';
import { accessGuardExclusivityDiagnostics } from './access-guard-exclusivity.js';
import type { StaticLiteralValue } from './object.js';
import { scanServerScopedKeySinkViolations } from './security-operation-ir.js';
import {
  applySourceReplacements,
  replaceExtension,
  uniqueSorted,
  type SourceReplacement,
} from '../shared.js';
import { ensureTypescriptRuntime } from '../ts-api.js';
import { compileArtifactFileNames } from '../types.js';
import { isCompilerAuditText } from '../security/audit-text.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerJsonStringify,
  compilerMapGet,
  compilerMapSet,
  compilerNumberValue,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotJsonValue,
  compilerStringEndsWith,
  compilerStringIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';

ensureTypescriptRuntime(ts);

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
  access?: AccessDecisionFact;
  guard?: string;
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

interface RouteFrameworkBindings {
  readonly rootedFileHandleNames: ReadonlySet<string>;
  readonly sourceFile: ts.SourceFile;
}

const LAYOUT_IDENTITY = frameworkExport('@kovojs/server', 'layout');
const GUARD_IDENTITY = frameworkExport('@kovojs/server', 'guard');
const PUBLIC_ACCESS_IDENTITY = frameworkExport('@kovojs/server', 'publicAccess');
const RESPOND_IDENTITY = frameworkExport('@kovojs/server', 'respond');
const ROOTED_FILES_IDENTITY = frameworkExport('@kovojs/server', 'rootedFiles');
const ROUTE_IDENTITY = frameworkExport('@kovojs/server', 'route');
const VERIFIED_ACCESS_IDENTITY = frameworkExport('@kovojs/server', 'verifiedAccess');

const navigationSegmentStampAttributes = new Set([
  'kovo-nav-components',
  'kovo-nav-kind',
  'kovo-nav-name',
  'kovo-nav-queries',
  'kovo-nav-segment',
]);

/** Compile route-page JSX composition facts (SPEC.md §4.5/§9.1). */
export function compileRouteModule(options: CompileRouteModuleOptions): CompileRouteModuleResult {
  const stableOptions = compilerSnapshotJsonValue(options, 'Compiler route module options');
  const sourceFile = ts.createSourceFile(
    stableOptions.fileName,
    stableOptions.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routePages: CompiledRoutePage[] = [];
  const frameworkBindings = routeFrameworkBindings(sourceFile);
  const layouts = routeLayoutModels(sourceFile, frameworkBindings);
  const componentImports = componentImportModels(stableOptions.fileName, sourceFile);
  const diagnostics: CompilerDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    const routePage = routePageFromCall(
      stableOptions.fileName,
      stableOptions.source,
      sourceFile,
      node,
      layouts,
      frameworkBindings,
      componentImports,
      diagnostics,
    );
    if (routePage) compilerArrayAppend(routePages, routePage, 'Compiler route pages');
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  const stableRoutePages = compilerSnapshotJsonValue(routePages, 'Compiler route-page facts');
  const routePageFacts: RoutePageFact[] = [];
  const routePageCount = compilerArrayLength(stableRoutePages, 'Compiler route-page facts');
  for (let index = 0; index < routePageCount; index += 1) {
    const routePage = compilerOwnDataValue(
      stableRoutePages,
      index,
      'Compiler route-page facts',
    ) as CompiledRoutePage;
    compilerArrayAppend(routePageFacts, routePage.fact, 'Compiler route-page output facts');
  }
  appendRouteValues(
    diagnostics,
    routeAuthoringSurfaceDiagnostics(stableOptions.fileName, stableOptions.source, sourceFile),
    'Compiler route diagnostics',
  );
  appendRouteValues(
    diagnostics,
    accessGuardExclusivityDiagnostics(stableOptions.fileName, stableOptions.source, sourceFile),
    'Compiler access/guard exclusivity diagnostics',
  );

  const artifactFileName =
    stableOptions.artifactFileName ?? routeArtifactFileName(stableOptions.fileName);

  return compilerSnapshotJsonValue(
    {
      diagnostics,
      files:
        routePageCount === 0
          ? []
          : [
              {
                fileName: artifactFileName,
                kind: 'route',
                source: emitCompiledRouteModule({
                  artifactFileName,
                  routePages: stableRoutePages,
                  componentImportRewrites: stableOptions.componentImportRewrites ?? [],
                  source: stableOptions.source,
                  sourceFile,
                }),
              },
            ],
      routePageFacts,
    },
    'Compiler route module result',
  );
}

function routePageFromCall(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  layouts: ReadonlyMap<string, RouteLayoutModel>,
  frameworkBindings: RouteFrameworkBindings,
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
  diagnostics: CompilerDiagnostic[],
): CompiledRoutePage | null {
  if (!ts.isCallExpression(node)) return null;
  if (!isFrameworkRouteCall(node, frameworkBindings)) return null;

  const pathArg = compilerOwnDataValue(node.arguments, 0, 'Compiler route call arguments') as
    | ts.Expression
    | undefined;
  const definitionArg = compilerOwnDataValue(node.arguments, 1, 'Compiler route call arguments') as
    | ts.Expression
    | undefined;
  if (!pathArg || !ts.isStringLiteralLike(pathArg)) return null;
  if (!definitionArg || !ts.isObjectLiteralExpression(definitionArg)) return null;

  const pageHandler = objectPageHandler(definitionArg, 'page', sourceFile);
  const regions = routeRegionFacts(
    fileName,
    source,
    sourceFile,
    definitionArg,
    componentImports,
    diagnostics,
  );
  if (!pageHandler && compilerArrayLength(regions, 'Compiler route regions') === 0) return null;
  if (pageHandler) {
    appendRouteScopedKeyDiagnostics(fileName, source, sourceFile, pageHandler, diagnostics);
  }

  const pageComponents = pageHandler
    ? routePageComponentFacts(
        fileName,
        source,
        sourceFile,
        pageHandler.node,
        componentImports,
        diagnostics,
      )
    : [];
  const outcome = routeOutcomeFact(pageHandler?.node, frameworkBindings);
  if (
    pageHandler &&
    compilerArrayLength(pageComponents, 'Compiler route page components') === 0 &&
    compilerArrayLength(regions, 'Compiler route regions') === 0 &&
    !containsJsx(pageHandler.node) &&
    outcome === undefined
  )
    return null;
  const componentCandidates: RoutePageComponentFact[] = [];
  appendRouteValues(componentCandidates, pageComponents, 'Compiler route component candidates');
  const regionCount = compilerArrayLength(regions, 'Compiler route regions');
  for (let index = 0; index < regionCount; index += 1) {
    const region = compilerOwnDataValue(
      regions,
      index,
      'Compiler route regions',
    ) as RouteRegionFact;
    appendRouteValues(
      componentCandidates,
      region.components,
      'Compiler route component candidates',
    );
  }
  const components = uniqueRouteComponents(componentCandidates);
  const routeLayouts = routeLayoutFacts(
    fileName,
    source,
    sourceFile,
    definitionArg,
    layouts,
    diagnostics,
  );
  const navigationSegments = routeNavigationSegments(
    pathArg.text,
    pageComponents,
    routeLayouts,
    regions,
  );
  const css = routePageCssFact(components, componentImports);
  const access = routeAccessFact(definitionArg, routeLayouts, layouts, sourceFile);
  const guards = routeGuardFacts(definitionArg, routeLayouts, layouts, sourceFile);
  const fact: RoutePageFact = {
    ...(access === undefined ? {} : { access }),
    ...(css === undefined ? {} : { css }),
    components,
    fileName,
    ...(compilerArrayLength(guards, 'Compiler route guards') === 0 ? {} : { guards }),
    ...(compilerArrayLength(routeLayouts, 'Compiler route layouts') > 0
      ? { layouts: routeLayouts }
      : {}),
    navigationSegments,
    ...(outcome === undefined ? {} : { outcome }),
    ...(regionCount > 0 ? { regions } : {}),
    route: pathArg.text,
  };

  return {
    fact,
    pageReplacement: {
      end: pageHandler?.replacementEnd ?? definitionArg.properties.pos,
      replacement: pageHandler
        ? `${pageHandler.replacementPrefix}__kovoDefineCompiledRoutePage(${jsonRouteValue(fact)}, ${pageHandler.sourceExpression})`
        : `page: __kovoDefineCompiledRoutePage(${jsonRouteValue(fact)}, () => null),\n`,
      start: pageHandler?.replacementStart ?? definitionArg.properties.pos,
    },
  };
}

function appendRouteScopedKeyDiagnostics(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  handler: RoutePageHandler,
  diagnostics: CompilerDiagnostic[],
): void {
  if (ts.isMethodDeclaration(handler.node)) {
    if (!handler.node.body) return;
    appendRouteScopedKeyViolationDiagnostics(
      fileName,
      source,
      sourceFile,
      handler.node.body,
      handler.node.parameters,
      diagnostics,
    );
    return;
  }
  const callable = unwrapExpression(handler.node as ts.Expression);
  if (!ts.isArrowFunction(callable) && !ts.isFunctionExpression(callable)) return;
  appendRouteScopedKeyViolationDiagnostics(
    fileName,
    source,
    sourceFile,
    callable.body,
    callable.parameters,
    diagnostics,
  );
}

function appendRouteScopedKeyViolationDiagnostics(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
  diagnostics: CompilerDiagnostic[],
): void {
  const violations = scanServerScopedKeySinkViolations(sourceFile, body, parameters);
  const snapshot = compilerSnapshotJsonValue(violations, 'Compiler route scoped-key violations');
  for (let index = 0; index < snapshot.length; index += 1) {
    const violation = snapshot[index]!;
    const measuredLength = violation.span.end - violation.span.start;
    compilerArrayAppend(
      diagnostics,
      {
        ...diagnosticFor(
          fileName,
          'KV450',
          source,
          violation.span.start,
          measuredLength > 0 ? measuredLength : 1,
        ),
        message: `${diagnosticDefinitions.KV450.message} ${violation.detail}.`,
      },
      'Compiler route scoped-key diagnostics',
    );
  }
}

function uniqueRouteComponents(
  components: readonly RoutePageComponentFact[],
): RoutePageComponentFact[] {
  const seen = compilerCreateSet<string>();
  const facts: RoutePageComponentFact[] = [];
  const componentCount = compilerArrayLength(components, 'Compiler route components');
  for (let index = 0; index < componentCount; index += 1) {
    const component = compilerOwnDataValue(
      components,
      index,
      'Compiler route components',
    ) as RoutePageComponentFact;
    const key = compilerArrayJoin(
      [
        component.localName,
        component.keyExpression ?? '',
        component.propsExpression,
        component.serializedPropsExpression,
      ],
      '\0',
    );
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(facts, component, 'Compiler unique route components');
  }
  return facts;
}

function routePageCssFact(
  components: readonly RoutePageComponentFact[],
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
): RoutePageCssFact | undefined {
  const candidates: string[] = [];
  const componentCount = compilerArrayLength(components, 'Compiler route CSS components');
  for (let index = 0; index < componentCount; index += 1) {
    const component = compilerOwnDataValue(
      components,
      index,
      'Compiler route CSS components',
    ) as RoutePageComponentFact;
    const componentImport = compilerMapGet(componentImports, component.localName);
    if (componentImport) {
      compilerArrayAppend(
        candidates,
        compileArtifactFileNames(componentImport.sourceFileName).css,
        'Compiler route CSS source files',
      );
    }
  }
  const sourceFileNames = uniqueSorted(candidates);

  return compilerArrayLength(sourceFileNames, 'Compiler route CSS source files') === 0
    ? undefined
    : { sourceFileNames };
}

function routeNavigationSegments(
  routePath: string,
  pageComponents: readonly RoutePageComponentFact[],
  layouts: readonly RoutePageLayoutFact[],
  regions: readonly RouteRegionFact[] = [],
): RouteNavigationSegmentFact[] {
  const segments: RouteNavigationSegmentFact[] = [];
  const layoutCount = compilerArrayLength(layouts, 'Compiler navigation layouts');
  for (let index = 0; index < layoutCount; index += 1) {
    const layout = compilerOwnDataValue(
      layouts,
      index,
      'Compiler navigation layouts',
    ) as RoutePageLayoutFact;
    compilerArrayAppend(
      segments,
      {
        id: `layout:${layout.localName}`,
        kind: 'layout' as const,
        localName: layout.localName,
        queries: layout.queries,
      },
      'Compiler navigation segments',
    );
  }
  const regionCount = compilerArrayLength(regions, 'Compiler navigation regions');
  if (regionCount > 0) {
    for (let index = 0; index < regionCount; index += 1) {
      const region = compilerOwnDataValue(
        regions,
        index,
        'Compiler navigation regions',
      ) as RouteRegionFact;
      compilerArrayAppend(
        segments,
        {
          components: routeComponentLocalNames(region.components),
          id: region.name === 'page' ? `page:${routePath}` : `region:${region.name}`,
          kind: region.name === 'page' ? ('page' as const) : ('region' as const),
          localName: region.name,
        },
        'Compiler navigation segments',
      );
    }
  } else {
    compilerArrayAppend(
      segments,
      {
        components: routeComponentLocalNames(pageComponents),
        id: `page:${routePath}`,
        kind: 'page' as const,
        localName: 'page',
      },
      'Compiler navigation segments',
    );
  }
  return segments;
}

function routeComponentLocalNames(components: readonly RoutePageComponentFact[]): string[] {
  const names: string[] = [];
  const count = compilerArrayLength(components, 'Compiler navigation components');
  for (let index = 0; index < count; index += 1) {
    const component = compilerOwnDataValue(
      components,
      index,
      'Compiler navigation components',
    ) as RoutePageComponentFact;
    compilerArrayAppend(names, component.localName, 'Compiler navigation component names');
  }
  return names;
}

function routeRegionFacts(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  routeDefinition: ts.ObjectLiteralExpression,
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
  diagnostics: CompilerDiagnostic[],
): RouteRegionFact[] {
  const regions = objectPropertyInitializer(routeDefinition, 'regions');
  if (!regions || !ts.isObjectLiteralExpression(regions)) return [];

  const facts: RouteRegionFact[] = [];
  const propertyCount = compilerArrayLength(regions.properties, 'Compiler route region properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      regions.properties,
      index,
      'Compiler route region properties',
    ) as ts.ObjectLiteralElementLike;
    if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) continue;
    const name = propertyNameText(property.name);
    if (!name) continue;
    const node = ts.isPropertyAssignment(property) ? property.initializer : property;
    compilerArrayAppend(
      facts,
      {
        components: routePageComponentFacts(
          fileName,
          source,
          sourceFile,
          node,
          componentImports,
          diagnostics,
        ),
        name,
      },
      'Compiler route region facts',
    );
  }
  return facts;
}

function componentImportModels(
  routeFileName: string,
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, RouteComponentImportModel> {
  const imports = compilerCreateMap<string, RouteComponentImportModel>();

  const statementCount = compilerArrayLength(sourceFile.statements, 'Compiler route statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Compiler route statements',
    ) as ts.Statement;
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const sourceFileName = componentImportSourceFileName(
      routeFileName,
      statement.moduleSpecifier.text,
    );
    if (!sourceFileName) continue;

    const importClause = statement.importClause;
    if (!importClause) continue;
    if (importClause.name) compilerMapSet(imports, importClause.name.text, { sourceFileName });
    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const elementCount = compilerArrayLength(namedBindings.elements, 'Compiler route imports');
    for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
      const element = compilerOwnDataValue(
        namedBindings.elements,
        elementIndex,
        'Compiler route imports',
      ) as ts.ImportSpecifier;
      const exportName = element.propertyName?.text;
      compilerMapSet(imports, element.name.text, {
        ...(exportName && exportName !== element.name.text ? { exportName } : {}),
        sourceFileName,
      });
    }
  }

  return imports;
}

function componentImportSourceFileName(routeFileName: string, specifier: string): string | null {
  if (!compilerStringStartsWith(specifier, '.')) return null;

  const absolute = resolve(dirname(routeFileName), specifier);
  return normalizeRouteFileName(sourceSpecifierToTsx(absolute));
}

function sourceSpecifierToTsx(fileName: string): string {
  if (compilerStringEndsWith(fileName, '.jsx')) return replaceExtension(fileName, '.tsx');
  if (compilerStringEndsWith(fileName, '.js')) return replaceExtension(fileName, '.tsx');
  return fileName;
}

function normalizeRouteFileName(fileName: string): string {
  return compilerStringReplaceAll(relative('', fileName), '\\', '/');
}

function routeLayoutModels(
  sourceFile: ts.SourceFile,
  frameworkBindings: RouteFrameworkBindings,
): ReadonlyMap<string, RouteLayoutModel> {
  const layouts = compilerCreateMap<string, RouteLayoutModel>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isFrameworkLayoutCall(node.initializer, frameworkBindings)
    ) {
      const definition = compilerOwnDataValue(
        node.initializer.arguments,
        0,
        'Compiler layout call arguments',
      ) as ts.Expression | undefined;
      if (definition && ts.isObjectLiteralExpression(definition)) {
        const parent = layoutParentName(definition);
        const access = accessDecisionFact(definition, sourceFile);
        const guard = namedInitializer(definition, 'guard', sourceFile)?.name;
        compilerMapSet(layouts, node.name.text, {
          ...(access === undefined ? {} : { access }),
          ...(guard === undefined ? {} : { guard }),
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

function routeFrameworkBindings(sourceFile: ts.SourceFile): RouteFrameworkBindings {
  const rootedFileHandleNames = compilerCreateSet<string>();
  const bindings = { rootedFileHandleNames, sourceFile };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isCallExpression(initializer) && isFrameworkRootedFilesCall(initializer, bindings)) {
        compilerSetAdd(rootedFileHandleNames, node.name.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return bindings;
}

function isFrameworkRouteCall(call: ts.CallExpression, bindings: RouteFrameworkBindings): boolean {
  return isFrameworkExpression(bindings, call.expression, ROUTE_IDENTITY);
}

function isFrameworkLayoutCall(call: ts.CallExpression, bindings: RouteFrameworkBindings): boolean {
  return isFrameworkExpression(bindings, call.expression, LAYOUT_IDENTITY);
}

function isFrameworkExpression(
  bindings: RouteFrameworkBindings,
  expression: ts.Expression,
  identity: FrameworkExportIdentity,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    bindings.sourceFile,
    expression,
    identity,
  );
}

function routeOutcomeFact(
  pageHandler: ts.Node | undefined,
  frameworkBindings: RouteFrameworkBindings,
): RoutePageOutcomeFact | undefined {
  if (!pageHandler) return undefined;

  let outcome: RoutePageOutcomeFact['kind'] | undefined;
  const visit = (node: ts.Node): void => {
    if (outcome === 'stream') return;
    if (ts.isCallExpression(node)) {
      const kind = routeOutcomeKindFromCall(node, frameworkBindings);
      if (kind === 'stream') {
        outcome = 'stream';
        return;
      }
      if (kind === 'file' && outcome === undefined) outcome = 'file';
    }
    ts.forEachChild(node, visit);
  };

  visit(pageHandler);
  return outcome === undefined ? undefined : { kind: outcome };
}

function routeOutcomeKindFromCall(
  call: ts.CallExpression,
  frameworkBindings: RouteFrameworkBindings,
): RoutePageOutcomeFact['kind'] | undefined {
  const expression = call.expression;
  if (!ts.isPropertyAccessExpression(expression)) return undefined;

  // `.file` / `.stream` are structural members on the framework-proven `respond` export.
  if (
    (expression.name.text === 'file' || expression.name.text === 'stream') &&
    isFrameworkRespondReference(unwrapExpression(expression.expression), frameworkBindings)
  ) {
    return expression.name.text;
  }

  // `.serve` is structural route outcome metadata once the receiver is a rootedFiles handle.
  if (
    expression.name.text === 'serve' &&
    isRootedFilesServeReceiver(expression.expression, frameworkBindings)
  ) {
    return 'stream';
  }

  return undefined;
}

function isRootedFilesServeReceiver(
  expression: ts.Expression,
  frameworkBindings: RouteFrameworkBindings,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return compilerSetHas(frameworkBindings.rootedFileHandleNames, unwrapped.text);
  }
  if (ts.isCallExpression(unwrapped)) {
    return isFrameworkRootedFilesCall(unwrapped, frameworkBindings);
  }
  return false;
}

function isFrameworkRespondReference(
  expression: ts.Expression,
  bindings: RouteFrameworkBindings,
): boolean {
  return isFrameworkExpression(bindings, expression, RESPOND_IDENTITY);
}

function isFrameworkRootedFilesCall(
  call: ts.CallExpression,
  bindings: RouteFrameworkBindings,
): boolean {
  return isFrameworkExpression(bindings, call.expression, ROOTED_FILES_IDENTITY);
}

function routeAccessFact(
  routeDefinition: ts.ObjectLiteralExpression,
  routeLayouts: readonly RoutePageLayoutFact[],
  layouts: ReadonlyMap<string, RouteLayoutModel>,
  sourceFile: ts.SourceFile,
): AccessDecisionFact | undefined {
  const routeAccess = accessDecisionFact(routeDefinition, sourceFile);
  if (routeAccess) return routeAccess;

  const layoutCount = compilerArrayLength(routeLayouts, 'Compiler route access layouts');
  for (let index = layoutCount - 1; index >= 0; index -= 1) {
    const layout = compilerOwnDataValue(routeLayouts, index, 'Compiler route access layouts') as
      | RoutePageLayoutFact
      | undefined;
    if (!layout) continue;
    const access = compilerMapGet(layouts, layout.localName)?.access;
    if (access) return access;
  }

  return undefined;
}

function routeGuardFacts(
  routeDefinition: ts.ObjectLiteralExpression,
  routeLayouts: readonly RoutePageLayoutFact[],
  layouts: ReadonlyMap<string, RouteLayoutModel>,
  sourceFile: ts.SourceFile,
): string[] {
  const guards: string[] = [];
  const routeGuard = namedInitializer(routeDefinition, 'guard', sourceFile)?.name;
  if (routeGuard !== undefined) {
    compilerArrayAppend(guards, routeGuard, 'Compiler route guards');
  }
  const layoutCount = compilerArrayLength(routeLayouts, 'Compiler route guard layouts');
  for (let index = 0; index < layoutCount; index += 1) {
    const layout = compilerOwnDataValue(
      routeLayouts,
      index,
      'Compiler route guard layouts',
    ) as RoutePageLayoutFact;
    const guard = compilerMapGet(layouts, layout.localName)?.guard;
    if (guard !== undefined) compilerArrayAppend(guards, guard, 'Compiler route guards');
  }

  return uniqueSorted(guards);
}

function accessDecisionFact(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): AccessDecisionFact | undefined {
  const access = objectPropertyInitializer(object, 'access');
  if (!access) return undefined;

  if (isFrameworkAccessExpression(sourceFile, access, VERIFIED_ACCESS_IDENTITY)) {
    return { kind: 'verified-machine-auth' };
  }

  if (
    ts.isCallExpression(access) &&
    isFrameworkAccessExpression(sourceFile, access.expression, PUBLIC_ACCESS_IDENTITY)
  ) {
    const reason = compilerOwnDataValue(access.arguments, 0, 'Compiler public access arguments') as
      | ts.Expression
      | undefined;
    if (reason && ts.isStringLiteralLike(reason) && isCompilerAuditText(reason.text)) {
      return { kind: 'public', reason: reason.text };
    }
  }

  if (ts.isArrayLiteralExpression(access)) {
    return { guards: accessGuardNames(access, sourceFile), kind: 'guard-chain' };
  }

  if (!ts.isObjectLiteralExpression(access)) return undefined;

  const kind = staticStringProperty(access, 'kind', sourceFile);
  if (kind === 'verified-machine-auth') return { kind: 'verified-machine-auth' };
  if (kind === 'public') {
    const reason = staticStringProperty(access, 'reason', sourceFile);
    if (reason !== undefined && isCompilerAuditText(reason)) return { kind: 'public', reason };
  }
  if (kind === 'guard-chain') {
    return { guards: [], kind };
  }

  return undefined;
}

function isFrameworkAccessExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  identity: FrameworkExportIdentity,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    identity,
  );
}

function accessGuardNames(access: ts.ArrayLiteralExpression, sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  const elementCount = compilerArrayLength(access.elements, 'Compiler access guard elements');
  for (let index = 0; index < elementCount; index += 1) {
    const element = compilerOwnDataValue(
      access.elements,
      index,
      'Compiler access guard elements',
    ) as ts.Expression;
    if (
      !ts.isCallExpression(element) ||
      !isFrameworkAccessExpression(sourceFile, element.expression, GUARD_IDENTITY)
    ) {
      continue;
    }
    const name = compilerOwnDataValue(element.arguments, 0, 'Compiler access guard arguments') as
      | ts.Expression
      | undefined;
    if (name && ts.isStringLiteralLike(name)) {
      compilerArrayAppend(names, name.text, 'Compiler access guard names');
    }
  }
  return names;
}

function staticStringProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  const value = objectPropertyInitializer(object, name);
  if (!value) return undefined;
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isIdentifier(value)) return value.getText(sourceFile);
  return undefined;
}

function namedInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): { name: string } | undefined {
  const value = objectPropertyInitializer(object, name);
  return value && ts.isIdentifier(value) ? { name: value.getText(sourceFile) } : undefined;
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

  const reverseChain: RoutePageLayoutFact[] = [];
  const seen = compilerCreateSet<string>();
  let current: { length: number; name: string; start: number } | undefined = layoutName;

  while (current) {
    if (compilerSetHas(seen, current.name)) {
      compilerArrayAppend(
        diagnostics,
        layoutChainDiagnostic(
          fileName,
          source,
          current.start,
          current.length,
          `Cyclic layout parent chain at '${current.name}'.`,
        ),
        'Compiler route diagnostics',
      );
      return [];
    }
    compilerSetAdd(seen, current.name);
    const layoutModel: RouteLayoutModel | undefined = compilerMapGet(layouts, current.name);
    if (!layoutModel) {
      compilerArrayAppend(
        diagnostics,
        layoutChainDiagnostic(
          fileName,
          source,
          current.start,
          current.length,
          `Route layout '${current.name}' does not resolve to a local layout() declaration.`,
        ),
        'Compiler route diagnostics',
      );
      return [];
    }
    compilerArrayAppend(
      reverseChain,
      { localName: layoutModel.localName, queries: layoutModel.queries },
      'Compiler reverse route layout chain',
    );
    current =
      layoutModel.parent === undefined
        ? undefined
        : {
            length: layoutModel.parentLength ?? layoutModel.parent.length,
            name: layoutModel.parent,
            start: layoutModel.parentStart ?? layoutModel.start,
          };
  }

  const chain: RoutePageLayoutFact[] = [];
  const chainCount = compilerArrayLength(reverseChain, 'Compiler reverse route layout chain');
  for (let index = chainCount - 1; index >= 0; index -= 1) {
    compilerArrayAppend(
      chain,
      compilerOwnDataValue(
        reverseChain,
        index,
        'Compiler reverse route layout chain',
      ) as RoutePageLayoutFact,
      'Compiler route layout chain',
    );
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
    help: compilerArrayJoin(
      [
        diagnosticDefinitions.KV303.help,
        'Route layouts must be statically reconstructible from local layout() declarations so layout queries, boundaries, and navigation segment metadata can be derived.',
      ],
      '\n',
    ),
    message: `${diagnosticDefinitions.KV303.message} ${detail}`,
  };
}

function layoutQueryNames(layoutDefinition: ts.ObjectLiteralExpression): string[] {
  const value = objectPropertyInitializer(layoutDefinition, 'queries');
  if (!value || !ts.isObjectLiteralExpression(value)) return [];
  const names: string[] = [];
  const propertyCount = compilerArrayLength(value.properties, 'Compiler layout query properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      value.properties,
      index,
      'Compiler layout query properties',
    ) as ts.ObjectLiteralElementLike;
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (name) compilerArrayAppend(names, name, 'Compiler layout query names');
  }
  return names;
}

function objectPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  const propertyCount = compilerArrayLength(object.properties, 'Compiler route object properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      object.properties,
      index,
      'Compiler route object properties',
    ) as ts.ObjectLiteralElementLike;
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
  const propertyCount = compilerArrayLength(object.properties, 'Compiler route page properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      object.properties,
      index,
      'Compiler route page properties',
    ) as ts.ObjectLiteralElementLike;
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === name) {
      const start = property.initializer.getStart(sourceFile);
      return {
        node: property.initializer,
        replacementEnd: property.initializer.getEnd(),
        replacementPrefix: '',
        replacementStart: start,
        sourceExpression: compilerStringSlice(
          sourceFile.text,
          start,
          property.initializer.getEnd(),
        ),
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
  let asyncKeyword = '';
  if (method.modifiers !== undefined) {
    const modifierCount = compilerArrayLength(method.modifiers, 'Compiler route method modifiers');
    for (let index = 0; index < modifierCount; index += 1) {
      const modifier = compilerOwnDataValue(
        method.modifiers,
        index,
        'Compiler route method modifiers',
      ) as ts.Modifier;
      if (modifier.kind === ts.SyntaxKind.AsyncKeyword) {
        asyncKeyword = 'async ';
        break;
      }
    }
  }
  const typeParameters =
    method.typeParameters &&
    compilerArrayLength(method.typeParameters, 'Compiler route method type parameters') > 0
      ? `<${routeNodeTexts(method.typeParameters, sourceFile, 'Compiler route method type parameters')}>`
      : '';
  const parameters = routeNodeTexts(
    method.parameters,
    sourceFile,
    'Compiler route method parameters',
  );
  const returnType = method.type ? `: ${method.type.getText(sourceFile)}` : '';
  const body = method.body?.getText(sourceFile) ?? '{}';
  return `${asyncKeyword}function ${propertyNameText(method.name) ?? 'page'}${typeParameters}(${parameters})${returnType} ${body}`;
}

function routeNodeTexts(
  nodes: readonly ts.Node[],
  sourceFile: ts.SourceFile,
  label: string,
): string {
  const texts: string[] = [];
  const count = compilerArrayLength(nodes, label);
  for (let index = 0; index < count; index += 1) {
    const node = compilerOwnDataValue(nodes, index, label) as ts.Node;
    compilerArrayAppend(texts, node.getText(sourceFile), `${label} texts`);
  }
  return compilerArrayJoin(texts, ', ');
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
        appendRouteValues(
          diagnostics,
          routePageComponentSpreadDiagnostics(
            fileName,
            source,
            sourceFile,
            tag,
            node.openingElement.attributes,
          ),
          'Compiler route diagnostics',
        );
        compilerArrayAppend(
          facts,
          routePageComponentFact(sourceFile, tag, node.openingElement.attributes, componentImports),
          'Compiler route component facts',
        );
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTagName(node.tagName);
      if (tag && componentTagName(tag)) {
        appendRouteValues(
          diagnostics,
          routePageComponentSpreadDiagnostics(fileName, source, sourceFile, tag, node.attributes),
          'Compiler route diagnostics',
        );
        compilerArrayAppend(
          facts,
          routePageComponentFact(sourceFile, tag, node.attributes, componentImports),
          'Compiler route component facts',
        );
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
  const diagnostics: CompilerDiagnostic[] = [];
  const propertyCount = compilerArrayLength(
    attributes.properties,
    'Compiler route component attributes',
  );
  for (let index = 0; index < propertyCount; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes.properties,
      index,
      'Compiler route component attributes',
    ) as ts.JsxAttributeLike;
    if (!ts.isJsxSpreadAttribute(attribute)) continue;
    compilerArrayAppend(
      diagnostics,
      {
        ...diagnosticFor(
          fileName,
          'KV303',
          source,
          attribute.getStart(sourceFile),
          attribute.getWidth(sourceFile),
        ),
        help: compilerArrayJoin(
          [
            diagnosticDefinitions.KV303.help,
            'Route component props must be statically reconstructible so route query, live target, and navigation segment metadata can be derived.',
            'Fix: pass named props directly, for example `<QuestionDetail questionId={params.id} />`, instead of spreading an object.',
          ],
          '\n',
        ),
        message: `${diagnosticDefinitions.KV303.message} Route component '${localName}' uses spread props that cannot be represented in generated route metadata.`,
      },
      'Compiler route spread diagnostics',
    );
  }
  return diagnostics;
}

function routePageComponentFact(
  sourceFile: ts.SourceFile,
  localName: string,
  attributes: ts.JsxAttributes,
  componentImports: ReadonlyMap<string, RouteComponentImportModel>,
): RoutePageComponentFact {
  const allProps = routePageComponentProps(sourceFile, attributes);
  let key: RoutePageComponentPropFact | undefined;
  const props: RoutePageComponentPropFact[] = [];
  const propCount = compilerArrayLength(allProps, 'Compiler route component props');
  for (let index = 0; index < propCount; index += 1) {
    const prop = compilerOwnDataValue(
      allProps,
      index,
      'Compiler route component props',
    ) as RoutePageComponentPropFact;
    if (prop.name === 'key') key = prop;
    else compilerArrayAppend(props, prop, 'Compiler route component non-key props');
  }
  const propsExpression = routePagePropsExpression(props);
  const exportName = compilerMapGet(componentImports, localName)?.exportName;

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
  const props: RoutePageComponentPropFact[] = [];
  const propertyCount = compilerArrayLength(
    attributes.properties,
    'Compiler route component attributes',
  );
  for (let index = 0; index < propertyCount; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes.properties,
      index,
      'Compiler route component attributes',
    ) as ts.JsxAttributeLike;
    if (!ts.isJsxAttribute(attribute)) continue;
    if (!ts.isIdentifier(attribute.name)) continue;
    const name = attribute.name.text;

    if (attribute.initializer === undefined) {
      compilerArrayAppend(
        props,
        { expression: 'true', name, staticValue: true },
        'Compiler route component props',
      );
      continue;
    }

    if (ts.isStringLiteral(attribute.initializer)) {
      compilerArrayAppend(
        props,
        {
          expression: attribute.initializer.getText(sourceFile),
          name,
          staticValue: attribute.initializer.text,
        },
        'Compiler route component props',
      );
      continue;
    }

    if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) continue;

    const expression = attribute.initializer.expression;
    const staticValue = staticLiteralValue(expression);
    const propertyAccesses = propertyAccessPaths(expression);
    compilerArrayAppend(
      props,
      {
        expression: expression.getText(sourceFile),
        name,
        ...(compilerArrayLength(propertyAccesses, 'Compiler route prop accesses') > 0
          ? { propertyAccesses }
          : {}),
        ...(staticValue === undefined ? {} : { staticValue }),
      },
      'Compiler route component props',
    );
  }
  return props;
}

function routePagePropsExpression(props: readonly RoutePageComponentPropFact[]): string {
  const propCount = compilerArrayLength(props, 'Compiler route props expression');
  if (propCount === 0) return '{}';
  const entries: string[] = [];
  for (let index = 0; index < propCount; index += 1) {
    const prop = compilerOwnDataValue(
      props,
      index,
      'Compiler route props expression',
    ) as RoutePageComponentPropFact;
    compilerArrayAppend(
      entries,
      `${prop.name}: ${prop.expression}`,
      'Compiler route props expression entries',
    );
  }
  return `{ ${compilerArrayJoin(entries, ', ')} }`;
}

function componentTagName(tag: string): boolean {
  return compilerRegExpTest(/^[A-Z]/, tag);
}

function jsxTagName(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.getText();
  return null;
}

function staticLiteralValue(expression: ts.Expression): StaticLiteralValue | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(unwrapped)) return compilerNumberValue(unwrapped.text);
  if (ts.isPrefixUnaryExpression(unwrapped) && ts.isNumericLiteral(unwrapped.operand)) {
    if (unwrapped.operator === ts.SyntaxKind.MinusToken) {
      return -compilerNumberValue(unwrapped.operand.text);
    }
    if (unwrapped.operator === ts.SyntaxKind.PlusToken) {
      return compilerNumberValue(unwrapped.operand.text);
    }
  }
  return undefined;
}

function propertyAccessPaths(expression: ts.Expression): string[] {
  const paths: string[] = [];
  const seen = compilerCreateSet<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const path = propertyAccessPath(node);
      if (path && !compilerSetHas(seen, path)) {
        compilerSetAdd(seen, path);
        compilerArrayAppend(paths, path, 'Compiler route property access paths');
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return paths;
}

function emitCompiledRouteModule(options: {
  artifactFileName: string;
  componentImportRewrites: readonly { localName: string; specifier: string }[];
  routePages: readonly CompiledRoutePage[];
  source: string;
  sourceFile: ts.SourceFile;
}): string {
  const replacements: SourceReplacement[] = [];
  const routePageCount = compilerArrayLength(options.routePages, 'Compiler emitted route pages');
  for (let index = 0; index < routePageCount; index += 1) {
    const routePage = compilerOwnDataValue(
      options.routePages,
      index,
      'Compiler emitted route pages',
    ) as CompiledRoutePage;
    compilerArrayAppend(
      replacements,
      routePage.pageReplacement,
      'Compiler emitted route replacements',
    );
  }
  const allReplacements: SourceReplacement[] = [];
  appendRouteValues(
    allReplacements,
    routeImportReplacements(
      options.sourceFile,
      options.artifactFileName,
      options.componentImportRewrites,
    ),
    'Compiler route source replacements',
  );
  appendRouteValues(allReplacements, replacements, 'Compiler route source replacements');
  const lowered = applySourceReplacements(options.source, allReplacements);
  const importSource =
    "import { defineCompiledRoutePage as __kovoDefineCompiledRoutePage } from '@kovojs/server/internal/route';\n";
  const insertAt = routeModuleImportInsertionIndex(lowered);

  return compilerArrayJoin(
    [
      `// @kovojs-ir - lowered route module generated by @kovojs/compiler (SPEC.md section 4.5). Do not edit.\n`,
      compilerStringSlice(lowered, 0, insertAt),
      importSource,
      compilerStringSlice(lowered, insertAt),
    ],
    '',
  );
}

function routeModuleImportInsertionIndex(source: string): number {
  const shebang = compilerStringStartsWith(source, '#!')
    ? compilerStringIndexOf(source, '\n') + 1
    : 0;
  const leading = compilerStringSlice(source, shebang);
  const jsxImportSource = compilerRegExpExec(/^\/\*\*?\s*@jsxImportSource[\s\S]*?\*\/\s*/, leading);
  if (jsxImportSource) {
    const match = compilerOwnDataValue(jsxImportSource, 0, 'Compiler JSX import-source match');
    if (typeof match !== 'string')
      throw new TypeError('Compiler JSX import-source match is invalid.');
    return shebang + match.length;
  }
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
      compilerArrayAppend(
        diagnostics,
        {
          ...diagnosticFor(
            fileName,
            'KV235',
            source,
            node.moduleSpecifier.getStart(sourceFile),
            node.moduleSpecifier.getWidth(sourceFile),
          ),
          help: compilerArrayJoin(
            [
              diagnosticDefinitions.KV235.help,
              'Route/layout source should import the authored component, for example `../components/question-list.js`; the route compiler rewrites the generated route artifact to the lowered component module.',
            ],
            '\n',
          ),
          message: `${diagnosticDefinitions.KV235.message} app-local generated component import ${node.moduleSpecifier.getText(sourceFile)} in route/layout source.`,
        },
        'Compiler route diagnostics',
      );
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      compilerSetHas(navigationSegmentStampAttributes, node.name.text)
    ) {
      compilerArrayAppend(
        diagnostics,
        {
          ...diagnosticFor(
            fileName,
            'KV235',
            source,
            node.name.getStart(sourceFile),
            node.name.getWidth(sourceFile),
          ),
          help: compilerArrayJoin(
            [
              diagnosticDefinitions.KV235.help,
              'Navigation segment stamps are compiler-derived from route(), layout(), and the target document used by enhanced navigation.',
              'Fix: remove the kovo-nav-* attribute and declare sibling route/layout regions with the public route({ regions }) API.',
              'SPEC §8 makes enhanced navigation loader-owned; app TSX does not author segment stamps or persistence policy.',
            ],
            '\n',
          ),
          message: `${diagnosticDefinitions.KV235.message} hand-authored navigation segment stamp ${node.name.text}.`,
        },
        'Compiler route diagnostics',
      );
    }
    if (isDeferCallJsxChild(node)) {
      compilerArrayAppend(
        diagnostics,
        diagnosticFor(
          fileName,
          'KV244',
          source,
          node.expression.getStart(sourceFile),
          node.expression.getWidth(sourceFile),
        ),
        'Compiler route diagnostics',
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}

function isDeferCallJsxChild(node: ts.Node): node is ts.JsxExpression & {
  expression: ts.CallExpression & { expression: ts.Identifier };
} {
  if (!ts.isJsxExpression(node) || !node.expression) return false;
  if (!ts.isJsxElement(node.parent) && !ts.isJsxFragment(node.parent)) return false;
  const expression = unwrapExpression(node.expression);
  // Structural lint for the raw deferred-region helper in JSX child position; this is not an
  // authority check, and the public replacement remains `<Defer>`.
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'defer'
  );
}

function appLocalGeneratedImport(specifier: string): boolean {
  return compilerRegExpTest(/^\.{1,2}\/(?:.*\/)?generated\//, specifier);
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
  const rewriteByLocalName = compilerCreateMap<string, string>();
  const rewriteCount = compilerArrayLength(
    componentImportRewrites,
    'Compiler route component import rewrites',
  );
  for (let index = 0; index < rewriteCount; index += 1) {
    const rewrite = compilerOwnDataValue(
      componentImportRewrites,
      index,
      'Compiler route component import rewrites',
    ) as { readonly localName: string; readonly specifier: string };
    compilerMapSet(rewriteByLocalName, rewrite.localName, rewrite.specifier);
  }

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
        compilerArrayAppend(
          replacements,
          {
            end: node.moduleSpecifier.getEnd(),
            replacement: jsonRouteValue(rebased),
            start: node.moduleSpecifier.getStart(sourceFile),
          },
          'Compiler route import replacements',
        );
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

  const matches: string[] = [];
  const elementCount = compilerArrayLength(
    namedBindings.elements,
    'Compiler route rewritten imports',
  );
  for (let index = 0; index < elementCount; index += 1) {
    const element = compilerOwnDataValue(
      namedBindings.elements,
      index,
      'Compiler route rewritten imports',
    ) as ts.ImportSpecifier;
    const localName = element.name.text;
    const specifier = compilerMapGet(rewriteByLocalName, localName);
    if (specifier) compilerArrayAppend(matches, specifier, 'Compiler route rewrite matches');
  }
  const unique = uniqueSorted(matches);
  return compilerArrayLength(unique, 'Compiler route rewrite matches') === 1
    ? ((compilerOwnDataValue(unique, 0, 'Compiler route rewrite matches') as string | undefined) ??
        null)
    : null;
}

function rebaseRelativeSpecifier(
  specifier: string,
  sourceFileName: string,
  artifactFileName: string,
): string | null {
  if (!compilerStringStartsWith(specifier, '.')) return null;

  const absoluteTarget = resolve(dirname(sourceFileName), specifier);
  const relativeTarget = normalizePath(relative(dirname(artifactFileName), absoluteTarget));
  return compilerStringStartsWith(relativeTarget, '.') ? relativeTarget : `./${relativeTarget}`;
}

function normalizePath(value: string): string {
  return compilerRegExpReplace(/\\/g, value, '/');
}

function appendRouteValues<Value>(target: Value[], values: readonly Value[], label: string): void {
  const count = compilerArrayLength(values, label);
  for (let index = 0; index < count; index += 1) {
    compilerArrayAppend(target, compilerOwnDataValue(values, index, label) as Value, label);
  }
}

function jsonRouteValue(value: unknown): string {
  const serialized = compilerJsonStringify(value);
  if (serialized === undefined) {
    throw new TypeError('Compiler route metadata must be JSON serializable.');
  }
  return serialized;
}
