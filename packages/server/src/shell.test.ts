import { describe, expect, it } from 'vitest';

import {
  endpoint,
  findRouteAmbiguities,
  matchRoute,
  matchShellDispatch,
  normalizePathname,
  renderDeferredDocument,
  renderDocument,
  renderDocumentQueryScript,
  renderErrorDocument,
  renderRouteDocumentResponse,
  route,
  shellDispatchTable,
} from './index.js';

describe('server app shell route matching', () => {
  it('normalizes trailing slashes before route matching with 308 metadata', () => {
    const product = route('/products/:id', {});

    const match = matchRoute([product], '/products/p1/');

    expect(match).toMatchObject({
      normalization: {
        inputPathname: '/products/p1/',
        pathname: '/products/p1',
        redirect: { pathname: '/products/p1', status: 308 },
        trailingSlash: 'removed',
      },
      params: { id: 'p1' },
      pathname: '/products/p1',
      route: product,
    });
  });

  it('prefers static segments over params at each depth', () => {
    const product = route('/products/:id', {});
    const productNew = route('/products/new', {});

    expect(matchRoute([product, productNew], '/products/new')?.route).toBe(productNew);
    expect(matchRoute([productNew, product], '/products/p1')?.route).toBe(product);
  });

  it('extracts raw param segments for parseRouteRequest coercion', () => {
    const product = route('/products/:id/files/:file', {});

    expect(matchRoute([product], '/products/sku%2F1/files/readme.md')?.params).toEqual({
      file: 'readme.md',
      id: 'sku%2F1',
    });
  });

  it('reports FW228 ambiguities when two route patterns can match one pathname', () => {
    expect(
      findRouteAmbiguities([
        route('/products/:id', {}),
        route('/products/new', {}),
        route('/products/:sku/reviews', {}),
        route('/products/:id/reviews', {}),
        route('/cart', {}),
      ]),
    ).toEqual([
      {
        code: 'FW228',
        message:
          'Ambiguous route table entry. SPEC 6.4 routes must be statically provable navigation targets; planned 9.5 shell dispatch rejects route pairs that can match the same pathname.',
        paths: ['/products/:id', '/products/new'],
        witnessPath: '/products/new',
      },
      {
        code: 'FW228',
        message:
          'Ambiguous route table entry. SPEC 6.4 routes must be statically provable navigation targets; planned 9.5 shell dispatch rejects route pairs that can match the same pathname.',
        paths: ['/products/:sku/reviews', '/products/:id/reviews'],
        witnessPath: '/products/:sku/reviews',
      },
    ]);
  });
});

describe('server app shell document assembly', () => {
  it('assembles deterministic documents with hints, loader, and query hydration before body', () => {
    const document = renderDocument({
      body: '<main><cart-badge fw-deps="cart"></cart-badge></main>',
      hints: {
        i18n: { locale: 'en-US', messages: { cart: 'Cart' } },
        meta: { description: 'Cart summary', title: 'Cart' },
        modulepreloads: ['/c/cart.client.js'],
        stylesheets: [{ criticalCss: 'body{color:red}', href: '/assets/app.css' }],
      },
      queries: [{ key: 'cart:c1', name: 'cart', value: { count: 1 } }],
    });

    expect(document.earlyHints).toEqual({
      Link: '</assets/app.css>; rel=preload; as=style, </c/cart.client.js>; rel=modulepreload',
    });
    expect(document.html).toContain('<!doctype html><html lang="en-US"><head>');
    expect(document.html).toContain('<title>Cart</title>');
    expect(document.html).toContain(
      '<style data-jiso-critical-href="/assets/app.css">body{color:red}</style><link rel="stylesheet" href="/assets/app.css">',
    );
    expect(document.html).toContain('<script>');
    expect(document.html).toContain('installInlineJisoLoader');
    expect(document.html.indexOf('fw-query="cart"')).toBeLessThan(document.html.indexOf('<body>'));
    expect(document.html).toContain(
      '<script type="application/json" fw-query="cart" key="cart:c1">{"count":1}</script>',
    );
    expect(document.html).toContain(
      '<body><main><cart-badge fw-deps="cart"></cart-badge></main></body></html>',
    );
  });

  it('lets document templates receive assembled parts without losing required shell parts', () => {
    const document = renderDocument({
      body: '<main>Account</main>',
      lang: 'fr',
      queries: [{ name: 'account', value: { userId: 'u1' } }],
      template({ parts }) {
        return [
          '<!doctype html>',
          `<html data-lang="${parts.lang}">`,
          `<head>${parts.head}${parts.queryScripts.join('')}</head>`,
          `<body data-shell>${parts.body}</body>`,
          '</html>',
        ].join('');
      },
    });

    expect(document.html).toContain('<html data-lang="fr">');
    expect(document.html).toContain('installInlineJisoLoader');
    expect(document.html).toContain('fw-query="account"');
    expect(document.html).toContain('<body data-shell><main>Account</main></body>');
  });

  it('wraps successful html route responses and preserves non-html outcomes', () => {
    expect(
      renderRouteDocumentResponse(
        {
          body: '<main>Orders</main>',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200,
        },
        { hints: { stylesheets: ['/orders.css'] } },
      ),
    ).toMatchObject({
      body: expect.stringContaining('<main>Orders</main>'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        Link: '</orders.css>; rel=preload; as=style',
      },
      status: 200,
    });

    expect(
      renderRouteDocumentResponse({
        body: '<main>Caps</main>',
        headers: { 'CONTENT-TYPE': 'text/html' },
        status: 200,
      }).body,
    ).toContain('<!doctype html>');

    const csv = {
      body: 'id,total\n1,42\n',
      headers: { 'Content-Type': 'text/csv' },
      status: 200 as const,
    };
    expect(renderRouteDocumentResponse(csv)).toBe(csv);
  });

  it('assembles deferred document streams with chunks before the closing shell', () => {
    const response = renderDeferredDocument({
      body: '<main><fw-defer target="reviews:p1"></fw-defer></main>',
      chunks: [
        {
          fragments: [
            {
              html: '<section>Ready</section>',
              stylesheets: ['/reviews.css'],
              target: 'reviews:p1',
            },
          ],
          queries: [{ key: 'reviews:p1', name: 'reviews', value: { count: 1 } }],
        },
      ],
      hints: { stylesheets: ['/app.css'] },
    });

    expect(response).toMatchObject({
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        Link: '</app.css>; rel=preload; as=style',
        'Transfer-Encoding': 'chunked',
      },
      status: 200,
    });
    expect(response.body).toContain('<link rel="stylesheet" href="/app.css">');
    expect(response.body).toContain('<script>');
    expect(response.body.indexOf('<fw-defer target="reviews:p1">')).toBeLessThan(
      response.body.indexOf('--jiso-boundary'),
    );
    expect(response.body).toContain(
      '<fw-query name="reviews" key="reviews:p1">{"count":1}</fw-query>',
    );
    expect(response.body).toContain(
      '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/reviews.css"><section>Ready</section></fw-fragment>',
    );
    expect(response.body.endsWith('--jiso-boundary--\n</body></html>')).toBe(true);
  });

  it('renders stable error documents with escaped content', () => {
    const response = renderErrorDocument({
      message: 'Missing <cart>',
      status: 404,
      title: 'Cart missing',
    });

    expect(response).toMatchObject({
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 404,
    });
    expect(response.body).toContain('<title>Cart missing</title>');
    expect(response.body).toContain('<h1>Cart missing</h1>');
    expect(response.body).toContain('<p>Missing &lt;cart&gt;</p>');
  });

  it('escapes document query script JSON for safe initial hydration', () => {
    expect(
      renderDocumentQueryScript({
        name: 'cart',
        value: { html: '</script><script>alert(1)</script>' },
      }),
    ).toBe(
      '<script type="application/json" fw-query="cart">{"html":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}</script>',
    );
  });
});

describe('server app shell dispatch table', () => {
  it('keeps the planned reserved dispatch order printable', () => {
    expect(shellDispatchTable.map((entry) => entry.phase)).toEqual([
      'mutation',
      'query',
      'client-module',
      'endpoint-exact',
      'endpoint-prefix',
      'route',
      'not-found',
    ]);
  });

  it('dispatches reserved namespaces before endpoints and routes', () => {
    const catchAllEndpoint = endpoint('/_m', {
      handler: () => new Response('endpoint'),
      method: 'POST',
      mount: 'prefix',
    });
    const reservedRoute = route('/_m/:key', {});

    expect(
      matchShellDispatch({
        endpoints: [catchAllEndpoint],
        method: 'POST',
        pathname: '/_m/cart/add',
        routes: [reservedRoute],
      }),
    ).toMatchObject({
      key: 'cart/add',
      kind: 'mutation',
      pathname: '/_m/cart/add',
    });
  });

  it('dispatches endpoint exact mounts before endpoint prefix mounts', () => {
    const exactEndpoint = endpoint('/auth/callback', {
      handler: () => new Response('exact'),
      method: 'GET',
    });
    const prefixEndpoint = endpoint('/auth', {
      csrf: false,
      csrfJustification: 'auth adapter owns callback subpaths',
      handler: () => new Response('prefix'),
      method: 'GET',
      mount: 'prefix',
    });

    expect(
      matchShellDispatch({
        endpoints: [prefixEndpoint, exactEndpoint],
        method: 'GET',
        pathname: '/auth/callback',
      }),
    ).toMatchObject({
      endpoint: exactEndpoint,
      kind: 'endpoint',
    });
  });

  it('dispatches routes after endpoints and records page method allowance', () => {
    const routeEndpoint = endpoint('/products/p1', {
      handler: () => new Response('endpoint'),
      method: 'POST',
    });
    const product = route('/products/:id', {});

    expect(
      matchShellDispatch({
        endpoints: [routeEndpoint],
        method: 'GET',
        pathname: '/products/p1',
        routes: [product],
      }),
    ).toMatchObject({
      kind: 'route',
      methodAllowed: true,
      params: { id: 'p1' },
      route: product,
    });

    expect(
      matchShellDispatch({
        endpoints: [routeEndpoint],
        method: 'POST',
        pathname: '/products/p1',
        routes: [product],
      }),
    ).toMatchObject({
      endpoint: routeEndpoint,
      kind: 'endpoint',
    });

    expect(
      matchShellDispatch({
        method: 'POST',
        pathname: '/products/p1',
        routes: [product],
      }),
    ).toMatchObject({
      allowedMethods: ['GET', 'HEAD'],
      kind: 'route',
      methodAllowed: false,
    });
  });

  it('falls through to the 404 dispatch phase with canonical pathname metadata', () => {
    expect(matchShellDispatch({ pathname: '/missing/' })).toMatchObject({
      kind: 'not-found',
      normalization: {
        inputPathname: '/missing/',
        pathname: '/missing',
        redirect: { pathname: '/missing', status: 308 },
        trailingSlash: 'removed',
      },
      pathname: '/missing',
    });
  });

  it('normalizes pathnames without touching canonical roots', () => {
    expect(normalizePathname('/')).toEqual({
      inputPathname: '/',
      pathname: '/',
      trailingSlash: 'canonical',
    });
  });
});
