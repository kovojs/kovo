// @kovojs-ir — lowered from site/tutorial/steps/04-mutations/src/components/product-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { csrfField } from '@kovojs/server';
import * as style from '@kovojs/style';

import { formatPrice, type ShopProduct, type ShopRequest } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';
import { addToCart, shopCsrf, type AddToCartFailure, type AddToCartFailureState } from '../app.js';
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Tutorial step 04 (chapter 4): every product card carries a real form
// posting to the mutation endpoint (SPEC.md section 6.3) — the no-JS
// fallback IS the output; `enhance` upgrades it to the section 9.1 fragment
// wire. Failure state and the per-request CSRF token are request context,
// not query data, so they arrive as an explicit second render argument.

export interface ProductListRenderContext {
  failure?: AddToCartFailureState | undefined;
  request?: ShopRequest | undefined;
}

const productListStyles = style.create(
  {
    list: {
      display: 'grid',
      gap: 8,
      paddingInlineStart: 20,
    },
  },
  { namespace: 'tutorial-product-list', source: 'site/tutorial/steps/04-mutations/src/components/product-list.tsx' },
);

export const ProductList = component({
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }, context: ProductListRenderContext = {}) => (
    <ul class="kv-tutorial-product-list-d-bqcudx kv-tutorial-product-list-gap-1uub0u kv-tutorial-product-list-pad-q603nn" data-style-src="site/tutorial/steps/04-mutations/src/components/product-list.tsx#list" kovo-c="product-list" kovo-deps="products" kovo-fragment-target="product-list" kovo-live-component="components/product-list/product-list">
      {products.items.map((item) => (
        <li kovo-key={item.id}>
          {escapeText(item.name)} — {formatPrice(item.unitPrice)} ({escapeText(item.stock)} in stock)
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
ProductList.name = "components/product-list/product-list";

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
    <form enhance mutation={addToCart} method="post" action="/_m/cart/add" data-mutation="cart/add" kovo-fragment-target={`add-to-cart:${item.id}`} kovo-key={item.id}>
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

export const ProductList$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ProductList,
  componentId: "components/product-list/product-list",
}));
