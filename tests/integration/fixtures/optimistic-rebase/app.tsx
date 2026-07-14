/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartPanelAuthority } from './cart-panel';
import { cartDomain, cartQuery, readCart } from './shared';

const addItem = mutation('optimistic-rebase/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({ delay: s.number(), quantity: s.number() }),
  registry: {
    queries: [cartQuery],
    tables: ['optimistic_cart'],
    touches: [cartDomain],
  },
  handler: async (
    input: { delay: number; quantity: number },
    request: KovoFixtureRequest,
    context,
  ) => {
    await new Promise((resolve) => setTimeout(resolve, input.delay));
    await request.db.exec({
      text: 'update optimistic_cart set count = count + $1 where id = 1',
      values: [input.quantity],
    });
    context.invalidate(cartDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const cart = await readCart(request.db);
    return (
      <main>
        {trustedHtml(renderQueryScript({ name: 'cart', value: cart }))}
        {trustedHtml('<script type="module" src="/client.ts"></script>')}
        <CartPanelAuthority />
        <section id="cart-panel" kovo-deps="cart">
          <output data-bind="cart.count">{cart.count}</output>
        </section>
        <form id="first-form" method="post" action="/_m/optimistic-rebase/add">
          <input type="hidden" name="quantity" value="2" />
          <input type="hidden" name="delay" value="500" />
          <button type="submit">Add first</button>
        </form>
        <form id="second-form" method="post" action="/_m/optimistic-rebase/add">
          <input type="hidden" name="quantity" value="5" />
          <input type="hidden" name="delay" value="8000" />
          <button type="submit">Add second</button>
        </form>
      </main>
    );
  },
});

const app = createApp({
  mutations: [addItem],
  queries: [cartQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table optimistic_cart (id integer primary key, count integer not null)',
  seed: (db) => db.exec(staticSql`insert into optimistic_cart (id, count) values (1, 0)`),
});
