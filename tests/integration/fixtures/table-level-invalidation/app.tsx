import { createApp, domain, mutation, query, route, s } from '@kovojs/server';
import {
  defineFixture,
  type KovoFixtureReaderRequest,
  type KovoFixtureRequest,
} from '@kovojs/test/internal/integration/define';

const product = domain('product');

interface ProductPanelResult extends Record<string, unknown> {
  id: string;
  label: string;
  stock: number;
}

async function readProductPanelFromReader(
  db: KovoFixtureReaderRequest['db'],
  id: string,
  label: string,
): Promise<ProductPanelResult> {
  const rows = await db.rawRead<ProductPanelResult>(
    {
      text: 'select id, name as label, stock from products where id = $1',
      values: [id],
    },
    { reads: ['products'] },
  );
  return rows[0] ?? { id, label, stock: 0 };
}

async function readProductPanelFromWriter(
  db: KovoFixtureRequest['db'],
  id: string,
  label: string,
): Promise<ProductPanelResult> {
  const rows = await db.query<ProductPanelResult>({
    text: 'select id, name as label, stock from products where id = $1',
    values: [id],
  });
  return rows[0] ?? { id, label, stock: 0 };
}

const productQuery = query('product', {
  args: s.object({ id: s.string(), label: s.string() }),
  instanceKey: (input) => `product:${input.id}`,
  async load(input: { id: string; label: string }, context) {
    const request = context?.request as KovoFixtureReaderRequest;
    return readProductPanelFromReader(request.db, input.id, input.label);
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
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({ category: s.string(), threshold: s.number().int().min(0) }),
  registry: {
    queries: [productQuery],
    tables: ['products'],
  },
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'update products set stock = stock + 1 where category = $1 and stock < $2',
      values: [input.category, input.threshold],
    });
    // SPEC.md §10.1/§11.1: a non-equality/range predicate degrades to table-level
    // invalidation, so the fixture emits an unkeyed product invalidation.
    context.invalidate(product);
    return {};
  },
});

const home = route('/', {
  page: async (_context, request: KovoFixtureReaderRequest) => {
    const p1 = await readProductPanelFromReader(request.db, 'p1', 'Pen');
    const p2 = await readProductPanelFromReader(request.db, 'p2', 'Notebook');

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
  queries: [productQuery],
  routes: [home],
  mutationResponses: {
    [bulkRestock.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          {
            render: async () => renderPanel(await readProductPanelFromWriter(db, 'p1', 'Pen')),
            target: 'product-p1',
          },
          {
            render: async () => renderPanel(await readProductPanelFromWriter(db, 'p2', 'Notebook')),
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
  routeReads: { '/': ['product'] },
  schema:
    'create table products (id text primary key, name text not null, category text not null, stock integer not null)',
  seed: async (db) => {
    await db.query({
      text: 'insert into products (id, name, category, stock) values ($1, $2, $3, $4)',
      values: ['p1', 'Pen', 'office', 2],
    });
    await db.query({
      text: 'insert into products (id, name, category, stock) values ($1, $2, $3, $4)',
      values: ['p2', 'Notebook', 'office', 9],
    });
  },
  touchGraph: {
    [bulkRestock.key]: {
      reads: [
        {
          domain: 'product',
          keys: null,
          site: 'table-level-invalidation/app.tsx:111',
          source: 'products',
          via: 'products',
        },
      ],
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
