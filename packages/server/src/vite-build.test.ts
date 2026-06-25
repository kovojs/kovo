import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { compileComponentModule, type CompileResult } from '../../compiler/src/index.js';

import { createApp, createRequestHandler } from './app.js';
import { computeRenderPlanFingerprint } from './client-modules.js';
import { domain } from './domain.js';
import { renderedHtml } from './html.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';
import { staticExportManifest } from './static-export-result.js';
import {
  createKovoAppShellViteBuild,
  createKovoAppShellViteBuildFromManifestFile,
} from './vite-build.js';
import {
  kovoAppShellViteOutputDir,
  writeKovoAppShellViteBuildOutput,
} from './vite-build-output.js';
import {
  kovoAppShellViteClientModuleOutputPlan,
  writeKovoAppShellViteClientModuleOutput,
} from './vite-client-module-output.js';
import {
  exportKovoAppShellViteBuild,
  staticExportInventoryForKovoAppShellViteBuild,
} from './vite-static-export-build.js';
import {
  exportKovoAppShellViteBuildFromManifestFile,
  exportKovoAppShellViteBuildWithManifestFromManifestFile,
  staticExportInventoryForKovoAppShellViteBuildFromManifestFile,
  staticExportManifestForKovoAppShellViteBuildFromManifestFile,
} from './vite-static-export-manifest-file.js';
import {
  kovoAppShellViteBuildStaticExportAssets,
  kovoAppShellViteManifestFile,
  kovoAppShellViteStaticExportAssetsFromManifestFile,
} from './vite-build-assets.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const runtimeClientModuleInventoryItem = expect.objectContaining({
  href: expect.stringMatching(runtimeClientModulePath),
  kind: 'client-module',
  path: expect.stringMatching(runtimeClientModulePath),
  status: 200,
});
const runtimeClientModuleManifestItem = expect.objectContaining({
  href: expect.stringMatching(runtimeClientModulePath),
  path: expect.stringMatching(runtimeClientModulePath),
  status: 200,
});
const testRenderPlanFingerprint = computeRenderPlanFingerprint({
  test: 'field:id',
});

describe('server app shell Vite build seam', () => {
  it('wires route-entry hints, compiled modules, output files, and static export assets', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-seam-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-seam-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{display:grid}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cartAsset = true;');
      await writeFile(join(distDir, 'assets/catalog.json'), '{"items":2}');

      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml('<main class="cart">Cart</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const cartClient = true;',
            version: 'cartclient',
          },
        ],
        manifest: {
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        },
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      expect(build.routeHints).toEqual([
        {
          hints: {
            modulepreloads: ['/assets/cart.js'],
            stylesheets: ['/assets/cart.css'],
          },
          routePath: '/cart',
        },
      ]);

      const output = await writeKovoAppShellViteBuildOutput(build, {
        outDir: distDir,
        staticExport: {
          assets: [
            {
              contentType: 'application/json; charset=utf-8',
              path: '/assets/catalog.json',
              source: join(distDir, 'assets/catalog.json'),
            },
          ],
          outDir,
        },
      });
      expect(output.clientModuleOutputPlan).toEqual([
        {
          path: '/c/__v/cartclient/cart.client.js',
          targetPath: join(distDir, 'c/__v/cartclient/cart.client.js'),
        },
      ]);
      expect(output.staticExportAssets).toEqual([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/cart.css',
          source: join(distDir, 'assets/cart.css'),
        },
        {
          contentType: 'text/javascript; charset=utf-8',
          path: '/assets/cart.js',
          source: join(distDir, 'assets/cart.js'),
        },
        {
          contentType: 'application/json; charset=utf-8',
          path: '/assets/catalog.json',
          source: join(distDir, 'assets/catalog.json'),
        },
      ]);
      await expect(
        readFile(join(distDir, 'c/__v/cartclient/cart.client.js'), 'utf8'),
      ).resolves.toBe('export const cartClient = true;');

      const exported = output.staticExport;
      if (!exported) throw new Error('expected app-shell build output static export');
      expect(exported.artifacts[0]?.body).toMatch(
        /<link rel="stylesheet" href="\/assets\/cart\.css" integrity="sha384-[^"]+">/,
      );
      expect(exported.artifacts[0]?.body).toMatch(
        /<link rel="modulepreload" href="\/assets\/cart\.js" integrity="sha384-[^"]+">/,
      );
      await expect(readFile(join(outDir, 'cart/index.html'), 'utf8')).resolves.toContain(
        '<main class="cart">Cart</main>',
      );
      await expect(readFile(join(outDir, 'assets/cart.css'), 'utf8')).resolves.toBe(
        '.cart{display:grid}',
      );
      await expect(readFile(join(outDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cartAsset = true;',
      );
      await expect(readFile(join(outDir, 'assets/catalog.json'), 'utf8')).resolves.toBe(
        '{"items":2}',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('threads render-plan fingerprints into compiled module hrefs and document build tokens', async () => {
    const routePath = '/cart';
    const cartRoute = route(routePath, {
      modulepreloads: ['/c/cart.client.js?v=manual'],
      page() {
        return renderedHtml('<main>Cart</main>');
      },
    });
    const source = 'export const cartClient = true;';
    const shapeA = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    const shapeB = computeRenderPlanFingerprint({ cart: 'field:id,total' });

    const buildForShape = (renderPlanFingerprint: string) =>
      createKovoAppShellViteBuild({
        app: createApp({ routes: [cartRoute] }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            renderPlanFingerprint,
            source,
          },
        ],
      });

    const buildA = buildForShape(shapeA);
    const buildB = buildForShape(shapeB);
    const [moduleA] = buildA.clientModules;
    const [moduleB] = buildB.clientModules;
    if (!moduleA || !moduleB) throw new Error('expected compiled modules');

    expect(moduleA.source).toBe(moduleB.source);
    expect(moduleA.version).toContain(shapeA);
    expect(moduleB.version).toContain(shapeB);
    expect(moduleA.href).not.toBe(moduleB.href);

    const responseA = await createRequestHandler(buildA.app)(
      new Request(`https://example.test${routePath}`),
    );
    const responseB = await createRequestHandler(buildB.app)(
      new Request(`https://example.test${routePath}`),
    );
    const tokenA = (await responseA.text()).match(/<meta name="kovo-build" content="([^"]*)"/)?.[1];
    const tokenB = (await responseB.text()).match(/<meta name="kovo-build" content="([^"]*)"/)?.[1];

    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
    expect(buildA.app.clientModules.buildToken()).toBe(tokenA);
    expect(buildB.app.clientModules.buildToken()).toBe(tokenB);
  });

  it('moves all build-scoped tokens and hrefs when compiler render-plan shape changes but client bytes do not', async () => {
    const routePath = '/cart';
    const cartDomain = domain('cart');
    const source = `
import { component } from '@kovojs/core';

export const CartButton = component({
  queries: { cart: {} },
  render: () => <button>Add</button>,
});
`;
    const compileForShape = (
      queryShapes: NonNullable<Parameters<typeof compileComponentModule>[0]['queryShapes']>,
    ) =>
      compileComponentModule({
        fileName: 'components/cart/cart-button.tsx',
        queryShapes,
        source,
      });
    const compiledA = compileForShape({ cart: { count: 'number' } });
    const compiledB = compileForShape({ cart: { total: 'number' } });
    const clientA = compiledClientModule(compiledA);
    const clientB = compiledClientModule(compiledB);

    expect(compiledA.diagnostics).toEqual([]);
    expect(compiledB.diagnostics).toEqual([]);
    expect(clientA.source).toBe(clientB.source);
    expect(compiledA.renderPlanFingerprint).toBeTruthy();
    expect(compiledB.renderPlanFingerprint).toBeTruthy();
    expect(compiledA.renderPlanFingerprint).not.toBe(compiledB.renderPlanFingerprint);

    const buildForCompiled = (compiled: CompileResult, clientSource: string) => {
      let clientHref = '';
      const cartQuery = query('cart', {
        load: () => ({ count: 1, total: 100 }),
        reads: [cartDomain],
      });
      const addToCart = mutation('cart/add-token-proof', {
        csrf: false,
        input: s.object({ productId: s.string() }),
        registry: {
          queries: [cartQuery],
          touches: [cartDomain],
        },
        handler: (input) => input,
      });
      const build = createKovoAppShellViteBuild({
        app: createApp({
          mutations: [addToCart],
          queries: [cartQuery],
          routes: [
            route(routePath, {
              page() {
                return renderedHtml(
                  `<main><button on:click="${clientHref}#CartButton$click">Add</button></main>`,
                );
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/components/cart/cart-button.client.js',
            renderPlanFingerprint: requiredRenderPlanFingerprint(compiled),
            source: clientSource,
          },
        ],
      });
      const module = build.clientModules[0];
      if (!module) throw new Error('expected built client module');
      clientHref = module.href;

      return { build, clientHref };
    };

    const appA = buildForCompiled(compiledA, clientA.source);
    const appB = buildForCompiled(compiledB, clientB.source);
    const handlerA = createRequestHandler(appA.build.app);
    const handlerB = createRequestHandler(appB.build.app);
    const tokenA = appA.build.app.clientModules.buildToken();
    const tokenB = appB.build.app.clientModules.buildToken();

    expect(appA.clientHref).not.toBe(appB.clientHref);
    expect(tokenA).not.toBe(tokenB);

    const [documentA, documentB] = await Promise.all([
      handlerA(new Request(`https://example.test${routePath}`)),
      handlerB(new Request(`https://example.test${routePath}`)),
    ]);
    const [documentBodyA, documentBodyB] = await Promise.all([documentA.text(), documentB.text()]);
    expect(documentBodyA).toContain(`<meta name="kovo-build" content="${tokenA}">`);
    expect(documentBodyB).toContain(`<meta name="kovo-build" content="${tokenB}">`);
    expect(documentBodyA).toContain(appA.clientHref);
    expect(documentBodyB).toContain(appB.clientHref);

    const [queryA, queryB] = await Promise.all([
      handlerA(new Request('https://example.test/_q/cart')),
      handlerB(new Request('https://example.test/_q/cart')),
    ]);
    expect(queryA.headers.get('Kovo-Build')).toBe(tokenA);
    expect(queryB.headers.get('Kovo-Build')).toBe(tokenB);

    const mutationRequest = () =>
      new Request('https://example.test/_m/cart/add-token-proof', {
        body: JSON.stringify({ productId: 'p1' }),
        headers: {
          'Content-Type': 'application/json',
          'Kovo-Fragment': 'true',
          'Kovo-Targets': 'cart-summary=cart',
        },
        method: 'POST',
      });
    const [mutationA, mutationB] = await Promise.all([
      handlerA(mutationRequest()),
      handlerB(mutationRequest()),
    ]);
    expect(mutationA.status).toBe(200);
    expect(mutationB.status).toBe(200);
    expect(mutationA.headers.get('Kovo-Build')).toBe(tokenA);
    expect(mutationB.headers.get('Kovo-Build')).toBe(tokenB);
    await expect(mutationA.text()).resolves.toContain('<kovo-query name="cart"');
    await expect(mutationB.text()).resolves.toContain('<kovo-query name="cart"');

    const outDirA = await mkdtemp(join(tmpdir(), 'kovo-render-plan-shape-a-'));
    const outDirB = await mkdtemp(join(tmpdir(), 'kovo-render-plan-shape-b-'));
    try {
      const [exportA, exportB] = await Promise.all([
        exportKovoAppShellViteBuild(appA.build, { distDir: outDirA }),
        exportKovoAppShellViteBuild(appB.build, { distDir: outDirB }),
      ]);
      expect(exportA.artifacts[0]?.body).toContain(`<meta name="kovo-build" content="${tokenA}">`);
      expect(exportB.artifacts[0]?.body).toContain(`<meta name="kovo-build" content="${tokenB}">`);
      expect(exportA.artifacts[0]?.body).toContain(appA.clientHref);
      expect(exportB.artifacts[0]?.body).toContain(appB.clientHref);
    } finally {
      await Promise.all([
        rm(outDirA, { force: true, recursive: true }),
        rm(outDirB, { force: true, recursive: true }),
      ]);
    }
  });

  it('rejects compiled client modules without a render-plan fingerprint', () => {
    expect(() =>
      createKovoAppShellViteBuild({
        app: createApp({ routes: [] }),
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cartClient = true;',
          },
        ],
      }),
    ).toThrow(/missing renderPlanFingerprint.*SPEC §5\.2\.1/);
  });

  it('requires an app when Vite build output is asked to run static export', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-static-export-dist-'));

    try {
      await expect(
        writeKovoAppShellViteBuildOutput(
          {
            clientModules: [],
          },
          { outDir: distDir, staticExport: {} },
        ),
      ).rejects.toThrow('App shell Vite build output static export requires a Kovo app.');
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('rejects partial app-shell compatibility shells before Vite build wiring', () => {
    expect(() =>
      createKovoAppShellViteBuild({
        app: { routes: [] } as unknown as Parameters<typeof createKovoAppShellViteBuild>[0]['app'],
        clientModules: [
          {
            path: '/c/cart.client.js',
            source: 'export const cartClient = true;',
          },
        ],
      }),
    ).toThrow(
      'createKovoAppShellViteBuild() requires a Kovo app aggregate. SPEC §9.5 Vite build/export replay must start from createApp(), not a raw request handler or compatibility shell.',
    );
  });

  it('does not emit Vite app-shell client modules when plugin-time static export is rejected', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-reject-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-reject-export-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/admin', {
              guard: () => true,
              page() {
                return renderedHtml('<main>Admin</main>');
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/admin.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const admin = true;',
            version: 'admin-v1',
          },
        ],
      });

      await expect(
        writeKovoAppShellViteBuildOutput(build, {
          outDir: distDir,
          staticExport: { outDir },
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining("cannot export guarded route '/admin'"),
            routePath: '/admin',
          },
        ],
      });
      await expect(readFile(join(distDir, 'c/admin.client.js'))).rejects.toThrow();
      await expect(readFile(join(outDir, 'admin/index.html'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('preflights Vite client-module output before plugin-time static export writes', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-preflight-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-preflight-export-'));

    try {
      await writeFile(join(distDir, 'c'), 'blocked parent');

      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml(
                  [
                    '<main>Cart',
                    '<button on:click="/c/cart.client.js?v=cart-v1#Cart$add">Add</button>',
                    '</main>',
                  ].join(''),
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
      });

      await expect(
        writeKovoAppShellViteBuildOutput(build, {
          outDir: distDir,
          staticExport: { outDir },
        }),
      ).rejects.toThrow(
        `App shell Vite build output cannot write client module because parent '${join(
          distDir,
          'c',
        )}' is not a directory.`,
      );
      await expect(readFile(join(outDir, 'cart/index.html'))).rejects.toThrow();
      await expect(readFile(join(outDir, 'c/cart.client.js'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('validates Vite app-shell client module targets before committing staged output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-target-dist-'));

    try {
      await mkdir(join(distDir, 'c', 'blocked.client.js'), { recursive: true });

      await expect(
        writeKovoAppShellViteClientModuleOutput(distDir, [
          {
            file: 'c/ok.client.js',
            href: '/c/ok.client.js?v=ok',
            path: '/c/ok.client.js',
            source: 'export const ok = true;',
            version: 'ok',
          },
          {
            file: 'c/blocked.client.js',
            href: '/c/blocked.client.js?v=blocked',
            path: '/c/blocked.client.js',
            source: 'export const blocked = true;',
            version: 'blocked',
          },
        ]),
      ).rejects.toThrow(/target '.*blocked\.client\.js' is a directory/);
      await expect(readFile(join(distDir, 'c/ok.client.js'))).rejects.toThrow();
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('plans Vite app-shell client module output through the write helper boundary', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-client-module-plan-dist-'));

    try {
      expect(
        kovoAppShellViteClientModuleOutputPlan(distDir, [
          {
            file: 'c/search.client.js',
            href: '/c/search.client.js?v=search-v1',
            path: '/c/search.client.js',
            source: 'export const search = true;',
            version: 'search-v1',
          },
        ]),
      ).toEqual([
        {
          path: '/c/search.client.js',
          targetPath: join(distDir, 'c/search.client.js'),
        },
      ]);
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('returns Vite build-backed static export inventory without writing output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-inventory-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-inventory-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/shop.css'), '.shop{color:green}');
      await writeFile(join(distDir, 'assets/shop.js'), 'export const shopAsset = true;');

      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/shop', {
              page() {
                return renderedHtml(
                  [
                    '<main class="shop">Shop',
                    '<button on:click="/c/shop.client.js?v=shopclient#Shop$add">Add</button>',
                    '</main>',
                  ].join(''),
                );
              },
            }),
          ],
        }),
        clientModules: [
          {
            path: '/c/shop.client.js',
            renderPlanFingerprint: testRenderPlanFingerprint,
            source: 'export const shopClient = true;',
            version: 'shopclient',
          },
        ],
        manifest: {
          'src/shop.client.ts': {
            css: ['assets/shop.css'],
            file: 'assets/shop.js',
          },
        },
        routeEntryMap: {
          '/shop': 'src/shop.client.ts',
        },
      });

      const inventory = await staticExportInventoryForKovoAppShellViteBuild(build, {
        distDir,
      });

      expect(inventory).toEqual([
        {
          headers: {
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'sha256-zOxaGi2tH4BAw0NScAj/WNUTb87gArEmBY868nVHP9g='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
            'content-type': 'text/html; charset=utf-8',
            link: '</assets/shop.css>; rel=preload; as=style, </assets/shop.js>; rel=modulepreload',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
          },
          kind: 'route-document',
          path: '/shop/index.html',
          status: 200,
        },
        {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: '/c/shop.client.js?v=shopclient#Shop$add',
          kind: 'client-module',
          path: '/c/shop.client.js',
          status: 200,
        },
        runtimeClientModuleInventoryItem,
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/shop.css',
          source: join(distDir, 'assets/shop.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/shop.js',
          source: join(distDir, 'assets/shop.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'shop/index.html'))).rejects.toThrow();
      await expect(readFile(join(outDir, 'assets/shop.css'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('exports from a manifest file with the matching dry-run manifest for consumers', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-result-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-result-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/cart.css'), '.cart{display:flex}');
      await writeFile(join(distDir, 'assets/cart.js'), 'export const cart = "dist";');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        }),
      );

      const { manifest, result } = await exportKovoAppShellViteBuildWithManifestFromManifestFile({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml('<main class="cart">Cart</main>');
              },
            }),
          ],
        }),
        distDir,
        outDir,
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      expect(manifest).toEqual(staticExportManifest(result));
      expect(manifest.routeDocuments.map((artifact) => artifact.path)).toEqual([
        '/cart/index.html',
      ]);
      expect(manifest.assets.map((artifact) => artifact.path)).toEqual([
        '/assets/cart.css',
        '/assets/cart.js',
      ]);
      await expect(readFile(join(outDir, 'cart', 'index.html'), 'utf8')).resolves.toMatch(
        /<link rel="stylesheet" href="\/assets\/cart\.css" integrity="sha384-[^"]+">/,
      );
      await expect(readFile(join(outDir, 'assets/cart.js'), 'utf8')).resolves.toBe(
        'export const cart = "dist";',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('rejects non-file Vite manifest URLs before manifest-backed build wiring', async () => {
    await expect(
      createKovoAppShellViteBuildFromManifestFile({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml('<main>Cart</main>');
              },
            }),
          ],
        }),
        manifestFile: new URL('https://cdn.example.test/.vite/manifest.json'),
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            'Vite app-shell manifest files must be filesystem paths or file: URLs',
          ),
          routePath: 'vite-manifestFile',
        },
      ],
    });
  });

  it('keeps Vite output path selection and writes inside the build output directory', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-output-boundary-dist-'));

    try {
      expect(kovoAppShellViteOutputDir({ dir: join(distDir, 'client') })).toBe(
        join(distDir, 'client'),
      );
      expect(kovoAppShellViteOutputDir({ file: join(distDir, 'server/app-shell.js') })).toBe(
        join(distDir, 'server'),
      );
      expect(() => kovoAppShellViteOutputDir({})).toThrow(
        'App shell Vite build output requires output.dir or output.file.',
      );

      await expect(
        writeKovoAppShellViteClientModuleOutput(distDir, [
          {
            file: '../escape.js',
            href: '/c/escape.js?v=escape',
            path: '/c/escape.js',
            source: 'export const escape = true;',
            version: 'escape',
          },
        ]),
      ).rejects.toThrow(
        'App shell build asset must stay within the Vite output directory: ../escape.js',
      );
      await expect(readFile(join(distDir, '../escape.js'))).rejects.toThrow();
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('exports Vite build param routes from staticPaths with manifest assets', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-param-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-param-export-'));

    try {
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/product.css'), '.product{color:green}');
      await writeFile(join(distDir, 'assets/product.js'), 'export const productAsset = true;');

      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/products/:id', {
              page(context) {
                const params = context.params as { id: string };
                return renderedHtml(`<main class="product">Product ${params.id}</main>`);
              },
              staticPaths: ['/products/p1', '/products/p2'],
            }),
          ],
        }),
        manifest: {
          'src/product.client.ts': {
            css: ['assets/product.css'],
            file: 'assets/product.js',
          },
        },
        routeEntryMap: {
          '/products/:id': 'src/product.client.ts',
        },
      });

      const exported = await exportKovoAppShellViteBuild(build, { distDir, outDir });

      expect(exported.artifacts.map((artifact) => artifact.path)).toEqual([
        '/products/p1/index.html',
        '/products/p2/index.html',
      ]);
      expect(exported.diagnostics).toEqual([]);
      await expect(readFile(join(outDir, 'products/p1/index.html'), 'utf8')).resolves.toContain(
        '<main class="product">Product p1</main>',
      );
      await expect(readFile(join(outDir, 'products/p2/index.html'), 'utf8')).resolves.toMatch(
        /<link rel="stylesheet" href="\/assets\/product\.css" integrity="sha384-[^"]+">/,
      );
      await expect(readFile(join(outDir, 'assets/product.css'), 'utf8')).resolves.toBe(
        '.product{color:green}',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns Vite build static export assets without exposing build internals', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-assets-dist-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml('<main>Cart</main>');
              },
            }),
          ],
        }),
        manifest: {
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        },
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      expect(
        kovoAppShellViteBuildStaticExportAssets(build, {
          assets: [
            {
              headers: { 'cache-control': 'public, max-age=60' },
              path: '/robots.txt',
              source: join(distDir, 'public/robots.txt'),
            },
          ],
          distDir,
        }),
      ).toEqual([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/cart.css',
          source: join(distDir, 'assets/cart.css'),
        },
        {
          contentType: 'text/javascript; charset=utf-8',
          path: '/assets/cart.js',
          source: join(distDir, 'assets/cart.js'),
        },
        {
          headers: { 'cache-control': 'public, max-age=60' },
          path: '/robots.txt',
          source: join(distDir, 'public/robots.txt'),
        },
      ]);
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('rejects manifest and caller asset collisions during Vite export inventory planning', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-asset-collision-dist-'));

    try {
      const build = createKovoAppShellViteBuild({
        app: createApp({
          routes: [
            route('/cart', {
              page() {
                return renderedHtml('<main>Cart</main>');
              },
            }),
          ],
        }),
        manifest: {
          'src/cart.client.ts': {
            css: ['assets/cart.css'],
            file: 'assets/cart.js',
          },
        },
        routeEntryMap: {
          '/cart': 'src/cart.client.ts',
        },
      });

      await expect(
        staticExportInventoryForKovoAppShellViteBuild(build, {
          assets: [
            {
              path: '/assets/cart.css',
              source: join(distDir, 'public/cart.css'),
            },
          ],
          distDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              "static asset '/assets/cart.css' because it conflicts with static asset '/assets/cart.css'",
            ),
            routePath: '/assets/cart.css',
          },
        ],
      });
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });

  it('returns manifest-file backed static export inventory without writing output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-inventory-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-inventory-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/catalog.css'), '.catalog{display:block}');
      await writeFile(
        join(distDir, '.vite/manifest.json'),
        JSON.stringify({
          'src/catalog.client.ts': {
            css: ['assets/catalog.css'],
            file: 'assets/catalog.js',
          },
        }),
      );

      const inventory = await staticExportInventoryForKovoAppShellViteBuildFromManifestFile({
        app: createApp({
          routes: [
            route('/catalog', {
              page() {
                return renderedHtml('<main class="catalog">Catalog</main>');
              },
            }),
          ],
        }),
        distDir,
        routeEntryMap: {
          '/catalog': 'src/catalog.client.ts',
        },
      });

      expect(inventory).toEqual([
        {
          headers: {
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'sha256-zOxaGi2tH4BAw0NScAj/WNUTb87gArEmBY868nVHP9g='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
            'content-type': 'text/html; charset=utf-8',
            link: '</assets/catalog.css>; rel=preload; as=style, </assets/catalog.js>; rel=modulepreload',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
          },
          kind: 'route-document',
          path: '/catalog/index.html',
          status: 200,
        },
        runtimeClientModuleInventoryItem,
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/catalog.css',
          source: join(distDir, 'assets/catalog.css'),
          status: 200,
        },
        {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/catalog.js',
          source: join(distDir, 'assets/catalog.js'),
          status: 200,
        },
      ]);
      await expect(readFile(join(outDir, 'catalog/index.html'))).rejects.toThrow();
      await expect(readFile(join(outDir, 'assets/catalog.css'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns manifest-file backed static export manifests matching write export output', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-proof-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-proof-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/docs.css'), '.docs{display:grid}');
      await writeFile(join(distDir, 'assets/docs.js'), 'export const docs = true;');
      await writeFile(
        kovoAppShellViteManifestFile(distDir),
        JSON.stringify({
          'src/docs.client.ts': {
            css: ['assets/docs.css'],
            file: 'assets/docs.js',
          },
        }),
      );

      const app = createApp({
        routes: [
          route('/docs/intro', {
            modulepreloads: ['/c/docs.client.js?v=docs-v1'],
            page() {
              return renderedHtml('<main class="docs">Intro</main>');
            },
          }),
        ],
      });
      const clientModules = [
        {
          path: '/c/docs.client.js',
          renderPlanFingerprint: testRenderPlanFingerprint,
          source: 'export const docsClient = true;',
          version: 'docs-v1',
        },
      ];
      const routeEntryMap = {
        '/docs/intro': 'src/docs.client.ts',
      };

      const dryRunManifest = await staticExportManifestForKovoAppShellViteBuildFromManifestFile({
        app,
        clientModules,
        distDir,
        routeEntryMap,
      });
      const written = await exportKovoAppShellViteBuildFromManifestFile({
        app,
        clientModules,
        distDir,
        outDir,
        routeEntryMap,
      });

      expect(dryRunManifest).toEqual({
        assets: [
          {
            headers: { 'content-type': 'text/css; charset=utf-8' },
            path: '/assets/docs.css',
            source: join(distDir, 'assets/docs.css'),
            status: 200,
          },
          {
            headers: { 'content-type': 'text/javascript; charset=utf-8' },
            path: '/assets/docs.js',
            source: join(distDir, 'assets/docs.js'),
            status: 200,
          },
        ],
        clientModules: [
          {
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'content-type': 'text/javascript; charset=utf-8',
            },
            href: '/c/docs.client.js?v=docs-v1',
            path: '/c/docs.client.js',
            status: 200,
          },
          runtimeClientModuleManifestItem,
        ],
        files: [
          {
            headers: {
              'content-security-policy':
                "default-src 'self'; script-src 'self' 'sha256-zOxaGi2tH4BAw0NScAj/WNUTb87gArEmBY868nVHP9g='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
              'content-type': 'text/html; charset=utf-8',
              link: '</assets/docs.css>; rel=preload; as=style, </c/docs.client.js?v=docs-v1>; rel=modulepreload, </assets/docs.js>; rel=modulepreload',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'x-frame-options': 'DENY',
              'x-content-type-options': 'nosniff',
            },
            kind: 'route-document',
            path: '/docs/intro/index.html',
            status: 200,
          },
          {
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'content-type': 'text/javascript; charset=utf-8',
            },
            href: '/c/docs.client.js?v=docs-v1',
            kind: 'client-module',
            path: '/c/docs.client.js',
            status: 200,
          },
          runtimeClientModuleInventoryItem,
          {
            headers: { 'content-type': 'text/css; charset=utf-8' },
            kind: 'static-asset',
            path: '/assets/docs.css',
            source: join(distDir, 'assets/docs.css'),
            status: 200,
          },
          {
            headers: { 'content-type': 'text/javascript; charset=utf-8' },
            kind: 'static-asset',
            path: '/assets/docs.js',
            source: join(distDir, 'assets/docs.js'),
            status: 200,
          },
        ],
        routeDocuments: [
          {
            headers: {
              'content-security-policy':
                "default-src 'self'; script-src 'self' 'sha256-zOxaGi2tH4BAw0NScAj/WNUTb87gArEmBY868nVHP9g='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
              'content-type': 'text/html; charset=utf-8',
              link: '</assets/docs.css>; rel=preload; as=style, </c/docs.client.js?v=docs-v1>; rel=modulepreload, </assets/docs.js>; rel=modulepreload',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'x-frame-options': 'DENY',
              'x-content-type-options': 'nosniff',
            },
            path: '/docs/intro/index.html',
            status: 200,
          },
        ],
      });
      expect(dryRunManifest.files).toEqual(staticExportManifest(written).files);
      await expect(readFile(join(outDir, 'docs/intro/index.html'), 'utf8')).resolves.toMatch(
        /<link rel="stylesheet" href="\/assets\/docs\.css" integrity="sha384-[^"]+">/,
      );
      await expect(readFile(join(outDir, 'c/docs.client.js'), 'utf8')).resolves.toBe(
        'export const docsClient = true;',
      );
      await expect(readFile(join(outDir, 'assets/docs.css'), 'utf8')).resolves.toBe(
        '.docs{display:grid}',
      );
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('returns manifest-file static export assets for task wiring', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-assets-dist-'));
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-manifest-assets-export-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      await mkdir(join(distDir, 'assets'), { recursive: true });
      await writeFile(join(distDir, 'assets/catalog.css'), '.catalog{color:blue}');
      await writeFile(join(distDir, 'assets/catalog.js'), 'export const catalog = true;');
      await writeFile(
        kovoAppShellViteManifestFile(distDir),
        JSON.stringify({
          'src/catalog.client.ts': {
            css: ['assets/catalog.css'],
            file: 'assets/catalog.js',
          },
        }),
      );

      await expect(
        kovoAppShellViteStaticExportAssetsFromManifestFile({
          base: '/shop/',
          distDir,
        }),
      ).resolves.toEqual([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/shop/assets/catalog.css',
          source: join(distDir, 'assets/catalog.css'),
        },
        {
          contentType: 'text/javascript; charset=utf-8',
          path: '/shop/assets/catalog.js',
          source: join(distDir, 'assets/catalog.js'),
        },
      ]);
      await expect(readFile(join(outDir, 'assets/catalog.css'))).rejects.toThrow();
    } finally {
      await Promise.all([
        rm(distDir, { force: true, recursive: true }),
        rm(outDir, { force: true, recursive: true }),
      ]);
    }
  });

  it('rejects non-file Vite distDir URLs before static asset planning', async () => {
    const distDir = await mkdtemp(join(tmpdir(), 'kovo-vite-build-bad-dist-url-'));

    try {
      await mkdir(join(distDir, '.vite'), { recursive: true });
      const manifestFile = kovoAppShellViteManifestFile(distDir);
      await writeFile(
        manifestFile,
        JSON.stringify({
          'src/catalog.client.ts': {
            css: ['assets/catalog.css'],
            file: 'assets/catalog.js',
          },
        }),
      );

      await expect(
        kovoAppShellViteStaticExportAssetsFromManifestFile({
          distDir: new URL('https://cdn.example/dist/'),
          manifestFile,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              'Vite app-shell filesystem roots must be filesystem paths or file: URLs',
            ),
            routePath: 'vite-distDir',
          },
        ],
      });
    } finally {
      await rm(distDir, { force: true, recursive: true });
    }
  });
});

function compiledClientModule(result: CompileResult): { source: string } {
  const file = result.files.find((candidate) => candidate.kind === 'client');
  if (!file) throw new Error('expected compiler-emitted client module');
  return { source: file.source };
}

function requiredRenderPlanFingerprint(result: CompileResult): string {
  if (!result.renderPlanFingerprint) throw new Error('expected compiler render-plan fingerprint');
  return result.renderPlanFingerprint;
}
