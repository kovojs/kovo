import {
  mutation,
  renderMutationEndpointResponse,
  renderQueryScript,
  renderRoutePageResponse,
  route,
  s,
  type MutationFail,
  type MutationWireHeaderSource,
} from '@jiso/server';

import { createShopDb, type ShopDb } from './db.js';
import { CartBadge } from './generated/cart-badge.js';
import * as productListComponent from './generated/product-list.js';
import { loadCart, loadProducts } from './queries.js';

// Tutorial step 04 (chapter 4): a typed write over a real form. One mutation
// endpoint answers both response modes — POST-redirect-GET without
// JavaScript, the section 9.1 fragment wire with it (SPEC.md sections 6.3,
// 9.1, 10.3). CSRF is default-on (section 6.6): a mutation with no token
// source fails closed, so the request shell declares one up front.

export interface ShopRequest {
  db: ShopDb;
  session?: { id?: string } | null;
}

// snippet:csrf
// SPEC.md section 6.6: fw-csrf is a session-bound synchronizer token stamped
// into every emitted form and verified before input parsing on every POST.
export const shopCsrf = {
  secret: 'tutorial-shop-secret',
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

export const { ProductList, productFormTarget, renderAddToCartError, renderAddToCartForm } =
  productListComponent;

// snippet:add-to-cart
export const addToCart = mutation('cart/add', {
  csrf: shopCsrf,
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1), // FormData coercion declared here
  }),
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
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
  const queryData =
    renderQueryScript({ name: 'cart', value: cart }) +
    renderQueryScript({ name: 'products', value: products });
  const badge = `<fw-fragment target="cart-badge">${CartBadge.definition.render({ cart })}</fw-fragment>`;
  const list = `<fw-fragment target="product-list">${ProductList.definition.render({ products }, { failure: addToCartFailure, request })}</fw-fragment>`;

  return `<!doctype html><html><head><title>Jiso Shop</title></head><body><main><h1>Jiso Shop</h1>${queryData}${badge}${list}</main></body></html>`;
}
// /snippet

export const homeRoute = route('/', {
  page() {
    return renderShopPage();
  },
});

export function renderHomeRoute() {
  return renderRoutePageResponse(homeRoute, {}, {});
}

// snippet:submit
export function submitAddToCartNoJs(rawInput: unknown, request: ShopRequest) {
  return submitAddToCart(rawInput, request, {});
}

export function submitAddToCart(
  rawInput: unknown,
  request: ShopRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  return renderMutationEndpointResponse(addToCart, {
    failureTarget: productId ? productFormTarget(productId) : 'product-form',
    fragmentRenderers: [
      {
        render: () => CartBadge.definition.render({ cart: loadCart(request.db) }),
        target: 'cart-badge',
      },
      {
        render: () =>
          ProductList.definition.render({ products: loadProducts(request.db) }, { request }),
        target: 'product-list',
      },
    ],
    headers,
    rawInput,
    redirectTo: '/',
    renderFailureFragment: (failure) =>
      renderAddToCartFailureFragment(request, rawInput, failure),
    renderFailurePage: (failure) => renderShopPage(request.db, { failure, productId }, request),
    request,
  });
}
// /snippet

function renderAddToCartFailureFragment(
  request: ShopRequest,
  rawInput: unknown,
  failure: AddToCartFailure,
): string {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? request.db.products.get(productId) : undefined;

  if (!product) return renderAddToCartError(failure);

  return renderAddToCartForm(product, failure, request);
}

function productIdFromRawInput(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || !('productId' in rawInput)) {
    return undefined;
  }
  const productId = rawInput.productId;
  return typeof productId === 'string' ? productId : undefined;
}
