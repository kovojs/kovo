import { query, type QueryLoadContext } from '@jiso/server';

import {
  loadCartQuery,
  loadProductGrid,
  type CommerceDb,
  type CommerceRequest,
  type ProductGridInput,
} from './app.js';
import { cart, order, product } from './domains.js';

// SPEC.md section 10.2: typed reads declared once, consumed by components and
// mutation registries. Query loaders use the request DB passed through the
// server query lifecycle instead of constructing fixture data, keeping the
// declared dependency graph tied to the example's source of truth.
type CommerceQueryLoadContext = QueryLoadContext<CommerceRequest> & { db: CommerceDb };

export const cartQuery = query('cart', {
  load: (_input: unknown, context?: CommerceQueryLoadContext) =>
    loadCartQuery(requireCommerceQueryDb(context)),
  reads: [cart],
});

export const productGridQuery = query('productGrid', {
  load: (input: unknown, context?: CommerceQueryLoadContext) =>
    loadProductGrid(requireCommerceQueryDb(context), input as ProductGridInput),
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  load: (_input: unknown, context?: CommerceQueryLoadContext) => ({
    items: requireCommerceQueryDb(context).read('orders') as CommerceDb['orders'],
  }),
  reads: [order],
});

function requireCommerceQueryDb(context?: CommerceQueryLoadContext): CommerceDb {
  const db = context?.db ?? context?.request?.db;

  if (!db) {
    throw new Error('commerce query loaders require context.db or request.db');
  }

  return db;
}
