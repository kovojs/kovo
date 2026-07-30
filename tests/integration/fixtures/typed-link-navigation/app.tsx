/** @jsxImportSource @kovojs/server */
// SPEC §6.4 + §8: typed href() and <Link> output plain anchor hrefs; navigation is
// a real document load, not a client-router transition.
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { Navigation } from './navigation.js';

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
  page: () => <Navigation />,
});

const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  search: s.object({ ref: s.string(), sort: s.string() }),
  page: ({ params, search }) => (
    <main>
      <h1>Product {params.id}</h1>
      <p data-route="product">
        {search.ref}:{search.sort}
      </p>
    </main>
  ),
});

const searchRoute = route('/search', {
  search: s.object({ q: s.string() }),
  page: ({ search }) => (
    <main>
      <h1>Search</h1>
      <p data-route="search">{search.q}</p>
    </main>
  ),
});

export default defineFixture({
  app: createApp({ routes: [homeRoute, productRoute, searchRoute] }),
});
