import { describe, expect, it } from 'vitest';

import {
  renderDeferredDocument,
  renderDocument,
  renderDocumentQueryScript,
  renderErrorDocument,
  renderRouteDocumentResponse,
} from './document-core.js';
import { renderDiagnosticDocument } from './document-diagnostics.js';

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
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            link: '</c/orders.client.js>; rel=modulepreload',
          },
          status: 200,
        },
        { hints: { stylesheets: ['/orders.css'] } },
      ),
    ).toMatchObject({
      body: expect.stringContaining('<main>Orders</main>'),
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        link: '</c/orders.client.js>; rel=modulepreload, </orders.css>; rel=preload; as=style',
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

  it('renders dev diagnostic documents with code, severity, help, and source frame', () => {
    const response = renderDiagnosticDocument(
      [
        {
          code: 'FW201',
          fileName: 'src/cart.tsx',
          help: 'Fixes: move the value into ctx.\nUse data-p-* for serializable params.',
          length: 6,
          message: 'Closure captures <window>.',
          start: { column: 17, line: 2 },
        },
      ],
      [
        'export function Cart() {',
        '  const total = window.localStorage;',
        '  return <p>{total}</p>;',
        '}',
      ].join('\n'),
    );

    expect(response).toMatchObject({
      headers: expect.objectContaining({
        'Content-Type': 'text/html; charset=utf-8',
      }),
      status: 500,
    });
    expect(response.body).toContain('<title>FW201 diagnostic</title>');
    expect(response.body).toContain('<p class="jiso-diagnostic-code">FW201</p>');
    expect(response.body).toContain('<p class="jiso-diagnostic-severity">error</p>');
    expect(response.body).toContain('<h2>Closure captures &lt;window&gt;.</h2>');
    expect(response.body).toContain('src/cart.tsx:2:17');
    expect(response.body).toContain('<h3>Fix menu</h3>');
    expect(response.body).toContain('<li>Fixes: move the value into ctx.</li>');
    expect(response.body).toContain('<li>Use data-p-* for serializable params.</li>');
    expect(response.body).toContain('1 | export function Cart() {');
    expect(response.body).toContain('2 |   const total = window.localStorage;');
    expect(response.body).toContain('  |                 ^^^^^^');
    expect(response.body).toContain('3 |   return &lt;p&gt;{total}&lt;/p&gt;;');
  });

  it('renders multiple diagnostics without source when no matching source is available', () => {
    const response = renderDiagnosticDocument({
      diagnostics: [
        {
          code: 'FW210',
          fileName: 'src/cart.tsx',
          message: 'Anonymous handler; name it for stable identity.',
          severity: 'lint',
        },
        {
          code: 'FW225',
          fileName: 'src/detail.tsx',
          message: 'JSX nesting violates the HTML content model.',
          severity: 'error',
          start: { column: 3, line: 1 },
        },
      ],
      source: {
        fileName: 'src/cart.tsx',
        source: '<button>Save</button>',
      },
    });

    expect(response.status).toBe(500);
    expect(response.body).toContain('<title>2 diagnostics</title>');
    expect(response.body).toContain('<p class="jiso-diagnostic-severity">lint</p>');
    expect(response.body).toContain('src/detail.tsx:1:3');
    expect(response.body).not.toContain('<pre class="jiso-diagnostic-source"><code>');
  });

  it('renders one error document title while preserving other static meta hints', () => {
    const response = renderErrorDocument({
      hints: {
        meta: { description: 'Original description', title: 'Original title' },
      },
      status: 500,
      title: 'Server unavailable',
    });
    expect(typeof response.body).toBe('string');
    const body = response.body as string;

    expect(body.match(/<title>/g)).toHaveLength(1);
    expect(body).toContain('<title>Server unavailable</title>');
    expect(body).toContain('<meta name="description" content="Original description">');
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
