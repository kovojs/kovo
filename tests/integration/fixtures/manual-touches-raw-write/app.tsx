import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, domain, mutation, query, route, s } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import {
  defineFixture,
  type KovoFixtureReaderRequest,
  type KovoFixtureRequest,
} from '@kovojs/test/internal/integration/define';

const cart = domain('cart');

async function readCartCountFromReader(
  db: KovoFixtureReaderRequest['db'],
): Promise<{ count: number }> {
  const rows = await db.rawRead<{ count: number }>(
    staticSql`select count(*)::int as count from cart_items`,
    { reads: ['cart_items'] },
  );
  return { count: rows[0]?.count ?? 0 };
}

async function readCartCountFromWriter(db: KovoFixtureRequest['db']): Promise<{ count: number }> {
  const rows = await db.query<{ count: number }>(
    staticSql`select count(*)::int as count from cart_items`,
  );
  return { count: rows[0]?.count ?? 0 };
}

const cartQuery = query('cart', {
  async load(_input, context) {
    const request = context?.request as KovoFixtureReaderRequest;
    return readCartCountFromReader(request.db);
  },
  reads: [cart],
});

function renderCartCount(count: number): string {
  return `<output kovo-fragment-target="cart-count" kovo-deps="cart" data-bind="cart.count" data-testid="cart-count">${count}</output>`;
}

const addOpaqueCartItem = mutation('manual-touches-raw-write/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ productId: s.string() }),
  registry: {
    queries: [cartQuery],
    tables: ['cart_items'],
    touches: [cart],
  },
  async handler(input, request: KovoFixtureRequest) {
    await request.db.query({
      text: 'insert into cart_items (product_id) values ($1)',
      values: [input.productId],
    });
    return {};
  },
});

const home = route('/', {
  page: async (_context, request: KovoFixtureReaderRequest) => {
    const cartState = await readCartCountFromReader(request.db);
    return `${renderQueryScript({ name: 'cart', value: cartState })}
    <main>
      <kovo-fragment target="cart-count">${renderCartCount(cartState.count)}</kovo-fragment>
      <form method="post" action="/_m/manual-touches-raw-write/add" enhance data-mutation="manual-touches-raw-write/add" kovo-deps="cart">
        <input type="hidden" name="productId" value="p1">
        <button type="submit">Add opaque item</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [addOpaqueCartItem],
  queries: [cartQuery],
  routes: [home],
});

export default defineFixture({
  app,
  routeReads: { '/': ['cart'] },
  schema: 'create table cart_items (product_id text primary key)',
  touchGraph: {
    [addOpaqueCartItem.key]: {
      reads: [
        {
          domain: 'cart',
          keys: null,
          site: 'manual-touches-raw-write/app.tsx:73',
          source: 'cart_items',
          via: 'cart_items',
        },
      ],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'manual-touches-raw-write/app.tsx:31',
          via: 'cart_items',
        },
      ],
      unresolved: [
        {
          code: 'KV406',
          domain: 'cart',
          message: 'Statically un-analyzable write site; manual touches required.',
          site: 'manual-touches-raw-write/app.tsx:36',
        },
      ],
    },
  },
  verification: {
    domainByTable: {
      cart_items: 'cart',
    },
  },
});
