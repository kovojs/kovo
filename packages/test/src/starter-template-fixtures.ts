import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { commandSequence, loadVitePlusConfig, type VitePlusTask } from './command-fixtures.ts';
import { htmlElementFacts, type HtmlElementFact } from './html-fragment.ts';
import { cssSourceDirectives } from './source-fixtures.ts';

export interface StarterTemplateSources {
  ciWorkflowSource: string;
  graphSource: string;
  indexHtmlSource: string;
  packageJsonSource: string;
  stylesSource: string;
  viteConfigSource: string;
}

export interface StarterTemplatePackageFacts {
  dependencies: readonly string[];
  devDependencies: readonly string[];
  scripts: Record<string, unknown>;
}

export interface StarterTemplateIndexHtmlFacts {
  htmlAttrs: Record<string, string> | undefined;
  linkAttrs: ReadonlyArray<Record<string, string>>;
  metaAttrs: ReadonlyArray<Record<string, string>>;
  scriptAttrs: ReadonlyArray<Record<string, string>>;
  tags: readonly string[];
}

export interface StarterTemplateFacts {
  ciRunCommands: readonly string[];
  cssDirectives: readonly string[];
  graph: Record<string, unknown>;
  indexHtml: StarterTemplateIndexHtmlFacts;
  package: StarterTemplatePackageFacts;
  viteTasks: Record<string, VitePlusTask>;
}

interface StarterTemplatePackageJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
}

const sortedKeys = (value: Record<string, unknown> | undefined): string[] =>
  Object.keys(value ?? {}).sort();

const attrsFor = (
  elements: readonly HtmlElementFact[],
  tag: string,
): Array<Record<string, string>> =>
  elements.filter((element) => element.tag === tag).map((element) => element.attrs);

export async function starterTemplateFacts(
  sources: StarterTemplateSources,
): Promise<StarterTemplateFacts> {
  const packageJson = JSON.parse(sources.packageJsonSource) as StarterTemplatePackageJson;
  const viteConfig = await loadVitePlusConfig(sources.viteConfigSource);
  const indexElements = htmlElementFacts(sources.indexHtmlSource);
  const ciRunCommands = sources.ciWorkflowSource
    .split('\n')
    .map((line) => /^\s*-\s+run:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((command): command is string => Boolean(command));

  return {
    ciRunCommands:
      ciRunCommands.length > 0
        ? commandSequence(ciRunCommands.join(' && ')).map((command) => command.raw)
        : [],
    cssDirectives: cssSourceDirectives(sources.stylesSource),
    graph: JSON.parse(sources.graphSource) as Record<string, unknown>,
    indexHtml: {
      htmlAttrs: indexElements.find((element) => element.tag === 'html')?.attrs,
      linkAttrs: attrsFor(indexElements, 'link'),
      metaAttrs: attrsFor(indexElements, 'meta'),
      scriptAttrs: attrsFor(indexElements, 'script'),
      tags: indexElements.map((element) => element.tag),
    },
    package: {
      dependencies: sortedKeys(packageJson.dependencies),
      devDependencies: sortedKeys(packageJson.devDependencies),
      scripts: { ...packageJson.scripts },
    },
    viteTasks: viteConfig.run?.tasks ?? {},
  };
}

export interface StarterClientTemplateFixture {
  appendCalls: Array<[position: string, html: string]>;
  deferredApplications: unknown[];
  documentRoot: unknown;
  exports: Record<string, unknown>;
  fetchCalls: Array<[url: string, options: Record<string, unknown>]>;
  loaderInstalls: unknown[];
  queryStore: unknown;
}

interface StarterClientElement {
  innerHTML: string;
  insertAdjacentHTML(position: string, html: string): void;
}

export async function executeStarterClientTemplate(
  source: string,
): Promise<StarterClientTemplateFixture> {
  const ts = await import('typescript');
  const appendCalls: Array<[position: string, html: string]> = [];
  const deferredApplications: unknown[] = [];
  const fetchCalls: Array<[url: string, options: Record<string, unknown>]> = [];
  const loaderInstalls: unknown[] = [];
  const queryStore = { kind: 'starter-query-store' };
  const module = { exports: {} as Record<string, unknown> };
  const fragmentById: Record<string, StarterClientElement> = {
    'cart-badge': {
      innerHTML: '<cart-badge>0</cart-badge>',
      insertAdjacentHTML(position, html) {
        appendCalls.push([position, html]);
      },
    },
  };
  const documentRoot = {
    getElementById(id: string) {
      return fragmentById[id] ?? null;
    },
    querySelector(selector: string) {
      return selector === '[fw-fragment-target="cart-list"]'
        ? {
            innerHTML: '<ul></ul>',
            insertAdjacentHTML(position: string, html: string) {
              appendCalls.push([position, html]);
            },
          }
        : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const runtime = {
    applyDeferredStreamResponseToDom(options: unknown) {
      deferredApplications.push(options);
      return { applied: true };
    },
    createQueryStore() {
      return queryStore;
    },
    installJisoLoader(options: unknown) {
      loaderInstalls.push(options);
    },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiled, {
    CSS: { escape: (value: string) => value },
    document: documentRoot,
    exports: module.exports,
    fetch(url: string, options: Record<string, unknown>) {
      fetchCalls.push([url, options]);
      return { ok: true };
    },
    module,
    require(specifier: string) {
      if (specifier === '@jiso/runtime') return runtime;
      assert.fail(`unexpected starter client import ${specifier}`);
    },
  });

  return {
    appendCalls,
    deferredApplications,
    documentRoot,
    exports: module.exports,
    fetchCalls,
    loaderInstalls,
    queryStore,
  };
}
