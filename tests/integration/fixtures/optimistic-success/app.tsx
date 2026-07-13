import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  type QueryLoadContext,
} from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type CartSummary = Record<string, unknown> & {
  count: number;
};

async function readCart(db: KovoFixtureRequest['db']): Promise<CartSummary> {
  const rows = await db.query<CartSummary>(
    staticSql`select count from optimistic_cart where id = 1`,
  );
  return rows[0] ?? { count: 0 };
}

const cartDomain = domain('optimistic_cart');

const cartQuery = query('cart', {
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
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({ quantity: s.number() }),
  registry: { tables: ['optimistic_cart'], touches: [cartDomain] },
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
});

export default defineFixture({
  app,
  schema: 'create table optimistic_cart (id integer primary key, count integer not null)',
  seed: (db) => db.exec(staticSql`insert into optimistic_cart (id, count) values (1, 1)`),
});
