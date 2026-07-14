/** @jsxImportSource @kovojs/server */
// I3 fixture: typed mutation errors → failure-fragment morph. `buy` decrements
// stock, or returns a typed OUT_OF_STOCK failure when empty. On success the stock
// badge re-renders; on failure the app's renderFailureFragment morphs an error
// region carrying the compiler/runtime error channel attrs (data-error-code).
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { BuyForm } from './buy-form';
import { item, itemQuery, readStock } from './shared';

export const buy = mutation('stock/buy', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  errors: { OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }) },
  input: s.object({}),
  registry: { queries: [itemQuery], tables: ['item'], touches: [item] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    const { stock } = await readStock(request.db);
    if (stock <= 0) return context.fail('OUT_OF_STOCK', { available: 0 });
    await request.db.exec(staticSql`update item set stock = stock - 1 where id = 1`);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <BuyForm />
    </main>
  ),
});

const app = createApp({
  mutations: [buy],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table item (id integer primary key, stock integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into item (id, stock) values (1, 1)`),
});
