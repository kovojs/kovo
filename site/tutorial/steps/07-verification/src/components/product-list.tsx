/** @jsxImportSource @kovojs/server */
import { component, FormError } from '@kovojs/core';
import * as style from '@kovojs/style';

import { formatPrice, type ShopProduct, type ShopRequest } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';
import { addToCart, type AddToCartFailure } from '../app.js';

// Tutorial step 07 (chapter 7), unchanged from step 06: every product card carries a real form
// posting to the mutation endpoint (SPEC.md section 6.3) — the no-JS
// fallback IS the output; `enhance` upgrades it to the section 9.1 fragment
// wire. FormError reads the framework's per-form failure context, without a
// reconstructibility-unsafe render prop.

const productListStyles = style.create({
  list: {
    display: 'grid',
    gap: 8,
    paddingInlineStart: 20,
  },
});

export const ProductList = component({
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }) => (
    <ul style={productListStyles.list}>
      {products.items.map((item) => (
        <li key={item.id}>
          {item.name} — {formatPrice(item.unitPrice)} ({item.stock} in stock)
          {renderAddToCartForm(item)}
        </li>
      ))}
    </ul>
  ),
});

// snippet:add-to-cart-form
// SPEC.md section 6.3: the no-JS add-to-cart form posts to the mutation
// endpoint; `enhance` upgrades it to the fragment wire. Authored `key` gives
// repeated forms stable identity; the compiler derives the submitted-form
// target. Kovo emits the mutation-bound CSRF and canonical Kovo-Idem fields
// together (SPEC.md section 6.6).
export function renderAddToCartForm(
  item: Pick<ShopProduct, 'id' | 'stock'>,
  failure?: AddToCartFailure,
  _request?: ShopRequest,
) {
  return (
    <form enhance mutation={addToCart} key={item.id}>
      <input type="hidden" name="productId" value={item.id} />
      <label>
        Qty
        <input name="quantity" type="number" min="1" max={item.stock} value="1" />
      </label>
      <button type="submit">Add</button>
      {failure ? (
        renderAddToCartError(failure)
      ) : (
        <FormError
          code="OUT_OF_STOCK"
          role="alert"
          message={(formFailure: { payload: { availableQuantity?: number } }) =>
            `Only ${formFailure.payload.availableQuantity ?? 0} available.`
          }
        />
      )}
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
