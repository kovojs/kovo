import { describe, expect, it } from 'vitest';

import {
  executeStarterClientTemplate,
  starterTemplateFacts,
} from '@jiso/test/starter-template-fixtures';

describe('@jiso/test starter template fixtures', () => {
  it('collects package, task, CI, CSS, graph, and HTML facts through reusable seams', async () => {
    await expect(
      starterTemplateFacts({
        ciWorkflowSource: [
          'name: CI',
          'jobs:',
          '  check:',
          '    steps:',
          '      - run: vp install',
          '      - run: vp run fw-check',
        ].join('\n'),
        graphSource: '{"queries":[{"query":"cart","domains":["cart"]}]}',
        indexHtmlSource:
          '<html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>',
        packageJsonSource: JSON.stringify({
          dependencies: { '@jiso/core': 'workspace:*' },
          devDependencies: { vite: '^7.0.0' },
          scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
        }),
        stylesSource: '@import "tailwindcss";\n@source "../index.html";\n',
        viteConfigSource: [
          "import { defineConfig } from 'vite-plus';",
          'export default defineConfig({',
          '  run: {',
          '    tasks: {',
          "      'fw-check': {",
          "        command: 'node scripts/emit-graph.mjs && fw check graph.json',",
          "        input: [{ pattern: 'src/**/*', base: 'workspace' }],",
          "        output: ['graph.json'],",
          '      },',
          '    },',
          '  },',
          '});',
        ].join('\n'),
      }),
    ).resolves.toMatchObject({
      ciRunCommands: ['vp install', 'vp run fw-check'],
      cssDirectives: ['"../index.html"'],
      graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
      indexHtml: {
        htmlAttrs: { lang: 'en' },
        linkAttrs: [{ href: '/src/styles.css', rel: 'stylesheet' }],
        metaAttrs: [{ charset: 'UTF-8' }],
        scriptAttrs: [],
        tags: ['html', 'head', 'meta', 'link', 'body'],
      },
      package: {
        dependencies: ['@jiso/core'],
        devDependencies: ['vite'],
        scripts: { 'emit-graph': 'node scripts/emit-graph.mjs' },
      },
      viteTasks: {
        'fw-check': {
          command: 'node scripts/emit-graph.mjs && fw check graph.json',
          input: [{ base: 'workspace', pattern: 'src/**/*' }],
          output: ['graph.json'],
        },
      },
    });
  });

  it('executes the starter browser client template and records loader behavior', async () => {
    const fixture = await executeStarterClientTemplate(`
import { applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader } from '@jiso/runtime';

const store = createQueryStore();
const root = {
  findFragmentTarget(target) {
    const element = document.getElementById(target) ?? document.querySelector('[fw-fragment-target="' + CSS.escape(target) + '"]');
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

installJisoLoader({
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: (url, options) => fetch(url, options),
    queryPlans: {},
    root,
    store,
  },
});

export function applyJisoDeferredStreamResponse(body) {
  return applyDeferredStreamResponseToDom({ body, root, store });
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
      (fixture.exports.applyJisoDeferredStreamResponse as (body: string) => unknown)(
        '<fw-fragment></fw-fragment>',
      ),
    ).toEqual({ applied: true });
    expect(fixture.deferredApplications).toMatchObject([
      { body: '<fw-fragment></fw-fragment>', root: loaderOptions.enhancedMutations.root },
    ]);
  });
});
