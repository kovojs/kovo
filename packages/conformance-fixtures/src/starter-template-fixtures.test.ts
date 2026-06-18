import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  executeStarterClientTemplate,
  loadStarterTemplateFacts,
  runPnpmFilterTaskCommand,
  runStarterTemplateEmitGraph,
  runStarterTemplateGraphAssertions,
  runStarterTemplateViteTaskCommand,
  starterClientTemplateBehaviorFact,
  starterTemplateAcceptanceFact,
  starterTemplateDevDependencyCoverage,
  starterTemplateFacts,
} from './starter-template-fixtures.ts';

describe('@kovojs/test starter template fixtures', () => {
  it('collects package, task, CI, CSS, graph, and HTML facts through reusable seams', async () => {
    const templateSources = {
      appSource: 'export const app = true;',
      ciWorkflowSource: [
        'name: CI',
        'jobs:',
        '  check:',
        '    steps:',
        '      - run: vp install',
        '      - run: vp run kovo-check',
      ].join('\n'),
      clientSource: 'export const client = true;',
      graphSource: '{"queries":[{"query":"cart","domains":["cart"]}]}',
      indexHtmlSource:
        '<html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>',
      packageJsonSource: JSON.stringify({
        dependencies: { '@kovojs/core': 'workspace:*' },
        devDependencies: { typescript: '^5.9.0', vite: '^7.0.0' },
        scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
      }),
      stylesSource: ':root { color-scheme: light; }\n',
      viteConfigSource: [
        "import { defineConfig } from 'vite-plus';",
        'export default defineConfig({',
        '  run: {',
        '    tasks: {',
        "      'kovo-check': {",
        "        command: 'node scripts/emit-graph.mjs && kovo check graph.json',",
        "        input: [{ pattern: 'src/**/*', base: 'workspace' }],",
        "        output: ['graph.json'],",
        '      },',
        '    },',
        '  },',
        '});',
      ].join('\n'),
    };
    const facts = await starterTemplateFacts(templateSources);

    expect(facts).toMatchObject({
      appSource: 'export const app = true;',
      ciRunCommands: ['vp install', 'vp run kovo-check'],
      clientSource: 'export const client = true;',
      cssLayers: [],
      graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
      indexHtml: {
        htmlAttrs: { lang: 'en' },
        linkAttrs: [{ href: '/src/styles.css', rel: 'stylesheet' }],
        metaAttrs: [{ charset: 'UTF-8' }],
        scriptAttrs: [],
        tags: ['html', 'head', 'meta', 'link', 'body'],
      },
      package: {
        dependencies: ['@kovojs/core'],
        devDependencies: ['typescript', 'vite'],
        scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
      },
      viteTasks: {
        'kovo-check': {
          command: 'node scripts/emit-graph.mjs && kovo check graph.json',
          input: [{ base: 'workspace', pattern: 'src/**/*' }],
          output: ['graph.json'],
        },
      },
    });
    expect(
      starterTemplateDevDependencyCoverage(facts.package, ['vite', 'typescript', 'vitest']),
    ).toEqual({
      expected: ['vite', 'typescript', 'vitest'],
      missing: ['vitest'],
      present: ['vite', 'typescript'],
    });
  });

  it('loads starter template files before deriving reusable facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-starter-template-facts-'));

    try {
      await mkdir(join(root, '.github/workflows'), { recursive: true });
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, '.github/workflows/ci.yml'),
        'jobs:\n  check:\n    steps:\n      - run: vp run kovo-check\n',
      );
      await writeFile(join(root, 'graph.json'), '{"pages":[{"route":"/"}]}');
      await writeFile(
        join(root, 'index.html'),
        '<html><body><script type="module"></script></body></html>',
      );
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          dependencies: { '@kovojs/core': 'workspace:*' },
          devDependencies: { kovo: 'workspace:*', vite: '^7.0.0' },
          scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
        }),
      );
      await writeFile(join(root, 'src/app.tsx'), 'export const app = "loaded";');
      await writeFile(join(root, 'src/client.ts'), 'export const client = "loaded";');
      await writeFile(join(root, 'src/styles.css'), ':root { color-scheme: light; }\n');
      await writeFile(
        join(root, 'vite.config.ts'),
        [
          "import { defineConfig } from 'vite-plus';",
          'export default defineConfig({ run: { tasks: {} } });',
        ].join('\n'),
      );

      await expect(
        loadStarterTemplateFacts({ projectRoot: root, templateRoot: root }),
      ).resolves.toMatchObject({
        appSource: 'export const app = "loaded";',
        ciRunCommands: ['vp run kovo-check'],
        clientSource: 'export const client = "loaded";',
        cssLayers: [],
        graph: { pages: [{ route: '/' }] },
        indexHtml: { scriptAttrs: [{ type: 'module' }] },
        package: {
          dependencies: ['@kovojs/core'],
          devDependencies: ['kovo', 'vite'],
          scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
        },
        viteTasks: {},
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('executes the starter browser client template and records loader behavior', async () => {
    const fixture = await executeStarterClientTemplate(`
import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/runtime/client';

const store = createQueryStore();
const queryPlans = {};
const root = {
  findFragmentTarget(target) {
    const element = document.getElementById(target) ?? document.querySelector('[kovo-fragment-target="' + CSS.escape(target) + '"]');
    return element ? {
      appendHtml(html) { element.insertAdjacentHTML('beforeend', html); },
      readHtml() { return element.innerHTML; },
      replaceWithHtml(html) { element.innerHTML = html; },
    } : null;
  },
  querySelectorAll(selector) {
    return document.querySelectorAll(selector);
  },
};

installKovoLoader({
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans,
    root,
    store,
  },
});

export function applyKovoDeferredStreamResponse(body) {
  return applyDeferredStreamResponseToRuntime({ body, root, store });
}
`);

    expect(fixture.loaderInstalls).toHaveLength(1);
    const loaderOptions = fixture.loaderInstalls[0] as {
      enhancedMutations: {
        fetch(url: string, options: Record<string, unknown>): { ok: boolean };
        root: {
          findFragmentTarget(target: string): {
            appendHtml(html: string): void;
            readHtml(): string;
            replaceWithHtml(html: string): void;
          } | null;
        };
      };
      queryStore: unknown;
      root: unknown;
    };
    expect(loaderOptions.root).toBe(fixture.documentRoot);
    expect(loaderOptions.queryStore).toBe(fixture.queryStore);
    const target = loaderOptions.enhancedMutations.root.findFragmentTarget('cart-badge');
    expect(target?.readHtml()).toBe('<cart-badge>0</cart-badge>');
    target?.replaceWithHtml('<cart-badge>1</cart-badge>');
    expect(target?.readHtml()).toBe('<cart-badge>1</cart-badge>');
    loaderOptions.enhancedMutations.root.findFragmentTarget('cart-list')?.appendHtml('<li>p1</li>');
    expect(fixture.appendCalls).toEqual([['beforeend', '<li>p1</li>']]);
    expect(loaderOptions.enhancedMutations.fetch('/_m/cart/add', { method: 'POST' })).toEqual({
      ok: true,
    });
    expect(fixture.fetchCalls).toEqual([['/_m/cart/add', { method: 'POST' }]]);
    expect(
      (fixture.exports.applyKovoDeferredStreamResponse as (body: string) => unknown)(
        '<kovo-fragment></kovo-fragment>',
      ),
    ).toEqual({ applied: true });
    expect(fixture.deferredApplications).toMatchObject([
      { body: '<kovo-fragment></kovo-fragment>', root: loaderOptions.enhancedMutations.root },
    ]);
  });

  it('projects starter browser client behavior into kovo-check facts', async () => {
    await expect(
      starterClientTemplateBehaviorFact(`
import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/runtime/client';

const store = createQueryStore();
const queryPlans = {};
const root = {
  findFragmentTarget(target) {
    const element = document.getElementById(target) ?? document.querySelector('[kovo-fragment-target="' + CSS.escape(target) + '"]');
    return element ? {
      appendHtml(html) { element.insertAdjacentHTML('beforeend', html); },
      readHtml() { return element.innerHTML; },
      replaceWithHtml(html) { element.innerHTML = html; },
    } : null;
  },
  querySelectorAll(selector) {
    return document.querySelectorAll(selector);
  },
};

installKovoLoader({
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans,
    root,
    store,
  },
  importModule: (path) => import(path),
});

export function applyKovoDeferredStreamResponse(body, options = {}) {
  return applyDeferredStreamResponseToRuntime({ body, root, store, queryPlans, ...options });
}
`),
    ).resolves.toEqual({
      appendedHtml: [['beforeend', '<li>p1</li>']],
      deferredApplication: {
        body: '<kovo-fragment></kovo-fragment>',
        boundary: 'starter-boundary',
        morph: 'structural',
        queryPlansMatch: true,
        rootMatches: true,
        storeMatches: true,
      },
      deferredApplied: true,
      fetchCall: {
        body: 'productId=p1',
        headers: { Accept: 'text/vnd.kovo.fragment+html' },
        keepalive: true,
        method: 'POST',
        url: '/_m/cart/add',
      },
      fetchOk: true,
      fragmentHtml: {
        afterReplace: '<cart-badge>1</cart-badge>',
        beforeReplace: '<cart-badge>0</cart-badge>',
      },
      loader: {
        enhancedMutationStoreMatches: true,
        hasEnhancedFetch: true,
        hasImportModule: true,
        queryPlansType: 'object',
        queryStoreMatches: true,
        rootMatches: true,
      },
      loaderInstallCount: 1,
    });
  });

  it('runs starter template graph tasks in a copied fixture with compiler and kovo shims', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-starter-fixture-'));
    const templateRoot = join(root, 'template');
    const compilerRoot = join(root, 'compiler');
    const graph = { mutations: [{ key: 'cart/add' }], queries: [{ query: 'cart' }] };

    try {
      await mkdir(join(templateRoot, 'scripts'), { recursive: true });
      await mkdir(compilerRoot, { recursive: true });
      await writeFile(
        join(compilerRoot, 'index.mjs'),
        `export const graphFixture = ${JSON.stringify(graph)};\n`,
        'utf8',
      );
      await writeFile(
        join(templateRoot, 'scripts/emit-graph.mjs'),
        [
          "import { writeFileSync } from 'node:fs';",
          "import { graphFixture } from '@kovojs/compiler';",
          "writeFileSync('graph.json', JSON.stringify(graphFixture));",
          "process.stdout.write('emit-graph/v1\\nOK\\n');",
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(templateRoot, 'scripts/graph-assertions.mjs'),
        [
          "import { execFileSync } from 'node:child_process';",
          "const output = execFileSync('kovo', ['explain', 'query', 'cart', 'graph.json'], { encoding: 'utf8' });",
          "if (output !== 'kovo-explain/v1\\nQUERY cart\\n') throw new Error(output);",
          "process.stdout.write('graph-assertions/v1\\nOK\\n');",
        ].join('\n'),
        'utf8',
      );

      const paths = {
        compilerModuleUrl: pathToFileURL(join(compilerRoot, 'index.mjs')).href,
        projectRoot: root,
        templateRoot,
      };
      const kovoOutputs = [
        { args: ['check', 'graph.json'], output: 'kovo-check/v1\nOK\n' },
        {
          args: ['explain', 'query', 'cart', 'graph.json'],
          output: 'kovo-explain/v1\nQUERY cart\n',
        },
      ];

      await expect(runStarterTemplateEmitGraph(paths)).resolves.toEqual({
        graph,
        output: 'emit-graph/v1\nOK\n',
      });
      await expect(
        runStarterTemplateViteTaskCommand(
          'node scripts/emit-graph.mjs && kovo check graph.json',
          paths,
          kovoOutputs,
        ),
      ).resolves.toEqual({
        graph,
        output: 'emit-graph/v1\nOK\nkovo-check/v1\nOK\n',
      });
      await expect(runStarterTemplateGraphAssertions(paths, kovoOutputs)).resolves.toBe(
        'graph-assertions/v1\nOK\n',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('projects starter acceptance through one package-owned fixture seam', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-starter-acceptance-'));
    const templateRoot = join(root, 'template');
    const compilerRoot = join(root, 'compiler');
    const graph = {
      components: [{ name: 'CartBadge' }],
      mutations: [{ key: 'cart/add' }],
      optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'await-fragment' }],
      pages: [{ route: '/cart' }],
      queries: [{ domains: ['cart'], query: 'cart' }],
      touchGraph: {
        'cart.addItem': {
          touches: [{ domain: 'cart', keys: null, site: 'src/cart.ts:12', via: 'cart_items' }],
        },
      },
    };
    const appSource = 'export const App = component({ render: () => <main /> });';
    const clientSource = `
import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/runtime/client';

const store = createQueryStore();
const queryPlans = {};
const root = {
  findFragmentTarget(target) {
    const element = document.getElementById(target) ?? document.querySelector('[kovo-fragment-target="' + CSS.escape(target) + '"]');
    return element ? {
      appendHtml(html) { element.insertAdjacentHTML('beforeend', html); },
      readHtml() { return element.innerHTML; },
      replaceWithHtml(html) { element.innerHTML = html; },
    } : null;
  },
  querySelectorAll(selector) {
    return document.querySelectorAll(selector);
  },
};

installKovoLoader({
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans,
    root,
    store,
  },
  importModule: (path) => import(path),
});

export function applyKovoDeferredStreamResponse(body, options = {}) {
  return applyDeferredStreamResponseToRuntime({ body, root, store, queryPlans, ...options });
}
`;

    try {
      await mkdir(join(templateRoot, '.github/workflows'), { recursive: true });
      await mkdir(join(templateRoot, 'scripts'), { recursive: true });
      await mkdir(join(templateRoot, 'src'), { recursive: true });
      await mkdir(compilerRoot, { recursive: true });
      await writeFile(
        join(compilerRoot, 'index.mjs'),
        `export const graphFixture = ${JSON.stringify(graph)};\n`,
        'utf8',
      );
      await writeFile(
        join(templateRoot, '.github/workflows/ci.yml'),
        [
          'jobs:',
          '  check:',
          '    steps:',
          '      - run: vp install',
          '      - run: vp run kovo-check',
          '      - run: vp run graph-assertions',
        ].join('\n'),
      );
      await writeFile(
        join(templateRoot, 'package.json'),
        JSON.stringify({
          dependencies: { '@kovojs/core': 'workspace:*', '@kovojs/runtime': 'workspace:*' },
          devDependencies: { '@kovojs/compiler': 'workspace:*', kovo: 'workspace:*' },
          scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
        }),
      );
      await writeFile(
        join(templateRoot, 'vite.config.ts'),
        [
          "import { defineConfig } from 'vite-plus';",
          'export default defineConfig({',
          '  run: { tasks: {',
          "    'kovo-check': { command: 'node scripts/emit-graph.mjs && kovo check graph.json', input: [{ pattern: 'src/**/*', base: 'workspace' }], output: ['graph.json'] },",
          "    'graph-assertions': { command: 'node scripts/emit-graph.mjs && node scripts/graph-assertions.mjs', input: [{ pattern: 'graph.json', base: 'workspace' }] },",
          '  } },',
          '});',
        ].join('\n'),
      );
      await writeFile(
        join(templateRoot, 'scripts/emit-graph.mjs'),
        [
          "import { writeFileSync } from 'node:fs';",
          "import { graphFixture } from '@kovojs/compiler';",
          "writeFileSync('graph.json', JSON.stringify(graphFixture));",
          "process.stdout.write('emit-graph/v1\\nOK\\n');",
        ].join('\n'),
      );
      await writeFile(
        join(templateRoot, 'scripts/graph-assertions.mjs'),
        [
          "import { execFileSync } from 'node:child_process';",
          "execFileSync('kovo', ['explain', 'query', 'cart', 'graph.json']);",
          "process.stdout.write('graph-assertions/v1\\nOK\\n');",
        ].join('\n'),
      );
      await writeFile(join(templateRoot, 'graph.json'), JSON.stringify(graph));
      await writeFile(
        join(templateRoot, 'index.html'),
        '<html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>',
      );
      await writeFile(join(templateRoot, 'src/app.tsx'), appSource);
      await writeFile(join(templateRoot, 'src/client.ts'), clientSource);
      await writeFile(join(templateRoot, 'src/styles.css'), ':root { color-scheme: light; }\n');

      const compiled = { files: ['compiled'] };
      const kovoOutputs = [
        { args: ['check', 'graph.json'], output: 'kovo-check/v1\nOK\n' },
        {
          args: ['explain', 'query', 'cart', 'graph.json'],
          output:
            'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
        },
      ];

      await expect(
        starterTemplateAcceptanceFact({
          assertFixpoint(result) {
            expect(result).toBe(compiled);
          },
          assertRenderEquivalence(result) {
            expect(result).toBe(compiled);
          },
          compileComponentModule(options) {
            expect(options).toEqual({ fileName: 'src/app.tsx', source: appSource });
            return compiled;
          },
          compilerModuleUrl: pathToFileURL(join(compilerRoot, 'index.mjs')).href,
          expectedDevDependencies: ['@kovojs/compiler', 'kovo'],
          kovoCheck(candidateGraph) {
            expect(candidateGraph).toEqual(graph);
            return { exitCode: 0, output: 'kovo-check/v1\nOK\n' };
          },
          kovoExplain(_candidateGraph, options) {
            if (options.kind === 'mutation') {
              return {
                exitCode: 0,
                output:
                  'kovo-explain/v1\nMUTATION cart/add\nguards: authed\nsession: starterSession\ninput-fields: productId\nwrites: cart\ninvalidates: cart\nmanual-invalidates: -\nupdates: cart->component:CartBadge\nOPTIMISTIC cart await-fragment\nOPTIMISTIC-SUMMARY total=1 derived=0 hand-written=0 await-fragment=1 UNHANDLED=0 PUNTED=0\n',
              };
            }
            if (options.kind === 'page') {
              return {
                exitCode: 0,
                output:
                  'kovo-explain/v1\nPAGE /cart\nprefetch: false\nmeta: title=Cart description=- image=-\ni18n: -\nmodulepreloads: -\nstylesheets: /src/styles.css\nqueries: cart\nview-transitions: -\n',
              };
            }
            return {
              exitCode: 0,
              output:
                'kovo-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge\ninvalidated-by: cart/add\ndomain-writes: cart.addItem\n',
            };
          },
          kovoOutputs,
          projectRoot: root,
          templateRoot,
        }),
      ).resolves.toMatchObject({
        appCompile: { fixpointAsserted: true, renderEquivalenceAsserted: true },
        browserClient: {
          deferredApplied: true,
          loader: { hasEnhancedFetch: true, hasImportModule: true },
        },
        ciRunCommands: ['vp install', 'vp run kovo-check', 'vp run graph-assertions'],
        devDependencyCoverage: {
          expected: ['@kovojs/compiler', 'kovo'],
          missing: [],
          present: ['@kovojs/compiler', 'kovo'],
        },
        emittedGraph: { graph, output: 'emit-graph/v1\nOK\n' },
        graph: {
          components: ['CartBadge'],
          mutations: graph.mutations,
          touchGraphSites: { 'cart.addItem': graph.touchGraph['cart.addItem'].touches },
        },
        graphAssertionsOutput: 'graph-assertions/v1\nOK\n',
        graphCheck: { exitCode: 0, issueCount: 0, status: 'ok', version: 'kovo-check/v1' },
        package: {
          dependencies: ['@kovojs/core', '@kovojs/runtime'],
          scripts: { emitGraph: 'node scripts/emit-graph.mjs' },
        },
        taskOutputs: [
          { graph, output: 'emit-graph/v1\nOK\nkovo-check/v1\nOK\n' },
          { graph, output: 'emit-graph/v1\nOK\ngraph-assertions/v1\nOK\n' },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('runs pnpm-filter conformance task commands and rejects missing packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-conformance-fixture-'));
    const packages = [
      {
        manifest: {
          name: '@kovojs/conformance-auth-spike',
          scripts: { test: 'vitest --run src/index.test.ts' },
        },
      },
      {
        manifest: {
          name: '@kovojs/conformance-drizzle-pin',
          scripts: { test: 'vitest --run src/index.test.ts' },
        },
      },
    ];

    try {
      await expect(
        runPnpmFilterTaskCommand(
          [
            'pnpm --filter @kovojs/conformance-auth-spike test',
            'pnpm --filter @kovojs/conformance-drizzle-pin test',
          ].join(' && '),
          packages,
          { cwd: root },
        ),
      ).resolves.toEqual({
        observed: [
          { packageName: '@kovojs/conformance-auth-spike', script: 'test' },
          { packageName: '@kovojs/conformance-drizzle-pin', script: 'test' },
        ],
        output:
          'pnpm-filter-test @kovojs/conformance-auth-spike\npnpm-filter-test @kovojs/conformance-drizzle-pin\n',
      });
      await expect(
        runPnpmFilterTaskCommand('pnpm --filter @kovojs/conformance-auth-spike test', packages, {
          cwd: root,
        }),
      ).rejects.toThrow('conformance task executes every discovered conformance package test');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
