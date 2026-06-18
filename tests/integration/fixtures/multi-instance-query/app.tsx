import {
  createApp,
  domain,
  mutation,
  query,
  renderQueryScript,
  route,
  s,
} from '@kovojs/server';
import { runQuery } from '@kovojs/server/internal/execution';
import { escapeAttribute, escapeHtml } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const productDomain = domain('product');

interface ProductArgs {
  id: string;
  restock?: number;
}

interface ProductResult {
  [key: string]: unknown;
  id: string;
  name: string;
  stock: number;
}

async function readProduct(db: KovoFixtureRequest['db'], id: string): Promise<ProductResult> {
  const rows = (await db.query(
    `select id, name, stock from product where id = '${id.replaceAll("'", "''")}'`,
  )) as unknown as ProductResult[];
  return rows[0] ?? { id, name: 'Missing', stock: 0 };
}

export const productQuery = query('product', {
  args: s.object({ id: s.string(), restock: s.number().int().min(0).default(0) }),
  instanceKey: (input) => `product:${(input as ProductArgs).id}`,
  load: (input: ProductArgs, context?: { request: KovoFixtureRequest }) =>
    readProduct(context?.request.db as KovoFixtureRequest['db'], input.id),
  reads: [productDomain],
});

async function renderCard(db: KovoFixtureRequest['db'], id: string): Promise<string> {
  const product = await readProduct(db, id);
  return `<product-card kovo-deps="product:${escapeAttribute(product.id)}" kovo-fragment-target="product-${escapeAttribute(product.id)}" data-product-id="${escapeAttribute(product.id)}">
    <h2>${escapeHtml(product.name)}</h2>
    <p>Stock <span data-bind="product.stock">${product.stock}</span></p>
  </product-card>`;
}

export const restockProduct = mutation('multi-instance-query/restock', {
  csrf: false,
  input: s.object({ id: s.string(), restock: s.number().int().min(1) }),
  registry: {
    queries: [productQuery],
    touches: [productDomain],
  },
  handler: async (input: { id: string; restock: number }, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      `update product set stock = stock + ${input.restock} where id = '${input.id.replaceAll("'", "''")}'`,
    );
    context.invalidate(productDomain, { keys: [input.id] });
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const p1 = await runQuery(productQuery, { id: 'p1', restock: 0 }, request);
    const p2 = await runQuery(productQuery, { id: 'p2', restock: 0 }, request);
    if (!p1.ok || !p2.ok) return '<main>query error</main>';

    return `${renderQueryScript({ key: 'product:p1', name: 'product', value: p1.value })}
    ${renderQueryScript({ key: 'product:p2', name: 'product', value: p2.value })}
    <script type="module" src="/client.ts"></script>
    <main>
      <kovo-fragment target="product-p1">${await renderCard(request.db, 'p1')}</kovo-fragment>
      <kovo-fragment target="product-p2">${await renderCard(request.db, 'p2')}</kovo-fragment>
      <form method="post" action="/_m/multi-instance-query/restock" enhance data-mutation="multi-instance-query/restock" kovo-deps="product">
        <input type="hidden" name="id" value="p1" />
        <input type="hidden" name="restock" value="5" />
        <button type="submit">Restock Pen</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [restockProduct],
  queries: [productQuery],
  routes: [homeRoute],
  mutationResponse: ({ key }) => {
    if (key !== restockProduct.key) return undefined;
    return {
      fragmentRenderers: [],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table product (id text primary key, name text not null, stock integer not null)',
  seed: async (db) => {
    await db.exec("insert into product (id, name, stock) values ('p1', 'Pen', 2)");
    await db.exec("insert into product (id, name, stock) values ('p2', 'Notebook', 9)");
  },
});
