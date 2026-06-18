import type { KovoExplainInput, TouchGraph } from '@kovojs/core/internal/graph';
import type { InvalidationQueryInput } from '@kovojs/drizzle/static';

export interface CommerceGraphCartSummary {
  count: number;
}

export const commerceStylesheets = ['/assets/styles.css'] as const;

export function commerceCartPageMeta(cart: CommerceGraphCartSummary) {
  return {
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Kovo Commerce (${cart.count})`,
  };
}

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
