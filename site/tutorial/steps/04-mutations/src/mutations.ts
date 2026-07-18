import { mutation, s, type MutationFail } from '@kovojs/server';

import { type ShopRequest } from './db.js';
import { cart, product } from './domains.js';
import { cartQuery, productsQuery } from './queries.js';

const EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET = 'EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET';

// snippet:csrf
export const shopCsrf = {
  secret: tutorialDeploymentSecret(
    'KOVO_TUTORIAL_SHOP_CSRF_SECRET',
    EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET,
  ),
  sessionId(request: ShopRequest) {
    return request.session?.id;
  },
};
// /snippet

export type AddToCartFailure = MutationFail<string, unknown>;

export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string | undefined;
}

// snippet:add-to-cart-input
export const addToCartInput = s.object({
  productId: s.string(),
  quantity: s.number().int().min(1).default(1),
});
// /snippet

// snippet:add-to-cart
export const addToCart = mutation({
  csrf: shopCsrf,
  input: addToCartInput,
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  registry: {
    queries: [cartQuery, productsQuery],
    touches: [cart, product],
  },
  transaction(request: ShopRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request: ShopRequest, context) {
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.write('cart_items', {
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
    });
    request.db.write('products', {
      ...found,
      stock: found.stock - input.quantity,
    });
    return { productId: input.productId, quantity: input.quantity };
  },
});
// /snippet

function tutorialDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
