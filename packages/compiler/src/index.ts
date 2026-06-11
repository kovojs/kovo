import { diagnosticDefinitions, type DiagnosticCode } from '@jiso/core';

import { componentCssAssetForFile, emitCssModule, type ComponentCssAsset } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import { emitClientModule } from './emit/client.js';
import { emitRegistryModule } from './emit/registry.js';
import { emitServerModule, renderEquivalenceCheck, serverRenderSource } from './emit/server.js';
import {
  componentGraphFact,
  findFragmentTargetFacts,
  type ComponentGraphFact,
  type RegistryFacts,
} from './graph.js';
import {
  clientModuleUrl,
  clientModuleVersion,
  capturesUnserializableValue,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { lowerNavigationSugar } from './lower/navigation.js';
import { lowerPlatformBehaviors, type PlatformSubstitution } from './lower/platform.js';
import { lowerViewTransitions } from './lower/view-transitions.js';
import { topLevelObjectKeys } from './scan/object.js';
import {
  callExpressions,
  componentFragmentTargetNames,
  componentOptionSource,
  componentRenderInputModels,
  componentStateReturnObjectModel,
  firstComponentModel,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  jsxElements,
  jsxExpressions,
  mutationHandlers,
  objectLiteralPropertyPaths,
  parseComponentModule as parseComponentModuleModel,
  propertyAccessPaths,
} from './scan/parse.js';
import { dedupeBy, escapeAttribute, replaceExtension } from './shared.js';
import {
  collectQueryUpdateCoverage,
  collectQueryUpdatePlans,
  queryUpdateCoverageSpan,
  validateDataBindings,
  validateStampExpressionDrift,
} from './validate/bindings.js';
import { validateEventTriggerNames } from './validate/event-triggers.js';
import {
  validateAttributeMergeConflicts,
  validateHtmlContentModel,
  validateIdrefs,
  validateResidualStamps,
  validateStaticIds,
} from './validate/markup.js';
import { validateLiteralHrefs } from './validate/navigation.js';
import { createJisoVitePlugin, type JisoVitePlugin } from './vite.js';

export type { DiagnosticCode };
export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export type { QueryPlanBootstrapInput, QueryPlanBootstrapOptions } from './emit/bootstrap.js';
export { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
export type { JisoViteDevServer, JisoViteMiddleware, JisoVitePlugin } from './vite.js';
export type { PlatformSubstitution } from './lower/platform.js';
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
  stamps?: readonly QueryStampFact[];
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

export interface QueryStampFact {
  attr: string;
  derive: QueryDeriveFact;
  selector: string;
}

export interface QueryTemplateStampFact {
  itemBindings: readonly string[];
  key: string;
  list: string;
  selector: string;
  template: string;
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

export interface ViewTransitionStamp {
  name: string;
}

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
  ({ options, originalModel }) =>
    validateStampExpressionDrift(options.source, originalModel, options),
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
  const deriveLowering = lowerInlineAttributeDerives(
    navigationLowering.source,
    componentName,
    options,
  );
  const source = deriveLowering.source;
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

  const clientSource = emitClientModule(handlers, queryUpdatePlans, componentName, irHeader);
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
  const serverSource = emitServerModule(source, versionedHandlers);
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
  return createJisoVitePlugin(compileComponentModule);
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

function lowerInlineAttributeDerives(
  source: string,
  componentName: string,
  options: CompileComponentOptions,
): { source: string } {
  const model = parseComponentModuleModel(options.fileName, source);
  const knownQueries = new Set([
    ...topLevelObjectKeys(componentOptionSource(model, 'queries') ?? '{}'),
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...Object.keys(options.queryShapes ?? {}),
    ...(options.queryShapeFacts ?? []).map((fact) => fact.query),
  ]);
  if (knownQueries.size === 0) return { source };

  const replacements: Array<{ end: number; start: number; value: string }> = [];
  const deriveExports: string[] = [];
  const nameCounts = new Map<string, number>();

  for (const element of jsxElements(model)) {
    if (
      element.attributes.some((attribute) =>
        ['data-derive', 'data-derive-attr'].includes(attribute.name),
      )
    ) {
      continue;
    }

    const candidates = element.attributes
      .map((attribute) => inlineAttributeDerive(attribute, element, componentName, knownQueries))
      .filter((candidate): candidate is InlineAttributeDerive => candidate !== null);

    const candidate = candidates[0];
    if (!candidate || candidates.length !== 1) continue;
    const count = nameCounts.get(candidate.baseName) ?? 0;
    nameCounts.set(candidate.baseName, count + 1);
    const exportName = count === 0 ? candidate.baseName : `${candidate.baseName}_${count + 1}`;
    const stampName = `${candidate.query}.${exportName}`;

    deriveExports.push(
      `export const ${exportName} = derive([${JSON.stringify(candidate.query)}], (${candidate.query}) => ${candidate.expression});`,
    );
    replacements.push({
      end: candidate.attribute.end,
      start: candidate.attribute.start,
      value: `data-derive="${escapeAttribute(stampName)}" data-derive-attr="${escapeAttribute(candidate.attribute.name)}"`,
    });
  }

  for (const element of jsxElements(model)) {
    const binding = inlineTextBinding(element, source, knownQueries);
    if (!binding) continue;

    replacements.push({
      end: element.openingEnd - 1,
      start: element.openingEnd - 1,
      value: ` data-bind="${escapeAttribute(binding)}"`,
    });
  }

  for (const expression of jsxExpressions(model)) {
    const binding = inlineMixedTextBinding(expression, model, source, knownQueries);
    if (!binding) continue;

    replacements.push({
      end: binding.end,
      start: binding.start,
      value: `<span data-bind="${escapeAttribute(binding.path)}">{${binding.path}}</span>`,
    });
  }

  if (replacements.length === 0) return { source };

  const lowered = replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (output, replacement) =>
        `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`,
      source,
    );

  return { source: `${deriveExports.join('\n')}\n\n${lowered}` };
}

interface InlineAttributeDerive {
  attribute: JsxAttributeModel;
  baseName: string;
  expression: string;
  query: string;
}

function inlineAttributeDerive(
  attribute: JsxAttributeModel,
  element: JsxElementModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;
  if (shouldSkipInlineAttributeDerive(attribute.name)) return null;

  const paths = propertyAccessPaths('attribute-expression.tsx', attribute.expression);
  const queryRoots = new Set(
    paths
      .map((path) => path.split('.', 1)[0])
      .filter((query): query is string => query !== undefined && knownQueries.has(query)),
  );
  if (queryRoots.size !== 1) return null;

  const query = [...queryRoots][0];
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attribute.name)}_derive`,
    expression: attribute.expression.trim(),
    query,
  };
}

function shouldSkipInlineAttributeDerive(name: string): boolean {
  return (
    name === 'className' ||
    name === 'data-derive' ||
    name === 'data-derive-attr' ||
    name === 'data-bind' ||
    name.startsWith('data-bind:') ||
    name.startsWith('data-p-') ||
    name.startsWith('fw-') ||
    name.startsWith('on') ||
    name.startsWith('on:')
  );
}

function inlineTextBinding(
  element: JsxElementModel,
  source: string,
  knownQueries: ReadonlySet<string>,
): string | null {
  if (element.selfClosing) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;

  const content = source.slice(element.openingEnd, element.closingStart);
  const expression = /^\s*\{\s*(?<path>[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)\s*\}\s*$/.exec(
    content,
  )?.groups?.path;
  if (!expression) return null;

  const query = expression.split('.', 1)[0];
  return query && knownQueries.has(query) ? expression : null;
}

function inlineMixedTextBinding(
  expression: { end: number; expression: string; start: number },
  model: ComponentModuleModel,
  source: string,
  knownQueries: ReadonlySet<string>,
): { end: number; path: string; start: number } | null {
  const path = soleKnownQueryPath(expression.expression, knownQueries);
  if (!path) return null;
  if (isJsxAttributeExpression(expression, model)) return null;

  const element = innermostContainingElement(expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
  if (inlineTextBinding(element, source, knownQueries) !== null) return null;

  const start = source.lastIndexOf('{', expression.start);
  const end = source.indexOf('}', expression.end);
  if (start === -1 || end === -1 || start < element.openingEnd || end > element.closingStart) {
    return null;
  }

  return { end: end + 1, path, start };
}

function soleKnownQueryPath(expression: string, knownQueries: ReadonlySet<string>): string | null {
  const path =
    /^(?<path>[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+)$/.exec(expression.trim())?.groups?.path ??
    null;
  if (!path) return null;

  const query = path.split('.', 1)[0];
  return query && knownQueries.has(query) ? path : null;
}

function isJsxAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  return jsxElements(model).some((element) =>
    element.attributes.some(
      (attribute) =>
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    ),
  );
}

function innermostContainingElement(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): JsxElementModel | null {
  return (
    jsxElements(model)
      .filter(
        (element) =>
          !element.selfClosing &&
          expression.start >= element.openingEnd &&
          expression.end <= element.closingStart,
      )
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0] ?? null
  );
}

function isBindingAttributeName(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:') || name === 'data-bind-list';
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
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
  const labels = definition.detailLabels;
  return {
    ...diagnosticFor(fileName, 'FW230', source, body.offset, body.source.length),
    help: [
      `${labels.slotHoist} ${target}$slot_children`,
      `${labels.blockedChildren} ${body.source}`,
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
