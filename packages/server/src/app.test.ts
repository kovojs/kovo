import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';

import { createApp, createRequestHandler } from './app.js';
import { appRateLimitKeyCounts } from './app-load-shed.js';
import { versionedClientModuleHref } from './client-modules.js';
import { KOVO_CSP_REPORT_ENDPOINT } from './csp.js';
import { csrfToken } from './csrf.js';
import { kovoSecurityReportSnapshot, resetKovoSecurityReportsForTest } from './reporting.js';
import { domain } from './domain.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { registerGeneratedMutationTouchRegistry } from './generated-mutation-registry.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { registerGeneratedLiveTargetRenderer } from './live-target-registry.js';
import { layout, route } from './route.js';
import { s } from './schema.js';
import { stylesheet } from './hints.js';
import { renderedHtml } from './html.js';
import { createLiveTargetAttestation } from './mutation-wire.js';

function attestedLiveTargetHeader(
  target: string,
  component: string,
  props: Record<string, unknown> = {},
  csrf?: { secret: string; sessionId: (request: unknown) => string | undefined },
): string {
  // SPEC §9.3: the live-target attestation is bound to the CSRF secret + session principal, so an
  // app configured with `csrf` must mint the test attestation under the same keyring/principal.
  const token = createLiveTargetAttestation(
    { component, props, target },
    { ...(csrf === undefined ? {} : { csrf }), request: {} },
  );
  return `${target}#${component}@${token}:${JSON.stringify(props)}`;
}

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

function expectReservedSystemResponsePosture(response: Response, buildToken: string): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('kovo-build')).toBe(buildToken);
}

describe('framework-owned CSP reporting endpoint (OPP-14)', () => {
  it('accepts browser CSP reports on the reserved framework endpoint', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify([{ type: 'csp-violation', body: { blockedURL: 'inline' } }]),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(kovoSecurityReportSnapshot(app).aggregates).toMatchObject([
      { count: 1, report: { blocked: 'inline', type: 'csp-violation' } },
    ]);
  });

  it('accepts CSP reports even when the app body-size cap is smaller than the report', async () => {
    const handler = createRequestHandler(createApp({ requestLimits: { maxBodyBytes: 1 } }));
    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify({ type: 'csp-violation', body: { blockedURL: 'inline' } }),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
  });

  it('redacts report URLs and aggregates repeated report fingerprints', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    const body = [
      {
        body: {
          blockedURL: 'https://cdn.example.test/script.js?token=secret#hash',
          documentURL: 'https://app.example.test/orders?session=secret',
          effectiveDirective: 'script-src',
          sample: 'do not store attacker-controlled source samples',
        },
        type: 'csp-violation',
        url: 'https://app.example.test/fallback?secret=1',
        user_agent: 'do not store user agents',
      },
      {
        body: {
          blockedURL: 'https://cdn.example.test/script.js?other=secret',
          documentURL: 'https://app.example.test/orders?other=secret',
          effectiveDirective: 'script-src',
        },
        type: 'csp-violation',
      },
    ];

    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    expect(kovoSecurityReportSnapshot(app)).toMatchObject({
      aggregates: [
        {
          count: 2,
          report: {
            // L14 (SPEC §6.6): redaction now keeps only the origin (path/query/fragment
            // dropped) so a path-embedded secret can never persist in the "redacted" aggregate.
            blocked: 'https://cdn.example.test',
            document: 'https://app.example.test',
            type: 'csp-violation',
            violatedDirective: 'script-src',
          },
        },
      ],
      dropped: 0,
    });
  });

  // L14 (SPEC §6.6): redaction must strip secrets carried in URL *path* segments
  // (reset/magic-link/capability tokens), not only the query/fragment. The stored
  // aggregate the framework labels "redacted" must keep only the origin.
  it('redacts secrets embedded in CSP report URL path segments', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify({
          'csp-report': {
            'blocked-uri': 'https://evil.example.test/exfil/PATHSECRET-blocked-9f3a1c',
            'document-uri':
              'https://app.example.test/reset-password/PATHSECRET-9f3a1c?token=QUERYSECRET#QUERYSECRET',
            'violated-directive': 'img-src',
          },
        }),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    const snapshot = kovoSecurityReportSnapshot(app);
    expect(snapshot.aggregates[0]?.report).toMatchObject({
      blocked: 'https://evil.example.test',
      document: 'https://app.example.test',
      type: 'csp-violation',
      violatedDirective: 'img-src',
    });
    // The path/query/fragment secrets must not survive anywhere in the stored aggregate.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('PATHSECRET-9f3a1c');
    expect(serialized).not.toContain('PATHSECRET-blocked-9f3a1c');
    expect(serialized).not.toContain('QUERYSECRET');
  });

  it('normalizes legacy CSP, COOP, and Permissions Policy reports without storing raw samples', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify([
          {
            'csp-report': {
              'blocked-uri': 'data:text/html,secret',
              'document-uri': 'https://app.example.test/account?secret=1',
              'violated-directive': 'img-src',
            },
          },
          {
            body: {
              disposition: 'enforce',
              effectivePolicy: 'same-origin-allow-popups',
              openerURL: 'https://opener.example.test/path?secret=1',
            },
            type: 'coop',
          },
          {
            body: {
              disposition: 'enforce',
              featureId: 'camera',
              sourceFile: 'https://app.example.test/app.js?secret=1',
            },
            type: 'permissions-policy-violation',
          },
        ]),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(kovoSecurityReportSnapshot(app).aggregates).toMatchObject([
      {
        report: {
          blocked: 'data:',
          // L14 (SPEC §6.6): origin-only redaction drops the `/account` path segment.
          document: 'https://app.example.test',
          type: 'csp-violation',
          violatedDirective: 'img-src',
        },
      },
      {
        report: {
          disposition: 'enforce',
          effectivePolicy: 'same-origin-allow-popups',
          type: 'coop',
        },
      },
      {
        report: {
          disposition: 'enforce',
          feature: 'camera',
          type: 'permissions-policy-violation',
        },
      },
    ]);
  });

  it('bounds per-request report items and drops malformed oversized input quietly', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    // Vary by ORIGIN, not path: L14 redaction keeps only the origin, so distinct reports
    // must differ by origin to remain distinct aggregates after redaction.
    const reports = Array.from({ length: 25 }, (_unused, index) => ({
      body: { blockedURL: `https://cdn-${index}.example.test/script.js` },
      type: 'csp-violation',
    }));

    const many = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify(reports),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );
    const oversized = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: `{"type":"csp-violation","body":{"blockedURL":"${'x'.repeat(70_000)}"}}`,
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(many.status).toBe(204);
    expect(oversized.status).toBe(204);
    expect(kovoSecurityReportSnapshot(app).aggregates).toHaveLength(20);
    expect(kovoSecurityReportSnapshot(app).dropped).toBeGreaterThanOrEqual(6);
    resetKovoSecurityReportsForTest(app);
    expect(kovoSecurityReportSnapshot(app)).toEqual({ aggregates: [], dropped: 0 });
  });

  it('rejects non-POST CSP report requests without falling through to app routes', async () => {
    const appRoute = route(KOVO_CSP_REPORT_ENDPOINT, {
      page: () => trustedHtml('<main>app route should not win</main>'),
    });
    const handler = createRequestHandler(createApp({ routes: [appRoute] }));
    const response = await handler(new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.text()).toBe('');
  });
});

describe('server createApp request shell', () => {
  it('stores the closed app registries and options without adding middleware', () => {
    const productRoute = route('/products/:id', {});
    const statusEndpoint = endpoint('/status', {
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'status endpoint registry test',
      response: rawTextResponse,
    });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const sessionProvider = () => ({ user: { id: 'u1' } });
    const appStylesheet = stylesheet('./styles.css');

    const app = createApp({
      endpoints: [statusEndpoint],
      queries: [productQuery],
      routes: [productRoute],
      sessionProvider,
      stylesheets: [appStylesheet],
    });

    expect(app.routes).toEqual([productRoute]);
    expect(app.endpoints).toEqual([statusEndpoint]);
    expect(app.queries).toEqual([productQuery]);
    expect(app.mutations).toEqual([]);
    expect(app.stylesheets).toEqual([appStylesheet]);
    expect(app.diagnostics).toEqual([]);
    expect(app.sessionProvider).toBe(sessionProvider);
    expect(app.requestLimits.maxBodyBytes).toBeGreaterThan(0);
    expect(app.requestLimits.maxQueryListItems).toBe(100);
    expect(app.requestLimits.perIp).toMatchObject({ max: expect.any(Number), windowMs: 60_000 });
    expect(app.requestLimits.perIp).toMatchObject({ maxKeys: expect.any(Number) });
    expect(app.requestLimits.mutations.perIp).toMatchObject({
      max: expect.any(Number),
      maxKeys: expect.any(Number),
      windowMs: 60_000,
    });
    expect('use' in app).toBe(false);
  });

  it('uses compiler-registered live target renderers when createApp does not receive explicit wiring', () => {
    const renderer = {
      component: 'test/create-app-registered-live-target',
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    registerGeneratedLiveTargetRenderer(renderer);

    expect(
      createApp().liveTargetRenderers.filter(
        (candidate) => candidate.component === renderer.component,
      ),
    ).toEqual([renderer]);
    expect(createApp({ liveTargetRenderers: [] }).liveTargetRenderers).toEqual([]);
  });

  it('derives the app query registry from generated live target renderers and layouts', () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const explicitCartQuery = query('cart', {
      load: () => ({ count: 2 }),
      reads: [cart],
    });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const profileQuery = query('profile', {
      load: () => ({ name: 'Ada' }),
      reads: [],
    });
    const accountLayout = layout({
      queries: { profile: profileQuery },
      render: ({ profile }, _state, { children }) =>
        trustedHtml(`<main data-profile="${profile.name}">${String(children)}</main>`),
    });

    const app = createApp({
      liveTargetRenderers: [
        {
          component: 'components/cart/badge',
          queries: ['cart', 'product'],
          queryDefinitions: [cartQuery, productQuery],
          render: () => '<cart-badge>1</cart-badge>',
        },
      ],
      queries: [explicitCartQuery],
      routes: [
        route('/account', {
          layout: accountLayout,
          page: () => trustedHtml('<section>Account</section>'),
        }),
      ],
    });

    expect(app.queries).toEqual([explicitCartQuery, productQuery, profileQuery]);
  });

  it('injects compiler-registered mutation touch sites into app mutations', () => {
    const cart = domain('generated-cart-fallback');
    const addToCart = mutation('generated/cart/add-app', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler: (input) => input,
    });

    registerGeneratedMutationTouchRegistry({
      'generated/cart/add-app': [{ domain: 'generated-product', keys: 'arg:productId' }],
    });

    const app = createApp({ mutations: [addToCart] });

    expect(app.mutations[0]?.registry).toMatchObject({
      inferredTouches: [{ domain: 'generated-product', keys: 'arg:productId' }],
      touches: [cart],
    });
  });

  // H1 (SPEC §6.1 key-addressed mutation registry / §9.5 single keyed dispatch): two same-key
  // mutations make the second handler unreachable (app-mutation-request resolves with .find,
  // first-match-wins) while the compile-time invalidation registry last-write-wins the other
  // declaration. createApp must fail closed rather than silently shadow the second handler.
  it('rejects duplicate mutation keys at createApp build time (KV421 runtime sibling)', () => {
    const firstAdd = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });
    const secondAdd = mutation('cart/add', {
      input: s.object({ orderId: s.string() }),
      handler: (input) => input,
    });

    expect(() => createApp({ mutations: [firstAdd, secondAdd] })).toThrow(
      /two mutations with the same key "cart\/add"/,
    );
  });

  it('accepts distinct mutation keys at createApp build time', () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });
    const removeFromCart = mutation('cart/remove', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });

    const app = createApp({ mutations: [addToCart, removeFromCart] });
    expect(app.mutations.map((candidate) => candidate.key)).toEqual(['cart/add', 'cart/remove']);
  });

  it('injects compiler-registered query reads into app queries', () => {
    const catalogQuery = query('generatedCatalog', {
      load: () => ({ items: [] as string[] }),
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['generated-catalog'], query: 'generatedCatalog' },
    ]);

    const app = createApp({ queries: [catalogQuery] });

    expect(app.queries[0]?.reads).toEqual([{ key: 'generated-catalog' }]);
  });

  it('rejects malformed compiler-registered query reads', () => {
    expect(() =>
      registerGeneratedQueryReadRegistry([
        { domains: ['cart', 1], query: 'generatedBadQuery' },
      ] as unknown as [{ domains: string[]; query: string }]),
    ).toThrow('Generated query read registry received an invalid registry.');
  });

  it('rejects malformed compiler-registered mutation touch sites', () => {
    expect(() =>
      registerGeneratedMutationTouchRegistry({
        'generated/cart/bad': [{ domain: 'cart', keys: 1 }] as unknown as [
          { domain: string; keys: string },
        ],
      }),
    ).toThrow('Generated mutation touch registry received an invalid registry.');
  });

  it('rejects malformed compatibility shells before request dispatch', () => {
    const app = createApp({ routes: [route('/products/:id', {})] });
    const rawHandler = async () => new Response('<main>compat</main>');

    expect(() =>
      createRequestHandler(rawHandler as unknown as Parameters<typeof createRequestHandler>[0]),
    ).toThrow(
      'createRequestHandler() requires a Kovo app aggregate. SPEC §9.5 request dispatch must start from createApp(), not a raw request handler or compatibility shell.',
    );
    expect(() =>
      createRequestHandler({
        ...app,
        renderRoute: '<main>compat</main>',
      } as unknown as Parameters<typeof createRequestHandler>[0]),
    ).toThrow('createRequestHandler() requires a Kovo app aggregate.');
  });

  it('rejects malformed declaration entries before request dispatch', () => {
    const app = createApp({
      endpoints: [
        endpoint('/status', {
          handler: () => new Response('ok'),
          method: 'GET',
          reason: 'status endpoint registry test',
          response: rawTextResponse,
        }),
      ],
      mutations: [
        mutation('cart/add', {
          handler: () => ({ ok: true }),
          input: s.object({ productId: s.string() }),
        }),
      ],
      queries: [query('cart', { reads: [domain('cart')] })],
      routes: [route('/cart', { page: () => trustedHtml('<main>Cart</main>') })],
    });

    for (const malformedApp of [
      { ...app, endpoints: [{ path: '/status' }] },
      { ...app, mutations: [{ key: 'cart/add', handler: () => ({ ok: true }) }] },
      { ...app, queries: [{ key: 'cart', reads: [{ name: 'cart' }] }] },
      { ...app, routes: [{ page: () => trustedHtml('<main>Cart</main>') }] },
    ]) {
      expect(() =>
        createRequestHandler(malformedApp as unknown as Parameters<typeof createRequestHandler>[0]),
      ).toThrow('createRequestHandler() requires a Kovo app aggregate.');
    }
  });

  it('dispatches a matched route through Request to document Response', async () => {
    const productRoute = route('/products/:id', {
      meta: { title: 'Product' },
      page({ params, search }) {
        return renderedHtml(`<main>${params.id}:${search.tab}</main>`);
      },
      search: s.object({ tab: s.string() }),
    });
    const handler = createRequestHandler(createApp({ routes: [productRoute] }));

    const response = await handler(new Request('https://example.test/products/p1?tab=details'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('<main>p1:details</main>');
  });

  it('serves enhanced navigation documents without resending the inline loader', async () => {
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/products/:id', {
            meta: { title: 'Product' },
            params: s.object({ id: s.string() }),
            page({ params }) {
              return renderedHtml(
                `<main kovo-nav-segment="page:/products/:id">${params.id}</main>`,
              );
            },
          }),
        ],
      }),
    );

    const full = await handler(new Request('https://example.test/products/p1'));
    const enhanced = await handler(
      new Request('https://example.test/products/p1', {
        headers: { Accept: enhancedNavigationDocumentAcceptHeader },
      }),
    );

    expect(full.status).toBe(200);
    expect(enhanced.status).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(enhanced.headers.get('vary')).toBe('Accept');

    const fullBody = await full.text();
    const enhancedBody = await enhanced.text();
    expect(fullBody).toContain('installInlineKovoBootstrap');
    expect(fullBody).toContain('/c/__v/');
    expect(fullBody).toContain('/kovo-runtime.client.js');
    expect(fullBody).toMatch(
      /\)\("\/c\/__v\/[^"]+\/kovo-runtime\.client\.js",\(url\)=>import\(url\)\);/,
    );
    expect(enhancedBody).not.toContain('installInlineKovoBootstrap');
    expect(enhancedBody).not.toContain('installInlineKovoLoader');
    expect(enhancedBody).toContain('<title>Product</title>');
    expect(enhancedBody).toContain('<meta name="kovo-build"');
    expect(enhancedBody).toContain('<main kovo-nav-segment="page:/products/:id">p1</main>');
  });

  it('normalizes trailing slashes before dispatching routes', async () => {
    const handler = createRequestHandler(createApp({ routes: [route('/products/:id', {})] }));

    const response = await handler(new Request('https://example.test/products/p1/?tab=details'));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/products/p1?tab=details');
    await expect(response.text()).resolves.toBe('');
  });

  it('returns stable 404 and page-method responses', async () => {
    const handler = createRequestHandler(createApp({ routes: [route('/products/:id', {})] }));

    const missing = await handler(new Request('https://example.test/missing'));
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain('<h1>Not Found</h1>');

    const method = await handler(
      new Request('https://example.test/products/p1', { method: 'POST' }),
    );
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, HEAD');
    await expect(method.text()).resolves.toBe('Method Not Allowed');
  });

  it('blocks ambiguous route tables with KV228 before declaration-order dispatch', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', { page: () => trustedHtml('<main>Param</main>') }),
        route('/products/new', { page: () => trustedHtml('<main>New</main>') }),
      ],
    });

    expect(app.diagnostics).toEqual([
      {
        code: 'KV228',
        fileName: '/products/:id <-> /products/new',
        help: expect.stringContaining('SPEC §9.5'),
        message:
          "Ambiguous route table: '/products/:id' and '/products/new' can both match canonical request path '/products/new'.",
      },
    ]);

    const response = await createRequestHandler(app)(
      new Request('https://example.test/products/new'),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('<p class="kovo-diagnostic-code">KV228</p>');
    expect(body).toContain('/products/:id &lt;-&gt; /products/new');
    expect(body).not.toContain('<main>New</main>');
  });

  it('renders configured error shells through the app request boundary', async () => {
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound({ request, status }) {
            const url = new URL(request.url);
            return {
              body: `<main>${status}:${url.pathname}</main>`,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status,
            };
          },
        },
      }),
    );

    const response = await handler(new Request('https://example.test/missing'));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('<main>404:/missing</main>');
  });

  it('reports failing error shells and falls back to stable no-internals documents', async () => {
    const shellError = new Error('private shell detail');
    const onError = vi.fn();
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound() {
            throw shellError;
          },
        },
        onError,
      }),
    );
    const request = new Request('https://example.test/missing?from=test');

    const response = await handler(request);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('<h1>Not Found</h1>');
    expect(body).not.toContain('private shell detail');
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request,
      status: 404,
      url: '/missing?from=test',
    });
  });

  it('keeps app request failures private when the configured 500 shell also fails', async () => {
    const endpointError = new Error('private endpoint detail');
    const shellError = new Error('private 500 shell detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw endpointError;
      },
      method: 'GET',
      reason: 'failing status endpoint',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [statusEndpoint],
        errorShells: {
          serverError() {
            throw shellError;
          },
        },
        onError,
      }),
    );
    const request = new Request('https://example.test/status');

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('<h1>Server Error</h1>');
    expect(body).not.toContain('private endpoint detail');
    expect(body).not.toContain('private 500 shell detail');
    expect(onError).toHaveBeenCalledWith(endpointError, {
      operation: 'app-request',
      request,
      url: '/status',
    });
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request,
      status: 500,
      url: '/status',
    });
  });

  // SPEC §9.5: the request shell owns the pre-dispatch body-size gate because
  // there is no user middleware chain. It must reject before endpoint raw-body
  // handlers can read or parse the request.
  it('rejects oversized requests with 413 before endpoint dispatch', async () => {
    const endpointHandler = vi.fn(() => new Response('ok'));
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/upload', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'oversized upload endpoint gate',
            response: rawTextResponse,
          }),
        ],
        requestLimits: {
          global: false,
          maxBodyBytes: 4,
          perIp: false,
          queries: { global: false, perIp: false },
          mutations: { global: false, perIp: false },
        },
      }),
    );

    const response = await handler(
      new Request('https://example.test/upload', {
        body: '12345',
        headers: { 'Content-Length': '5' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('vary')).toBeNull();
    expect(response.headers.get('kovo-build')).toBeNull();
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
  });

  it('enforces the default request body cap before endpoint dispatch', async () => {
    const endpointHandler = vi.fn(() => new Response('ok'));
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/default-upload-cap', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'default request body cap',
            response: rawTextResponse,
          }),
        ],
      }),
    );

    const response = await handler(
      new Request('https://example.test/default-upload-cap', {
        body: '',
        headers: { 'Content-Length': String(1_048_577) },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
  });

  // SPEC §9.1.1/§9.4: framework-owned pre-dispatch system responses for
  // reserved mutation/query endpoints carry the same private cache posture and
  // build-token skew signal as dispatched mutation/query responses.
  it.each([
    ['mutation', 'https://example.test/_m/cart/oversized', 'POST'],
    ['query', 'https://example.test/_q/cart-oversized', 'POST'],
  ] as const)('stamps reserved %s 413 responses before dispatch', async (_surface, url, method) => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const queryLoad = vi.fn(() => ({ count: 1 }));
    const app = createApp({
      mutations: [
        mutation('cart/oversized', {
          csrf: false,
          handler: mutationHandler,
          input: s.object({}),
        }),
      ],
      queries: [
        query('cart-oversized', {
          load: queryLoad,
          reads: [],
        }),
      ],
      requestLimits: {
        global: false,
        maxBodyBytes: 4,
        mutations: { global: false, perIp: false },
        perIp: false,
        queries: { global: false, perIp: false },
      },
    });
    const handler = createRequestHandler(app);

    const response = await handler(
      new Request(url, {
        body: '12345',
        headers: { 'Content-Length': '5' },
        method,
      }),
    );

    expect(response.status).toBe(413);
    expectReservedSystemResponsePosture(response, app.clientModules.buildToken());
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(mutationHandler).not.toHaveBeenCalled();
    expect(queryLoad).not.toHaveBeenCalled();
  });

  it('rejects oversized streamed endpoint bodies before dispatch', async () => {
    let sideEffects = 0;
    const endpointHandler = vi.fn(async (request: Request) => {
      sideEffects += 1;
      return new Response(await request.text());
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/stream-upload', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'streamed upload body cap',
            response: rawTextResponse,
          }),
        ],
        requestLimits: {
          global: false,
          maxBodyBytes: 4,
          mutations: { global: false, perIp: false },
          perIp: false,
          queries: { global: false, perIp: false },
        },
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12'));
        controller.enqueue(new TextEncoder().encode('345'));
        controller.close();
      },
    });

    const response = await handler(
      new Request('https://example.test/stream-upload', {
        body,
        method: 'POST',
        // Node/fetch requires duplex when a ReadableStream body is supplied.
        duplex: 'half',
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
    expect(sideEffects).toBe(0);
  });

  it('preserves request extensions after endpoint body-limit preflight', async () => {
    const upload = endpoint('/extension-upload', {
      csrf: false,
      csrfJustification: 'test endpoint uses a non-browser caller',
      handler(request) {
        return new Response(String((request as Request & { db?: string }).db));
      },
      method: 'POST',
      reason: 'request extension preservation test',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(createApp({ endpoints: [upload] }));
    const request = new Request('https://example.test/extension-upload', {
      body: 'ok',
      method: 'POST',
    });
    Object.defineProperty(request, 'db', {
      configurable: true,
      value: 'fixture-db',
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('fixture-db');
  });

  // SPEC §9.5 / §10.3: coarse per-IP mutation limiting runs before replay, parse,
  // and guards, so the second request cannot execute the mutation handler.
  it('rate-limits mutation requests before parsing or running the handler', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const addToCart = mutation('cart/add-rate-limited', {
      csrf: false,
      input: s.object({ quantity: s.number().default(1) }),
      handler: mutationHandler,
    });
    const app = createApp({
      mutations: [addToCart],
      requestLimits: {
        global: false,
        maxBodyBytes: false,
        perIp: false,
        queries: { global: false, perIp: false },
        mutations: { global: false, perIp: { max: 1, windowMs: 60_000 } },
      },
    });
    const handler = createRequestHandler(app);
    const request = () =>
      new Request('https://example.test/_m/cart/add-rate-limited', {
        body: new URLSearchParams({ quantity: '2' }),
        headers: { 'X-Forwarded-For': '203.0.113.9' },
        method: 'POST',
      });

    expect((await handler(request())).status).toBe(303);

    const limited = await handler(request());

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expectReservedSystemResponsePosture(limited, app.clientModules.buildToken());
    expect(limited.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(limited.text()).resolves.toBe('Too Many Requests');
    expect(mutationHandler).toHaveBeenCalledTimes(1);
  });

  it('ignores spoofed forwarded IP headers unless trustedProxy is enabled', async () => {
    const makeHandler = (trustedProxy = false) =>
      createRequestHandler(
        createApp({
          mutations: [
            mutation(`cart/proxy-${trustedProxy ? 'trusted' : 'untrusted'}`, {
              csrf: false,
              handler: () => ({ ok: true }),
              input: s.object({}),
            }),
          ],
          requestLimits: {
            global: false,
            maxBodyBytes: false,
            mutations: { global: false, perIp: { max: 1, windowMs: 60_000 } },
            perIp: false,
            queries: { global: false, perIp: false },
            trustedProxy,
          },
        }),
      );
    const request = (key: string, forwardedFor: string) =>
      new Request(`https://example.test/_m/${key}`, {
        body: new URLSearchParams(),
        headers: { 'X-Forwarded-For': forwardedFor },
        method: 'POST',
      });

    const untrusted = makeHandler(false);
    expect((await untrusted(request('cart/proxy-untrusted', '203.0.113.1'))).status).toBe(303);
    expect((await untrusted(request('cart/proxy-untrusted', '203.0.113.2'))).status).toBe(429);

    const trusted = makeHandler(true);
    expect((await trusted(request('cart/proxy-trusted', '203.0.113.1'))).status).toBe(303);
    expect((await trusted(request('cart/proxy-trusted', '203.0.113.2'))).status).toBe(303);
  });

  it('bounds app request-limit key cardinality across windows while preserving active retry-after', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'));
    const addToCart = mutation('cart/bounded-rate-keys', {
      csrf: false,
      input: s.object({}),
      handler: () => ({ ok: true }),
    });
    const app = createApp({
      mutations: [addToCart],
      requestLimits: {
        global: false,
        maxBodyBytes: false,
        mutations: { global: false, perIp: { max: 1, maxKeys: 8, windowMs: 60_000 } },
        perIp: false,
        queries: { global: false, perIp: false },
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = (index: number) =>
      new Request('https://example.test/_m/cart/bounded-rate-keys', {
        body: new URLSearchParams(),
        headers: { 'X-Forwarded-For': `203.0.${Math.floor(index / 255)}.${index % 255}` },
        method: 'POST',
      });

    try {
      for (let windowIndex = 0; windowIndex < 2; windowIndex += 1) {
        const baseIndex = windowIndex * 1_024;
        for (let offset = 0; offset < 1_024; offset += 1) {
          expect((await handler(request(baseIndex + offset))).status).toBe(303);
          expect(appRateLimitKeyCounts(app).perIp).toBeLessThanOrEqual(8);
        }

        const activeLimited = await handler(request(baseIndex + 1_023));
        expect(activeLimited.status).toBe(429);
        expect(activeLimited.headers.get('retry-after')).toBe('60');
        expect(appRateLimitKeyCounts(app).perIp).toBeLessThanOrEqual(8);

        vi.advanceTimersByTime(60_001);
      }

      const evictedOldest = await handler(request(0));
      expect(evictedOldest.status).toBe(303);
      expect(appRateLimitKeyCounts(app).perIp).toBeLessThanOrEqual(8);
    } finally {
      vi.useRealTimers();
    }
  });

  // SPEC §9.5 / §9.4: typed reads also pass through the shell's anonymous-flood
  // limiter before args parsing or query loading.
  it('rate-limits query requests before loading the query', async () => {
    const queryLoad = vi.fn(() => ({ count: 1 }));
    const cartQuery = query('cart-rate-limited', {
      load: queryLoad,
      reads: [],
    });
    const app = createApp({
      queries: [cartQuery],
      requestLimits: {
        global: false,
        maxBodyBytes: false,
        perIp: false,
        mutations: { global: false, perIp: false },
        queries: { global: { max: 1, windowMs: 60_000 }, perIp: false },
      },
    });
    const handler = createRequestHandler(app);

    expect((await handler(new Request('https://example.test/_q/cart-rate-limited'))).status).toBe(
      200,
    );

    const limited = await handler(new Request('https://example.test/_q/cart-rate-limited'));

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expectReservedSystemResponsePosture(limited, app.clientModules.buildToken());
    expect(limited.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(limited.text()).resolves.toBe('Too Many Requests');
    expect(queryLoad).toHaveBeenCalledTimes(1);
  });

  it('opts up the query list result ceiling for explicit large reads', async () => {
    const catalogQuery = query('catalog-large-read', {
      load: () => ({ rows: Array.from({ length: 4 }, (_, id) => ({ id })) }),
      reads: [],
    });
    const handler = createRequestHandler(
      createApp({
        queries: [catalogQuery],
        requestLimits: {
          global: false,
          maxBodyBytes: false,
          maxQueryListItems: 4,
          mutations: { global: false, perIp: false },
          perIp: false,
          queries: { global: false, perIp: false },
        },
      }),
    );

    const response = await handler(new Request('https://example.test/_q/catalog-large-read'));

    expect(response.status).toBe(200);
    expect(response.headers.get('kovo-warn')).toBeNull();
    await expect(response.text()).resolves.toContain(
      '"rows":[{"id":0},{"id":1},{"id":2},{"id":3}]',
    );
  });

  it('stamps reserved normalization redirects without changing route redirect caching', async () => {
    const reservedApp = createApp({
      queries: [
        query('cart-normalized', {
          load: () => ({ count: 1 }),
          reads: [],
        }),
      ],
    });
    const reservedHandler = createRequestHandler(reservedApp);

    const reservedRedirect = await reservedHandler(
      new Request('https://example.test//_q/cart-normalized'),
    );

    expect(reservedRedirect.status).toBe(308);
    expect(reservedRedirect.headers.get('location')).toBe('/_q/cart-normalized');
    expectReservedSystemResponsePosture(reservedRedirect, reservedApp.clientModules.buildToken());
    expect(reservedRedirect.headers.get('x-content-type-options')).toBeNull();

    const routeHandler = createRequestHandler(
      createApp({
        routes: [route('/docs', { page: () => trustedHtml('<main>Docs</main>') })],
      }),
    );
    const routeRedirect = await routeHandler(new Request('https://example.test//docs'));

    expect(routeRedirect.status).toBe(308);
    expect(routeRedirect.headers.get('location')).toBe('/docs');
    expect(routeRedirect.headers.get('cache-control')).toBeNull();
    expect(routeRedirect.headers.get('vary')).toBeNull();
    expect(routeRedirect.headers.get('kovo-build')).toBeNull();
  });

  it('dispatches endpoints before routes and strips ambient session from endpoint requests', async () => {
    const statusEndpoint = endpoint('/status', {
      handler(request) {
        expect('session' in request).toBe(false);
        return new Response('endpoint');
      },
      method: 'GET',
      reason: 'endpoint-before-route dispatch test',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [statusEndpoint],
        routes: [route('/status', { page: () => trustedHtml('route') })],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );

    const response = await handler(new Request('https://example.test/status'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('endpoint');
  });

  it('reports app catch-all exceptions without leaking endpoint internals', async () => {
    const thrown = new Error('private endpoint detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw thrown;
      },
      method: 'GET',
      reason: 'failing endpoint error reporting',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(createApp({ endpoints: [statusEndpoint], onError }));
    const request = new Request('https://example.test/status?check=true');

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('<h1>Server Error</h1>');
    expect(body).not.toContain('private endpoint detail');
    expect(onError).toHaveBeenCalledWith(thrown, {
      operation: 'app-request',
      request,
      url: '/status?check=true',
    });
  });

  it('resolves session once for a guarded route request', async () => {
    let sessionReads = 0;
    const adminRoute = route('/admin', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      page(_context, request) {
        return renderedHtml(`admin:${request.session.user.id}`);
      },
    });
    const handler = createRequestHandler(
      createApp({
        routes: [adminRoute],
        sessionProvider() {
          sessionReads += 1;
          return { user: { id: 'u1' } };
        },
      }),
    );

    const response = await handler(new Request('https://example.test/admin'));

    expect(sessionReads).toBe(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('admin:u1');
  });

  it('provisions db and session through createApp for routes, queries, and enhanced refresh', async () => {
    interface AppDb {
      count: number;
      reads: string[];
      writes: string[];
    }

    type AppRequest = Request & {
      db: AppDb;
      session: { user: { id: string } } | null;
    };

    const db: AppDb = { count: 1, reads: [], writes: [] };
    const cart = domain('cart');
    // SPEC §6.6/§9.1: a session-authenticated mutation must stay CSRF-checked (KV418 forbids the
    // `csrf: false` + session combination), so the cart mutation is protected by a synchronizer
    // token bound to the app session id.
    const csrf = { secret: 'provision-db-session-secret-key-0123456789', sessionId: () => 's1' };
    const cartQuery = query('cart', {
      load(_input, context?: { request: AppRequest }) {
        context?.request.db.reads.push(context.request.session?.user.id ?? 'anonymous');
        return { count: context?.request.db.count ?? 0 };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ quantity: s.number().int().min(1).default(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, request: AppRequest) {
        request.db.count += input.quantity;
        request.db.writes.push(request.session?.user.id ?? 'anonymous');
        return { count: request.db.count };
      },
    });
    const handler = createRequestHandler(
      createApp({
        csrf,
        db: () => db,
        endpoints: [
          endpoint('/webhook', {
            csrf: false,
            csrfJustification: 'signed provider test endpoint',
            handler(request) {
              const endpointRequest = request as Request & { db: AppDb; session?: never };
              expect('session' in endpointRequest).toBe(false);
              endpointRequest.db.writes.push('endpoint');
              return new Response(`endpoint:${endpointRequest.db.count}`);
            },
            method: 'POST',
            reason: 'provider webhook db wiring test',
            response: rawTextResponse,
          }),
        ],
        liveTargetRenderers: [
          {
            component: 'components/cart/badge',
            queries: ['cart'],
            render({ request }: { request: AppRequest }) {
              return `<cart-badge>${request.db.count}:${request.session?.user.id}</cart-badge>`;
            },
          },
        ],
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [
          route('/cart', {
            page(_context, request: AppRequest) {
              return renderedHtml(`<main>${request.db.count}:${request.session?.user.id}</main>`);
            },
          }),
        ],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );

    const routeResponse = await handler(new Request('https://example.test/cart'));
    expect(routeResponse.status).toBe(200);
    await expect(routeResponse.text()).resolves.toContain('<main>1:u1</main>');

    const queryResponse = await handler(new Request('https://example.test/_q/cart'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<kovo-query name="cart">{"count":1}</kovo-query>',
    );

    const form = new FormData();
    form.set('quantity', '2');
    form.set('kovo-csrf', csrfToken({}, csrf, { audience: 'cart/add' }));
    const mutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: form,
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart', 'components/cart/badge', {}, csrf)}`,
          'Kovo-Targets': 'cart=cart',
          origin: 'https://example.test',
        },
        method: 'POST',
      }),
    );

    expect(mutationResponse.status).toBe(200);
    await expect(mutationResponse.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":3}</kovo-query>',
        '<kovo-fragment target="cart"><cart-badge>3:u1</cart-badge></kovo-fragment>',
      ].join('\n'),
    );
    expect(db.reads).toEqual(['u1', 'u1']);
    expect(db.writes).toEqual(['u1']);

    const endpointResponse = await handler(
      new Request('https://example.test/webhook', { method: 'POST' }),
    );
    expect(endpointResponse.status).toBe(200);
    await expect(endpointResponse.text()).resolves.toBe('endpoint:3');
    expect(db.writes).toEqual(['u1', 'endpoint']);
  });

  it('reruns layout query chunks from generated layout live-target stamps', async () => {
    const cart = domain('cart');
    const db = { count: 1 };
    const cartQuery = query('cart', {
      load: () => ({ count: db.count }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({}),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler() {
        db.count += 1;
        return { count: db.count };
      },
    });
    const CartLayout = layout({
      queries: { cart: cartQuery },
      render: ({ cart }, _state, { children }) =>
        trustedHtml(
          `<main><output data-bind="cart.count">${cart.count}</output>${String(children)}</main>`,
        ),
    });
    const handler = createRequestHandler(
      createApp({
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [
          route('/cart', {
            layout: CartLayout,
            page: () => trustedHtml('<section>Cart</section>'),
          }),
        ],
      }),
    );

    const routeResponse = await handler(new Request('https://example.test/cart'));
    const routeHtml = await routeResponse.text();
    const layoutTarget = /<main[^>]*kovo-fragment-target="([^"]+)"/.exec(routeHtml)?.[1];
    expect(layoutTarget).toMatch(/^kovo-layout-/);
    expect(routeHtml).toContain('kovo-deps="cart"');

    const mutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: new FormData(),
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Targets': `${layoutTarget}=cart`,
        },
        method: 'POST',
      }),
    );

    expect(mutationResponse.status).toBe(200);
    await expect(mutationResponse.text()).resolves.toBe(
      '<kovo-query name="cart">{"count":2}</kovo-query>',
    );
  });

  it('dispatches stored query and client-module registries through web Responses', async () => {
    const app = createApp({
      queries: [
        query('cart', {
          args: s.object({ id: s.string() }),
          load: (input: { id: string }) => ({ id: input.id, total: 42 }),
          reads: [],
        }),
      ],
    });
    const href = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const ok = true;',
      version: 'v1',
    });
    expect(href).toBe(versionedClientModuleHref('/c/cart.client.js', 'v1'));

    const handler = createRequestHandler(app);

    const queryResponse = await handler(new Request('https://example.test/_q/cart?id=c1'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<kovo-query name="cart">{"id":"c1","total":42}</kovo-query>',
    );

    const moduleResponse = await handler(new Request(`https://example.test${href}`));
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toBe('export const ok = true;');
  });

  it('dispatches mutation POSTs through the reserved app shell path', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const handler = createRequestHandler(
      createApp({
        liveTargetRenderers: [
          {
            component: 'components/cart/badge',
            queries: ['cart'],
            queryDefinitions: [cartQuery],
            render: () => '<cart-badge>1</cart-badge>',
          },
        ],
        mutationResponses: {
          'cart/add': { redirectTo: '/cart' },
        },
        mutations: [addToCart],
      }),
    );
    const enhancedForm = new FormData();
    enhancedForm.set('productId', 'p1');
    enhancedForm.set('quantity', '1');

    const enhanced = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: enhancedForm,
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart', 'components/cart/badge')}`,
          'Kovo-Targets': 'cart=cart',
        },
        method: 'POST',
      }),
    );
    expect(enhanced.status).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    await expect(enhanced.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="cart"><cart-badge>1</cart-badge></kovo-fragment>',
      ].join('\n'),
    );

    const noJsForm = new FormData();
    noJsForm.set('productId', 'p1');
    const noJs = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: noJsForm,
        method: 'POST',
      }),
    );
    expect(noJs.status).toBe(303);
    expect(noJs.headers.get('location')).toBe('/cart');
    await expect(noJs.text()).resolves.toBe('');
  });

  it('dispatches enhanced mutation fragments through app live target renderers', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const renderCartPanel = vi.fn(({ props }: { props: Record<string, unknown> }) => {
      return `<cart-panel>${String(props.cartId)}</cart-panel>`;
    });
    const handler = createRequestHandler(
      createApp({
        liveTargetRenderers: [
          {
            component: 'components/cart/panel',
            queries: ['cart'],
            queryDefinitions: [cartQuery],
            render: renderCartPanel,
          },
        ],
        mutations: [addToCart],
        queries: [cartQuery],
      }),
    );
    const form = new FormData();
    form.set('productId', 'p1');

    const response = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: form,
        headers: {
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-panel', 'components/cart/panel', { cartId: 'c1' })}`,
          'Kovo-Targets': 'cart-panel=cart',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="cart-panel"><cart-panel>c1</cart-panel></kovo-fragment>',
      ].join('\n'),
    );
    expect(renderCartPanel).toHaveBeenCalledOnce();
  });
});
