// @kovojs-ir — lowered from site/tutorial/steps/03-queries/src/components/product-list.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server';
import { component } from '@kovojs/core';

import { formatPrice } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';

// Tutorial step 03 (chapter 3): a keyed list over query data. The native <ul>
// host keeps the HTML content model valid for its <li> children (KV225), so
// the compiler emits the product-list kovo-c identity stamp explicitly (SPEC.md
// section 4.2); kovo-key is the single keyed-identity contract shared by
// stamps, morph, and optimistic reordering (section 4.8).

// snippet:product-list
export const ProductList = component({
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }) => (
    <ul class="products" kovo-c="product-list" kovo-deps="products">
      {products.items.map((item) => (
        <li kovo-key={item.id}>
          {escapeText(item.name)} — {formatPrice(item.unitPrice)} ({escapeText(item.stock)} in stock)
        </li>
      ))}
    </ul>
  ),
});
ProductList.name = "components/product-list/product-list";
// /snippet
