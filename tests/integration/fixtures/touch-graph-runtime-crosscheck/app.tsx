import { createApp, domain, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const cart = domain('cart');

async function cartCount(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ count: number }>('select count(*)::int as count from cart_items');
  return rows[0]?.count ?? 0;
}

function renderCartCount(count: number): string {
  return `<p kovo-fragment-target="cart-count" kovo-deps="cart" data-testid="cart-count">${count}</p>`;
}

const addCartItem = mutation('touch-graph-runtime-crosscheck/add', {
  csrf: false,
  input: s.object({ productId: s.string() }),
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query('insert into cart_items (product_id) values ($1)', [input.productId]);
    context.invalidate(cart);
    return {};
  },
});

const smuggleAuditWrite = mutation('touch-graph-runtime-crosscheck/smuggle', {
  csrf: false,
  input: s.object({ productId: s.string() }),
  async handler(input, request: KovoFixtureRequest, context) {
    await request.db.query('insert into audit_log (product_id) values ($1)', [input.productId]);
    context.invalidate(cart);
    return {};
  },
});

const home = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `
    <main>
      <kovo-fragment target="cart-count">${renderCartCount(await cartCount(request.db))}</kovo-fragment>
      <form method="post" action="/_m/touch-graph-runtime-crosscheck/add" enhance data-mutation="touch-graph-runtime-crosscheck/add" kovo-deps="cart">
        <input type="hidden" name="productId" value="p1">
        <button type="submit">Add item</button>
      </form>
    </main>
  `,
});

const app = createApp({
  mutations: [addCartItem, smuggleAuditWrite],
  routes: [home],
  mutationResponse: ({ key, request }) => {
    if (key !== addCartItem.key && key !== smuggleAuditWrite.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [
        { render: async () => renderCartCount(await cartCount(db)), target: 'cart-count' },
      ],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: [
    'create table cart_items (product_id text primary key)',
    'create table audit_log (product_id text not null)',
  ],
  touchGraph: {
    [addCartItem.key]: {
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'touch-graph-runtime-crosscheck/app.tsx:16',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    },
    [smuggleAuditWrite.key]: {
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'touch-graph-runtime-crosscheck/app.tsx:25',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    },
  },
  verification: {
    domainByTable: {
      audit_log: 'audit',
      cart_items: 'cart',
    },
  },
});
