/** @jsxImportSource @kovojs/server */
import { route } from '@kovojs/server';

import type { ShopRequest } from './db.js';
import { CartBadge } from './components/cart-badge.js';
import { ProductList } from './components/product-list.js';

// Tutorial step 03 (chapter 3): components declare the queries they need and
// render from the loaded values (SPEC.md section 4.2) — no per-component
// fetches, no client cache.

// snippet:shop-page
export function renderShopPage() {
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
}
// /snippet

export const homeRoute = route('/', {
  page(_input, _request: ShopRequest) {
    return renderShopPage();
  },
});
