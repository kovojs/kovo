import { guards, publicAccess, query, s, type QueryLoadContext, type Reader } from '@kovojs/server';
import { eq, gt, sum } from 'drizzle-orm';

import type { CommerceDb } from './db.js';
import { cartItems, orders, products } from './schema.js';

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
  // SECURITY (SECURITY_FINDINGS.md M9): order-history reads are per-user, so the
  // query request must be able to carry the authenticated session whose user id
  // scopes the rows. Cart/product reads remain global (no session needed).
  session?: { id?: string; user?: { id?: string } | null } | null;
}

export const cart = { key: 'cart' } as const;
export const order = { key: 'order' } as const;
export const product = { key: 'product' } as const;

// SPEC §9.4/§10.3 (MARQUEE): a query loader destructures the framework-owned read-only handle
// `{ db }` (typed `Reader<CommerceDb>` — the write verbs are removed at the type level and throw
// `KovoReadonlyHandleError` at runtime). The loader no longer brings its own db; the framework
// threads the SQL-safe, read-only managed handle as `context.db`. A write in a loader is a `tsc`
// error AND a runtime throw AND a KV433 static-gate error. `session` rides the same context for
// the per-user order-history scope.
type CommerceQueryLoadContext = QueryLoadContext<CommerceQueryRequest, CommerceDb> & {
  session?: CommerceQueryRequest['session'];
};

export const cartQuery = query('cart', {
  // Public storefront browsing — the cart/catalog is visible without authentication
  // (KV436 access decision, SPEC §10.2); checkout-class writes stay guarded.
  access: publicAccess('public storefront browsing'),
  output: s.object({ count: s.number() }),
  reads: [cart],
  async load(_input: unknown, context?: CommerceQueryLoadContext): Promise<CartQueryResult> {
    const db = requireCommerceQueryDb(context);
    const rows = await db.select({ count: sum(cartItems.qty) }).from(cartItems);
    return { count: Number(rows[0]?.count ?? 0) };
  },
});

export const productGridQuery = query('productGrid', {
  access: publicAccess('public storefront browsing'),
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
    const last = items.at(-1);
    const more = last
      ? await db.select({ id: products.id }).from(products).where(gt(products.id, last.id)).limit(1)
      : [];
    const nextCursor = more.length > 0 ? (last?.id ?? null) : null;
    return { items: items, nextCursor: nextCursor };
  },
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
    // Orders are an append-only log. The user filter keeps the rowset scoped to
    // the authenticated session.
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
});

// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle. A loader
// destructures it directly; this guard surfaces a clear error when a loader is invoked without the
// framework-threaded handle (e.g. a direct `query.load()` call missing its db).
function requireCommerceQueryDb(context?: CommerceQueryLoadContext): Reader<CommerceDb> {
  const db = context?.db;

  if (!db) {
    throw new Error('commerce query loaders require the framework-provided context.db');
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
