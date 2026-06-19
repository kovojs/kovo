import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';

describe('server static export', () => {
  it('rejects exported documents that reference server mutation or query endpoints', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-'));
    try {
      const app = createApp({
        routes: [
          route('/cart', {
            page: () =>
              [
                '<main>',
                '<form method="post" action="/_m/cart/add"><button>Add</button></form>',
                '<a href="/_q/cart?args=%7B%7D">Refresh cart</a>',
                '</main>',
              ].join(''),
          }),
        ],
      });

      await expect(exportStaticApp(app, { outDir })).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining(
              "document attribute 'action' references server mutation endpoint '/_m/cart/add'",
            ),
            routePath: '/cart',
          },
          {
            code: 'KV229',
            message: expect.stringContaining(
              "document attribute 'href' references server query endpoint '/_q/cart'",
            ),
            routePath: '/cart',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'cart', 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('skips route documents with server endpoint references when non-exportable routes are skipped', async () => {
    const app = createApp({
      routes: [
        route('/cart', {
          page: () =>
            '<main><button formaction="/_m/cart/add" formmethod="post">Add</button></main>',
        }),
      ],
    });

    await expect(exportStaticApp(app, { onNonExportable: 'skip' })).resolves.toMatchObject({
      artifacts: [],
      assets: [],
      clientModules: [],
      diagnostics: [
        {
          code: 'KV229',
          routePath: '/cart',
          message: expect.stringContaining('Export is L0/L1 only'),
        },
      ],
    });
  });

  it('allows L1 client modules and external server endpoint documentation in exported HTML', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "island";',
      version: 'cart-island',
    });
    const app = createApp({
      routes: [
        route('/cart', {
          page: () =>
            [
              '<main>',
              `<button on:click="${cartHref}#Cart$add">Add locally</button>`,
              '<a href="https://api.example.test/_m/cart/add">Remote API docs</a>',
              '</main>',
            ].join(''),
        }),
      ],
    });
    app.clientModules = registry;

    const result = await exportStaticApp(app, { origin: 'https://shop.example.test/' });

    expect(result.diagnostics).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/cart/index.html']);
    expect(result.clientModules.map((artifact) => artifact.path)).toEqual([cartHref]);
  });

  it('does not treat comments or raw-text examples as static export server endpoints', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const realHref = registry.put({
      path: '/c/real.client.js',
      source: 'export const real = "module";',
      version: 'real-module',
    });
    registry.put({
      path: '/c/example-only.client.js',
      source: 'throw new Error("example-only module should not be copied");',
      version: 'example-only',
    });
    const app = createApp({
      routes: [
        route('/guide', {
          page: () =>
            [
              '<main>',
              '<!-- <form action="/_m/comment/add"><button>Add</button></form> -->',
              '<script type="application/json">',
              '{"example":"<button on:click=\\"/c/example-only.client.js?v=example-only#open\\" formaction=\\"/_m/script/add\\">Add</button>"}',
              '</script>',
              '<style>.example::before { content: \'<a href="/_q/style">\'; }</style>',
              `<button on:click="${realHref}#Guide$open">Open</button>`,
              '</main>',
            ].join(''),
        }),
      ],
    });
    app.clientModules = registry;

    const result = await exportStaticApp(app, { origin: 'https://docs.example.test' });

    expect(result.diagnostics).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/guide/index.html']);
    expect(result.clientModules.map((artifact) => artifact.path)).toEqual([realHref]);
  });
});
