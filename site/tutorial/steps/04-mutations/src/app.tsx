/** @jsxImportSource @kovojs/server */
import { publicAccess, route } from '@kovojs/server';

import type { ShopRequest } from './db.js';
import './mutations.js';
import { CartBadge } from './components/cart-badge.js';
import * as productListComponent from './components/product-list.js';

// Tutorial step 04 (chapter 4): a typed write over a real form. One mutation
// endpoint answers both response modes: POST-redirect-GET without JavaScript
// and the fragment wire with it.

export type { ShopRequest } from './db.js';
export * from './mutations.js';

export const { ProductList, renderAddToCartError, renderAddToCartForm } = productListComponent;

// snippet:shop-page
export const homeRoute = route('/', {
  access: publicAccess('tutorial storefront browsing'),
  page(_input, _request: ShopRequest) {
    return (
      <html>
        <head>
          <title>Kovo Shop</title>
        </head>
        <body>
          <main>
            <h1>Kovo Shop</h1>
            <CartBadge />
            <ProductList />
          </main>
        </body>
      </html>
    );
  },
});
// /snippet
