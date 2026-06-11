import { diagnosticDefinitions, type DiagnosticCode } from '@jiso/core';

import { componentCssAssetForFile, emitCssModule, type ComponentCssAsset } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type { ComponentGraphFact, RegistryFacts, RegistryTypeFacts } from './graph.js';
import { findStringEnd } from './scan/text.js';
import {
  callExpressions,
  componentExplicitNames,
  componentFragmentTargetNames,
  componentOptionSource,
  componentRenderHost,
  componentRenderInputs,
  componentStateReturnObject,
  firstComponentModel,
  identifierReferences,
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
import { escapeAttribute, indent, kebabCase } from './shared.js';
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
  updateCoverage: readonly QueryUpdateCoverageFact[];
  viewTransitions: ViewTransitionStamp[];
}

export interface QueryUpdatePlanFact {
  componentName: string;
  paths: readonly string[];
  query: string;
  templateStamps?: readonly QueryTemplateStampFact[];
}

export interface QueryTemplateStampFact {
  itemBindings: readonly string[];
  key: string;
  list: string;
  selector: string;
  template: string;
}

interface DataBindAttribute {
  index: number;
  length: number;
  name: string;
  path: string;
}

interface IdrefValue {
  index: number;
  length: number;
  value: string;
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
  value: string;
}

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
  name: 'jiso';
  transform: (
    source: string,
    id: string,
  ) => null | {
    code: string;
    map: null;
  };
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
  ({ model, options }) => validateServerFactsInLocalState(model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetInputs(source, model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetChildren(source, model, options.fileName),
  ({ model, options, source }) => validateDataBindings(source, model, options),
  ({ model, options, source }) => validateStampExpressionDrift(source, model, options),
  ({ options, source }) => validateEventPayloads(source, options),
  ({ options, source }) => validateDirectDbAccess(source, options.fileName),
  ({ options, originalModel }) => validateIdrefs(options.source, originalModel, options.fileName),
  ({ model, options, source }) => validateStaticIds(source, model, options.fileName),
  ({ options, source }) => validateLiteralHrefs(source, options),
  ({ model, options, source }) => validateHtmlContentModel(source, model, options.fileName),
  ({ model, options, source }) => validateEventTriggerNames(source, model, options.fileName),
  ({ componentName, model, options, source }) =>
    validateResidualStamps(source, model, options, componentName),
  ({ model, options, source }) => validateAttributeMergeConflicts(source, model, options.fileName),
  ({ options, updateCoverage }) =>
    updateCoverage
      .filter((fact) => fact.status === 'UNHANDLED')
      .map((fact) => fw311Diagnostic(options.fileName, fact)),
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
  const cssSource = emitCssModule(source, componentName);
  const fragmentTargetFacts = findFragmentTargetFacts(source, componentName);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const componentGraphFacts = [componentGraphFact(componentName, model, fragmentTargets)];
  const cssAssets = cssSource
    ? [componentCssAssetForFile(cssFileName, componentName, fragmentTargets, {}, cssSource)]
    : [];
  const serverSource = emitServerModule(source, handlers, clientFileName);
  const registrySource = emitRegistryModule({
    clientFileName,
    cssAssets,
    componentName,
    fragmentTargetFacts,
    handlers,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    ...(options.registryFacts ? { registryFacts: options.registryFacts } : {}),
    viewTransitions: viewTransitionLowering.stamps,
  });

  return {
    componentGraphFacts,
    diagnostics: [
      ...handlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
      ...validationDiagnostics,
    ],
    files: [
      { fileName: serverFileName, kind: 'server', source: serverSource },
      { fileName: clientFileName, kind: 'client', source: clientSource },
      ...(cssSource ? [{ fileName: cssFileName, kind: 'css' as const, source: cssSource }] : []),
      { fileName: registryFileName, kind: 'registry', source: registrySource },
    ],
    handlerExports: handlers.map((handler) => handler.exportName),
    cssAssets,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
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
  return {
    name: 'jiso',
    transform(source: string, id: string) {
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const result = compileComponentModule({ fileName: id, source });
      return {
        code: result.files.find((file) => file.kind === 'server')?.source ?? source,
        map: null,
      };
    },
  };
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
  return {
    ...diagnosticFor(fileName, 'FW201', source, offset, lowering.attributeName.length),
    help: [
      `Would lower to: ${lowering.attributeName}="${clientModuleUrl(fileName)}#${lowering.exportName}"`,
      `Blocked expression: ${lowering.expression}`,
      `Element params: ${lowering.params.map((param) => param.attributeName).join(', ') || '-'}`,
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    ].join('\n'),
  };
}

function clientModuleUrl(fileName: string): string {
  return `/c/${replaceExtension(fileName, '.client.js').replace(/^\/+/, '')}`;
}

function validateDataBindings(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const listStamps = dataBindListStamps(source, model);

  return dataBindAttributes(model)
    .filter((binding) => !binding.path.startsWith('.'))
    .filter((binding) => !pathExistsInQueryShapes(binding.path, queryShapes))
    .map((binding) => ({
      ...diagnosticFor(options.fileName, 'FW302', source, binding.index, binding.length),
      message: `${diagnosticDefinitions.FW302.message} ${binding.path}`,
    }))
    .concat(
      listStamps
        .filter((stamp) => !listStampExistsInQueryShapes(stamp, queryShapes))
        .map((stamp) => ({
          ...diagnosticFor(options.fileName, 'FW302'),
          message: `${diagnosticDefinitions.FW302.message} ${stamp.list}`,
        })),
    );
}

function validateStampExpressionDrift(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const knownQueries = knownQueryNames(model, options);

  return bindingExpressionStamps(source, model)
    .filter(
      (stamp) =>
        queryPathUsesKnownQuery(stamp.binding, knownQueries) &&
        queryPathUsesKnownQuery(stamp.expression, knownQueries),
    )
    .map((stamp) => {
      const code = stamp.binding === stamp.expression ? 'FW223' : 'FW222';

      return {
        ...diagnosticFor(options.fileName, code, source, stamp.index, stamp.length),
        message: `${diagnosticDefinitions[code].message} data-bind="${stamp.binding}" wraps {${stamp.expression}}`,
      };
    });
}

function bindingExpressionStamps(
  source: string,
  model: ComponentModuleModel,
): Array<{ binding: string; expression: string; index: number; length: number }> {
  return jsxElements(model).flatMap((element) => {
    const attribute = element.attributes.find((item) => item.name === 'data-bind');
    const binding = attribute?.value;
    if (!attribute || !binding) return [];
    if (element.selfClosing) return [];

    const expression = soleWrappedQueryExpression(
      source.slice(element.openingEnd, element.closingStart),
    );
    return expression
      ? [{ binding, expression, index: attribute.start, length: attribute.end - attribute.start }]
      : [];
  });
}

function soleWrappedQueryExpression(source: string): string | null {
  const match = /^\s*\{\s*(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\}\s*$/.exec(source);
  return match?.groups?.path ?? null;
}

function collectQueryUpdatePlans(
  source: string,
  model: ComponentModuleModel,
  componentName: string,
): QueryUpdatePlanFact[] {
  const pathsByQuery = new Map<string, Set<string>>();
  const listStampsByQuery = new Map<string, QueryTemplateStampFact[]>();

  for (const { path } of dataBindAttributes(model)) {
    if (path.startsWith('.')) continue;
    const [query] = path.split('.');
    if (!query) continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(path);
    pathsByQuery.set(query, paths);
  }

  for (const stamp of dataBindListStamps(source, model)) {
    const [query] = stamp.list.split('.');
    if (!query) continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(stamp.list);
    pathsByQuery.set(query, paths);
    listStampsByQuery.set(query, [...(listStampsByQuery.get(query) ?? []), stamp]);
  }

  const queries = new Set([...pathsByQuery.keys(), ...listStampsByQuery.keys()]);

  return [...queries]
    .sort((left, right) => left.localeCompare(right))
    .map((query) => ({
      componentName,
      paths: [...(pathsByQuery.get(query) ?? [])].sort(),
      query,
      ...(listStampsByQuery.has(query)
        ? {
            templateStamps: [...(listStampsByQuery.get(query) ?? [])].sort((left, right) =>
              left.list.localeCompare(right.list),
            ),
          }
        : {}),
    }));
}

function collectQueryUpdateCoverage(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
  componentName: string,
): QueryUpdateCoverageFact[] {
  const facts: QueryUpdateCoverageFact[] = [];
  const coveredPaths = new Set<string>();
  const knownQueries = knownQueryNames(model, options);

  for (const binding of dataBindAttributes(model).filter((item) => !item.path.startsWith('.'))) {
    const path = binding.path;
    const query = queryNameFromPath(path);
    if (!query) continue;

    facts.push({
      componentName,
      detail: binding.name,
      position: binding.name === 'data-bind' ? 'binding' : 'attribute',
      query: path,
      status: 'plan',
    });
    coveredPaths.add(path);
  }

  for (const stamp of dataBindListStamps(source, model)) {
    facts.push({
      componentName,
      detail: 'data-bind-list',
      position: 'template',
      query: stamp.list,
      status: 'plan',
    });
    coveredPaths.add(stamp.list);
  }

  for (const path of renderOnceQueryPaths(model, knownQueries)) {
    facts.push({
      componentName,
      detail: 'declared renderOnce',
      position: 'expression',
      query: path,
      status: 'renderOnce',
    });
    coveredPaths.add(path);
  }

  for (const path of jsxQueryExpressionPaths(model, knownQueries)) {
    if (coveredPaths.has(path)) continue;

    facts.push({
      componentName,
      detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
      position: 'expression',
      query: path,
      status: 'UNHANDLED',
    });
    coveredPaths.add(path);
  }

  return dedupeUpdateCoverage(facts);
}

function knownQueryNames(
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): Set<string> {
  return new Set([
    ...componentQueryNames(model),
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...Object.keys(componentQueryShapes(options) ?? {}),
  ]);
}

function queryNameFromPath(path: string): string | null {
  return path.split('.', 1)[0] ?? null;
}

function renderOnceQueryPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'renderOnce')) {
    paths.push(...queryPathsInExpression(call.arguments.join(', '), knownQueries));
  }

  return [...new Set(paths)];
}

function jsxQueryExpressionPaths(
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string[] {
  return jsxExpressions(model)
    .map((expression) => soleQueryPathExpression(expression.expression))
    .filter((path): path is string => path !== null)
    .filter((path) => queryPathUsesKnownQuery(path, knownQueries));
}

function soleQueryPathExpression(expression: string): string | null {
  return (
    /^(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/.exec(expression)?.groups?.path ?? null
  );
}

function queryPathsInExpression(expression: string, knownQueries: ReadonlySet<string>): string[] {
  return propertyAccessPaths('expression.tsx', expression).filter((path) =>
    queryPathUsesKnownQuery(path, knownQueries),
  );
}

function queryPathUsesKnownQuery(path: string, knownQueries: ReadonlySet<string>): boolean {
  const query = queryNameFromPath(path);
  return query !== null && knownQueries.has(query);
}

function dedupeUpdateCoverage(
  facts: readonly QueryUpdateCoverageFact[],
): QueryUpdateCoverageFact[] {
  return dedupeBy(facts, (fact) =>
    [fact.componentName, fact.query, fact.position, fact.status, fact.detail ?? ''].join('\0'),
  );
}

function dataBindAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        isBindingAttribute(attribute.name) &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => ({
      index: attribute.start,
      length: attribute.end - attribute.start,
      name: attribute.name,
      path: attribute.value ?? '',
    }));
}

function dataBindListStamps(source: string, model: ComponentModuleModel): QueryTemplateStampFact[] {
  const elements = jsxElements(model);

  return elements
    .flatMap((element) => {
      const list = jsxStaticAttributeValue(element, 'data-bind-list');
      const key = jsxStaticAttributeValue(element, 'fw-key');
      if (!list || !key) return [];

      const template = templateStampContent(source, elements, element);

      return [
        {
          itemBindings: elements
            .filter((candidate) => isWithinElement(candidate, element))
            .flatMap((candidate) => candidate.attributes)
            .filter(
              (attribute) =>
                isBindingAttribute(attribute.name) &&
                attribute.value !== undefined &&
                attribute.value !== '',
            )
            .map((attribute) => attribute.value ?? '')
            .filter((path) => path.startsWith('.'))
            .sort(),
          key,
          list,
          selector: `[data-bind-list="${list}"]`,
          template,
        },
      ];
    })
    .filter((stamp) => stamp.itemBindings.length > 0);
}

function templateStampContent(
  source: string,
  elements: readonly JsxElementModel[],
  container: JsxElementModel,
): string {
  const template = elements.find(
    (element) =>
      element.tag === 'template' &&
      isWithinElement(element, container) &&
      hasJsxAttribute(element, 'fw-stamp'),
  );
  if (!template || template.selfClosing) return '';

  return source.slice(template.openingEnd, template.closingStart).trim();
}

function listStampExistsInQueryShapes(
  stamp: QueryTemplateStampFact,
  queryShapes: Record<string, QueryShape>,
): boolean {
  const [queryName, ...segments] = stamp.list.split('.');
  if (!queryName || segments.length === 0) return false;

  const listShape = queryShapes[queryName];
  if (!listShape) return false;

  const shapeAtList = queryShapeAtPath(listShape, segments);
  if (!isArrayShape(shapeAtList)) return false;

  const itemShape = shapeAtList[0];
  if (itemShape === undefined) return false;
  if (!pathExistsInShape(itemShape, [stamp.key])) return false;

  return stamp.itemBindings.every((path) => pathExistsInShape(itemShape, path.slice(1).split('.')));
}

function queryShapeAtPath(shape: QueryShape, segments: readonly string[]): QueryShape {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return current;
  if (isArrayShape(current)) return queryShapeAtPath(current[0] ?? 'object', segments);
  if (!isQueryShapeObject(current)) return 'object';

  const [head, ...tail] = segments;
  if (!head) return current;
  return queryShapeAtPath(current[head] ?? 'object', tail);
}

// SPEC 5.2: query data is shared/server-owned; island-local state is private/client-owned.
function validateServerFactsInLocalState(
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const queryObject = componentOptionSource(model, 'queries');
  const stateObject = componentStateReturnObject(model);
  if (!queryObject || !stateObject) return [];

  const queryNames = topLevelObjectKeys(queryObject);
  const stateKeys = topLevelObjectKeys(stateObject);
  if (queryNames.length === 0 || stateKeys.length === 0) return [];

  const storesServerFact = stateKeys.some((stateKey) =>
    queryNames.some((queryName) => stateKeyHasQueryPrefix(stateKey, queryName)),
  );

  return storesServerFact ? [diagnosticFor(fileName, 'FW301')] : [];
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
  const renderInputs = extractFirstRenderObjectPattern(source);
  if (renderInputs.length === 0) return [];

  const missing = renderInputs.filter((input) => !allowedInputs.has(input));
  return missing.map((input) => ({
    ...diagnosticFor(fileName, 'FW303'),
    message: `${diagnosticDefinitions.FW303.message} ${input}`,
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
      .filter((body) => capturesUnserializableValue(body))
      .map((body) => fw230Diagnostic(fileName, name, body)),
  );
}

function fragmentTargetUsageNames(model: ComponentModuleModel): string[] {
  return [...new Set(componentFragmentTargetNames(model))];
}

function fragmentTargetChildBodies(
  source: string,
  model: ComponentModuleModel,
  name: string,
): string[] {
  const bodies: string[] = [];

  for (const element of jsxElements(model).filter((item) => item.tag === name)) {
    if (element.selfClosing) continue;

    const body = source.slice(element.openingEnd, element.closingStart).trim();
    if (body) bodies.push(body);
  }

  return bodies;
}

function fw230Diagnostic(fileName: string, target: string, body: string): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW230'),
    help: [
      `Would hoist children to: ${target}$slot_children`,
      `Blocked children: ${body}`,
      'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
    ].join('\n'),
    message: `${diagnosticDefinitions.FW230.message} ${target}`,
  };
}

function validateEventPayloads(
  source: string,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const queryPaths = new Set(queryShapePaths(queryShapes));
  const overlapping = eventPayloadPaths(source).filter((path) => queryPaths.has(path));
  if (overlapping.length === 0) return [];

  return [...new Set(overlapping)].map((path) => ({
    ...diagnosticFor(options.fileName, 'FW320'),
    message: `${diagnosticDefinitions.FW320.message} ${path}`,
  }));
}

function componentQueryShapes(options: CompileComponentOptions): Record<string, QueryShape> | null {
  return (
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : null)
  );
}

function validateDirectDbAccess(source: string, fileName: string): CompilerDiagnostic[] {
  if (!/\bmutation\s*\(/.test(source)) return [];

  for (const handler of findHandlerBodies(source)) {
    const params = handler.params.map(readParameterName).filter(Boolean);
    const receivesDb = params.includes('db');
    const requestParam = params.find(
      (param) =>
        param === 'request' || /request$/i.test(param) || param === 'ctx' || param === 'context',
    );
    const readsRequestDb =
      requestParam !== undefined &&
      new RegExp(`\\b${escapeRegExp(requestParam)}\\.db\\b`).test(handler.body);

    if (receivesDb || readsRequestDb) {
      return [diagnosticFor(fileName, 'FW330')];
    }
  }

  return [];
}

function validateIdrefs(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const ids = new Set(literalIds(model));
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

  for (const id of literalIds(model)) {
    if (seen.has(id)) diagnostics.push(fw224Diagnostic(fileName, `duplicate id="${id}"`));
    seen.add(id);
  }

  for (const id of repeatableLiteralIds(source, model)) {
    diagnostics.push(fw224Diagnostic(fileName, `repeatable id="${id}"`));
  }

  return dedupeDiagnostics(diagnostics);
}

function literalIds(model: ComponentModuleModel): string[] {
  return jsxAttributeValues(model, 'id');
}

function repeatableLiteralIds(source: string, model: ComponentModuleModel): string[] {
  return dataBindListTemplateBodies(source, model).flatMap((body) =>
    literalIds(parseComponentModuleModel('component.tsx', body)),
  );
}

function dataBindListTemplateBodies(source: string, model: ComponentModuleModel): string[] {
  const elements = jsxElements(model);

  return elements.flatMap((element) => {
    if (jsxStaticAttributeValue(element, 'data-bind-list') === undefined) return [];

    const template = templateStampContent(source, elements, element);
    return template ? [template] : [];
  });
}

function fw224Diagnostic(fileName: string, detail: string): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW224'),
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
        diagnostics.push(fw226Diagnostic(options.fileName, `fw-c="${component}"`));
      }
    }

    if (attribute.name !== 'fw-deps') continue;

    for (const dep of splitDepValue(attribute.value ?? '')) {
      const query = dep.split(':', 1)[0] ?? dep;
      if (!knownQueries.has(query)) {
        diagnostics.push(fw226Diagnostic(options.fileName, `fw-deps="${dep}"`));
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

function fw226Diagnostic(fileName: string, detail: string): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW226'),
    message: `${diagnosticDefinitions.FW226.message} ${detail}`,
  };
}

function fw311Diagnostic(fileName: string, fact: QueryUpdateCoverageFact): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW311'),
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
    if (isExternalNavigationTarget(target)) return false;
    return !routes.some((routePath) => routePathMatchesUrl(routePath, target));
  });

  return [...new Set(missing)].map((target) => ({
    ...diagnosticFor(options.fileName, 'FW220'),
    message: `${diagnosticDefinitions.FW220.message} ${target}`,
  }));
}

function literalNavigationTargets(source: string): string[] {
  return jsxAttributes(parseComponentModuleModel('component.tsx', source)).flatMap((attribute) =>
    (attribute.name === 'href' || attribute.name === 'action') && attribute.value
      ? [attribute.value]
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

function jsxAttributeValues(model: ComponentModuleModel, name: string): string[] {
  return jsxAttributes(model).flatMap((attribute) =>
    attribute.name === name && attribute.value ? [attribute.value] : [],
  );
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

function findHandlerBodies(source: string): { body: string; params: string[] }[] {
  return mutationHandlers(parseComponentModuleModel('component.tsx', source)).map((handler) => ({
    body: handler.body,
    params: [...handler.params],
  }));
}

function readParameterName(param: string): string {
  const withoutType = param.split(':')[0]?.trim() ?? '';
  return withoutType.replace(/^[.{\s]+|[}\s]+$/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFirstRenderObjectPattern(source: string): string[] {
  return componentRenderInputs(parseComponentModuleModel('component.tsx', source));
}

function eventPayloadPaths(source: string): string[] {
  const paths: string[] = [];

  for (const call of parsedCallExpressions(source).filter((item) => item.name === 'emit')) {
    const payload = call.arguments[1]?.trim();
    if (!payload?.startsWith('{')) continue;

    paths.push(...objectLiteralPropertyPaths('payload.tsx', payload));
  }

  return paths;
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

function pathExistsInQueryShapes(path: string, queryShapes: Record<string, QueryShape>): boolean {
  const [queryName, ...segments] = path.split('.');
  if (!queryName) return false;

  const shape = queryShapes[queryName];
  if (!shape || segments.length === 0) return Boolean(shape);

  return pathExistsInShape(shape, segments);
}

function pathExistsInShape(shape: QueryShape, segments: readonly string[]): boolean {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return true;

  if (isArrayShape(current)) {
    const itemShape = current[0];
    return itemShape !== undefined && pathExistsInShape(itemShape, segments);
  }

  if (!isQueryShapeObject(current)) return false;

  const [head, ...tail] = segments;
  if (!head || !(head in current)) return false;

  return pathExistsInShape(current[head] ?? 'object', tail);
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

  const entries = queryUpdatePlans
    .map(
      (plan) =>
        `  ${JSON.stringify(plan.query)}(root, value) {\n    return applyCompiledQueryUpdatePlan(root, ${JSON.stringify(plan.query)}, value, { bindings: true, derives: [], stamps: [], templateStamps: [${plan.templateStamps?.map(emitTemplateStampPlan).join(', ') ?? ''}] });\n  },`,
    )
    .join('\n');

  return `export const ${componentName}$queryUpdatePlans = {\n${entries}\n};`;
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
  const renderedSource = stampInitialState(
    stampDeclaredQueryDeps(replaceHandlerAttributes(source, handlers)),
  );

  return `${irHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}

function replaceHandlerAttributes(source: string, handlers: readonly HandlerLowering[]): string {
  return [...handlers]
    .sort((left, right) => right.attributeStart - left.attributeStart)
    .reduce((next, handler) => {
      const replacement = [
        `${handler.attributeName}="${handler.attributeValue}"`,
        ...handler.params.map(
          (param) => `${param.attributeName}="${escapeAttribute(param.value)}"`,
        ),
      ].join(' ');

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
    value: `{${arg}}`,
  }));
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
