import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  request as nodeHttpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect as netConnect } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as packageBuildApi from '@kovojs/server/build';
import { createApp } from './app.js';
import { computeRenderPlanFingerprint } from './client-modules.js';
import { renderedHtml } from './html.js';
import { route } from './route.js';
import { cloudflare, node, vercel } from './build.js';
import { stylesheet, type StylesheetAsset } from './hints.js';
import { writeKovoNeutralBuild } from './neutral-build.js';
import {
  nodeRequestToWebRequest as liveNodeRequestToWebRequest,
  writeWebResponseToNode as liveWriteWebResponseToNode,
} from './node.js';
import { query } from './query.js';
import { s } from './schema.js';
import { task } from './api/data.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const runtimeClientModuleFile = /^c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const testRenderPlanFingerprint = computeRenderPlanFingerprint({
  test: 'field:id',
});

interface NodeAdapterModule {
  nodeRequestToWebRequest(
    request: IncomingMessage,
    options?: { trustedProxy?: boolean },
    response?: ServerResponse,
  ): Request;
  writeWebResponseToNode(
    response: Response,
    nodeResponse: ServerResponse,
    method?: string,
  ): Promise<void>;
}

describe('server build-time deployment API', () => {
  it('exposes the build subpath without promoting it to the runtime root', () => {
    expect(packageBuildApi.cloudflare).toBe(cloudflare);
    expect(packageBuildApi.node).toBe(node);
    expect(packageBuildApi.vercel).toBe(vercel);
    expect(packageBuildApi).not.toHaveProperty('writeKovoNeutralBuild');
    expect(node()).toMatchObject({ name: 'node' });
    expect(node({ dockerfile: false })).toMatchObject({ name: 'node' });
    expect(vercel({ maxDuration: 10, regions: ['iad1'] })).toMatchObject({ name: 'vercel' });
    expect(cloudflare({ compatibilityDate: '2026-06-18', name: 'kovo-test' })).toMatchObject({
      name: 'cloudflare',
    });
    expect(node()).toMatchObject({
      capabilities: { jobRunner: { adapter: 'node-in-process', mode: 'serve-and-run' } },
      name: 'node',
    });
    expect(node({ jobRunner: false }).capabilities).toBeUndefined();
    expect(node({ jobRunner: false }).name).toBe('node');
    expect(
      node({
        retention: {
          hours: 24,
          immutableClientModules: 'retained',
          priorTokenQueryReads: 'retained',
        },
      }),
    ).toMatchObject({ name: 'node' });
  });

  it('writes a deterministic neutral build layout from app-shell build inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart { color: green; }');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const asset = true;');
      await writeFile(join(distDir, 'logo.svg'), '<svg viewBox="0 0 1 1"></svg>');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const outDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml(
                  '<main>Cart <img src="/logo.svg" alt=""> <button on:click="/c/__v/cart-v1/cart.client.js#Cart$click">Click</button></main>',
                );
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(
        readFile(join(outDir, 'client/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(readFile(join(outDir, 'client/assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart { color: green; }',
      );
      await expect(readFile(join(outDir, 'client/assets/cart.js'), 'utf8')).resolves.toBe(
        'export const asset = true;',
      );
      await expect(readFile(join(outDir, 'server/handler.mjs'), 'utf8')).resolves.toBe(
        'export default async function handler() { return new Response("ok"); }\n',
      );
      await expect(readFile(join(outDir, 'static/cart/index.html'), 'utf8')).resolves.toContain(
        '<img src="/logo.svg"',
      );
      await expect(
        readFile(join(outDir, 'static/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(readFile(join(outDir, 'static/logo.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );
      await expect(readFile(join(outDir, 'static/assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart { color: green; }',
      );
      await expect(readJson(join(outDir, 'manifest.json'))).resolves.toEqual({
        assets: [
          { file: 'assets/cart.css', href: '/assets/cart.css', path: '/assets/cart.css' },
          { file: 'assets/cart.js', href: '/assets/cart.js', path: '/assets/cart.js' },
        ],
        clientModules: [
          {
            file: 'c/__v/cart-v1/cart.client.js',
            href: '/c/__v/cart-v1/cart.client.js',
            path: '/c/__v/cart-v1/cart.client.js',
            version: 'cart-v1',
          },
          {
            file: expect.stringMatching(runtimeClientModuleFile),
            href: expect.stringMatching(runtimeClientModulePath),
            path: expect.stringMatching(runtimeClientModulePath),
            version: expect.stringMatching(/^[a-f0-9]+$/),
          },
        ],
        routeHints: [
          {
            hints: {
              modulepreloads: ['/assets/cart.js'],
              stylesheets: ['/assets/cart.css'],
            },
            routePath: '/cart',
          },
        ],
        tasks: [],
        version: 'kovo-neutral-build/v1',
      });
      await expect(readJson(join(outDir, 'routes.json'))).resolves.toEqual({
        routes: [
          {
            export: {
              paths: ['/cart'],
              policy: 'static',
            },
            path: '/cart',
          },
        ],
        version: 'kovo-neutral-build/v1',
      });
      await expect(readJson(join(outDir, 'meta.json'))).resolves.toEqual({
        hasServerHandler: true,
        staticOnly: true,
        tasks: [],
        version: 'kovo-neutral-build/v1',
      });
      expect(build).toMatchObject({
        clientModules: [
          { href: '/c/__v/cart-v1/cart.client.js' },
          {
            file: expect.stringMatching(runtimeClientModuleFile),
            href: expect.stringMatching(runtimeClientModulePath),
            path: expect.stringMatching(runtimeClientModulePath),
            version: expect.stringMatching(/^[a-f0-9]+$/),
          },
        ],
        outDir,
        routeHints: [{ routePath: '/cart' }],
        serverHandlerPath: join(outDir, 'server/handler.mjs'),
        staticOutput: {
          complete: true,
          dir: join(outDir, 'static'),
          manifestPath: join(outDir, 'static/kovo-static-manifest.json'),
          routeDocuments: [{ path: '/cart', routePath: '/cart' }],
        },
        staticOnly: true,
        tasks: [],
        version: 'kovo-neutral-build/v1',
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('materializes declared and build-owned CSS into neutral stylesheet assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-css-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/styles.css'), 'main { color: rebeccapurple; }\n');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/app.ts': {
            css: ['assets/styles.css'],
            file: 'assets/app.js',
          },
        }),
      );
      await writeFile(join(distDir, 'assets/app.js'), 'export const app = true;');

      const appStylesheet = stylesheet('./styles.css', {
        criticalCss: ':root{--brand:teal}',
      });
      const routeStylesheet = stylesheet('./route.css', {
        criticalCss: '.route-shell{display:grid}',
      });
      const outDir = join(root, 'dist', '.kovo');
      await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main class="route-shell">Home</main>');
              },
              stylesheets: [routeStylesheet],
            }),
          ],
          stylesheets: [appStylesheet],
        }),
        buildStylesheetCss: [
          { css: '.kovo-ui-button{display:inline-flex}', href: '/assets/styles.css' },
          { css: '.route-card{color:teal}', href: '/assets/routes/index.css' },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
      });

      const builtStyles = await readFile(join(outDir, 'client/assets/styles.css'), 'utf8');
      expect(builtStyles).toContain(':root{--brand:teal}');
      expect(builtStyles).toContain('.kovo-ui-button{display:inline-flex}');
      expect(builtStyles).toContain('main { color: rebeccapurple; }');
      await expect(readFile(join(outDir, 'client/assets/route.css'), 'utf8')).resolves.toBe(
        '.route-shell{display:grid}\n',
      );
      await expect(readFile(join(outDir, 'client/assets/routes/index.css'), 'utf8')).resolves.toBe(
        '.route-card{color:teal}\n',
      );

      await expect(readFile(join(outDir, 'static/assets/route.css'), 'utf8')).resolves.toBe(
        '.route-shell{display:grid}\n',
      );
      await expect(readFile(join(outDir, 'static/assets/routes/index.css'), 'utf8')).resolves.toBe(
        '.route-card{color:teal}\n',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('materializes local stylesheet source files declared by an app module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-local-css-'));

    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'local.css'), '.local-source { color: teal; }\n', 'utf8');
      const serverEntry = pathToFileURL(join(process.cwd(), 'packages/server/src/index.ts')).href;
      const appModule = join(srcDir, 'app.mjs');
      await writeFile(
        appModule,
        [
          `import { createApp, route, stylesheet, trustedHtml } from ${JSON.stringify(serverEntry)};`,
          'export const app = createApp({',
          '  routes: [',
          "    route('/', {",
          "      stylesheets: [stylesheet('./local.css')],",
          '      page: () => trustedHtml(\'<main class="local-source">Home</main>\'),',
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const { app } = (await import(`${pathToFileURL(appModule).href}?t=${Date.now()}`)) as {
        app: ReturnType<typeof createApp>;
      };
      const outDir = join(root, 'dist', '.kovo');

      await writeKovoNeutralBuild({ app, outDir });

      await expect(readFile(join(outDir, 'client/assets/local.css'), 'utf8')).resolves.toBe(
        '.local-source { color: teal; }\n',
      );
      await expect(readFile(join(outDir, 'static/assets/local.css'), 'utf8')).resolves.toBe(
        '.local-source { color: teal; }\n',
      );
      await expect(readFile(join(outDir, 'static/index.html'), 'utf8')).resolves.toContain(
        'href="/assets/local.css"',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not materialize local stylesheet sources from forged symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-forged-css-'));

    try {
      const srcDir = join(root, 'src');
      const outDir = join(root, 'dist', '.kovo');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'secret.css'), '.secret { color: red; }\n', 'utf8');
      const forgedStylesheet = {
        href: '/assets/forged.css',
        [Symbol.for('kovo.stylesheet.source')]: join(srcDir, 'secret.css'),
        [Symbol.for('kovo.stylesheet.sourcePath')]: './secret.css',
      } as StylesheetAsset;

      await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page: () => renderedHtml('<main>Home</main>'),
              stylesheets: [forgedStylesheet],
            }),
          ],
        }),
        outDir,
        stylesheetSourceRoot: srcDir,
      });

      await expect(readFile(join(outDir, 'client/assets/forged.css'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(outDir, 'static/assets/forged.css'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects stylesheetSourceRoot fallback paths outside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-css-root-'));

    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(root, 'outside.css'), '.outside { color: red; }\n', 'utf8');
      const escapedStylesheet = withNoStylesheetCallerFile(() => stylesheet('../outside.css'));

      await expect(
        writeKovoNeutralBuild({
          app: createApp({
            routes: [
              route('/', {
                page: () => renderedHtml('<main>Home</main>'),
                stylesheets: [escapedStylesheet],
              }),
            ],
          }),
          outDir: join(root, 'dist', '.kovo'),
          stylesheetSourceRoot: srcDir,
        }),
      ).rejects.toThrow('outside stylesheetSourceRoot');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails neutral builds before shipping missing local stylesheet links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-missing-css-'));

    try {
      const srcDir = join(root, 'src');
      await mkdir(srcDir, { recursive: true });
      const serverEntry = pathToFileURL(join(process.cwd(), 'packages/server/src/index.ts')).href;
      const appModule = join(srcDir, 'app.mjs');
      await writeFile(
        appModule,
        [
          `import { createApp, route, stylesheet, trustedHtml } from ${JSON.stringify(serverEntry)};`,
          'export const app = createApp({',
          '  routes: [',
          "    route('/', {",
          "      stylesheets: [stylesheet('./missing.css')],",
          "      page: () => trustedHtml('<main>Home</main>'),",
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      const { app } = (await import(`${pathToFileURL(appModule).href}?t=${Date.now()}`)) as {
        app: ReturnType<typeof createApp>;
      };

      await expect(
        writeKovoNeutralBuild({ app, outDir: join(root, 'dist', '.kovo') }),
      ).rejects.toThrow(
        "KV229 neutral build cannot materialize stylesheet '/assets/missing.css' from local source",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('overwrites stylesheet assets deterministically when rebuilding into a reused output dir', async () => {
    // M2 (bugs-part4 L12-1): the §14 retention design reuses the output dir, so a
    // 2nd+ build must recompute each stylesheet from current inputs. Previously
    // `materializeNeutralStylesheetAssets` folded the prior on-disk stylesheet back
    // in, so the second build retained stale rules and duplicated current ones.
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-rebuild-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/styles.css'), 'main{color:red}\n');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/app.ts': {
            css: ['assets/styles.css'],
            file: 'assets/app.js',
          },
        }),
      );
      await writeFile(join(distDir, 'assets/app.js'), 'export const app = true;');

      const outDir = join(distDir, '.kovo');
      const buildApp = (criticalCss: string) =>
        createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
          stylesheets: [stylesheet('./styles.css', { criticalCss })],
        });
      // A build-owned-only stylesheet with no Vite asset to copy: this is the path
      // where `copyNeutralStaticAssets` does not overwrite the output before
      // materialization, so a stale-disk-read would retain prior rules.
      const ownedHref = '/assets/routes/index.css';

      // First build emits a multi-line stylesheet ("A\nB"): two critical rules and a
      // two-rule build-owned chunk.
      await writeKovoNeutralBuild({
        app: buildApp(':root{--brand:teal}\n.legacy{color:gray}'),
        buildStylesheetCss: [
          { css: '.btn{display:flex}', href: '/assets/styles.css' },
          { css: '.card{color:teal}\n.stale-card{color:gray}', href: ownedHref },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
      });

      // Second build into the SAME output dir drops the legacy/stale rules ("A").
      await writeKovoNeutralBuild({
        app: buildApp(':root{--brand:teal}'),
        buildStylesheetCss: [
          { css: '.btn{display:flex}', href: '/assets/styles.css' },
          { css: '.card{color:teal}', href: ownedHref },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir,
      });

      const secondVite = await readFile(join(outDir, 'client/assets/styles.css'), 'utf8');
      const secondOwned = await readFile(join(outDir, 'client', ownedHref.slice(1)), 'utf8');
      // Recomputed purely from current inputs: stale rules gone, no duplication.
      expect(secondVite).toBe(':root{--brand:teal}\n.btn{display:flex}\nmain{color:red}\n');
      expect(secondVite).not.toContain('.legacy{color:gray}');
      expect(secondOwned).toBe('.card{color:teal}\n');
      expect(secondOwned).not.toContain('.stale-card{color:gray}');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('AUD-007: emits KV417 when presets cannot prove deploy-skew retention support', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-client-retention-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/app.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const app = true;',
            version: 'app-v1',
          },
        ],
        outDir: join(root, '.kovo'),
      });

      expect(node().inspect!(build, { declaredEnv: [] })).toEqual([
        clientModuleRetentionError('node'),
      ]);
      expect(vercel().inspect!(build, { declaredEnv: [] })).toEqual([
        clientModuleRetentionError('vercel'),
      ]);
      await expect(cloudflare().inspect!(build, { declaredEnv: [] })).resolves.toEqual([
        clientModuleRetentionError('cloudflare'),
      ]);

      // SPEC §14: the serving layer may configure a supported skew window upward, but not below the
      // 24-hour prior-version floor.
      const underFloorRetention = {
        hours: 23,
        immutableClientModules: 'retained' as const,
        priorTokenQueryReads: 'retained' as const,
      };
      expect(node({ retention: underFloorRetention }).inspect!(build, { declaredEnv: [] })).toEqual(
        [clientModuleRetentionError('node')],
      );
      expect(
        node({
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }).inspect!(build, { declaredEnv: [] }),
      ).toEqual([]);
      expect(
        vercel({
          retention: {
            hours: 48,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }).inspect!(build, { declaredEnv: [] }),
      ).toEqual([]);
      await expect(
        cloudflare({
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        }).inspect!(build, { declaredEnv: [] }),
      ).resolves.toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails closed when a task-using build targets a preset without a JobRunner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-task-preset-runner-'));
    const sendReceipt = task('receipt/send', {
      input: s.object({ orderId: s.string() }),
      async run() {},
    });

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
          tasks: [sendReceipt],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(readJson(join(root, '.kovo/manifest.json'))).resolves.toMatchObject({
        tasks: [{ key: 'receipt/send' }],
      });
      await expect(readJson(join(root, '.kovo/meta.json'))).resolves.toMatchObject({
        tasks: [{ key: 'receipt/send' }],
      });
      expect(build.tasks).toEqual([{ key: 'receipt/send' }]);
      expect(node().inspect!(build, { declaredEnv: [] })).toEqual([]);
      expect(
        node().inspect!(build, {
          declaredEnv: [],
          readServerHandlerSource() {
            return "import { sqliteTable } from 'drizzle-orm/sqlite-core';\n";
          },
        }),
      ).toEqual([]);
      expect(
        node().inspect!(build, {
          declaredEnv: [],
          readServerHandlerSource() {
            return "import Database from 'better-sqlite3';\n";
          },
        }),
      ).toEqual([sqliteDurableTaskStoreError('node', 'receipt/send')]);
      await expect(
        node().inspect!(build, {
          declaredEnv: [],
          async readServerHandlerSource() {
            return "import Database from 'better-sqlite3';\n";
          },
        }),
      ).resolves.toEqual([sqliteDurableTaskStoreError('node', 'receipt/send')]);
      expect(node({ jobRunner: false }).inspect!(build, { declaredEnv: [] })).toEqual([
        missingJobRunnerError('node', 'receipt/send'),
      ]);
      expect(vercel().inspect!(build, { declaredEnv: [] })).toEqual([
        missingJobRunnerError('vercel', 'receipt/send'),
      ]);
      await expect(cloudflare().inspect!(build, { declaredEnv: [] })).resolves.toEqual([
        missingJobRunnerError('cloudflare', 'receipt/send'),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails closed when node runner-only mode is selected before an emitted runner entrypoint exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-runner-only-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      expect(
        node({ jobRunner: { mode: 'runner-only' } }).inspect!(build, { declaredEnv: [] }),
      ).toEqual([
        {
          code: 'node-runner-only-unsupported',
          message:
            'The node preset runner-only JobRunner mode is not emitted yet because the neutral server bundle does not expose a standalone task-runner entrypoint. Use node() or node({ jobRunner: { mode: "serve-and-run" } }) for the in-process JobRunner, or deploy a supported external runner adapter when one is added.',
          severity: 'error',
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits app-registered client modules by default in neutral builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-default-modules-'));
    const app = createApp({
      routes: [
        route('/app', {
          page() {
            return renderedHtml('<main>App</main>');
          },
        }),
      ],
    });
    app.clientModules.put({
      path: '/c/app.client.js',
      source: 'export const appClient = true;',
      version: 'app-v1',
    });

    try {
      const outDir = join(root, '.kovo');
      const build = await writeKovoNeutralBuild({
        app,
        outDir,
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });

      await expect(
        readFile(join(outDir, 'client/c/__v/app-v1/app.client.js'), 'utf8'),
      ).resolves.toBe('export const appClient = true;');
      await expect(readJson(join(outDir, 'manifest.json'))).resolves.toMatchObject({
        clientModules: [
          {
            file: 'c/__v/app-v1/app.client.js',
            href: '/c/__v/app-v1/app.client.js',
            path: '/c/__v/app-v1/app.client.js',
            version: 'app-v1',
          },
          expect.objectContaining({
            file: expect.stringMatching(runtimeClientModuleFile),
            href: expect.stringMatching(runtimeClientModulePath),
            path: expect.stringMatching(runtimeClientModulePath),
          }),
        ],
      });
      expect(build.clientModules).toEqual([
        {
          file: 'c/__v/app-v1/app.client.js',
          href: '/c/__v/app-v1/app.client.js',
          path: '/c/__v/app-v1/app.client.js',
          source: 'export const appClient = true;',
          version: 'app-v1',
        },
        expect.objectContaining({
          file: expect.stringMatching(runtimeClientModuleFile),
          href: expect.stringMatching(runtimeClientModulePath),
          path: expect.stringMatching(runtimeClientModulePath),
          source: expect.stringContaining('installKovoDeferredRuntime'),
        }),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits a standalone node server that serves immutable client files before route fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), 'body { color: navy; }');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );
      await writeFile(join(distDir, 'assets/cart.js'), 'export const viteAsset = true;');

      const neutralDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/hello', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Hello</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir: neutralDir,
        routeEntryMap: {
          '/hello': 'src/cart.client.ts',
        },
        serverHandlerSource: `
export default async function handler(request) {
  globalThis.__kovoNodeRawTargetHandlerCalls =
    (globalThis.__kovoNodeRawTargetHandlerCalls ?? 0) + 1;
  const url = new URL(request.url);
  if (url.pathname === '/declared-oversized') {
    return new Response('Payload Too Large', { status: 413 });
  }
  if (url.pathname === '/chunked-oversized') {
    await request.body?.getReader().read();
    return new Response('Payload Too Large', { status: 413 });
  }
  if (url.pathname === '/cookies') {
    const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
    headers.append('set-cookie', 'session=s1; Path=/; HttpOnly');
    headers.append('set-cookie', 'csrf=c1; Path=/; SameSite=Strict');
    return new Response('cookies', { headers });
  }
  return new Response(
    'route:' + url.pathname + ':' + url.origin + ':' + request.headers.get('x-from-test'),
    {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    },
  );
}
`,
      });

      const logs: string[] = [];
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log(message) {
          logs.push(message);
        },
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      await expect(readFile(join(nodeOutDir, 'Dockerfile'))).rejects.toThrow();
      expect(logs).toEqual([`Emitted Kovo node preset output to ${nodeOutDir}`]);
      const nodeServer = await readFile(join(nodeOutDir, 'server.mjs'), 'utf8');
      expect(nodeServer).toContain('armIncompleteNodeRequestClose');
      expect(nodeServer).toContain("from './node-adapter.mjs';");
      const nodeAdapter = await readFile(join(nodeOutDir, 'node-adapter.mjs'), 'utf8');
      expect(nodeAdapter).toContain('export function nodeRequestToWebRequest');
      expect(nodeAdapter).toContain('export function rejectUnsafeNodeMutationTarget');
      expect(nodeAdapter).toContain('export async function writeWebResponseToNode');
      expect(nodeAdapter).toContain('const setCookies = apply(nativeHeadersGetSetCookie');
      expect(nodeAdapter).not.toContain('typeof headers.getSetCookie');
      expect(nodeAdapter).toContain("nodeHeaders['set-cookie'] = setCookies");
      expect(nodeAdapter).toContain(':authority');
      expect(nodeAdapter).toContain("name.startsWith(':')");
      expect(nodeAdapter).toContain('signal: controller.signal');
      expect(nodeAdapter).toContain('nodeRequest.socket?.remoteAddress?.trim()');
      expect(nodeAdapter).toContain("'__kovoPeerAddress'");
      expect(nodeServer).not.toContain('function nodeRequestToWebRequest');
      expect(nodeServer).not.toContain('function responseHeadersToNodeHeaders');
      expect(nodeServer).toContain('apply(nativeServerResponseDestroy, nodeResponse, [])');
      expect(nodeServer).toContain('const headersTimeoutMs = 10_000;');
      expect(nodeServer).toContain('const requestTimeoutMs = 30_000;');
      expect(nodeServer).toContain('server.headersTimeout = headersTimeoutMs;');
      expect(nodeServer).toContain('server.requestTimeout = requestTimeoutMs;');
      expect(nodeServer).toContain("'[kovo] unhandled node server error'");
      expect(nodeServer).toContain('const createNodeDiagnosticRecord = (');
      expect(nodeServer).toContain("await import('./server/handler.mjs')");
      expect(nodeServer).not.toContain('sanitizeDiagnosticUrl.toString');

      const serverModule = (await import(pathToFileURL(join(nodeOutDir, 'server.mjs')).href)) as {
        createKovoNodeServer(): Server;
      };
      const emittedNodeAdapter = (await import(
        `${pathToFileURL(join(nodeOutDir, 'node-adapter.mjs')).href}?t=${Date.now()}`
      )) as NodeAdapterModule;
      await expectEmittedAdapterParity(emittedNodeAdapter);

      const server = serverModule.createKovoNodeServer();
      expect(server.headersTimeout).toBe(10_000);
      expect(server.requestTimeout).toBe(30_000);
      const baseUrl = await listen(server);
      const rawTargetCounter = globalThis as typeof globalThis & {
        __kovoNodeRawTargetHandlerCalls?: number;
      };
      rawTargetCounter.__kovoNodeRawTargetHandlerCalls = 0;

      try {
        for (const target of [
          '/_m/a/%2e/b',
          '/_m/a/%2E/b',
          '/_m/x/a/%2e%2E/b',
          '/_m/a/%2f/b',
          '/_m/a/%5C/b',
          '/_m/a/./b',
          '/_m/x/a/../b',
          'http://proxy.invalid/_m/a/%2e/b',
        ]) {
          const aliasResponse = await rawHttpExchange(
            baseUrl,
            rawMutationRequest(target, 'EMITTED_NODE_ALIAS_CREDENTIAL'),
          );
          expect(aliasResponse).toContain('HTTP/1.1 404');
          expect(aliasResponse).toContain('Not Found');
          expect(aliasResponse).not.toContain('EMITTED_NODE_ALIAS_CREDENTIAL');
        }
        expect(rawTargetCounter.__kovoNodeRawTargetHandlerCalls).toBe(0);

        const canonicalMutationPath = await rawHttpExchange(
          baseUrl,
          rawMutationRequest('/_m/a/b', 'EMITTED_NODE_CANONICAL_CREDENTIAL'),
        );
        expect(canonicalMutationPath).toContain('HTTP/1.1 200');
        expect(canonicalMutationPath).toContain('route:/_m/a/b:');
        expect(rawTargetCounter.__kovoNodeRawTargetHandlerCalls).toBe(1);

        const originalSetHas = Set.prototype.has;
        Set.prototype.has = function (value) {
          const bodylessClassifier =
            this.size === 2 &&
            originalSetHas.call(this, 'GET') &&
            originalSetHas.call(this, 'HEAD');
          if (bodylessClassifier && value === 'POST') return true;
          if (bodylessClassifier && value === 'GET') return false;
          return originalSetHas.call(this, value);
        } as typeof Set.prototype.has;
        try {
          const poisonedPost = await rawHttpExchange(
            baseUrl,
            'POST /assets/cart.css HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
          );
          expect(poisonedPost).toContain('route:/assets/cart.css:');
          expect(poisonedPost).not.toContain('body { color: navy; }');

          const poisonedGet = await fetch(`${baseUrl}/assets/cart.css`);
          await expect(poisonedGet.text()).resolves.toBe('body { color: navy; }');
        } finally {
          Set.prototype.has = originalSetHas;
        }

        const declaredOversized = await rawHttpExchange(
          baseUrl,
          'POST /declared-oversized HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Length: 1000000\r\n\r\n',
        );
        expect(declaredOversized).toContain('HTTP/1.1 413');
        expect(declaredOversized).toMatch(/connection: close/i);

        const chunkedOversized = await rawHttpExchange(
          baseUrl,
          'POST /chunked-oversized HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabcde\r\n',
        );
        expect(chunkedOversized).toContain('HTTP/1.1 413');
        expect(chunkedOversized).toMatch(/connection: close/i);

        const incompleteStatic = await rawHttpExchange(
          baseUrl,
          'GET /assets/cart.css HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Length: 1000000\r\n\r\n',
        );
        expect(incompleteStatic).toContain('HTTP/1.1 200');
        expect(incompleteStatic).toMatch(/connection: close/i);
        expect(incompleteStatic).toContain('body { color: navy; }');

        const routeResponse = await fetch(`${baseUrl}/hello?cart=1`, {
          headers: {
            // SPEC §9.5: generated Node output must not trust forwarded scheme headers by default.
            'x-forwarded-proto': 'https',
            'x-from-test': 'route-header',
          },
        });
        await expect(routeResponse.text()).resolves.toBe(
          `route:/hello:http://${new URL(baseUrl).host}:route-header`,
        );
        expect(routeResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');

        const cookieResponse = await nodeGet(baseUrl, '/cookies');
        expect(cookieResponse.headers['set-cookie']).toEqual([
          'session=s1; Path=/; HttpOnly',
          'csrf=c1; Path=/; SameSite=Strict',
        ]);

        const clientModuleResponse = await fetch(`${baseUrl}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cart = true;');
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(clientModuleResponse.headers.get('cross-origin-resource-policy')).toBe(
          'same-origin',
        );
        expect(clientModuleResponse.headers.get('x-content-type-options')).toBe('nosniff');
        expect(clientModuleResponse.headers.get('access-control-allow-origin')).toBeNull();
        expect(clientModuleResponse.headers.get('vary')).toBeNull();
        expect(clientModuleResponse.headers.get('set-cookie')).toBeNull();
        expect(clientModuleResponse.headers.get('content-type')).toBe(
          'text/javascript; charset=utf-8',
        );

        const assetResponse = await fetch(`${baseUrl}/assets/cart.css`);
        await expect(assetResponse.text()).resolves.toBe('body { color: navy; }');
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=0, must-revalidate',
        );
        expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
        expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff');
        expect(assetResponse.headers.get('access-control-allow-origin')).toBeNull();
        expect(assetResponse.headers.get('vary')).toBeNull();
        expect(assetResponse.headers.get('set-cookie')).toBeNull();
        expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');

        const missingClientModule = await fetch(`${baseUrl}/c/__v/cart-v1/missing.client.js`);
        expect(missingClientModule.status).toBe(404);
        expect(missingClientModule.headers.get('cache-control')).toBe('no-store');
        expect(missingClientModule.headers.get('cross-origin-resource-policy')).toBe('same-origin');
        expect(missingClientModule.headers.get('x-content-type-options')).toBe('nosniff');
        expect(missingClientModule.headers.get('vary')).toBeNull();
        expect(missingClientModule.headers.get('set-cookie')).toBeNull();
      } finally {
        delete rawTargetCounter.__kovoNodeRawTargetHandlerCalls;
        await close(server);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('logs unhandled production node server errors to stderr before returning a 500', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-errors-'));
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/boom', {
              page() {
                return renderedHtml('<main>Boom</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  throw new Error('boom from generated handler at ' + request.url);
}
`,
      });
      const nodeOutDir = join(root, 'node-output');

      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      console.error = (...args: unknown[]) => {
        consoleErrors.push(args);
      };
      const serverModule = (await import(pathToFileURL(join(nodeOutDir, 'server.mjs')).href)) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const response = await fetch(
          `${baseUrl}/boom?kovo-cap=NODE_CAPABILITY_SHOULD_NEVER_LOG&State=oauth&state=duplicate`,
          { method: 'POST' },
        );
        expect(response.status).toBe(500);
        await expect(response.text()).resolves.toBe('Internal Server Error');
      } finally {
        console.error = originalConsoleError;
        await close(server);
      }

      expect(consoleErrors).toHaveLength(1);
      expect(consoleErrors[0]?.[0]).toBe('[kovo] unhandled node server error');
      expect(consoleErrors[0]?.[1]).toMatchObject({
        method: 'POST',
        url: '/boom?kovo-cap&State&state',
      });
      const loggedError = (consoleErrors[0]?.[1] as { error?: unknown } | undefined)?.error;
      expect(String(loggedError)).toContain(
        'Error: boom from generated handler at /boom?kovo-cap&State&state',
      );
      expect(String(loggedError)).toContain('handler');
      expect(JSON.stringify(consoleErrors)).not.toContain('NODE_CAPABILITY_SHOULD_NEVER_LOG');
    } finally {
      console.error = originalConsoleError;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps emitted Node static-file confinement after an authored handler poisons globals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-static-intrinsics-'));
    const poisonGlobal = globalThis as typeof globalThis & {
      __kovoRestoreNodeStaticPoison?: () => void;
    };

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const OriginalURL = globalThis.URL;
const originalReflectApply = Reflect.apply;
const originalStartsWith = String.prototype.startsWith;
const originalSlice = String.prototype.slice;

function restore() {
  globalThis.URL = OriginalURL;
  String.prototype.startsWith = originalStartsWith;
}

export default async function handler() {
  globalThis.__kovoRestoreNodeStaticPoison = restore;
  globalThis.URL = function SelectiveURL(input, base) {
    if (base === 'http://kovo.local' && typeof input === 'string' && input.includes('%2e')) {
      return { pathname: input };
    }
    return new OriginalURL(input, base);
  };
  String.prototype.startsWith = function selectiveStartsWith(search, position) {
    if (
      typeof search === 'string' &&
      originalReflectApply(originalSlice, search, [-8]) === '/client/'
    ) {
      return true;
    }
    return originalReflectApply(originalStartsWith, this, [search, position]);
  };
  return new Response('poison armed', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await mkdir(join(nodeOutDir, 'client', 'assets'), { recursive: true });
      const secret = 'NODE_STATIC_CONFINEMENT_SECRET';
      await writeFile(join(nodeOutDir, 'secret.txt'), secret, 'utf8');

      const serverModule = (await import(
        `${pathToFileURL(join(nodeOutDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as { createKovoNodeServer(): Server };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const arm = await fetch(`${baseUrl}/arm`);
        await expect(arm.text()).resolves.toBe('poison armed');
        const traversal = await rawHttpExchange(
          baseUrl,
          'GET /assets/%2e%2e/%2e%2e/secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        );

        expect(traversal).not.toContain(secret);
      } finally {
        poisonGlobal.__kovoRestoreNodeStaticPoison?.();
        delete poisonGlobal.__kovoRestoreNodeStaticPoison;
        await close(server);
      }
    } finally {
      poisonGlobal.__kovoRestoreNodeStaticPoison?.();
      delete poisonGlobal.__kovoRestoreNodeStaticPoison;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('pins emitted Node Response fields before authored getters can substitute output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-response-intrinsics-'));
    const poisonGlobal = globalThis as typeof globalThis & {
      __kovoRestoreNodeResponsePoison?: () => void;
    };

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const properties = ['body', 'headers', 'status', 'statusText'];
const descriptors = new Map(properties.map((property) => [
  property,
  Object.getOwnPropertyDescriptor(Response.prototype, property),
]));
const safe = new Response('SAFE-EMITTED-RESPONSE', {
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  status: 200,
});
const attacker = new Response('<script>emittedAttackerOutput()</script>', {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': 'admin=attacker; Path=/; HttpOnly',
  },
  status: 201,
  statusText: 'ATTACKER',
});

function restore() {
  for (const property of properties) {
    Object.defineProperty(Response.prototype, property, descriptors.get(property));
  }
}

export default async function handler() {
  globalThis.__kovoRestoreNodeResponsePoison = restore;
  for (const property of properties) {
    const descriptor = descriptors.get(property);
    Object.defineProperty(Response.prototype, property, {
      ...descriptor,
      get() {
        return Reflect.apply(descriptor.get, this === safe ? attacker : this, []);
      },
    });
  }
  return safe;
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const serverModule = (await import(
        `${pathToFileURL(join(nodeOutDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as { createKovoNodeServer(): Server };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const response = await fetch(baseUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toBeNull();
        await expect(response.text()).resolves.toBe('SAFE-EMITTED-RESPONSE');
      } finally {
        poisonGlobal.__kovoRestoreNodeResponsePoison?.();
        delete poisonGlobal.__kovoRestoreNodeResponsePoison;
        await close(server);
      }
    } finally {
      poisonGlobal.__kovoRestoreNodeResponsePoison?.();
      delete poisonGlobal.__kovoRestoreNodeResponsePoison;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not serialize attacker source through a late Function.toString replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-source-injection-'));
    const originalFunctionToString = Function.prototype.toString;
    const injectionGlobal = globalThis as typeof globalThis & {
      __kovoGeneratedNodeSourceInjection?: string;
    };

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler() {
  return new Response('safe');
}
`,
      });
      Function.prototype.toString = function selectiveFunctionSource() {
        if (this.name === 'generatedNodeDiagnosticFactory') {
          return `function generatedNodeDiagnosticFactory() {
            globalThis.__kovoGeneratedNodeSourceInjection = 'ATTACKER-CODE-RAN';
            return () => ({ error: 'forged', method: 'GET', url: '/' });
          }`;
        }
        return Reflect.apply(originalFunctionToString, this, []);
      };

      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      Function.prototype.toString = originalFunctionToString;
      const emittedSource = await readFile(join(nodeOutDir, 'server.mjs'), 'utf8');
      expect(emittedSource).not.toContain('ATTACKER-CODE-RAN');

      await import(`${pathToFileURL(join(nodeOutDir, 'server.mjs')).href}?t=${Date.now()}`);
      expect(injectionGlobal.__kovoGeneratedNodeSourceInjection).toBeUndefined();
    } finally {
      Function.prototype.toString = originalFunctionToString;
      delete injectionGlobal.__kovoGeneratedNodeSourceInjection;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('scrubs secret-tagged material from generated node server error logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-secret-errors-'));
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/boom', {
              page() {
                return renderedHtml('<main>Boom</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler() {
  const token = {
    [Symbol.toStringTag]: 'Secret',
    toJSON() { return '[secret]'; },
    toString() { return '[secret]'; },
  };
  Object.defineProperty(token, 'raw', { value: 'sk_live_q5_generated_node', enumerable: false });
  throw { reason: 'provider failed', token };
}
`,
      });
      const nodeOutDir = join(root, 'node-output');

      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      console.error = (...args: unknown[]) => {
        consoleErrors.push(args);
      };
      const serverModule = (await import(pathToFileURL(join(nodeOutDir, 'server.mjs')).href)) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const response = await fetch(`${baseUrl}/boom`, { method: 'POST' });
        expect(response.status).toBe(500);
      } finally {
        console.error = originalConsoleError;
        await close(server);
      }

      expect(consoleErrors).toHaveLength(1);
      expect(consoleErrors[0]?.[1]).toMatchObject({
        error: { reason: 'provider failed', token: '[secret]' },
      });
      expect(JSON.stringify(consoleErrors)).not.toContain('sk_live_q5_generated_node');
    } finally {
      console.error = originalConsoleError;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('redacts isolated request credentials and controls from post-response node errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-stream-errors-'));
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];
    const basicPassword = 'BASIC_PASSWORD_SHOULD_NOT_LOG';
    const basic = Buffer.from(`basic-user:${basicPassword}`).toString('base64');

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  const cookie = /sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1] ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  const basicPassword = Buffer.from(authorization.replace(/^Basic\\s+/i, ''), 'base64')
    .toString('utf8')
    .split(':')[1] ?? '';
  const failure = url.pathname === '/proxy-stream-error'
    ? new Proxy({}, {
        getOwnPropertyDescriptor() { throw new Error('getter trap must not escape'); },
      })
    : new Error(
        'stream failed query=' + url.searchParams.get('apiKeyV2') +
        ' cookie=' + cookie +
        ' header=' + request.headers.get('x-api-key') +
        ' basic=' + basicPassword +
        '\\nFORGED-LINE\\u001b[31m',
      );
  let started = false;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(new TextEncoder().encode('partial-'));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.error(failure);
    },
  }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      console.error = (...args: unknown[]) => {
        consoleErrors.push(args);
      };
      const serverModule = (await import(pathToFileURL(join(nodeOutDir, 'server.mjs')).href)) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const response = await fetch(
          `${baseUrl}/stream-error?apiKeyV2=QUERY_SECRET_SHOULD_NOT_LOG`,
          {
            headers: {
              Authorization: `Basic ${basic}`,
              Cookie: 'sid=COOKIE_SECRET_SHOULD_NOT_LOG',
              'X-API-Key': 'HEADER_SECRET_SHOULD_NOT_LOG',
            },
          },
        );
        expect(response.status).toBe(200);
        await expect(response.text()).rejects.toThrow();

        const proxyResponse = await fetch(`${baseUrl}/proxy-stream-error`);
        expect(proxyResponse.status).toBe(200);
        await expect(proxyResponse.text()).rejects.toThrow();
        await waitForConsoleErrorCount(consoleErrors, 2);
      } finally {
        console.error = originalConsoleError;
        await close(server);
      }

      expect(consoleErrors).toHaveLength(2);
      const loggedError = (consoleErrors[0]?.[1] as { error?: unknown } | undefined)?.error;
      expect(typeof loggedError).toBe('string');
      expect(String(loggedError)).toContain('[redacted]');
      expect(String(loggedError)).toContain('\\u000aFORGED-LINE\\u001b[31m');
      expect(String(loggedError)).not.toContain('\n');
      expect(String(loggedError)).not.toContain('\u001b');
      expect(consoleErrors[1]?.[1]).toMatchObject({ error: '[redacted]' });
      expect(JSON.stringify(consoleErrors)).not.toContain('QUERY_SECRET_SHOULD_NOT_LOG');
      expect(JSON.stringify(consoleErrors)).not.toContain('COOKIE_SECRET_SHOULD_NOT_LOG');
      expect(JSON.stringify(consoleErrors)).not.toContain('HEADER_SECRET_SHOULD_NOT_LOG');
      expect(JSON.stringify(consoleErrors)).not.toContain(basicPassword);
    } finally {
      console.error = originalConsoleError;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps generated Node diagnostics useful under selective ambient intrinsic poisoning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-poisoned-errors-'));
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];
    const poisonGlobal = globalThis as typeof globalThis & {
      __kovoRestoreGeneratedLoggingPoison?: () => void;
    };

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const originalReplaceAll = String.prototype.replaceAll;
const originalSort = Array.prototype.sort;
function restoreLoggingPoison() {
  Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
  String.prototype.replaceAll = originalReplaceAll;
  Array.prototype.sort = originalSort;
}
export default async function handler(request) {
  globalThis.__kovoRestoreGeneratedLoggingPoison = restoreLoggingPoison;
  Object.getOwnPropertyDescriptor = function (_target, property) {
    if (property === 'stack') throw new Error('ambient descriptor reached generated logger');
    return Reflect.apply(originalGetOwnPropertyDescriptor, Object, arguments);
  };
  String.prototype.replaceAll = function (search, replacement) {
    if (search === 'POISON_LOG_SECRET') {
      throw new Error('ambient replaceAll reached generated logger');
    }
    return Reflect.apply(originalReplaceAll, this, [search, replacement]);
  };
  Array.prototype.sort = function (compare) {
    for (let index = 0; index < this.length; index += 1) {
      if (this[index] === 'POISON_LOG_SECRET') {
        throw new Error('ambient sort reached generated logger');
      }
    }
    return Reflect.apply(originalSort, this, [compare]);
  };
  throw new Error(
    'generated poison at ' + request.url +
    ' token=POISON_LOG_SECRET\\nFORGED-LINE\\u001b[31m'
  );
}
`,
      });
      const nodeOutDir = join(root, 'node-output');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      console.error = (...args: unknown[]) => {
        consoleErrors.push(args);
      };
      const serverModule = (await import(
        `${pathToFileURL(join(nodeOutDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as { createKovoNodeServer(): Server };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
        const response = await fetch(`${baseUrl}/poison?apiKey=POISON_LOG_SECRET`, {
          method: 'POST',
        });
        poisonGlobal.__kovoRestoreGeneratedLoggingPoison?.();
        expect(response.status).toBe(500);
        await expect(response.text()).resolves.toBe('Internal Server Error');
      } finally {
        poisonGlobal.__kovoRestoreGeneratedLoggingPoison?.();
        delete poisonGlobal.__kovoRestoreGeneratedLoggingPoison;
        console.error = originalConsoleError;
        await close(server);
      }

      expect(consoleErrors).toHaveLength(1);
      expect(consoleErrors[0]?.[1]).toMatchObject({
        method: 'POST',
        url: '/poison?apiKey',
      });
      const loggedError = (consoleErrors[0]?.[1] as { error?: unknown } | undefined)?.error;
      expect(String(loggedError)).toContain('generated poison at /poison?apiKey');
      expect(String(loggedError)).toContain('token=[redacted]');
      expect(String(loggedError)).toContain('\\u000aFORGED-LINE\\u001b[31m');
      expect(String(loggedError)).not.toContain('POISON_LOG_SECRET');
      expect(String(loggedError)).not.toContain('\n');
      expect(String(loggedError)).not.toContain('\u001b');
    } finally {
      poisonGlobal.__kovoRestoreGeneratedLoggingPoison?.();
      delete poisonGlobal.__kovoRestoreGeneratedLoggingPoison;
      console.error = originalConsoleError;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits an installable Dockerfile and runtime package for the node preset by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-node-preset-dockerfile-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Home</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("ok"); }\n',
      });
      const nodeOutDir = join(root, 'node-output');

      await node().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });

      const dockerfile = await readFile(join(nodeOutDir, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain('COPY package.json ./');
      expect(dockerfile).toContain('npm install --omit=dev --ignore-scripts');
      expect(dockerfile).toContain('CMD ["node", "server.mjs"]');

      const runtimePackage = JSON.parse(
        await readFile(join(nodeOutDir, 'package.json'), 'utf8'),
      ) as {
        dependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        type?: string;
      };
      expect(runtimePackage.type).toBe('module');
      expect(runtimePackage.scripts?.start).toBe('NODE_ENV=production node server.mjs');
      expect(runtimePackage.dependencies).toBeDefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits Vercel Build Output API v3 with static files and a Node function', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-vercel-preset-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), 'main { color: teal; }');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const viteAsset = true;');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const neutralDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/hello', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Hello</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir: neutralDir,
        routeEntryMap: {
          '/hello': 'src/cart.client.ts',
        },
        serverHandlerSource: `
export default async function handler(request) {
  globalThis.__kovoVercelRawTargetHandlerCalls =
    (globalThis.__kovoVercelRawTargetHandlerCalls ?? 0) + 1;
  const url = new URL(request.url);
  if (url.pathname === '/cookies') {
    const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
    headers.append('set-cookie', 'session=s1; Path=/; HttpOnly');
    headers.append('set-cookie', 'csrf=c1; Path=/; SameSite=Strict');
    return new Response('cookies', { headers });
  }
  return new Response('vercel:' + url.pathname + ':' + request.headers.get('x-from-test'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      const logs: string[] = [];
      const vercelOutDir = join(root, '.vercel/output');
      await vercel({ maxDuration: 8, regions: ['iad1'] }).emit!(build, {
        declaredEnv: [],
        log(message) {
          logs.push(message);
        },
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });

      expect(logs).toEqual([`Emitted Kovo vercel preset output to ${vercelOutDir}`]);
      await expect(
        readFile(join(vercelOutDir, 'static/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(readFile(join(vercelOutDir, 'static/assets/cart.css'), 'utf8')).resolves.toBe(
        'main { color: teal; }',
      );
      await expect(
        readFile(join(vercelOutDir, 'functions/kovo.func/handler.mjs'), 'utf8'),
      ).resolves.toContain('vercel:');
      const vercelFunction = await readFile(
        join(vercelOutDir, 'functions/kovo.func/index.cjs'),
        'utf8',
      );
      expect(vercelFunction).toContain("import('./node-adapter.mjs')");
      const vercelAdapter = await readFile(
        join(vercelOutDir, 'functions/kovo.func/node-adapter.mjs'),
        'utf8',
      );
      expect(vercelAdapter).toContain('export function nodeRequestToWebRequest');
      expect(vercelAdapter).toContain('export function rejectUnsafeNodeMutationTarget');
      expect(vercelAdapter).toContain('export async function writeWebResponseToNode');
      expect(vercelAdapter).toContain('const setCookies = apply(nativeHeadersGetSetCookie');
      expect(vercelAdapter).not.toContain('typeof headers.getSetCookie');
      expect(vercelAdapter).toContain("nodeHeaders['set-cookie'] = setCookies");
      expect(vercelAdapter).toContain(':authority');
      expect(vercelAdapter).toContain("name.startsWith(':')");
      expect(vercelAdapter).toContain('signal: controller.signal');
      expect(vercelAdapter).toContain('nodeRequest.socket?.remoteAddress?.trim()');
      expect(vercelAdapter).toContain("'__kovoPeerAddress'");
      expect(vercelFunction).not.toContain('function nodeRequestToWebRequest');
      expect(vercelFunction).not.toContain('function responseHeadersToNodeHeaders');
      expect(vercelFunction).toContain('nodeResponse.destroy()');
      expect(vercelFunction).toContain('rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)');
      await expect(
        readJson(join(vercelOutDir, 'functions/kovo.func/.vc-config.json')),
      ).resolves.toEqual({
        handler: 'index.cjs',
        launcherType: 'Nodejs',
        maxDuration: 8,
        regions: ['iad1'],
        runtime: 'nodejs22.x',
        shouldAddHelpers: true,
      });
      await expect(readJson(join(vercelOutDir, 'config.json'))).resolves.toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/c/(.*)',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=0, must-revalidate',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
          { dest: '/kovo', src: '/(.*)' },
        ],
        version: 3,
      });
      await assertVercelBuildOutput(vercelOutDir, {
        function: {
          config: {
            handler: 'index.cjs',
            launcherType: 'Nodejs',
            maxDuration: 8,
            regions: ['iad1'],
            runtime: 'nodejs22.x',
            shouldAddHelpers: true,
          },
          name: 'kovo',
        },
        staticFiles: ['assets/cart.css', 'c/__v/cart-v1/cart.client.js'],
      });

      const functionModule = (await import(
        `${pathToFileURL(join(vercelOutDir, 'functions/kovo.func/index.cjs')).href}?t=${Date.now()}`
      )) as {
        default: (request: unknown, response: unknown) => void;
      };
      const emittedVercelAdapter = (await import(
        `${pathToFileURL(join(vercelOutDir, 'functions/kovo.func/node-adapter.mjs')).href}?t=${Date.now()}`
      )) as NodeAdapterModule;
      await expectEmittedAdapterParity(emittedVercelAdapter);

      const server = createHttpServer(functionModule.default);
      const baseUrl = await listen(server);
      const rawTargetCounter = globalThis as typeof globalThis & {
        __kovoVercelRawTargetHandlerCalls?: number;
      };
      rawTargetCounter.__kovoVercelRawTargetHandlerCalls = 0;

      try {
        const aliasResponse = await rawHttpExchange(
          baseUrl,
          rawMutationRequest('/_m/a/%2e/b', 'VERCEL_ALIAS_CREDENTIAL'),
        );
        expect(aliasResponse).toContain('HTTP/1.1 404');
        expect(aliasResponse).toContain('Not Found');
        expect(aliasResponse).not.toContain('VERCEL_ALIAS_CREDENTIAL');
        expect(rawTargetCounter.__kovoVercelRawTargetHandlerCalls).toBe(0);

        const canonicalMutationPath = await rawHttpExchange(
          baseUrl,
          rawMutationRequest('/_m/a/b', 'VERCEL_CANONICAL_CREDENTIAL'),
        );
        expect(canonicalMutationPath).toContain('HTTP/1.1 200');
        expect(canonicalMutationPath).toContain('vercel:/_m/a/b:');
        expect(rawTargetCounter.__kovoVercelRawTargetHandlerCalls).toBe(1);

        const response = await fetch(`${baseUrl}/hello`, {
          headers: { 'x-from-test': 'function-header' },
        });
        await expect(response.text()).resolves.toBe('vercel:/hello:function-header');
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');

        const cookieResponse = await nodeGet(baseUrl, '/cookies');
        expect(cookieResponse.headers['set-cookie']).toEqual([
          'session=s1; Path=/; HttpOnly',
          'csrf=c1; Path=/; SameSite=Strict',
        ]);
      } finally {
        delete rawTargetCounter.__kovoVercelRawTargetHandlerCalls;
        await close(server);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('lets presets prefer a proven static-only neutral build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-static-preset-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/', {
              page() {
                return renderedHtml('<main>Static Home</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/static.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const staticClient = true;',
            version: 'static-v1',
          },
        ],
        outDir: join(root, '.kovo'),
        serverHandlerSource:
          'export default async function handler() { return new Response("dynamic"); }\n',
      });

      expect(build.staticOutput).toMatchObject({ dir: join(root, '.kovo/static') });

      const nodeOutDir = join(root, 'node-static');
      await node().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(readFile(join(nodeOutDir, 'server.mjs'), 'utf8')).resolves.toContain(
        'createServer',
      );
      await expect(
        readFile(join(nodeOutDir, 'client/c/__v/static-v1/static.client.js'), 'utf8'),
      ).resolves.toContain('staticClient');

      const vercelOutDir = join(root, '.vercel/output');
      await vercel().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(readFile(join(vercelOutDir, 'static/index.html'), 'utf8')).resolves.toContain(
        'Static Home',
      );
      await expect(
        readFile(join(vercelOutDir, 'functions/kovo.func/index.cjs'), 'utf8'),
      ).rejects.toThrow();
      await expect(readJson(join(vercelOutDir, 'config.json'))).resolves.toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/c/(.*)',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=0, must-revalidate',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
        ],
        version: 3,
      });
      await assertVercelBuildOutput(vercelOutDir, {
        function: false,
        staticFiles: ['index.html'],
      });

      const cloudflareOutDir = join(root, 'cloudflare-static');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(cloudflareOutDir, 'client/index.html'), 'utf8'),
      ).resolves.toContain('Static Home');
      await expect(readFile(join(cloudflareOutDir, 'worker.mjs'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(cloudflareOutDir, 'wrangler.toml'), 'utf8')).resolves.toContain(
        'directory = "./client"',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits static route documents alongside dynamic preset fallbacks for mixed apps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-mixed-static-preset-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/static', {
              page() {
                return renderedHtml('<main>Static Route</main>');
              },
            }),
            route('/dynamic', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Dynamic Route</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  return new Response('dynamic:' + url.pathname, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      expect(build.staticOnly).toBe(false);
      expect(build.staticOutput).toMatchObject({
        complete: false,
        dir: join(root, '.kovo/static'),
        routeDocuments: [{ path: '/static', routePath: '/static' }],
      });
      await expect(readJson(join(root, '.kovo/routes.json'))).resolves.toEqual({
        routes: [
          {
            export: {
              paths: ['/static'],
              policy: 'static',
            },
            path: '/static',
          },
          {
            export: {
              diagnostics: [
                {
                  code: 'KV229',
                  message:
                    "KV229 static export cannot export guarded route '/dynamic'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.",
                  routePath: '/dynamic',
                },
              ],
              policy: 'dynamic',
            },
            path: '/dynamic',
          },
        ],
        version: 'kovo-neutral-build/v1',
      });

      const nodeOutDir = join(root, 'node-mixed');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(nodeOutDir, 'static/static/index.html'), 'utf8'),
      ).resolves.toContain('Static Route');
      const serverModule = (await import(
        `${pathToFileURL(join(nodeOutDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);
      try {
        const staticResponse = await fetch(`${baseUrl}/static`);
        await expect(staticResponse.text()).resolves.toContain('Static Route');
        expect(staticResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(staticResponse.headers.get('x-content-type-options')).toBe('nosniff');
        expect(staticResponse.headers.get('cache-control')).toBeNull();
        expect(staticResponse.headers.get('vary')).toBeNull();
        expect(staticResponse.headers.get('set-cookie')).toBeNull();

        const dynamicResponse = await fetch(`${baseUrl}/dynamic`);
        await expect(dynamicResponse.text()).resolves.toBe('dynamic:/dynamic');
        expect(dynamicResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      } finally {
        await close(server);
      }

      const vercelOutDir = join(root, '.vercel/output');
      await vercel().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: vercelOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(vercelOutDir, 'static/static/index.html'), 'utf8'),
      ).resolves.toContain('Static Route');
      await expect(
        readFile(join(vercelOutDir, 'functions/kovo.func/index.cjs'), 'utf8'),
      ).resolves.toContain('kovoVercelFunction');
      await expect(readJson(join(vercelOutDir, 'config.json'))).resolves.toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/c/(.*)',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
          },
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=0, must-revalidate',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/assets/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
          { dest: '/kovo', src: '/(.*)' },
        ],
        version: 3,
      });
      await assertVercelBuildOutput(vercelOutDir, {
        function: {
          config: {
            handler: 'index.cjs',
            launcherType: 'Nodejs',
            runtime: 'nodejs22.x',
            shouldAddHelpers: true,
          },
          name: 'kovo',
        },
        staticFiles: ['static/index.html'],
      });

      const cloudflareOutDir = join(root, 'cloudflare-mixed');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(
        readFile(join(cloudflareOutDir, 'client/static/index.html'), 'utf8'),
      ).resolves.toContain('Static Route');
      await expect(readFile(join(cloudflareOutDir, 'worker.mjs'), 'utf8')).resolves.toContain(
        "ownDataValue(env, 'ASSETS')",
      );

      const workerModule = (await import(
        `${pathToFileURL(join(cloudflareOutDir, 'worker.mjs')).href}?t=${Date.now()}`
      )) as {
        default: {
          fetch(
            request: Request,
            env: { ASSETS?: { fetch(request: Request): Promise<Response> } },
          ): Promise<Response> | Response;
        };
      };

      const staticWorkerResponse = await workerModule.default.fetch(
        new Request('https://worker.test/static'),
        {
          ASSETS: {
            fetch: async () =>
              new Response('<main>Static Route</main>', {
                headers: { 'content-type': 'text/html; charset=utf-8' },
              }),
          },
        },
      );
      await expect(staticWorkerResponse.text()).resolves.toContain('Static Route');
      expect(staticWorkerResponse.headers.get('cache-control')).toBeNull();
      expect(staticWorkerResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(staticWorkerResponse.headers.get('vary')).toBeNull();
      expect(staticWorkerResponse.headers.get('set-cookie')).toBeNull();

      const dynamicWorkerResponse = await workerModule.default.fetch(
        new Request('https://worker.test/dynamic'),
        {
          ASSETS: {
            fetch: async () => new Response('Not Found', { status: 404 }),
          },
        },
      );
      await expect(dynamicWorkerResponse.text()).resolves.toBe('dynamic:/dynamic');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('serves public assets from dynamic node production artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-dynamic-public-assets-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'logo.svg'), '<svg viewBox="0 0 1 1"></svg>');
      await writeFile(join(distDir, 'assets/client.js'), 'export const client = true;');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/client.ts': {
            file: 'assets/client.js',
          },
        }),
      );

      const build = await writeKovoNeutralBuild({
        app: createApp({
          queries: [
            query('asset-proof', {
              load: () => ({ ok: true }),
              reads: [],
            }),
          ],
          routes: [
            route('/asset-proof', {
              page() {
                return renderedHtml('<main><img src="/logo.svg" alt=""></main>');
              },
            }),
          ],
        }),
        manifestFile: join(distDir, '.vite/manifest.json'),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  if (url.pathname === '/asset-proof') {
    return new Response('<main><img src="/logo.svg" alt=""></main>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  return new Response('dynamic:' + url.pathname, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      expect(build.staticOutput).toBeUndefined();
      await expect(readFile(join(root, '.kovo/public/logo.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );

      const nodeOutDir = join(root, 'node-dynamic');
      await node({ dockerfile: false }).emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: nodeOutDir,
        readNeutral() {
          return build;
        },
      });
      await expect(readFile(join(nodeOutDir, 'static/logo.svg'), 'utf8')).resolves.toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );

      const serverModule = (await import(
        `${pathToFileURL(join(nodeOutDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);
      try {
        const pageResponse = await fetch(`${baseUrl}/asset-proof`);
        await expect(pageResponse.text()).resolves.toContain('<img src="/logo.svg"');

        const assetResponse = await fetch(`${baseUrl}/logo.svg`);
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('content-type')).toBe('image/svg+xml');
        await expect(assetResponse.text()).resolves.toBe('<svg viewBox="0 0 1 1"></svg>');
      } finally {
        await close(server);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits a Cloudflare Workers project with assets binding and node compatibility', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-preset-'));

    try {
      const neutralDir = join(root, 'dist', '.kovo');
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/hello', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Hello</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const cart = true;',
            version: 'cart-v1',
          },
        ],
        outDir: neutralDir,
        serverHandlerSource: `
export default async function handler(request) {
  const url = new URL(request.url);
  return new Response('cloudflare:' + url.pathname, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
`,
      });

      const logs: string[] = [];
      const cloudflareOutDir = join(root, 'cloudflare-output');
      await cloudflare({ compatibilityDate: '2026-06-18', name: 'kovo-test' }).emit!(build, {
        declaredEnv: [],
        log(message) {
          logs.push(message);
        },
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });

      expect(logs).toEqual([`Emitted Kovo cloudflare preset output to ${cloudflareOutDir}`]);
      await expect(
        readFile(join(cloudflareOutDir, 'client/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
      await expect(
        readFile(join(cloudflareOutDir, 'server/handler.mjs'), 'utf8'),
      ).resolves.toContain('cloudflare:');
      await expect(readFile(join(cloudflareOutDir, 'wrangler.toml'), 'utf8')).resolves.toBe(
        [
          'name = "kovo-test"',
          'main = "./worker.mjs"',
          'compatibility_date = "2026-06-18"',
          'compatibility_flags = ["nodejs_compat"]',
          '',
          '[assets]',
          'directory = "./client"',
          'binding = "ASSETS"',
          'run_worker_first = true',
          '',
        ].join('\n'),
      );

      const workerModule = (await import(
        `${pathToFileURL(join(cloudflareOutDir, 'worker.mjs')).href}?t=${Date.now()}`
      )) as {
        default: {
          fetch(
            request: Request,
            env: { ASSETS?: { fetch(request: Request): Promise<Response> } },
          ): Promise<Response> | Response;
        };
      };

      const originalSetHas = Set.prototype.has;
      Set.prototype.has = function (value) {
        const bodylessClassifier =
          this.size === 2 && originalSetHas.call(this, 'GET') && originalSetHas.call(this, 'HEAD');
        if (bodylessClassifier && value === 'POST') return true;
        if (bodylessClassifier && value === 'GET') return false;
        return originalSetHas.call(this, value);
      } as typeof Set.prototype.has;
      try {
        let postAssetCalls = 0;
        const poisonedPost = await workerModule.default.fetch(
          new Request('https://worker.test/assets/cart.css', { method: 'POST' }),
          {
            ASSETS: {
              fetch: async () => {
                postAssetCalls += 1;
                return new Response('STATIC_POST_MUST_NOT_WIN');
              },
            },
          },
        );
        await expect(poisonedPost.text()).resolves.toBe('cloudflare:/assets/cart.css');
        expect(postAssetCalls).toBe(0);

        let getAssetCalls = 0;
        const poisonedGet = await workerModule.default.fetch(
          new Request('https://worker.test/assets/cart.css'),
          {
            ASSETS: {
              fetch: async () => {
                getAssetCalls += 1;
                return new Response('STATIC_GET_MUST_WIN');
              },
            },
          },
        );
        await expect(poisonedGet.text()).resolves.toBe('STATIC_GET_MUST_WIN');
        expect(getAssetCalls).toBe(1);
      } finally {
        Set.prototype.has = originalSetHas;
      }

      const assetResponse = await workerModule.default.fetch(
        new Request('https://worker.test/assets/cart.css'),
        {
          ASSETS: {
            fetch: async () =>
              new Response('body { color: navy; }', {
                headers: { 'content-type': 'text/css; charset=utf-8' },
              }),
          },
        },
      );
      await expect(assetResponse.text()).resolves.toBe('body { color: navy; }');
      expect(assetResponse.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(assetResponse.headers.get('access-control-allow-origin')).toBeNull();
      expect(assetResponse.headers.get('vary')).toBeNull();
      expect(assetResponse.headers.get('set-cookie')).toBeNull();

      const immutableAssetResponse = await workerModule.default.fetch(
        new Request('https://worker.test/c/__v/cart-v1/cart.client.js'),
        {
          ASSETS: {
            fetch: async () =>
              new Response('export const asset = true;', {
                headers: { 'content-type': 'text/javascript; charset=utf-8' },
              }),
          },
        },
      );
      await expect(immutableAssetResponse.text()).resolves.toBe('export const asset = true;');
      expect(immutableAssetResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(immutableAssetResponse.headers.get('cross-origin-resource-policy')).toBe(
        'same-origin',
      );
      expect(immutableAssetResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(immutableAssetResponse.headers.get('access-control-allow-origin')).toBeNull();
      expect(immutableAssetResponse.headers.get('vary')).toBeNull();
      expect(immutableAssetResponse.headers.get('set-cookie')).toBeNull();

      const assetErrorResponse = await workerModule.default.fetch(
        new Request('https://worker.test/c/__v/cart-v1/missing.client.js'),
        {
          ASSETS: {
            fetch: async () =>
              new Response('Asset Error', {
                headers: { 'content-type': 'text/plain; charset=utf-8' },
                status: 500,
              }),
          },
        },
      );
      expect(assetErrorResponse.status).toBe(500);
      expect(assetErrorResponse.headers.get('cache-control')).toBe('no-store');
      expect(assetErrorResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(assetErrorResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(assetErrorResponse.headers.get('vary')).toBeNull();
      expect(assetErrorResponse.headers.get('set-cookie')).toBeNull();

      const routeResponse = await workerModule.default.fetch(
        new Request('https://worker.test/hello'),
        {
          ASSETS: {
            fetch: async () => new Response('Not Found', { status: 404 }),
          },
        },
      );
      await expect(routeResponse.text()).resolves.toBe('cloudflare:/hello');
      expect(routeResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('inspects Cloudflare runtime constraints before emitting Worker output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-inspect-'));

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({
          routes: [
            route('/db', {
              page() {
                return renderedHtml('<main>DB</main>');
              },
            }),
          ],
        }),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
import { spawnSync } from 'node:child_process';
import { renderedHtml } from './html.js';

export default async function handler() {
  spawnSync('true');
  return new Response(process.env.DATABASE_URL ?? 'missing');
}
`,
      });

      await expect(
        cloudflare().inspect!(build, { declaredEnv: ['DATABASE_URL'] }),
      ).resolves.toEqual([
        {
          code: 'cloudflare-tcp-database',
          message:
            'The cloudflare preset emits a Worker with nodejs_compat. TCP database drivers behind DATABASE_URL need Hyperdrive, Cloudflare Containers, or an HTTP database driver before deploy.',
          severity: 'warning',
        },
        {
          code: 'cloudflare-unsupported-node-api',
          message:
            'The cloudflare preset cannot run node:child_process; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.',
          severity: 'error',
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps emitted Cloudflare static security headers after handler-module poisoning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-cloudflare-static-intrinsics-'));
    const poisonGlobal = globalThis as typeof globalThis & {
      __kovoRestoreCloudflareStaticPoison?: () => void;
    };

    try {
      const build = await writeKovoNeutralBuild({
        app: createApp({}),
        outDir: join(root, '.kovo'),
        serverHandlerSource: `
const originalHeadersSet = Headers.prototype.set;
const originalReflectApply = Reflect.apply;
globalThis.__kovoRestoreCloudflareStaticPoison = () => {
  Headers.prototype.set = originalHeadersSet;
};
Headers.prototype.set = function selectiveSet(name, value) {
  if (name === 'x-content-type-options') return;
  return originalReflectApply(originalHeadersSet, this, [name, value]);
};

export default async function handler() {
  return new Response('dynamic');
}
`,
      });
      const cloudflareOutDir = join(root, 'cloudflare-output');
      await cloudflare().emit!(build, {
        declaredEnv: [],
        log() {},
        outDir: cloudflareOutDir,
        readNeutral() {
          return build;
        },
      });
      const workerModule = (await import(
        `${pathToFileURL(join(cloudflareOutDir, 'worker.mjs')).href}?t=${Date.now()}`
      )) as {
        default: {
          fetch(
            request: Request,
            env: { ASSETS?: { fetch(request: Request): Promise<Response> } },
          ): Promise<Response> | Response;
        };
      };

      const arm = await workerModule.default.fetch(new Request('https://worker.test/arm'), {});
      await expect(arm.text()).resolves.toBe('dynamic');
      const response = await workerModule.default.fetch(
        new Request('https://worker.test/assets/app.css'),
        {
          ASSETS: {
            fetch: async () =>
              new Response('body { color: navy; }', {
                headers: { 'content-type': 'text/css; charset=utf-8' },
              }),
          },
        },
      );

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      poisonGlobal.__kovoRestoreCloudflareStaticPoison?.();
      delete poisonGlobal.__kovoRestoreCloudflareStaticPoison;
      await rm(root, { force: true, recursive: true });
    }
  });
});

function withNoStylesheetCallerFile<T>(callback: () => T): T {
  const previous = Error.prepareStackTrace;
  Error.prepareStackTrace = () => 'Error\n    at stylesheet (file:///workspace/hints.ts:1:1)';
  try {
    return callback();
  } finally {
    Error.prepareStackTrace = previous;
  }
}

async function expectEmittedAdapterParity(adapter: NodeAdapterModule): Promise<void> {
  const liveRequest = liveNodeRequestToWebRequest(adapterParityRequest(), { trustedProxy: true });
  const emittedRequest = adapter.nodeRequestToWebRequest(adapterParityRequest(), {
    trustedProxy: true,
  });

  // SPEC §9.5: the live and emitted Node adapters must agree on the HTTP/2 compat header
  // bridge. Pseudo-headers are URL inputs only; they must never be copied into Web Headers.
  expect(emittedRequest.url).toBe(liveRequest.url);
  expect(emittedRequest.headers.get('x-from-test')).toBe(liveRequest.headers.get('x-from-test'));
  expect(emittedRequest.headers.get('host')).toBeNull();
  expect(() => emittedRequest.headers.get(':authority')).toThrow();

  for (const target of [
    '/%2e/_m/a/b',
    '/x/%2e%2e/_m/a/b',
    '//_m/a/b',
    '////_m/a/b',
    '/_m/a/%2e/b',
    '\\_m\\a\\b',
    'http://attacker.test/_m/a/b',
    'https://h2.example.test/_m/a/b',
    'http://proxy.invalid\\_m\\a\\%2e\\b',
  ]) {
    const unsafeMutationRequest = adapterParityRequest();
    unsafeMutationRequest.method = 'POST';
    unsafeMutationRequest.url = target;
    expect(() => adapter.nodeRequestToWebRequest(unsafeMutationRequest)).toThrow(
      'Reserved mutation request targets must use their canonical raw path.',
    );
  }

  const originalIncludes = String.prototype.includes;
  const originalRegExpTest = RegExp.prototype.test;
  const originalMin = Math.min;
  String.prototype.includes = () => false;
  RegExp.prototype.test = () => false;
  Math.min = () => 1 / 0;
  try {
    for (const target of [
      '/_m/a/%2f/b',
      '/_m/a/%2e/b',
      '/_m/a/./b',
      '\\_m\\a\\b',
      'http://attacker.test/_m/a/b',
    ]) {
      const unsafeMutationRequest = adapterParityRequest();
      unsafeMutationRequest.headers = { host: 'h2.example.test', 'x-from-test': 'yes' };
      unsafeMutationRequest.method = 'POST';
      unsafeMutationRequest.url = target;
      expect(() => adapter.nodeRequestToWebRequest(unsafeMutationRequest)).toThrow(
        'Reserved mutation request targets must use their canonical raw path.',
      );
    }

    const canonicalUnderPoison = adapterParityRequest();
    canonicalUnderPoison.headers = { host: 'h2.example.test', 'x-from-test': 'yes' };
    canonicalUnderPoison.url = '/_m/a/b';
    expect(
      adapter.nodeRequestToWebRequest(canonicalUnderPoison, {
        origin: 'https://h2.example.test',
      }).url,
    ).toBe('https://h2.example.test/_m/a/b');
  } finally {
    String.prototype.includes = originalIncludes;
    RegExp.prototype.test = originalRegExpTest;
    Math.min = originalMin;
  }

  const canonicalMutationRequest = adapterParityRequest();
  canonicalMutationRequest.url = '/_m/a/b';
  expect(
    adapter.nodeRequestToWebRequest(canonicalMutationRequest, { trustedProxy: true }).url,
  ).toBe('https://h2.example.test/_m/a/b');

  const liveHeaders = await capturedNodeHeaders(liveWriteWebResponseToNode);
  const emittedHeaders = await capturedNodeHeaders(adapter.writeWebResponseToNode);
  expect(emittedHeaders).toEqual(liveHeaders);
  expect(emittedHeaders['set-cookie']).toEqual([
    'session=s1; Path=/; HttpOnly',
    'csrf=c1; Path=/; SameSite=Strict',
  ]);
}

function adapterParityRequest(): IncomingMessage {
  const socket = Object.assign(new EventEmitter(), {
    encrypted: false,
    remoteAddress: '203.0.113.9',
  }) as Socket & { encrypted?: boolean };
  return Object.assign(new EventEmitter(), {
    headers: {
      ':authority': 'h2.example.test',
      ':method': 'GET',
      ':path': '/from-pseudo',
      ':scheme': 'https',
      'x-from-test': ['one', 'two'],
    },
    method: 'GET',
    socket,
    url: '/from-url?x=1',
  }) as IncomingMessage;
}

async function capturedNodeHeaders(
  writeWebResponseToNode: NodeAdapterModule['writeWebResponseToNode'],
): Promise<Record<string, string | string[]>> {
  const response = new Response(null, { status: 204 });
  response.headers.append('set-cookie', 'session=s1; Path=/; HttpOnly');
  response.headers.append('set-cookie', 'csrf=c1; Path=/; SameSite=Strict');
  response.headers.set('x-from-test', 'kept');
  let captured: Record<string, string | string[]> = {};
  const nodeResponse = {
    end() {
      return this;
    },
    writeHead(_status: number, _statusText: string, headers: Record<string, string | string[]>) {
      captured = headers;
      return this;
    },
  } as unknown as ServerResponse;

  await writeWebResponseToNode(response, nodeResponse, 'GET');
  return captured;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

type VercelFunctionExpectation =
  | false
  | {
      config: Record<string, unknown>;
      name: string;
    };

async function assertVercelBuildOutput(
  outDir: string,
  expected: {
    function: VercelFunctionExpectation;
    staticFiles: readonly string[];
  },
): Promise<void> {
  expect(await sortedDirNames(outDir)).toEqual(
    expected.function === false
      ? ['config.json', 'static']
      : ['config.json', 'functions', 'static'],
  );

  const config = await readJson(join(outDir, 'config.json'));
  expectVercelConfig(config);

  const staticDir = join(outDir, 'static');
  expect((await stat(staticDir)).isDirectory()).toBe(true);
  for (const filePath of expected.staticFiles) {
    const file = await stat(join(staticDir, filePath));
    expect(file.isFile(), filePath).toBe(true);
  }

  if (expected.function === false) {
    await expect(stat(join(outDir, 'functions'))).rejects.toThrow();
    return;
  }

  const functionDir = join(outDir, 'functions', `${expected.function.name}.func`);
  expect((await stat(functionDir)).isDirectory()).toBe(true);
  await expect(readJson(join(functionDir, '.vc-config.json'))).resolves.toEqual(
    expected.function.config,
  );

  const functionConfig = expected.function.config;
  expect(functionConfig).toMatchObject({
    handler: expect.any(String),
    launcherType: 'Nodejs',
    runtime: expect.stringMatching(/^nodejs\d+\.x$/),
  });
  expect((await stat(join(functionDir, String(functionConfig.handler)))).isFile()).toBe(true);
}

function expectVercelConfig(config: unknown): void {
  expect(config).toMatchObject({ version: 3 });
  if (!isRecord(config) || config.routes === undefined) return;
  expect(Array.isArray(config.routes)).toBe(true);
  for (const routeEntry of config.routes as unknown[]) {
    expect(isRecord(routeEntry), JSON.stringify(routeEntry)).toBe(true);
    const hasSource = typeof (routeEntry as Record<string, unknown>).src === 'string';
    const hasHandler = typeof (routeEntry as Record<string, unknown>).handle === 'string';
    expect(hasSource || hasHandler, JSON.stringify(routeEntry)).toBe(true);
  }
}

async function sortedDirNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clientModuleRetentionError(presetName: string) {
  return {
    code: 'KV417',
    message: `The ${presetName} preset cannot prove the SPEC §14 deploy-skew retention floor for immutable /c/__v/... modules and prior-token /_q reads. Configure ${presetName}({ retention: { hours: 24, immutableClientModules: 'retained', priorTokenQueryReads: 'retained' } }) only when the serving layer retains prior build artifacts and query-read support for at least 24 hours, or use a preset/adapter that declares that support.`,
    severity: 'error',
  };
}

function missingJobRunnerError(presetName: string, taskList: string) {
  return {
    code: 'KV445',
    message: `The ${presetName} preset declares no JobRunner capability but this build registers durable task(s): ${taskList}. SPEC §9.6 requires presets that support task()/request.schedule() to declare a real drainer; use the node preset's in-process JobRunner, or configure a preset/adapter with a cron-drain or external queue runner before deploying.`,
    severity: 'error',
  };
}

function sqliteDurableTaskStoreError(presetName: string, taskList: string) {
  return {
    code: 'KV446',
    message: `The ${presetName} preset's default JobRunner persists durable task(s) in the Postgres _kovo_jobs store, but this build registers durable task(s): ${taskList} and the server bundle uses SQLite/better-sqlite3. SPEC §9.6 requires the node JobRunner's Postgres durable-task store; use a Postgres-compatible app db for durable tasks or remove task()/request.schedule() until a supported SQLite durable queue adapter exists.`,
    severity: 'error',
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected node preset test server to listen on an ephemeral port.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function nodeGet(
  baseUrl: string,
  pathname: string,
): Promise<{ body: string; headers: IncomingHttpHeaders; statusCode: number }> {
  const url = new URL(pathname, baseUrl);
  return await new Promise((resolve, reject) => {
    const request = nodeHttpRequest(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            body,
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function rawHttpExchange(baseUrl: string, wireRequest: string): Promise<string> {
  const url = new URL(baseUrl);
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = netConnect({ host: url.hostname, port: Number(url.port) });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the incomplete HTTP request socket to close.'));
    }, 2_000);

    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('connect', () => socket.write(wireRequest));
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function rawMutationRequest(target: string, credential: string): string {
  return [
    `POST ${target} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: close',
    `Authorization: Bearer ${credential}`,
    `Cookie: sid=${credential}`,
    'Content-Length: 0',
    '',
    '',
  ].join('\r\n');
}

async function waitForConsoleErrorCount(
  errors: readonly unknown[][],
  count: number,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (errors.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (errors.length < count) {
    throw new Error(`Timed out waiting for ${count} generated Node error log entries.`);
  }
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
