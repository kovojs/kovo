import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  type MutationFail,
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
    if (!db) throw new Error('optimistic rollback cart query requires request.db');
    return readCart(db);
  },
});

async function renderCartPanel(db: KovoFixtureRequest['db']): Promise<string> {
  const cart = await readCart(db);
  return `<section id="cart-panel" kovo-fragment-target="cart-panel" kovo-deps="cart">
    <output data-bind="cart.count">${cart.count}</output>
  </section>`;
}

const addItem = mutation('optimistic-rollback/add', {
  access: publicAccess('integration fixture mutation optimistic-rollback/add has no runtime guard'),
  csrf: false,
  errors: { OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }) },
  input: s.object({ quantity: s.number() }),
  handler: async (_input: { quantity: number }, _request: KovoFixtureRequest, context) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return context.fail('OUT_OF_STOCK', { available: 0 });
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
      <div id="cart-error" kovo-fragment-target="cart-error"></div>
      <form id="optimistic-form" method="post" action="/_m/optimistic-rollback/add">
        <input type="hidden" name="quantity" value="2">
        <button type="submit">Add optimistically</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [addItem],
  queries: [cartQuery],
  routes: [homeRoute],
  mutationResponses: {
    [addItem.key]: () => {
      return {
        failureTarget: 'cart-error',
        renderFailureFragment: (failure: MutationFail) => {
          const available = (failure.error.payload as { available?: number }).available ?? 0;
          return `<div id="cart-error" kovo-fragment-target="cart-error" role="alert" data-error-code="${failure.error.code}">Only ${available} available</div>`;
        },
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table optimistic_cart (id integer primary key, count integer not null)',
  seed: (db) => db.exec('insert into optimistic_cart (id, count) values (1, 4)'),
});
