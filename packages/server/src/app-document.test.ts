import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { renderAppErrorDocumentResponse, renderAppRouteDocumentResponse } from './app-document.js';
import { defer } from './deferred-region.js';
import { guards } from './guards.js';
import { renderedHtml } from './html.js';
import { stylesheet } from './hints.js';
import { layout, notFound, route } from './route.js';
import {
  computeRenderPlanFingerprint,
  createMemoryVersionedClientModuleRegistry,
} from './client-modules.js';

// ─── DEPLOY-3: module-less app always stamps kovo-build ───────────────────────

describe('kovo-build meta always stamped (DEPLOY-3, D1)', () => {
  it('a module-less app stamps a non-empty kovo-build meta (DEPLOY-3)', async () => {
    // SPEC §5.2.1 rule 2(b): every full page render must carry the build token.
    // Before the fix, buildToken() returned '' for apps with no client modules,
    // and the meta was omitted entirely.
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({ routes: [homeRoute] });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.status).toBe(200);
    const body = response.body as string;
    // The meta MUST be present and its content must be non-empty.
    const match = body.match(/<meta name="kovo-build" content="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBeTruthy();
  });

  it('render-plan fingerprint flows through registry into the kovo-build meta (D1)', async () => {
    // Two identical apps whose registries differ only by renderPlanFingerprint must
    // emit different kovo-build meta content values.
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });

    const makeApp = (fingerprint: string) => {
      const registry = createMemoryVersionedClientModuleRegistry({
        renderPlanFingerprint: fingerprint,
      });
      registry.put({ path: '/c/cart.client.js', source: 'export {}', version: 'v1' });
      const app = createApp({ routes: [homeRoute] });
      app.clientModules = registry;
      return app;
    };

    const fp1 = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    const fp2 = computeRenderPlanFingerprint({ cart: 'field:id,total' });

    const [resA, resB] = await Promise.all([
      renderAppRouteDocumentResponse({
        app: makeApp(fp1),
        params: {},
        request: new Request('https://example.test/'),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
      renderAppRouteDocumentResponse({
        app: makeApp(fp2),
        params: {},
        request: new Request('https://example.test/'),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
    ]);

    const extract = (body: string) => body.match(/<meta name="kovo-build" content="([^"]*)"/)?.[1];

    const tokenA = extract(resA.body as string);
    const tokenB = extract(resB.body as string);

    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
  });
});

// ─── K3: session fingerprint derives from session identity, not cookie header ──

describe('sessionFingerprintFromRequest — session-anchored (K3, SPEC §9.3)', () => {
  it('two requests with the same session id but different extra cookies produce the same fingerprint (K3)', async () => {
    // SPEC §9.3: fingerprint must be derived from session identity, not full cookie header.
    // Before the fix, any CSRF/theme cookie churn produced a different fingerprint.
    const homeRoute = route('/', {
      page: () => trustedHtml('<main>Home</main>'),
    });

    const makeRequest = (cookies: string) =>
      new Request('https://example.test/', { headers: { cookie: cookies } });

    // Both requests carry the same session id but different extra cookies.
    const reqSameSessionA = makeRequest('session=sess-abc; csrf=tok1; theme=dark');
    const reqSameSessionB = makeRequest('session=sess-abc; csrf=tok2; theme=light');

    // Set up a simple session provider that reads session.id from the cookie.
    const sessionProvider = (req: Request) => {
      const cookie = req.headers.get('cookie') ?? '';
      const match = cookie.match(/session=([^;]+)/);
      return match ? { id: match[1] } : null;
    };

    const app = createApp({
      routes: [homeRoute],
      sessionProvider,
    });

    const [resA, resB] = await Promise.all([
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: reqSameSessionA,
        route: homeRoute,
        url: new URL(reqSameSessionA.url),
      }),
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: reqSameSessionB,
        route: homeRoute,
        url: new URL(reqSameSessionB.url),
      }),
    ]);

    const extractSession = (body: string) =>
      body.match(/<meta name="kovo-session" content="([^"]*)"/)?.[1];

    const fpA = extractSession(resA.body as string);
    const fpB = extractSession(resB.body as string);

    // Same session id → same fingerprint even with different extra cookies.
    expect(fpA).toBeDefined();
    expect(fpB).toBeDefined();
    expect(fpA).toBe(fpB);
  });

  it('different session ids produce different fingerprints (K3)', async () => {
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });

    const makeReq = (sessionId: string) =>
      new Request('https://example.test/', {
        headers: { cookie: `session=${sessionId}; extra=same` },
      });

    const sessionProvider = (req: Request) => {
      const cookie = req.headers.get('cookie') ?? '';
      const match = cookie.match(/session=([^;]+)/);
      return match ? { id: match[1] } : null;
    };

    const app = createApp({ routes: [homeRoute], sessionProvider });

    const [resA, resB] = await Promise.all([
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: makeReq('user-1'),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: makeReq('user-2'),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
    ]);

    const extract = (body: string) =>
      body.match(/<meta name="kovo-session" content="([^"]*)"/)?.[1];

    const fpA = extract(resA.body as string);
    const fpB = extract(resB.body as string);

    expect(fpA).toBeDefined();
    expect(fpB).toBeDefined();
    expect(fpA).not.toBe(fpB);
  });

  it('stamps fingerprints from non-cookie sessions resolved by the lifecycle request', async () => {
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({
      routes: [homeRoute],
      sessionProvider(request) {
        const id = request.headers.get('x-session-id');
        return id ? { id } : null;
      },
    });

    const [resA, resB] = await Promise.all([
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: new Request('https://example.test/', { headers: { 'x-session-id': 'alpha' } }),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: new Request('https://example.test/', { headers: { 'x-session-id': 'beta' } }),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
    ]);

    const extract = (body: string) =>
      body.match(/<meta name="kovo-session" content="([^"]*)"/)?.[1];

    const fpA = extract(resA.body as string);
    const fpB = extract(resB.body as string);
    expect(fpA).toBeDefined();
    expect(fpB).toBeDefined();
    expect(fpA).not.toBe(fpB);
  });

  it('uses a resolved second-cookie session instead of collapsing on an identical first cookie', async () => {
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const sessionProvider = (request: Request) => {
      const cookie = request.headers.get('cookie') ?? '';
      const match = cookie.match(/(?:^|; )sid=([^;]+)/);
      return match ? { id: match[1] } : null;
    };
    const app = createApp({ routes: [homeRoute], sessionProvider });

    const [resA, resB] = await Promise.all([
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: new Request('https://example.test/', {
          headers: { cookie: 'theme=light; sid=user-a' },
        }),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
      renderAppRouteDocumentResponse({
        app,
        params: {},
        request: new Request('https://example.test/', {
          headers: { cookie: 'theme=light; sid=user-b' },
        }),
        route: homeRoute,
        url: new URL('https://example.test/'),
      }),
    ]);

    const extract = (body: string) =>
      body.match(/<meta name="kovo-session" content="([^"]*)"/)?.[1];

    expect(extract(resA.body as string)).not.toBe(extract(resB.body as string));
  });

  it('does not derive broadcast fingerprints from cookies without a resolved session', async () => {
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({ routes: [homeRoute] });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/', { headers: { cookie: 'session=ambient' } }),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.body).not.toContain('kovo-session');
  });

  it('anonymous request (no cookies) produces no kovo-session meta (K3)', async () => {
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({ routes: [homeRoute] });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.body).not.toContain('kovo-session');
  });
});

// ─── SF (secure-framework Tier 3, SPEC §6.6): app-config CSP allowlist threading ──

describe('createApp({ document: { csp } }) threads CSP allowlist into document CSP', () => {
  const cspHeader = (headers: Record<string, string | readonly string[]>): string => {
    const name = Object.keys(headers).find(
      (key) => key.toLowerCase() === 'content-security-policy',
    );
    const value = name === undefined ? undefined : headers[name];
    return Array.isArray(value) ? value.join('; ') : ((value as string | undefined) ?? '');
  };

  it('APPENDS the app allowlist origins to the overridable per-fetch directives', async () => {
    // SPEC §6.6 runtime DiD (cross-browser floor — NOT a by-construction proof): an app
    // declares its analytics/Stripe/embed origins via `createApp({ document: { csp:
    // { allowlist } } })`; those origins MUST appear on the auto-attached document CSP.
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({
      document: {
        csp: {
          allowlist: {
            scriptSrc: ['https://cdn.analytics.test'],
            connectSrc: ['https://api.stripe.test'],
            frameSrc: ['https://checkout.stripe.test'],
            imgSrc: ['https://images.cdn.test'],
            styleSrc: ['https://fonts.cdn.test'],
          },
        },
      },
      routes: [homeRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    const csp = cspHeader(response.headers);
    expect(csp).toContain("script-src 'self' https://cdn.analytics.test");
    expect(csp).toContain("style-src 'self' https://fonts.cdn.test");
    expect(csp).toContain("connect-src 'self' https://api.stripe.test");
    expect(csp).toContain('frame-src https://checkout.stripe.test');
    expect(csp).toContain("img-src 'self' data: https://images.cdn.test");
  });

  it('keeps the non-overridable hardening directives locked even when the app tries to widen them', async () => {
    // The allowlist can only append to per-fetch directives; `base-uri`/`object-src`/
    // `form-action`/`frame-ancestors` are assembled internally and are unreachable from
    // `CspAllowlist`. Even passing through an `objectSrc`/`baseUri`-shaped widening
    // attempt must NOT relax the locked secure defaults.
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({
      document: {
        csp: {
          allowlist: {
            // A bypass attempt: these field names are not part of CspAllowlist, so the
            // type system already rejects them; cast through to prove the runtime floor.
            scriptSrc: ['https://cdn.analytics.test'],
            objectSrc: ['https://evil.test'],
            baseUri: ['https://evil.test'],
            formAction: ['https://evil.test'],
            frameAncestors: ['https://evil.test'],
          } as never,
        },
      },
      routes: [homeRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    const csp = cspHeader(response.headers);
    // Locked secure defaults survive intact.
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // The widening attempt never reached the hardening directives.
    expect(csp).not.toContain('object-src https://evil.test');
    expect(csp).not.toContain('base-uri https://evil.test');
    expect(csp).not.toContain('form-action https://evil.test');
    expect(csp).not.toContain('frame-ancestors https://evil.test');
    // The legitimate per-fetch append still went through.
    expect(csp).toContain('https://cdn.analytics.test');
  });
});

describe('server app document boundary', () => {
  it('assembles matched route documents through app render options', async () => {
    const productRoute = route('/products/:id', {
      page({ params }) {
        return { id: params.id };
      },
    });
    const request = new Request('https://shop.example.test/products/p1?tag=new&tag=sale');
    const app = createApp({
      document: { lang: 'fr' },
      renderRoute(value, context) {
        expect(value).toEqual({ id: 'p1' });
        expect(context.params).toEqual({ id: 'p1' });
        expect(context.search).toEqual({ tag: ['new', 'sale'] });
        expect(context.request).toBe(request);
        expect(context.route).toBe(productRoute);
        return '<main>Product p1</main>';
      },
      routes: [productRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'p1' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('<html lang="fr">');
    expect(response.body).toContain('<main>Product p1</main>');
  });

  it('streams after-paint deferred route regions after the initial document shell', async () => {
    const productRoute = route('/products/:id', {
      async page({ params }) {
        return renderedHtml(
          `<main><h1>Product ${params.id}</h1>` +
            (await defer({
              fallback:
                '<section aria-busy="true" style="min-height:120px">Loading reviews</section>',
              priority: 'after-paint',
              render: () => '<section class="reviews-card">Reviews ready</section>',
              stylesheets: ['/assets/reviews.css'],
              target: `reviews:${params.id}`,
            })) +
            '</main>',
        );
      },
    });
    const request = new Request('https://shop.example.test/products/p1');
    const app = createApp({ routes: [productRoute] });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'p1' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });
    if (typeof response.body !== 'string') throw new Error('expected HTML document body');
    const body = response.body;

    expect(response.status).toBe(200);
    expect(body).toContain('<h1>Product p1</h1>');
    expect(body).toContain(
      '<kovo-defer target="reviews:p1" state="pending" data-kovo-region-priority="after-paint"><section aria-busy="true" style="min-height:120px">Loading reviews</section></kovo-defer>',
    );
    expect(body.indexOf('<kovo-defer target="reviews:p1"')).toBeLessThan(
      body.indexOf('--kovo-boundary'),
    );
    expect(body).toContain('<kovo-fragment target="reviews:p1" priority="normal">');
    expect(body).toContain('<link rel="stylesheet" href="/assets/reviews.css">');
    expect(body).toContain('<section class="reviews-card">Reviews ready</section>');
  });

  it('streams visible deferred route regions for viewport-gated browser apply', async () => {
    const productRoute = route('/products/:id', {
      async page({ params }) {
        return renderedHtml(
          `<main><h1>Product ${params.id}</h1>` +
            (await defer({
              fallback: '<aside aria-busy="true" style="min-height:320px">Loading rail</aside>',
              priority: 'visible',
              render: () => '<aside class="product-rail">Rail ready</aside>',
              stylesheets: ['/assets/rail.css'],
              target: `rail:${params.id}`,
            })) +
            '</main>',
        );
      },
    });
    const request = new Request('https://shop.example.test/products/p1');
    const app = createApp({ routes: [productRoute] });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'p1' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });
    if (typeof response.body !== 'string') throw new Error('expected HTML document body');
    const body = response.body;

    expect(response.status).toBe(200);
    expect(body).toContain(
      '<kovo-defer target="rail:p1" state="pending" data-kovo-region-priority="visible"><aside aria-busy="true" style="min-height:320px">Loading rail</aside></kovo-defer>',
    );
    expect(body.indexOf('<kovo-defer target="rail:p1"')).toBeLessThan(
      body.indexOf('--kovo-boundary'),
    );
    expect(body).toContain('<kovo-fragment target="rail:p1" priority="visible">');
    expect(body).toContain('<link rel="stylesheet" href="/assets/rail.css">');
    expect(body).toContain('<aside class="product-rail">Rail ready</aside>');
  });

  it('renders critical regions immediately without a deferred stream', async () => {
    const productRoute = route('/products/:id', {
      async page({ params }) {
        return renderedHtml(
          await defer({
            priority: 'critical',
            render: () => `<main>Critical ${params.id}</main>`,
            target: `critical:${params.id}`,
          }),
        );
      },
    });
    const request = new Request('https://shop.example.test/products/p1');
    const app = createApp({ routes: [productRoute] });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'p1' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('<main>Critical p1</main>');
    expect(response.body).not.toContain('<kovo-defer');
    expect(response.body).not.toContain('--kovo-boundary');
  });

  it('inherits app-wide stylesheets before route-specific stylesheets', async () => {
    const appStylesheet = stylesheet('./styles.css', {
      criticalCss: ':root{--brand:blue}',
    });
    const productRoute = route('/products/:id', {
      stylesheets: [stylesheet('./product.css'), appStylesheet],
      page: () => trustedHtml('<main>Product</main>'),
    });
    const request = new Request('https://shop.example.test/products/p1');
    const app = createApp({
      routes: [productRoute],
      stylesheets: [appStylesheet],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'p1' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain(
      '<style data-kovo-critical-href="/assets/styles.css" data-kovo-csp-hash=',
    );
    expect(response.body).not.toContain(
      '<link rel="preload" as="style" href="/assets/styles.css" data-kovo-deferred-style>',
    );
    expect(response.body).toContain('<link rel="stylesheet" href="/assets/product.css">');
    expect(
      (response.body as string).match(/<link rel="stylesheet" href="\/assets\/styles\.css">/g),
    ).toHaveLength(1);
    expect(response.headers.Link).toBe(
      '</assets/styles.css>; rel=preload; as=style, </assets/product.css>; rel=preload; as=style',
    );
  });

  it('applies app-wide stylesheets to framework-owned error documents', async () => {
    const request = new Request('https://shop.example.test/missing');
    const app = createApp({
      stylesheets: [stylesheet('./styles.css')],
    });

    const response = await renderAppErrorDocumentResponse(app, request, 404);

    expect(response.status).toBe(404);
    expect(response.body).toContain('<link rel="stylesheet" href="/assets/styles.css">');
    expect(response.headers.Link).toBe('</assets/styles.css>; rel=preload; as=style');
  });

  it('reports error-shell failures through the app document diagnostic seam', async () => {
    const shellError = new Error('private shell detail');
    const onError = vi.fn();
    const request = new Request('https://shop.example.test/missing?from=doc');
    const app = createApp({
      errorShells: {
        notFound() {
          throw shellError;
        },
      },
      onError,
    });

    const response = await renderAppErrorDocumentResponse(app, request, 404);

    expect(response.status).toBe(404);
    expect(response.body).toContain('<h1>Not Found</h1>');
    expect(response.body).not.toContain('private shell detail');
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request,
      status: 404,
      url: '/missing?from=doc',
    });
  });

  it('renders route notFound outcomes through the configured 404 shell', async () => {
    const productRoute = route('/products/:id', {
      page() {
        return notFound();
      },
    });
    const request = new Request('https://shop.example.test/products/missing');
    const app = createApp({
      errorShells: {
        notFound({ status }) {
          return {
            body: `<main data-shell="404">configured:${status}</main>`,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
          };
        },
      },
      routes: [productRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'missing' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(404);
    expect(response.body).toBe('<main data-shell="404">configured:404</main>');
  });

  it('renders route failures through the configured 500 shell without leaking internals', async () => {
    const routeError = new Error('private route detail');
    const onError = vi.fn();
    const brokenRoute = route('/broken', {
      page() {
        throw routeError;
      },
    });
    const request = new Request('https://shop.example.test/broken');
    const app = createApp({
      errorShells: {
        serverError({ status }) {
          return {
            body: `<main data-shell="500">configured:${status}</main>`,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
          };
        },
      },
      onError,
      routes: [brokenRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request,
      route: brokenRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(500);
    expect(response.body).toBe('<main data-shell="500">configured:500</main>');
    expect(response.body).not.toContain('private route detail');
    expect(onError).toHaveBeenCalledWith(routeError, {
      operation: 'route-page',
      request,
      routePath: '/broken',
    });
  });

  it('renders route guard forbidden failures through the configured 403 shell', async () => {
    const adminRoute = route('/admin', {
      guard: guards.role<Request & { session?: { user: { roles: readonly string[] } } }>('admin'),
      page: () => trustedHtml('<main data-secret>Admin</main>'),
    });
    const request = new Request('https://shop.example.test/admin');
    const app = createApp({
      errorShells: {
        forbidden({ status }) {
          return {
            body: `<main data-shell="403">configured:${status}</main>`,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
          };
        },
      },
      routes: [adminRoute],
      sessionProvider: () => ({ user: { roles: ['staff'] } }),
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request,
      route: adminRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(403);
    expect(response.body).toContain('configured:403');
    expect(response.body).not.toContain('data-secret');
  });

  it('lets layout boundaries override configured 404 and 403 app shells', async () => {
    const NotFoundLayout = layout({
      boundaries: {
        notFound: ({ status }) =>
          trustedHtml(`<main data-layout-boundary="404">layout:${status}</main>`),
      },
      render: (_queries, _state, { children }) =>
        trustedHtml(`<section>${String(children)}</section>`),
    });
    const AdminLayout = layout<Request & { session?: { user?: { roles?: readonly string[] } } }>({
      boundaries: {
        unauthorized: ({ status }) =>
          trustedHtml(`<main data-layout-boundary="403">layout:${status}</main>`),
      },
      guard: guards.role<Request & { session?: { user?: { roles?: readonly string[] } } }>('admin'),
      render: (_queries, _state, { children }) =>
        trustedHtml(`<section>${String(children)}</section>`),
    });
    const missingRoute = route('/admin/missing', {
      layout: NotFoundLayout,
      page: () => notFound(),
    });
    const forbiddenRoute = route('/admin', {
      layout: AdminLayout,
      page: () => trustedHtml('<main data-secret>Admin</main>'),
    });
    const app = createApp({
      errorShells: {
        forbidden: ({ status }) => ({
          body: `<main data-app-shell="403">app:${status}</main>`,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status,
        }),
        notFound: ({ status }) => ({
          body: `<main data-app-shell="404">app:${status}</main>`,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status,
        }),
      },
      routes: [missingRoute, forbiddenRoute],
      sessionProvider: () => ({ user: { roles: ['staff'] } }),
    });

    const missingResponse = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://shop.example.test/admin/missing'),
      route: missingRoute,
      url: new URL('https://shop.example.test/admin/missing'),
    });
    const forbiddenResponse = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://shop.example.test/admin'),
      route: forbiddenRoute,
      url: new URL('https://shop.example.test/admin'),
    });

    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body).toContain('data-layout-boundary="404"');
    expect(missingResponse.body).not.toContain('data-app-shell');
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body).toContain('data-layout-boundary="403"');
    expect(forbiddenResponse.body).not.toContain('data-app-shell');
  });
});

// ─── part-3 I2: rolling-session refresh cookies on GET documents ──────────────

describe('rolling-session refresh cookies on GET documents (part-3 I2)', () => {
  it("forwards a session provider's refresh Set-Cookie headers onto the document response", async () => {
    // SPEC §6.5 / §9.1.1:854: a rolling/refresh session provider (e.g. Better Auth
    // updateAge/cookieCache) emits fresh Set-Cookie headers on each authenticated GET via the
    // `{ value, setCookies }` provider envelope. The framework MUST re-emit them on the page
    // response so a continuously-active user's session actually extends. Before this fix the
    // GET document path never passed `onSessionSetCookie`, so the refresh cookies were dropped
    // and the session was silently hard-logged-out at the original boundary.
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({
      routes: [homeRoute],
      sessionProvider: () => ({
        setCookies: [
          'session_token=rolled; Path=/; HttpOnly; SameSite=Lax',
          'session_data=cache; Path=/; HttpOnly',
        ],
        value: { user: { id: 'u1' } },
      }),
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.status).toBe(200);
    // Both refresh cookies are emitted as a Set-Cookie header array (webResponseHeaders
    // appends each as a separate Set-Cookie on the wire).
    expect(response.headers['Set-Cookie']).toEqual([
      'session_token=rolled; Path=/; HttpOnly; SameSite=Lax',
      // Forwarded refresh cookie is brought up to the session floor (SameSite=Lax added).
      'session_data=cache; Path=/; HttpOnly; SameSite=Lax',
    ]);
  });

  it('emits no Set-Cookie when the session provider returns a plain value (no refresh)', async () => {
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({
      routes: [homeRoute],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.status).toBe(200);
    expect(response.headers['Set-Cookie']).toBeUndefined();
  });
});

// ─── part-4 G1: unguarded refresh-cookie document must be no-store ─────────────

describe('rolling-session Set-Cookie forces no-store on unguarded GET documents (part-4 G1)', () => {
  it('an UNGUARDED route emitting a per-principal Set-Cookie carries Cache-Control: no-store', async () => {
    // SPEC §9.4:906 (a credentialed body that varies by identity must never be stored by a shared
    // cache) and §9.4:767 (a document carrying session-dependent state must be no-store). The route
    // lifecycle / sessionProvider runs on EVERY route (guarded or not) and forwards a rolling-session
    // refresh `Set-Cookie` via `onSessionSetCookie`; app-document re-emits it (part-3 I2). Before
    // this fix `noStore` was set ONLY when `route.guard !== undefined`, so an authenticated user
    // loading the public unguarded `/` got a CACHEABLE response carrying their `Set-Cookie` → a
    // shared CDN/proxy caches it and replays the session cookie to other anonymous visitors
    // (cross-principal session-token leak / takeover).
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    expect(homeRoute.guard).toBeUndefined();

    const app = createApp({
      routes: [homeRoute],
      sessionProvider: () => ({
        setCookies: ['better-auth.session_token=tok; Path=/; HttpOnly'],
        value: { user: { id: 'u1' } },
      }),
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.status).toBe(200);
    // The refresh cookie MUST still ride the response (the lifecycle forwarding is unchanged)…
    expect(response.headers['Set-Cookie']).toEqual([
      // Forwarded better-auth session cookie is floored (SameSite=Lax added).
      'better-auth.session_token=tok; Path=/; HttpOnly; SameSite=Lax',
    ]);
    // …and because a per-principal cookie was emitted, the document MUST be non-cacheable.
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('an unguarded route with a plain-value session provider (no Set-Cookie) stays cacheable', async () => {
    // Negative: no per-principal cookie emitted → no forced no-store. An unguarded, anonymous
    // document remains shared-cacheable; we must not over-broadly disable caching.
    const homeRoute = route('/', { page: () => trustedHtml('<main>Home</main>') });
    const app = createApp({
      routes: [homeRoute],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request: new Request('https://example.test/'),
      route: homeRoute,
      url: new URL('https://example.test/'),
    });

    expect(response.status).toBe(200);
    expect(response.headers['Set-Cookie']).toBeUndefined();
    expect(response.headers['Cache-Control']).toBeUndefined();
  });
});
