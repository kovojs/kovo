import { form, type FormInput } from '@kovojs/core';
import { guards, i18n, metaFromQuery, mutation, s, serverValue, session } from '@kovojs/server';
import { count, eq, sql } from 'drizzle-orm';

import type { CommerceDb } from './db.js';
import { commerceCartPageMeta } from './graph.js';
import { cart, order, product } from './model.js';
import { cartQuery, orderHistoryQuery, productGridQuery } from './queries.js';
import { cartItems, orders, products } from './schema.js';

export { commerceCartPageMeta, commerceStylesheetHrefs } from './graph.js';
export { createCommerceDb, type CommerceDb } from './db.js';
export type {
  CartQueryResult,
  OrderHistoryResult,
  ProductGridInput,
  ProductGridResult,
} from './queries.js';

export type CommerceRole = 'admin' | 'member';

export interface CommerceSession {
  id: string;
  user: {
    id: string;
    roles?: readonly CommerceRole[];
  };
}

export interface CommerceRequest {
  db: CommerceDb;
  session?: CommerceSession | null;
}

export const commerceSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
    }),
  }),
);

export const EXAMPLE_ONLY_COMMERCE_CSRF_SECRET = 'EXAMPLE_ONLY_COMMERCE_CSRF_SECRET';

export const commerceCsrf = {
  field: 'csrf',
  secret: exampleDeploymentSecret('KOVO_COMMERCE_CSRF_SECRET', EXAMPLE_ONLY_COMMERCE_CSRF_SECRET),
  sessionId(request: CommerceRequest) {
    return request.session?.id;
  },
};

export { cart, order, product, cartQuery, orderHistoryQuery, productGridQuery };

export const addToCart = mutation({
  csrf: commerceCsrf,
  defaultRedirectTo: '/cart',
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  transaction(request: CommerceRequest, run) {
    return request.db.transaction((tx) => run({ ...request, db: tx as unknown as CommerceDb }));
  },
  async handler({ productId, quantity }, request: CommerceRequest, context) {
    const currentSession = commerceSession.parse(request);
    const db = request.db;
    const found = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!found || found.stock < quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    const existingOrders = await db.select({ value: count() }).from(orders);
    const orderId = `order-${Number(existingOrders[0]?.value ?? 0) + 1}`;

    await commitAddToCartRows(db, {
      orderId,
      productId,
      quantity,
      unitPrice: found.unitPrice,
      userId: currentSession.user.id,
    });
    return { productId: productId, quantity: quantity };
  },
});

export const addToCartForm = form(addToCart);
export type AddToCartInput = FormInput<typeof addToCartForm>;

async function commitAddToCartRows(
  db: CommerceDb,
  input: {
    orderId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    userId: string;
  },
) {
  // SPEC §10.3 / KV330: commerce writes live in the domain layer instead of the mutation handler.
  await db.insert(cartItems).values({
    productId: input.productId,
    qty: input.quantity,
    unitPrice: input.unitPrice,
  });
  await db.insert(orders).values({
    // SPEC §11.1 / KV438: `id` and `userId` are governed (primary key + owner). Both
    // are server-derived (a generated id and the session principal), so they are
    // discharged with serverValue(...) — request input never reaches them.
    id: serverValue(input.orderId, 'server-generated order id'),
    productId: input.productId,
    qty: input.quantity,
    total: input.unitPrice * input.quantity,
    userId: serverValue(input.userId, 'session principal'),
  });
  await db
    .update(products)
    .set({ stock: sql`${products.stock} - ${input.quantity}` })
    .where(eq(products.id, input.productId));
}

export const commerceMessageCatalog = {
  cartLabel: 'Cart',
  productStock: '{count} in stock',
} as const;

export const commerceMessages = i18n('en-US', commerceMessageCatalog);

export const commerceMeta = metaFromQuery(cartQuery, commerceCartPageMeta);

function exampleDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
