import type { KovoExplainInput, TouchGraph } from '@kovojs/core/internal/graph';
import type { InvalidationQueryInput } from '@kovojs/drizzle/static';

import { commerceCartPageMeta } from './page-meta.js';

export interface CommerceGraphCartSummary {
  count: number;
}

export const commerceStylesheets = ['/assets/styles.css'] as const;

// SPEC.md §10.2/§11.2: commerce graph facts are declared once and consumed by
// both the runtime example and generated acceptance artifacts. Component and
// page query facts are joined in scripts/emit-graph.mjs from compiler output.
export function commerceGraphDeclarations(
  cart: CommerceGraphCartSummary,
  queries: readonly InvalidationQueryInput[],
) {
  return {
    endpoints: [],
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
    ownerDomains: [],
    pages: [
      {
        i18n: ['en-US:cartLabel,productStock'],
        meta: commerceCartPageMeta(cart),
        modulepreloads: [],
        prefetch: false,
        route: '/',
        stylesheets: [...commerceStylesheets],
      },
      {
        i18n: ['en-US:cartLabel,productStock'],
        meta: commerceCartPageMeta(cart),
        modulepreloads: [],
        prefetch: false,
        route: '/cart',
        stylesheets: [...commerceStylesheets],
      },
    ],
    queries,
    scopeAudits: [],
  } satisfies Omit<KovoExplainInput, 'touchGraph'>;
}

export function createCommerceGraph(
  cart: CommerceGraphCartSummary,
  touchGraph: TouchGraph,
  queries: readonly InvalidationQueryInput[],
) {
  const graph = {
    ...commerceGraphDeclarations(cart, queries),
    touchGraph,
  };

  return graph satisfies KovoExplainInput;
}
