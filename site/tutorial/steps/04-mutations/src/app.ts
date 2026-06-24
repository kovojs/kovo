import {
  mutation,
  publicAccess,
  route,
  s,
  type MutationFail,
  type RoutePageResult,
} from '@kovojs/server';

import { createShopDb, type ShopDb, type ShopRequest } from './db.js';
import { cart, product } from './domains.js';
import { CartBadge } from './components/cart-badge.js';
import * as productListComponent from './components/product-list.js';
import { cartQuery, loadCart, loadProducts, productsQuery } from './queries.js';

// Tutorial step 04 (chapter 4): a typed write over a real form. One mutation
// endpoint answers both response modes — POST-redirect-GET without
// JavaScript, the section 9.1 fragment wire with it (SPEC.md sections 6.3,
// 9.1, 10.3). CSRF is default-on (section 6.6): a mutation with no token
// source fails closed, so the request shell declares one up front.

export type { ShopRequest } from './db.js';

const EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET = 'EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET';

// snippet:csrf
// SPEC.md section 6.6: kovo-csrf is a session-bound synchronizer token stamped
// into every emitted form and verified before input parsing on every POST.
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

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

// snippet:add-to-cart
export const addToCart = mutation('cart/add', {
  access: publicAccess('public tutorial cart form protected by CSRF'),
  csrf: shopCsrf,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1), // FormData coercion declared here
  }),
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

// snippet:shop-page
export function renderShopPage(
  db: ShopDb = createShopDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: ShopRequest,
): string {
  const cart = loadCart(db);
  const products = loadProducts(db);
  const badge = `<kovo-fragment target="cart-badge">${CartBadge.definition.render({ cart })}</kovo-fragment>`;
  const list = `<kovo-fragment target="product-list">${ProductList.definition.render({ products }, { failure: addToCartFailure, request })}</kovo-fragment>`;

  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1>${badge}${list}</main></body></html>`;
}
// /snippet

export const homeRoute = route('/', {
  access: publicAccess('public tutorial shop page'),
  page() {
    return renderShopPage() as unknown as RoutePageResult;
  },
});

function tutorialDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
