/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartCount } from './cart-count';
import { cart, cartQuery } from './shared';

const addCartItem = mutation('touch-graph-runtime-crosscheck/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ productId: s.string() }),
  registry: { queries: [cartQuery], tables: ['cart_items'], touches: [cart] },
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: [input.productId],
    });
    context.invalidate(cart);
    return {};
  },
});

const smuggleAuditWrite = mutation('touch-graph-runtime-crosscheck/smuggle', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ productId: s.string() }),
  registry: { tables: ['cart_items'], touches: [cart] },
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'insert into audit_log (product_id) values ($1)',
      values: [input.productId],
    });
    context.invalidate(cart);
    return {};
  },
});

const home = route('/', {
  page: () => (
    <main>
      <CartCount />
      <form
        method="post"
        action="/_m/touch-graph-runtime-crosscheck/add"
        enhance
        data-mutation="touch-graph-runtime-crosscheck/add"
      >
        <input type="hidden" name="productId" value="p1" />
        <button type="submit">Add item</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [addCartItem, smuggleAuditWrite],
  queries: [cartQuery],
  routes: [home],
});

export default defineFixture({
  app,
  routeReads: { '/': ['cart'] },
  schema: [
    'create table cart_items (product_id text primary key)',
    'create table audit_log (product_id text not null)',
  ],
  touchGraph: {
    [addCartItem.key]: {
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'touch-graph-runtime-crosscheck/app.tsx:77',
          source: 'cart_items',
          via: 'cart_items',
        },
      ],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'touch-graph-runtime-crosscheck/app.tsx:16',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    },
    [smuggleAuditWrite.key]: {
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'touch-graph-runtime-crosscheck/app.tsx:86',
          source: 'cart_items',
          via: 'cart_items',
        },
      ],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'touch-graph-runtime-crosscheck/app.tsx:25',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    },
  },
  verification: {
    domainByTable: {
      audit_log: 'audit',
      cart_items: 'cart',
    },
  },
});
