import { runInNewContext } from 'node:vm';

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

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) return this.getAttribute(exactAttribute[1] ?? '') === exactAttribute[2];

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1] ?? '') !== null : false;
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
