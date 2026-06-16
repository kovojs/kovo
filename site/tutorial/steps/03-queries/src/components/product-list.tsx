/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { formatPrice } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';

// Tutorial step 03 (chapter 3): a keyed list over query data. The native <ul>
// host keeps the HTML content model valid for its <li> children (KV225), so
// the compiler emits the product-list kovo-c identity stamp explicitly (SPEC.md
// section 4.2); kovo-key is the single keyed-identity contract shared by
// stamps, morph, and optimistic reordering (section 4.8).

// snippet:product-list
export const ProductList = component('product-list', {
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }) => (
    <ul class="products">
      {products.items.map((item) => (
        <li kovo-key={item.id}>
          {item.name} — {formatPrice(item.unitPrice)} ({item.stock} in stock)
        </li>
      ))}
    </ul>
  ),
});
// /snippet
