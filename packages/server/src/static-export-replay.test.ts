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
    app.clientModules = registry;

    await expect(replayStaticExportApp({ app, onNonExportable: 'skip' })).resolves.toEqual({
      artifacts: [
        {
          body: expect.stringContaining('<button on:click="/c/__v/cart-static/cart.client.js'),
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
          href: '/c/__v/cart-static/cart.client.js#Cart$open',
          path: '/c/__v/cart-static/cart.client.js',
          status: 200,
        },
      ],
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            "successful HTML route documents; '/exports/orders.csv' returned status 200 with Content-Type 'text/csv; charset=utf-8'",
          ),
          routePath: '/exports/orders.csv',
        },
      ],
    });
  });

  it('reports route-plan diagnostics before replaying route documents', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          page: () => '<main>Product</main>',
        }),
      ],
    });

    await expect(replayStaticExportApp({ app })).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('staticPaths metadata'),
          routePath: '/products/:id',
        },
      ],
    });
  });

  it('reports KV228 route-table diagnostics before replaying route documents', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          page() {
            throw new Error('ambiguous route replay should not run');
          },
        }),
        route('/products/new', {
          page: () => '<main>New</main>',
        }),
      ],
    });

    await expect(replayStaticExportApp({ app })).rejects.toMatchObject({
      code: 'KV228',
      diagnostics: [
        {
          code: 'KV228',
          message: expect.stringContaining('/products/new'),
          routePath: '/products/:id <-> /products/new',
        },
      ],
    });
  });
});
