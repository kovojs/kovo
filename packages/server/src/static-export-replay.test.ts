import { publicAccess } from './access.js';
import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { respond } from './response.js';
import { route } from './route.js';
import { replayStaticExportApp } from './static-export-replay.js';
import { renderedHtml } from './html.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const defaultDocumentCsp = expect.stringContaining("default-src 'self'");

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
          access: publicAccess('test fixture'),
          page: () =>
            trustedHtml(`<main><button on:click="${href}#Cart$open">Open</button></main>`),
        }),
        route('/downloads/orders.pdf', {
          access: publicAccess('test fixture'),
          page: () =>
            respond.file('%PDF-1.7\n', {
              contentType: 'application/pdf',
              filename: 'orders.pdf',
            }),
        }),
      ],
    });
    app.clientModules = registry;

    await expect(replayStaticExportApp({ app, onNonExportable: 'skip' })).resolves.toEqual({
      artifacts: [
        {
          body: expect.stringContaining('<button on:click="/c/__v/cart-static/cart.client.js'),
          headers: {
            'content-security-policy': defaultDocumentCsp,
            'content-type': 'text/html; charset=utf-8',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'x-content-type-options': 'nosniff',
          },
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
        expect.objectContaining({
          href: expect.stringMatching(runtimeClientModulePath),
          path: expect.stringMatching(runtimeClientModulePath),
          status: 200,
        }),
      ],
      diagnostics: [
        {
          code: 'KV229',
          concretePath: '/downloads/orders.pdf',
          message: expect.stringContaining(
            "successful HTML route documents; '/downloads/orders.pdf' returned status 200 with Content-Type 'application/pdf'",
          ),
          routePath: '/downloads/orders.pdf',
        },
      ],
    });
  });

  it('skips only the non-exportable concrete staticPath, keeping valid param siblings (C1)', async () => {
    // SPEC §9.5: `skip` publishes the exportable subset. The unsafe `/products/%2f` target must be
    // dropped while its valid sibling `/products/p1` still exports — the old skip predicate matched by
    // shared `routePath` (`/products/:id`), poisoning every sibling (artifacts === []).
    const app = createApp({
      routes: [
        route('/products/:id', {
          access: publicAccess('test fixture'),
          page(context) {
            const params = context.params as { id: string };
            return renderedHtml(`<main data-product="${params.id}">Product ${params.id}</main>`);
          },
          staticPaths: ['/products/p1', '/products/%2f'],
        }),
      ],
    });

    const result = await replayStaticExportApp({ app, onNonExportable: 'skip' });

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/products/p1/index.html']);
    expect(result.artifacts[0]?.body).toContain('<main data-product="p1">Product p1</main>');
    expect(result.diagnostics).toEqual([
      {
        code: 'KV229',
        concretePath: '/products/%2f',
        message: expect.stringContaining('unsafe URL path segment'),
        routePath: '/products/:id',
      },
    ]);
  });

  it('skips a non-HTML concrete staticPath while exporting its valid HTML sibling (C1)', async () => {
    // A replay-time per-target failure (one staticPath responds non-HTML) must not poison the valid
    // sibling: skip suppresses only the concrete URL the diagnostic names (SPEC §9.5).
    const app = createApp({
      routes: [
        route('/products/:id', {
          access: publicAccess('test fixture'),
          page(context) {
            const params = context.params as { id: string };
            if (params.id === 'download') {
              return respond.file('%PDF-1.7\n', {
                contentType: 'application/pdf',
                filename: 'orders.pdf',
              });
            }
            return renderedHtml(`<main data-product="${params.id}">Product ${params.id}</main>`);
          },
          staticPaths: ['/products/p1', '/products/download'],
        }),
      ],
    });

    const result = await replayStaticExportApp({ app, onNonExportable: 'skip' });

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/products/p1/index.html']);
    expect(result.diagnostics).toEqual([
      {
        code: 'KV229',
        concretePath: '/products/download',
        message: expect.stringContaining(
          "can only write successful HTML route documents; '/products/download' returned status 200",
        ),
        routePath: '/products/download',
      },
    ]);
  });

  it('reports route-plan diagnostics before replaying route documents', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', {
          access: publicAccess('test fixture'),
          page: () => trustedHtml('<main>Product</main>'),
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
          access: publicAccess('test fixture'),
          page() {
            throw new Error('ambiguous route replay should not run');
          },
        }),
        route('/products/new', {
          access: publicAccess('test fixture'),
          page: () => trustedHtml('<main>New</main>'),
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
