import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { respond } from './response.js';
import { layout, route } from './route.js';
import { replayStaticExportApp } from './static-export-replay.js';
import { renderedHtml } from './html.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const staticExportDocumentCsp =
  "default-src 'self'; script-src 'self' 'sha256-iHP25LIxv4ZbGeZ3JgGcDCEcZd1Wx85r9TDFuQF2zJg='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; report-to kovo-csp; require-trusted-types-for 'script'; trusted-types kovo";
const staticExportReportingHeaders = {
  'report-to':
    '{"endpoints":[{"url":"https://kovo.local/_kovo/reports/csp"}],"group":"kovo-csp","max_age":10886400}',
  'reporting-endpoints': 'kovo-csp="https://kovo.local/_kovo/reports/csp"',
};

describe('server static export app replay boundary', () => {
  it('reconstructs public route-region metadata when the route declaration crosses module instances', async () => {
    const Shell = layout({
      render: (_queries, _state, { regions }) =>
        renderedHtml(`<main data-shell>${regions.header}${regions.page}${regions.sidebar}</main>`),
    });
    const docsRoute = route('/docs', {
      layout: Shell,
      regions: {
        header: () => renderedHtml('<header>Docs</header>'),
        page: () => renderedHtml('<article>Guide</article>'),
        sidebar: () => renderedHtml('<aside>Nav</aside>'),
      },
    });
    // SPEC §8: route/layout/region segment stamps are compiler-derived or runtime-derived
    // framework metadata, never app-authored TSX. A shallow copy mimics CLI/Vite export
    // crossing server module instances, where the authoring-side WeakMap is unavailable.
    const app = createApp({ routes: [{ ...docsRoute }] });

    const result = await replayStaticExportApp({ app });

    expect(result.artifacts[0]?.body).toContain('kovo-nav-segment="layout:');
    expect(result.artifacts[0]?.body).toContain(
      '<header kovo-nav-segment="region:header" kovo-nav-kind="region" kovo-nav-name="header">Docs</header>',
    );
    expect(result.artifacts[0]?.body).toContain(
      '<article kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Guide</article>',
    );
    expect(result.artifacts[0]?.body).toContain(
      '<aside kovo-nav-segment="region:sidebar" kovo-nav-kind="region" kovo-nav-name="sidebar">Nav</aside>',
    );
  });

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
          page: () =>
            trustedHtml(`<main><button on:click="${href}#Cart$open">Open</button></main>`),
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
    app.clientModules = registry;

    await expect(replayStaticExportApp({ app, onNonExportable: 'skip' })).resolves.toEqual({
      artifacts: [
        {
          body: expect.stringContaining('<button on:click="/c/__v/cart-static/cart.client.js'),
          headers: {
            'content-security-policy': staticExportDocumentCsp,
            'content-type': 'text/html; charset=utf-8',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups; report-to="kovo-csp"',
            'origin-agent-cluster': '?1',
            'permissions-policy':
              'camera=();report-to=kovo-csp, microphone=();report-to=kovo-csp, geolocation=();report-to=kovo-csp, payment=();report-to=kovo-csp, usb=();report-to=kovo-csp',
            ...staticExportReportingHeaders,
            'x-frame-options': 'DENY',
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
            'cross-origin-resource-policy': 'same-origin',
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
          page() {
            throw new Error('ambiguous route replay should not run');
          },
        }),
        route('/products/new', {
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
