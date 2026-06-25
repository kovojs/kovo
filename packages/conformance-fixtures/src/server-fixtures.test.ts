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
  route,
  session,
  s,
  t,
} from '@kovojs/server';
import { runMutation, runQuery, runRoutePage } from '@kovojs/server/internal/execution';
import {
  renderDeferredStream,
  renderPageHints,
  stylesheetsForTargets,
} from '@kovojs/server/internal/html';
import { renderRoutePageResponse } from '@kovojs/server/internal/route';
import {
  renderMutationEndpointResponse,
  renderMutationResponse,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
} from '@kovojs/server/internal/wire';
import { createQueryStore } from '@kovojs/browser/client';
import { submitEnhancedMutation } from '@kovojs/browser/internal/mutation';

import {
  serverCommerceAdoptDontInventBehaviorFact,
  serverCommerceStylesheetBehaviorFact,
  serverCommerceTransactionBehaviorFact,
  serverDataPlaneBehaviorFact,
  serverMutationLifecycleBehaviorFact,
  serverPageHintsBehaviorFact,
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

describe('@kovojs/test server fixture facts', () => {
  it('projects page-hint speculation rules through public server APIs', () => {
    expect(serverPageHintsBehaviorFact({ renderPageHints })).toEqual({
      deduplicatedRules: {
        prerender: [{ eagerness: 'moderate', urls: ['/products', '/cart'] }],
      },
      emptyOptInHtml: '',
      renderedHtml:
        '<script type="speculationrules" data-kovo-csp-hash="sha256-VDbRXdVrG1h/HSZeEzeFOKzfY6aegZfd8rNURnGGk4A=">{"prerender":[{"eagerness":"moderate","urls":["/products","/cart"]}]}</script>',
      scriptAttrs: {
        'data-kovo-csp-hash': 'sha256-VDbRXdVrG1h/HSZeEzeFOKzfY6aegZfd8rNURnGGk4A=',
        type: 'speculationrules',
      },
    });
  });

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
        body: '<kovo-query name="cart" key="cart:c1">{"cartId":"c1"}</kovo-query>',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'Kovo-Build': 'conformance-server-test-build',
          'Kovo-Changes': '[{"domain":"cart"}]',
          Vary: 'Cookie',
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
        body: '<kovo-query name="productDetail" key="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</kovo-query>',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/html; charset=utf-8',
          Vary: 'Cookie',
        },
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
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          Vary: 'Cookie',
        },
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
      field: expect.stringMatching(
        /^<input type="hidden" name="csrf" value="v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+">$/,
      ),
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
        sectionAttrs: { class: 'recommendation-panel' },
        tags: ['main', 'kovo-defer', 'kovo-fragment', 'link', 'section', 'script', 'script'],
      },
      failure: {
        body: '<kovo-fragment target="product-form:p2"><link rel="stylesheet" href="/assets/styles.css"><form class="cart-form-panel"><output role="alert">Only 0 left.</output></form></kovo-fragment>',
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          Vary: 'Cookie',
        },
        status: 422,
      },
      pageHints: {
        csp: {
          scripts: [],
          styles: ['sha256-aglF4eql6svDxPnTw19+/jdeBTsfl850MsmdffQ8F/s='],
        },
        earlyHints: {
          Link: '</assets/styles.css>; rel=preload; as=style',
        },
        html: '<style data-kovo-critical-href="/assets/styles.css" data-kovo-csp-hash="sha256-aglF4eql6svDxPnTw19+/jdeBTsfl850MsmdffQ8F/s=">cart-badge { color: teal; }<\\/style> cart-badge { display: block; }</style><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/recommendations.css">',
      },
      selectedStylesheets: [
        {
          criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
          fragmentTargets: ['cart-badge'],
          href: '/assets/styles.css',
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
            title: 'Kovo Commerce (0)',
          },
          modulepreloads: [],
          prefetch: false,
          queries: ['cart', 'productGrid', 'orderHistory'],
          route: '/cart',
          stylesheets: ['/assets/styles.css'],
        },
      ],
    });

    expect(fact.graph.cartPage).toEqual({
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 0 verifiable cart item.',
        title: 'Kovo Commerce (0)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
      stylesheets: ['/assets/styles.css'],
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
      // part-3 F2 (SPEC §6.4): route meta is best-effort enrichment — a missing query
      // value no longer throws ("Missing query data for route meta") and hard-500s head
      // render; it degrades gracefully (the derived tags are simply omitted).
      missingQueryMessage: '',
      rendered: {
        csp: {
          scripts: ['sha256-428PRljyKzl7OW83C4phJF4OKCzGr42vPOLbx/jnYFI='],
          styles: [],
        },
        earlyHints: {},
        html: [
          '<title>Kovo Commerce (1)</title>',
          '<meta name="description" content="Browse products and checkout with 1 verifiable cart item.">',
          '<meta property="og:description" content="Browse products and checkout with 1 verifiable cart item.">',
          '<script type="application/json" kovo-i18n locale="en-US" data-kovo-csp-hash="sha256-428PRljyKzl7OW83C4phJF4OKCzGr42vPOLbx/jnYFI=">{"cartLabel":"Cart ({count})","productStock":"{stock} in stock"}</script>',
        ].join(''),
      },
      translation: 'Cart (1)',
    });
    expect(fact.guards).toEqual({
      authenticatedSession: { id: 's1', user: { id: 'u1' } },
      authedFailure: {
        kind: 'unauthenticated',
        payload: {},
      },
      firstRateLimitPasses: true,
      secondRateLimitFailure: 'rateLimited',
    });
    // KV428 (SPEC §6.6/§9.1): the storage key is a server-minted opaque UUID under the `receipts`
    // namespace (never the client filename), and the served contentType is SNIFFED (`%PDF-` →
    // application/pdf), not the client-declared type.
    const receiptKey = expect.stringMatching(/^receipts\/[0-9a-f-]{36}$/u) as unknown as string;
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);
    expect(fact.upload.result).toEqual({
      changes: [
        {
          domain: 'attachment',
          input: {
            orderId: 'o1',
            receipt: {
              file: expect.any(Blob),
              key: receiptKey,
              storage: {
                body: pdfBytes,
                contentType: 'application/pdf',
                key: receiptKey,
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
        storageKey: receiptKey,
      },
    });
    expect(fact.upload.stored).toEqual({
      body: pdfBytes,
      contentType: 'application/pdf',
      key: receiptKey,
      metadata: { filename: 'receipt.pdf' },
      size: 7,
    });
    expect(fact.upload.progress).toEqual({ max: '100', value: '50' });
    expect(fact.upload.pendingDuringResponse).toBe('');
    expect(fact.upload.pendingAfterSubmit).toBeNull();
    expect(fact.fragmentFailure).toEqual({
      body: '<kovo-fragment target="product-grid-error" error-boundary="product-grid"><link rel="stylesheet" href="/assets/styles.css"><section role="alert">fragment failed</section></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'conformance-server-test-build',
        'Kovo-Changes': '[]',
        Vary: 'Cookie',
      },
      status: 200,
    });
  });
});
