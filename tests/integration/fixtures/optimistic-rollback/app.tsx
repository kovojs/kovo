/** @jsxImportSource @kovojs/server */
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
import { trustedHtml } from '@kovojs/browser';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { OptimisticForm } from './optimistic-form';

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

export const addItem = mutation('optimistic-rollback/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  errors: { OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }) },
  input: s.object({ quantity: s.number() }),
  handler: async (_input: { quantity: number }, _request: KovoFixtureRequest, context) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return context.fail('OUT_OF_STOCK', { available: 0 });
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const cart = await readCart(request.db);
    return (
      <>
        {trustedHtml(renderQueryScript({ name: 'cart', value: cart }))}
        {trustedHtml('<script type="module" src="/client.ts"></script>')}
        <main>
          {trustedHtml(await renderCartPanel(request.db))}
          <OptimisticForm />
        </main>
      </>
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
  seed: (db) => db.exec(staticSql`insert into optimistic_cart (id, count) values (1, 4)`),
});
