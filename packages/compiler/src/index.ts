import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';

import { componentCssAssetForFile, emitCssModule, type ComponentCssAsset } from './css.js';
import { findMatchingToken, findStringEnd } from './scan/text.js';
import { escapeAttribute, indent, kebabCase } from './shared.js';

export type { DiagnosticCode };
export type {
  ComponentCssAsset,
  CssAsset,
  CssAssetManifest,
  CssAssetManifestOptions,
  ScopedCssResult,
  ScopeComponentCssOptions,
} from './css.js';
export { collectCssAssetManifest, dedupeCss, scopeComponentCss, selectCssAssets } from './css.js';

export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fileName: string;
  help?: string;
  length?: number;
  start?: SourcePosition;
}

export interface SourcePosition {
  column: number;
  line: number;
}

export interface EmittedFile {
  fileName: string;
  source: string;
}

export interface CompileResult {
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  diagnostics: CompilerDiagnostic[];
  files: EmittedFile[];
  platformSubstitutions: PlatformSubstitution[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  updateCoverage: readonly QueryUpdateCoverageFact[];
  viewTransitions: ViewTransitionStamp[];
}

export interface ComponentGraphFact {
  fragments?: readonly string[];
  name: string;
  queries?: readonly string[];
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

export interface QueryUpdateCoverageFact {
  componentName: string;
  detail?: string;
  position: string;
  query: string;
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

export interface QueryPlanBootstrapInput {
  exportName: string;
  importPath: string;
}

export interface QueryPlanBootstrapOptions {
  fileName?: string;
}

export function createEmptyCompileResult(): CompileResult {
  return {
    componentGraphFacts: [],
    cssAssets: [],
    diagnostics: [],
    files: [],
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

export interface RegistryFacts {
  components?: readonly string[];
  domainKeys?: readonly string[];
  invalidations?: Readonly<Record<string, readonly string[]>>;
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
  routes?: readonly string[];
}

export type RegistryTypeFacts = Readonly<Record<string, string>>;

export interface RegistryGraphInput {
  components?: readonly ComponentGraphFact[];
  mutations?: readonly {
    invalidates?: readonly string[];
    key: string;
    writes?: readonly string[];
  }[];
  pages?: readonly {
    route: string;
  }[];
  queries?: readonly {
    domains: readonly string[];
    query: string;
  }[];
}

export interface RegistryTypeFactOptions {
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
}

export interface CompileAppGraphOptions {
  components?: readonly CompileResult[];
  graph?: RegistryGraphInput;
  registryTypes?: RegistryTypeFactOptions;
}

export interface CompileAppGraphResult {
  graph: RegistryGraphInput;
  registryFacts: RegistryFacts;
}

export function deriveAppGraph(options: CompileAppGraphOptions): CompileAppGraphResult {
  const graph: RegistryGraphInput = {
    ...options.graph,
    components: [
      ...(options.graph?.components ?? []),
      ...(options.components ?? []).flatMap((component) => component.componentGraphFacts),
    ],
  };

  return {
    graph,
    registryFacts: deriveRegistryFactsFromGraph(graph, options.registryTypes),
  };
}

export function deriveRegistryFactsFromGraph(
  graph: RegistryGraphInput,
  options: RegistryTypeFactOptions = {},
): RegistryFacts {
  const components = deriveComponentFactsFromGraph(graph);

  return {
    ...(components.length > 0 ? { components } : {}),
    domainKeys: deriveDomainKeysFromGraph(graph),
    invalidations: deriveInvalidationFactsFromGraph(graph),
    ...(Object.keys(options.mutations ?? {}).length > 0 ? { mutations: options.mutations } : {}),
    ...(Object.keys(options.queries ?? {}).length > 0 ? { queries: options.queries } : {}),
    routes: [...new Set((graph.pages ?? []).map((page) => page.route))].sort(),
  };
}

export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

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
  options: CompileComponentOptions;
  source: string;
  updateCoverage: readonly QueryUpdateCoverageFact[];
}

type CompilerValidator = (context: ValidatorContext) => readonly CompilerDiagnostic[];

const irHeader = '// @jiso-ir';
const cssIrHeader = '/* @jiso-ir */';

const compilerValidators: readonly CompilerValidator[] = [
  ({ options, source }) => validateServerFactsInLocalState(source, options.fileName),
  ({ options, source }) => validateFragmentTargetInputs(source, options.fileName),
  ({ options, source }) => validateFragmentTargetChildren(source, options.fileName),
  ({ options, source }) => validateDataBindings(source, options),
  ({ options, source }) => validateStampExpressionDrift(source, options),
  ({ options, source }) => validateEventPayloads(source, options),
  ({ options, source }) => validateDirectDbAccess(source, options.fileName),
  ({ options }) => validateIdrefs(options.source, options.fileName),
  ({ options, source }) => validateStaticIds(source, options.fileName),
  ({ options, source }) => validateLiteralHrefs(source, options),
  ({ options, source }) => validateHtmlContentModel(source, options.fileName),
  ({ options, source }) => validateEventTriggerNames(source, options.fileName),
  ({ componentName, options, source }) => validateResidualStamps(source, options, componentName),
  ({ options, source }) => validateAttributeMergeConflicts(source, options.fileName),
  ({ options, updateCoverage }) =>
    updateCoverage
      .filter((fact) => fact.status === 'UNHANDLED')
      .map((fact) => fw311Diagnostic(options.fileName, fact)),
];

export function compileComponentModule(options: CompileComponentOptions): CompileResult {
  if (isIr(options.source)) {
    return {
      ...createEmptyCompileResult(),
      files: [{ fileName: options.fileName, source: options.source }],
    };
  }

  const componentName = inferComponentName(options);
  const viewTransitionLowering = lowerViewTransitions(options.source);
  const platformLowering = lowerPlatformBehaviors(viewTransitionLowering.source);
  const navigationLowering = lowerNavigationSugar(platformLowering.source);
  const source = navigationLowering.source;
  const handlers = lowerEventHandlers({ ...options, source }, componentName);
  const queryUpdatePlans = collectQueryUpdatePlans(source, componentName);
  const updateCoverage = collectQueryUpdateCoverage(source, options, componentName);
  const validationDiagnostics = compilerValidators.flatMap((validator) =>
    validator({ componentName, options, source, updateCoverage }),
  );
  const clientFileName = replaceExtension(options.fileName, '.client.js');
  const cssFileName = replaceExtension(options.fileName, '.css');
  const serverFileName = replaceExtension(options.fileName, '.server.js');
  const registryFileName = 'generated/registries.d.ts';

  const clientSource = emitClientModule(handlers, queryUpdatePlans, componentName);
  const cssSource = emitCssModule(source, componentName);
  const fragmentTargetFacts = findFragmentTargetFacts(source, componentName);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const componentGraphFacts = [componentGraphFact(componentName, source, fragmentTargets)];
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
      { fileName: serverFileName, source: serverSource },
      { fileName: clientFileName, source: clientSource },
      ...(cssSource ? [{ fileName: cssFileName, source: cssSource }] : []),
      { fileName: registryFileName, source: registrySource },
    ],
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
  const handlerExportPattern = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*handler\s*\(/gm;
  const items = Array.isArray(results) ? results : [results];

  for (const result of items) {
    for (const file of result.files) {
      if (!file.fileName.endsWith('.client.js')) continue;

      for (const match of file.source.matchAll(handlerExportPattern)) {
        const exportName = match[1];
        if (exportName) reserved.add(exportName);
      }
    }
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
        code: result.files.find((file) => file.fileName.endsWith('.server.js'))?.source ?? source,
        map: null,
      };
    },
  };
}

export function emitQueryPlanBootstrapModule(
  inputs: readonly QueryPlanBootstrapInput[],
  options: QueryPlanBootstrapOptions = {},
): EmittedFile {
  const fileName = options.fileName ?? 'generated/app.client.js';
  const imports = inputs
    .map((input) => `import { ${input.exportName} } from ${JSON.stringify(input.importPath)};`)
    .join('\n');
  const spreads =
    inputs.length > 0
      ? inputs.map((input) => `  ...${input.exportName},`).join('\n')
      : '  // no compiled query update plans';

  return {
    fileName,
    source: `${irHeader}
import { applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader } from '@jiso/runtime';
${imports ? `${imports}\n` : ''}
const store = createQueryStore();
const queryPlans = {
${spreads}
};

installJisoLoader({
  importModule: (specifier) => import(specifier),
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans,
    root: document,
    store,
  },
});

export function applyJisoDeferredStreamResponse(body, options = {}) {
  return applyDeferredStreamResponseToDom({
    body,
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.morph ? { morph: options.morph } : {}),
    queryPlans,
    root: options.root ?? document,
    store,
  });
}
`,
  };
}

function isIr(source: string): boolean {
  return source.startsWith(irHeader) || source.startsWith(cssIrHeader);
}

function inferComponentName(options: CompileComponentOptions): string {
  const exportMatch = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/.exec(options.source);
  if (exportMatch?.[1]) return exportMatch[1];

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
  const stamps: ViewTransitionStamp[] = [];
  const nextSource = source.replace(
    /<(?<tag>[A-Za-z][A-Za-z0-9:.-]*)(?<before>[^<>]*?)\sviewTransitionName=(["'])(?<name>[^"']+)\3(?<after>[^<>]*?)>/g,
    (_match, tag: string, before: string, _quote: string, name: string, after: string) => {
      stamps.push({ name });
      return `<${tag}${appendViewTransitionStyle(`${before}${after}`, name)}>`;
    },
  );

  return {
    source: nextSource,
    stamps,
  };
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
  const substitutions: PlatformSubstitution[] = [];
  const detailsLowered = source.replace(
    /<summary\b(?<before>[^>]*)\sonClick=\{\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.open\s*=\s*!\s*document\.getElementById\(['"]\k<target>['"]\)!?\.open\s*\}/g,
    (_match, before: string, target: string) => {
      substitutions.push({
        action: 'toggle',
        event: 'click',
        kind: 'details',
        tag: 'summary',
        target,
      });
      return `<summary${before}`;
    },
  );
  const nextSource = detailsLowered.replace(
    /<(?<tag>[A-Za-z][A-Za-z0-9-]*)\b(?<before>[^>]*)\sonClick=\{\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.(?<method>showModal|close|requestClose|showPopover|hidePopover|togglePopover)\(\)\s*\}/g,
    (match, tag: string, before: string, target: string, method: string) => {
      const substitution = platformSubstitutionFor(tag, target, method);
      if (!substitution) return match;

      substitutions.push(substitution);
      return `<${tag}${before} ${platformAttributes(substitution)}`;
    },
  );

  return {
    source: nextSource,
    substitutions,
  };
}

function lowerNavigationSugar(source: string): { source: string } {
  return {
    source: normalizeStaticHrefAttributes(lowerStaticHrefCalls(lowerStaticLinks(source))),
  };
}

function lowerStaticLinks(source: string): string {
  return source.replace(
    /<Link\b(?<attributes>[^>]*)>(?<children>[\s\S]*?)<\/Link>/g,
    (match, attributes: string, children: string) => {
      const target = readStringAttribute(attributes, 'to');
      if (!target) return match;

      const params = readLiteralObjectAttribute(attributes, 'params');
      const search = readLiteralObjectAttribute(attributes, 'search');
      if (params === null || search === null) return match;

      const href = buildStaticHref(target, params ?? {}, search ?? {});
      const anchorAttributes = stripLinkNavigationAttributes(attributes);
      const spacing = anchorAttributes.trim() === '' ? '' : anchorAttributes;

      return `<a${spacing} href="${escapeAttribute(href)}">${children}</a>`;
    },
  );
}

function lowerStaticHrefCalls(source: string): string {
  let output = '';
  let cursor = 0;

  for (const match of source.matchAll(/\bhref\s*\(/g)) {
    const callStart = match.index;
    if (callStart < cursor) continue;

    const argsStart = callStart + match[0].length - 1;
    const callEnd = findMatchingToken(source, argsStart, '(', ')');
    if (callEnd === -1) continue;

    const lowered = lowerStaticHrefCall(source.slice(argsStart + 1, callEnd));
    if (!lowered) continue;

    output += source.slice(cursor, callStart) + JSON.stringify(lowered);
    cursor = callEnd + 1;
  }

  return cursor === 0 ? source : output + source.slice(cursor);
}

function normalizeStaticHrefAttributes(source: string): string {
  return source.replace(
    /\bhref=\{\s*(["'])(?<target>[^"']+)\1\s*\}/g,
    (_match, _quote, target) => `href="${escapeAttribute(target)}"`,
  );
}

function lowerStaticHrefCall(argsSource: string): string | null {
  const [pathArg, optionsArg] = splitArguments(argsSource).map((arg) => arg.trim());
  const path = literalStringValue(pathArg ?? '');
  if (!path) return null;

  const options = parseLiteralObject(optionsArg ?? '{}');
  if (options === null) return null;

  const params = objectRecordValue(options.params);
  const search = objectRecordValue(options.search);
  if (params === null || search === null) return null;

  return buildStaticHref(path, params ?? {}, search ?? {});
}

function stripLinkNavigationAttributes(attributes: string): string {
  return attributes
    .replace(/\s+to=(["'])[^"']+\1/g, '')
    .replace(/\s+params=\{\{[\s\S]*?\}\}/g, '')
    .replace(/\s+search=\{\{[\s\S]*?\}\}/g, '');
}

function readStringAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=(["'])(?<value>[^"']+)\\1`).exec(attributes);
  return match?.groups?.value ?? null;
}

type StaticNavigationValue = string | number | boolean | null;
type StaticNavigationObject = Record<string, StaticNavigationValue>;
type StaticLiteralValue = StaticNavigationValue | StaticLiteralObject;

interface StaticLiteralObject {
  [key: string]: StaticLiteralValue;
}

function readLiteralObjectAttribute(
  attributes: string,
  name: string,
): StaticNavigationObject | null | undefined {
  const match = new RegExp(`\\b${name}=\\{\\{(?<value>[\\s\\S]*?)\\}\\}`).exec(attributes);
  if (!match?.groups) return undefined;
  const value = parseLiteralObject(`{${match.groups.value}}`);
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
  const tagPattern = /<(?<tag>[A-Za-z][A-Za-z0-9-]*)\b/g;

  for (const tagMatch of source.matchAll(tagPattern)) {
    const tag = tagMatch.groups?.tag ?? 'element';
    const tagStart = tagMatch.index ?? 0;
    const tagEnd = findOpeningTagEnd(source, tagStart);
    if (tagEnd === -1) continue;

    const attrsStart = tagStart + tagMatch[0].length;
    const attrs = source.slice(attrsStart, tagEnd);
    const attrPattern = /\bon(?<event>[A-Z][A-Za-z0-9]*)\s*=\s*\{/g;

    for (const attrMatch of attrs.matchAll(attrPattern)) {
      const event = attrMatch.groups?.event;
      if (!event) continue;

      const attributeStart = attrsStart + (attrMatch.index ?? 0);
      const braceStart = attributeStart + attrMatch[0].lastIndexOf('{');
      const braceEnd = findMatchingToken(source, braceStart, '{', '}');
      if (braceEnd === -1 || braceEnd > tagEnd) continue;

      attributes.push({
        attributeEnd: braceEnd + 1,
        attributeStart,
        event,
        expression: source.slice(braceStart + 1, braceEnd).trim(),
        tag,
      });
    }
  }

  return attributes;
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
  return (
    /\b(window|document|db|request|response)\b/.test(expression) ||
    /\bnew\s+(Date|Map|Set)\b/.test(expression)
  );
}

function diagnosticFor(
  fileName: string,
  code: DiagnosticCode,
  source?: string,
  offset?: number,
  length?: number,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions[code];
  return {
    code,
    fileName,
    ...(source !== undefined && offset !== undefined
      ? {
          ...(length === undefined ? {} : { length }),
          start: offsetToPosition(source, offset),
        }
      : {}),
    message: definition.message,
    severity: definition.severity,
  };
}

function offsetToPosition(source: string, offset: number): SourcePosition {
  const prefix = source.slice(0, Math.max(0, offset));
  const lineBreaks = prefix.match(/\n/g);
  const line = (lineBreaks?.length ?? 0) + 1;
  const lastLineBreak = prefix.lastIndexOf('\n');
  const column = offset - lastLineBreak;

  return { column, line };
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
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const listStamps = dataBindListStamps(source);

  return dataBindAttributes(source)
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
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const knownQueries = knownQueryNames(source, options);

  return bindingExpressionStamps(source)
    .filter(
      (stamp) =>
        queryPathUsesKnownQuery(stamp.binding, knownQueries) &&
        queryPathUsesKnownQuery(stamp.expression, knownQueries),
    )
    .map((stamp) => {
      const code = stamp.binding === stamp.expression ? 'FW223' : 'FW222';

      return {
        ...diagnosticFor(options.fileName, code),
        message: `${diagnosticDefinitions[code].message} data-bind="${stamp.binding}" wraps {${stamp.expression}}`,
      };
    });
}

function bindingExpressionStamps(source: string): Array<{ binding: string; expression: string }> {
  return [...source.matchAll(/<(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)>/g)].flatMap((match) => {
    const attrs = match.groups?.attrs ?? '';
    const binding = readStaticAttribute(attrs, 'data-bind');
    if (!binding) return [];

    const tag = match.groups?.tag ?? '';
    const start = match.index ?? 0;
    const end = findMatchingClosingTag(source, tag, start);
    if (end === -1) return [];

    const openEnd = findOpeningTagEnd(source, start);
    if (openEnd === -1) return [];

    const closeTag = `</${tag}>`;
    const closeStart = end - closeTag.length;
    const expression = soleWrappedQueryExpression(source.slice(openEnd + 1, closeStart));
    return expression ? [{ binding, expression }] : [];
  });
}

function soleWrappedQueryExpression(source: string): string | null {
  const match = /^\s*\{\s*(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\}\s*$/.exec(source);
  return match?.groups?.path ?? null;
}

function collectQueryUpdatePlans(source: string, componentName: string): QueryUpdatePlanFact[] {
  const pathsByQuery = new Map<string, Set<string>>();
  const listStampsByQuery = new Map<string, QueryTemplateStampFact[]>();

  for (const { path } of dataBindAttributes(source)) {
    if (path.startsWith('.')) continue;
    const [query] = path.split('.');
    if (!query) continue;

    const paths = pathsByQuery.get(query) ?? new Set<string>();
    paths.add(path);
    pathsByQuery.set(query, paths);
  }

  for (const stamp of dataBindListStamps(source)) {
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
  options: CompileComponentOptions,
  componentName: string,
): QueryUpdateCoverageFact[] {
  const facts: QueryUpdateCoverageFact[] = [];
  const coveredPaths = new Set<string>();
  const knownQueries = knownQueryNames(source, options);

  for (const binding of dataBindAttributes(source).filter((item) => !item.path.startsWith('.'))) {
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

  for (const stamp of dataBindListStamps(source)) {
    facts.push({
      componentName,
      detail: 'data-bind-list',
      position: 'template',
      query: stamp.list,
      status: 'plan',
    });
    coveredPaths.add(stamp.list);
  }

  for (const path of renderOnceQueryPaths(source, knownQueries)) {
    facts.push({
      componentName,
      detail: 'declared renderOnce',
      position: 'expression',
      query: path,
      status: 'renderOnce',
    });
    coveredPaths.add(path);
  }

  for (const path of jsxQueryExpressionPaths(source, knownQueries)) {
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

function knownQueryNames(source: string, options: CompileComponentOptions): Set<string> {
  return new Set([
    ...componentQueryNames(source),
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...Object.keys(componentQueryShapes(options) ?? {}),
  ]);
}

function queryNameFromPath(path: string): string | null {
  return path.split('.', 1)[0] ?? null;
}

function renderOnceQueryPaths(source: string, knownQueries: ReadonlySet<string>): string[] {
  const paths: string[] = [];

  for (const match of source.matchAll(/\brenderOnce\s*\(/g)) {
    const callStart = match.index + match[0].lastIndexOf('(');
    const callEnd = findMatchingToken(source, callStart, '(', ')');
    if (callEnd === -1) continue;

    paths.push(...queryPathsInExpression(source.slice(callStart + 1, callEnd), knownQueries));
  }

  return [...new Set(paths)];
}

function jsxQueryExpressionPaths(source: string, knownQueries: ReadonlySet<string>): string[] {
  return [...source.matchAll(/\{\s*(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\}/g)]
    .map((match) => match.groups?.path ?? '')
    .filter((path) => queryPathUsesKnownQuery(path, knownQueries));
}

function queryPathsInExpression(expression: string, knownQueries: ReadonlySet<string>): string[] {
  return [...expression.matchAll(/\b(?<path>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\b/g)]
    .map((match) => match.groups?.path ?? '')
    .filter((path) => queryPathUsesKnownQuery(path, knownQueries));
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

function dataBindPaths(source: string): string[] {
  return dataBindAttributes(source).map((binding) => binding.path);
}

function dataBindAttributes(source: string): DataBindAttribute[] {
  return [
    ...source.matchAll(/\b(?<name>data-bind(?::[A-Za-z_$][\w$:-]*)?)=(["'])(?<path>[^"']+)\2/g),
  ]
    .map((match) => ({
      index: match.index ?? 0,
      length: match[0].length,
      name: match.groups?.name ?? '',
      path: match.groups?.path ?? '',
    }))
    .filter((binding) => binding.name && binding.path);
}

function dataBindListStamps(source: string): QueryTemplateStampFact[] {
  return [...source.matchAll(/<(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)>/g)]
    .flatMap((match) => {
      const attrs = match.groups?.attrs ?? '';
      const list = readStaticAttribute(attrs, 'data-bind-list');
      const key = readStaticAttribute(attrs, 'fw-key');
      if (!list || !key) return [];

      const start = match.index ?? 0;
      const end = findMatchingClosingTag(source, match.groups?.tag ?? '', start);
      const body = end === -1 ? '' : source.slice(start, end);

      return [
        {
          itemBindings: dataBindPaths(body)
            .filter((path) => path.startsWith('.'))
            .sort(),
          key,
          list,
          selector: `[data-bind-list="${list}"]`,
          template: templateStampContent(body),
        },
      ];
    })
    .filter((stamp) => stamp.itemBindings.length > 0);
}

function templateStampContent(source: string): string {
  const open = /<template\b(?=[^>]*\bfw-stamp\b)(?<attrs>[^>]*)>/i.exec(source);
  if (!open) return '';

  const start = (open.index ?? 0) + open[0].length;
  const end = source.indexOf('</template>', start);
  return end === -1 ? '' : source.slice(start, end).trim();
}

function readStaticAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${escapeRegExp(name)}=(["'])(?<value>[^"']+)\\1`).exec(attrs);
  return match?.groups?.value;
}

function findMatchingClosingTag(source: string, tag: string, start: number): number {
  if (!tag) return -1;

  const openPattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>`, 'g');
  const closePattern = new RegExp(`</${escapeRegExp(tag)}>`, 'g');
  openPattern.lastIndex = start;
  closePattern.lastIndex = start;
  let depth = 0;

  while (true) {
    const open = openPattern.exec(source);
    const close = closePattern.exec(source);
    if (!close) return -1;
    if (open && open.index < close.index) {
      if (isSelfClosingOpeningTag(open[0])) {
        closePattern.lastIndex = openPattern.lastIndex;
        continue;
      }
      depth += 1;
      closePattern.lastIndex = openPattern.lastIndex;
      continue;
    }

    depth -= 1;
    if (depth <= 0) return close.index + close[0].length;
    openPattern.lastIndex = closePattern.lastIndex;
  }
}

function isSelfClosingOpeningTag(tagSource: string): boolean {
  const attrs = tagSource.replace(/^<[A-Za-z][\w:-]*/, '').replace(/>$/, '');
  return isSelfClosing(attrs);
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
  if (segments.length === 0) return shape;
  if (isArrayShape(shape)) return queryShapeAtPath(shape[0] ?? 'object', segments);
  if (typeof shape !== 'object' || shape === null) return 'object';

  const [head, ...tail] = segments;
  if (!head) return shape;
  return queryShapeAtPath(shape[head] ?? 'object', tail);
}

// SPEC 5.2: query data is shared/server-owned; island-local state is private/client-owned.
function validateServerFactsInLocalState(source: string, fileName: string): CompilerDiagnostic[] {
  const queryObject = extractObjectLiteralAfterProperty(source, 'queries');
  const stateObject = extractStateReturnObject(source);
  if (!queryObject || !stateObject) return [];

  const queryNames = topLevelObjectKeys(queryObject);
  const stateKeys = topLevelObjectKeys(stateObject);
  if (queryNames.length === 0 || stateKeys.length === 0) return [];

  const storesServerFact = stateKeys.some((stateKey) =>
    queryNames.some((queryName) => stateKeyHasQueryPrefix(stateKey, queryName)),
  );

  return storesServerFact ? [diagnosticFor(fileName, 'FW301')] : [];
}

function validateFragmentTargetInputs(source: string, fileName: string): CompilerDiagnostic[] {
  if (!/fragmentTarget\s*:\s*true/.test(source)) return [];

  const queryObject = extractObjectLiteralAfterProperty(source, 'queries');
  const propsObject = extractObjectLiteralAfterProperty(source, 'props');
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

function validateFragmentTargetChildren(source: string, fileName: string): CompilerDiagnostic[] {
  const targetNames = fragmentTargetUsageNames(source);
  if (targetNames.length === 0) return [];

  return targetNames.flatMap((name) =>
    fragmentTargetChildBodies(source, name)
      .filter((body) => capturesUnserializableValue(body))
      .map((body) => fw230Diagnostic(fileName, name, body)),
  );
}

function fragmentTargetUsageNames(source: string): string[] {
  const names: string[] = [];
  const declarationPattern =
    /\bexport\s+const\s+(?<local>[A-Z][A-Za-z0-9_]*)\s*=\s*component\s*\(\s*(["'])(?<name>[^"']+)\2\s*,\s*\{/g;

  for (const match of source.matchAll(declarationPattern)) {
    const objectStart = match.index + match[0].lastIndexOf('{');
    const objectEnd = findMatchingToken(source, objectStart, '{', '}');
    if (objectEnd === -1) continue;

    const optionsObject = source.slice(objectStart, objectEnd + 1);
    if (!/\bfragmentTarget\s*:\s*true\b/.test(optionsObject)) continue;

    const local = match.groups?.local;
    const explicit = match.groups?.name;
    if (local) names.push(local);
    if (explicit) names.push(explicit);
  }

  return [...new Set(names)];
}

function fragmentTargetChildBodies(source: string, name: string): string[] {
  const bodies: string[] = [];
  const openPattern = new RegExp(`<${escapeRegExp(name)}\\b(?<attrs>[^>]*)>`, 'g');

  for (const match of source.matchAll(openPattern)) {
    const attrs = match.groups?.attrs ?? '';
    if (isSelfClosing(attrs)) continue;

    const start = match.index ?? 0;
    const end = findMatchingClosingTag(source, name, start);
    if (end === -1) continue;

    const openEnd = findOpeningTagEnd(source, start);
    if (openEnd === -1) continue;

    const closeTag = `</${name}>`;
    const body = source.slice(openEnd + 1, end - closeTag.length).trim();
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

function validateIdrefs(source: string, fileName: string): CompilerDiagnostic[] {
  const ids = new Set(
    [...source.matchAll(/\bid\s*=\s*(["'])(?<id>[^"']+)\1/g)].flatMap((match) =>
      match.groups?.id ? [match.groups.id] : [],
    ),
  );
  if (ids.size === 0) return idrefValues(source).map((value) => fw221Diagnostic(fileName, value));

  const missing = idrefValues(source).filter((value) => !ids.has(value));
  return [...new Set(missing)].map((value) => fw221Diagnostic(fileName, value));
}

function validateStaticIds(source: string, fileName: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const seen = new Set<string>();

  for (const id of literalIds(source)) {
    if (seen.has(id)) diagnostics.push(fw224Diagnostic(fileName, `duplicate id="${id}"`));
    seen.add(id);
  }

  for (const id of repeatableLiteralIds(source)) {
    diagnostics.push(fw224Diagnostic(fileName, `repeatable id="${id}"`));
  }

  return dedupeDiagnostics(diagnostics);
}

function literalIds(source: string): string[] {
  return [...source.matchAll(/\bid\s*=\s*(["'])(?<id>[^"']+)\1/g)]
    .map((match) => match.groups?.id ?? '')
    .filter(Boolean);
}

function repeatableLiteralIds(source: string): string[] {
  return dataBindListTemplateBodies(source).flatMap(literalIds);
}

function dataBindListTemplateBodies(source: string): string[] {
  return [...source.matchAll(/<(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)>/g)].flatMap((match) => {
    const attrs = match.groups?.attrs ?? '';
    if (!readStaticAttribute(attrs, 'data-bind-list')) return [];

    const start = match.index ?? 0;
    const end = findMatchingClosingTag(source, match.groups?.tag ?? '', start);
    if (end === -1) return [];

    const template = templateStampContent(source.slice(start, end));
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

const voidHtmlTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function validateHtmlContentModel(source: string, fileName: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const stack: string[] = [];
  const tagPattern = /<(?<closing>\/?)(?<tag>[A-Za-z][A-Za-z0-9-]*)(?<attrs>[^<>]*)>/g;

  for (const match of source.matchAll(tagPattern)) {
    const rawTag = match.groups?.tag ?? '';
    if (!isNativeHtmlTag(rawTag)) continue;

    const tag = rawTag.toLowerCase();
    const attrs = match.groups?.attrs ?? '';
    const closing = match.groups?.closing === '/';

    if (closing) {
      const index = stack.lastIndexOf(tag);
      if (index !== -1) stack.splice(index);
      continue;
    }

    if (blockTagsThatCloseParagraph.has(tag) && stack.includes('p')) {
      diagnostics.push(htmlContentModelDiagnostic(fileName, `<${tag}> cannot appear inside <p>`));
    }

    if (
      tag === 'tr' &&
      !hasFwComponentStamp(attrs) &&
      !hasAncestor(stack, ['table', 'tbody', 'thead', 'tfoot'])
    ) {
      diagnostics.push(
        htmlContentModelDiagnostic(fileName, '<tr> must be inside a table section or table'),
      );
    }

    if (isSelfClosing(attrs) || voidHtmlTags.has(tag)) continue;

    stack.push(tag);
  }

  return diagnostics;
}

function htmlContentModelDiagnostic(fileName: string, detail: string): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW225'),
    message: `${diagnosticDefinitions.FW225.message} ${detail}`,
  };
}

function isNativeHtmlTag(tag: string): boolean {
  return tag === tag.toLowerCase() && !tag.includes('-');
}

function hasAncestor(stack: readonly string[], tags: readonly string[]): boolean {
  return stack.some((tag) => tags.includes(tag));
}

function isSelfClosing(attrs: string): boolean {
  return /\/\s*$/.test(attrs);
}

function hasFwComponentStamp(attrs: string): boolean {
  return /\bfw-c\s*=/.test(attrs);
}

const declaredExecutionTriggers = new Set(['idle', 'load', 'visible']);

const delegatedDomEvents = new Set([
  'beforeinput',
  'blur',
  'change',
  'click',
  'close',
  'contextmenu',
  'dblclick',
  'focus',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keyup',
  'pointercancel',
  'pointerdown',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'reset',
  'submit',
  'toggle',
]);

function validateEventTriggerNames(source: string, fileName: string): CompilerDiagnostic[] {
  return eventTriggerAttributes(source).flatMap((attribute) => {
    if (!isKnownEventOrTrigger(attribute.name)) {
      return [eventTriggerDiagnostic(fileName, source, 'FW212', attribute)];
    }

    if (attribute.name === 'load' && !hasFw211Justification(source, attribute.index)) {
      return [eventTriggerDiagnostic(fileName, source, 'FW211', attribute)];
    }

    return [];
  });
}

function eventTriggerAttributes(source: string): Array<{ index: number; name: string }> {
  return [...source.matchAll(/\bon:(?<name>[a-z][a-z0-9-]*)\s*=/g)].map((match) => ({
    index: match.index ?? 0,
    name: match.groups?.name ?? '',
  }));
}

function isKnownEventOrTrigger(name: string): boolean {
  return declaredExecutionTriggers.has(name) || delegatedDomEvents.has(name);
}

function hasFw211Justification(source: string, index: number): boolean {
  const prefix = source.slice(Math.max(0, index - 240), index);
  return /(?:\/\*[\s\S]*?FW211[\s\S]*?\*\/|\/\/[^\n]*FW211|<!--[\s\S]*?FW211[\s\S]*?-->)/.test(
    prefix,
  );
}

function eventTriggerDiagnostic(
  fileName: string,
  source: string,
  code: 'FW211' | 'FW212',
  attribute: { index: number; name: string },
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, code, source, attribute.index, attribute.name.length + 3),
    message: `${diagnosticDefinitions[code].message} on:${attribute.name}`,
  };
}

function validateResidualStamps(
  source: string,
  options: CompileComponentOptions,
  componentName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const knownQueries = new Set([
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...componentQueryNames(source),
  ]);
  const knownComponents = new Set([
    kebabCase(componentName),
    ...explicitComponentNames(source),
    ...(options.registryFacts?.components ?? []),
  ]);
  const tagPattern = /<(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)>/g;

  for (const match of source.matchAll(tagPattern)) {
    const attrs = match.groups?.attrs ?? '';
    const component = readStaticAttribute(attrs, 'fw-c');
    if (component && !knownComponents.has(component)) {
      diagnostics.push(fw226Diagnostic(options.fileName, `fw-c="${component}"`));
    }

    for (const dep of splitDepValue(readStaticAttribute(attrs, 'fw-deps') ?? '')) {
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

function validateAttributeMergeConflicts(source: string, fileName: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const tagPattern = /<(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)>/g;

  for (const match of source.matchAll(tagPattern)) {
    const attrs = attributeNames(match.groups?.attrs ?? '');
    const counts = countValues(attrs);

    for (const [name, count] of counts) {
      if (count < 2) continue;

      if (isBindingAttribute(name)) {
        diagnostics.push(attributeMergeDiagnostic(fileName, 'FW233', name));
        continue;
      }

      if (
        ambiguousRelationshipAttributes.has(name) ||
        name.startsWith('data-p-') ||
        name === 'fw-c' ||
        name === 'fw-state'
      ) {
        diagnostics.push(attributeMergeDiagnostic(fileName, 'FW231', name));
        continue;
      }

      if (name.startsWith('aria-') || primitiveOwnedOverrideAttributes.has(name)) {
        diagnostics.push(attributeMergeDiagnostic(fileName, 'FW232', name));
      }
    }
  }

  return dedupeDiagnostics(diagnostics);
}

function attributeNames(attrs: string): string[] {
  return [...attrs.matchAll(/(?:^|\s)(?<name>[A-Za-z_:][\w:.-]*)\s*=/g)]
    .map((match) => match.groups?.name ?? '')
    .filter(Boolean);
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
  fileName: string,
  code: 'FW231' | 'FW232' | 'FW233',
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, code),
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

function explicitComponentNames(source: string): string[] {
  return [...source.matchAll(/\bcomponent\s*\(\s*(["'])(?<name>[^"']+)\1/g)].flatMap((match) =>
    match.groups?.name ? [match.groups.name] : [],
  );
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
  return [...source.matchAll(/\b(?:href|action)\s*=\s*(["'])(?<target>[^"']+)\1/g)].flatMap(
    (match) => (match.groups?.target ? [match.groups.target] : []),
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

function fw221Diagnostic(fileName: string, value: string): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'FW221'),
    message: `${diagnosticDefinitions.FW221.message} ${value}`,
  };
}

function idrefValues(source: string): string[] {
  const values: string[] = [];
  const pattern =
    /\b(?<name>commandfor|popovertarget|for|htmlFor|aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-activedescendant)\s*=\s*(["'])(?<value>[^"']+)\2/g;

  for (const match of source.matchAll(pattern)) {
    const rawValue = match.groups?.value;
    if (!rawValue) continue;

    const name = match.groups?.name;
    const multiValue = name?.startsWith('aria-') && name !== 'aria-activedescendant';
    values.push(...(multiValue ? rawValue.split(/\s+/).filter(Boolean) : [rawValue]));
  }

  return values;
}

function findHandlerBodies(source: string): { body: string; params: string[] }[] {
  const handlers: { body: string; params: string[] }[] = [];
  const methodPattern = /\bhandler\s*\((?<params>[^)]*)\)\s*\{/g;
  const propertyPattern = /\bhandler\s*:\s*(?:async\s*)?\((?<params>[^)]*)\)\s*=>\s*\{/g;

  for (const match of source.matchAll(methodPattern)) {
    const bodyStart = match.index + match[0].lastIndexOf('{');
    const bodyEnd = findMatchingToken(source, bodyStart, '{', '}');
    if (bodyEnd === -1) continue;

    handlers.push({
      body: source.slice(bodyStart, bodyEnd + 1),
      params: splitParameters(match.groups?.params ?? ''),
    });
  }

  for (const match of source.matchAll(propertyPattern)) {
    const bodyStart = match.index + match[0].lastIndexOf('{');
    const bodyEnd = findMatchingToken(source, bodyStart, '{', '}');
    if (bodyEnd === -1) continue;

    handlers.push({
      body: source.slice(bodyStart, bodyEnd + 1),
      params: splitParameters(match.groups?.params ?? ''),
    });
  }

  return handlers;
}

function splitParameters(params: string): string[] {
  return params
    .split(',')
    .map((param) => param.trim())
    .filter(Boolean);
}

function readParameterName(param: string): string {
  const withoutType = param.split(':')[0]?.trim() ?? '';
  return withoutType.replace(/^[.{\s]+|[}\s]+$/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFirstRenderObjectPattern(source: string): string[] {
  const match = /\brender\s*:\s*\(\s*\{/.exec(source);
  if (!match) return [];

  const objectStart = match.index + match[0].lastIndexOf('{');
  const objectEnd = findMatchingToken(source, objectStart, '{', '}');
  if (objectEnd === -1) return [];

  return topLevelObjectKeys(source.slice(objectStart, objectEnd + 1));
}

function extractObjectLiteralAfterProperty(source: string, propertyName: string): string | null {
  const match = new RegExp(`\\b${propertyName}\\s*:\\s*\\{`).exec(source);
  if (!match) return null;

  const objectStart = match.index + match[0].lastIndexOf('{');
  const objectEnd = findMatchingToken(source, objectStart, '{', '}');
  if (objectEnd === -1) return null;

  return source.slice(objectStart, objectEnd + 1);
}

function extractStateReturnObject(source: string): string | null {
  const match = /\bstate\s*:\s*\(\s*\)\s*=>\s*\(\s*\{/.exec(source);
  if (!match) return null;

  const objectStart = match.index + match[0].lastIndexOf('{');
  const objectEnd = findMatchingToken(source, objectStart, '{', '}');
  if (objectEnd === -1) return null;

  return source.slice(objectStart, objectEnd + 1);
}

function eventPayloadPaths(source: string): string[] {
  const paths: string[] = [];

  for (const match of source.matchAll(/\bemit\s*\(/g)) {
    const callStart = match.index + match[0].lastIndexOf('(');
    const callEnd = findMatchingToken(source, callStart, '(', ')');
    if (callEnd === -1) continue;

    const payload = splitArguments(source.slice(callStart + 1, callEnd))[1]?.trim();
    if (!payload?.startsWith('{')) continue;

    const payloadEnd = findMatchingToken(payload, 0, '{', '}');
    if (payloadEnd === -1) continue;

    paths.push(...objectLiteralPaths(payload.slice(0, payloadEnd + 1)));
  }

  return paths;
}

function objectLiteralPaths(objectSource: string, prefix = ''): string[] {
  const paths: string[] = [];
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

    const path = prefix ? `${prefix}.${key.name}` : key.name;
    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] !== ':') {
      paths.push(path);
      index = skipObjectValue(objectSource, afterKey);
      continue;
    }

    const valueStart = skipWhitespaceAndComments(objectSource, afterKey + 1);
    if (objectSource[valueStart] === '{') {
      const valueEnd = findMatchingToken(objectSource, valueStart, '{', '}');
      if (valueEnd !== -1) {
        paths.push(...objectLiteralPaths(objectSource.slice(valueStart, valueEnd + 1), path));
        index = skipObjectValue(objectSource, afterKey + 1);
        continue;
      }
    }

    paths.push(path);
    index = skipObjectValue(objectSource, afterKey + 1);
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
  if (isArrayShape(shape)) {
    const itemShape = shape[0];
    return itemShape === undefined ? [] : queryShapeChildPaths(itemShape);
  }

  if (typeof shape !== 'object' || shape === null) return [];

  return Object.entries(shape).flatMap(([key, child]) => [
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
  if (segments.length === 0) return true;

  if (isArrayShape(shape)) {
    const itemShape = shape[0];
    return itemShape !== undefined && pathExistsInShape(itemShape, segments);
  }

  if (typeof shape !== 'object' || shape === null) return false;

  const [head, ...tail] = segments;
  if (!head || !(head in shape)) return false;

  return pathExistsInShape(shape[head] ?? 'object', tail);
}

function isArrayShape(shape: QueryShape): shape is readonly QueryShape[] {
  return Array.isArray(shape);
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
  const queryObject = extractObjectLiteralAfterProperty(source, 'queries');
  const deps = topLevelObjectKeys(queryObject ?? '{}');
  if (deps.length === 0) return source;

  const tag = findFirstRenderedOpeningTag(source);
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end + 1);
  const stampedTag = stampOpeningTagDeps(tagSource, deps);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end + 1)}`;
}

function stampInitialState(source: string): string {
  const stateJson = staticStateJson(source);
  if (!stateJson) return source;

  const tag = findFirstRenderedOpeningTag(source);
  if (!tag) return source;

  const tagSource = source.slice(tag.start, tag.end + 1);
  const stampedTag = stampOpeningTagAttribute(tagSource, 'fw-state', stateJson);
  if (stampedTag === tagSource) return source;

  return `${source.slice(0, tag.start)}${stampedTag}${source.slice(tag.end + 1)}`;
}

function findFirstRenderedOpeningTag(source: string): { end: number; start: number } | null {
  const renderMatch = /\brender\s*:/.exec(source);
  if (!renderMatch) return null;

  const tagMatch = /<[A-Za-z][\w:-]*\b/.exec(source.slice(renderMatch.index));
  if (!tagMatch) return null;

  const tagStart = renderMatch.index + tagMatch.index;
  const tagEnd = findOpeningTagEnd(source, tagStart);
  if (tagEnd === -1) return null;

  return { end: tagEnd, start: tagStart };
}

function findOpeningTagEnd(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '{') {
      const end = findMatchingToken(source, index, '{', '}');
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '>') return index;
  }

  return -1;
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
  const stateObject = extractStateReturnObject(source);
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
  if (!/fragmentTarget\s*:\s*true/.test(source)) return [];

  const explicitName = /component\(\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  return [
    {
      propsType: fragmentTargetPropsType(source),
      target: explicitName ?? kebabCase(componentName),
    },
  ];
}

function componentGraphFact(
  componentName: string,
  source: string,
  fragmentTargets: readonly string[],
): ComponentGraphFact {
  const queries = componentQueryNames(source);

  return {
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    name: componentName,
    ...(queries.length === 0 ? {} : { queries }),
  };
}

function componentQueryNames(source: string): string[] {
  return topLevelObjectKeys(extractObjectLiteralAfterProperty(source, 'queries') ?? '{}');
}

function fragmentTargetPropsType(source: string): string {
  const propsObject = extractObjectLiteralAfterProperty(source, 'props');
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

function deriveDomainKeysFromGraph(graph: RegistryGraphInput): string[] {
  return [
    ...(graph.queries ?? []).flatMap((query) => query.domains),
    ...(graph.mutations ?? []).flatMap((mutation) => mutation.writes ?? []),
    ...(graph.mutations ?? []).flatMap((mutation) => mutation.invalidates ?? []),
  ]
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort((left, right) => left.localeCompare(right));
}

function deriveComponentFactsFromGraph(graph: RegistryGraphInput): string[] {
  return [...new Set((graph.components ?? []).map((component) => kebabCase(component.name)))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function deriveInvalidationFactsFromGraph(
  graph: RegistryGraphInput,
): Readonly<Record<string, readonly string[]>> {
  const queries = graph.queries ?? [];
  const invalidations: Record<string, string[]> = {};

  for (const mutation of graph.mutations ?? []) {
    const invalidatedDomains = mutation.invalidates ?? mutation.writes ?? [];
    const invalidatedQueries = queries
      .filter((query) => query.domains.some((domain) => invalidatedDomains.includes(domain)))
      .map((query) => query.query);

    if (invalidatedQueries.length > 0) {
      invalidations[mutation.key] = [...new Set(invalidatedQueries)].sort();
    }
  }

  return invalidations;
}

function registryDomainKey(domainKeys: readonly string[] | undefined): string {
  const keys = [...new Set(domainKeys ?? [])].sort();
  return keys.map((key) => JSON.stringify(key)).join(' | ') || 'never';
}
