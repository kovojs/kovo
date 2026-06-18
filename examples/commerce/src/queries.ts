import { guards, query, type QueryLoadContext } from '@kovojs/server';
import { eq, gt, sum } from 'drizzle-orm';

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
  items: {
    id: string;
    name: string;
    category: string;
    emoji: string;
    stock: number;
    unitPrice: number;
  }[];
  nextCursor: string | null;
}

export interface OrderHistoryResult {
  items: { id: string; productId: string; qty: number; total: number; userId: string }[];
}

export interface CommerceQueryRequest {
  db: CommerceDb;
  // SECURITY (SECURITY_FINDINGS.md M9): order-history reads are per-user, so the
  // query request must be able to carry the authenticated session whose user id
  // scopes the rows. Cart/product reads remain global (no session needed).
  session?: { id?: string; user?: { id?: string } | null } | null;
}

type CommerceQueryLoadContext = QueryLoadContext<CommerceQueryRequest> & {
  db?: CommerceDb;
  session?: CommerceQueryRequest['session'];
};

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
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        emoji: products.emoji,
        stock: products.stock,
        unitPrice: products.unitPrice,
      })
      .from(products)
      .where(after ? gt(products.id, after) : undefined)
      .orderBy(products.id)
      .limit(pageSize);
    // `items` is the directly-returned select (the extractor reads it as the
    // page rowset). The cursor is a separate existence probe so an exact-fit
    // last page reports no next page (rather than a dangling cursor).
    const last = items.at(-1);
    const more = last
      ? await db.select({ id: products.id }).from(products).where(gt(products.id, last.id)).limit(1)
      : [];
    const nextCursor = more.length > 0 ? (last?.id ?? null) : null;
    return { items: items, nextCursor: nextCursor };
  },
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  // SECURITY (SECURITY_FINDINGS.md M9): order history is per-user, so this read must
  // require an authenticated session — the endpoint guard rejects unauthenticated
  // callers, and the `load` below additionally scopes the rowset to that user's id
  // so no caller can ever observe another user's orders.
  guard: guards.authed<CommerceQueryRequest>(),
  async load(_input: unknown, context?: CommerceQueryLoadContext): Promise<OrderHistoryResult> {
    const db = requireCommerceQueryDb(context);
    const userId = requireCommerceQueryUserId(context);
    // No ORDER BY: orders are an append-only log, so the derived optimism can
    // push the newly-inserted order onto the end (a sort key with a placeholder
    // id would make the insert position ambiguous → a §10.5 punt instead). The
    // WHERE user_id = $userId clause keeps the rowset scoped to the session user
    // (the static extractor reads this filtered shape directly — same pattern as
    // productGrid's conditional WHERE).
    const items = await db
      .select({
        id: orders.id,
        productId: orders.productId,
        qty: orders.qty,
        total: orders.total,
        userId: orders.userId,
      })
      .from(orders)
      .where(eq(orders.userId, userId));
    return { items: items };
  },
  // SPEC §9.1.1: the `items` collection is keyed by order `id` and scoped by the
  // `order` domain, so an `order`-touching mutation that carries the changed
  // order id ships only the new order row instead of the whole history.
  // (Compiler-derived delta meta is the deferred zero-config piece; this
  // declares it explicitly today.)
  delta: [{ domain: 'order', key: 'id', path: 'items' }],
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

// SECURITY (SECURITY_FINDINGS.md M9): the order-history loader now requires the
// authenticated user id so it can scope the read; callers thread the session user
// id from the request.
export async function loadOrderHistory(
  db: CommerceDb,
  userId: string,
): Promise<OrderHistoryResult> {
  const session = { id: userId, user: { id: userId } };
  return orderHistoryQuery.load(undefined, { db, request: { db, session }, session });
}

function requireCommerceQueryDb(context?: CommerceQueryLoadContext): CommerceDb {
  const db = context?.db ?? context?.request?.db;

  if (!db) {
    throw new Error('commerce query loaders require context.db or request.db');
  }

  return db;
}

function requireCommerceQueryUserId(context?: CommerceQueryLoadContext): string {
  const userId = context?.session?.user?.id ?? context?.request?.session?.user?.id;

  if (!userId) {
    // Default-deny: order history is per-user and must never fall back to an
    // unscoped read. A missing user id means the caller is unauthenticated.
    throw new Error('orderHistory query requires an authenticated session user id');
  }

  return userId;
}
