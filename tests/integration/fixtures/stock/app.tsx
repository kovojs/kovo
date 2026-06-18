// I3 fixture: typed mutation errors → failure-fragment morph. `buy` decrements
// stock, or returns a typed OUT_OF_STOCK failure when empty. On success the stock
// badge re-renders; on failure the app's renderFailureFragment morphs an error
// region carrying the compiler/runtime error channel attrs (data-error-code).
import { createApp, mutation, route, s, type MutationFail } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { readStock } from './shared';
import { StockBadge } from './stock-badge';

function renderBadge(db: KovoFixtureRequest['db']): Promise<string> {
  return readStock(db).then(
    (stock) => StockBadge.definition.render({ item: stock }) as unknown as string,
  );
}

export const buy = mutation('stock/buy', {
  csrf: false,
  errors: { OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }) },
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    const { stock } = await readStock(request.db);
    if (stock <= 0) return context.fail('OUT_OF_STOCK', { available: 0 });
    await request.db.exec('update item set stock = stock - 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const badge = await renderBadge(request.db);
    return `<main>
      <kovo-fragment target="stock-badge">${badge}</kovo-fragment>
      <div kovo-fragment-target="buy-error"></div>
      <form method="post" action="/_m/stock/buy" enhance data-mutation="stock/buy" kovo-deps="item">
        <button type="submit">Buy</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [buy],
  routes: [homeRoute],
  mutationResponses: {
    [buy.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        failureTarget: 'buy-error',
        fragmentRenderers: [{ render: () => renderBadge(db), target: 'stock-badge' }],
        renderFailureFragment: (failure: MutationFail) => {
          const available = (failure.error.payload as { available?: number }).available ?? 0;
          return `<div kovo-fragment-target="buy-error" role="alert" data-error-code="${failure.error.code}" data-error-path="quantity">Sold out (${available} left)</div>`;
        },
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table item (id integer primary key, stock integer not null default 0)',
  seed: (db) => db.exec('insert into item (id, stock) values (1, 1)'),
});
