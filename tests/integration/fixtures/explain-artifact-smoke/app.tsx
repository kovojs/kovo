/** @jsxImportSource @kovojs/server */
// SPEC.md §5.3 + §11.4: explain output names the behavior surface humans drive.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CartBadge } from './cart-badge';
import { cartDomain, cartQuery } from './shared';

export const addToCart = mutation('cart/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ sku: s.string() }),
  registry: { queries: [cartQuery], tables: ['cart_items'], touches: [cartDomain] },
  handler: async (input: { sku: string }, request: KovoFixtureRequest, context) => {
    await request.db.exec({
      text: 'insert into cart_items (sku) values ($1)',
      values: [input.sku],
    });
    context.invalidate(cartDomain);
    return {};
  },
});

const app = createApp({
  mutations: [addToCart],
  queries: [cartQuery],
  routes: [
    route('/', {
      page: () => (
        <main data-page="cart">
          <CartBadge />
          <form mutation={addToCart} enhance>
            <input name="sku" value="sku-1" />
            <button type="submit">Add to cart</button>
          </form>
        </main>
      ),
    }),
  ],
});

export default defineFixture({
  app,
  schema: 'create table cart_items (id serial primary key, sku text not null)',
});
