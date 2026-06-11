import { diagnosticDefinitions, type DiagnosticCode } from '@jiso/core';
import { isAbsolute, relative } from 'node:path';

import { componentCssAssetForFile, emitCssModule, type ComponentCssAsset } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type { ComponentGraphFact, RegistryFacts, RegistryTypeFacts } from './graph.js';
import { findStringEnd } from './scan/text.js';
import {
  callExpressions,
  componentExplicitNames,
  componentFragmentTargetNames,
  componentOptionSource,
  componentRenderInputModels,
  componentRenderHost,
  componentStateReturnObjectModel,
  componentStateReturnObject,
  firstComponentModel,
  identifierReferences,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  jsxElements,
  mutationHandlers,
  objectLiteralPropertyPaths,
  parseComponentModule as parseComponentModuleModel,
} from './scan/parse.js';
import { escapeAttribute, indent, kebabCase } from './shared.js';
import {
  collectQueryUpdateCoverage,
  collectQueryUpdatePlans,
  dataBindListTemplateBodies,
  queryUpdateCoverageSpan,
  validateDataBindings,
  validateStampExpressionDrift,
} from './validate/bindings.js';
import { validateEventTriggerNames } from './validate/event-triggers.js';

export type { DiagnosticCode };
export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export type { QueryPlanBootstrapInput, QueryPlanBootstrapOptions } from './emit/bootstrap.js';
export { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
export type {
  CompileAppGraphOptions,
  CompileAppGraphResult,
  ComponentGraphFact,
  RegistryFacts,
  RegistryGraphInput,
  RegistryTypeFactOptions,
  RegistryTypeFacts,
} from './graph.js';
export { deriveAppGraph, deriveRegistryFactsFromGraph } from './graph.js';
export type {
  ComponentCssAsset,
  CssAsset,
  CssAssetManifest,
  CssAssetManifestOptions,
  ScopedCssResult,
  ScopeComponentCssOptions,
} from './css.js';
export { collectCssAssetManifest, dedupeCss, scopeComponentCss, selectCssAssets } from './css.js';

export interface EmittedFile {
  fileName: string;
  kind: 'client' | 'css' | 'registry' | 'server';
  source: string;
}

export interface CompileResult {
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  diagnostics: readonly CompilerDiagnostic[];
  files: readonly EmittedFile[];
  handlerExports: readonly string[];
  platformSubstitutions: readonly PlatformSubstitution[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  renderEquivalenceChecks: readonly RenderEquivalenceCheck[];
  updateCoverage: readonly QueryUpdateCoverageFact[];
  viewTransitions: ViewTransitionStamp[];
}

export interface RenderEquivalenceCheck {
  actual: string;
  artifact: string;
  expected: string;
  ok: boolean;
}

export interface QueryUpdatePlanFact {
  componentName: string;
  derives?: readonly QueryDeriveFact[];
  paths: readonly string[];
  query: string;
  templateStamps?: readonly QueryTemplateStampFact[];
}

export interface QueryDeriveFact {
  expression: string;
  exportName: string;
  input: string;
  name: string;
  param: string;
  selector: string;
}

export interface QueryTemplateStampFact {
  itemBindings: readonly string[];
  key: string;
  list: string;
  selector: string;
  template: string;
}

interface IdrefValue {
  index: number;
  length: number;
  value: string;
}

interface LiteralIdValue {
  index: number;
  length: number;
  value: string;
}

interface LiteralNavigationTarget {
  index: number;
  length: number;
  value: string;
}

interface TemplateBody {
  offset: number;
  source: string;
}

export interface QueryUpdateCoverageFact {
  componentName: string;
  detail?: string;
  position: string;
  query: string;
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

export function createEmptyCompileResult(): CompileResult {
  return {
    componentGraphFacts: [],
    cssAssets: [],
    diagnostics: [],
    files: [],
    handlerExports: [],
    platformSubstitutions: [],
    queryUpdatePlans: [],
    renderEquivalenceChecks: [],
    updateCoverage: [],
    viewTransitions: [],
  };
}

export interface CompileComponentOptions {
  fileName: string;
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: RegistryFacts;
  source: string;
}

export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | QueryShapeWrapper
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

export interface QueryShapeWrapper {
  kind: 'nullable' | 'optional';
  shape: QueryShape;
}

export interface QueryShapeFact {
  query: string;
  shape: QueryShape;
  source: string;
}

interface HandlerLowering {
  exportName: string;
  attributeName: string;
  attributeEnd: number;
  attributeStart: number;
  attributeValue: string;
  expression: string;
  params: ElementParam[];
  diagnostic?: CompilerDiagnostic;
}

interface ElementParam {
  attributeName: string;
  type: ElementParamType;
  value: string;
}

type ElementParamType = 'boolean' | 'number' | 'string';

export interface PlatformSubstitution {
  action: string;
  event: string;
  kind: 'details' | 'dialog' | 'popover';
  tag: string;
  target: string;
}

export interface ViewTransitionStamp {
  name: string;
}

export interface JisoVitePlugin {
  configureServer?: (server: JisoViteDevServer) => void;
  name: 'jiso';
  transform: (
    source: string,
    id: string,
  ) => null | {
    code: string;
    map: null;
  };
}

export interface JisoViteDevServer {
  config?: {
    root?: string;
  };
  middlewares: {
    use(handler: JisoViteMiddleware): void;
  };
}

export type JisoViteMiddleware = (
  req: { url?: string },
  res: {
    end(body: string): void;
    setHeader(name: string, value: string): void;
    statusCode?: number;
  },
  next: () => void,
) => void;

interface ValidatorContext {
  componentName: string;
  model: ComponentModuleModel;
  options: CompileComponentOptions;
  originalModel: ComponentModuleModel;
  source: string;
  updateCoverage: readonly QueryUpdateCoverageFact[];
}

type CompilerValidator = (context: ValidatorContext) => readonly CompilerDiagnostic[];

const irHeader = '// @jiso-ir';
const cssIrHeader = '/* @jiso-ir */';

const compilerValidators: readonly CompilerValidator[] = [
  ({ model, options, source }) => validateServerFactsInLocalState(source, model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetInputs(source, model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetChildren(source, model, options.fileName),
  ({ model, options, source }) => validateDataBindings(source, model, options),
  ({ model, options, source }) => validateStampExpressionDrift(source, model, options),
  ({ model, options, source }) => validateEventPayloads(source, model, options),
  ({ model, options, source }) => validateDirectDbAccess(source, model, options.fileName),
  ({ options, originalModel }) => validateIdrefs(options.source, originalModel, options.fileName),
  ({ model, options, source }) => validateStaticIds(source, model, options.fileName),
  ({ options, source }) => validateLiteralHrefs(source, options),
  ({ model, options, source }) => validateHtmlContentModel(source, model, options.fileName),
  ({ model, options, source }) => validateEventTriggerNames(source, model, options.fileName),
  ({ componentName, model, options, source }) =>
    validateResidualStamps(source, model, options, componentName),
  ({ model, options, source }) => validateAttributeMergeConflicts(source, model, options.fileName),
  ({ options, source, updateCoverage }) =>
    updateCoverage
      .filter((fact) => fact.status === 'UNHANDLED')
      .map((fact) => fw311Diagnostic(options.fileName, source, fact)),
];

export function compileComponentModule(options: CompileComponentOptions): CompileResult {
  if (isIr(options.source)) {
    return {
      ...createEmptyCompileResult(),
      files: [
        {
          fileName: options.fileName,
          kind: emittedFileKind(options.fileName),
          source: options.source,
        },
      ],
    };
  }

  const originalModel = parseComponentModuleModel(options.fileName, options.source);
  const componentName = inferComponentName(options, originalModel);
  const viewTransitionLowering = lowerViewTransitions(options.source);
  const platformLowering = lowerPlatformBehaviors(viewTransitionLowering.source);
  const navigationLowering = lowerNavigationSugar(platformLowering.source);
  const source = navigationLowering.source;
  const model = parseComponentModuleModel(options.fileName, source);
  const handlers = lowerEventHandlers({ ...options, source }, componentName);
  const queryUpdatePlans = collectQueryUpdatePlans(source, model, componentName);
  const updateCoverage = collectQueryUpdateCoverage(source, model, options, componentName);
  const validationDiagnostics = compilerValidators.flatMap((validator) =>
    validator({ componentName, model, options, originalModel, source, updateCoverage }),
  );
  const clientFileName = replaceExtension(options.fileName, '.client.js');
  const cssFileName = replaceExtension(options.fileName, '.css');
  const serverFileName = replaceExtension(options.fileName, '.server.js');
  const registryFileName = 'generated/registries.d.ts';

  const clientSource = emitClientModule(handlers, queryUpdatePlans, componentName);
  const clientHref = clientModuleUrl(options.fileName, clientModuleVersion(clientSource));
  const versionedHandlers = handlers.map((handler) =>
    versionHandlerLowering(handler, options.fileName, clientHref),
  );
  const cssSource = emitCssModule(source, componentName);
  const fragmentTargetFacts = findFragmentTargetFacts(source, componentName);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const componentGraphFacts = [componentGraphFact(componentName, model, fragmentTargets)];
  const cssAssets = cssSource
    ? [componentCssAssetForFile(cssFileName, componentName, fragmentTargets, {}, cssSource)]
    : [];
  const serverSource = emitServerModule(source, versionedHandlers, clientFileName);
  const serverRenderedSource = serverRenderSource(source, versionedHandlers);
  const registrySource = emitRegistryModule({
    clientFileName,
    cssAssets,
    componentName,
    fragmentTargetFacts,
    handlers: versionedHandlers,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    ...(options.registryFacts ? { registryFacts: options.registryFacts } : {}),
    viewTransitions: viewTransitionLowering.stamps,
  });

  return {
    componentGraphFacts,
    diagnostics: [
      ...versionedHandlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
      ...validationDiagnostics,
    ],
    files: [
      { fileName: serverFileName, kind: 'server', source: serverSource },
      { fileName: clientFileName, kind: 'client', source: clientSource },
      ...(cssSource ? [{ fileName: cssFileName, kind: 'css' as const, source: cssSource }] : []),
      { fileName: registryFileName, kind: 'registry', source: registrySource },
    ],
    handlerExports: versionedHandlers.map((handler) => handler.exportName),
    cssAssets,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    renderEquivalenceChecks: [
      renderEquivalenceCheck(serverFileName, serverRenderedSource, serverSource),
    ],
    updateCoverage,
    viewTransitions: viewTransitionLowering.stamps,
  };
}

export function assertFixpoint(result: CompileResult): void {
  for (const file of result.files) {
    const recompiled = compileComponentModule(file);
    const sameFile =
      recompiled.files.length === 1 &&
      recompiled.files[0]?.fileName === file.fileName &&
      recompiled.files[0]?.kind === file.kind &&
      recompiled.files[0]?.source === file.source;

    if (!sameFile) {
      throw new Error(`Fixpoint failed for ${file.fileName}`);
    }
  }
}

export function assertRenderEquivalence(result: CompileResult): void {
  for (const check of result.renderEquivalenceChecks) {
    if (!check.ok) {
      throw new Error(`Render equivalence failed for ${check.artifact}`);
    }
  }
}

export function queryShapesFromFacts(facts: readonly QueryShapeFact[]): Record<string, QueryShape> {
  return Object.fromEntries(facts.map((fact) => [fact.query, fact.shape]));
}

export function collectMinifierReservedNames(
  results: CompileResult | readonly CompileResult[],
): string[] {
  const reserved = new Set<string>();
  const items = Array.isArray(results) ? results : [results];

  for (const result of items) {
    for (const exportName of result.handlerExports) reserved.add(exportName);
  }

  return [...reserved].sort();
}

export function jisoVitePlugin(): JisoVitePlugin {
  const clientModules = new Map<string, string>();
  let root = process.cwd();

  return {
    configureServer(server) {
      root = server.config?.root ?? root;
      server.middlewares.use((req, res, next) => {
        const path = devClientModulePath(req.url);
        const source = path ? clientModules.get(path) : undefined;
        if (source === undefined) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source);
      });
    },
    name: 'jiso',
    transform(source: string, id: string) {
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const fileName = viteComponentFileName(id, root);
      const result = compileComponentModule({ fileName, source });
      for (const file of result.files) {
        if (file.kind === 'client') {
          clientModules.set(clientModuleUrl(fileName), file.source);
        }
      }

      return {
        code: result.files.find((file) => file.kind === 'server')?.source ?? source,
        map: null,
      };
    },
  };
}

function viteComponentFileName(id: string, root: string): string {
  const fileName = id.split(/[?#]/, 1)[0] ?? id;
  if (!isAbsolute(fileName)) return slashPath(fileName);

  const relativeFileName = relative(root, fileName);
  if (!relativeFileName.startsWith('..')) return slashPath(relativeFileName);

  return slashPath(fileName.replace(/^\/+/, ''));
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function devClientModulePath(url: string | undefined): string | null {
  if (!url) return null;

  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.startsWith('/c/') ? path : null;
}

function emittedFileKind(fileName: string): EmittedFile['kind'] {
  if (fileName.endsWith('.client.js')) return 'client';
  if (fileName.endsWith('.css')) return 'css';
  if (fileName.endsWith('.server.js')) return 'server';
  return 'registry';
}

function isIr(source: string): boolean {
  return source.startsWith(irHeader) || source.startsWith(cssIrHeader);
}

function inferComponentName(
  options: CompileComponentOptions,
  model = parseComponentModuleModel(options.fileName, options.source),
): string {
  const component = firstComponentModel(model);
  if (component?.localName) return component.localName;

  const baseName =
    options.fileName
      .replace(/\.[^.]+$/, '')
      .split('/')
      .at(-1) ?? 'Component';
  return baseName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

function lowerViewTransitions(source: string): {
  source: string;
  stamps: ViewTransitionStamp[];
} {
  const matches = parsedJsxElements(source)
    .map((item) => ({
      attribute: item.attributes.find(
        (attribute) => attribute.name === 'viewTransitionName' && attribute.value !== undefined,
      ),
      element: item,
    }))
    .filter(
      (
        item,
      ): item is {
        attribute: JsxAttributeModel & { value: string };
        element: JsxElementModel;
      } => item.attribute !== undefined,
    );
  const stamps = matches.map((item) => ({ name: item.attribute.value }));
  let nextSource = source;

  for (const match of matches.sort((left, right) => right.element.start - left.element.start)) {
    const opening = nextSource.slice(match.element.start, match.element.openingEnd);
    const tagPrefix = `<${match.element.tag}`;
    const attributes = opening.slice(tagPrefix.length, -1);
    const withoutViewTransition = removeJsxAttribute(
      attributes,
      match.attribute.start - match.element.start - tagPrefix.length,
      match.attribute.end - match.element.start - tagPrefix.length,
    );
    const replacement = `<${match.element.tag}${appendViewTransitionStyle(withoutViewTransition, match.attribute.value)}>`;
    nextSource = `${nextSource.slice(0, match.element.start)}${replacement}${nextSource.slice(match.element.openingEnd)}`;
  }

  return {
    source: nextSource,
    stamps,
  };
}

function removeJsxAttribute(attributes: string, start: number, end: number): string {
  let removeStart = start;
  while (removeStart > 0 && /\s/.test(attributes[removeStart - 1] ?? '')) {
    removeStart -= 1;
  }

  return `${attributes.slice(0, removeStart)}${attributes.slice(end)}`;
}

function removeJsxAttributes(
  attributes: string,
  ranges: readonly { end: number; start: number }[],
): string {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((next, range) => removeJsxAttribute(next, range.start, range.end), attributes);
}

function appendViewTransitionStyle(attributes: string, name: string): string {
  const transition = `view-transition-name: ${escapeAttribute(name)}`;
  const selfClosing = /\s*\/\s*$/.test(attributes);
  const baseAttributes = selfClosing ? attributes.replace(/\s*\/\s*$/, '') : attributes;
  const styleMatch = /(\sstyle=)(["'])(?<style>[^"']*)\2/.exec(baseAttributes);
  const suffix = selfClosing ? ' /' : '';

  if (!styleMatch?.groups) {
    return `${baseAttributes} style="${transition}"${suffix}`;
  }

  const existing = (styleMatch.groups.style ?? '').trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  const style = existing === '' ? transition : `${existing}${separator} ${transition}`;

  return `${baseAttributes.replace(
    styleMatch[0],
    `${styleMatch[1]}${styleMatch[2]}${style}${styleMatch[2]}`,
  )}${suffix}`;
}

function lowerPlatformBehaviors(source: string): {
  source: string;
  substitutions: PlatformSubstitution[];
} {
  const matches = parsedJsxElements(source).flatMap((element) => {
    const onClick = element.attributes.find((attribute) => attribute.name === 'onClick');
    const substitution = onClick?.expression
      ? platformSubstitutionFromClickExpression(element.tag, onClick.expression)
      : null;
    return onClick && substitution ? [{ attribute: onClick, substitution }] : [];
  });
  let nextSource = source;

  for (const match of [...matches].sort(
    (left, right) => right.attribute.start - left.attribute.start,
  )) {
    const attributes = platformAttributes(match.substitution);
    nextSource =
      attributes === ''
        ? removeSourceRangeWithLeadingWhitespace(
            nextSource,
            match.attribute.start,
            match.attribute.end,
          )
        : `${nextSource.slice(0, match.attribute.start)}${attributes}${nextSource.slice(match.attribute.end)}`;
  }

  return {
    source: nextSource,
    substitutions: matches.map((match) => match.substitution),
  };
}

function platformSubstitutionFromClickExpression(
  tag: string,
  expression: string,
): PlatformSubstitution | null {
  const detailsToggle =
    /^\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.open\s*=\s*!\s*document\.getElementById\(['"]\k<target>['"]\)!?\.open$/.exec(
      expression,
    );
  const detailsTarget = detailsToggle?.groups?.target;
  if (detailsTarget && tag === 'summary') {
    return {
      action: 'toggle',
      event: 'click',
      kind: 'details',
      tag,
      target: detailsTarget,
    };
  }

  const methodCall =
    /^\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.(?<method>showModal|close|requestClose|showPopover|hidePopover|togglePopover)\(\)\s*$/.exec(
      expression,
    );
  const method = methodCall?.groups?.method;
  const target = methodCall?.groups?.target;
  if (!method || !target) return null;

  return platformSubstitutionFor(tag, target, method);
}

function removeSourceRangeWithLeadingWhitespace(
  source: string,
  start: number,
  end: number,
): string {
  let removeStart = start;
  while (removeStart > 0 && /\s/.test(source[removeStart - 1] ?? '')) {
    removeStart -= 1;
  }

  return `${source.slice(0, removeStart)}${source.slice(end)}`;
}

function lowerNavigationSugar(source: string): { source: string } {
  return {
    source: normalizeStaticHrefAttributes(lowerStaticHrefCalls(lowerStaticLinks(source))),
  };
}

function lowerStaticLinks(source: string): string {
  let output = source;

  for (const link of parsedJsxElements(source)
    .filter((element) => element.tag === 'Link' && !element.selfClosing)
    .sort((left, right) => right.start - left.start)) {
    const target = jsxStaticAttributeValue(link, 'to');
    if (!target) continue;

    const params = navigationObjectAttributeValue(link, 'params');
    const search = navigationObjectAttributeValue(link, 'search');
    if (params === null || search === null) continue;

    const opening = output.slice(link.start, link.openingEnd);
    const tagPrefix = '<Link';
    const attributes = opening.slice(tagPrefix.length, -1);
    const anchorAttributes = removeJsxAttributes(
      attributes,
      link.attributes
        .filter((attribute) => ['params', 'search', 'to'].includes(attribute.name))
        .map((attribute) => ({
          end: attribute.end - link.start - tagPrefix.length,
          start: attribute.start - link.start - tagPrefix.length,
        })),
    );
    const spacing = anchorAttributes.trim() === '' ? '' : anchorAttributes;
    const href = buildStaticHref(target, params ?? {}, search ?? {});
    const children = output.slice(link.openingEnd, link.closingStart);

    output = `${output.slice(0, link.start)}<a${spacing} href="${escapeAttribute(href)}">${children}</a>${output.slice(link.end)}`;
  }

  return output;
}

function lowerStaticHrefCalls(source: string): string {
  let output = source;

  for (const call of parsedCallExpressions(source)
    .filter((item) => item.name === 'href')
    .sort((left, right) => right.start - left.start)) {
    const lowered = lowerStaticHrefCall(call.arguments);
    if (!lowered) continue;

    output = `${output.slice(0, call.start)}${JSON.stringify(lowered)}${output.slice(call.end)}`;
  }

  return output;
}

function normalizeStaticHrefAttributes(source: string): string {
  let output = source;

  for (const attribute of jsxAttributes(parseComponentModuleModel('component.tsx', source))
    .filter((item) => item.name === 'href' && item.expression !== undefined)
    .sort((left, right) => right.start - left.start)) {
    const target = literalStringValue(attribute.expression ?? '');
    if (target === null) continue;

    output = `${output.slice(0, attribute.start)}href="${escapeAttribute(target)}"${output.slice(attribute.end)}`;
  }

  return output;
}

function lowerStaticHrefCall(args: readonly string[]): string | null {
  const [pathArg, optionsArg] = args.map((arg) => arg.trim());
  const path = literalStringValue(pathArg ?? '');
  if (!path) return null;

  const options = parseLiteralObject(optionsArg ?? '{}');
  if (options === null) return null;

  const params = objectRecordValue(options.params);
  const search = objectRecordValue(options.search);
  if (params === null || search === null) return null;

  return buildStaticHref(path, params ?? {}, search ?? {});
}

type StaticNavigationValue = string | number | boolean | null;
type StaticNavigationObject = Record<string, StaticNavigationValue>;
type StaticLiteralValue = StaticNavigationValue | StaticLiteralObject;

interface StaticLiteralObject {
  [key: string]: StaticLiteralValue;
}

function navigationObjectAttributeValue(
  element: JsxElementModel,
  name: string,
): StaticNavigationObject | null | undefined {
  const expression = element.attributes.find((attribute) => attribute.name === name)?.expression;
  if (expression === undefined) return undefined;
  const value = parseLiteralObject(expression);
  return value ? navigationObjectValue(value) : null;
}

function parseLiteralObject(source: string): StaticLiteralObject | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  const entries: Record<string, StaticLiteralValue> = {};
  for (const entry of topLevelObjectEntries(trimmed)) {
    const value = literalValue(entry.value);
    if (value === undefined) return null;
    entries[entry.key] = value;
  }

  return entries;
}

function objectRecordValue(
  value: StaticLiteralValue | undefined,
): StaticNavigationObject | null | undefined {
  if (value === undefined) return undefined;
  return navigationObjectValue(value);
}

function navigationObjectValue(value: StaticLiteralValue | null): StaticNavigationObject | null {
  if (typeof value !== 'object' || value === null) return null;
  return Object.values(value).every((entry) => typeof entry !== 'object' || entry === null)
    ? (value as StaticNavigationObject)
    : null;
}

function literalValue(value: string): StaticLiteralValue | undefined {
  const trimmed = value.trim().replace(/,$/, '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseLiteralObject(trimmed) ?? undefined;
  }

  const stringValue = literalStringValue(trimmed);
  if (stringValue !== null) return stringValue;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  return undefined;
}

function literalStringValue(value: string): string | null {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return null;
  return trimmed.slice(1, -1);
}

function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  const pathname = path.replace(/:([A-Za-z_$][\w$]*)/g, (_match, key: string) =>
    encodeURIComponent(String(params[key] ?? '')),
  );
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function platformSubstitutionFor(
  tag: string,
  target: string,
  method: string,
): PlatformSubstitution | null {
  if (method === 'showModal') {
    return { action: 'show-modal', event: 'click', kind: 'dialog', tag, target };
  }

  if (method === 'close') {
    return { action: 'close', event: 'click', kind: 'dialog', tag, target };
  }

  // SPEC §5.2.4: provable dialog handlers lower to platform invoker commands.
  if (method === 'requestClose') {
    return { action: 'request-close', event: 'click', kind: 'dialog', tag, target };
  }

  const popoverActionByMethod: Record<string, string> = {
    hidePopover: 'hide',
    showPopover: 'show',
    togglePopover: 'toggle',
  };
  const action = popoverActionByMethod[method];
  if (!action) return null;

  return { action, event: 'click', kind: 'popover', tag, target };
}

function platformAttributes(substitution: PlatformSubstitution): string {
  if (substitution.kind === 'dialog') {
    return `commandfor="${escapeAttribute(substitution.target)}" command="${substitution.action}"`;
  }

  if (substitution.kind === 'details') {
    return '';
  }

  return `popovertarget="${escapeAttribute(substitution.target)}" popovertargetaction="${substitution.action}"`;
}

function lowerEventHandlers(
  options: CompileComponentOptions,
  componentName: string,
): HandlerLowering[] {
  const handlers: HandlerLowering[] = [];
  const anonymousNameCounts = new Map<string, number>();

  for (const eventAttribute of eventAttributes(options.source)) {
    const { attributeEnd, attributeStart, event, expression, tag } = eventAttribute;
    const namedHandler = /^[A-Za-z_$][\w$]*$/.test(expression);
    const params = namedHandler ? [] : extractElementParams(expression);
    const eventName = event.toLowerCase();
    const exportName = namedHandler
      ? `${componentName}$${expression}`
      : uniqueAnonymousHandlerName(componentName, tag, eventName, anonymousNameCounts);

    let diagnostic: CompilerDiagnostic | undefined;
    if (!namedHandler) {
      diagnostic = diagnosticFor(
        options.fileName,
        'FW210',
        options.source,
        attributeStart,
        event.length,
      );
    }

    if (capturesUnserializableValue(expression)) {
      diagnostic = fw201Diagnostic(options.fileName, options.source, attributeStart, {
        attributeName: `on:${eventName}`,
        exportName,
        expression,
        params,
      });
    }

    handlers.push({
      attributeName: `on:${eventName}`,
      attributeEnd,
      attributeStart,
      attributeValue: `${clientModuleUrl(options.fileName)}#${exportName}`,
      ...(diagnostic ? { diagnostic } : {}),
      expression,
      exportName,
      params,
    });
  }

  return handlers;
}

function eventAttributes(source: string): Array<{
  attributeEnd: number;
  attributeStart: number;
  event: string;
  expression: string;
  tag: string;
}> {
  const attributes: Array<{
    attributeEnd: number;
    attributeStart: number;
    event: string;
    expression: string;
    tag: string;
  }> = [];

  for (const element of parsedJsxElements(source)) {
    for (const attribute of element.attributes) {
      const event = jsxEventAttributeName(attribute.name);
      if (!event || attribute.expression === undefined) continue;
      attributes.push({
        attributeEnd: attribute.end,
        attributeStart: attribute.start,
        event,
        expression: attribute.expression,
        tag: element.tag,
      });
    }
  }

  return attributes;
}

function jsxEventAttributeName(name: string): string | null {
  if (!/^on[A-Z][A-Za-z0-9]*$/.test(name)) return null;
  return name.slice(2);
}

function uniqueAnonymousHandlerName(
  componentName: string,
  tag: string,
  eventName: string,
  counts: Map<string, number>,
): string {
  const base = `${componentName}$${tag}_${eventName}`;
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);

  return count === 1 ? base : `${base}_${count}`;
}

function capturesUnserializableValue(expression: string): boolean {
  const references = new Set(identifierReferences('expression.tsx', expression));
  return ['window', 'document', 'db', 'request', 'response', 'Date', 'Map', 'Set'].some((name) =>
    references.has(name),
  );
}

function fw201Diagnostic(
  fileName: string,
  source: string,
  offset: number,
  lowering: {
    attributeName: string;
    exportName: string;
    expression: string;
    params: readonly ElementParam[];
  },
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.FW201;
  return {
    ...diagnosticFor(fileName, 'FW201', source, offset, lowering.attributeName.length),
    help: [
      `Would lower to: ${lowering.attributeName}="${clientModuleUrl(fileName)}#${lowering.exportName}"`,
      `Blocked expression: ${lowering.expression}`,
      `Element params: ${lowering.params.map((param) => param.attributeName).join(', ') || '-'}`,
      definition.help ?? '',
    ].join('\n'),
  };
}

function versionHandlerLowering(
  handler: HandlerLowering,
  fileName: string,
  clientHref: string,
): HandlerLowering {
  const unversionedHref = clientModuleUrl(fileName);
  const versionedAttributeValue = `${clientHref}#${handler.exportName}`;
  return {
    ...handler,
    attributeValue: versionedAttributeValue,
    ...(handler.diagnostic
      ? {
          diagnostic: {
            ...handler.diagnostic,
            ...(handler.diagnostic.help
              ? {
                  help: handler.diagnostic.help.replaceAll(`${unversionedHref}#`, `${clientHref}#`),
                }
              : {}),
          },
        }
      : {}),
  };
}

function clientModuleUrl(fileName: string, version?: string): string {
  const href = `/c/${replaceExtension(fileName, '.client.js').replace(/^\/+/, '')}`;
  return version ? `${href}?v=${version}` : href;
}

function clientModuleVersion(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

// SPEC 5.2: query data is shared/server-owned; island-local state is private/client-owned.
function validateServerFactsInLocalState(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const queryObject = componentOptionSource(model, 'queries');
  const stateObject = componentStateReturnObjectModel(model);
  if (!queryObject || !stateObject) return [];

  const queryNames = topLevelObjectKeys(queryObject);
  const stateKeys = topLevelObjectKeys(stateObject.source);
  if (queryNames.length === 0 || stateKeys.length === 0) return [];

  const storesServerFact = stateKeys.some((stateKey) =>
    queryNames.some((queryName) => stateKeyHasQueryPrefix(stateKey, queryName)),
  );

  return storesServerFact
    ? [
        diagnosticFor(
          fileName,
          'FW301',
          source,
          stateObject.start,
          stateObject.end - stateObject.start,
        ),
      ]
    : [];
}

function validateFragmentTargetInputs(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (componentFragmentTargetNames(model).length === 0) return [];

  const queryObject = componentOptionSource(model, 'queries');
  const propsObject = componentOptionSource(model, 'props');
  const allowedInputs = new Set([
    ...topLevelObjectKeys(queryObject ?? '{}'),
    ...topLevelObjectKeys(propsObject ?? '{}'),
  ]);
  const renderInputs = componentRenderInputModels(model);
  if (renderInputs.length === 0) return [];

  const missing = renderInputs.filter((input) => !allowedInputs.has(input.name));
  return missing.map((input) => ({
    ...diagnosticFor(fileName, 'FW303', source, input.start, input.end - input.start),
    message: `${diagnosticDefinitions.FW303.message} ${input.name}`,
  }));
}

function validateFragmentTargetChildren(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const targetNames = fragmentTargetUsageNames(model);
  if (targetNames.length === 0) return [];

  return targetNames.flatMap((name) =>
    fragmentTargetChildBodies(source, model, name)
      .filter((body) => capturesUnserializableValue(body.source))
      .map((body) => fw230Diagnostic(fileName, source, name, body)),
  );
}

function fragmentTargetUsageNames(model: ComponentModuleModel): string[] {
  return [...new Set(componentFragmentTargetNames(model))];
}

function fragmentTargetChildBodies(
  source: string,
  model: ComponentModuleModel,
  name: string,
): TemplateBody[] {
  const bodies: TemplateBody[] = [];

  for (const element of jsxElements(model).filter((item) => item.tag === name)) {
    if (element.selfClosing) continue;

    const raw = source.slice(element.openingEnd, element.closingStart);
    const leadingWhitespace = /^\s*/.exec(raw)?.[0].length ?? 0;
    const body = raw.trim();
    if (body) {
      bodies.push({
        offset: element.openingEnd + leadingWhitespace,
        source: body,
      });
    }
  }

  return bodies;
}

function fw230Diagnostic(
  fileName: string,
  source: string,
  target: string,
  body: TemplateBody,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.FW230;
  return {
    ...diagnosticFor(fileName, 'FW230', source, body.offset, body.source.length),
    help: [
      `Would hoist children to: ${target}$slot_children`,
      `Blocked children: ${body.source}`,
      definition.help ?? '',
    ].join('\n'),
    message: `${diagnosticDefinitions.FW230.message} ${target}`,
  };
}

function validateEventPayloads(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const queryPaths = new Set(queryShapePaths(queryShapes));
  const overlapping = eventPayloads(model).filter((payload) => queryPaths.has(payload.path));
  if (overlapping.length === 0) return [];

  return dedupeBy(overlapping, (payload) => payload.path).map((payload) => ({
    ...diagnosticFor(options.fileName, 'FW320', source, payload.index, payload.length),
    message: `${diagnosticDefinitions.FW320.message} ${payload.path}`,
  }));
}

function componentQueryShapes(options: CompileComponentOptions): Record<string, QueryShape> | null {
  return (
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : null)
  );
}

function validateDirectDbAccess(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (!/\bmutation\s*\(/.test(source)) return [];

  for (const handler of mutationHandlers(model)) {
    const params = handler.params.map(readParameterName).filter(Boolean);
    const dbParamIndex = params.indexOf('db');
    const receivesDb = dbParamIndex !== -1;
    const requestParam = params.find(
      (param) =>
        param === 'request' || /request$/i.test(param) || param === 'ctx' || param === 'context',
    );
    const requestDb = requestParam
      ? new RegExp(`\\b${escapeRegExp(requestParam)}\\.db\\b`).exec(handler.body)
      : null;
    const readsRequestDb =
      requestParam !== undefined && requestDb !== null && requestDb.index !== undefined;

    if (receivesDb) {
      const span = handler.paramSpans[dbParamIndex];
      return [
        diagnosticFor(
          fileName,
          'FW330',
          source,
          span?.start,
          span ? span.end - span.start : undefined,
        ),
      ];
    }

    if (readsRequestDb) {
      const index = handler.bodyStart + (requestDb?.index ?? 0);
      return [diagnosticFor(fileName, 'FW330', source, index, requestDb?.[0].length)];
    }
  }

  return [];
}

function validateIdrefs(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const ids = new Set(literalIdValues(model).map((id) => id.value));
  if (ids.size === 0) {
    return idrefValues(model).map((value) => fw221Diagnostic(fileName, source, value));
  }

  const missing = idrefValues(model).filter((value) => !ids.has(value.value));
  return dedupeBy(missing, (value) => value.value).map((value) =>
    fw221Diagnostic(fileName, source, value),
  );
}

function validateStaticIds(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const seen = new Set<string>();

  for (const id of literalIdValues(model)) {
    if (seen.has(id.value)) {
      diagnostics.push(fw224Diagnostic(fileName, source, `duplicate id="${id.value}"`, id));
    }
    seen.add(id.value);
  }

  for (const id of repeatableLiteralIds(source, model)) {
    diagnostics.push(fw224Diagnostic(fileName, source, `repeatable id="${id.value}"`, id));
  }

  return dedupeDiagnostics(diagnostics);
}

function literalIdValues(model: ComponentModuleModel, offset = 0): LiteralIdValue[] {
  return jsxAttributes(model).flatMap((attribute) =>
    attribute.name === 'id' && attribute.value
      ? [
          {
            index: offset + attribute.start,
            length: attribute.end - attribute.start,
            value: attribute.value,
          },
        ]
      : [],
  );
}

function repeatableLiteralIds(source: string, model: ComponentModuleModel): LiteralIdValue[] {
  return dataBindListTemplateBodies(source, model).flatMap((body) =>
    literalIdValues(parseComponentModuleModel('component.tsx', body.source), body.offset),
  );
}

function fw224Diagnostic(
  fileName: string,
  source: string,
  detail: string,
  id: LiteralIdValue,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW224', source, id.index, id.length),
    message: `${diagnosticDefinitions.FW224.message} ${detail}`,
  };
}

const blockTagsThatCloseParagraph = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

function validateHtmlContentModel(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const elements = jsxElements(model);

  for (const element of elements) {
    const tag = element.tag.toLowerCase();
    if (!isNativeHtmlTag(tag)) continue;

    if (blockTagsThatCloseParagraph.has(tag) && hasJsxAncestor(element, 'p', elements)) {
      diagnostics.push(
        htmlContentModelDiagnostic(source, fileName, element, `<${tag}> cannot appear inside <p>`),
      );
    }

    if (
      tag === 'tr' &&
      !hasJsxAttribute(element, 'fw-c') &&
      !hasAnyJsxAncestor(element, ['table', 'tbody', 'thead', 'tfoot'], elements)
    ) {
      diagnostics.push(
        htmlContentModelDiagnostic(
          source,
          fileName,
          element,
          '<tr> must be inside a table section or table',
        ),
      );
    }
  }

  return diagnostics;
}

function htmlContentModelDiagnostic(
  source: string,
  fileName: string,
  element: JsxElementModel,
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW225', source, element.start, element.openingEnd - element.start),
    message: `${diagnosticDefinitions.FW225.message} ${detail}`,
  };
}

function validateResidualStamps(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
  componentName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const knownQueries = new Set([
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...componentQueryNames(model),
  ]);
  const knownComponents = new Set([
    kebabCase(componentName),
    ...explicitComponentNames(model),
    ...(options.registryFacts?.components ?? []),
  ]);
  for (const attribute of jsxAttributes(model)) {
    if (attribute.name === 'fw-c') {
      const component = attribute.value;
      if (component && !knownComponents.has(component)) {
        diagnostics.push(
          fw226Diagnostic(
            options.fileName,
            source,
            `fw-c="${component}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
        );
      }
    }

    if (attribute.name !== 'fw-deps') continue;

    for (const dep of splitDepValue(attribute.value ?? '')) {
      const query = dep.split(':', 1)[0] ?? dep;
      if (!knownQueries.has(query)) {
        diagnostics.push(
          fw226Diagnostic(
            options.fileName,
            source,
            `fw-deps="${dep}"`,
            attribute.start,
            attribute.end - attribute.start,
          ),
        );
      }
    }
  }

  return dedupeDiagnostics(diagnostics);
}

const ambiguousRelationshipAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'htmlFor',
  'popovertarget',
]);

const primitiveOwnedOverrideAttributes = new Set(['role', 'data-state']);

function validateAttributeMergeConflicts(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const element of jsxElements(model)) {
    const attrs = element.attributes.map((attribute) => attribute.name);
    const counts = countValues(attrs);

    for (const [name, count] of counts) {
      if (count < 2) continue;
      const attribute = element.attributes.find((item) => item.name === name);
      if (!attribute) continue;

      if (isBindingAttribute(name)) {
        diagnostics.push(attributeMergeDiagnostic(source, fileName, 'FW233', name, attribute));
        continue;
      }

      if (
        ambiguousRelationshipAttributes.has(name) ||
        name.startsWith('data-p-') ||
        name === 'fw-c' ||
        name === 'fw-state'
      ) {
        diagnostics.push(attributeMergeDiagnostic(source, fileName, 'FW231', name, attribute));
        continue;
      }

      if (name.startsWith('aria-') || primitiveOwnedOverrideAttributes.has(name)) {
        diagnostics.push(attributeMergeDiagnostic(source, fileName, 'FW232', name, attribute));
      }
    }
  }

  return dedupeDiagnostics(diagnostics);
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:');
}

function attributeMergeDiagnostic(
  source: string,
  fileName: string,
  code: 'FW231' | 'FW232' | 'FW233',
  detail: string,
  attribute: JsxAttributeModel,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, code, source, attribute.start, attribute.end - attribute.start),
    message: `${diagnosticDefinitions[code].message} ${detail}`,
  };
}

function fw226Diagnostic(
  fileName: string,
  source: string,
  detail: string,
  index: number,
  length: number,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW226', source, index, length),
    message: `${diagnosticDefinitions.FW226.message} ${detail}`,
  };
}

function fw311Diagnostic(
  fileName: string,
  source: string,
  fact: QueryUpdateCoverageFact,
): CompilerDiagnostic {
  const span = queryUpdateCoverageSpan(fact);
  return {
    ...diagnosticFor(fileName, 'FW311', source, span?.start, span?.length),
    message: `${diagnosticDefinitions.FW311.message} ${fact.componentName} ${fact.query} ${fact.position}`,
  };
}

function explicitComponentNames(model: ComponentModuleModel): string[] {
  return componentExplicitNames(model);
}

function dedupeDiagnostics(diagnostics: readonly CompilerDiagnostic[]): CompilerDiagnostic[] {
  return dedupeBy(diagnostics, (diagnostic) => `${diagnostic.code}\0${diagnostic.message}`);
}

function dedupeBy<Value>(values: readonly Value[], keyFor: (value: Value) => string): Value[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateLiteralHrefs(
  source: string,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const routes = options.registryFacts?.routes;
  if (!routes) return [];

  const missing = literalNavigationTargets(source).filter((target) => {
    if (isExternalNavigationTarget(target.value)) return false;
    return !routes.some((routePath) => routePathMatchesUrl(routePath, target.value));
  });

  return dedupeBy(missing, (target) => target.value).map((target) => ({
    ...diagnosticFor(options.fileName, 'FW220', source, target.index, target.length),
    message: `${diagnosticDefinitions.FW220.message} ${target.value}`,
  }));
}

function literalNavigationTargets(source: string): LiteralNavigationTarget[] {
  return jsxAttributes(parseComponentModuleModel('component.tsx', source)).flatMap((attribute) =>
    (attribute.name === 'href' || attribute.name === 'action') && attribute.value
      ? [
          {
            index: attribute.start,
            length: attribute.end - attribute.start,
            value: attribute.value,
          },
        ]
      : [],
  );
}

function isExternalNavigationTarget(target: string): boolean {
  return (
    target.startsWith('#') ||
    target.startsWith('mailto:') ||
    target.startsWith('tel:') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
  );
}

function routePathMatchesUrl(routePath: string, target: string): boolean {
  const pathname = target.split(/[?#]/, 1)[0] ?? '';
  const pattern = `^${routePath
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')}$`;

  return new RegExp(pattern).test(pathname);
}

function fw221Diagnostic(fileName: string, source: string, value: IdrefValue): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW221', source, value.index, value.length),
    message: `${diagnosticDefinitions.FW221.message} ${value.value}`,
  };
}

function idrefValues(model: ComponentModuleModel): IdrefValue[] {
  const values: IdrefValue[] = [];
  const idrefAttributes = new Set([
    'aria-activedescendant',
    'aria-controls',
    'aria-describedby',
    'aria-labelledby',
    'aria-owns',
    'commandfor',
    'for',
    'htmlFor',
    'popovertarget',
  ]);

  for (const attribute of jsxAttributes(model)) {
    if (!idrefAttributes.has(attribute.name)) continue;
    const rawValue = attribute.value;
    if (!rawValue) continue;

    const multiValue =
      attribute.name.startsWith('aria-') && attribute.name !== 'aria-activedescendant';
    values.push(
      ...(multiValue
        ? rawValue
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => ({
              index: attribute.start,
              length: attribute.end - attribute.start,
              value,
            }))
        : [
            {
              index: attribute.start,
              length: attribute.end - attribute.start,
              value: rawValue,
            },
          ]),
    );
  }

  return values;
}

function jsxAttributes(model: ComponentModuleModel): JsxAttributeModel[] {
  return jsxElements(model).flatMap((element) => [...element.attributes]);
}

function parsedJsxElements(source: string): JsxElementModel[] {
  return jsxElements(parseComponentModuleModel('component.tsx', source));
}

function parsedCallExpressions(source: string): ReturnType<typeof callExpressions> {
  return callExpressions(parseComponentModuleModel('component.tsx', source));
}

function hasJsxAttribute(element: JsxElementModel, name: string): boolean {
  return element.attributes.some((attribute) => attribute.name === name);
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

function hasJsxAncestor(
  element: JsxElementModel,
  tag: string,
  elements: readonly JsxElementModel[],
): boolean {
  return hasAnyJsxAncestor(element, [tag], elements);
}

function hasAnyJsxAncestor(
  element: JsxElementModel,
  tags: readonly string[],
  elements: readonly JsxElementModel[],
): boolean {
  return elements.some(
    (candidate) =>
      candidate !== element &&
      isWithinElement(element, candidate) &&
      tags.includes(candidate.tag.toLowerCase()),
  );
}

function isNativeHtmlTag(tag: string): boolean {
  return tag === tag.toLowerCase() && !tag.includes('-');
}

function readParameterName(param: string): string {
  const withoutType = param.split(':')[0]?.trim() ?? '';
  return withoutType.replace(/^[.{\s]+|[}\s]+$/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface EventPayloadPath {
  index: number;
  length: number;
  path: string;
}

function eventPayloads(model: ComponentModuleModel): EventPayloadPath[] {
  const payloads: EventPayloadPath[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'emit')) {
    const payload = call.arguments[1]?.trim();
    if (!payload?.startsWith('{')) continue;
    const span = call.argumentSpans[1];
    if (!span) continue;

    payloads.push(
      ...objectLiteralPropertyPaths('payload.tsx', payload).map((path) => ({
        index: span.start,
        length: span.end - span.start,
        path,
      })),
    );
  }

  return payloads;
}

function queryShapePaths(queryShapes: Record<string, QueryShape>): string[] {
  return Object.entries(queryShapes).flatMap(([queryName, shape]) => [
    queryName,
    ...queryShapeChildPaths(shape).flatMap((path) => [`${queryName}.${path}`, path]),
  ]);
}

function queryShapeChildPaths(shape: QueryShape): string[] {
  const current = unwrapQueryShape(shape);
  if (isArrayShape(current)) {
    const itemShape = current[0];
    return itemShape === undefined ? [] : queryShapeChildPaths(itemShape);
  }

  if (!isQueryShapeObject(current)) return [];

  return Object.entries(current).flatMap(([key, child]) => [
    key,
    ...queryShapeChildPaths(child ?? 'object').map((path) => `${key}.${path}`),
  ]);
}

function topLevelObjectKeys(objectSource: string): string[] {
  const keys: string[] = [];
  let index = 1;

  while (index < objectSource.length - 1) {
    index = skipWhitespaceAndComments(objectSource, index);
    if (objectSource[index] === ',') {
      index += 1;
      continue;
    }

    const key = readObjectKey(objectSource, index);
    if (!key) {
      index = skipObjectValue(objectSource, index);
      continue;
    }

    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] === ':') {
      keys.push(key.name);
      index = skipObjectValue(objectSource, afterKey + 1);
      continue;
    }

    keys.push(key.name);
    index = skipObjectValue(objectSource, afterKey);
  }

  return keys;
}

function topLevelObjectEntries(objectSource: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  let index = 1;

  while (index < objectSource.length - 1) {
    index = skipWhitespaceAndComments(objectSource, index);
    if (objectSource[index] === ',') {
      index += 1;
      continue;
    }

    const key = readObjectKey(objectSource, index);
    if (!key) {
      index = skipObjectValue(objectSource, index);
      continue;
    }

    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] !== ':') {
      index = skipObjectValue(objectSource, afterKey);
      continue;
    }

    const valueStart = skipWhitespaceAndComments(objectSource, afterKey + 1);
    const valueEnd = skipObjectValue(objectSource, valueStart);
    entries.push({ key: key.name, value: objectSource.slice(valueStart, valueEnd).trim() });
    index = valueEnd;
  }

  return entries;
}

function readObjectKey(source: string, start: number): { name: string; end: number } | null {
  const char = source[start];
  if (char === '"' || char === "'") {
    const end = findStringEnd(source, start, char);
    if (end === -1) return null;

    return {
      end: end + 1,
      name: source.slice(start + 1, end),
    };
  }

  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));
  if (!identifier?.[0]) return null;

  return {
    end: start + identifier[0].length,
    name: identifier[0],
  };
}

function skipObjectValue(source: string, start: number): number {
  let index = start;
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;

  while (index < source.length - 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length - 1 : end + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length - 1 : nextLine + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length - 1 : commentEnd + 2;
      continue;
    }

    if (char === '{') curlyDepth += 1;
    if (char === '}') {
      if (curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) return index;
      curlyDepth -= 1;
    }

    if (char === '[') squareDepth += 1;
    if (char === ']') squareDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;

    if (char === ',' && curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    return index;
  }

  return index;
}

function stateKeyHasQueryPrefix(stateKey: string, queryName: string): boolean {
  if (stateKey === queryName) return true;
  if (!stateKey.startsWith(queryName)) return false;

  const nextChar = stateKey[queryName.length];
  return nextChar !== undefined && /[A-Z0-9_$]/.test(nextChar);
}

function isArrayShape(shape: QueryShape): shape is readonly QueryShape[] {
  return Array.isArray(shape);
}

function unwrapQueryShape(shape: QueryShape): QueryShape {
  let current = shape;
  while (isQueryShapeWrapper(current)) current = current.shape;
  return current;
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return false;
  const record = shape as Record<string, unknown>;
  return (record.kind === 'nullable' || record.kind === 'optional') && 'shape' in shape;
}

function isQueryShapeObject(shape: QueryShape): shape is { readonly [key: string]: QueryShape } {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    !isQueryShapeWrapper(shape)
  );
}

function emitClientModule(
  handlers: HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  componentName: string,
): string {
  const imports = [
    ...(queryUpdatePlans.length > 0 ? ['applyCompiledQueryUpdatePlan'] : []),
    ...(queryUpdatePlans.some((plan) => (plan.derives?.length ?? 0) > 0) ? ['derive'] : []),
    ...(handlers.length > 0 ? ['handler'] : []),
  ].sort();
  const importLine =
    imports.length > 0 ? `import { ${imports.join(', ')} } from '@jiso/runtime';\n\n` : '';
  const handlerExports = handlers.length
    ? handlers
        .map(
          (handler) =>
            `export const ${handler.exportName} = handler((event, ctx) => {\n${indent(emitHandlerBody(handler))}\n});`,
        )
        .join('\n')
    : '';
  const queryPlanExport = emitQueryUpdatePlanExport(componentName, queryUpdatePlans);
  const exports = [handlerExports, queryPlanExport].filter(Boolean).join('\n\n');

  return `${irHeader}
${importLine}${exports || '// no client handlers emitted'}
`;
}

function emitHandlerBody(handler: HandlerLowering): string {
  const namedHandler = /^[A-Za-z_$][\w$]*$/.test(handler.expression);
  if (namedHandler) {
    return `return ${handler.expression}(event, ctx);`;
  }

  const arrowBody = arrowExpressionBody(handler.expression);
  if (!arrowBody) return '// unsupported handler expression was preserved as a diagnostic surface';
  if (arrowBody.startsWith('{') && arrowBody.endsWith('}')) {
    return lowerHandlerExpression(arrowBody.slice(1, -1).trim(), handler.params);
  }

  return `return ${lowerHandlerExpression(arrowBody, handler.params)};`;
}

function arrowExpressionBody(expression: string): string | null {
  const arrow = /^\(\)\s*=>\s*(?<body>[\s\S]+)$/.exec(expression);
  const body = arrow?.groups?.body;
  return body ? body.trim() : null;
}

function lowerHandlerExpression(expression: string, params: readonly ElementParam[]): string {
  let lowered = expression.replace(/\bstate\b/g, 'ctx.state');

  for (const param of params) {
    const sourceExpression = param.value.slice(1, -1);
    if (!sourceExpression) continue;

    lowered = lowered.replace(
      new RegExp(`(?<![\\w$])${escapeRegExp(sourceExpression)}(?![\\w$])`, 'g'),
      `ctx.params.${paramNameFromAttribute(param.attributeName)}`,
    );
  }

  return lowered;
}

function paramNameFromAttribute(attributeName: string): string {
  return attributeName
    .replace(/^data-p-/, '')
    .replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function emitQueryUpdatePlanExport(
  componentName: string,
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
): string {
  if (queryUpdatePlans.length === 0) return '';

  const deriveExports = queryUpdatePlans
    .flatMap((plan) => plan.derives ?? [])
    .map(
      (derive) =>
        `export const ${derive.exportName} = derive([${JSON.stringify(derive.input)}], (${derive.param}) => ${derive.expression});`,
    )
    .join('\n');
  const entries = queryUpdatePlans
    .map(
      (plan) =>
        `  ${JSON.stringify(plan.query)}(root, value) {\n    return applyCompiledQueryUpdatePlan(root, ${JSON.stringify(plan.query)}, value, { bindings: true, derives: [${plan.derives?.map(emitDerivePlan).join(', ') ?? ''}], stamps: [], templateStamps: [${plan.templateStamps?.map(emitTemplateStampPlan).join(', ') ?? ''}] });\n  },`,
    )
    .join('\n');

  return `${deriveExports ? `${deriveExports}\n\n` : ''}export const ${componentName}$queryUpdatePlans = {\n${entries}\n};`;
}

function emitDerivePlan(derive: QueryDeriveFact): string {
  return `{ name: ${JSON.stringify(derive.name)}, selector: ${JSON.stringify(derive.selector)}, select(value) { return ${derive.exportName}.run(value); } }`;
}

function emitTemplateStampPlan(stamp: QueryTemplateStampFact): string {
  return `{ key: ${JSON.stringify(stamp.key)}, list: ${JSON.stringify(
    stamp.list.split('.').slice(1).join('.'),
  )}, selector: ${JSON.stringify(stamp.selector)}, render(item) {
      const record = item && typeof item === "object" ? item : {};
      const read = (path) => path.split(".").reduce((value, part) => value && typeof value === "object" ? value[part] : undefined, record);
      let html = ${JSON.stringify(stamp.template)};
${stamp.itemBindings
  .map(
    (binding) =>
      `      html = html.replace(${JSON.stringify(bindingValuePlaceholder(stamp.template, binding))}, String(read(${JSON.stringify(binding.slice(1))}) ?? ""));`,
  )
  .join('\n')}
      return html;
    } }`;
}

function bindingValuePlaceholder(template: string, binding: string): string {
  const match = new RegExp(
    `(<[^>]+\\bdata-bind=(["'])${escapeRegExp(binding)}\\2[^>]*>)(?<value>[\\s\\S]*?)(</[^>]+>)`,
  ).exec(template);
  return match?.groups?.value ?? '';
}

function emitServerModule(
  source: string,
  handlers: HandlerLowering[],
  _clientFileName: string,
): string {
  const renderedSource = serverRenderSource(source, handlers);

  return `${irHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}

function serverRenderSource(source: string, handlers: readonly HandlerLowering[]): string {
  return stampInitialState(stampDeclaredQueryDeps(replaceHandlerAttributes(source, handlers)));
}

function renderEquivalenceCheck(
  artifact: string,
  expected: string,
  serverSource: string,
): RenderEquivalenceCheck {
  const actual = emittedServerRenderSource(serverSource);

  return {
    actual,
    artifact,
    expected,
    ok: actual === expected,
  };
}

function emittedServerRenderSource(serverSource: string): string {
  const returnIndex = serverSource.indexOf('return `');
  if (returnIndex < 0) return '';

  const start = returnIndex + 'return `'.length;
  let escaped = false;
  let raw = '';

  for (let index = start; index < serverSource.length; index += 1) {
    const char = serverSource[index];
    if (escaped) {
      if (char === '$' && serverSource[index + 1] === '{') {
        raw += '${';
        index += 1;
      } else {
        raw += char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '`') return raw;

    raw += char;
  }

  return '';
}

function replaceHandlerAttributes(source: string, handlers: readonly HandlerLowering[]): string {
  return [...handlers]
    .sort((left, right) => right.attributeStart - left.attributeStart)
    .reduce((next, handler) => {
      const replacement = [
        `${handler.attributeName}="${handler.attributeValue}"`,
        emitElementParamTypes(handler.params),
        ...handler.params.map(
          (param) => `${param.attributeName}="${escapeAttribute(param.value)}"`,
        ),
      ]
        .filter(Boolean)
        .join(' ');

      return `${next.slice(0, handler.attributeStart)}${replacement}${next.slice(handler.attributeEnd)}`;
    }, source);
}

function stampDeclaredQueryDeps(source: string): string {
  const model = parseComponentModuleModel('component.tsx', source);
  const queryObject = componentOptionSource(model, 'queries');
  const deps = topLevelObjectKeys(queryObject ?? '{}');
  if (deps.length === 0) return source;

  const tag = componentRenderHost(model);
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end);
  const stampedTag = stampOpeningTagDeps(tagSource, deps);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end)}`;
}

function stampInitialState(source: string): string {
  const stateJson = staticStateJson(source);
  if (!stateJson) return source;

  const tag = componentRenderHost(parseComponentModuleModel('component.tsx', source));
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end);
  const stampedTag = stampOpeningTagAttribute(tagSource, 'fw-state', stateJson);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end)}`;
}

function stampOpeningTagDeps(tagSource: string, deps: readonly string[]): string {
  const depValue = mergeDepValues(readFwDepsAttribute(tagSource), deps).join(' ');
  const existing = /\bfw-deps=(["'])(?<deps>[^"']*)\1/.exec(tagSource);
  if (existing?.groups) {
    return `${tagSource.slice(0, existing.index)}fw-deps=${existing[1]}${depValue}${existing[1]}${tagSource.slice(existing.index + existing[0].length)}`;
  }

  return stampOpeningTagAttribute(tagSource, 'fw-deps', depValue);
}

function stampOpeningTagAttribute(tagSource: string, name: string, value: string): string {
  return tagSource.replace(/\s*\/?>$/, (suffix) =>
    suffix.includes('/')
      ? ` ${name}="${escapeAttribute(value)}" />`
      : ` ${name}="${escapeAttribute(value)}">`,
  );
}

function readFwDepsAttribute(tagSource: string): string[] {
  const match = /\bfw-deps=(["'])(?<deps>[^"']*)\1/.exec(tagSource);
  return splitDepValue(match?.groups?.deps ?? '');
}

function mergeDepValues(existing: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...existing, ...declared])];
}

function splitDepValue(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

function staticStateJson(source: string): string | null {
  const stateObject = componentStateReturnObject(
    parseComponentModuleModel('component.tsx', source),
  );
  if (!stateObject) return null;

  const parsed = parseLiteralObject(stateObject);
  return parsed ? JSON.stringify(parsed) : null;
}

function replaceExtension(fileName: string, extension: string): string {
  return fileName.replace(/\.[^.]+$/, extension);
}

function templateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

function extractElementParams(expression: string): ElementParam[] {
  const callMatch = /^\(\)\s*=>\s*[A-Za-z_$][\w$]*\((?<args>.*)\)$/.exec(expression);
  const expressions = callMatch?.groups?.args
    ? splitArguments(callMatch.groups.args)
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0 && arg !== 'state')
        .flatMap((arg) => {
          if (literalValue(arg) !== undefined) return [];
          const members = serializableMemberExpressions(arg);
          return members.length > 0 ? members : [arg];
        })
    : serializableMemberExpressions(expression);

  return dedupeStrings(expressions).map((arg) => ({
    attributeName: `data-p-${paramNameForExpression(arg)}`,
    type: inferElementParamType(expression, arg),
    value: `{${arg}}`,
  }));
}

function emitElementParamTypes(params: readonly ElementParam[]): string {
  const typedParams = params.filter((param) => param.type !== 'string');
  if (typedParams.length === 0) return '';

  const entries = typedParams
    .map((param) => `${paramNameFromAttribute(param.attributeName)}:${param.type}`)
    .join(',');
  return `fw-param-types="${entries}"`;
}

function inferElementParamType(expression: string, sourceExpression: string): ElementParamType {
  const ref = sourceExpressionRef(sourceExpression);
  if (usedAsBoolean(expression, ref)) return 'boolean';
  if (usedAsNumber(expression, ref)) return 'number';

  return 'string';
}

function sourceExpressionRef(sourceExpression: string): string {
  return `(?<![\\w$])${escapeRegExp(sourceExpression)}(?![\\w$])`;
}

function usedAsBoolean(expression: string, ref: string): boolean {
  return (
    new RegExp(`!\\s*${ref}`).test(expression) ||
    new RegExp(`${ref}\\s*(?:\\?|&&|\\|\\|)`).test(expression) ||
    new RegExp(`(?:&&|\\|\\|)\\s*${ref}`).test(expression) ||
    new RegExp(`${ref}\\s*(?:===|!==|==|!=)\\s*(?:true|false)\\b`).test(expression) ||
    new RegExp(`(?:true|false)\\s*(?:===|!==|==|!=)\\s*${ref}`).test(expression)
  );
}

function usedAsNumber(expression: string, ref: string): boolean {
  return (
    new RegExp(`(?:[+\\-*/%]=|[-*/%])\\s*${ref}`).test(expression) ||
    new RegExp(`${ref}\\s*(?:[-*/%]|[+\\-*/%]=)`).test(expression) ||
    new RegExp(`${ref}\\s*(?:===|!==|==|!=|[<>]=?)\\s*-?\\d`).test(expression) ||
    new RegExp(`-?\\d(?:\\.\\d+)?\\s*(?:===|!==|==|!=|[<>]=?)\\s*${ref}`).test(expression)
  );
}

function serializableMemberExpressions(expression: string): string[] {
  const members = expression.match(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g) ?? [];

  return members.filter(
    (member) =>
      !member.startsWith('state.') &&
      !member.startsWith('ctx.') &&
      !member.startsWith('document.') &&
      !member.startsWith('window.'),
  );
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(args.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(args.slice(start));
  return parts;
}

function paramNameForExpression(expression: string): string {
  const segments = expression
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  const last = segments.at(-1) ?? expression;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

interface FragmentTargetFact {
  propsType: string;
  target: string;
}

function findFragmentTargetFacts(source: string, componentName: string): FragmentTargetFact[] {
  const model = parseComponentModuleModel('component.tsx', source);
  const fragmentTarget = componentOptionSource(model, 'fragmentTarget');
  if (fragmentTarget !== 'true' && !/fragmentTarget\s*:\s*true/.test(source)) return [];

  const explicitName = firstComponentModel(model)?.explicitName;
  return [
    {
      propsType: fragmentTargetPropsType(source),
      target: explicitName ?? kebabCase(componentName),
    },
  ];
}

function componentGraphFact(
  componentName: string,
  model: ComponentModuleModel,
  fragmentTargets: readonly string[],
): ComponentGraphFact {
  const queries = componentQueryNames(model);

  return {
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    name: componentName,
    ...(queries.length === 0 ? {} : { queries }),
  };
}

function componentQueryNames(model: ComponentModuleModel): string[] {
  return topLevelObjectKeys(componentOptionSource(model, 'queries') ?? '{}');
}

function fragmentTargetPropsType(source: string): string {
  const propsObject = componentOptionSource(
    parseComponentModuleModel('component.tsx', source),
    'props',
  );
  if (!propsObject) return '{}';

  const props = topLevelObjectEntries(propsObject)
    .map((entry) => ({
      key: entry.key,
      type: propConstructorType(entry.value),
    }))
    .filter((entry): entry is { key: string; type: string } => entry.type !== undefined);

  if (props.length === 0) return '{}';

  return `{ ${props.map((prop) => `${prop.key}: ${prop.type}`).join('; ')} }`;
}

function propConstructorType(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === 'String') return 'string';
  if (trimmed === 'Number') return 'number';
  if (trimmed === 'Boolean') return 'boolean';
  return undefined;
}

function emitRegistryModule(options: {
  clientFileName: string;
  cssAssets: readonly ComponentCssAsset[];
  componentName: string;
  fragmentTargetFacts: readonly FragmentTargetFact[];
  handlers: HandlerLowering[];
  platformSubstitutions: PlatformSubstitution[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  registryFacts?: RegistryFacts;
  viewTransitions: ViewTransitionStamp[];
}): string {
  const handlerModuleLine = options.handlers.length
    ? `  '#${kebabCase(options.componentName)}': typeof import('../${options.clientFileName}');`
    : '';
  const fragmentTargetLines = options.fragmentTargetFacts
    .map((fact) => `  '${fact.target}': ${fact.propsType};`)
    .join('\n');
  const platformSubstitutionLines = options.platformSubstitutions
    .map(
      (substitution) =>
        `  '${options.componentName}:${substitution.tag}:${substitution.event}:${substitution.target}': '${substitution.kind}:${substitution.action}';`,
    )
    .join('\n');
  const viewTransitionLines = options.viewTransitions
    .map((stamp) => `  '${stamp.name}': unknown;`)
    .join('\n');
  const queryUpdatePlanLines = options.queryUpdatePlans
    .map(
      (plan) =>
        `  '${plan.componentName}:${plan.query}': readonly [${plan.paths.map((path) => `'${path}'`).join(', ')}];`,
    )
    .join('\n');
  const stylesheetLines = options.cssAssets.map(componentStylesheetLine).join('\n');
  const queryRegistryLines = registryTypeFactLines(options.registryFacts?.queries);
  const mutationRegistryLines = registryTypeFactLines(options.registryFacts?.mutations);
  const routeRegistryLines = routeRegistryFactLines(options.registryFacts?.routes);
  const invalidationSetLines = invalidationSetFactLines(options.registryFacts?.invalidations);
  const domainKey = registryDomainKey(options.registryFacts?.domainKeys);

  return `${irHeader}
export interface HandlerModules {
${handlerModuleLine}
}

export interface FragmentTargets {
${fragmentTargetLines}
}

export interface PlatformSubstitutions {
${platformSubstitutionLines}
}

export interface ViewTransitions {
${viewTransitionLines}
}

export interface QueryUpdatePlans {
${queryUpdatePlanLines}
}

export interface ComponentStylesheets {
${stylesheetLines}
}

export interface QueryRegistry {
${queryRegistryLines}
}

export interface MutationRegistry {
${mutationRegistryLines}
}

export interface RouteRegistry {
${routeRegistryLines}
}

export interface InvalidationSets {
${invalidationSetLines}
}

declare module '@jiso/core' {
  interface FragmentTargets {
${fragmentTargetLines}
  }

  interface QueryRegistry {
${queryRegistryLines}
  }

  interface MutationRegistry {
${mutationRegistryLines}
  }

  interface RouteRegistry {
${routeRegistryLines}
  }

  interface InvalidationSets {
${invalidationSetLines}
  }
}

export type DomainKey = ${domainKey};
`;
}

function componentStylesheetLine(asset: ComponentCssAsset): string {
  const fragmentTargets =
    asset.fragmentTargets.length === 0
      ? 'readonly []'
      : `readonly [${asset.fragmentTargets.map((target) => `'${target}'`).join(', ')}]`;
  return `  '${asset.componentName}': { href: '${asset.href}'; sourceFileName: '${asset.sourceFileName}'; fragmentTargets: ${fragmentTargets}; };`;
}

function registryTypeFactLines(facts: RegistryTypeFacts | undefined): string {
  return Object.entries(facts ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, typeExpression]) => `  '${key}': ${typeExpression};`)
    .join('\n');
}

function routeRegistryFactLines(routes: readonly string[] | undefined): string {
  return [...new Set(routes ?? [])]
    .sort((left, right) => left.localeCompare(right))
    .map((routePath) => `  '${routePath}': import('@jiso/core').Route<'${routePath}'>;`)
    .join('\n');
}

function invalidationSetFactLines(
  invalidations: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  return Object.entries(invalidations ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mutationKey, queryKeys]) => {
      const queryUnion =
        [...new Set(queryKeys)]
          .sort()
          .map((queryKey) => `'${queryKey}'`)
          .join(' | ') || 'never';
      return `  '${mutationKey}': ${queryUnion};`;
    })
    .join('\n');
}

function registryDomainKey(domainKeys: readonly string[] | undefined): string {
  const keys = [...new Set(domainKeys ?? [])].sort();
  return keys.map((key) => JSON.stringify(key)).join(' | ') || 'never';
}
