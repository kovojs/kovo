import { createHmac } from 'node:crypto';

import { headerValues, setCookieValues } from '@jiso/test/headers';
import { type StructuralMorphNode } from '@jiso/runtime';
import { eq } from 'drizzle-orm';

import {
  createCommerceDb,
  type AddToCartInput,
  type CommerceDb,
  type ProductGridInput,
} from './app.js';
import { attachments, cartItems, orders, products } from './schema.js';

// SPEC.md §14: the test DB is real Drizzle/PGlite, so tests seed and read rows
// with Drizzle statements (the old in-memory array/Map accessors are gone).
// These helpers keep the per-test seeding/assertion churn small.

export type ProductRow = { id: string; stock: number; unitPrice: number };
export type CartItemRow = { productId: string; qty: number; unitPrice: number };
export type OrderRow = {
  id: string;
  productId: string;
  qty: number;
  total: number;
  userId: string;
};
export type AttachmentRow = {
  contentType: string;
  filename: string;
  id: string;
  orderId: string;
  size: number;
  storageKey: string;
  userId: string;
};

/** Replace the entire product catalog with `rows` (clears the p1/p2/p3 seed). */
export async function resetProducts(db: CommerceDb, rows: readonly ProductRow[]): Promise<void> {
  await db.delete(products);
  for (const row of rows) await db.insert(products).values(row);
}

export async function seedCartItems(db: CommerceDb, rows: readonly CartItemRow[]): Promise<void> {
  for (const row of rows) await db.insert(cartItems).values(row);
}

export async function seedOrders(db: CommerceDb, rows: readonly OrderRow[]): Promise<void> {
  for (const row of rows) await db.insert(orders).values(row);
}

export async function seedAttachments(
  db: CommerceDb,
  rows: readonly AttachmentRow[],
): Promise<void> {
  for (const row of rows) await db.insert(attachments).values(row);
}

export async function readProducts(db: CommerceDb): Promise<ProductRow[]> {
  return db
    .select({ id: products.id, stock: products.stock, unitPrice: products.unitPrice })
    .from(products)
    .orderBy(products.id);
}

export async function readCartItems(db: CommerceDb): Promise<CartItemRow[]> {
  return db
    .select({ productId: cartItems.productId, qty: cartItems.qty, unitPrice: cartItems.unitPrice })
    .from(cartItems)
    .orderBy(cartItems.id);
}

export async function readOrders(db: CommerceDb): Promise<OrderRow[]> {
  return db
    .select({
      id: orders.id,
      productId: orders.productId,
      qty: orders.qty,
      total: orders.total,
      userId: orders.userId,
    })
    .from(orders)
    .orderBy(orders.id);
}

export async function readAttachments(db: CommerceDb): Promise<AttachmentRow[]> {
  return db
    .select({
      contentType: attachments.contentType,
      filename: attachments.filename,
      id: attachments.id,
      orderId: attachments.orderId,
      size: attachments.size,
      storageKey: attachments.storageKey,
      userId: attachments.userId,
    })
    .from(attachments)
    .orderBy(attachments.id);
}

export async function readProduct(db: CommerceDb, id: string): Promise<ProductRow | undefined> {
  return (await db.select().from(products).where(eq(products.id, id)).limit(1))[0];
}

export function commerceFile(name: string, type: string, size: number) {
  return {
    async arrayBuffer() {
      return new ArrayBuffer(size);
    },
    name,
    size,
    type,
  };
}

export interface CommerceAddToCartPropertyState {
  cartItems: { productId: string; qty: number }[];
  products: Record<string, { stock: number }>;
}

export function applyCommerceAddToCartEffect(
  state: CommerceAddToCartPropertyState,
  input: AddToCartInput,
): CommerceAddToCartPropertyState {
  const product = state.products[input.productId];
  if (!product || product.stock < input.quantity) {
    throw new Error(`Invalid property case for ${input.productId}`);
  }

  return {
    cartItems: [...state.cartItems, { productId: input.productId, qty: input.quantity }],
    products: {
      ...state.products,
      [input.productId]: {
        stock: product.stock - input.quantity,
      },
    },
  };
}

export function shapeCommerceCartQuery(state: CommerceAddToCartPropertyState): { count: number } {
  return {
    count: state.cartItems.reduce((total, item) => total + item.qty, 0),
  };
}

export function commerceAddToCartPropertyCases(): {
  input: AddToCartInput;
  state: CommerceAddToCartPropertyState;
}[] {
  const cases: { input: AddToCartInput; state: CommerceAddToCartPropertyState }[] = [];

  for (const productId of ['p1', 'p2']) {
    for (const quantity of [1, 2, 3]) {
      for (const initialCount of [0, 1, 5]) {
        cases.push({
          input: { productId, quantity },
          state: {
            cartItems: initialCount === 0 ? [] : [{ productId: 'existing', qty: initialCount }],
            products: {
              p1: { stock: 6 },
              p2: { stock: 4 },
            },
          },
        });
      }
    }
  }

  return cases;
}

export function stripeHeader(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function requestWithDb(
  body: string,
  db = createCommerceDb(),
  headers: Record<string, string> = {},
) {
  const request = new Request('https://commerce.test/webhooks/stripe', {
    body,
    headers,
    method: 'POST',
  }) as Request & { db: ReturnType<typeof createCommerceDb> };
  request.db = db;
  return request;
}

export function queryContext(db = createCommerceDb()) {
  return {
    db,
    request: { db, session: { id: 's-query', user: { id: 'u-query' } } },
  };
}

export function commerceAuthRequest(cookie?: string, db = createCommerceDb()) {
  const headers = new Headers({ 'user-agent': 'commerce-auth-test' });
  if (cookie) headers.set('cookie', cookie);

  return {
    authCsrfId: 'login-csrf',
    db,
    headers,
  };
}

export function setCookieHeaders(response: {
  headers: Record<string, string | string[]>;
}): string[] {
  return setCookieValues(response.headers);
}

export function mutationSetCookieHeaders(result: {
  responseHeaders?: Record<string, string | string[]>;
}): string[] {
  return headerValues(result.responseHeaders, 'Set-Cookie');
}

export function keyedListNode(
  type: string,
  keys: readonly string[],
  stateByKey: Record<string, StructuralMorphNode['browserState']> = {},
): StructuralMorphNode {
  return {
    children: keys.map((key) => ({
      ...(stateByKey[key] ? { browserState: stateByKey[key] } : {}),
      key,
      props: { 'fw-key': key },
      text: key,
      type: 'li',
    })),
    type,
  };
}

export function productGridInput(after: string | null, limit?: number): ProductGridInput {
  return {
    ...(after ? { after } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}
