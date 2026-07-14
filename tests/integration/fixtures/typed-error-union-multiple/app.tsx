/** @jsxImportSource @kovojs/server */
// Mutation wire fixture for SPEC.md §6.3 and §9.2: one mutation can expose
// multiple declared typed errors and render the selected branch on the wire.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CheckoutForm } from './checkout-form';

export const checkout = mutation('checkout/submit', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  errors: {
    CARD_DECLINED: s.object({}),
    OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }),
  },
  input: s.object({
    quantity: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest, context) => {
    const rows = await request.db.query<{ stock: number }>(
      staticSql`select stock from inventory where id = 1`,
    );
    const stock = Number(rows[0]?.stock ?? 0);
    if (input.quantity > stock) return context.fail('OUT_OF_STOCK', { available: stock });
    if (input.quantity === 2) return context.fail('CARD_DECLINED', {});
    await request.db.query({
      text: 'update inventory set stock = stock - $1 where id = 1',
      values: [input.quantity],
    });
    return { quantity: input.quantity };
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Checkout</h1>
      <CheckoutForm />
    </main>
  ),
});

const app = createApp({
  mutations: [checkout],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table inventory (id integer primary key, stock integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into inventory (id, stock) values (1, 3)`),
});
