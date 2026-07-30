/** @jsxImportSource @kovojs/server */
import { component, href, Link } from '@kovojs/core';

/** Typed navigation lowers to ordinary anchors; Kovo does not install a client router. */
export const Navigation = component({
  render: () => (
    <main>
      <h1>Navigation</h1>
      <Link
        id="product-link"
        params={{ id: 'sku-1' }}
        search={{ ref: 'home', sort: 'price asc' }}
        to="/products/:id"
      >
        View product
      </Link>
      <a href={href('/search', { search: { q: 'boots & socks' } })} id="search-link">
        Search catalog
      </a>
    </main>
  ),
});
