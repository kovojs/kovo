/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartPanel } from './cart-panel';
import { cartDomain, cartQuery, readCart } from './shared';

const addItem = mutation('optimistic-success/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({ quantity: s.number() }),
  registry: { queries: [cartQuery], tables: ['optimistic_cart'], touches: [cartDomain] },
  handler: async (input: { quantity: number }, request: KovoFixtureRequest, context) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await request.db.exec({
      text: 'update optimistic_cart set count = count + $1 + 1 where id = 1',
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
        <CartPanel />
        <output data-testid="cart-double">{cart.count * 2}</output>
        {/* client.ts owns this optimistic submit; typed enrollment would double-dispatch it. */}
        <form id="optimistic-form" method="post" action="/_m/optimistic-success/add">
          <input type="hidden" name="quantity" value="2" />
          <button type="submit">Add optimistically</button>
        </form>
        <state-toggle kovo-c="state-toggle" kovo-state='{"on":false}'>
          <button type="button" on:click="/state-actions.ts#toggle">
            toggle
          </button>
          <output data-bind="state.on" data-testid="toggle-state">
            false
          </output>
        </state-toggle>
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
  seed: (db) => db.exec(staticSql`insert into optimistic_cart (id, count) values (1, 1)`),
});
