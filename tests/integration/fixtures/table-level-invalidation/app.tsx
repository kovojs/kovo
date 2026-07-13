/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ProductPanel } from './product-panel';
import { product, productQuery } from './shared';

const bulkRestock = mutation('table-level-invalidation/restock', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ category: s.string(), threshold: s.number().int().min(0) }),
  registry: {
    tables: ['products'],
    touches: [product],
  },
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'update products set stock = stock + 1 where category = $1 and stock < $2',
      values: [input.category, input.threshold],
    });
    // SPEC.md §10.1/§11.1: a non-equality/range predicate degrades to table-level
    // invalidation, so the fixture emits an unkeyed product invalidation.
    context.invalidate(product);
    return {};
  },
});

const home = route('/', {
  page: () => (
    <main>
      <ProductPanel productId="p1" label="Pen" key="p1" />
      <ProductPanel productId="p2" label="Notebook" key="p2" />
      <form mutation={bulkRestock} enhance>
        <input type="hidden" name="category" value="office" />
        <input type="hidden" name="threshold" value="10" />
        <button type="submit">Restock low office stock</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [bulkRestock],
  queries: [productQuery],
  routes: [home],
});

export default defineFixture({
  app,
  routeReads: { '/': ['product'] },
  schema:
    'create table products (id text primary key, name text not null, category text not null, stock integer not null)',
  seed: async (db) => {
    await db.query({
      text: 'insert into products (id, name, category, stock) values ($1, $2, $3, $4)',
      values: ['p1', 'Pen', 'office', 2],
    });
    await db.query({
      text: 'insert into products (id, name, category, stock) values ($1, $2, $3, $4)',
      values: ['p2', 'Notebook', 'office', 9],
    });
  },
  touchGraph: {
    [bulkRestock.key]: {
      reads: [
        {
          domain: 'product',
          keys: null,
          site: 'table-level-invalidation/app.tsx:111',
          source: 'products',
          via: 'products',
        },
      ],
      touches: [
        {
          domain: 'product',
          keys: null,
          site: 'table-level-invalidation/app.tsx:60',
          via: 'products',
        },
      ],
      unresolved: [],
    },
  },
  verification: {
    domainByTable: {
      products: 'product',
    },
  },
});
