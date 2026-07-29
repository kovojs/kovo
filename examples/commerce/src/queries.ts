import { s } from '@kovojs/server';
import type { Reader } from '@kovojs/server/data';
import { eq, gt, sum } from 'drizzle-orm';

import type { CommerceDb } from './db.js';
import { cart, order } from './model.js';
import { cartItems, orders, products } from './schema.js';
import { app } from './kovo.js';

export type CartQueryResult = {
  count: number;
};

export interface ProductGridInput {
  after?: string;
  limit?: number;
}

export type ProductGridResult = {
  items: {
    id: string;
    name: string;
    category: string;
    emoji: string;
    stock: number;
    unitPrice: number;
  }[];
  nextCursor: string | null;
};

export type OrderHistoryResult = {
  items: { id: string; productId: string; qty: number; total: number; userId: string }[];
};

export interface CommerceQueryRequest {
  // SECURITY (SECURITY_FINDINGS.md M9): order-history reads are per-user, so the
  // query request must be able to carry the authenticated session whose user id
  // scopes the rows. Cart/product reads remain global (no session needed).
  session?: { id?: string; user?: { id?: string } | null } | null;
}

// SPEC §9.4/§10.3 (MARQUEE): a query loader destructures the framework-owned read-only handle
// `{ db }` (typed `Reader<CommerceDb>` — the write verbs are removed at the type level and throw
// `KovoReadonlyHandleError` at runtime). The loader no longer brings its own db; the framework
// threads the SQL-safe, read-only managed handle as `context.db`. A write in a loader is a `tsc`
// error AND a runtime throw AND a KV433 static-gate error. `session` rides the same context for
// the per-user order-history scope.
type CommerceQueryDb = Reader<CommerceDb> | Pick<CommerceDb, 'select'>;

type CommerceQueryLoadContext = {
  db?: CommerceQueryDb;
  request?: unknown;
  session?: unknown;
  signal?: AbortSignal;
  env?: unknown;
};

export async function loadCartQuery(
  _input: unknown,
  context?: CommerceQueryLoadContext,
): Promise<CartQueryResult> {
  const db = requireCommerceQueryDb(context);
  const rows = await db.select({ count: sum(cartItems.qty) }).from(cartItems);
  return { count: Number(rows[0]?.count ?? 0) };
}

export const cartQuery = app.query({
  // Public storefront browsing — the cart/catalog is visible without authentication
  // (KV436 access decision, SPEC §10.2); checkout-class writes stay guarded.
  access: app.publicAccess('public storefront browsing'),
  load: loadCartQuery,
  output: s.object({ count: s.number() }),
  reads: [cart],
});

export async function loadProductGridQuery(
  input: unknown,
  context?: CommerceQueryLoadContext,
): Promise<ProductGridResult> {
  const db = requireCommerceQueryDb(context);
  const { after, limit } = (input ?? {}) as ProductGridInput;
  const pageSize = limit ?? 2;
  // SPEC §6.6: keep the optional predicate as two explicit finite query shapes. The SQL
  // expression remains the direct argument of `where(...)`, so the build can prove that the
  // pristine Drizzle helper never escapes into an opaque carrier.
  const items = after
    ? await db
        .select({
          id: products.id,
          name: products.name,
          category: products.category,
          emoji: products.emoji,
          stock: products.stock,
          unitPrice: products.unitPrice,
        })
        .from(products)
        .where(gt(products.id, after))
        .orderBy(products.id)
        .limit(pageSize)
    : await db
        .select({
          id: products.id,
          name: products.name,
          category: products.category,
          emoji: products.emoji,
          stock: products.stock,
          unitPrice: products.unitPrice,
        })
        .from(products)
        .orderBy(products.id)
        .limit(pageSize);
  const last = items.at(-1);
  const more = last
    ? await db.select({ id: products.id }).from(products).where(gt(products.id, last.id)).limit(1)
    : [];
  const nextCursor = more.length > 0 ? (last?.id ?? null) : null;
  return { items: items, nextCursor: nextCursor };
}

export const productGridQuery = app.query({
  access: app.publicAccess('public storefront browsing'),
  load: loadProductGridQuery,
});

export async function loadOrderHistoryQuery(
  _input: unknown,
  context?: CommerceQueryLoadContext,
): Promise<OrderHistoryResult> {
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
}

export const orderHistoryQuery = app.query({
  // SECURITY (SECURITY_FINDINGS.md M9): order history is per-user, so this read must
  // require an authenticated session — the endpoint guard rejects unauthenticated
  // callers, and the `load` below additionally scopes the rowset to that user's id
  // so no caller can ever observe another user's orders.
  access: [app.authenticated],
  // SPEC §9.1.1: the `items` collection is keyed by order `id` and scoped by the
  // `order` domain, so an `order`-touching mutation that carries the changed
  // order id ships only the new order row instead of the whole history.
  // (Compiler-derived delta meta is the deferred zero-config piece; this
  // declares it explicitly today.)
  delta: [{ domain: order.key, key: 'id', path: 'items' }],
  load: loadOrderHistoryQuery,
});

// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle. A loader
// destructures it directly; this guard surfaces a clear error when a loader is invoked without the
// framework-threaded handle (e.g. a direct `query.load()` call missing its db).
function requireCommerceQueryDb(context?: CommerceQueryLoadContext): CommerceQueryDb {
  const db = context?.db;

  if (!db) {
    throw new Error('commerce query loaders require the framework-provided context.db');
  }

  return db;
}

function requireCommerceQueryUserId(context?: CommerceQueryLoadContext): string {
  const directUserId = commerceQuerySessionUserId(context?.session);
  const requestSession =
    isRecord(context?.request) && 'session' in context.request
      ? context.request.session
      : undefined;
  const userId = directUserId ?? commerceQuerySessionUserId(requestSession);

  if (!userId) {
    // Default-deny: order history is per-user and must never fall back to an
    // unscoped read. A missing user id means the caller is unauthenticated.
    throw new Error('orderHistory query requires an authenticated session user id');
  }

  return userId;
}

function commerceQuerySessionUserId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.user)) return undefined;
  return typeof value.user.id === 'string' ? value.user.id : undefined;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
