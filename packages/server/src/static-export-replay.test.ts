import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { respond } from './response.js';
import { route } from './route.js';
import { replayStaticExportApp } from './static-export-replay.js';

describe('server static export app replay boundary', () => {
  it('owns replay-time non-exportable skip policy while still replaying discovered client modules', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const href = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "static";',
      version: 'cart-static',
    });
    const app = createApp({
      clientModules: registry,
      routes: [
        route('/', {
          page: () => `<main><button on:click="${href}#Cart$open">Open</button></main>`,
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

    await expect(replayStaticExportApp({ app, onNonExportable: 'skip' })).resolves.toEqual({
      artifacts: [
        {
          body: expect.stringContaining('<button on:click="/c/cart.client.js?v=cart-static'),
          headers: { 'content-type': 'text/html; charset=utf-8' },
          path: '/index.html',
          status: 200,
        },
      ],
      clientModules: [
        {
          body: 'export const cart = "static";',
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: '/c/cart.client.js?v=cart-static#Cart$open',
          path: '/c/cart.client.js',
          status: 200,
        },
      ],
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "successful HTML route documents; '/exports/orders.csv' returned status 200 with Content-Type 'text/csv; charset=utf-8'",
          ),
          routePath: '/exports/orders.csv',
        },
      ],
    });
  });

  it('reports route-plan diagnostics before validating html path style options', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          page: () => '<main>Product</main>',
        }),
      ],
    });

    await expect(
      replayStaticExportApp({ app, htmlPathStyle: 'pretty' as 'directory' }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining('staticPaths metadata'),
          routePath: '/products/:id',
        },
      ],
    });
  });

  it('rejects invalid html path style options before replaying route documents', async () => {
    let rendered = false;
    const app = createApp({
      routes: [
        route('/', {
          page() {
            rendered = true;
            return '<main>Home</main>';
          },
        }),
      ],
    });

    await expect(
      replayStaticExportApp({ app, htmlPathStyle: 'pretty' as 'directory' }),
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
    expect(rendered).toBe(false);
  });
});
