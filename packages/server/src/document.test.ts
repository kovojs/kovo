import { describe, expect, it } from 'vitest';

import { inlineKovoLoaderInstallerSource } from '@kovojs/browser/internal/inline-loader';

import { cspSha256, renderContentSecurityPolicy } from './csp.js';
import {
  renderDeferredDocument,
  renderDocument,
  renderDocumentQueryScript,
  renderErrorDocument,
  renderRouteDocumentResponse,
} from './document-core.js';
import { renderDiagnosticDocument } from './document-diagnostics.js';

// G1 (bugs-part3 CSP-1): the deferred apply/cleanup scripts now carry a CSP hash attr.
const deferredApplyScriptBody =
  'var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()';
const deferredCleanupScriptBody =
  'for(var n of [...document.body.childNodes])if((n.textContent||"").includes("--kovo-boundary"))n.remove();document.currentScript.remove()';
const deferredApplyHash = cspSha256(deferredApplyScriptBody);
const deferredCleanupHash = cspSha256(deferredCleanupScriptBody);
const fullInlineLoaderSource = `(${inlineKovoLoaderInstallerSource})((url)=>import(url));`;

function nonceFor(csp: { nonce?: string }): string {
  expect(csp.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  return csp.nonce!;
}

describe('server app shell document assembly', () => {
  it('assembles deterministic documents with hints, loader, and query hydration before body', () => {
    const loaderHash = cspSha256(fullInlineLoaderSource);
    const document = renderDocument({
      body: '<main><cart-badge kovo-deps="cart"></cart-badge></main>',
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
    expect({
      ...document.csp,
      nonce: '<nonce>',
      scripts: document.csp.scripts.map((hash) => (hash === loaderHash ? '<loader-hash>' : hash)),
    }).toMatchInlineSnapshot(`
      {
        "nonce": "<nonce>",
        "scripts": [
          "sha256-hVln6Fvq5HW+LoV7Z7ET2nObn2J5Sk7RfDnzKFwgp6Q=",
          "<loader-hash>",
          "sha256-aupt/mVhmEzcXFTq2E1H0s8p5IJTrigq7yN0BK2tRmE=",
        ],
        "styles": [
          "sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E=",
        ],
      }
    `);
    const nonce = nonceFor(document.csp);
    expect(
      renderContentSecurityPolicy(document.csp)
        .replaceAll(loaderHash, '<loader-hash>')
        .replaceAll(nonce, '<nonce>'),
    ).toMatchInlineSnapshot(
      `"default-src 'self'; script-src 'self' 'nonce-<nonce>' 'strict-dynamic' 'sha256-hVln6Fvq5HW+LoV7Z7ET2nObn2J5Sk7RfDnzKFwgp6Q=' '<loader-hash>' 'sha256-aupt/mVhmEzcXFTq2E1H0s8p5IJTrigq7yN0BK2tRmE='; style-src 'self' 'sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E='; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"`,
    );
    // G2 (bugs-part3 CSP-2): the hardening directives are present so a hash-locked
    // script-src is not bypassable via an injected `<base>`/`<object>`.
    const policy = renderContentSecurityPolicy(document.csp);
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(document.html).toContain('<!doctype html><html lang="en-US"><head>');
    expect(document.html).toContain('<title>Cart</title>');
    expect(document.html).toContain(
      '<style data-kovo-critical-href="/assets/app.css" data-kovo-csp-hash="sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E=">body{color:red}</style><link rel="stylesheet" href="/assets/app.css">',
    );
    expect(document.html).toContain(`<script nonce="${nonce}" data-kovo-csp-hash="${loaderHash}">`);
    expect(document.html).toContain(
      `<script type="application/json" kovo-i18n locale="en-US" nonce="${nonce}"`,
    );
    expect(document.html).toContain('installInlineKovoLoader');
    expect(document.html.indexOf('kovo-query="cart"')).toBeLessThan(
      document.html.indexOf('<body>'),
    );
    expect(document.html).toContain(
      `<script type="application/json" kovo-query="cart" key="cart:c1" nonce="${nonce}" data-kovo-csp-hash="sha256-aupt/mVhmEzcXFTq2E1H0s8p5IJTrigq7yN0BK2tRmE=">{"count":1}</script>`,
    );
    expect(document.html).toContain(
      '<body><main><cart-badge kovo-deps="cart"></cart-badge></main></body></html>',
    );
  });

  it('omits the loader script and loader CSP hash for negotiated loader-free documents', () => {
    const loaderHash = cspSha256(fullInlineLoaderSource);
    const document = renderDocument({
      body: '<main>Product</main>',
      loader: 'omit',
      queries: [{ key: 'product:p1', name: 'product', value: { id: 'p1' } }],
    });

    expect(document.html).not.toContain('installInlineKovoLoader');
    expect(document.html).not.toContain(`<script data-kovo-csp-hash="${loaderHash}">`);
    expect(document.csp.scripts).not.toContain(loaderHash);
    expect(renderContentSecurityPolicy(document.csp)).not.toContain(loaderHash);
    expect(renderContentSecurityPolicy(document.csp)).toContain(
      `'nonce-${nonceFor(document.csp)}'`,
    );
    expect(document.html).toContain('kovo-query="product"');
  });

  it('keeps CSP hardening directives non-overridable', () => {
    const policy = renderContentSecurityPolicy(
      { nonce: 'abc123', scripts: [], styles: [] },
      {
        baseUri: ['https://evil.example'],
        formAction: ['https://evil.example'],
        frameAncestors: ['https://evil.example'],
        objectSrc: ['https://evil.example'],
      },
    );

    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("'nonce-abc123'");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain('https://evil.example');
  });

  // F2 (bugs-part3 L2-early-hints-2): the document head path threads rendered query
  // values into the meta factory so `metaFromQuery(...)` resolves; an absent query
  // must drop only the derived tags rather than 500 the whole document.
  it('threads rendered queries into head meta factories without 500ing on a gap', () => {
    const productFactory = {
      queries: ['product'],
      resolve(values: Record<string, unknown>) {
        const product = values.product as { name: string; stock: number };
        return { description: `${product.stock} in stock`, title: product.name };
      },
    };

    const withData = renderDocument({
      body: '<main>Product</main>',
      hints: { meta: productFactory },
      queries: [{ name: 'product', value: { name: 'Coffee', stock: 5 } }],
    });
    expect(withData.html).toContain('<title>Coffee</title>');
    expect(withData.html).toContain('<meta name="description" content="5 in stock">');

    // No matching query script → the factory is skipped, no throw, body still renders.
    expect(() =>
      renderDocument({
        body: '<main>Product</main>',
        hints: { meta: productFactory },
      }),
    ).not.toThrow();
    const withoutData = renderDocument({
      body: '<main>Product</main>',
      hints: { meta: productFactory },
    });
    expect(withoutData.html).not.toContain('<title>Coffee</title>');
    expect(withoutData.html).toContain('<main>Product</main>');
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
    expect(document.html).toContain('installInlineKovoLoader');
    expect(document.html).toContain('kovo-query="account"');
    expect(document.html).toContain('<body data-shell><main>Account</main></body>');
  });

  it('rejects document templates that drop assembled shell contracts', () => {
    expect(() =>
      renderDocument({
        body: '<main>Account</main>',
        template() {
          return '<!doctype html><html><head></head><body></body></html>';
        },
      }),
    ).toThrow(
      'DocumentTemplate omitted required assembled document part(s): parts.head, parts.body.',
    );

    expect(() =>
      renderDeferredDocument({
        body: '<main>Deferred</main>',
        chunks: [],
        template({ parts }) {
          return {
            closeHtml: '</body></html>',
            shell: `<!doctype html><html><head>${parts.head}</head><body>`,
          };
        },
      }),
    ).toThrow('DeferredDocumentTemplate omitted required assembled document part(s): parts.body.');

    expect(() =>
      renderDocument({
        body: '<main>Account</main>',
        queries: [{ name: 'account', value: { userId: 'u1' } }],
        template({ parts }) {
          return [
            '<!doctype html>',
            '<html>',
            `<head>${parts.head}</head>`,
            `<body>${parts.body}</body>`,
            '</html>',
          ].join('');
        },
      }),
    ).toThrow(
      'DocumentTemplate omitted required assembled document part(s): parts.queryScripts[0].',
    );
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

    const binary = {
      body: '%PDF-1.7\n',
      headers: { 'Content-Type': 'application/pdf' },
      status: 200 as const,
    };
    expect(renderRouteDocumentResponse(binary)).toBe(binary);
  });

  // Phase 7 / SPEC §9.5: HTML document responses carry baseline security headers,
  // surface the assembled CSP metadata, and emit the hash-based CSP by default.
  it('attaches baseline security headers and default CSP on HTML responses', () => {
    const wrapped = renderRouteDocumentResponse({
      body: '<main>Orders</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });

    expect(wrapped.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(wrapped.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');

    expect(wrapped.headers['Content-Security-Policy']).toBeDefined();

    // `document.csp` is still surfaced for compatibility; the default header uses the
    // same metadata so the framework's inline loader is admitted without app opt-in.
    expect(wrapped.csp).toBeDefined();
    expect(wrapped.csp?.scripts.length).toBeGreaterThan(0);
    const nonce = nonceFor(wrapped.csp!);
    const policy = renderContentSecurityPolicy(wrapped.csp!);
    expect(wrapped.headers['Content-Security-Policy']).toBe(policy);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");

    // An author-set nosniff header is preserved rather than duplicated.
    const authorNosniff = renderRouteDocumentResponse({
      body: '<main>Orders</main>',
      headers: { 'Content-Type': 'text/html', 'x-content-type-options': 'nosniff' },
      status: 200,
    });
    const nosniffKeys = Object.keys(authorNosniff.headers).filter(
      (name) => name.toLowerCase() === 'x-content-type-options',
    );
    expect(nosniffKeys).toHaveLength(1);
  });

  it('appends the default CSP to an author CSP instead of replacing it', () => {
    const wrapped = renderRouteDocumentResponse({
      body: '<main>Orders</main>',
      headers: {
        'Content-Security-Policy': 'img-src https://cdn.example.test',
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });

    expect(wrapped.headers['Content-Security-Policy']).toEqual([
      'img-src https://cdn.example.test',
      renderContentSecurityPolicy(wrapped.csp!),
    ]);
  });

  it('attaches baseline security headers to error documents (CSP-3)', () => {
    const error = renderErrorDocument({ status: 404 });
    expect(error.headers).toMatchObject({
      'Content-Security-Policy': expect.stringContaining("'strict-dynamic'"),
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': renderContentSecurityPolicy(error.csp),
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('assembles deferred document streams with chunks before the closing shell', () => {
    const loaderHash = cspSha256(fullInlineLoaderSource);
    const response = renderDeferredDocument({
      body: '<main><kovo-defer target="reviews:p1"></kovo-defer></main>',
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
    const nonce = nonceFor(response.csp);
    expect(response.body).toContain(`<script nonce="${nonce}" data-kovo-csp-hash="${loaderHash}">`);
    expect(response.body.indexOf('<kovo-defer target="reviews:p1">')).toBeLessThan(
      response.body.indexOf('--kovo-boundary'),
    );
    expect(response.body).toContain(
      '<kovo-query name="reviews" key="reviews:p1">{"count":1}</kovo-query>',
    );
    expect(response.body).toContain(
      '<kovo-fragment target="reviews:p1"><link rel="stylesheet" href="/reviews.css"><section>Ready</section></kovo-fragment>',
    );
    expect(response.body).toContain(
      `<script nonce="${nonce}" data-kovo-csp-hash="${deferredApplyHash}">${deferredApplyScriptBody}</script>`,
    );
    expect(
      response.body.endsWith(
        `--kovo-boundary--\n<script nonce="${nonce}" data-kovo-csp-hash="${deferredCleanupHash}">${deferredCleanupScriptBody}</script>\n</body></html>`,
      ),
    ).toBe(true);

    // G1 (bugs-part3 CSP-1): the deferred apply/cleanup script hashes are merged into
    // the returned document CSP so a strict hash-CSP admits deferred hydration, and the
    // HTML carries matching hash attributes.
    expect(response.csp.scripts).toContain(deferredApplyHash);
    expect(response.csp.scripts).toContain(deferredCleanupHash);
    expect(response.csp.scripts).toContain(loaderHash);
    const policy = renderContentSecurityPolicy(response.csp);
    expect(policy).toContain(`'${deferredApplyHash}'`);
    expect(policy).toContain(`'${deferredCleanupHash}'`);
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).toContain("'strict-dynamic'");
    expect(response.body).toContain(`nonce="${nonce}" data-kovo-csp-hash="${deferredApplyHash}"`);
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
          code: 'KV201',
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
    expect(response.body).toContain('<title>KV201 diagnostic</title>');
    expect(response.body).toContain('<p class="kovo-diagnostic-code">KV201</p>');
    expect(response.body).toContain('<p class="kovo-diagnostic-severity">error</p>');
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
          code: 'KV210',
          fileName: 'src/cart.tsx',
          message: 'Anonymous handler; name it for stable identity.',
          severity: 'lint',
        },
        {
          code: 'KV225',
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
    expect(response.body).toContain('<p class="kovo-diagnostic-severity">lint</p>');
    expect(response.body).toContain('src/detail.tsx:1:3');
    expect(response.body).not.toContain('<pre class="kovo-diagnostic-source"><code>');
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
      '<script type="application/json" kovo-query="cart">{"html":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}</script>',
    );
  });
});
