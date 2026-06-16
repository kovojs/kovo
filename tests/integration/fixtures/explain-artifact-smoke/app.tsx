// SPEC.md §5.3 + §11.4: explain output names the behavior surface humans drive.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

async function renderCartBadge(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>('select count(*)::int as count from cart_items');
  return `<output data-bind="cart.count">${rows[0]?.count ?? 0}</output>`;
}

async function renderCartSection(db: KovoFixtureRequest['db']): Promise<string> {
  return `<section data-component="CartBadge" kovo-fragment-target="cart-badge" kovo-deps="cart">
    <h1>Cart</h1>
    ${await renderCartBadge(db)}
  </section>`;
}

export const addToCart = mutation('cart/add', {
  csrf: false,
  input: s.object({ sku: s.string() }),
  handler: async (input: { sku: string }, request: KovoFixtureRequest) => {
    await request.db.exec(
      `insert into cart_items (sku) values ('${input.sku.replaceAll("'", "''")}')`,
    );
    return {};
  },
});

const app = createApp({
  mutations: [addToCart],
  routes: [
    route('/', {
      page: async (_context, request: KovoFixtureRequest) => `<main data-page="cart">
        ${await renderCartSection(request.db)}
        <form method="post" action="/_m/cart/add" enhance data-mutation="cart/add" kovo-deps="cart">
          <input name="sku" value="sku-1">
          <button type="submit">Add to cart</button>
        </form>
      </main>`,
    }),
  ],
  mutationResponse: ({ key, request }) => {
    if (key !== addToCart.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderCartSection(db), target: 'cart-badge' }],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table cart_items (id serial primary key, sku text not null)',
});
