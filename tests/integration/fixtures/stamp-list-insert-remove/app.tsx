/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartList } from './cart-list';
import { cartDomain, cartQuery } from './shared';

export const changeCart = mutation('stamp-list-insert-remove/change', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ mode: s.string() }),
  registry: {
    queries: [cartQuery],
    tables: ['cart_item'],
    touches: [cartDomain],
  },
  handler: async (input: { mode: string }, request: KovoFixtureRequest, context) => {
    if (input.mode === 'insert') {
      await request.db.exec(
        staticSql`insert into cart_item (id, name, qty, position) values ('c', 'Cable', 1, 3)`,
      );
    }
    if (input.mode === 'remove') {
      await request.db.exec(staticSql`delete from cart_item where id = 'b'`);
    }
    context.invalidate(cartDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      {trustedHtml('<script type="module" src="/client.ts"></script>')}
      <CartList />
      <form mutation={changeCart} enhance>
        <input type="hidden" name="mode" value="insert" />
        <button type="submit">Insert item</button>
      </form>
      <form mutation={changeCart} enhance>
        <input type="hidden" name="mode" value="remove" />
        <button type="submit">Remove item</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [changeCart],
  queries: [cartQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table cart_item (id text primary key, name text not null, qty integer not null, position integer not null)',
  seed: async (db) => {
    await db.exec(
      staticSql`insert into cart_item (id, name, qty, position) values ('a', 'Adapter', 2, 1)`,
    );
    await db.exec(
      staticSql`insert into cart_item (id, name, qty, position) values ('b', 'Battery', 4, 2)`,
    );
  },
});
