import { query, type QueryLoadContext } from '@jiso/server';
import { gt, sum } from 'drizzle-orm';

import type { CommerceDb } from './db.js';
import { cart, order, product } from './domains.js';
import { cartItems, orders, products } from './schema.js';

// SPEC.md §10.2 / §11.1: typed reads declared once. Each loader INLINES its
// Drizzle select inside the `query(...)` body so the static extractor reads the
// real query shape (rowset, keys, aggregates, cursor) straight from this source
// — the derived-optimism transforms in generated/optimistic/ are produced from
// these shapes paired with the mutation handlers, never hand-authored.

export interface CartQueryResult {
  count: number;
}

export interface ProductGridInput {
  after?: string;
  limit?: number;
}

export interface ProductGridResult {
  items: { id: string; stock: number; unitPrice: number }[];
  nextCursor: string | null;
}

export interface OrderHistoryResult {
  items: { id: string; productId: string; qty: number; total: number; userId: string }[];
}

export interface CommerceQueryRequest {
  db: CommerceDb;
}

type CommerceQueryLoadContext = QueryLoadContext<CommerceQueryRequest> & { db?: CommerceDb };

export const cartQuery = query('cart', {
  async load(_input: unknown, context?: CommerceQueryLoadContext): Promise<CartQueryResult> {
    const db = requireCommerceQueryDb(context);
    const rows = await db.select({ value: sum(cartItems.qty) }).from(cartItems);
    return { count: Number(rows[0]?.value ?? 0) };
  },
  reads: [cart],
});

export const productGridQuery = query('productGrid', {
  async load(input: unknown, context?: CommerceQueryLoadContext): Promise<ProductGridResult> {
    const db = requireCommerceQueryDb(context);
    const { after, limit } = (input ?? {}) as ProductGridInput;
    const pageSize = limit ?? 2;
    const items = await db
      .select({ id: products.id, stock: products.stock, unitPrice: products.unitPrice })
      .from(products)
      .where(after ? gt(products.id, after) : undefined)
      .orderBy(products.id)
      .limit(pageSize);
    const nextCursor = items.length === pageSize ? (items.at(-1)?.id ?? null) : null;
    return { items: items, nextCursor: nextCursor };
  },
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  async load(_input: unknown, context?: CommerceQueryLoadContext): Promise<OrderHistoryResult> {
    const db = requireCommerceQueryDb(context);
    // No ORDER BY: orders are an append-only log, so the derived optimism can
    // push the newly-inserted order onto the end (a sort key with a placeholder
    // id would make the insert position ambiguous → a §10.5 punt instead).
    const items = await db
      .select({
        id: orders.id,
        productId: orders.productId,
        qty: orders.qty,
        total: orders.total,
        userId: orders.userId,
      })
      .from(orders);
    return { items: items };
  },
  reads: [order],
});

export async function loadCartQuery(db: CommerceDb): Promise<CartQueryResult> {
  return cartQuery.load(undefined, { db, request: { db } });
}

export async function loadProductGrid(
  db: CommerceDb,
  input: ProductGridInput = {},
): Promise<ProductGridResult> {
  return productGridQuery.load(input, { db, request: { db } });
}

export async function loadOrderHistory(db: CommerceDb): Promise<OrderHistoryResult> {
  return orderHistoryQuery.load(undefined, { db, request: { db } });
}

function requireCommerceQueryDb(context?: CommerceQueryLoadContext): CommerceDb {
  const db = context?.db ?? context?.request?.db;

  if (!db) {
    throw new Error('commerce query loaders require context.db or request.db');
  }

  return db;
}
