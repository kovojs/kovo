// SPEC §9.4 + §10.2: typed read endpoints parse args from search params and
// return chunks keyed by the canonical query instance key.
import { createApp, domain, query, route, s } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { runQuery } from '@kovojs/server/internal/execution';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const productDomain = domain('product');

interface ProductArgs {
  id: string;
  max: number;
}

interface ProductResult {
  id: string;
  name: string;
  price: number;
  withinBudget: boolean;
}

export const productQuery = query('product', {
  args: s.object({ id: s.string(), max: s.number().int().min(1).default(9999) }),
  instanceKey: (input) => `product:${(input as ProductArgs).id}`,
  load: async (input: ProductArgs, context?: { request: KovoFixtureRequest }) => {
    const rows = (await context?.request.db.query(
      `select id, name, price from product where id = '${input.id.replaceAll("'", "''")}'`,
    )) as Array<{ id: string; name: string; price: number }>;
    const product = rows[0] ?? { id: input.id, name: 'Missing', price: 0 };
    return { ...product, withinBudget: product.price <= input.max } satisfies ProductResult;
  },
  reads: [productDomain],
});

const homeRoute = route('/', {
  search: s.object({ id: s.string(), max: s.number().int().min(1).default(9999) }),
  page: async ({ search }, request: KovoFixtureRequest) => {
    const result = await runQuery(productQuery, search, request);
    if (!result.ok) return `<main><p data-error>${result.error.code}</p></main>`;

    return `${renderQueryScript({
      key: `product:${search.id}`,
      name: 'product',
      value: result.value,
    })}
    <main>
      <product-card kovo-deps="product">
        <p data-product>${result.value.id}:${result.value.name}:${result.value.withinBudget}</p>
      </product-card>
    </main>`;
  },
});

export default defineFixture({
  app: createApp({ queries: [productQuery], routes: [homeRoute] }),
  schema: 'create table product (id text primary key, name text not null, price integer not null)',
  seed: async (db) => {
    await db.exec("insert into product (id, name, price) values ('p1', 'Pen', 199)");
    await db.exec("insert into product (id, name, price) values ('p2', 'Notebook', 799)");
  },
});
