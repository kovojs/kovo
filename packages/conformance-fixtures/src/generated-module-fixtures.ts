import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  htmlElementFacts,
  type HtmlElementSelector,
  htmlLinkHrefs,
} from '@kovojs/test/html-fragment';
import { kovoResponseBodyFact } from '@kovojs/test/internal/html-wire';
import { cssScopeRules, type CssScopeRuleFact } from './source-fixtures.ts';
import type { AssertTypeScriptProgramOptions } from './typescript-fixtures.ts';

export interface GeneratedArtifactFile {
  fileName?: string;
  kind: string;
  source: string;
}

export interface GeneratedComponentSourceFacts {
  authoredLoweredStampAttributes: string[];
  generatedHasLoweredIrMarker: boolean;
}

export interface GeneratedComponentSourceFileFact extends GeneratedComponentSourceFacts {
  authoredPath: string;
  generatedPath: string;
  name: string;
}

export interface GeneratedComponentCompileResult {
  diagnostics: readonly unknown[];
  loweredSource?: string | null;
  renderEquivalenceChecks?: readonly { expected?: string }[];
}

export interface GeneratedComponentCommittedIrFact extends GeneratedComponentSourceFileFact {
  diagnostics: readonly unknown[];
  fixpointAsserted: boolean;
  generatedMatchesCompilerOutput: boolean;
  loweredRenderSourcePresent: boolean;
  provenance: {
    fileName: string;
    spec: 'SPEC.md section 5.2';
  };
  renderEquivalenceAsserted: boolean;
}

export interface GeneratedViewTransitionStampBehaviorFact {
  componentAttr: string | undefined;
  jsxPropPreserved: boolean;
  registryMemberTypes: Record<string, string>;
  src: string | undefined;
  styledElementCount: number;
  style: string | undefined;
  viewTransitionNames: string[];
}

export interface GeneratedTypedRouteDiagnosticLike {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
  [field: string]: unknown;
}

export interface GeneratedTypedRouteDiagnosticFact {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
}

export interface GeneratedTypedRouteCompileResult {
  diagnostics: readonly GeneratedTypedRouteDiagnosticLike[];
  files: readonly GeneratedArtifactFile[];
}

export interface GeneratedTypedRouteNavigationBehaviorFact {
  core: {
    href: string;
    link: { href?: string };
    redirect: { location?: string; status?: number };
    route: { path?: string };
    serverRoute: { loadType: string; path?: string };
  };
  generated: {
    diagnostics: GeneratedTypedRouteDiagnosticFact[];
    registryConsumerTypesAsserted: boolean;
    renderedHrefs: string[];
  };
  invalidDiagnostics: GeneratedTypedRouteDiagnosticFact[];
  provenance: {
    spec: 'SPEC.md section 6.4';
  };
}

const loweredStampAttributePattern =
  /\b((?:data-bind|kovo-deps|kovo-c|kovo-state|data-p-[\w-]+))=/g;

export function generatedComponentSourceFacts(options: {
  authoredSource: string;
  generatedSource: string;
}): GeneratedComponentSourceFacts {
  return {
    authoredLoweredStampAttributes: Array.from(
      options.authoredSource.matchAll(loweredStampAttributePattern),
      (match) => match[1] ?? '',
    ),
    generatedHasLoweredIrMarker: options.generatedSource.includes('// @kovojs-ir'),
  };
}

export function generatedComponentSourceFileFacts(options: {
  authoredDir?: string;
  components: readonly string[];
  generatedDir?: string;
  sourceRootUrl: URL;
}): GeneratedComponentSourceFileFact[] {
  const authoredDir = options.authoredDir ?? 'components';
  const generatedDir = options.generatedDir ?? 'generated';

  return options.components.map((name) => {
    const authoredPath = `${authoredDir}/${name}.tsx`;
    const generatedPath = `${generatedDir}/${name}.tsx`;
    const facts = generatedComponentSourceFacts({
      authoredSource: readFileSync(new URL(`./${authoredPath}`, options.sourceRootUrl), 'utf8'),
      generatedSource: readFileSync(new URL(`./${generatedPath}`, options.sourceRootUrl), 'utf8'),
    });

    return {
      ...facts,
      authoredPath,
      generatedPath,
      name,
    };
  });
}

export function generatedComponentCommittedIrFacts<
  T extends GeneratedComponentCompileResult,
>(options: {
  assertFixpoint: (result: T) => void;
  assertRenderEquivalence: (result: T) => void;
  authoredDir?: string;
  compileComponentModule: (input: { fileName: string; source: string }) => T;
  components: readonly string[];
  generatedDir?: string;
  projectFilePrefix: string;
  sourceRootUrl: URL;
}): GeneratedComponentCommittedIrFact[] {
  const authoredDir = options.authoredDir ?? 'components';
  const generatedDir = options.generatedDir ?? 'generated';

  return generatedComponentSourceFileFacts({
    authoredDir,
    components: options.components,
    generatedDir,
    sourceRootUrl: options.sourceRootUrl,
  }).map((sourceFact) => {
    const authoredSource = readFileSync(
      new URL(`./${sourceFact.authoredPath}`, options.sourceRootUrl),
      'utf8',
    );
    const generatedSource = readFileSync(
      new URL(`./${sourceFact.generatedPath}`, options.sourceRootUrl),
      'utf8',
    );
    const fileName = `${options.projectFilePrefix}/${sourceFact.authoredPath}`;
    const result = options.compileComponentModule({ fileName, source: authoredSource });

    options.assertFixpoint(result);
    options.assertRenderEquivalence(result);

    const lowered = result.loweredSource ?? result.renderEquivalenceChecks?.[0]?.expected ?? '';
    const expectedGeneratedSource = [
      `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.`,
      lowered,
    ].join('\n');

    return {
      ...sourceFact,
      diagnostics: result.diagnostics,
      fixpointAsserted: true,
      generatedMatchesCompilerOutput: generatedSource === expectedGeneratedSource,
      loweredRenderSourcePresent: lowered.length > 0,
      provenance: {
        fileName,
        spec: 'SPEC.md section 5.2',
      },
      renderEquivalenceAsserted: true,
    };
  });
}

export function generatedArtifactFile(
  files: readonly GeneratedArtifactFile[],
  kind: string,
): GeneratedArtifactFile {
  const matches = files.filter((file) => file.kind === kind);

  if (matches.length !== 1) {
    throw new Error(`Expected one generated ${kind} artifact; found ${matches.length}`);
  }

  return matches[0]!;
}

export function generatedArtifactSource(
  files: readonly GeneratedArtifactFile[],
  kind: string,
): string {
  return generatedArtifactFile(files, kind).source;
}

export function generatedCssScopeRulesFromArtifact(
  files: readonly GeneratedArtifactFile[],
): CssScopeRuleFact[] {
  return cssScopeRules(generatedArtifactSource(files, 'css'));
}

export class GeneratedFixtureMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  appendHtml(html: string): void {
    this.html += html;
  }

  readHtml(): string {
    return this.html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
  }
}

export class GeneratedFixtureElement {
  attributes: Array<{ name: string; value: string }>;
  textContent: string | null;
  value?: string;

  constructor(
    attributes: Record<string, string>,
    options: { textContent?: string; value?: string } = {},
  ) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) this.value = options.value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  closest(selector: string): GeneratedFixtureElement | null {
    return this.matches(selector) ? this : null;
  }

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) {
      return this.getAttribute(cssAttributeName(exactAttribute[1] ?? '')) === exactAttribute[2];
    }

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute
      ? this.getAttribute(cssAttributeName(presentAttribute[1] ?? '')) !== null
      : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }
}

const cssAttributeName = (selectorAttributeName: string): string =>
  selectorAttributeName.replaceAll('\\:', ':');

export class GeneratedFixtureTemplateStampHost extends GeneratedFixtureElement {
  items: Array<Record<string, unknown> & { html: string }> = [];

  reconcileTemplateStamp(items: Array<Record<string, unknown> & { html: string }>): void {
    this.items = items.map((item) => ({ ...item }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

export class GeneratedFixtureMorphRoot {
  bindings: GeneratedFixtureElement[] = [];
  elements: GeneratedFixtureElement[] = [];
  targets = new Map<string, GeneratedFixtureMorphTarget>();

  findFragmentTarget(target: string): GeneratedFixtureMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(selector: string): GeneratedFixtureElement[] {
    if (selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind') !== null);
    }
    if (selector === '*') return [...this.bindings, ...this.elements];

    return [...this.bindings, ...this.elements].filter((element) => element.matches(selector));
  }
}

export interface GeneratedRuntimeModule {
  applyCompiledQueryUpdatePlan?: unknown;
  applyDeferredStreamResponseToRuntime?: (options: unknown) => unknown;
  createQueryStore?: () => unknown;
  derive?: unknown;
  handler?: unknown;
  installKovoLoader?: (options: unknown) => unknown;
  [name: string]: unknown;
}

export interface ExecuteGeneratedClientModuleOptions {
  context?: Record<string, unknown>;
  runtime: GeneratedRuntimeModule;
}

export interface ExecuteGeneratedBootstrapModuleResult {
  calls: unknown[];
  deferredApplications: unknown[];
  documentRoot: GeneratedFixtureMorphRoot;
  exports: Record<string, unknown>;
  store: unknown;
}

export interface GeneratedQueryUpdatePlanRuntime {
  applyCompiledQueryUpdatePlan: (
    root: unknown,
    queryName: string,
    value: unknown,
    plan: unknown,
  ) => {
    bindings?: string[];
    derives?: string[];
    stamps?: string[];
    templateStamps?: string[];
  };
  applyDeferredStreamResponseToRuntime: (options: {
    body: string;
    boundary?: string;
    queryPlans?: Record<string, (root: unknown, value: unknown) => unknown>;
    root: GeneratedFixtureMorphRoot;
    store: { get(name: string, key?: string): unknown };
  }) => {
    appliedFragments: string[];
    chunks: Array<{
      fragments: Array<{ html: string; mode?: string; target: string }>;
      queries: string[];
    }>;
    queries: string[];
  };
  createQueryStore: () => { get(name: string, key?: string): unknown };
  emitQueryPlanBootstrapModule: (plans: Array<{ exportName: string; importPath: string }>) => {
    source: string;
  };
  executeClientArtifact: (
    files: readonly GeneratedArtifactFile[],
    options: ExecuteGeneratedClientModuleOptions,
  ) => Record<string, unknown>;
  executeBootstrapModule: typeof executeGeneratedBootstrapModule;
  renderDeferredStream: (options: unknown) => { body: string };
  runtime: GeneratedRuntimeModule;
}

export interface GeneratedQueryUpdatePlanBehaviorFact {
  appliedPlan: {
    bindings: string[];
    derives: string[];
    stamps: string[];
    templateStamps: string[];
  };
  bindingText: string | null;
  booleanAttributes: {
    disabled: string | null;
    hidden: string | null;
  };
  deriveText: string | null;
  orderedApply: {
    order: string[];
    stampValue: string | null;
  };
  templateItems: Array<{
    html: string;
    key: unknown;
  }>;
}

export interface GeneratedBootstrapDeferredBehaviorFact {
  appliedFragments: string[];
  bootstrapCallCount: number;
  deferredApplicationCount: number;
  enhancedMutationStoreMatches: boolean;
  fragmentHtmlByTarget: Record<string, string>;
  queryPlanStoreMatches: boolean;
  updatedBindings: Record<string, string | null>;
}

export interface GeneratedServerDeferredBehaviorFact {
  appliedFragments: string[];
  chunkFragments: Array<Array<{ html: string; mode?: string; target: string }>>;
  chunkQueries: string[][];
  fragmentHtmlByTarget: Record<string, string>;
  storeValues: Record<string, unknown>;
}

export interface GeneratedWireDeferredBehaviorFact {
  appliedFragments: string[];
  chunkFragmentTargets: string[][];
  fragmentHtmlFactsByTarget: Record<
    string,
    Array<{ attrs: Record<string, string>; innerHtml: string; tag: string }>
  >;
  fragmentTargets: string[];
  queryNames: string[];
  storeValues: Record<string, unknown>;
  stylesheetHrefsByTarget: Record<string, string[]>;
}

export interface GeneratedMinifierNamePreservationBehaviorFact {
  callResults: {
    add: unknown;
    remove: unknown;
    subtract: unknown;
  };
  exportTypes: Record<string, string>;
  forwardedCalls: Array<{
    ctx: unknown;
    event: unknown;
  }>;
  handlerExports: string[];
  reservedNames: string[];
  stateCountAfterAdd: unknown;
  stateCountAfterSubtract: unknown;
}

export interface GeneratedTypedDataParamCoercionBehaviorFact {
  buttonAttributes: Array<Record<string, string>>;
  handlerResults: {
    add: unknown;
    deselect: unknown;
    select: unknown;
  };
  parsedParams: {
    add: Record<string, unknown>;
    deselect: Record<string, unknown>;
    select: Record<string, unknown>;
    standalone: Record<string, unknown>;
  };
  stateCountAfterAdd: unknown;
}

export interface GeneratedRenderEquivalenceBehaviorFact {
  actualMatchesExpected: boolean;
  artifact: string | undefined;
  boundSpanAttrs: Record<string, string> | undefined;
  cartTotalAttrs: Record<string, string> | undefined;
  checkCount: number;
  mismatchRejected: boolean;
  ok: boolean | undefined;
}

export interface InlineEnhancedFormLoaderFact {
  appendCalls: Array<[string, string]>;
  dispatchedQueries: Array<{
    body: string;
    key: string;
    name: string;
    type: string;
  }>;
  fetchCalls: Array<{
    body: unknown;
    headers: Record<string, string>;
    keepalive: boolean;
    method: string;
    url: string;
  }>;
  fragmentHtmlByTarget: Record<string, string>;
  listenerEvents: string[];
  listenerOptions: Record<string, { capture?: boolean }>;
}

type InlineEnhancedFormListener = (event: unknown) => void;

interface InlineEnhancedFormListenerFact {
  listener: InlineEnhancedFormListener;
  options: { capture?: boolean };
}

interface InlineEnhancedFormEventFact {
  detail?: {
    attrs?: string;
    body?: string;
    content?: string;
    key?: string;
    name?: string;
    queries?: Array<{ attrs?: unknown; content?: unknown }>;
  };
  type: string;
}

interface InlineEnhancedFormFetchOptions {
  body: unknown;
  headers: Headers | Record<string, string>;
  keepalive: boolean;
  method: string;
}

export type GeneratedHandlerReferenceVersionShape = 'lower-hex-8' | 'invalid';

export interface GeneratedHandlerReferenceFact {
  handlerName: string;
  modulePath: string;
  requestPath: string;
  staleVersionRequestPath: string;
  version: string;
  versionShape: GeneratedHandlerReferenceVersionShape;
}

export type GeneratedHandlerReferenceSummaryFact = Pick<
  GeneratedHandlerReferenceFact,
  'handlerName' | 'modulePath' | 'versionShape'
>;

export interface GeneratedRenderedElementFact {
  attrs: Record<string, string>;
  innerHtml: string;
  tag: string;
}

export interface GeneratedRegistryConsumerTypeOptions extends AssertTypeScriptProgramOptions {
  consumerFileName?: string;
  registryFileName?: string;
}

export interface GeneratedMinifierNamePreservationOptions {
  cartBadge: {
    files: readonly GeneratedArtifactFile[];
    handlerExports: readonly string[];
  };
  cartDrawer: unknown;
  collectMinifierReservedNames(results: readonly unknown[]): string[];
  executeClientArtifact: typeof executeGeneratedClientArtifact;
  runtime: GeneratedRuntimeModule;
}

export interface GeneratedTypedDataParamCoercionOptions {
  executeClientArtifact: typeof executeGeneratedClientArtifact;
  files: readonly GeneratedArtifactFile[];
  readElementParams(element: {
    attributes: Array<{ name: string; value: string }>;
    getAttribute(name: string): string | null | undefined;
  }): Record<string, unknown>;
  runtime: GeneratedRuntimeModule;
}

export interface GeneratedRenderEquivalenceOptions {
  assertRenderEquivalence(result: unknown): void;
  result: {
    files: readonly GeneratedArtifactFile[];
    renderEquivalenceChecks: Array<{
      actual: string;
      artifact: string;
      expected: string;
      ok: boolean;
    }>;
  };
}

const isLowerHex = (value: string): boolean => /^[0-9a-f]+$/.test(value);

export function generatedHandlerReferenceFact(
  href: string,
  baseUrl = 'http://kovo.test',
): GeneratedHandlerReferenceFact {
  const url = new URL(href, baseUrl);
  const pathVersion = /^\/c\/__v\/([^/]+)\/(.+)$/.exec(url.pathname);
  const version = pathVersion?.[1] ?? url.searchParams.get('v') ?? '';
  const modulePath = pathVersion ? `/c/${pathVersion[2] ?? ''}` : url.pathname;
  return {
    handlerName: url.hash.startsWith('#') ? url.hash.slice(1) : '',
    modulePath,
    requestPath: pathVersion
      ? `/c/__v/${version}/${pathVersion[2] ?? ''}?cache=1`
      : `${url.pathname}?cache=1&v=${version}`,
    staleVersionRequestPath: pathVersion
      ? `/c/__v/00000000/${pathVersion[2] ?? ''}`
      : `${url.pathname}?v=00000000`,
    version,
    versionShape: version.length === 8 && isLowerHex(version) ? 'lower-hex-8' : 'invalid',
  };
}

export function generatedHandlerReferenceSummaryFact(
  href: string,
  baseUrl = 'http://kovo.test',
): GeneratedHandlerReferenceSummaryFact {
  const fact = generatedHandlerReferenceFact(href, baseUrl);

  return {
    handlerName: fact.handlerName,
    modulePath: fact.modulePath,
    versionShape: fact.versionShape,
  };
}

const rewriteGeneratedRuntimeImports = (source: string): string =>
  source.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]@kovojs\/browser(?:\/generated)?['"];\n?/g,
    (_match, names: string) => {
      const bindings = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .join(', ');
      return `const { ${bindings} } = runtime;\n`;
    },
  );

const rewriteGeneratedNamedImportsToGlobals = (source: string): string =>
  source.replace(/import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];\n?/g, (_match, names: string) => {
    const bindings = names
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => {
        const alias = /\s+as\s+/.test(name) ? name.split(/\s+as\s+/) : undefined;
        return alias ? `${alias[0]?.trim()}: ${alias[1]?.trim()}` : name;
      })
      .join(', ');
    return `const { ${bindings} } = globalThis;\n`;
  });

export function executeGeneratedClientModule(
  source: string,
  options: ExecuteGeneratedClientModuleOptions,
): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const moduleSource = rewriteGeneratedNamedImportsToGlobals(
    rewriteGeneratedRuntimeImports(source),
  ).replace(/export const ([A-Za-z_$][\w$]*)/g, 'const $1 = exports.$1');

  runInNewContext(moduleSource, {
    ...options.context,
    exports,
    runtime: options.runtime,
  });

  return exports;
}

export function executeGeneratedClientArtifact(
  files: readonly GeneratedArtifactFile[],
  options: ExecuteGeneratedClientModuleOptions,
): Record<string, unknown> {
  return executeGeneratedClientModule(generatedArtifactSource(files, 'client'), options);
}

export function executeGeneratedServerRenderSource(source: string): string {
  const exports = {} as { renderSource?: () => string };
  const moduleSource = source
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\n?/g, '')
    .replace(/export function ([A-Za-z_$][\w$]*)/g, 'exports.$1 = function $1');

  runInNewContext(moduleSource, { exports });

  if (typeof exports.renderSource !== 'function') {
    throw new Error('Generated server render source exports renderSource()');
  }
  return exports.renderSource();
}

export function executeGeneratedServerRenderArtifact(
  files: readonly GeneratedArtifactFile[],
): string {
  return executeGeneratedServerRenderSource(generatedArtifactSource(files, 'server'));
}

export function generatedRenderedElementFactsFromSource(
  source: string,
  selector: HtmlElementSelector = {},
): GeneratedRenderedElementFact[] {
  return renderedElementFacts(executeGeneratedServerRenderSource(source), selector);
}

export function generatedRenderedElementFactsFromArtifact(
  files: readonly GeneratedArtifactFile[],
  selector: HtmlElementSelector = {},
): GeneratedRenderedElementFact[] {
  return renderedElementFacts(executeGeneratedServerRenderArtifact(files), selector);
}

export function generatedClientExportTypeFacts(
  exports: Record<string, unknown>,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, typeof exports[name]]));
}

export async function generatedViewTransitionStampBehaviorFact(options: {
  files: readonly GeneratedArtifactFile[];
  registryMemberTypes: Promise<Record<string, string>>;
  viewTransitions: readonly { name: string }[];
}): Promise<GeneratedViewTransitionStampBehaviorFact> {
  const renderedElements = generatedRenderedElementFactsFromArtifact(options.files);
  const renderedImage = renderedElements.find((element) => element.tag === 'img');

  return {
    componentAttr: renderedImage?.attrs['kovo-c'],
    jsxPropPreserved: Object.hasOwn(renderedImage?.attrs ?? {}, 'viewTransitionName'),
    registryMemberTypes: await options.registryMemberTypes,
    src: renderedImage?.attrs.src,
    styledElementCount: renderedElements.filter((element) => Object.hasOwn(element.attrs, 'style'))
      .length,
    style: renderedImage?.attrs.style,
    viewTransitionNames: options.viewTransitions.map((transition) => transition.name),
  };
}

const generatedTypedRouteDiagnosticFacts = (
  diagnostics: readonly GeneratedTypedRouteDiagnosticLike[],
  codes?: readonly string[],
): GeneratedTypedRouteDiagnosticFact[] => {
  const codeSet = codes ? new Set(codes) : undefined;
  return diagnostics
    .filter((diagnostic) => codeSet === undefined || codeSet.has(diagnostic.code))
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.fileName === undefined ? {} : { fileName: diagnostic.fileName }),
      ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
      message: diagnostic.message,
      severity: diagnostic.severity,
    }));
};

const typedRouteValidSource = `
import { component, href, Link } from '@kovojs/core';

export const ProductLinks = component({
  render: () => (
    <nav>
      <Link to="/products/:id" params={{ id: 'p 1' }} search={{ max: 500 }}>Product</Link>
      <a href={href('/cart')}>Cart</a>
    </nav>
  ),
});
`;

const typedRouteInvalidSource = `
import { component } from '@kovojs/core';

export const ProductLinks = component({
  render: () => (
    <nav>
      <a href="/product/p1">Bad</a>
      <form method="get" action="/checkout"></form>
    </nav>
  ),
});
`;

const typedRouteRegistryConsumerSource = `
import { href, Link, redirect, route } from '@kovojs/core';

href('/cart', {});
href('/products/:id', { params: { id: 'p 1' }, search: { max: 500 } });
redirect('/products/:id', { params: { id: 'p1' } });
route('/products/:id');
Link('/cart', {});
Link('/products/:id', { params: { id: 'p1' } });

// @ts-expect-error generated RouteRegistry requires params for dynamic routes.
href('/products/:id', {});

// @ts-expect-error generated RouteRegistry keeps id params typed as string.
href('/products/:id', { params: { id: 1 } });

// @ts-expect-error generated RouteRegistry rejects undeclared routes.
href('/checkout', {});
`;

export async function generatedTypedRouteNavigationBehaviorFact(options: {
  assertRegistryConsumerTypes(
    files: readonly GeneratedArtifactFile[],
    consumerSource: string,
  ): Promise<void>;
  compileComponentModule(input: {
    fileName: string;
    registryFacts: { routes: readonly string[] };
    source: string;
  }): GeneratedTypedRouteCompileResult;
  href(path: string, options?: unknown): string;
  Link(path: string, options?: unknown): { href?: string };
  redirect(path: string, options?: unknown): { location?: string; status?: number };
  route(path: string): { path?: string };
  serverRoute(path: string, options: { load(): unknown }): { load?: unknown; path?: string };
}): Promise<GeneratedTypedRouteNavigationBehaviorFact> {
  const fileName = 'components/product-links.tsx';
  const registryFacts = { routes: ['/cart', '/products/:id'] };
  const declaredRoute = options.serverRoute('/products/:id', { load: () => 'ok' });
  const valid = options.compileComponentModule({
    fileName,
    registryFacts,
    source: typedRouteValidSource,
  });

  // SPEC §6.4: typed navigation lowers to plain anchors while residual hrefs validate via KV220.
  await options.assertRegistryConsumerTypes(valid.files, typedRouteRegistryConsumerSource);

  const invalid = options.compileComponentModule({
    fileName,
    registryFacts,
    source: typedRouteInvalidSource,
  });

  return {
    core: {
      href: options.href('/products/:id', { params: { id: 'p 1' }, search: { max: 10 } }),
      link: options.Link('/products/:id', { params: { id: 'p1' } }),
      redirect: options.redirect('/products/:id', { params: { id: 'p1' } }),
      route: options.route('/products/:id'),
      serverRoute: {
        loadType: typeof declaredRoute.load,
        ...(declaredRoute.path === undefined ? {} : { path: declaredRoute.path }),
      },
    },
    generated: {
      diagnostics: generatedTypedRouteDiagnosticFacts(valid.diagnostics),
      registryConsumerTypesAsserted: true,
      renderedHrefs: generatedRenderedElementFactsFromArtifact(valid.files, { tag: 'a' }).map(
        (element) => element.attrs.href ?? '',
      ),
    },
    invalidDiagnostics: generatedTypedRouteDiagnosticFacts(invalid.diagnostics, ['KV220']),
    provenance: {
      spec: 'SPEC.md section 6.4',
    },
  };
}

export function generatedMinifierNamePreservationBehaviorFact(
  options: GeneratedMinifierNamePreservationOptions,
): GeneratedMinifierNamePreservationBehaviorFact {
  const forwardedCalls: GeneratedMinifierNamePreservationBehaviorFact['forwardedCalls'] = [];
  const client = options.executeClientArtifact(options.cartBadge.files, {
    context: {
      removeItem(event: unknown, ctx: unknown) {
        forwardedCalls.push({ ctx, event });
        return 'removed';
      },
    },
    runtime: options.runtime,
  });
  const remove = callableGeneratedExport(client, 'CartBadge$removeItem');
  const add = callableGeneratedExport(client, 'CartBadge$button_click');
  const subtract = callableGeneratedExport(client, 'CartBadge$button_click_2');
  const clickContext = { params: { quantity: 2 }, state: { count: 5 } };
  const removeResult = remove('click', clickContext);
  const addResult = add('click', clickContext);
  const stateCountAfterAdd = clickContext.state.count;
  const subtractResult = subtract('click', clickContext);

  return {
    callResults: {
      add: addResult,
      remove: removeResult,
      subtract: subtractResult,
    },
    exportTypes: generatedClientExportTypeFacts(client, options.cartBadge.handlerExports),
    forwardedCalls,
    handlerExports: [...options.cartBadge.handlerExports],
    reservedNames: options.collectMinifierReservedNames([
      options.cartDrawer,
      options.cartBadge,
      options.cartBadge,
    ]),
    stateCountAfterAdd,
    stateCountAfterSubtract: clickContext.state.count,
  };
}

export function generatedTypedDataParamCoercionBehaviorFact(
  options: GeneratedTypedDataParamCoercionOptions,
): GeneratedTypedDataParamCoercionBehaviorFact {
  const buttons = generatedRenderedElementFactsFromArtifact(options.files, { tag: 'button' });
  const client = options.executeClientArtifact(options.files, {
    context: {
      deselect: (id: unknown) => `deselect:${String(id)}`,
      select: (id: unknown) => `select:${String(id)}`,
    },
    runtime: options.runtime,
  });
  const add = callableGeneratedExport(client, 'CartActions$button_click');
  const select = callableGeneratedExport(client, 'CartActions$button_click_2');
  const addParams = options.readElementParams({
    attributes: [{ name: 'data-p-quantity', value: '2' }],
    getAttribute: (name) =>
      name === 'kovo-param-types' ? buttons[0]?.attrs['kovo-param-types'] : null,
  });
  const selectParams = options.readElementParams({
    attributes: [
      { name: 'data-p-selected', value: 'true' },
      { name: 'data-p-id', value: 'p1' },
    ],
    getAttribute: (name) =>
      name === 'kovo-param-types' ? buttons[1]?.attrs['kovo-param-types'] : null,
  });
  const deselectParams = options.readElementParams({
    attributes: [
      { name: 'data-p-selected', value: 'false' },
      { name: 'data-p-id', value: 'p2' },
    ],
    getAttribute: (name) =>
      name === 'kovo-param-types' ? buttons[1]?.attrs['kovo-param-types'] : null,
  });
  const standaloneParams = options.readElementParams({
    attributes: [
      { name: 'data-p-product-id', value: 'p1' },
      { name: 'data-p-quantity', value: '2' },
      { name: 'data-p-featured', value: 'false' },
    ],
    getAttribute: (name) =>
      name === 'kovo-param-types' ? 'quantity:number featured:boolean' : null,
  });
  const cartState = { count: 1 };

  return {
    buttonAttributes: buttons.map((button) => typedDataParamAttributes(button.attrs)),
    handlerResults: {
      add: add('click', { params: addParams, state: cartState }),
      deselect: select('click', { params: deselectParams, state: cartState }),
      select: select('click', { params: selectParams, state: cartState }),
    },
    parsedParams: {
      add: addParams,
      deselect: deselectParams,
      select: selectParams,
      standalone: standaloneParams,
    },
    stateCountAfterAdd: cartState.count,
  };
}

export function generatedRenderEquivalenceBehaviorFact(
  options: GeneratedRenderEquivalenceOptions,
): GeneratedRenderEquivalenceBehaviorFact {
  const renderedElements = generatedRenderedElementFactsFromArtifact(options.result.files);
  const cartTotal = renderedElements.find((element) => element.tag === 'cart-total');
  const boundSpan = renderedElements.find((element) => element.tag === 'span');
  const [check] = options.result.renderEquivalenceChecks;
  options.assertRenderEquivalence(options.result);

  let mismatchRejected = false;
  if (check) {
    try {
      options.assertRenderEquivalence({
        ...options.result,
        renderEquivalenceChecks: [
          {
            ...check,
            actual: '<cart-total>0</cart-total>',
            expected: '<cart-total>1</cart-total>',
            ok: false,
          },
        ],
      });
    } catch {
      mismatchRejected = true;
    }
  }

  return {
    actualMatchesExpected: check?.actual === check?.expected,
    artifact: check?.artifact,
    boundSpanAttrs: boundSpan?.attrs,
    cartTotalAttrs: cartTotal?.attrs,
    checkCount: options.result.renderEquivalenceChecks.length,
    mismatchRejected,
    ok: check?.ok,
  };
}

export function generatedQueryUpdatePlanBehaviorFact(
  files: readonly GeneratedArtifactFile[],
  runtime: Pick<
    GeneratedQueryUpdatePlanRuntime,
    'applyCompiledQueryUpdatePlan' | 'executeClientArtifact' | 'runtime'
  >,
): GeneratedQueryUpdatePlanBehaviorFact {
  // SPEC.md §4.4/§4.8: generated query plans are executed by walking
  // self-describing DOM stamps instead of inspecting generated source text.
  const clientExports = runtime.executeClientArtifact(files, { runtime: runtime.runtime });
  const cartPlans = clientExports.CartBadge$queryUpdatePlans as {
    cart: (
      root: GeneratedFixtureMorphRoot,
      value: unknown,
    ) => GeneratedQueryUpdatePlanBehaviorFact['appliedPlan'];
  };
  const countBinding = new GeneratedFixtureElement(
    { 'data-bind': 'cart.count' },
    { textContent: '0' },
  );
  const emptyButton = new GeneratedFixtureElement({
    'data-bind:hidden': 'cart.empty',
    hidden: 'true',
  });
  const namedDerive = new GeneratedFixtureElement(
    { 'data-derive': 'cart.CartBadge$isEmpty' },
    { textContent: 'true' },
  );
  const disabledStamp = new GeneratedFixtureElement({
    'data-derive': 'cart.CartBadge$button_disabled_derive',
    disabled: 'true',
  });
  const itemStamp = new GeneratedFixtureTemplateStampHost({ 'data-bind-list': 'cart.items' });
  const root = new GeneratedFixtureMorphRoot();
  root.bindings.push(countBinding);
  root.elements.push(emptyButton, namedDerive, disabledStamp, itemStamp);

  const appliedPlan = cartPlans.cart(root, {
    count: 2,
    empty: false,
    items: [
      { name: 'Coffee', productId: 'p1', qty: 1 },
      { name: 'Tea', productId: 'p2', qty: 3 },
    ],
  });

  const order: string[] = [];
  const orderedRoot = new GeneratedFixtureMorphRoot();
  const orderedBinding = new GeneratedFixtureElement(
    { 'data-bind': 'cart.count' },
    { textContent: 'stale' },
  );
  const orderedDerive = new GeneratedFixtureElement(
    { 'data-derive': 'cart.summary' },
    { textContent: 'stale' },
  );
  const orderedStamp = new GeneratedFixtureElement({ 'data-derive': 'cart.disabled' });
  orderedRoot.bindings.push(orderedBinding);
  orderedRoot.elements.push(orderedDerive, orderedStamp);
  runtime.applyCompiledQueryUpdatePlan(
    orderedRoot,
    'cart',
    { count: 6, disabled: true, items: [1] },
    {
      derives: [
        {
          name: 'summary',
          select(value: { items: unknown[] }) {
            order.push(`derive-after-binding:${orderedBinding.textContent}`);
            return `items:${value.items.length}`;
          },
          selector: '[data-derive="cart.summary"]',
        },
      ],
      stamps: [
        {
          attr: 'disabled',
          select(value: { disabled: boolean }) {
            order.push(`stamp-after-derive:${orderedDerive.textContent}`);
            return value.disabled;
          },
          selector: '[data-derive="cart.disabled"]',
        },
      ],
    },
  );

  return {
    appliedPlan,
    bindingText: countBinding.textContent,
    booleanAttributes: {
      disabled: disabledStamp.getAttribute('disabled'),
      hidden: emptyButton.getAttribute('hidden'),
    },
    deriveText: namedDerive.textContent,
    orderedApply: {
      order,
      stampValue: orderedStamp.getAttribute('disabled'),
    },
    templateItems: itemStamp.items.map(({ html, key }) => ({ html, key })),
  };
}

export function generatedBootstrapDeferredBehaviorFact(
  files: readonly GeneratedArtifactFile[],
  runtime: Pick<
    GeneratedQueryUpdatePlanRuntime,
    'emitQueryPlanBootstrapModule' | 'executeBootstrapModule' | 'executeClientArtifact' | 'runtime'
  >,
  bootstrapRuntime: Required<
    Pick<
      GeneratedRuntimeModule,
      'applyDeferredStreamResponseToRuntime' | 'createQueryStore' | 'installKovoLoader'
    >
  >,
): GeneratedBootstrapDeferredBehaviorFact {
  // SPEC.md §4.4/§8: generated bootstrap modules wire query plans into the
  // loader and expose deferred stream application as public behavior.
  const clientExports = runtime.executeClientArtifact(files, { runtime: runtime.runtime });
  const queryUpdatePlans = clientExports.CartBadge$queryUpdatePlans as {
    cart: (root: unknown, value: unknown) => unknown;
  };
  const bootstrap = runtime.emitQueryPlanBootstrapModule([
    {
      exportName: 'CartBadge$queryUpdatePlans',
      importPath: '../components/cart-badge.client.js',
    },
  ]);
  const installed = runtime.executeBootstrapModule(
    bootstrap.source,
    {
      '../components/cart-badge.client.js': {
        CartBadge$queryUpdatePlans: queryUpdatePlans,
      },
    },
    bootstrapRuntime,
  );
  const installCall = installed.calls[0] as {
    enhancedMutations?: { queryPlans?: Record<string, unknown>; store?: unknown };
    queryStore?: unknown;
  };
  const applyRoot = new GeneratedFixtureMorphRoot();
  applyRoot.targets.set('cart-badge', new GeneratedFixtureMorphTarget());
  applyRoot.bindings.push(
    new GeneratedFixtureElement({ 'data-bind': 'cart.count' }, { textContent: '0' }),
  );
  const applyingRuntime = runtime.executeBootstrapModule(
    bootstrap.source,
    {
      '../components/cart-badge.client.js': {
        CartBadge$queryUpdatePlans: queryUpdatePlans,
      },
    },
    bootstrapRuntime,
  );
  const applyDeferredStreamResponse = applyingRuntime.exports.applyKovoDeferredStreamResponse as (
    body: string,
    options: { root: GeneratedFixtureMorphRoot },
  ) => { appliedFragments: string[] };
  const applyResult = applyDeferredStreamResponse(
    [
      '<!doctype html><main><kovo-defer target="cart-badge"></kovo-defer></main>',
      '--kovo-boundary',
      '<kovo-query name="cart">{"count":9,"empty":false,"items":[]}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">9</span></cart-badge></kovo-fragment>',
      '--kovo-boundary--',
    ].join('\n'),
    { root: applyRoot },
  ) as { appliedFragments: string[] };

  return {
    appliedFragments: applyResult.appliedFragments,
    bootstrapCallCount: installed.calls.length,
    deferredApplicationCount: installed.deferredApplications.length,
    enhancedMutationStoreMatches: installCall.enhancedMutations?.store === installed.store,
    fragmentHtmlByTarget: {
      'cart-badge': applyRoot.targets.get('cart-badge')?.html ?? '',
    },
    queryPlanStoreMatches: installCall.queryStore === installed.store,
    updatedBindings: {
      'cart.count': applyRoot.bindings[0]?.textContent ?? null,
    },
  };
}

export function generatedServerDeferredBehaviorFact(
  runtime: Pick<
    GeneratedQueryUpdatePlanRuntime,
    'applyDeferredStreamResponseToRuntime' | 'createQueryStore' | 'renderDeferredStream'
  >,
): GeneratedServerDeferredBehaviorFact {
  // SPEC.md §8/§9.1: deferred stream chunks are sorted, applied, and stored
  // through the same fragment/query wire vocabulary as mutation responses.
  const serverStream = runtime.renderDeferredStream({
    boundary: 'gate-boundary',
    chunks: [
      {
        fragments: [
          { html: '<article>A</article>', mode: 'append', target: 'reviews' },
          { html: '<section>Replace</section>', priority: 'high', target: 'summary' },
        ],
        queries: [{ name: 'reviews', value: { items: ['A'] } }],
      },
      {
        fragments: [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
        priority: 'high',
        queries: [{ name: 'reviews', value: { items: ['A', 'B'] } }],
      },
    ],
    closeHtml: '',
    shell: '<!doctype html><main><kovo-defer target="reviews"></kovo-defer></main>',
  });
  const root = new GeneratedFixtureMorphRoot();
  root.targets.set('reviews', new GeneratedFixtureMorphTarget('<article>Initial</article>'));
  root.targets.set('summary', new GeneratedFixtureMorphTarget('<section>Old</section>'));
  const store = runtime.createQueryStore();
  const applied = runtime.applyDeferredStreamResponseToRuntime({
    body: serverStream.body,
    boundary: 'gate-boundary',
    root,
    store,
  });

  return {
    appliedFragments: applied.appliedFragments,
    chunkFragments: applied.chunks.map((chunk) => chunk.fragments),
    chunkQueries: applied.chunks.map((chunk) => chunk.queries),
    fragmentHtmlByTarget: {
      reviews: root.targets.get('reviews')?.html ?? '',
      summary: root.targets.get('summary')?.html ?? '',
    },
    storeValues: {
      reviews: store.get('reviews'),
    },
  };
}

export function generatedWireDeferredBehaviorFact(
  body: string,
  runtime: Pick<
    GeneratedQueryUpdatePlanRuntime,
    'applyCompiledQueryUpdatePlan' | 'applyDeferredStreamResponseToRuntime' | 'createQueryStore'
  >,
): GeneratedWireDeferredBehaviorFact {
  const response = kovoResponseBodyFact(body);
  const root = new GeneratedFixtureMorphRoot();
  root.targets.set('reviews:p1', new GeneratedFixtureMorphTarget());
  root.targets.set('recommendations:p1', new GeneratedFixtureMorphTarget());
  const store = runtime.createQueryStore();
  const applied = runtime.applyDeferredStreamResponseToRuntime({
    body,
    queryPlans: {
      reviews(planRoot, value) {
        return runtime.applyCompiledQueryUpdatePlan(planRoot, 'reviews', value, { bindings: true });
      },
      recommendations(planRoot, value) {
        return runtime.applyCompiledQueryUpdatePlan(planRoot, 'recommendations', value, {
          bindings: true,
        });
      },
    },
    root,
    store,
  });

  return {
    appliedFragments: applied.appliedFragments,
    chunkFragmentTargets: applied.chunks.map((chunk) =>
      chunk.fragments.map((fragment) => fragment.target),
    ),
    fragmentHtmlFactsByTarget: {
      'reviews:p1': htmlElementFacts(root.targets.get('reviews:p1')?.html ?? '', {
        tag: 'article',
      }).map((element) => ({
        attrs: element.attrs,
        innerHtml: element.innerHtml,
        tag: element.tag,
      })),
    },
    fragmentTargets: response.fragmentTargets,
    queryNames: response.queryNames,
    storeValues: {
      recommendations: store.get('recommendations', 'product:p1'),
      reviews: store.get('reviews', 'product:p1'),
    },
    stylesheetHrefsByTarget: {
      ...response.stylesheetHrefsByTarget,
      'reviews:p1': htmlLinkHrefs(root.targets.get('reviews:p1')?.html ?? ''),
    },
  };
}

export async function generatedRegistryInterfaceMemberTypes(
  files: readonly GeneratedArtifactFile[],
  interfaceName: string,
  fileName = 'generated-registry.ts',
): Promise<Record<string, string>> {
  const { typeScriptInterfaceMemberTypes } = await import('./typescript-fixtures.ts');

  return typeScriptInterfaceMemberTypes(
    fileName,
    generatedArtifactSource(files, 'registry'),
    interfaceName,
  );
}

export async function assertGeneratedRegistryConsumerTypes(
  files: readonly GeneratedArtifactFile[],
  consumerSource: string,
  options: GeneratedRegistryConsumerTypeOptions = {},
): Promise<void> {
  const { assertTypeScriptProgramHasNoDiagnostics } = await import('./typescript-fixtures.ts');
  const workspaceRoot =
    options.workspaceRoot ?? fileURLToPath(new URL('../../../', import.meta.url));
  const registryFileName =
    options.registryFileName ?? join(workspaceRoot, '.kovo-test-generated', 'registry.ts');
  const consumerFileName =
    options.consumerFileName ?? join(workspaceRoot, '.kovo-test-generated', 'consumer.ts');
  const coreGeneratedFileName = join(
    workspaceRoot,
    '.kovo-test-generated',
    'core-generated-import.ts',
  );

  await assertTypeScriptProgramHasNoDiagnostics(
    {
      [coreGeneratedFileName]: `import '@kovojs/core/generated';\n`,
      [registryFileName]: generatedArtifactSource(files, 'registry'),
      [consumerFileName]: consumerSource,
    },
    {
      ...(options.compilerOptions === undefined
        ? {}
        : { compilerOptions: options.compilerOptions }),
      workspaceRoot,
    },
  );
}

function renderedElementFacts(
  html: string,
  selector: HtmlElementSelector,
): GeneratedRenderedElementFact[] {
  return htmlElementFacts(html, selector).map(({ attrs, innerHtml, tag }) => ({
    attrs,
    innerHtml,
    tag,
  }));
}

function callableGeneratedExport(
  exports: Record<string, unknown>,
  name: string,
): (event: unknown, ctx: unknown) => unknown {
  const handler = exports[name];
  if (typeof handler !== 'function') {
    throw new Error(`Generated client export is callable: ${name}`);
  }
  return handler as (event: unknown, ctx: unknown) => unknown;
}

function typedDataParamAttributes(attrs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attrs).filter(
      ([name]) => name === 'kovo-param-types' || name.startsWith('data-p-'),
    ),
  );
}

export function executeGeneratedBootstrapModule(
  source: string,
  planModules: Record<string, Record<string, unknown>>,
  runtime: Required<
    Pick<
      GeneratedRuntimeModule,
      'applyDeferredStreamResponseToRuntime' | 'createQueryStore' | 'installKovoLoader'
    >
  >,
): ExecuteGeneratedBootstrapModuleResult {
  const calls: unknown[] = [];
  const deferredApplications: unknown[] = [];
  const exports: Record<string, unknown> = {};
  const store = runtime.createQueryStore();
  const documentRoot = new GeneratedFixtureMorphRoot();
  const moduleSource = rewriteGeneratedRuntimeImports(source)
    .replace(
      /import\s+\{ ([A-Za-z_$][\w$]*) \}\s+from\s+['"]([^'"]+)['"];\n?/g,
      (_match, exportName: string, importPath: string) =>
        `const { ${exportName} } = planModules[${JSON.stringify(importPath)}];\n`,
    )
    .replace(/export function ([A-Za-z_$][\w$]*)/g, 'exports.$1 = function $1');

  runInNewContext(moduleSource, {
    document: documentRoot,
    exports,
    fetch() {},
    planModules,
    runtime: {
      ...runtime,
      applyDeferredStreamResponseToRuntime(options: unknown) {
        deferredApplications.push(options);
        return runtime.applyDeferredStreamResponseToRuntime(options);
      },
      createQueryStore() {
        return store;
      },
      installKovoLoader(options: unknown) {
        calls.push(options);
        return runtime.installKovoLoader(options);
      },
    },
  });

  return { calls, deferredApplications, documentRoot, exports, store };
}

export async function executeInlineEnhancedFormLoaderFixture(
  loaderSource: string,
): Promise<InlineEnhancedFormLoaderFact> {
  const listeners = new Map<string, InlineEnhancedFormListenerFact>();
  const dispatched: InlineEnhancedFormEventFact[] = [];
  class InlineFixtureText {
    readonly text: string;

    constructor(text: string) {
      this.text = text;
    }

    get outerHTML(): string {
      return this.text;
    }

    cloneNode(): InlineFixtureText {
      return new InlineFixtureText(this.text);
    }
  }

  class InlineFixtureElement {
    readonly attributes: Array<{ name: string; value: string }> = [];
    childNodes: Array<InlineFixtureElement | InlineFixtureText> = [];
    children: InlineFixtureElement[] = [];
    innerHTML = '';
    isConnected = true;
    private readonly tag: string;
    readonly tagName: string;

    constructor(tagName = 'DIV', tag = tagName.toLowerCase()) {
      this.tagName = tagName;
      this.tag = tag;
    }

    get outerHTML(): string {
      return `<${this.tag}>${this.innerHTML}</${this.tag}>`;
    }

    cloneNode(): InlineFixtureElement {
      const clone = new InlineFixtureElement(this.tagName, this.tag);
      clone.replaceChildren(...this.childNodes.map((node) => node.cloneNode()));
      return clone;
    }

    contains(): boolean {
      return false;
    }

    getAttribute(): string | null {
      return null;
    }

    hasAttribute(): boolean {
      return false;
    }

    insertAdjacentHTML(position: string, html: string): void {
      appendCalls.push([position, html]);
    }

    querySelectorAll(): InlineFixtureElement[] {
      return [];
    }

    removeAttribute(): void {}

    replaceChildren(...nodes: Array<InlineFixtureElement | InlineFixtureText>): void {
      this.childNodes = nodes;
      this.children = nodes.filter(
        (node): node is InlineFixtureElement => node instanceof InlineFixtureElement,
      );
      this.innerHTML = nodes.map((node) => node.outerHTML).join('');
    }

    replaceWith(node: InlineFixtureElement): void {
      this.innerHTML = node.outerHTML;
    }

    setAttribute(): void {}
  }

  const appendCalls: Array<[string, string]> = [];
  const fragmentTarget = new InlineFixtureElement();
  const appendTarget = new InlineFixtureElement();
  const readTemplateElement = (html: string): InlineFixtureElement | undefined => {
    const match = /^<([a-z][\w:-]*)(?:\s[^>]*)?>([\s\S]*)<\/\1>$/i.exec(html.trim());
    if (!match) return undefined;
    const element = new InlineFixtureElement(match[1]?.toUpperCase() ?? 'DIV', match[1] ?? 'div');
    element.replaceChildren(new InlineFixtureText(match[2] ?? ''));
    return element;
  };
  const formData = { kind: 'form-data' };
  const fetchCalls: InlineEnhancedFormLoaderFact['fetchCalls'] = [];
  const form = {
    action: '/_m/cart/add',
    getAttribute(name: string) {
      return name === 'enhance' ? '' : null;
    },
    method: 'post',
  };
  const depElements = [
    {
      id: 'cart-badge',
      getAttribute(name: string) {
        if (name === 'kovo-deps') return 'cart';
        if (name === 'kovo-fragment-target') return null;
        // Real DOM elements expose their `id` via getAttribute('id'); the loader's
        // request-target identity falls back to it when no kovo-fragment-target is
        // present (inline-loader-build.ts targetIdentity, SPEC §9.1).
        if (name === 'id') return 'cart-badge';
        return null;
      },
    },
    {
      id: 'inventory-panel',
      getAttribute(name: string) {
        if (name === 'kovo-deps') return 'inventory stock';
        if (name === 'kovo-fragment-target') return 'inventory';
        if (name === 'id') return 'inventory-panel';
        return null;
      },
    },
  ];
  const context = {
    CustomEvent: class CustomEvent {
      detail: unknown;
      type: string;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    DOMParser: class DOMParser {
      parseFromString(body: string) {
        const queryElements = htmlElementFacts(body, { tag: 'kovo-query' });
        const fragmentElements = htmlElementFacts(body, { tag: 'kovo-fragment' }).map(
          (element) => ({
            getAttribute(name: string) {
              return element.attrs[name] ?? null;
            },
            innerHTML: element.innerHtml,
          }),
        );

        return {
          querySelectorAll(selector: string) {
            if (selector === 'kovo-query') {
              return queryElements.map((element) => ({
                getAttribute(name: string) {
                  return element.attrs[name] ?? null;
                },
                textContent: element.innerHtml,
              }));
            }
            if (selector === 'kovo-fragment') return fragmentElements;
            return [];
          },
        };
      }
    },
    Element: InlineFixtureElement,
    FormData: class FormData {
      constructor() {
        return formData;
      }
    },
    Headers,
    addEventListener(
      type: string,
      listener: InlineEnhancedFormListener,
      options: { capture?: boolean },
    ) {
      if (type === 'unload') throw new Error('inline loader must not register unload handlers');
      listeners.set(type, { listener, options });
    },
    attachShadow() {
      throw new Error('inline loader must not attach shadow roots');
    },
    crypto: {
      randomUUID() {
        return 'idem-inline';
      },
    },
    customElements: {
      define() {
        throw new Error('inline loader must not define custom elements');
      },
    },
    dispatchEvent(event: InlineEnhancedFormEventFact) {
      dispatched.push(event);
      return true;
    },
    document: {
      activeElement: null,
      createElement(tag: string) {
        if (tag !== 'template') return new InlineFixtureElement(tag.toUpperCase(), tag);
        return {
          content: { children: [] as InlineFixtureElement[] },
          set innerHTML(html: string) {
            const element = readTemplateElement(html);
            this.content.children = element ? [element] : [];
          },
        };
      },
      getElementById(id: string) {
        return id === 'cart-badge' ? fragmentTarget : null;
      },
      querySelector(selector: string) {
        return selector === '[kovo-fragment-target="cart-list"]' ? appendTarget : null;
      },
      querySelectorAll(selector: string) {
        if (selector === '[kovo-deps]') return depElements;
        return [];
      },
      visibilityState: 'visible',
    },
    location: {
      href: 'http://localhost/cart',
    },
    fetch: async (url: string, options: InlineEnhancedFormFetchOptions) => {
      fetchCalls.push({
        body: options.body,
        headers: inlineEnhancedFormHeaders(options.headers),
        keepalive: options.keepalive,
        method: options.method,
        url,
      });
      return {
        async text() {
          return [
            '<kovo-query name="cart" key="cart:c1">{"count":1}</kovo-query>',
            '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
            '<kovo-fragment target="cart-list" mode="append"><li>2</li></kovo-fragment>',
          ].join('\n');
        },
      };
    },
    setTimeout,
  };

  runInNewContext(loaderSource, context);
  listeners.get('submit')?.listener({
    preventDefault() {},
    target: {
      closest(selector: string) {
        return selector === 'form[enhance],form[data-enhance],form[data-mutation]' ? form : null;
      },
    },
    type: 'submit',
  });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  return {
    appendCalls,
    dispatchedQueries: dispatched.flatMap(inlineEnhancedFormQueryEvents),
    fetchCalls,
    fragmentHtmlByTarget: { 'cart-badge': fragmentTarget.innerHTML },
    listenerEvents: [...listeners.keys()],
    listenerOptions: Object.fromEntries(
      [...listeners.entries()].map(([event, { options }]) => [event, { ...options }]),
    ),
  };
}

function inlineEnhancedFormQueryEvents(event: InlineEnhancedFormEventFact): Array<{
  body: string;
  key: string;
  name: string;
  type: string;
}> {
  if (Array.isArray(event.detail?.queries)) {
    return event.detail.queries.map((query) =>
      inlineEnhancedFormQueryChunk(event.type, {
        attrs: typeof query.attrs === 'string' ? query.attrs : '',
        content: typeof query.content === 'string' ? query.content : '',
      }),
    );
  }

  if (event.detail?.attrs !== undefined || event.detail?.content !== undefined) {
    return [
      inlineEnhancedFormQueryChunk(event.type, {
        attrs: event.detail.attrs ?? '',
        content: event.detail.content ?? '',
      }),
    ];
  }

  return [
    {
      body: event.detail?.body ?? '',
      key: event.detail?.key ?? '',
      name: event.detail?.name ?? '',
      type: event.type,
    },
  ];
}

function inlineEnhancedFormQueryChunk(
  type: string,
  chunk: { attrs: string; content: string },
): { body: string; key: string; name: string; type: string } {
  const query = htmlElementFacts(`<kovo-query ${chunk.attrs}>${chunk.content}</kovo-query>`, {
    tag: 'kovo-query',
  })[0];
  return {
    body: chunk.content,
    key: query?.attrs.key ?? '',
    name: query?.attrs.name ?? '',
    type,
  };
}

function inlineEnhancedFormHeaders(
  headers: Headers | Record<string, string>,
): Record<string, string> {
  const entries =
    headers instanceof Headers ? Object.fromEntries(headers.entries()) : { ...headers };
  const canonicalNames: Record<string, string> = {
    accept: 'Accept',
    'kovo-fragment': 'Kovo-Fragment',
    'kovo-idem': 'Kovo-Idem',
    'kovo-targets': 'Kovo-Targets',
  };

  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      canonicalNames[name.toLowerCase()] ?? name,
      value,
    ]),
  );
}
