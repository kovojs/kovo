import { runInNewContext } from 'node:vm';

import { htmlElementFacts, type HtmlElementSelector } from './html-fragment.ts';

export interface GeneratedArtifactFile {
  fileName?: string;
  kind: string;
  source: string;
}

export interface GeneratedComponentSourceFacts {
  authoredLoweredStampAttributes: string[];
  generatedHasLoweredIrMarker: boolean;
}

const loweredStampAttributePattern = /\b((?:data-bind|fw-deps|fw-c|fw-state|data-p-[\w-]+))=/g;

export function generatedComponentSourceFacts(options: {
  authoredSource: string;
  generatedSource: string;
}): GeneratedComponentSourceFacts {
  return {
    authoredLoweredStampAttributes: Array.from(
      options.authoredSource.matchAll(loweredStampAttributePattern),
      (match) => match[1] ?? '',
    ),
    generatedHasLoweredIrMarker: options.generatedSource.includes('// @jiso-ir'),
  };
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
  applyDeferredStreamResponseToDom?: (options: unknown) => unknown;
  createQueryStore?: () => unknown;
  derive?: unknown;
  handler?: unknown;
  installJisoLoader?: (options: unknown) => unknown;
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

const isLowerHex = (value: string): boolean => /^[0-9a-f]+$/.test(value);

export function generatedHandlerReferenceFact(
  href: string,
  baseUrl = 'http://jiso.test',
): GeneratedHandlerReferenceFact {
  const url = new URL(href, baseUrl);
  const version = url.searchParams.get('v') ?? '';
  return {
    handlerName: url.hash.startsWith('#') ? url.hash.slice(1) : '',
    modulePath: url.pathname,
    requestPath: `${url.pathname}?cache=1&v=${version}`,
    staleVersionRequestPath: `${url.pathname}?v=00000000`,
    version,
    versionShape: version.length === 8 && isLowerHex(version) ? 'lower-hex-8' : 'invalid',
  };
}

export function generatedHandlerReferenceSummaryFact(
  href: string,
  baseUrl = 'http://jiso.test',
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
    /import\s+\{([^}]+)\}\s+from\s+['"]@jiso\/runtime['"];\n?/g,
    (_match, names: string) => {
      const bindings = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .join(', ');
      return `const { ${bindings} } = runtime;\n`;
    },
  );

export function executeGeneratedClientModule(
  source: string,
  options: ExecuteGeneratedClientModuleOptions,
): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const moduleSource = rewriteGeneratedRuntimeImports(source).replace(
    /export const ([A-Za-z_$][\w$]*)/g,
    'const $1 = exports.$1',
  );

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
  const moduleSource = source.replace(
    /export function ([A-Za-z_$][\w$]*)/g,
    'exports.$1 = function $1',
  );

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

export function executeGeneratedBootstrapModule(
  source: string,
  planModules: Record<string, Record<string, unknown>>,
  runtime: Required<
    Pick<
      GeneratedRuntimeModule,
      'applyDeferredStreamResponseToDom' | 'createQueryStore' | 'installJisoLoader'
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
      applyDeferredStreamResponseToDom(options: unknown) {
        deferredApplications.push(options);
        return runtime.applyDeferredStreamResponseToDom(options);
      },
      createQueryStore() {
        return store;
      },
      installJisoLoader(options: unknown) {
        calls.push(options);
        return runtime.installJisoLoader(options);
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
  const fragmentTarget = { innerHTML: '' };
  const appendCalls: Array<[string, string]> = [];
  const appendTarget = {
    insertAdjacentHTML(position: string, html: string) {
      appendCalls.push([position, html]);
    },
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
        if (name === 'fw-deps') return 'cart';
        if (name === 'fw-fragment-target') return null;
        return null;
      },
    },
    {
      id: 'inventory-panel',
      getAttribute(name: string) {
        if (name === 'fw-deps') return 'inventory stock';
        if (name === 'fw-fragment-target') return 'inventory';
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
        const queryElements = htmlElementFacts(body, { tag: 'fw-query' });
        const fragmentElements = htmlElementFacts(body, { tag: 'fw-fragment' }).map((element) => ({
          getAttribute(name: string) {
            return element.attrs[name] ?? null;
          },
          innerHTML: element.innerHtml,
        }));

        return {
          querySelectorAll(selector: string) {
            if (selector === 'fw-query') {
              return queryElements.map((element) => ({
                getAttribute(name: string) {
                  return element.attrs[name] ?? null;
                },
                textContent: element.innerHtml,
              }));
            }
            if (selector === 'fw-fragment') return fragmentElements;
            return [];
          },
        };
      }
    },
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
      getElementById(id: string) {
        return id === 'cart-badge' ? fragmentTarget : null;
      },
      querySelector(selector: string) {
        return selector === '[fw-fragment-target="cart-list"]' ? appendTarget : null;
      },
      querySelectorAll(selector: string) {
        if (selector === '[fw-deps]') return depElements;
        return [];
      },
      visibilityState: 'visible',
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
            '<fw-query name="cart" key="cart:c1">{"count":1}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
            '<fw-fragment target="cart-list" mode="append"><li>2</li></fw-fragment>',
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
    dispatchedQueries: dispatched.map(inlineEnhancedFormQueryEvent),
    fetchCalls,
    fragmentHtmlByTarget: { 'cart-badge': fragmentTarget.innerHTML },
    listenerEvents: [...listeners.keys()],
    listenerOptions: Object.fromEntries(
      [...listeners.entries()].map(([event, { options }]) => [event, { ...options }]),
    ),
  };
}

function inlineEnhancedFormQueryEvent(event: InlineEnhancedFormEventFact): {
  body: string;
  key: string;
  name: string;
  type: string;
} {
  if (event.detail?.attrs !== undefined || event.detail?.content !== undefined) {
    const query = htmlElementFacts(
      `<fw-query ${event.detail.attrs ?? ''}>${event.detail.content ?? ''}</fw-query>`,
      { tag: 'fw-query' },
    )[0];
    return {
      body: event.detail.content ?? '',
      key: query?.attrs.key ?? '',
      name: query?.attrs.name ?? '',
      type: event.type,
    };
  }

  return {
    body: event.detail?.body ?? '',
    key: event.detail?.key ?? '',
    name: event.detail?.name ?? '',
    type: event.type,
  };
}

function inlineEnhancedFormHeaders(
  headers: Headers | Record<string, string>,
): Record<string, string> {
  const entries =
    headers instanceof Headers ? Object.fromEntries(headers.entries()) : { ...headers };
  const canonicalNames: Record<string, string> = {
    accept: 'Accept',
    'fw-fragment': 'FW-Fragment',
    'fw-idem': 'FW-Idem',
    'fw-targets': 'FW-Targets',
  };

  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      canonicalNames[name.toLowerCase()] ?? name,
      value,
    ]),
  );
}
