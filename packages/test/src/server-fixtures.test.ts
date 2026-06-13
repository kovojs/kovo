import { describe, expect, it } from 'vitest';
import {
  csrfField,
  csrfToken,
  domain,
  errorBoundary,
  guards,
  i18n,
  metaFromQuery,
  mutation,
  notFound,
  query,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderMutationResponse,
  renderPageHints,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderRoutePageResponse,
  route,
  runMutation,
  runQuery,
  runRoutePage,
  session,
  s,
  stylesheetsForTargets,
  t,
} from '@jiso/server';
import { createQueryStore, submitEnhancedMutation } from '../../runtime/src/index.ts';

import {
  serverCommerceAdoptDontInventBehaviorFact,
  serverCommerceStylesheetBehaviorFact,
  serverCommerceTransactionBehaviorFact,
  serverDataPlaneBehaviorFact,
  serverMutationLifecycleBehaviorFact,
} from './server-fixtures.ts';

const mutationRuntime = {
  domain,
  mutation,
  query,
  renderMutationResponse,
  runMutation,
  s,
};

const dataPlaneRuntime = {
  ...mutationRuntime,
  csrfField,
  csrfToken,
  notFound,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderRoutePageResponse,
  route,
  runQuery,
  runRoutePage,
};

const commerceRuntime = {
  ...dataPlaneRuntime,
  createQueryStore,
  errorBoundary,
  guards,
  i18n,
  metaFromQuery,
  renderMutationEndpointResponse,
  renderPageHints,
  session,
  submitEnhancedMutation,
  t,
};

const commerceStylesheetRuntime = {
  ...mutationRuntime,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderPageHints,
  stylesheetsForTargets,
};

describe('@jiso/test server fixture facts', () => {
  it('projects mutation transaction and fragment behavior through public server APIs', async () => {
    await expect(serverMutationLifecycleBehaviorFact(mutationRuntime)).resolves.toEqual({
      failedTransaction: {
        events: ['begin', 'handler', 'rollback'],
        result: {
          error: {
            code: 'OUT_OF_STOCK',
            payload: { availableQuantity: 0 },
          },
          ok: false,
          status: 422,
        },
      },
      fragmentResponse: {
        body: '<fw-query name="cart" key="cart:c1">{"cartId":"c1"}</fw-query>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
        },
        status: 200,
      },
      successfulTransaction: {
        events: ['guard:u1', 'begin:plain', 'handler:tx', 'commit'],
        result: {
          changes: [],
          ok: true,
          rerunQueries: [],
          value: 'p1',
        },
      },
    });
  });

  it('projects query, route, and CSRF data-plane behavior through public server APIs', async () => {
    const fact = await serverDataPlaneBehaviorFact(dataPlaneRuntime);

    expect(fact.query).toEqual({
      endpoint: {
        body: '<fw-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</fw-query>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      invalidInput: {
        error: {
          code: 'VALIDATION',
          payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
        },
        ok: false,
        status: 422,
      },
      missingRegistryQuery: {
        body: 'Not Found',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 404,
      },
      success: {
        input: { id: 'p1', max: 10 },
        ok: true,
        value: { id: 'p1', max: 10, userId: 'u1' },
      },
      unauthorized: {
        error: { code: 'UNAUTHORIZED', payload: {} },
        ok: false,
        status: 422,
      },
    });
    expect(fact.route).toEqual({
      notFound: {
        body: 'Not Found',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 404,
      },
      success: {
        ok: true,
        value: 'u1:p1:details',
      },
    });
    expect(fact.csrf).toEqual({
      field: expect.stringMatching(/^<input type="hidden" name="csrf" value="[A-Za-z0-9+/=_-]+">$/),
      guardCallsAfterFailure: 1,
      guardCallsAfterSuccess: 1,
      missingToken: {
        error: { code: 'CSRF', payload: {} },
        ok: false,
        status: 422,
      },
      success: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: 'p1',
      },
    });
  });

  it('projects commerce-style transactional rollback behavior through public server APIs', async () => {
    await expect(serverCommerceTransactionBehaviorFact(mutationRuntime)).resolves.toEqual({
      failed: {
        db: {
          commits: 1,
          items: [{ productId: 'p1', qty: 2 }],
          rollbacks: 1,
        },
        result: {
          error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 5 } },
          ok: false,
          status: 422,
        },
      },
      successful: {
        db: {
          commits: 1,
          items: [{ productId: 'p1', qty: 2 }],
          rollbacks: 0,
        },
        result: {
          changes: [],
          ok: true,
          rerunQueries: [],
          value: { count: 1 },
        },
      },
    });
  });

  it('projects commerce stylesheet hints through public server APIs', async () => {
    await expect(serverCommerceStylesheetBehaviorFact(commerceStylesheetRuntime)).resolves.toEqual({
      deferred: {
        fragmentAttrs: { target: 'recommendations' },
        linkAttrs: {
          href: '/assets/recommendations.css',
          rel: 'stylesheet',
        },
        sectionAttrs: { class: 'border-slate-200' },
        tags: ['main', 'fw-defer', 'fw-fragment', 'link', 'section'],
      },
      failure: {
        body: '<fw-fragment target="product-form:p2"><link rel="stylesheet" href="/assets/tailwind.css"><form class="border-slate-200"><output role="alert">Only 0 left.</output></form></fw-fragment>',
        headers: { 'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8' },
        status: 422,
      },
      pageHints: {
        earlyHints: {
          Link: '</assets/tailwind.css>; rel=preload; as=style',
        },
        html: '<style data-jiso-critical-href="/assets/tailwind.css">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style><link rel="stylesheet" href="/assets/tailwind.css"><link rel="stylesheet" href="/assets/recommendations.css">',
      },
      selectedStylesheets: [
        {
          criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
          fragmentTargets: ['cart-badge'],
          href: '/assets/tailwind.css',
        },
      ],
    });
  });

  it('projects commerce adopt-dont-invent behavior through public server APIs', async () => {
    const fact = await serverCommerceAdoptDontInventBehaviorFact(commerceRuntime, {
      mutations: [
        {
          enctype: 'multipart/form-data',
          fileFields: ['receipt'],
          guards: ['authed', 'rateLimit:session'],
          inputFields: ['orderId', 'receipt'],
          key: 'order/receipt',
          session: 'commerceSession',
          writes: ['attachment'],
        },
      ],
      pages: [
        {
          i18n: ['en-US:cartLabel,productStock'],
          meta: {
            description: 'Browse products and checkout with 0 verifiable cart item.',
            title: 'Jiso Commerce (0)',
          },
          modulepreloads: [],
          prefetch: false,
          queries: ['cart', 'productGrid', 'orderHistory'],
          route: '/cart',
          stylesheets: ['/assets/tailwind.css'],
        },
      ],
    });

    expect(fact.graph.cartPage).toEqual({
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 0 verifiable cart item.',
        title: 'Jiso Commerce (0)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
      stylesheets: ['/assets/tailwind.css'],
    });
    expect(fact.graph.receiptMutation).toEqual({
      enctype: 'multipart/form-data',
      fileFields: ['receipt'],
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['orderId', 'receipt'],
      key: 'order/receipt',
      session: 'commerceSession',
      writes: ['attachment'],
    });
    expect(fact.pageHints).toEqual({
      missingQueryMessage: 'Missing query data for route meta: cart',
      rendered: {
        earlyHints: {},
        html: [
          '<title>Jiso Commerce (1)</title>',
          '<meta name="description" content="Browse products and checkout with 1 verifiable cart item.">',
          '<meta property="og:description" content="Browse products and checkout with 1 verifiable cart item.">',
          '<script type="application/json" fw-i18n locale="en-US">{"cartLabel":"Cart ({count})","productStock":"{stock} in stock"}</script>',
        ].join(''),
      },
      translation: 'Cart (1)',
    });
    expect(fact.guards).toEqual({
      authenticatedSession: { id: 's1', user: { id: 'u1' } },
      authedFailure: {
        auth: 'unauthenticated',
        code: 'UNAUTHORIZED',
        payload: {},
        status: 422,
      },
      firstRateLimitPasses: true,
      secondRateLimitFailure: 'RATE_LIMITED',
    });
    expect(fact.upload.result).toEqual({
      changes: [
        {
          domain: 'attachment',
          input: {
            orderId: 'o1',
            receipt: {
              file: expect.any(Blob),
              key: 'receipts/receipt.pdf',
              storage: {
                body: new TextEncoder().encode('receipt'),
                contentType: 'application/pdf',
                key: 'receipts/receipt.pdf',
                metadata: { filename: 'receipt.pdf' },
                size: 7,
              },
            },
          },
        },
      ],
      ok: true,
      rerunQueries: [],
      value: {
        orderId: 'o1',
        session: 'u1',
        storageKey: 'receipts/receipt.pdf',
      },
    });
    expect(fact.upload.stored).toEqual({
      body: new TextEncoder().encode('receipt'),
      contentType: 'application/pdf',
      key: 'receipts/receipt.pdf',
      metadata: { filename: 'receipt.pdf' },
      size: 7,
    });
    expect(fact.upload.progress).toEqual({ max: '100', value: '50' });
    expect(fact.upload.pendingDuringResponse).toBe('');
    expect(fact.upload.pendingAfterSubmit).toBeNull();
    expect(fact.fragmentFailure).toEqual({
      body: '<fw-fragment target="product-grid-error" error-boundary="product-grid"><link rel="stylesheet" href="/assets/tailwind.css"><section role="alert">fragment failed</section></fw-fragment>',
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
        'FW-Changes': '[]',
      },
      status: 200,
    });
  });
});
