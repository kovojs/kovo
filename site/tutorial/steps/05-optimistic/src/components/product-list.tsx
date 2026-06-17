/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';

import { formatPrice, type ShopProduct, type ShopRequest } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';
import { addToCart, shopCsrf, type AddToCartFailure, type AddToCartFailureState } from '../app.js';

// Tutorial step 05 (chapter 5), unchanged from step 04: every product card carries a real form
// posting to the mutation endpoint (SPEC.md section 6.3) — the no-JS
// fallback IS the output; `enhance` upgrades it to the section 9.1 fragment
// wire. Failure state and the per-request CSRF token are request context,
// not query data, so they arrive as an explicit second render argument (the
// examples/commerce pattern).

export interface ProductListRenderContext {
  failure?: AddToCartFailureState | undefined;
  request?: ShopRequest | undefined;
}

export const ProductList = component({
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }, context: ProductListRenderContext = {}) => (
    <ul class="products">
      {products.items.map((item) => (
        <li kovo-key={item.id}>
          {item.name} — {formatPrice(item.unitPrice)} ({item.stock} in stock)
          {renderAddToCartForm(
            item,
            context.failure?.productId === item.id ? context.failure.failure : undefined,
            context.request,
          )}
        </li>
      ))}
    </ul>
  ),
});

// snippet:add-to-cart-form
// SPEC.md section 6.3: the no-JS add-to-cart form posts to the mutation
// endpoint; `enhance` upgrades it to the fragment wire. Authored `key` gives
// repeated forms stable identity; the compiler derives the submitted-form
// target. The kovo-csrf token is stamped into the form whenever the request
// carries a session (SPEC.md section 6.6).
export function renderAddToCartForm(
  item: Pick<ShopProduct, 'id' | 'stock'>,
  failure?: AddToCartFailure,
  request?: ShopRequest,
) {
  return (
    <form enhance mutation={addToCart} key={item.id}>
      {request?.session?.id ? csrfField(request, shopCsrf) : ''}
      <input type="hidden" name="productId" value={item.id} />
      <label>
        Qty
        <input name="quantity" type="number" min="1" max={item.stock} value="1" />
      </label>
      <button type="submit">Add</button>
      {failure ? renderAddToCartError(failure) : ''}
    </form>
  );
}
// /snippet

// snippet:add-to-cart-error
export function renderAddToCartError(failure: AddToCartFailure) {
  if (failure.error.code === 'OUT_OF_STOCK') {
    const payload = failure.error.payload as { availableQuantity?: number };
    return (
      <output role="alert" data-error-code="OUT_OF_STOCK">
        Only {payload.availableQuantity ?? 0} available.
      </output>
    );
  }

  return (
    <output role="alert" data-error-code={failure.error.code}>
      Unable to add this item.
    </output>
  );
}
// /snippet
