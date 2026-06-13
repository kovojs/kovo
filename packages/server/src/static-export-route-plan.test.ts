import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { route } from './route.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';

describe('server static export route plan', () => {
  it('plans normalized concrete route targets and explicit param static paths', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/docs/intro/', {
              page: () => '<main>Intro</main>',
            }),
            route('/products/:id', {
              page: () => '<main>Product</main>',
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

  it('keeps non-exportable route diagnostics out of replay choreography', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/admin', {
              guard: () => true,
              page: () => '<main>Admin</main>',
            }),
            route('/products/:id', {
              page: () => '<main>Product</main>',
            }),
            route('/orders/:id', {
              page: () => '<main>Order</main>',
              staticPaths: ['/orders/:id', '/cart'],
            }),
          ],
        }),
      ).diagnostics,
    ).toEqual([
      {
        code: 'FW229',
        message:
          "FW229 static export cannot export guarded route '/admin'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.",
        routePath: '/admin',
      },
      {
        code: 'FW229',
        message:
          "FW229 static export cannot enumerate param route '/products/:id' without staticPaths metadata. Add explicit staticPaths for every exported concrete URL, or exclude the route from export.",
        routePath: '/products/:id',
      },
      {
        code: 'FW229',
        message:
          "FW229 static export staticPath '/orders/:id' for param route '/orders/:id' must be a concrete URL, not a route pattern.",
        routePath: '/orders/:id',
      },
      {
        code: 'FW229',
        message: "FW229 static export staticPath '/cart' does not match param route '/orders/:id'.",
        routePath: '/orders/:id',
      },
    ]);
  });

  it('rejects duplicate concrete export targets before synthetic replay', () => {
    expect(
      staticExportRoutePlan(
        createApp({
          routes: [
            route('/docs/intro', {
              page: () => '<main>Intro</main>',
            }),
            route('/docs/intro/', {
              page: () => '<main>Duplicate intro</main>',
            }),
            route('/products/:id', {
              page: () => '<main>Product</main>',
              staticPaths: ['/products/p1', '/products/p1/'],
            }),
            route('/docs/:slug', {
              page: () => '<main>Docs</main>',
              staticPaths: ['/docs/intro'],
            }),
          ],
        }),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'FW229',
          message:
            "FW229 static export cannot export '/docs/intro' for route '/docs/intro/' because it duplicates the concrete route target from '/docs/intro'.",
          routePath: '/docs/intro/',
        },
        {
          code: 'FW229',
          message:
            "FW229 static export cannot export '/products/p1' for route '/products/:id' because it duplicates the concrete route target from '/products/:id'.",
          routePath: '/products/:id',
        },
        {
          code: 'FW229',
          message:
            "FW229 static export cannot export '/docs/intro' for route '/docs/:slug' because it duplicates the concrete route target from '/docs/intro'.",
          routePath: '/docs/:slug',
        },
      ],
      targets: [
        { path: '/docs/intro', routePath: '/docs/intro' },
        { path: '/products/p1', routePath: '/products/:id' },
      ],
    });
  });
});
