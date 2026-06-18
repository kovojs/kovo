/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { formatPrice } from '../db.js';
import { productsQuery, type ProductsResult } from '../queries.js';

// Tutorial step 03 (chapter 3): a keyed list over query data. The native <ul>
// host keeps the HTML content model valid for its <li> children (KV225), so
// the compiler emits the product-list kovo-c identity stamp explicitly (SPEC.md
// section 4.2); kovo-key is the single keyed-identity contract shared by
// stamps, morph, and optimistic reordering (section 4.8).

const productListStyles = style.create(
  {
    list: {
      display: 'grid',
      gap: 8,
      paddingInlineStart: 20,
    },
  },
  { namespace: 'tutorial-product-list', source: 'site/tutorial/steps/03-queries/src/components/product-list.tsx' },
);

// snippet:product-list
export const ProductList = component({
  queries: { products: productsQuery },
  render: ({ products }: { products: ProductsResult }) => (
    <ul style={productListStyles.list}>
      {products.items.map((item) => (
        <li kovo-key={item.id}>
          {item.name} — {formatPrice(item.unitPrice)} ({item.stock} in stock)
        </li>
      ))}
    </ul>
  ),
});
// /snippet
