import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  commandSequence,
  loadVitePlusConfig,
  runCommandSequenceSync,
  type VitePlusTask,
} from './command-fixtures.ts';
import { kovoCheckOkAssertionFact, type KovoCheckOkAssertionFact } from './kovo-check-fixtures.ts';
import {
  kovoExplainMutationAssertionFact,
  kovoExplainPageAssertionFact,
  kovoExplainQueryAssertionFact,
  type KovoExplainMutationAssertionFact,
  type KovoExplainPageAssertionFact,
  type KovoExplainQueryAssertionFact,
} from './kovo-explain-fixtures.ts';
import { htmlElementFacts, type HtmlElementFact } from '@kovojs/test/html-fragment';
import { cssLayerNames } from './source-fixtures.ts';

export interface StarterTemplateSources {
  ciWorkflowSource: string;
  appSource?: string;
  clientSource?: string;
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
  appSource?: string;
  ciRunCommands: readonly string[];
  clientSource?: string;
  cssLayers: readonly string[];
  graph: Record<string, unknown>;
  indexHtml: StarterTemplateIndexHtmlFacts;
  package: StarterTemplatePackageFacts;
  viteTasks: Record<string, VitePlusTask>;
}

export interface StarterTemplateFixturePaths {
  compilerModuleUrl?: string;
  projectRoot: string | URL;
  templateRoot: string | URL;
}

export interface StarterTemplateDevDependencyCoverage {
  expected: readonly string[];
  missing: readonly string[];
  present: readonly string[];
}

export interface StarterTemplateKovoOutput {
  args: readonly string[];
  output: string;
}

export interface StarterTemplateExecutionResult {
  graph: unknown;
  output: string;
}

export interface StarterTemplateGraphFact {
  components: readonly string[];
  mutations: unknown;
  optimistic: unknown;
  pages: unknown;
  queries: unknown;
  touchGraphSites: Record<string, unknown>;
}

export interface StarterTemplateTaskFact {
  input: unknown;
  output: unknown;
}

export interface StarterTemplateAcceptanceFact {
  appCompile: {
    fixpointAsserted: boolean;
    renderEquivalenceAsserted: boolean;
  };
  browserClient: StarterClientTemplateBehaviorFact;
  ciRunCommands: readonly string[];
  cssLayers: readonly string[];
  devDependencyCoverage: StarterTemplateDevDependencyCoverage;
  emittedGraph: StarterTemplateExecutionResult;
  graph: StarterTemplateGraphFact;
  graphAssertionsOutput: string;
  graphCheck: KovoCheckOkAssertionFact;
  html: StarterTemplateIndexHtmlFacts;
  package: {
    dependencies: readonly string[];
    scripts: {
      emitGraph: unknown;
      kovoCheck: unknown;
      graphAssertions: unknown;
    };
  };
  taskOutputs: readonly StarterTemplateExecutionResult[];
  tasks: {
    kovoCheck: StarterTemplateTaskFact;
    graphAssertions: StarterTemplateTaskFact;
  };
  explain: {
    cartAdd: KovoExplainMutationAssertionFact;
    cartPage: KovoExplainPageAssertionFact;
    cartQuery: KovoExplainQueryAssertionFact;
  };
}

export interface StarterTemplateAcceptanceOptions extends StarterTemplateFixturePaths {
  assertFixpoint(result: unknown): void;
  assertRenderEquivalence(result: unknown): void;
  compileComponentModule(options: { fileName: string; source: string }): unknown;
  expectedDevDependencies: readonly string[];
  kovoCheck(graph: Record<string, unknown>): { exitCode: number; output: string };
  kovoExplain(
    graph: Record<string, unknown>,
    options:
      | { kind: 'mutation'; optimistic: true; target: string }
      | { kind: 'page'; target: string }
      | { kind: 'query'; target: string },
  ): { exitCode: number; output: string };
  kovoOutputs: readonly StarterTemplateKovoOutput[];
}

interface StarterTemplateGraphShape extends Record<string, unknown> {
  components?: Array<{ name?: unknown }>;
  mutations?: unknown;
  optimistic?: unknown;
  pages?: unknown;
  queries?: unknown;
  touchGraph?: Record<string, { touches?: unknown }>;
}

export interface ConformancePackageFixture {
  manifest: {
    name: string;
    scripts?: Record<string, unknown>;
  };
}

export interface PnpmFilterTaskExecution {
  observed: Array<{ packageName: string; script: string }>;
  output: string;
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
  const sourceFacts = {
    ...(sources.appSource === undefined ? {} : { appSource: sources.appSource }),
    ...(sources.clientSource === undefined ? {} : { clientSource: sources.clientSource }),
  };

  return {
    ...sourceFacts,
    ciRunCommands:
      ciRunCommands.length > 0
        ? commandSequence(ciRunCommands.join(' && ')).map((command) => command.raw)
        : [],
    cssLayers: cssLayerNames(sources.stylesSource),
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

const pathFrom = (path: string | URL): string => (path instanceof URL ? fileURLToPath(path) : path);

export async function loadStarterTemplateFacts(
  paths: StarterTemplateFixturePaths,
): Promise<StarterTemplateFacts> {
  const templateRoot = pathFrom(paths.templateRoot);
  const [
    packageJsonSource,
    ciWorkflowSource,
    clientSource,
    appSource,
    stylesSource,
    indexHtmlSource,
    viteConfigSource,
  ] = await Promise.all([
    readFile(join(templateRoot, 'package.json'), 'utf8'),
    readFile(join(templateRoot, '.github/workflows/ci.yml'), 'utf8'),
    readFile(join(templateRoot, 'src/client.ts'), 'utf8'),
    readFile(join(templateRoot, 'src/app.tsx'), 'utf8'),
    readFile(join(templateRoot, 'src/styles.css'), 'utf8'),
    readFile(join(templateRoot, 'index.html'), 'utf8'),
    readFile(join(templateRoot, 'vite.config.ts'), 'utf8'),
  ]);
  const graphSource = await emitStarterTemplateGraphSource(paths);

  return starterTemplateFacts({
    appSource,
    ciWorkflowSource,
    clientSource,
    graphSource,
    indexHtmlSource,
    packageJsonSource,
    stylesSource,
    viteConfigSource,
  });
}

export function starterTemplateDevDependencyCoverage(
  packageFacts: StarterTemplatePackageFacts,
  expected: readonly string[],
): StarterTemplateDevDependencyCoverage {
  const devDependencyNames = new Set(packageFacts.devDependencies);
  const present = expected.filter((dependencyName) => devDependencyNames.has(dependencyName));

  return {
    expected: [...expected],
    missing: expected.filter((dependencyName) => !devDependencyNames.has(dependencyName)),
    present,
  };
}

export async function starterTemplateAcceptanceFact(
  options: StarterTemplateAcceptanceOptions,
): Promise<StarterTemplateAcceptanceFact> {
  const starterFacts = await loadStarterTemplateFacts(options);
  if (typeof starterFacts.appSource !== 'string') {
    throw new Error('starter template exposes app TSX source');
  }
  if (typeof starterFacts.clientSource !== 'string') {
    throw new Error('starter template exposes browser client source');
  }

  const graph = starterFacts.graph as StarterTemplateGraphShape;
  const kovoCheckTask = starterFacts.viteTasks['kovo-check'];
  const graphAssertionsTask = starterFacts.viteTasks['graph-assertions'];
  const taskOutputs = await Promise.all([
    runStarterTemplateViteTaskCommand(kovoCheckTask?.command, options, options.kovoOutputs),
    runStarterTemplateViteTaskCommand(graphAssertionsTask?.command, options, options.kovoOutputs),
  ]);
  const emittedGraph = await runStarterTemplateEmitGraph(options);
  const graphAssertionsOutput = await runStarterTemplateGraphAssertions(
    options,
    options.kovoOutputs,
  );
  const appCompile = options.compileComponentModule({
    fileName: 'src/app.tsx',
    source: starterFacts.appSource,
  });
  options.assertFixpoint(appCompile);
  options.assertRenderEquivalence(appCompile);

  // SPEC.md §5.2: starter app code is authored as TSX/JS; this acceptance
  // projection verifies generated graph and runtime behavior without
  // asserting lowered source text in the kovo-check monolith.
  return {
    appCompile: {
      fixpointAsserted: true,
      renderEquivalenceAsserted: true,
    },
    browserClient: await starterClientTemplateBehaviorFact(starterFacts.clientSource),
    ciRunCommands: starterFacts.ciRunCommands,
    cssLayers: starterFacts.cssLayers,
    devDependencyCoverage: starterTemplateDevDependencyCoverage(
      starterFacts.package,
      options.expectedDevDependencies,
    ),
    emittedGraph,
    explain: {
      cartAdd: kovoExplainMutationAssertionFact(
        options.kovoExplain(graph, { kind: 'mutation', optimistic: true, target: 'cart/add' }),
      ),
      cartPage: kovoExplainPageAssertionFact(
        options.kovoExplain(graph, { kind: 'page', target: '/cart' }),
      ),
      cartQuery: kovoExplainQueryAssertionFact(
        options.kovoExplain(graph, { kind: 'query', target: 'cart' }),
      ),
    },
    graph: {
      components: graph.components?.map((component) => String(component.name)) ?? [],
      mutations: graph.mutations,
      optimistic: graph.optimistic,
      pages: graph.pages,
      queries: graph.queries,
      touchGraphSites: Object.fromEntries(
        Object.entries(graph.touchGraph ?? {}).map(([key, value]) => [key, value.touches]),
      ),
    },
    graphAssertionsOutput,
    graphCheck: kovoCheckOkAssertionFact(options.kovoCheck(graph)),
    html: starterFacts.indexHtml,
    package: {
      dependencies: starterFacts.package.dependencies,
      scripts: {
        emitGraph: starterFacts.package.scripts['emit-graph'],
        kovoCheck: starterFacts.package.scripts['kovo-check'],
        graphAssertions: starterFacts.package.scripts['graph-assertions'],
      },
    },
    taskOutputs,
    tasks: {
      kovoCheck: {
        input: kovoCheckTask?.input,
        output: kovoCheckTask?.output,
      },
      graphAssertions: {
        input: graphAssertionsTask?.input,
        output: graphAssertionsTask?.output,
      },
    },
  };
}

const compilerModuleUrlFor = (paths: StarterTemplateFixturePaths): string =>
  paths.compilerModuleUrl ??
  pathToFileURL(join(pathFrom(paths.projectRoot), 'dist/compiler/src/index.mjs')).href;

async function emitStarterTemplateGraphSource(paths: StarterTemplateFixturePaths): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'kovo-template-graph-source-'));

  try {
    await cp(paths.templateRoot, fixtureRoot, { recursive: true });
    execFileSync('node', ['scripts/emit-graph.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    return readFile(join(fixtureRoot, 'graph.json'), 'utf8');
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

const writeCompilerShim = async (fixtureRoot: string, compilerModuleUrl: string): Promise<void> => {
  const compilerShimRoot = join(fixtureRoot, 'node_modules/@kovojs/compiler');
  await mkdir(compilerShimRoot, { recursive: true });
  await writeFile(
    join(compilerShimRoot, 'package.json'),
    JSON.stringify({ exports: './index.mjs', type: 'module' }),
    'utf8',
  );
  await writeFile(
    join(compilerShimRoot, 'index.mjs'),
    `export * from ${JSON.stringify(compilerModuleUrl)};\n`,
    'utf8',
  );
};

const writeFakeKovo = async (
  fakeBin: string,
  outputs: readonly StarterTemplateKovoOutput[],
): Promise<string> => {
  await mkdir(fakeBin, { recursive: true });
  const fakeKovo = join(fakeBin, 'kovo');
  await writeFile(
    fakeKovo,
    `#!/usr/bin/env node
const outputs = new Map(${JSON.stringify(
      outputs.map((entry) => [JSON.stringify(entry.args), entry.output]),
    )});
const output = outputs.get(JSON.stringify(process.argv.slice(2)));
if (output === undefined) {
  process.stderr.write(\`unexpected kovo args: \${JSON.stringify(process.argv.slice(2))}\\n\`);
  process.exit(64);
}
process.stdout.write(output);
`,
    'utf8',
  );
  await chmod(fakeKovo, 0o755);
  return fakeKovo;
};

export async function runStarterTemplateGraphAssertions(
  paths: StarterTemplateFixturePaths,
  kovoOutputs: readonly StarterTemplateKovoOutput[],
): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'kovo-template-graph-assertions-'));
  const fakeBin = join(fixtureRoot, '.fake-bin');

  try {
    await cp(paths.templateRoot, fixtureRoot, { recursive: true });
    await writeFakeKovo(fakeBin, kovoOutputs);

    return execFileSync('node', ['scripts/graph-assertions.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function runStarterTemplateEmitGraph(
  paths: StarterTemplateFixturePaths,
): Promise<StarterTemplateExecutionResult> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'kovo-template-emit-graph-'));

  try {
    await cp(paths.templateRoot, fixtureRoot, { recursive: true });
    await writeCompilerShim(fixtureRoot, compilerModuleUrlFor(paths));

    const output = execFileSync('node', ['scripts/emit-graph.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    const graph = JSON.parse(await readFile(join(fixtureRoot, 'graph.json'), 'utf8')) as unknown;

    return { graph, output };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function runStarterTemplateViteTaskCommand(
  command: unknown,
  paths: StarterTemplateFixturePaths,
  kovoOutputs: readonly StarterTemplateKovoOutput[],
): Promise<StarterTemplateExecutionResult> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'kovo-template-task-'));
  const fakeBin = join(fixtureRoot, '.fake-bin');

  try {
    await cp(paths.templateRoot, fixtureRoot, { recursive: true });
    await writeCompilerShim(fixtureRoot, compilerModuleUrlFor(paths));
    await writeFakeKovo(fakeBin, kovoOutputs);

    const output = runCommandSequenceSync(command, {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
    const graph = JSON.parse(await readFile(join(fixtureRoot, 'graph.json'), 'utf8')) as unknown;

    return { graph, output };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function runPnpmFilterTaskCommand(
  command: unknown,
  expectedPackages: readonly ConformancePackageFixture[],
  options: { cwd: string | URL },
): Promise<PnpmFilterTaskExecution> {
  const fakeBin = await mkdtemp(join(tmpdir(), 'kovo-conformance-pnpm-'));
  const fakePnpm = join(fakeBin, 'pnpm');
  const observedPath = join(fakeBin, 'observed.jsonl');
  const packageScripts = Object.fromEntries(
    expectedPackages.map(({ manifest }) => [manifest.name, manifest.scripts ?? {}]),
  );
  const expectedPackageNames = expectedPackages
    .map(({ manifest }) => manifest.name)
    .toSorted((left, right) => left.localeCompare(right));

  try {
    await writeFile(
      fakePnpm,
      `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scriptsByPackage = JSON.parse(process.env.KOVO_CONFORMANCE_PACKAGE_SCRIPTS ?? '{}');
assert.deepEqual(args.slice(0, 2), ['--filter', args[1]]);
assert.equal(args[2], 'test');
assert.equal(args.length, 3);
const packageName = args[1];
const observedTestScript = scriptsByPackage[packageName]?.test;
assert.ok(
  observedTestScript === 'vitest --run' ||
    observedTestScript === 'vitest --run src/index.test.ts',
  \`\${packageName} exposes the expected conformance test command (got: \${observedTestScript})\`,
);
appendFileSync(process.env.KOVO_CONFORMANCE_OBSERVED, JSON.stringify({ packageName, script: args[2] }) + '\\n');
process.stdout.write(\`pnpm-filter-test \${packageName}\\n\`);
`,
      'utf8',
    );
    await chmod(fakePnpm, 0o755);

    const output = runCommandSequenceSync(command, {
      cwd: pathFrom(options.cwd),
      encoding: 'utf8',
      env: {
        ...process.env,
        KOVO_CONFORMANCE_OBSERVED: observedPath,
        KOVO_CONFORMANCE_PACKAGE_SCRIPTS: JSON.stringify(packageScripts),
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
    });
    const observed = (await readFile(observedPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { packageName: string; script: string });

    assert.deepEqual(
      observed
        .map((entry) => entry.packageName)
        .toSorted((left, right) => left.localeCompare(right)),
      expectedPackageNames,
      'conformance task executes every discovered conformance package test',
    );

    return { observed, output };
  } finally {
    await rm(fakeBin, { force: true, recursive: true });
  }
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

export interface StarterClientTemplateBehaviorFact {
  appendedHtml: Array<[position: string, html: string]>;
  deferredApplication: {
    body: unknown;
    boundary: unknown;
    morph: unknown;
    queryPlansMatch: boolean;
    rootMatches: boolean;
    storeMatches: boolean;
  };
  deferredApplied: unknown;
  fetchCall: {
    body: unknown;
    headers: Record<string, unknown>;
    keepalive: unknown;
    method: unknown;
    url: unknown;
  };
  fetchOk: unknown;
  fragmentHtml: {
    afterReplace: string | null;
    beforeReplace: string | null;
  };
  loader: {
    enhancedMutationStoreMatches: boolean;
    hasEnhancedFetch: boolean;
    hasImportModule: boolean;
    queryPlansType: string;
    queryStoreMatches: boolean;
    rootMatches: boolean;
  };
  loaderInstallCount: number;
}

interface StarterClientElement {
  innerHTML: string;
  insertAdjacentHTML(position: string, html: string): void;
}

interface StarterClientLoaderOptions {
  enhancedMutations?: {
    fetch?: (url: string, options: Record<string, unknown>) => { ok?: unknown };
    queryPlans?: unknown;
    root?: {
      findFragmentTarget(target: string): {
        appendHtml(html: string): void;
        readHtml(): string;
        replaceWithHtml(html: string): void;
      } | null;
    };
    store?: unknown;
  };
  importModule?: unknown;
  queryStore?: unknown;
  root?: unknown;
}

interface StarterDeferredApplication {
  body?: unknown;
  boundary?: unknown;
  morph?: unknown;
  queryPlans?: unknown;
  root?: unknown;
  store?: unknown;
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
      return selector === '[kovo-fragment-target="cart-list"]'
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
  class StarterDomMorphTarget {
    element: StarterClientElement;

    constructor(element: StarterClientElement) {
      this.element = element;
    }

    appendHtml(html: string) {
      this.element.insertAdjacentHTML('beforeend', html);
    }

    readHtml() {
      return this.element.innerHTML;
    }

    replaceWithHtml(html: string) {
      this.element.innerHTML = html;
    }
  }
  const runtime = {
    applyDeferredStreamResponseToRuntime(options: unknown) {
      deferredApplications.push(options);
      return { applied: true };
    },
    // Mirror the real `createBrowserKovoRoot` fragment-target resolution: look up
    // by id, fall back to the `[kovo-fragment-target=...]` selector, and wrap the
    // matched element in a DOM morph target (post facade-shrink this surface is
    // imported rather than defined locally in the starter template).
    createBrowserKovoRoot() {
      return {
        findFragmentTarget(target: string) {
          const element =
            documentRoot.getElementById(target) ??
            documentRoot.querySelector(`[kovo-fragment-target="${target}"]`);
          return element ? new StarterDomMorphTarget(element as StarterClientElement) : null;
        },
        querySelectorAll() {
          return documentRoot.querySelectorAll();
        },
      };
    },
    createQueryStore() {
      return queryStore;
    },
    defaultEnhancedFetch(url: string, options: Record<string, unknown>) {
      fetchCalls.push([url, options]);
      return { ok: true };
    },
    DomMorphTarget: StarterDomMorphTarget,
    installKovoLoader(options: unknown) {
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
      // The starter client template imports its bootstrap surface from the public
      // `@kovojs/runtime/client` facade and the deferred-stream applier from the
      // public `@kovojs/runtime/generated` subpath (post facade-shrink). Both map
      // to the single white-box runtime shim above.
      if (specifier === '@kovojs/runtime/client' || specifier === '@kovojs/runtime/generated') {
        return runtime;
      }
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

export async function starterClientTemplateBehaviorFact(
  source: string,
): Promise<StarterClientTemplateBehaviorFact> {
  // SPEC.md §5.2: app-authored starter code stays TSX/JS source; this fixture
  // executes the template and exposes public loader/deferred behavior facts.
  const fixture = await executeStarterClientTemplate(source);
  const loaderOptions = fixture.loaderInstalls[0] as StarterClientLoaderOptions | undefined;
  const enhancedMutations = loaderOptions?.enhancedMutations;
  const mutationRoot = enhancedMutations?.root;
  const fragmentTarget = mutationRoot?.findFragmentTarget('cart-badge') ?? null;
  const beforeReplace = fragmentTarget?.readHtml() ?? null;
  fragmentTarget?.replaceWithHtml('<cart-badge>1</cart-badge>');
  const afterReplace = fragmentTarget?.readHtml() ?? null;
  mutationRoot?.findFragmentTarget('cart-list')?.appendHtml('<li>p1</li>');

  const fetchResult = enhancedMutations?.fetch?.('/_m/cart/add', {
    body: 'productId=p1',
    headers: { Accept: 'text/vnd.kovo.fragment+html' },
    keepalive: true,
    method: 'POST',
  });
  const [fetchUrl, fetchOptions = {}] = fixture.fetchCalls[0] ?? [];
  const deferredResult = (
    fixture.exports.applyKovoDeferredStreamResponse as
      | ((body: string, options: Record<string, unknown>) => { applied?: unknown })
      | undefined
  )?.('<kovo-fragment></kovo-fragment>', {
    boundary: 'starter-boundary',
    morph: 'structural',
  });
  const deferredApplication = fixture.deferredApplications[0] as
    | StarterDeferredApplication
    | undefined;

  return {
    appendedHtml: fixture.appendCalls,
    deferredApplication: {
      body: deferredApplication?.body,
      boundary: deferredApplication?.boundary,
      morph: deferredApplication?.morph,
      queryPlansMatch: deferredApplication?.queryPlans === enhancedMutations?.queryPlans,
      rootMatches: deferredApplication?.root === mutationRoot,
      storeMatches: deferredApplication?.store === fixture.queryStore,
    },
    deferredApplied: deferredResult?.applied,
    fetchCall: {
      body: fetchOptions.body,
      headers: { ...(fetchOptions.headers as Record<string, unknown> | undefined) },
      keepalive: fetchOptions.keepalive,
      method: fetchOptions.method,
      url: fetchUrl,
    },
    fetchOk: fetchResult?.ok,
    fragmentHtml: {
      afterReplace,
      beforeReplace,
    },
    loader: {
      enhancedMutationStoreMatches: enhancedMutations?.store === fixture.queryStore,
      hasEnhancedFetch: typeof enhancedMutations?.fetch === 'function',
      hasImportModule: typeof loaderOptions?.importModule === 'function',
      queryPlansType: typeof enhancedMutations?.queryPlans,
      queryStoreMatches: loaderOptions?.queryStore === fixture.queryStore,
      rootMatches: loaderOptions?.root === fixture.documentRoot,
    },
    loaderInstallCount: fixture.loaderInstalls.length,
  };
}
