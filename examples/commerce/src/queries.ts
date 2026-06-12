import { query, type QueryLoadContext } from '@jiso/server';

import {
  loadCartQuery,
  loadProductGrid,
  type CommerceRequest,
  type ProductGridInput,
} from './app.js';
import { cart, order, product } from './domains.js';

// SPEC.md section 10.2: typed reads declared once, consumed by components and
// mutation registries. Query loaders use the request DB passed through the
// server query lifecycle instead of constructing fixture data, keeping the
// declared dependency graph tied to the example's source of truth.
export const cartQuery = query('cart', {
  load: (_input: unknown, context?: QueryLoadContext<CommerceRequest>) =>
    loadCartQuery(requireCommerceRequest(context).db),
  reads: [cart],
});

export const productGridQuery = query('productGrid', {
  load: (input: unknown, context?: QueryLoadContext<CommerceRequest>) =>
    loadProductGrid(requireCommerceRequest(context).db, input as ProductGridInput),
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  load: (_input: unknown, context?: QueryLoadContext<CommerceRequest>) => ({
    items: requireCommerceRequest(context).db.orders,
  }),
  reads: [order],
});

function requireCommerceRequest(context?: QueryLoadContext<CommerceRequest>): CommerceRequest {
  if (!context?.request?.db) {
    throw new Error('commerce query loaders require request.db');
  }

  return context.request;
}
