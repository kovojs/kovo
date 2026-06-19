import { createApp, domain, mutation, query, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const product = domain('product');

interface ProductPanelResult extends Record<string, unknown> {
  id: string;
  label: string;
  stock: number;
}

async function readProductPanel(
  db: KovoFixtureRequest['db'],
  id: string,
  label: string,
): Promise<ProductPanelResult> {
  const rows = await db.query<ProductPanelResult>(
    'select id, name as label, stock from products where id = $1',
    [id],
  );
  return rows[0] ?? { id, label, stock: 0 };
}

const productP1Query = query('product', {
  instanceKey: 'product:p1',
  async load(_input, context) {
    const request = context?.request as KovoFixtureRequest;
    return readProductPanel(request.db, 'p1', 'Pen');
  },
  reads: [product],
});

const productP2Query = query('product', {
  instanceKey: 'product:p2',
  async load(_input, context) {
    const request = context?.request as KovoFixtureRequest;
    return readProductPanel(request.db, 'p2', 'Notebook');
  },
  reads: [product],
});

function renderPanel(result: ProductPanelResult): string {
  return `<section data-product-id="${result.id}" kovo-fragment-target="product-${result.id}" kovo-deps="product">
    <h2>${result.label}</h2>
    <output data-bind="product.stock">${result.stock}</output>
  </section>`;
}

function renderInitialQueryScript(name: string, key: string, value: unknown): string {
  return `<script type="application/json" kovo-query="${name}" key="${key}">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`;
}

const bulkRestock = mutation('table-level-invalidation/restock', {
  csrf: false,
  input: s.object({ category: s.string(), threshold: s.number().int().min(0) }),
  registry: {
    queries: [productP1Query, productP2Query],
  },
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query(
      'update products set stock = stock + 1 where category = $1 and stock < $2',
      [input.category, input.threshold],
    );
    // SPEC.md §10.1/§11.1: a non-equality/range predicate degrades to table-level
    // invalidation, so the fixture emits an unkeyed product invalidation.
    context.invalidate(product);
    return {};
  },
});

const home = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const p1 = await readProductPanel(request.db, 'p1', 'Pen');
    const p2 = await readProductPanel(request.db, 'p2', 'Notebook');

    return `${renderInitialQueryScript('product', 'product:p1', p1)}
    ${renderInitialQueryScript('product', 'product:p2', p2)}
    <main>
      <kovo-fragment target="product-p1">${renderPanel(p1)}</kovo-fragment>
      <kovo-fragment target="product-p2">${renderPanel(p2)}</kovo-fragment>
      <form method="post" action="/_m/table-level-invalidation/restock" enhance data-mutation="table-level-invalidation/restock" kovo-deps="product">
        <input type="hidden" name="category" value="office">
        <input type="hidden" name="threshold" value="10">
        <button type="submit">Restock low office stock</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [bulkRestock],
  queries: [productP1Query, productP2Query],
  routes: [home],
  mutationResponses: {
    [bulkRestock.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          {
            render: async () => renderPanel(await readProductPanel(db, 'p1', 'Pen')),
            target: 'product-p1',
          },
          {
            render: async () => renderPanel(await readProductPanel(db, 'p2', 'Notebook')),
            target: 'product-p2',
          },
        ],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table products (id text primary key, name text not null, category text not null, stock integer not null)',
  seed: async (db) => {
    await db.query('insert into products (id, name, category, stock) values ($1, $2, $3, $4)', [
      'p1',
      'Pen',
      'office',
      2,
    ]);
    await db.query('insert into products (id, name, category, stock) values ($1, $2, $3, $4)', [
      'p2',
      'Notebook',
      'office',
      9,
    ]);
  },
  touchGraph: {
    [bulkRestock.key]: {
      touches: [
        {
          domain: 'product',
          keys: null,
          site: 'table-level-invalidation/app.tsx:60',
          via: 'products',
        },
      ],
      unresolved: [],
    },
  },
  verification: {
    domainByTable: {
      products: 'product',
    },
  },
});
