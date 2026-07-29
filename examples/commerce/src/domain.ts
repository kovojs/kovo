import { form } from '@kovojs/core';
import { i18n, s, session } from '@kovojs/server';
import type { RouteMetaFactory } from '@kovojs/server/rendering';
import { serverValue } from '@kovojs/server/write-safety';
import { count, eq, sql } from 'drizzle-orm';

import type { CommerceDb } from './db.js';
import { commerceCartPageMeta } from './graph.js';
import { cart, order, product } from './model.js';
import { cartQuery, orderHistoryQuery, productGridQuery } from './queries.js';
import { cartItems, orders, products } from './schema.js';
import { app } from './kovo.js';

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

const addToCartAccess = app.all(
  app.authenticated,
  app.rateLimit({ max: 10, per: 'session' }),
);

export const addToCart = app.mutation({
  access: [addToCartAccess],
  defaultRedirectTo: '/cart',
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  transaction(
    request: CommerceRequest,
    run: (request: CommerceRequest) => Promise<unknown>,
  ): Promise<unknown> {
    return request.db.transaction((tx) => run({ ...request, db: tx as unknown as CommerceDb }));
  },
  async handler(input, request, context): Promise<AddToCartResult> {
    return executeAddToCart(input, request, context);
  },
});

export const addToCartForm = form(addToCart);
export interface AddToCartInput {
  productId: string;
  quantity: number;
}

type AddToCartFailure = {
  error: { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } };
  ok: false;
  status: 403 | 409 | 422 | 429;
};

type AddToCartResult =
  | AddToCartFailure
  | {
      productId: string;
      quantity: number;
    };

export async function executeAddToCart(
  { productId, quantity }: AddToCartInput,
  request: {
    db: Omit<CommerceDb, 'transaction'>;
    session?: CommerceSession | null;
  },
  context: {
    fail(
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: number },
    ): AddToCartFailure;
  },
): Promise<AddToCartResult> {
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
  return { productId, quantity };
}

async function commitAddToCartRows(
  db: Omit<CommerceDb, 'transaction'>,
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

export const commerceMeta: RouteMetaFactory = {
  queries: [cartQuery.key],
  resolve(values) {
    const value = values[cartQuery.key];
    if (
      typeof value !== 'object' ||
      value === null ||
      !('count' in value) ||
      typeof value.count !== 'number'
    ) {
      throw new TypeError('Commerce cart metadata requires the cart query count.');
    }
    return commerceCartPageMeta({ count: value.count });
  },
};

function exampleDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
