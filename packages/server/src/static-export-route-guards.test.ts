import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { redirect } from '@kovojs/core';

import { publicAccess } from './access.js';
import { createApp } from './app.js';
import { guards } from './guards.js';
import { respond } from './response.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import { StaticExportError } from './static-export-diagnostics.js';
import { renderedHtml } from './html.js';

const requireFromTest = createRequire(import.meta.url);

describe('server static export', () => {
  it('rejects raw request handlers before static export replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    const rawHandler = async () => new Response('<main>compat</main>');

    try {
      await expect(
        exportStaticApp(rawHandler as unknown as Parameters<typeof exportStaticApp>[0], {
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('SPEC §9.5 export replay must start from createApp()'),
            routePath: 'app',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects stale html path-style options before replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    let rendered = false;
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => {
              rendered = true;
              return renderedHtml('<main>Home</main>');
            },
          }),
        ],
      });

      await expect(
        exportStaticApp(app, {
          htmlPathStyle: 'flat',
          outDir,
        } as Parameters<typeof exportStaticApp>[1]),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              'SPEC §9.5 exports route documents as directory-index HTML',
            ),
            routePath: 'htmlPathStyle',
          },
        ],
      });
      expect(rendered).toBe(false);
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects non-file URL output directories before replay', async () => {
    let rendered = false;
    const app = createApp({
      routes: [
        route('/', {
          page: () => {
            rendered = true;
            return renderedHtml('<main>Home</main>');
          },
        }),
      ],
    });

    await expect(
      exportStaticApp(app, {
        outDir: new URL('https://static.example.test/export/'),
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            'SPEC §9.5 static export output directories must be filesystem paths or file: URLs',
          ),
          routePath: 'outDir',
        },
      ],
    });
    expect(rendered).toBe(false);
  });

  it('does not let late path resolution redirect the static-export output root', async () => {
    // SPEC §6.6/§9.5 / C172: the root validated before replay is the only destination authority;
    // authored code cannot make target planning resolve that same carrier a second way.
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-root-safe-'));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-root-outside-'));
    const nodePath = requireFromTest('node:path') as typeof import('node:path');
    const originalResolve = nodePath.resolve;
    let poisonHits = 0;

    try {
      const app = createApp({
        routes: [
          route('/', {
            page() {
              nodePath.resolve = function (...paths: string[]) {
                if (
                  paths.length === 1 &&
                  paths[0] === outDir &&
                  new Error().stack?.includes('staticExportOutputRoot')
                ) {
                  poisonHits += 1;
                  return outsideDir;
                }
                return Reflect.apply(originalResolve, nodePath, paths);
              };
              syncBuiltinESMExports();
              return renderedHtml('<main>safe-root</main>');
            },
          }),
        ],
      });

      await exportStaticApp(app, { outDir });

      await expect(readFile(path.join(outsideDir, 'index.html'))).rejects.toThrow();
      expect(poisonHits).toBe(0);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
        'safe-root',
      );
    } finally {
      nodePath.resolve = originalResolve;
      syncBuiltinESMExports();
      await rm(outDir, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });

  it('rejects invalid static export origins before replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    let rendered = false;
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => {
              rendered = true;
              return renderedHtml('<main>Home</main>');
            },
          }),
        ],
      });

      await expect(
        exportStaticApp(app, {
          origin: 'https://docs.example.test/base',
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('SPEC §9.5 synthetic replay origin'),
            routePath: 'origin',
          },
        ],
      });
      expect(rendered).toBe(false);
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects canonical route-table ambiguities before static replay', async () => {
    let replayed = false;
    const app = createApp({
      routes: [
        route('/docs/intro', {
          page: () => {
            replayed = true;
            return renderedHtml('<main>Intro</main>');
          },
        }),
        route('/docs/intro/', {
          page: () => trustedHtml('<main>Duplicate intro</main>'),
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toMatchObject({
      code: 'KV228',
      diagnostics: [
        {
          code: 'KV228',
          message: expect.stringContaining(
            "'/docs/intro' and '/docs/intro' can both match canonical request path '/docs/intro'",
          ),
          routePath: '/docs/intro <-> /docs/intro',
        },
      ],
    });
    expect(replayed).toBe(false);
  });

  it('fails closed when a static export route returns redirect()', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/old-home', {
            page: () => redirect('/new-home' as never, {} as never),
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining('replay returned redirect status 303'),
            routePath: '/old-home',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'old-home', 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('never publishes respond.file bytes as an HTML route document after header replacement', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-file-headers-'));
    const originalGet = Headers.prototype.get;
    try {
      const app = createApp({
        routes: [
          route('/private-report', {
            page() {
              Headers.prototype.get = function (name) {
                const normalized = String(name).toLowerCase();
                if (normalized === 'content-disposition') return null;
                if (normalized === 'content-type') return 'text/html; charset=utf-8';
                return Reflect.apply(originalGet, this, [name]);
              };
              return respond.file('DATABASE_PASSWORD=prod-only-secret', {
                contentType: 'text/plain; charset=utf-8',
                filename: 'private-report.txt',
              });
            },
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          expect.objectContaining({
            message: expect.stringContaining('file/stream response'),
            routePath: '/private-report',
          }),
        ],
      });
      await expect(
        readFile(path.join(outDir, 'private-report', 'index.html'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      Headers.prototype.get = originalGet;
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('keeps encoded server endpoint markers blocking after protocol intrinsic replacement', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-protocol-pin-'));
    const originalReplace = String.prototype.replace;
    const originalSetHas = Set.prototype.has;
    try {
      const app = createApp({
        routes: [
          route('/account', {
            page() {
              String.prototype.replace = function (searchValue, replaceValue) {
                const text = String(this);
                if (text.indexOf('&#47;_m') !== -1) return text;
                return Reflect.apply(originalReplace, this, [searchValue, replaceValue]);
              } as typeof String.prototype.replace;
              Set.prototype.has = function (value) {
                if (value === 'action') return false;
                return Reflect.apply(originalSetHas, this, [value]);
              };
              return trustedHtml(
                '<main><form action="&#47;_m&#47;account&#47;delete"><button>Delete</button></form></main>',
              );
            },
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          expect.objectContaining({
            message: expect.stringContaining("server mutation endpoint '/_m/account/delete'"),
            routePath: '/account',
          }),
        ],
      });
      await expect(readFile(path.join(outDir, 'account', 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      String.prototype.replace = originalReplace;
      Set.prototype.has = originalSetHas;
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('fails loudly for guarded and session-provider routes', async () => {
    const guardedApp = createApp({
      routes: [
        route('/account', {
          guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
          page: () => trustedHtml('<main>Account</main>'),
        }),
      ],
    });

    await expect(exportStaticApp(guardedApp)).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          routePath: '/account',
          message: expect.stringContaining('guarded route'),
        },
      ],
    });

    const sessionApp = createApp({
      routes: [route('/profile', { page: () => trustedHtml('<main>Profile</main>') })],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    await expect(exportStaticApp(sessionApp)).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          routePath: '/profile',
          message: expect.stringContaining('sessionProvider'),
        },
      ],
    });
  });

  it('pins guarded route planning before replay despite selective route iteration', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-route-snapshot-'));
    const app = createApp({
      routes: [
        route('/account', {
          guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
          page(_context, request) {
            const userId = (request as { session?: { user?: { id: string } } }).session?.user?.id;
            return trustedHtml(`<main>${userId ?? 'anonymous'}:server-only-account-token</main>`);
          },
        }),
      ],
      sessionProvider: () => ({ user: { id: 'victim' } }),
    });
    const routes = app.routes;
    const publicClone = {
      ...routes[0]!,
      access: publicAccess('iterator attempted to downgrade guarded route'),
      guard: undefined,
    };
    const originalIterator = Array.prototype[Symbol.iterator];

    try {
      Array.prototype[Symbol.iterator] = function () {
        if (this === routes) return Reflect.apply(originalIterator, [publicClone], []);
        return Reflect.apply(originalIterator, this, []);
      } as (typeof Array.prototype)[Symbol.iterator];

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          expect.objectContaining({
            message: expect.stringContaining('session-independent'),
            routePath: '/account',
          }),
        ],
      });
      await expect(readFile(path.join(outDir, 'account', 'index.html'), 'utf8')).rejects.toThrow();
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('exports explicitly public routes from an app with a session provider', async () => {
    const app = createApp({
      routes: [
        route('/login', {
          access: publicAccess('public login shell'),
          page: () => trustedHtml('<main>Login</main>'),
        }),
      ],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    await expect(exportStaticApp(app)).resolves.toMatchObject({
      artifacts: [{ path: '/login/index.html' }],
    });
  });

  it('exports param routes through explicit staticPaths metadata', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page(context) {
              const params = context.params as { id: string };
              return renderedHtml(`<main data-product="${params.id}">Product ${params.id}</main>`);
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
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page: () => trustedHtml('<main>Product</main>'),
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
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            routePath: '/products/:id',
            message: expect.stringContaining('absolute pathname without search or hash'),
          },
          {
            code: 'KV229',
            routePath: '/products/:id',
            message: expect.stringContaining('must be a concrete URL'),
          },
          {
            code: 'KV229',
            routePath: '/products/:id',
            message: expect.stringContaining('does not match param route'),
          },
          {
            code: 'KV229',
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

  it('rejects static-host-unsafe route document targets before replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    let rendered = false;
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page: () => {
              rendered = true;
              return renderedHtml('<main>Product</main>');
            },
            staticPaths: ['/products/%2f'],
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            routePath: '/products/:id',
            message: expect.stringContaining('unsafe URL path segment'),
          },
        ],
      });
      expect(rendered).toBe(false);
      await expect(readFile(path.join(outDir, 'products', '%2f', 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('fails or skips loudly for param routes without staticPaths metadata', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          page: () => trustedHtml('<main>Product</main>'),
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toBeInstanceOf(StaticExportError);
    await expect(exportStaticApp(app)).rejects.toMatchObject({
      diagnostics: [
        {
          code: 'KV229',
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
          code: 'KV229',
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
          page: () => trustedHtml('<main>Home</main>'),
        }),
        route('/downloads/orders.pdf', {
          page: () =>
            respond.file('%PDF-1.7\n', {
              contentType: 'application/pdf',
              filename: 'orders.pdf',
            }),
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          routePath: '/downloads/orders.pdf',
          message: expect.stringContaining(
            "replay returned a file/stream response with Content-Disposition 'attachment; filename=\"orders.pdf\"' and Content-Type 'application/pdf'",
          ),
        },
      ],
    });

    await expect(exportStaticApp(app, { onNonExportable: 'skip' })).resolves.toMatchObject({
      artifacts: [{ path: '/index.html', status: 200 }],
      diagnostics: [
        {
          code: 'KV229',
          routePath: '/downloads/orders.pdf',
          message: expect.stringContaining('Content-Type'),
        },
      ],
    });
  });
});
