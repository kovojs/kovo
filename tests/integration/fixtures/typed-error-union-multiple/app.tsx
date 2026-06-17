// Mutation wire fixture for SPEC.md §6.3 and §9.2: one mutation can expose
// multiple declared typed errors and render the selected branch on the wire.
import { createApp, mutation, route, s, type MutationFail } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const checkout = mutation('checkout/submit', {
  csrf: false,
  errors: {
    CARD_DECLINED: s.object({}),
    OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }),
  },
  input: s.object({
    quantity: s.number().int().min(1),
  }),
  handler: async (input, request: KovoFixtureRequest, context) => {
    const rows = await request.db.query<{ stock: number }>(
      'select stock from inventory where id = 1',
    );
    const stock = Number(rows[0]?.stock ?? 0);
    if (input.quantity > stock) return context.fail('OUT_OF_STOCK', { available: stock });
    if (input.quantity === 2) return context.fail('CARD_DECLINED', {});
    await request.db.query('update inventory set stock = stock - $1 where id = 1', [
      input.quantity,
    ]);
    return { quantity: input.quantity };
  },
});

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Checkout</h1>
    <div kovo-fragment-target="checkout-error"></div>
    <form method="post" action="/_m/checkout/submit" enhance data-mutation="checkout/submit">
      <label>Quantity <input name="quantity" type="number" value="1" /></label>
      <button type="submit">Pay</button>
    </form>
  </main>`,
});

function renderCheckoutFailure(failure: MutationFail): string {
  if (failure.error.code === 'OUT_OF_STOCK') {
    const available = (failure.error.payload as { available?: number }).available ?? 0;
    return `<div kovo-fragment-target="checkout-error" role="alert" data-error-code="OUT_OF_STOCK">Only ${available} available</div>`;
  }
  return '<div kovo-fragment-target="checkout-error" role="alert" data-error-code="CARD_DECLINED">Card declined</div>';
}

const app = createApp({
  mutations: [checkout],
  routes: [homeRoute],
  mutationResponse: ({ key }) => {
    if (key !== checkout.key) return undefined;
    return {
      failureTarget: 'checkout-error',
      redirectTo: '/',
      renderFailureFragment: renderCheckoutFailure,
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table inventory (id integer primary key, stock integer not null default 0)',
  seed: (db) => db.exec('insert into inventory (id, stock) values (1, 3)'),
});
