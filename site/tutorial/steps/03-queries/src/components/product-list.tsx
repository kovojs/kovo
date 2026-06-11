/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

import { formatPrice } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';

// Tutorial step 03 (chapter 3): a keyed list over query data. The native <ul>
// host keeps the HTML content model valid for its <li> children (FW225), so
// the compiler emits the product-list fw-c identity stamp explicitly (SPEC.md
// section 4.2); fw-key is the single keyed-identity contract shared by
// stamps, morph, and optimistic reordering (section 4.8).

// snippet:product-list
export const ProductList = component('product-list', {
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }) => (
    <ul class="products">
      {products.items.map((item) => (
        <li fw-key={item.id}>
          {item.name} — {formatPrice(item.unitPrice)} ({item.stock} in stock)
        </li>
      ))}
    </ul>
  ),
});
// /snippet
