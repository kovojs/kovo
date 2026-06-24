import { createApp, domain, mutation, publicAccess, query, route, s } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const cart = domain('cart');

async function readCartCount(db: KovoFixtureRequest['db']): Promise<{ count: number }> {
  const rows = await db.query<{ count: number }>('select count(*)::int as count from cart_items');
  return { count: rows[0]?.count ?? 0 };
}

const cartQuery = query('cart', {
  access: publicAccess('integration fixture query cart has no runtime guard'),
  async load(_input, context) {
    const request = context?.request as KovoFixtureRequest;
    return readCartCount(request.db);
  },
  reads: [cart],
});

function renderCartCount(count: number): string {
  return `<output kovo-fragment-target="cart-count" kovo-deps="cart" data-bind="cart.count" data-testid="cart-count">${count}</output>`;
}

const addOpaqueCartItem = mutation('manual-touches-raw-write/add', {
  access: publicAccess('integration fixture mutation manual-touches-raw-write/add has no runtime guard'),
  csrf: false,
  input: s.object({ productId: s.string() }),
  registry: {
    queries: [cartQuery],
    touches: [cart],
  },
  async handler(input, request: KovoFixtureRequest) {
    await request.db.query('insert into cart_items (product_id) values ($1)', [input.productId]);
    return {};
  },
});

const home = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const cartState = await readCartCount(request.db);
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
  mutationResponses: {
    [addOpaqueCartItem.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          {
            render: async () => renderCartCount((await readCartCount(db)).count),
            target: 'cart-count',
          },
        ],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table cart_items (product_id text primary key)',
  touchGraph: {
    [addOpaqueCartItem.key]: {
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
