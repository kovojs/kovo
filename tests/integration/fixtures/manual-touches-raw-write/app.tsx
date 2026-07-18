/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartCount } from './cart-count';
import { cart, cartQuery } from './shared';

const addOpaqueCartItem = mutation('manual-touches-raw-write/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ productId: s.string() }),
  registry: {
    queries: [cartQuery],
    tables: ['cart_items'],
    touches: [cart],
  },
  async handler(input, request: KovoFixtureRequest) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: [input.productId],
    });
    return {};
  },
});

const home = route('/', {
  page: () => (
    <main>
      <CartCount />
      <form mutation={addOpaqueCartItem} enhance>
        <input type="hidden" name="productId" value="p1" />
        <button type="submit">Add opaque item</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [addOpaqueCartItem],
  queries: [cartQuery],
  routes: [home],
});

export default defineFixture({
  app,
  routeReads: { '/': ['cart'] },
  schema: 'create table cart_items (product_id text primary key)',
  touchGraph: {
    [addOpaqueCartItem.key]: {
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'manual-touches-raw-write/app.tsx:73',
          source: 'cart_items',
          via: 'cart_items',
        },
      ],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'manual-touches-raw-write/app.tsx:31',
          via: 'cart_items',
        },
      ],
      unresolved: [
        {
          code: 'KV406',
          domain: 'cart',
          message: 'Statically un-analyzable write site; manual touches required.',
          site: 'manual-touches-raw-write/app.tsx:36',
        },
      ],
    },
  },
  verification: {
    domainByTable: {
      cart_items: 'cart',
    },
  },
});
