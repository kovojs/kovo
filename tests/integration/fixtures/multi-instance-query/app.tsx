/** @jsxImportSource @kovojs/server */
import { renderQueryScript, staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ProductCard } from './product-card';
import { productDomain, productQuery, readProduct } from './shared';
import { StaticProductCard } from './static-product-card';

export const restockProduct = mutation('multi-instance-query/restock', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ id: s.string(), restock: s.number().int().min(1) }),
  registry: {
    queries: [productQuery],
    tables: ['product'],
    touches: [productDomain],
  },
  handler: async (input: { id: string; restock: number }, request: KovoFixtureRequest, context) => {
    await request.db.exec({
      text: 'update product set stock = stock + $1 where id = $2',
      values: [input.restock, input.id],
    });
    context.invalidate(productDomain, { keys: [input.id] });
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const p1 = await readProduct(request.db, 'p1');
    const p2 = await readProduct(request.db, 'p2');
    return (
      <main>
        {trustedHtml(renderQueryScript({ key: 'product:p1', name: 'product', value: p1 }))}
        {trustedHtml(renderQueryScript({ key: 'product:p2', name: 'product', value: p2 }))}
        {trustedHtml('<script type="module" src="/client.ts"></script>')}
        <ProductCard key="p1" productId="p1" />
        <StaticProductCard key="p2" productId="p2" />
        <form mutation={restockProduct} enhance>
          <input type="hidden" name="id" value="p1" />
          <input type="hidden" name="restock" value="5" />
          <button type="submit">Restock Pen</button>
        </form>
      </main>
    );
  },
});

const app = createApp({
  mutations: [restockProduct],
  queries: [productQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table product (id text primary key, name text not null, stock integer not null)',
  seed: async (db) => {
    await db.exec(staticSql`insert into product (id, name, stock) values ('p1', 'Pen', 2)`);
    await db.exec(staticSql`insert into product (id, name, stock) values ('p2', 'Notebook', 9)`);
  },
});
