import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { guards } from './guards.js';
import { respond } from './response.js';
import { route } from './route.js';
import {
  exportStaticApp,
  formatStaticExportDiagnostic,
  formatStaticExportDiagnostics,
  isStaticExportDiagnostic,
  isStaticExportDiagnosticError,
  staticExportInventory,
  StaticExportError,
} from './static-export.js';

describe('server static export', () => {
  it('exports a simple route through the app request handler to an html artifact', async () => {
    const app = createApp({
      document: {
        template({ parts }) {
          return [
            '<!doctype html>',
            '<html>',
            `<head>${parts.head}</head>`,
            `<body data-export-shell>${parts.body}</body>`,
            '</html>',
          ].join('');
        },
      },
      routes: [
        route('/about', {
          meta: { title: 'About' },
          page: () => '<main>About Jiso</main>',
        }),
      ],
    });

    const result = await exportStaticApp(app);

    expect(result.clientModules).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      path: '/about/index.html',
      status: 200,
    });
    expect(result.artifacts[0]?.body).toContain('<title>About</title>');
    expect(result.artifacts[0]?.body).toContain('<body data-export-shell><main>About Jiso</main>');
  });

  it('uses the same handler and document assembly rather than a second render path', async () => {
    const app = createApp({
      renderRoute(value, context) {
        return `<main data-url="${new URL(context.request.url).pathname}">${String(value)}</main>`;
      },
      routes: [
        route('/', {
          page: () => 'from-page',
        }),
      ],
    });
    const handler = createRequestHandler(app);

    const exported = await exportStaticApp(app);
    const handled = await handler(new Request('https://jiso.local/'));

    expect(exported.artifacts[0]?.path).toBe('/index.html');
    expect(exported.clientModules).toEqual([]);
    await expect(handled.text()).resolves.toBe(exported.artifacts[0]?.body);
    expect(exported.artifacts[0]?.body).toContain('<main data-url="/">from-page</main>');
    expect(exported.artifacts[0]?.body).toContain('installInlineJisoLoader');
  });

  it('writes replayed html artifacts under the configured output directory', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        renderRoute(value, context) {
          return `<main data-route="${context.route.path}">${String(value)}</main>`;
        },
        routes: [
          route('/', {
            page: () => 'home',
          }),
          route('/docs/intro', {
            page: () => 'intro',
          }),
        ],
      });

      const result = await exportStaticApp(app, { outDir: pathToFileURL(outDir) });

      expect(result.clientModules).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
        '/index.html',
        '/docs/intro/index.html',
      ]);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toBe(
        result.artifacts[0]?.body,
      );
      await expect(
        readFile(path.join(outDir, 'docs', 'intro', 'index.html'), 'utf8'),
      ).resolves.toBe(result.artifacts[1]?.body);
      expect(result.artifacts[1]?.body).toContain('<main data-route="/docs/intro">intro</main>');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('can explicitly export legacy flat route document paths', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => '<main>Home</main>',
          }),
          route('/docs/intro', {
            page: () => '<main>Intro</main>',
          }),
        ],
      });

      const result = await exportStaticApp(app, { htmlPathStyle: 'flat', outDir });

      expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
        '/index.html',
        '/docs/intro.html',
      ]);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
        '<main>Home</main>',
      );
      await expect(readFile(path.join(outDir, 'docs', 'intro.html'), 'utf8')).resolves.toContain(
        '<main>Intro</main>',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects invalid html path styles before replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => '<main>Home</main>',
          }),
        ],
      });

      await expect(
        exportStaticApp(app, {
          htmlPathStyle: 'pretty' as unknown as 'flat',
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining("Expected 'flat' or 'directory'"),
            routePath: 'htmlPathStyle',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('copies configured static assets with exact bytes and represented headers', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-assets-'));
    try {
      const cssSource = path.join(sourceDir, 'app.css');
      const iconSource = path.join(sourceDir, 'icon.bin');
      const iconBytes = Buffer.from([0, 1, 2, 255]);
      await writeFile(cssSource, 'body { color: rebeccapurple; }\n', 'utf8');
      await writeFile(iconSource, iconBytes);
      const app = createApp({
        routes: [
          route('/', {
            stylesheets: ['/assets/app.css'],
            page: () => '<main>Home</main>',
          }),
        ],
      });

      const result = await exportStaticApp(app, {
        assets: [
          {
            contentType: 'text/css; charset=utf-8',
            path: '/assets/app.css',
            source: cssSource,
          },
          {
            headers: { 'cache-control': 'public, max-age=31536000' },
            path: '/assets/icons/icon.bin',
            source: pathToFileURL(iconSource),
          },
        ],
        outDir,
      });

      expect(result.assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/app.css',
          source: cssSource,
          status: 200,
        },
        {
          headers: { 'cache-control': 'public, max-age=31536000' },
          path: '/assets/icons/icon.bin',
          source: iconSource,
          status: 200,
        },
      ]);
      await expect(readFile(path.join(outDir, 'assets/app.css'), 'utf8')).resolves.toBe(
        'body { color: rebeccapurple; }\n',
      );
      await expect(readFile(path.join(outDir, 'assets/icons/icon.bin'))).resolves.toEqual(
        iconBytes,
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('returns configured static asset metadata without requiring an output directory', async () => {
    const app = createApp({
      routes: [
        route('/', {
          stylesheets: ['/assets/app.css'],
          page: () => '<main>Home</main>',
        }),
      ],
    });

    const result = await exportStaticApp(app, {
      assets: [
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/app.css',
          source: '/workspace/dist/assets/app.css',
        },
      ],
    });

    expect(result.assets).toEqual([
      {
        headers: { 'content-type': 'text/css; charset=utf-8' },
        path: '/assets/app.css',
        source: '/workspace/dist/assets/app.css',
        status: 200,
      },
    ]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/index.html']);
  });

  it('discovers referenced client modules without requiring an output directory', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "dry-run";',
      version: 'cart-dry-run',
    });
    const app = createApp({
      clientModules: registry,
      routes: [
        route('/cart', {
          page: () => `<main><button on:click="${cartHref}#Cart$add">Add</button></main>`,
        }),
      ],
    });

    const result = await exportStaticApp(app);

    expect(result.clientModules).toEqual([
      {
        body: 'export const cart = "dry-run";',
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': 'text/javascript; charset=utf-8',
        },
        href: `${cartHref}#Cart$add`,
        path: '/c/cart.client.js',
        status: 200,
      },
    ]);
  });

  it('summarizes dry-run route, client module, and asset inventory in write order', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "inventory";',
      version: 'cart-inventory',
    });
    const app = createApp({
      clientModules: registry,
      routes: [
        route('/', {
          modulepreloads: [cartHref],
          page: () => '<main>Home</main>',
        }),
      ],
    });

    const result = await exportStaticApp(app, {
      assets: [
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/app.css',
          source: '/workspace/dist/assets/app.css',
        },
      ],
    });

    expect(staticExportInventory(result)).toEqual([
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          link: `<${cartHref}>; rel=modulepreload`,
        },
        kind: 'route-document',
        path: '/index.html',
        status: 200,
      },
      {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': 'text/javascript; charset=utf-8',
        },
        href: cartHref,
        kind: 'client-module',
        path: '/c/cart.client.js',
        status: 200,
      },
      {
        headers: { 'content-type': 'text/css; charset=utf-8' },
        kind: 'static-asset',
        path: '/assets/app.css',
        source: '/workspace/dist/assets/app.css',
        status: 200,
      },
    ]);
  });

  it('formats static export diagnostics for starter and example export tasks', () => {
    const diagnostic = {
      code: 'FW229' as const,
      message: "FW229 static export cannot export guarded route '/admin'.\nServe dynamically.",
      routePath: '/admin',
    };
    const error = new StaticExportError([diagnostic]);

    expect(isStaticExportDiagnostic(diagnostic)).toBe(true);
    expect(isStaticExportDiagnostic({ ...diagnostic, message: 42 })).toBe(false);
    expect(isStaticExportDiagnosticError(error)).toBe(true);
    expect(isStaticExportDiagnosticError(new Error('plain'))).toBe(false);
    expect(formatStaticExportDiagnostic(diagnostic, 'ERROR')).toBe(
      "ERROR FW229 route=/admin FW229 static export cannot export guarded route '/admin'. Serve dynamically.",
    );
    expect(formatStaticExportDiagnostics([diagnostic], 'WARN')).toEqual([
      "WARN FW229 route=/admin FW229 static export cannot export guarded route '/admin'. Serve dynamically.",
    ]);
  });

  it('rejects duplicate static asset paths during dry-run inventory planning', async () => {
    const app = createApp({
      routes: [route('/', { page: () => '<main>Home</main>' })],
    });

    await expect(
      exportStaticApp(app, {
        assets: [
          { path: '/assets/app.css', source: '/workspace/dist/assets/app.css' },
          { path: '/assets/app.css', source: '/workspace/public/app.css' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "static asset '/assets/app.css' because it conflicts with static asset '/assets/app.css'",
          ),
          routePath: '/assets/app.css',
        },
      ],
    });
  });

  it('rejects unsafe static asset output paths before copying', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-assets-'));
    try {
      const source = path.join(sourceDir, 'app.css');
      await writeFile(source, 'body {}\n', 'utf8');
      const app = createApp({
        routes: [route('/', { page: () => '<main>Home</main>' })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [{ path: '/assets/%2e%2e/app.css', source }],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining('unsafe static asset path segment'),
            routePath: '%2e%2e',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects static asset output conflicts with generated export files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-assets-'));
    try {
      const source = path.join(sourceDir, 'index.html');
      await writeFile(source, '<p>asset</p>', 'utf8');
      const app = createApp({
        routes: [route('/', { page: () => '<main>Home</main>' })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [{ path: '/index.html', source }],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining(
              "static asset '/index.html' because it conflicts with route document '/index.html'",
            ),
            routePath: '/index.html',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects duplicate static asset output paths', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-assets-'));
    try {
      const firstSource = path.join(sourceDir, 'first.css');
      const secondSource = path.join(sourceDir, 'second.css');
      await writeFile(firstSource, 'body { color: red; }\n', 'utf8');
      await writeFile(secondSource, 'body { color: blue; }\n', 'utf8');
      const app = createApp({
        routes: [route('/', { page: () => '<main>Home</main>' })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [
            { path: '/assets/app.css', source: firstSource },
            { path: '/assets/app.css', source: secondSource },
          ],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining(
              "static asset '/assets/app.css' because it conflicts with static asset '/assets/app.css'",
            ),
            routePath: '/assets/app.css',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'assets/app.css'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects unreadable static asset sources before writing generated files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-assets-'));
    try {
      const missingSource = path.join(sourceDir, 'missing.css');
      const app = createApp({
        routes: [route('/', { page: () => '<main>Home</main>' })],
      });

      await expect(
        exportStaticApp(app, {
          assets: [{ path: '/assets/missing.css', source: missingSource }],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining('is not a readable file'),
            routePath: '/assets/missing.css',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'assets', 'missing.css'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('refuses error diagnostics before replaying or writing export files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => '<main>Home</main>',
          }),
        ],
      });

      await expect(
        exportStaticApp(app, {
          diagnostics: [
            {
              code: 'FW201',
              fileName: 'src/cart.tsx',
              help: 'Fixes: move the value into component/query state via ctx.',
              message: 'Closure captures unserializable value.',
              start: { column: 12, line: 4 },
            },
          ],
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW201',
        diagnostics: [
          {
            code: 'FW201',
            routePath: 'src/cart.tsx',
            message: expect.stringContaining('src/cart.tsx:4:12'),
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('does not block static export on lint diagnostics', async () => {
    const app = createApp({
      routes: [
        route('/', {
          page: () => '<main>Home</main>',
        }),
      ],
    });

    await expect(
      exportStaticApp(app, {
        diagnostics: [
          {
            code: 'FW210',
            fileName: 'src/cart.tsx',
            message: 'Anonymous handler; name it for stable identity.',
          },
        ],
      }),
    ).resolves.toMatchObject({
      artifacts: [{ path: '/index.html' }],
      diagnostics: [],
    });
  });

  it('copies referenced versioned client modules through the same handler bytes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const registry = createMemoryVersionedClientModuleRegistry();
      const cartHref = registry.put({
        path: '/c/cart.client.js',
        source: 'export const cart = "build-1";',
        version: 'cart-1',
      });
      const menuHref = registry.put({
        path: '/c/menu.client.js',
        source: 'export const menu = "build-1";',
        version: 'menu-1',
      });
      const app = createApp({
        clientModules: registry,
        routes: [
          route('/cart', {
            modulepreloads: [cartHref],
            page: () => `<main><button on:click="${menuHref}#Menu$open">Open menu</button></main>`,
          }),
        ],
      });
      const handler = createRequestHandler(app);

      const result = await exportStaticApp(app, { outDir });

      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        cartHref,
        `${menuHref}#Menu$open`,
      ]);
      expect(result.clientModules.map((artifact) => artifact.path)).toEqual([
        '/c/cart.client.js',
        '/c/menu.client.js',
      ]);

      const cartResponse = await handler(new Request(`https://jiso.local${cartHref}`));
      const menuResponse = await handler(new Request(`https://jiso.local${menuHref}`));
      await expect(readFile(path.join(outDir, 'c/cart.client.js'), 'utf8')).resolves.toBe(
        await cartResponse.text(),
      );
      await expect(readFile(path.join(outDir, 'c/menu.client.js'), 'utf8')).resolves.toBe(
        await menuResponse.text(),
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects referenced client modules that replay to non-JavaScript before writing files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        clientModules: {
          put() {
            throw new Error('unused');
          },
          resolve() {
            return {
              body: '<!doctype html><h1>Wrong handler</h1>',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status: 200,
            };
          },
        },
        routes: [
          route('/', {
            modulepreloads: ['/c/cart.client.js?v=cart-1'],
            page: () => '<main>Home</main>',
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining(
              "client module '/c/cart.client.js?v=cart-1' because the app handler returned status 200 with Content-Type 'text/html; charset=utf-8'",
            ),
            routePath: '/c/cart.client.js',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'c', 'cart.client.js'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('refuses unsafe client module output paths', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const badHref = '/c/%2Fescape.client.js?v=v1';
      const app = createApp({
        clientModules: {
          put() {
            throw new Error('unused');
          },
          resolve() {
            return {
              body: 'export const unsafe = true;',
              headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
              status: 200,
            };
          },
        },
        routes: [
          route('/unsafe', {
            modulepreloads: [badHref],
            page: () => '<main>Unsafe module path</main>',
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            message: expect.stringContaining('unsafe client module path segment'),
            routePath: '/c/%2Fescape.client.js',
          },
        ],
      });
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('fails loudly for guarded and session-provider routes', async () => {
    const guardedApp = createApp({
      routes: [
        route('/account', {
          guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
          page: () => '<main>Account</main>',
        }),
      ],
    });

    await expect(exportStaticApp(guardedApp)).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/account',
          message: expect.stringContaining('guarded route'),
        },
      ],
    });

    const sessionApp = createApp({
      routes: [route('/profile', { page: () => '<main>Profile</main>' })],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    await expect(exportStaticApp(sessionApp)).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/profile',
          message: expect.stringContaining('sessionProvider'),
        },
      ],
    });
  });

  it('exports param routes through explicit staticPaths metadata', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page(context) {
              const params = context.params as { id: string };
              return `<main data-product="${params.id}">Product ${params.id}</main>`;
            },
            staticPaths: ['/products/p1', '/products/p2/'],
          }),
        ],
      });

      const result = await exportStaticApp(app, { outDir });

      expect(result.diagnostics).toEqual([]);
      expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
        '/products/p1/index.html',
        '/products/p2/index.html',
      ]);
      await expect(
        readFile(path.join(outDir, 'products', 'p1', 'index.html'), 'utf8'),
      ).resolves.toContain('<main data-product="p1">Product p1</main>');
      await expect(
        readFile(path.join(outDir, 'products', 'p2', 'index.html'), 'utf8'),
      ).resolves.toContain('<main data-product="p2">Product p2</main>');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects invalid param route staticPaths before writing output', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page: () => '<main>Product</main>',
            staticPaths: [
              'products/p1',
              '/products/:id',
              '/collections/c1',
              '/products/p1?tab=details',
            ],
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
            routePath: '/products/:id',
            message: expect.stringContaining('absolute pathname without search or hash'),
          },
          {
            code: 'FW229',
            routePath: '/products/:id',
            message: expect.stringContaining('must be a concrete URL'),
          },
          {
            code: 'FW229',
            routePath: '/products/:id',
            message: expect.stringContaining('does not match param route'),
          },
          {
            code: 'FW229',
            routePath: '/products/:id',
            message: expect.stringContaining('absolute pathname without search or hash'),
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'products', 'p1', 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('fails or skips loudly for param routes without staticPaths metadata', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          page: () => '<main>Product</main>',
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toBeInstanceOf(StaticExportError);
    await expect(exportStaticApp(app)).rejects.toMatchObject({
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/products/:id',
          message: expect.stringContaining('staticPaths metadata'),
        },
      ],
    });

    await expect(exportStaticApp(app, { onNonExportable: 'skip' })).resolves.toEqual({
      artifacts: [],
      assets: [],
      clientModules: [],
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/products/:id',
          message: expect.stringContaining('staticPaths metadata'),
        },
      ],
    });
  });

  it('fails or skips loudly when replay proves a route is not an HTML document', async () => {
    const app = createApp({
      routes: [
        route('/', {
          page: () => '<main>Home</main>',
        }),
        route('/exports/orders.csv', {
          page: () =>
            respond.file('id,total\nord_1,42\n', {
              contentType: 'text/csv; charset=utf-8',
              filename: 'orders.csv',
            }),
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/exports/orders.csv',
          message: expect.stringContaining(
            "can only write successful HTML route documents; '/exports/orders.csv' returned status 200 with Content-Type 'text/csv; charset=utf-8'",
          ),
        },
      ],
    });

    await expect(exportStaticApp(app, { onNonExportable: 'skip' })).resolves.toMatchObject({
      artifacts: [{ path: '/index.html', status: 200 }],
      diagnostics: [
        {
          code: 'FW229',
          routePath: '/exports/orders.csv',
          message: expect.stringContaining('Content-Type'),
        },
      ],
    });
  });
});
