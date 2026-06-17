// SPEC §6.4 + §8: typed href()/Link() output is plain anchor hrefs; navigation is
// a real document load, not a client-router transition.
import { Link, href } from '@kovojs/core';
import { createApp, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

declare module '@kovojs/core' {
  interface RouteRegistry {
    '/products/:id': {
      params: { id: string };
      search: { ref?: string; sort?: string };
    };
    '/search': {
      search: { q?: string };
    };
  }
}

const homeRoute = route('/', {
  page: () => {
    const product = Link('/products/:id', {
      params: { id: 'sku-1' },
      search: { ref: 'home', sort: 'price asc' },
    });
    const search = href('/search', { search: { q: 'boots & socks' } });

    return `<main>
      <h1>Navigation</h1>
      <a id="product-link" href="${product.href}">View product</a>
      <a id="search-link" href="${search}">Search catalog</a>
    </main>`;
  },
});

const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  search: s.object({ ref: s.string(), sort: s.string() }),
  page: ({ params, search }) =>
    `<main><h1>Product ${params.id}</h1><p data-route="product">${search.ref}:${search.sort}</p></main>`,
});

const searchRoute = route('/search', {
  search: s.object({ q: s.string() }),
  page: ({ search }) => `<main><h1>Search</h1><p data-route="search">${search.q}</p></main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute, productRoute, searchRoute] }),
});
