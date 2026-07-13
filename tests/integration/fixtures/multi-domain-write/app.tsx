/** @jsxImportSource @kovojs/server */
// SPEC §11.1/§11.2, KV402 (plans/bugs-and-testing.md C7; testing-audit §5.1): one
// handler writing TWO domains. The runtime cross-check must pass when both are
// declared and fail loudly naming the MISSING domain when one is omitted.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartCount } from './cart-count';
import { ProductStock } from './product-stock';
import { cart, cartQuery, product, productQuery } from './shared';

// Writes cart_items (cart) AND products (product); declares BOTH (touchGraph below).
const addBoth = mutation('multi-domain-write/add-both', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [cartQuery, productQuery],
    tables: ['cart_items', 'products'],
    touches: [cart, product],
  },
  async handler(_input: unknown, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: ['p1'],
    });
    await request.db.query({
      text: 'update products set stock = stock - 1 where id = $1',
      values: ['p1'],
    });
    context.invalidate(cart);
    context.invalidate(product);
    return {};
  },
});

// Writes both domains but the touchGraph DECLARES ONLY cart — product is the
// silently-stale domain KV402 must catch.
const addPartial = mutation('multi-domain-write/add-partial', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { queries: [cartQuery], tables: ['cart_items', 'products'], touches: [cart] },
  async handler(_input: unknown, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: ['p2'],
    });
    await request.db.query({
      text: 'update products set stock = stock - 1 where id = $1',
      values: ['p1'],
    });
    context.invalidate(cart);
    return {};
  },
});

const home = route('/', {
  page: () => (
    <main>
      <CartCount />
      <ProductStock />
      <form
        method="post"
        action="/_m/multi-domain-write/add-both"
        enhance
        data-mutation="multi-domain-write/add-both"
      >
        <button type="submit">Add both</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [addBoth, addPartial],
  queries: [cartQuery, productQuery],
  routes: [home],
});

export default defineFixture({
  app,
  routeReads: { '/': ['cart', 'product'] },
  schema: [
    'create table cart_items (id integer primary key generated always as identity, product_id text not null)',
    'create table products (id text primary key, stock integer not null)',
  ],
  seed: (db) => db.exec(staticSql`insert into products (id, stock) values ('p1', 5)`),
  touchGraph: {
    [addBoth.key]: {
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'multi-domain-write/app.tsx:117',
          source: 'cart_items',
          via: 'cart_items',
        },
        {
          domain: 'product',
          keys: null,
          site: 'multi-domain-write/app.tsx:120',
          source: 'products',
          via: 'products',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'multi-domain-write/app.tsx:31', via: 'cart_items' },
        { domain: 'product', keys: null, site: 'multi-domain-write/app.tsx:32', via: 'products' },
      ],
      unresolved: [],
    },
    [addPartial.key]: {
      // product is intentionally OMITTED — the runtime cross-check must catch it.
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'multi-domain-write/app.tsx:130',
          source: 'cart_items',
          via: 'cart_items',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'multi-domain-write/app.tsx:45', via: 'cart_items' },
      ],
      unresolved: [],
    },
  },
  verification: {
    domainByTable: { cart_items: 'cart', products: 'product' },
  },
});
