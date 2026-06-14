import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { guards } from './guards.js';
import { respond } from './response.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import { StaticExportError } from './static-export-diagnostics.js';

describe('server static export', () => {
  it('rejects raw request handlers before static export replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    const rawHandler = async () => new Response('<main>compat</main>');

    try {
      await expect(
        exportStaticApp(rawHandler as unknown as Parameters<typeof exportStaticApp>[0], {
          outDir,
        }),
      ).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
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
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    let rendered = false;
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => {
              rendered = true;
              return '<main>Home</main>';
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
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
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
            return '<main>Home</main>';
          },
        }),
      ],
    });

    await expect(
      exportStaticApp(app, {
        outDir: new URL('https://static.example.test/export/'),
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            'SPEC §9.5 static export output directories must be filesystem paths or file: URLs',
          ),
          routePath: 'outDir',
        },
      ],
    });
    expect(rendered).toBe(false);
  });

  it('rejects invalid static export origins before replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    let rendered = false;
    try {
      const app = createApp({
        routes: [
          route('/', {
            page: () => {
              rendered = true;
              return '<main>Home</main>';
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
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
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

  it('rejects duplicate concrete route targets before static replay', async () => {
    let replayed = false;
    const app = createApp({
      routes: [
        route('/docs/intro', {
          page: () => {
            replayed = true;
            return '<main>Intro</main>';
          },
        }),
        route('/docs/intro/', {
          page: () => '<main>Duplicate intro</main>',
        }),
      ],
    });

    await expect(exportStaticApp(app)).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "cannot export '/docs/intro' for route '/docs/intro/' because it duplicates the concrete route target from '/docs/intro'",
          ),
          routePath: '/docs/intro/',
        },
      ],
    });
    expect(replayed).toBe(false);
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

  it('rejects static-host-unsafe route document targets before replay or writes', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-'));
    let rendered = false;
    try {
      const app = createApp({
        routes: [
          route('/products/:id', {
            page: () => {
              rendered = true;
              return '<main>Product</main>';
            },
            staticPaths: ['/products/%2f'],
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
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
