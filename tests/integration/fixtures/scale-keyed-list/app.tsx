/** @jsxImportSource @kovojs/server */
// SPEC §4.8 keyed stamps at volume (plans/bugs-and-testing.md P3 scale; testing-audit §5.6):
// a 300-row keyed list reconciled through a fragment patch must keep identity correct at
// scale — the right row removed, order preserved, no mis-keying or duplicate keys.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartList } from './cart-list';
import { cartDomain, cartQuery } from './shared';

export const changeCart = mutation('scale-keyed-list/change', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { queries: [cartQuery], tables: ['cart_item'], touches: [cartDomain] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    // Remove a row in the middle and bump the first row's qty: identity must hold.
    await request.db.exec(staticSql`delete from cart_item where id = 'r150'`);
    await request.db.exec(staticSql`update cart_item set qty = 999 where id = 'r0'`);
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
        <button type="submit">Change</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [changeCart],
  queries: [cartQuery],
  requestLimits: { maxQueryListItems: 400 },
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table cart_item (id text primary key, name text not null, qty integer not null, position integer not null)',
  seed: (db) =>
    db.exec(
      staticSql`insert into cart_item (id, name, qty, position) select 'r' || g, 'Item ' || g, g, g from generate_series(0, 299) as g`,
    ),
});
