import { afterEach, describe, expect, it } from 'vitest';

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
import {
  BodyAttrs,
  BodyEnd,
  BodyStart,
  Document,
  FontPreload,
  Head,
  HtmlAttrs,
  InlineScript,
  InlineStyle,
  Stylesheet,
} from './document-structured.js';

// G1 (bugs-part3 CSP-1): the deferred apply/cleanup scripts now carry a CSP hash attr.
const deferredApplyScriptBody =
  'var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()';
const deferredCleanupScriptBody =
  'for(var n of [...document.body.childNodes])if((n.textContent||"").includes("--kovo-boundary"))n.remove();document.currentScript.remove()';
const deferredApplyHash = cspSha256(deferredApplyScriptBody);
const deferredCleanupHash = cspSha256(deferredCleanupScriptBody);
const deferredApplyScript = `<script data-kovo-csp-hash="${deferredApplyHash}">${deferredApplyScriptBody}</script>`;
const deferredCleanupScript = `<script data-kovo-csp-hash="${deferredCleanupHash}">${deferredCleanupScriptBody}</script>`;
const fullInlineLoaderSource = `(${inlineKovoLoaderInstallerSource})((url)=>import(url));`;

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
      scripts: document.csp.scripts.map((hash) => (hash === loaderHash ? '<loader-hash>' : hash)),
    }).toMatchInlineSnapshot(`
      {
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
    expect(
      renderContentSecurityPolicy(document.csp).replaceAll(loaderHash, '<loader-hash>'),
    ).toMatchInlineSnapshot(
      `"default-src 'self'; script-src 'self' 'sha256-hVln6Fvq5HW+LoV7Z7ET2nObn2J5Sk7RfDnzKFwgp6Q=' '<loader-hash>' 'sha256-aupt/mVhmEzcXFTq2E1H0s8p5IJTrigq7yN0BK2tRmE='; style-src 'self' 'sha256-FcQqt3aNlV7AZnGV4zkQRVeCeJOxbMPnQSx258L803E='; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"`,
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
    expect(document.html).toContain(`<script data-kovo-csp-hash="${loaderHash}">`);
    expect(document.html).toContain('installInlineKovoLoader');
    expect(document.html.indexOf('kovo-query="cart"')).toBeLessThan(
      document.html.indexOf('<body>'),
    );
    expect(document.html).toContain(
      '<script type="application/json" kovo-query="cart" key="cart:c1" data-kovo-csp-hash="sha256-aupt/mVhmEzcXFTq2E1H0s8p5IJTrigq7yN0BK2tRmE=">{"count":1}</script>',
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
    expect(document.html).toContain('kovo-query="product"');
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

  it('assembles structured document facts without exposing required shell slots', () => {
    const themeScript = 'document.documentElement.dataset.theme="dark";';
    const themeHash = cspSha256(themeScript);
    const criticalCss = 'body{color:red}';
    const styleHash = cspSha256(criticalCss);
    const structured = Document({
      children: [
        HtmlAttrs({ 'data-doc': 'structured' }),
        BodyAttrs({ class: 'app-shell' }),
        Head({
          children: [
            InlineScript({ children: themeScript, id: 'theme', run: 'beforePaint' }),
            InlineStyle({ children: criticalCss, id: 'critical', source: 'test/document.test.ts' }),
            FontPreload({ href: '/fonts/inter.woff2' }),
            Stylesheet({ href: '/assets/site.css' }),
          ],
        }),
        BodyStart({ children: '<banner>escaped</banner>' }),
        BodyEnd({ children: '<dialog>escaped</dialog>' }),
      ],
      lang: 'en-US',
    });

    const document = renderDocument({
      body: '<main>Home</main>',
      document: structured,
      queries: [{ name: 'home', value: { ok: true } }],
    });

    expect(document.html).toContain('<html lang="en-US" data-doc="structured">');
    expect(document.html).toContain('<body class="app-shell">');
    expect(document.html).toContain(
      `<script id="theme" data-kovo-run="beforePaint" data-kovo-csp-hash="${themeHash}">${themeScript}</script>`,
    );
    expect(document.html).toContain(
      `<style id="critical" data-kovo-style-source="test/document.test.ts" data-kovo-csp-hash="${styleHash}">${criticalCss}</style>`,
    );
    expect(document.html).toContain(
      '<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>',
    );
    expect(document.html).toContain('<link rel="stylesheet" href="/assets/site.css">');
    expect(document.html).toContain('&lt;banner&gt;escaped&lt;/banner&gt;<main>Home</main>');
    expect(document.html).toContain('<main>Home</main>&lt;dialog&gt;escaped&lt;/dialog&gt;');
    expect(document.html.indexOf('kovo-query="home"')).toBeLessThan(
      document.html.indexOf('<body class="app-shell">'),
    );
    expect(document.csp.scripts).toContain(themeHash);
    expect(document.csp.styles).toContain(styleHash);
  });

  it('rejects invalid structured document sinks with teaching errors', () => {
    expect(() => InlineScript({ children: 'console.log(1)', id: '', run: 'beforePaint' })).toThrow(
      'InlineScript requires a stable non-empty id',
    );
    expect(() => FontPreload({ href: 'javascript:alert(1)' })).toThrow(
      '<Link href> received an unsafe URL scheme',
    );
    expect(() => HtmlAttrs({ onclick: 'alert(1)' })).toThrow(
      '<html> attribute "onclick" is not supported',
    );
    expect(() => Head({ children: '<script>alert(1)</script>' })).toThrow(
      '<Head> only accepts structured head primitives',
    );
    expect(() => Document({ children: '<html></html>' })).toThrow(
      '<Document> only accepts structured document primitives',
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

  // CSP-3 (bugs-part3): HTML document responses carry baseline security headers and
  // surface the assembled CSP so the dispatch path can emit a Content-Security-Policy.
  it('attaches baseline security headers and plumbs document.csp on HTML responses (CSP-3)', () => {
    const wrapped = renderRouteDocumentResponse({
      body: '<main>Orders</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });

    expect(wrapped.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(wrapped.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');

    // `document.csp` is surfaced (previously discarded) — the loader hash is present so
    // an app can render and attach a Content-Security-Policy header.
    expect(wrapped.csp).toBeDefined();
    expect(wrapped.csp?.scripts.length).toBeGreaterThan(0);
    const policy = renderContentSecurityPolicy(wrapped.csp!);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("base-uri 'self'");

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

  it('attaches baseline security headers to error documents (CSP-3)', () => {
    const error = renderErrorDocument({ status: 404 });
    expect(error.headers).toMatchObject({
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  // SPEC §6.6 (runtime defense-in-depth): the conservative LOW-false-positive
  // isolation/hardening baseline rides every framework-rendered document.
  describe('isolation/hardening headers (SPEC §6.6)', () => {
    const htmlResponse = () => ({
      body: '<main>Orders</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200 as const,
    });

    it('carries X-Frame-Options/COOP/Permissions-Policy/Referrer-Policy by default', () => {
      const wrapped = renderRouteDocumentResponse(htmlResponse());
      expect(wrapped.headers).toMatchObject({
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
    });

    it('also stamps the isolation baseline on error documents', () => {
      const error = renderErrorDocument({ status: 403 });
      expect(error.headers).toMatchObject({
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'X-Frame-Options': 'DENY',
      });
    });

    it('preserves an author opt-out instead of duplicating a header', () => {
      const wrapped = renderRouteDocumentResponse({
        body: '<main>Embeddable</main>',
        // An app that intentionally embeds its own page sets a permissive frame policy.
        headers: { 'Content-Type': 'text/html', 'x-frame-options': 'SAMEORIGIN' },
        status: 200,
      });
      const frameKeys = Object.keys(wrapped.headers).filter(
        (name) => name.toLowerCase() === 'x-frame-options',
      );
      expect(frameKeys).toHaveLength(1);
      expect(wrapped.headers[frameKeys[0]!]).toBe('SAMEORIGIN');
    });

    describe('Strict-Transport-Security gating', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
      });

      it('is present only under prod + HTTPS', () => {
        process.env.NODE_ENV = 'production';
        const secure = renderRouteDocumentResponse(htmlResponse(), { secure: true });
        expect(secure.headers['Strict-Transport-Security']).toBe(
          'max-age=63072000; includeSubDomains',
        );
      });

      it('is absent in production over plain HTTP (non-HTTPS request)', () => {
        process.env.NODE_ENV = 'production';
        const insecure = renderRouteDocumentResponse(htmlResponse(), { secure: false });
        expect(insecure.headers['Strict-Transport-Security']).toBeUndefined();
      });

      it('is absent in dev even over HTTPS (would brick localhost http)', () => {
        process.env.NODE_ENV = 'development';
        const dev = renderRouteDocumentResponse(htmlResponse(), { secure: true });
        expect(dev.headers['Strict-Transport-Security']).toBeUndefined();
      });

      it('is absent when the call site never wired the secure flag', () => {
        process.env.NODE_ENV = 'production';
        const unwired = renderRouteDocumentResponse(htmlResponse());
        expect(unwired.headers['Strict-Transport-Security']).toBeUndefined();
      });
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
    expect(response.body).toContain(`<script data-kovo-csp-hash="${loaderHash}">`);
    expect(response.body.indexOf('<kovo-defer target="reviews:p1">')).toBeLessThan(
      response.body.indexOf('--kovo-boundary'),
    );
    expect(response.body).toContain(
      '<kovo-query name="reviews" key="reviews:p1">{"count":1}</kovo-query>',
    );
    expect(response.body).toContain(
      '<kovo-fragment target="reviews:p1"><link rel="stylesheet" href="/reviews.css"><section>Ready</section></kovo-fragment>',
    );
    expect(response.body).toContain(deferredApplyScript);
    expect(
      response.body.endsWith(`--kovo-boundary--\n${deferredCleanupScript}\n</body></html>`),
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
    expect(response.body).toContain(`data-kovo-csp-hash="${deferredApplyHash}"`);
  });

  it('places structured BodyEnd content in the deferred close frame', () => {
    const response = renderDeferredDocument({
      body: '<main><kovo-defer target="reviews:p1"></kovo-defer></main>',
      chunks: [
        {
          fragments: [{ html: '<section>Ready</section>', target: 'reviews:p1' }],
        },
      ],
      document: Document({
        children: BodyEnd({ children: '<dialog>Search</dialog>' }),
      }),
    });

    expect(response.body.indexOf('<kovo-fragment target="reviews:p1">')).toBeLessThan(
      response.body.indexOf('&lt;dialog&gt;Search&lt;/dialog&gt;'),
    );
    expect(
      response.body.endsWith(
        `${deferredCleanupScript}\n&lt;dialog&gt;Search&lt;/dialog&gt;</body></html>`,
      ),
    ).toBe(true);
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
