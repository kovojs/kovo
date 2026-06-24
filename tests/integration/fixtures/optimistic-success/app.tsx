import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  type QueryLoadContext,
  publicAccess,
} from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type CartSummary = Record<string, unknown> & {
  count: number;
};

async function readCart(db: KovoFixtureRequest['db']): Promise<CartSummary> {
  const rows = await db.query<CartSummary>('select count from optimistic_cart where id = 1');
  return rows[0] ?? { count: 0 };
}

const cartDomain = domain('optimistic_cart');

const cartQuery = query('cart', {
  access: publicAccess('integration fixture query cart has no runtime guard'),
  reads: [cartDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('optimistic cart query requires request.db');
    return readCart(db);
  },
});

async function renderCartPanel(db: KovoFixtureRequest['db']): Promise<string> {
  const cart = await readCart(db);
  return `<section id="cart-panel" kovo-fragment-target="cart-panel" kovo-deps="cart">
    <output data-bind="cart.count">${cart.count}</output>
  </section>`;
}

const addItem = mutation('optimistic-success/add', {
  access: publicAccess('integration fixture mutation optimistic-success/add has no runtime guard'),
  csrf: false,
  input: s.object({ quantity: s.number() }),
  handler: async (input: { quantity: number }, request: KovoFixtureRequest, context) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await request.db.exec(
      `update optimistic_cart set count = count + ${input.quantity} + 1 where id = 1`,
    );
    context.invalidate(cartDomain);
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const cart = await readCart(request.db);
    return `${renderQueryScript({ name: 'cart', value: cart })}
    <script type="module" src="/client.ts"></script>
    <main>
      ${await renderCartPanel(request.db)}
      <!-- Derived-optimism (C6): a client query-derive (count * 2) that must predict and
           reconcile in lockstep with the optimistic mutation. SSR'd from server truth. -->
      <output data-testid="cart-double">${cart.count * 2}</output>
      <form id="optimistic-form" method="post" action="/_m/optimistic-success/add">
        <input type="hidden" name="quantity" value="2">
        <button type="submit">Add optimistically</button>
      </form>
      <!-- Sibling pure-client state island (bugs-1 C8d multi-feature): its local state
           must survive an optimistic mutation + fragment morph of the cart panel. -->
      <state-toggle kovo-c="state-toggle" kovo-state='{"on":false}'>
        <button type="button" on:click="/state-actions.ts#toggle">toggle</button>
        <output data-bind="state.on" data-testid="toggle-state">false</output>
      </state-toggle>
    </main>`;
  },
});

const app = createApp({
  mutations: [addItem],
  queries: [cartQuery],
  routes: [homeRoute],
  mutationResponses: {
    [addItem.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          {
            // Append a kovo-query WIRE element so the reconcile updates the query STORE
            // (server truth) via applyQueryChunksToRuntime, not just the DOM fragment —
            // store-derived consumers (cart-double) reconcile too. The loader extracts the
            // kovo-query from the wire; the morph applies only the first element (the
            // cart-panel section), so no stray node lands in the DOM.
            render: async () =>
              `${await renderCartPanel(db)}<kovo-query name="cart">${JSON.stringify(await readCart(db))}</kovo-query>`,
            target: 'cart-panel',
          },
        ],
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table optimistic_cart (id integer primary key, count integer not null)',
  seed: (db) => db.exec('insert into optimistic_cart (id, count) values (1, 1)'),
});
