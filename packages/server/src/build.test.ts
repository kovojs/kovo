import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  request as nodeHttpRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
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
import { stylesheet } from './hints.js';
import { writeKovoNeutralBuild } from './neutral-build.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const runtimeClientModuleFile = /^c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const testRenderPlanFingerprint = computeRenderPlanFingerprint({
  test: 'field:id',
});

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
  });

  it('writes a deterministic neutral build layout from app-shell build inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-neutral-build-'));

    try {
      const distDir = join(root, 'dist');
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart { color: green; }');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const asset = true;');
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
                  '<main>Cart <button on:click="/c/__v/cart-v1/cart.client.js#Cart$click">Click</button></main>',
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
        'Cart <button',
      );
      await expect(
        readFile(join(outDir, 'static/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cart = true;');
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
        version: 'kovo-neutral-build/v1',
      });
      expect(build).toMatchObject({
        clientModules: [{ href: '/c/__v/cart-v1/cart.client.js' }],
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

      const staticStyles = await readFile(join(outDir, 'static/assets/styles.css'), 'utf8');
      expect(staticStyles).toBe(builtStyles);
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
  const url = new URL(request.url);
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
      expect(nodeServer).toContain('function nodeRequestToWebRequest');
      expect(nodeServer).toContain('function responseHeadersToNodeHeaders');
      expect(nodeServer).toContain("nodeHeaders['set-cookie'] = setCookies");
      expect(nodeServer).toContain('nodeResponse.destroy()');
      expect(nodeServer).toContain('signal: controller.signal');

      const serverModule = (await import(pathToFileURL(join(nodeOutDir, 'server.mjs')).href)) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const baseUrl = await listen(server);

      try {
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
          'public, max-age=31536000, immutable',
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
        await close(server);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('emits a minimal Dockerfile for the node preset by default', async () => {
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

      await expect(readFile(join(nodeOutDir, 'Dockerfile'), 'utf8')).resolves.toContain(
        'CMD ["node", "server.mjs"]',
      );
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
      expect(vercelFunction).toContain('function nodeRequestToWebRequest');
      expect(vercelFunction).toContain('function responseHeadersToNodeHeaders');
      expect(vercelFunction).toContain("nodeHeaders['set-cookie'] = setCookies");
      expect(vercelFunction).toContain('nodeResponse.destroy()');
      expect(vercelFunction).toContain('signal: controller.signal');
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
            src: '/(?:assets|c)/(.*)',
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
      const server = createHttpServer(functionModule.default);
      const baseUrl = await listen(server);

      try {
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
            src: '/(?:assets|c)/(.*)',
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
            src: '/(?:assets|c)/(.*)',
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
        'env.ASSETS',
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

      const assetResponse = await workerModule.default.fetch(
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
      await expect(assetResponse.text()).resolves.toBe('export const asset = true;');
      expect(assetResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(assetResponse.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(assetResponse.headers.get('access-control-allow-origin')).toBeNull();
      expect(assetResponse.headers.get('vary')).toBeNull();
      expect(assetResponse.headers.get('set-cookie')).toBeNull();

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
});

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
    message: `The ${presetName} preset cannot prove the SPEC §14 deploy-skew retention floor for immutable /c/__v/... modules and prior-token /_q reads. Configure a serving layer that retains prior build artifacts and query-read support for at least 24 hours, or use a preset/adapter that declares that support.`,
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

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
