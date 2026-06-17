import type { KovoExplainInput, TouchGraph } from '@kovojs/core';

import { commerceCartPageMeta } from './page-meta.js';

export interface CommerceGraphCartSummary {
  count: number;
}

export const commerceStylesheets = ['/assets/styles.css'] as const;

// SPEC.md §10.2/§11.2: commerce graph facts are declared once and consumed by
// both the runtime example and generated acceptance artifacts.
export function commerceGraphDeclarations(cart: CommerceGraphCartSummary) {
  return {
    components: [
      {
        fragments: ['cart-badge'],
        name: 'CartBadge',
        queries: ['cart'],
      },
      {
        fragments: ['product-grid'],
        name: 'ProductGrid',
        queries: ['productGrid'],
      },
      {
        fragments: ['order-history'],
        name: 'OrderHistory',
        queries: ['orderHistory'],
      },
    ],
    endpoints: [
      {
        auth: 'verifier:stripe:v1:hmac-sha256',
        csrf: 'exempt',
        csrfJustification: 'payment/stripe webhook verifier stripe:v1:hmac-sha256',
        method: 'POST',
        name: 'payment/stripe',
        path: '/webhooks/stripe',
        writes: ['order'],
      },
      {
        auth: 'authed',
        csrf: 'checked',
        method: 'GET',
        name: 'orders/export',
        path: '/exports/orders.csv',
      },
      {
        auth: 'authed',
        csrf: 'checked',
        method: 'GET',
        name: 'attachments/download',
        path: '/attachments/:id',
      },
    ],
    mutations: [
      {
        guards: ['authed', 'rateLimit:session'],
        invalidates: ['cart', 'product', 'order'],
        inputFields: ['productId', 'quantity'],
        key: 'cart/add',
        session: 'commerceSession',
        writes: ['cart', 'product', 'order'],
      },
      {
        enctype: 'multipart/form-data',
        fileFields: ['receipt'],
        guards: ['authed', 'rateLimit:session'],
        inputFields: ['orderId', 'receipt'],
        key: 'order/receipt',
        session: 'commerceSession',
        writes: ['attachment'],
      },
      {
        guards: ['authed'],
        inputFields: [],
        key: 'auth/sign-out',
        session: 'commerceSession',
        writes: ['auth'],
      },
    ],
    // SPEC.md §10.5: cart/add is fully compiler-derived (see generated/optimistic/
    // cart-add.ts). All three invalidated queries are `derived` with derivation
    // metadata; zero unhandled KV310, zero punts.
    optimistic: [
      { derivation: { status: 'derived' }, mutation: 'cart/add', query: 'cart', status: 'derived' },
      {
        derivation: { status: 'derived' },
        mutation: 'cart/add',
        query: 'productGrid',
        status: 'derived',
      },
      {
        derivation: { status: 'derived' },
        mutation: 'cart/add',
        query: 'orderHistory',
        status: 'derived',
      },
    ],
    ownerDomains: [{ domain: 'attachment', owner: 'userId' }],
    pages: [
      {
        guards: ['role:admin'],
        modulepreloads: [],
        prefetch: false,
        queries: [],
        route: '/admin',
        stylesheets: [...commerceStylesheets],
      },
      {
        i18n: ['en-US:cartLabel,productStock'],
        meta: commerceCartPageMeta(cart),
        modulepreloads: [],
        prefetch: false,
        queries: ['cart', 'productGrid', 'orderHistory'],
        route: '/cart',
        stylesheets: [...commerceStylesheets],
      },
    ],
    queries: [
      { domains: ['cart'], query: 'cart' },
      { domains: ['product'], query: 'productGrid' },
      { domains: ['order'], query: 'orderHistory' },
    ],
    scopeAudits: [
      {
        detail: 'attachment download filters id plus session user',
        domain: 'attachment',
        kind: 'query',
        name: 'attachments/download',
        scope: 'session',
        site: 'examples/commerce/src/app.ts:attachmentDownloadRoute',
      },
    ],
  } satisfies Omit<KovoExplainInput, 'touchGraph'>;
}

export function createCommerceGraph(cart: CommerceGraphCartSummary, touchGraph: TouchGraph) {
  const graph = {
    ...commerceGraphDeclarations(cart),
    touchGraph,
  };

  return graph satisfies KovoExplainInput;
}
