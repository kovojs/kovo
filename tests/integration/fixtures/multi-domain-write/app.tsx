// SPEC §11.1/§11.2, KV402 (plans/bugs-and-testing.md C7; testing-audit §5.1): one
// handler writing TWO domains. The runtime cross-check must pass when both are
// declared and fail loudly naming the MISSING domain when one is omitted.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, domain, mutation, route, s } from '@kovojs/server';
import {
  defineFixture,
  type KovoFixtureReaderRequest,
  type KovoFixtureRequest,
} from '@kovojs/test/internal/integration/define';

const cart = domain('cart');
const product = domain('product');

async function cartCountReader(db: KovoFixtureReaderRequest['db']): Promise<number> {
  const rows = await db.rawRead<{ count: number }>(
    staticSql`select count(*)::int as count from cart_items`,
    { reads: ['cart_items'] },
  );
  return rows[0]?.count ?? 0;
}

async function cartCountWriter(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ count: number }>(
    staticSql`select count(*)::int as count from cart_items`,
  );
  return rows[0]?.count ?? 0;
}

async function productStockReader(db: KovoFixtureReaderRequest['db']): Promise<number> {
  const rows = await db.rawRead<{ stock: number }>(
    {
      text: 'select stock from products where id = $1',
      values: ['p1'],
    },
    { reads: ['products'] },
  );
  return rows[0]?.stock ?? 0;
}

async function productStockWriter(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ stock: number }>({
    text: 'select stock from products where id = $1',
    values: ['p1'],
  });
  return rows[0]?.stock ?? 0;
}

function renderCart(count: number): string {
  return `<p kovo-fragment-target="cart-count" kovo-deps="cart" data-testid="cart-count">${count}</p>`;
}

function renderStock(stock: number): string {
  return `<p kovo-fragment-target="product-stock" kovo-deps="product" data-testid="product-stock">${stock}</p>`;
}

// Writes cart_items (cart) AND products (product); declares BOTH (touchGraph below).
const addBoth = mutation('multi-domain-write/add-both', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: { tables: ['cart_items', 'products'], touches: [cart, product] },
  async handler(_input: unknown, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: ['p1'],
    });
    await request.db.query({
      text: 'update products set stock = stock - 1 where id = $1',
      values: ['p1'],
    });
    context.invalidate(cart);
    context.invalidate(product);
    return {};
  },
});

// Writes both domains but the touchGraph DECLARES ONLY cart — product is the
// silently-stale domain KV402 must catch.
const addPartial = mutation('multi-domain-write/add-partial', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: { tables: ['cart_items', 'products'], touches: [cart] },
  async handler(_input: unknown, request: KovoFixtureRequest, context) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: ['p2'],
    });
    await request.db.query({
      text: 'update products set stock = stock - 1 where id = $1',
      values: ['p1'],
    });
    context.invalidate(cart);
    return {};
  },
});

const home = route('/', {
  page: async (_context, request: KovoFixtureReaderRequest) => `<main>
    <kovo-fragment target="cart-count">${renderCart(await cartCountReader(request.db))}</kovo-fragment>
    <kovo-fragment target="product-stock">${renderStock(await productStockReader(request.db))}</kovo-fragment>
    <form method="post" action="/_m/multi-domain-write/add-both" enhance data-mutation="multi-domain-write/add-both" kovo-deps="cart product">
      <button type="submit">Add both</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [addBoth, addPartial],
  routes: [home],
  mutationResponses: {
    [addBoth.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          { render: async () => renderCart(await cartCountWriter(db)), target: 'cart-count' },
          {
            render: async () => renderStock(await productStockWriter(db)),
            target: 'product-stock',
          },
        ],
        redirectTo: '/',
      };
    },
    [addPartial.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          { render: async () => renderCart(await cartCountWriter(db)), target: 'cart-count' },
        ],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  routeReads: { '/': ['cart', 'product'] },
  schema: [
    'create table cart_items (id integer primary key generated always as identity, product_id text not null)',
    'create table products (id text primary key, stock integer not null)',
  ],
  seed: (db) => db.exec(staticSql`insert into products (id, stock) values ('p1', 5)`),
  touchGraph: {
    [addBoth.key]: {
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'multi-domain-write/app.tsx:117',
          source: 'cart_items',
          via: 'cart_items',
        },
        {
          domain: 'product',
          keys: null,
          site: 'multi-domain-write/app.tsx:120',
          source: 'products',
          via: 'products',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'multi-domain-write/app.tsx:31', via: 'cart_items' },
        { domain: 'product', keys: null, site: 'multi-domain-write/app.tsx:32', via: 'products' },
      ],
      unresolved: [],
    },
    [addPartial.key]: {
      // product is intentionally OMITTED — the runtime cross-check must catch it.
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'multi-domain-write/app.tsx:130',
          source: 'cart_items',
          via: 'cart_items',
        },
      ],
      touches: [
        { domain: 'cart', keys: null, site: 'multi-domain-write/app.tsx:45', via: 'cart_items' },
      ],
      unresolved: [],
    },
  },
  verification: {
    domainByTable: { cart_items: 'cart', products: 'product' },
  },
});
