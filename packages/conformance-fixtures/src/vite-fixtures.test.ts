import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  viteGeneratedHandlerMiddlewareFact,
  viteHandlerTransformFact,
  vitePluginMiddlewareFact,
  viteProductionEmitContractFact,
  viteRedGreenBuildFixtureFact,
  viteTransformElementFact,
} from './vite-fixtures.ts';

import type { VitePluginLike } from './vite-fixtures.ts';

describe('vite-fixtures', () => {
  it('projects Vite transform and generated handler middleware behavior into facts', () => {
    const plugin: VitePluginLike = {
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/c/__v/1234abcd/card.client.js?cache=1') {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/javascript');
            response.end('export const Card$click = (event, ctx) => ctx.params.id;');
            return;
          }
          next();
        });
      },
      name: 'kovo',
      transform() {
        return {
          code: `export function renderSource() { return '<button on:click="/c/__v/1234abcd/card.client.js#Card$click" data-p-id="{product.id}">Add</button>'; }`,
          map: null,
        };
      },
    };

    const middlewareFact = vitePluginMiddlewareFact(plugin, { root: '/repo' });
    expect(middlewareFact.pluginName).toBe('kovo');

    expect(
      viteTransformElementFact(plugin, {
        id: '/repo/card.tsx',
        selector: { tag: 'button' },
        source: '<button>Add</button>',
      }),
    ).toMatchObject({
      elements: [{ attrs: { 'data-p-id': '{product.id}' }, tag: 'button' }],
      mapIsNull: true,
    });

    const handlerFact = viteHandlerTransformFact(plugin, {
      id: '/repo/card.tsx',
      selector: { tag: 'button' },
      source: '<button>Add</button>',
    });
    expect(handlerFact.handlerSummary).toEqual({
      handlerName: 'Card$click',
      modulePath: '/c/card.client.js',
      versionShape: 'lower-hex-8',
    });

    expect(
      viteGeneratedHandlerMiddlewareFact({
        executeClientModule(source) {
          expect(source).toContain('Card$click');
          return {
            Card$click: (_event: unknown, ctx: { params: { id: string } }) => ctx.params.id,
          };
        },
        handlerReference: handlerFact.handlerReference,
        invocation: { ctx: { params: { id: 'p1' } }, event: 'click' },
        middleware: middlewareFact.middleware,
        runtime: {},
      }),
    ).toMatchObject({
      contentType: 'text/javascript',
      handlerName: 'Card$click',
      invocationResult: 'p1',
      nextCallsAfterHit: 0,
      nextCallsAfterStale: 1,
      statusCode: 200,
    });
  });

  it('runs a red/green Vite build fixture and returns structured build facts', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'kovo-vite-fixture-bin-'));
    const vpExecutable = join(binDir, 'vp.mjs');
    await writeFile(
      vpExecutable,
      [
        '#!/usr/bin/env node',
        "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
        "const source = await readFile('routes/card.tsx', 'utf8');",
        "if (source.includes('RED')) {",
        "  console.error('Kovo Vite transform failed with 1 error diagnostic.');",
        '  process.exit(1);',
        '}',
        "await mkdir('dist/assets', { recursive: true });",
        "await writeFile('dist/index.html', '<main>green</main>');",
        '',
      ].join('\n'),
      'utf8',
    );
    await chmod(vpExecutable, 0o755);

    await expect(
      viteRedGreenBuildFixtureFact({
        coreAlias: '/repo/dist/core/src/index.mjs',
        entrypoint: "import './routes/card';",
        fileName: 'routes/card.tsx',
        greenSource: 'GREEN',
        projectRoot: '/repo',
        redSource: 'RED',
        vitePluginImportUrl: pathToFileURL('/repo/dist/compiler/src/index.mjs').href,
        vpExecutable,
      }),
    ).resolves.toEqual({
      greenDistEntries: ['assets', 'index.html'],
      redOutput: expect.stringContaining('Kovo Vite transform failed'),
    });
  });

  it('projects the production emit contract and generated handler middleware into one fact', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'kovo-prod-emit-fixture-bin-'));
    const prodEmitExecutable = join(binDir, 'prod-emit.mjs');
    await writeFile(
      prodEmitExecutable,
      ['#!/usr/bin/env node', "console.log('prod-emit-check/v1');", "console.log('OK');", ''].join(
        '\n',
      ),
      'utf8',
    );
    await chmod(prodEmitExecutable, 0o755);

    const plugin: VitePluginLike = {
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/c/__v/1234abcd/routes/products/product-card.client.js?cache=1') {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/javascript');
            response.end(
              'export const ProductCard$button_click = (event, ctx) => addToCart(ctx.params.id);',
            );
            return;
          }
          next();
        });
      },
      name: 'kovo',
      transform() {
        return {
          code: `export function renderSource() { return '<button on:click="/c/__v/1234abcd/routes/products/product-card.client.js#ProductCard$button_click" data-p-id="{product.id}">Add</button>'; }`,
          map: null,
        };
      },
    };

    await expect(
      viteProductionEmitContractFact({
        createPlugin: () => plugin,
        executeClientModule() {
          return {
            ProductCard$button_click: (_event: unknown, ctx: { params: { id: string } }) =>
              `added:${ctx.params.id}`,
          };
        },
        prodEmit: { args: [], command: prodEmitExecutable },
        projectRoot: binDir,
        runtime: {},
      }),
    ).resolves.toEqual({
      handlerSummary: {
        handlerName: 'ProductCard$button_click',
        modulePath: '/c/routes/products/product-card.client.js',
        versionShape: 'lower-hex-8',
      },
      mapIsNull: true,
      middleware: {
        cartEvents: [],
        contentType: 'text/javascript',
        invocationResult: 'added:p1',
        nextCallsAfterHit: 0,
        nextCallsAfterStale: 1,
        statusCode: 200,
      },
      pluginName: 'kovo',
      prodEmit: {
        stderr: '',
        stdoutLines: ['prod-emit-check/v1', 'OK'],
      },
      renderedButtonAttrs: {
        'data-p-id': '{product.id}',
        'on:click':
          '/c/__v/1234abcd/routes/products/product-card.client.js#ProductCard$button_click',
      },
    });
  });
});
