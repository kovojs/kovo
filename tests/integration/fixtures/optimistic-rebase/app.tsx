import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  type QueryLoadContext,
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
  reads: [cartDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('optimistic rebase cart query requires request.db');
    return readCart(db);
  },
});

async function renderCartPanel(db: KovoFixtureRequest['db']): Promise<string> {
  const cart = await readCart(db);
  return `<section id="cart-panel" kovo-fragment-target="cart-panel" kovo-deps="cart">
    <output data-bind="cart.count">${cart.count}</output>
  </section>`;
}

const addItem = mutation('optimistic-rebase/add', {
  csrf: false,
  input: s.object({ delay: s.number(), quantity: s.number() }),
  registry: {
    queries: [cartQuery],
    touches: [cartDomain],
  },
  handler: async (input: { delay: number; quantity: number }, request: KovoFixtureRequest) => {
    await new Promise((resolve) => setTimeout(resolve, input.delay));
    await request.db.exec(
      `update optimistic_cart set count = count + ${input.quantity} where id = 1`,
    );
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const cart = await readCart(request.db);
    return `${renderQueryScript({ name: 'cart', value: cart })}
    <script type="module" src="/client.ts"></script>
    <main>
      ${await renderCartPanel(request.db)}
      <form id="first-form" method="post" action="/_m/optimistic-rebase/add">
        <input type="hidden" name="quantity" value="2">
        <input type="hidden" name="delay" value="500">
        <button type="submit">Add first</button>
      </form>
      <form id="second-form" method="post" action="/_m/optimistic-rebase/add">
        <input type="hidden" name="quantity" value="5">
        <input type="hidden" name="delay" value="8000">
        <button type="submit">Add second</button>
      </form>
    </main>`;
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
  seed: (db) => db.exec('insert into optimistic_cart (id, count) values (1, 0)'),
});
