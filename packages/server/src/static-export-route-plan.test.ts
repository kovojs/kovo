import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { publicAccess } from './access.js';
import { createApp } from './app.js';
import { endpoint } from './endpoint.js';
import { guard } from './guards.js';
import { route } from './route.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';

describe('server static export route plan', () => {
  it('plans normalized concrete route targets and explicit param static paths', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/docs/intro/', {
              page: () => trustedHtml('<main>Intro</main>'),
            }),
            route('/products/:id', {
              page: () => trustedHtml('<main>Product</main>'),
              staticPaths: ['/products/p1/', '/products/p2'],
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [],
      targets: [
        { path: '/docs/intro', routePath: '/docs/intro/' },
        { path: '/products/p1', routePath: '/products/:id' },
        { path: '/products/p2', routePath: '/products/:id' },
      ],
    });
  });

  it('uses the shared route pattern grammar for param route detection and staticPaths', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/users/:user-id/files/:name.json', {
              page: () => trustedHtml('<main>File</main>'),
              staticPaths: ['/users/u%201/files/report.md'],
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [],
      targets: [
        {
          path: '/users/u%201/files/report.md',
          routePath: '/users/:user-id/files/:name.json',
        },
      ],
    });
  });

  it('keeps non-exportable route diagnostics out of replay choreography', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/admin', {
              guard: () => true,
              page: () => trustedHtml('<main>Admin</main>'),
            }),
            route('/products/:id', {
              page: () => trustedHtml('<main>Product</main>'),
            }),
            route('/orders/:id', {
              page: () => trustedHtml('<main>Order</main>'),
              staticPaths: ['/orders/:id', '/cart'],
            }),
          ],
        }),
      ).diagnostics,
    ).toEqual([
      {
        code: 'KV229',
        message:
          "KV229 static export cannot export guarded route '/admin'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.",
        routePath: '/admin',
      },
      {
        code: 'KV229',
        message:
          "KV229 static export cannot enumerate param route '/products/:id' without staticPaths metadata. Add explicit staticPaths for every exported concrete URL, or exclude the route from export.",
        routePath: '/products/:id',
      },
      {
        code: 'KV229',
        concretePath: '/orders/:id',
        message:
          "KV229 static export staticPath '/orders/:id' for param route '/orders/:id' must be a concrete URL, not a route pattern.",
        routePath: '/orders/:id',
      },
      {
        code: 'KV229',
        concretePath: '/cart',
        message: "KV229 static export staticPath '/cart' does not match param route '/orders/:id'.",
        routePath: '/orders/:id',
      },
    ]);
  });

  it('uses the pinned descriptor snapshot for proxied route planning', () => {
    const deny = guard('static-proxy-deny', () => ({ kind: 'forbidden' as const }));
    const declaration = route('/proxied-private', {
      access: [deny],
      page: () => trustedHtml('<main>Private</main>'),
    });
    const clone = { ...declaration };
    let accessReads = 0;
    const proxied = new Proxy(clone, {
      get(target, property, receiver) {
        if (property === 'access') {
          accessReads += 1;
          return publicAccess('proxy get trap attempted public downgrade');
        }
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const app = createApp({ routes: [proxied] });

    expect(staticExportRoutePlan(app)).toEqual({
      diagnostics: [
        {
          code: 'KV229',
          message:
            "KV229 static export cannot export guarded route '/proxied-private'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.",
          routePath: '/proxied-private',
        },
      ],
      targets: [],
    });
    expect(accessReads).toBe(0);
  });

  it('allows explicitly public routes in an app with a session provider', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/login', {
              access: publicAccess('static login shell'),
              page: () => trustedHtml('<main>Login</main>'),
            }),
            route('/profile', {
              page: () => trustedHtml('<main>Profile</main>'),
            }),
          ],
          sessionProvider: () => ({ user: { id: 'u1' } }),
        }),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV229',
          message:
            "KV229 static export cannot prove '/profile' is session-independent while the app has a sessionProvider. Exported sites have no server-side sessions; declare publicAccess(...) on explicitly public routes, split this route into an explicitly public app shell, or wait for compiler-backed session-dependence metadata.",
          routePath: '/profile',
        },
      ],
      targets: [{ path: '/login', routePath: '/login' }],
    });
  });

  it('rejects explicitly public routes when checked mutation forms can mint anonymous CSRF cookies', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          csrf: {
            secret: 'static-export-route-plan-csrf-secret-0123456789',
            sessionId: () => undefined,
          },
          mutations: [{ key: 'auth/sign-in' }],
          routes: [
            route('/login', {
              access: publicAccess('static login shell'),
              page: () => trustedHtml('<main>Login</main>'),
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV229',
          message:
            "KV229 static export cannot export publicAccess route '/login' because this app has default-on per-form CSRF for browser mutations. Rendering a mutation form can mint the anonymous CSRF Set-Cookie required by SPEC §9.1, but SPEC §9.5 static files have no response-specific cookie channel. Serve this route dynamically, split the form out of the exported surface, or make the targeted non-browser mutation explicitly csrf:false with a justification.",
          routePath: '/login',
        },
      ],
      targets: [],
    });
  });

  it('does not reject explicitly public routes when every mutation is csrf false', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          csrf: {
            secret: 'static-export-route-plan-csrf-secret-0123456789',
            sessionId: () => undefined,
          },
          mutations: [
            {
              csrf: false,
              csrfJustification: 'machine-only status probe without browser authority',
              key: 'status/ping',
            },
          ],
          routes: [
            route('/status', {
              access: publicAccess('static status shell'),
              page: () => trustedHtml('<main>Status</main>'),
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [],
      targets: [{ path: '/status', routePath: '/status' }],
    });
  });

  it('rejects duplicate concrete export targets before synthetic replay', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/docs/intro', {
              page: () => trustedHtml('<main>Intro</main>'),
            }),
            route('/docs/intro/', {
              page: () => trustedHtml('<main>Duplicate intro</main>'),
            }),
            route('/products/:id', {
              page: () => trustedHtml('<main>Product</main>'),
              staticPaths: ['/products/p1', '/products/p1/'],
            }),
            route('/docs/:slug', {
              page: () => trustedHtml('<main>Docs</main>'),
              staticPaths: ['/docs/intro'],
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV229',
          concretePath: '/docs/intro',
          message:
            "KV229 static export cannot export '/docs/intro' for route '/docs/intro/' because it duplicates the concrete route target from '/docs/intro'.",
          routePath: '/docs/intro/',
        },
        {
          code: 'KV229',
          concretePath: '/products/p1',
          message:
            "KV229 static export cannot export '/products/p1' for route '/products/:id' because it duplicates the concrete route target from '/products/:id'.",
          routePath: '/products/:id',
        },
        {
          code: 'KV229',
          concretePath: '/docs/intro',
          message:
            "KV229 static export cannot export '/docs/intro' for route '/docs/:slug' because it duplicates the concrete route target from '/docs/intro'.",
          routePath: '/docs/:slug',
        },
      ],
      targets: [
        { path: '/docs/intro', routePath: '/docs/intro' },
        { path: '/products/p1', routePath: '/products/:id' },
      ],
    });
  });

  it('rejects exact and prefix GET endpoint ownership before replay while preserving siblings', () => {
    // SPEC §6.6/§9.5: planning proves the same endpoint-before-route dispatch used by the request
    // shell. `onNonExportable: skip` can therefore suppress only the colliding concrete target.
    const exact = endpoint('/docs', {
      handler: () => new Response('<script>globalThis.pwned = true</script>'),
      method: 'GET',
      reason: 'static export exact-collision regression fixture',
      response: { appOwnedSafety: true, body: 'html', cache: 'public' },
    });
    const prefix = endpoint('/products/private', {
      handler: () => new Response('<script>globalThis.pwned = true</script>'),
      method: 'GET',
      mount: 'prefix',
      mountJustification: 'static export prefix-collision regression fixture',
      reason: 'static export prefix-collision regression fixture',
      response: { appOwnedSafety: true, body: 'html', cache: 'public' },
    });

    expect(
      staticExportRoutePlan(
        createApp({
          endpoints: [exact, prefix],
          routes: [
            route('/docs', {
              page: () => trustedHtml('<main>Docs</main>'),
            }),
            route('/products/:section/:id', {
              page: () => trustedHtml('<main>Product</main>'),
              staticPaths: ['/products/private/p1', '/products/public/p1'],
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV229',
          concretePath: '/docs',
          message: expect.stringContaining("resolves it to exact GET endpoint '/docs'"),
          routePath: '/docs',
        },
        {
          code: 'KV229',
          concretePath: '/products/private/p1',
          message: expect.stringContaining(
            "resolves it to prefix GET endpoint '/products/private'",
          ),
          routePath: '/products/:section/:id',
        },
      ],
      targets: [
        {
          path: '/products/public/p1',
          routePath: '/products/:section/:id',
        },
      ],
    });
  });

  it('rejects concrete targets owned by reserved request-shell prefixes', () => {
    // SPEC §9.5 dispatch gives reserved protocol surfaces authority before the route table even
    // when the corresponding registry key is absent; static export must not reinterpret them.
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/_m/export-me', {
              page: () => trustedHtml('<main>Mutation-shaped route</main>'),
            }),
            route('/_q/export-me', {
              page: () => trustedHtml('<main>Query-shaped route</main>'),
            }),
            route('/c/export-me', {
              page: () => trustedHtml('<main>Module-shaped route</main>'),
            }),
          ],
        }),
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({
        concretePath: '/_m/export-me',
        message: expect.stringContaining("reserved mutation dispatch '/_m/'"),
      }),
      expect.objectContaining({
        concretePath: '/_q/export-me',
        message: expect.stringContaining("reserved query dispatch '/_q/'"),
      }),
      expect.objectContaining({
        concretePath: '/c/export-me',
        message: expect.stringContaining("reserved client-module dispatch '/c/'"),
      }),
    ]);
  });

  it('rejects static-host-unsafe concrete route targets before synthetic replay', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/docs/%2e%2e', {
              page: () => trustedHtml('<main>Unsafe docs</main>'),
            }),
            route('/products/:id', {
              page: () => trustedHtml('<main>Product</main>'),
              staticPaths: ['/products/%2f', '/products/%E0%A4%A'],
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV229',
          concretePath: '/docs/%2e%2e',
          message:
            "KV229 static export cannot export concrete route target '/docs/%2e%2e' for route '/docs/%2e%2e' because it contains an unsafe URL path segment. Encoded separators, encoded dot segments, and invalid URL encoding cannot be published as SPEC §9.5 directory-index route documents.",
          routePath: '/docs/%2e%2e',
        },
        {
          code: 'KV229',
          concretePath: '/products/%2f',
          message:
            "KV229 static export cannot export concrete route target '/products/%2f' for route '/products/:id' because it contains an unsafe URL path segment. Encoded separators, encoded dot segments, and invalid URL encoding cannot be published as SPEC §9.5 directory-index route documents.",
          routePath: '/products/:id',
        },
        {
          code: 'KV229',
          concretePath: '/products/%E0%A4%A',
          message:
            "KV229 static export cannot export concrete route target '/products/%E0%A4%A' for route '/products/:id' because it contains an unsafe URL path segment. Encoded separators, encoded dot segments, and invalid URL encoding cannot be published as SPEC §9.5 directory-index route documents.",
          routePath: '/products/:id',
        },
      ],
      targets: [],
    });
  });
});
