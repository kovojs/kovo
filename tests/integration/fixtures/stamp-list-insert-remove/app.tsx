import { createApp, domain, mutation, publicAccess, query, route, s } from '@kovojs/server';
import { escapeAttribute, escapeHtml, renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const cartDomain = domain('cart');

interface CartItem {
  [key: string]: unknown;
  id: string;
  name: string;
  qty: number;
}

interface CartResult {
  items: CartItem[];
}

async function readCart(db: KovoFixtureRequest['db']): Promise<CartResult> {
  const items = (await db.query(
    'select id, name, qty from cart_item order by position asc',
  )) as unknown as CartItem[];
  return { items };
}

function renderRow(item: CartItem): string {
  return `<li kovo-key="${escapeAttribute(item.id)}" data-row="${escapeAttribute(item.id)}">
    <span data-bind=".qty">${item.qty}</span>
    <span data-bind=".name">${escapeHtml(item.name)}</span>
  </li>`;
}

function renderList(cart: CartResult): string {
  return `<ul data-bind-list="cart.items" kovo-key="id" aria-label="Cart items">
    ${cart.items.map(renderRow).join('')}
    <template kovo-stamp>${renderRow({ id: '', name: '', qty: 0 })}</template>
  </ul>`;
}

async function renderCartList(db: KovoFixtureRequest['db']): Promise<string> {
  const cart = await readCart(db);
  return `<cart-list kovo-fragment-target="cart-list" kovo-deps="cart">${renderList(cart)}</cart-list>`;
}

export const cartQuery = query('cart', {
  access: publicAccess('integration fixture query cart has no runtime guard'),
  load: (_input: unknown, context?: { request: KovoFixtureRequest }) =>
    readCart(context?.request.db as KovoFixtureRequest['db']),
  reads: [cartDomain],
});

export const changeCart = mutation('stamp-list-insert-remove/change', {
  access: publicAccess('integration fixture mutation stamp-list-insert-remove/change has no runtime guard'),
  csrf: false,
  input: s.object({ mode: s.string() }),
  registry: {
    queries: [cartQuery],
    touches: [cartDomain],
  },
  handler: async (input: { mode: string }, request: KovoFixtureRequest, context) => {
    if (input.mode === 'insert') {
      await request.db.exec(
        "insert into cart_item (id, name, qty, position) values ('c', 'Cable', 1, 3)",
      );
    }
    if (input.mode === 'remove') {
      await request.db.exec("delete from cart_item where id = 'b'");
    }
    context.invalidate(cartDomain);
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const cart = await readCart(request.db);
    return `${renderQueryScript({ name: 'cart', value: cart })}
    <script type="module" src="/client.ts"></script>
    <main>
      ${await renderCartList(request.db)}
      <form method="post" action="/_m/stamp-list-insert-remove/change" enhance data-mutation="stamp-list-insert-remove/change" kovo-deps="cart">
        <input type="hidden" name="mode" value="insert" />
        <button type="submit">Insert item</button>
      </form>
      <form method="post" action="/_m/stamp-list-insert-remove/change" enhance data-mutation="stamp-list-insert-remove/change" kovo-deps="cart">
        <input type="hidden" name="mode" value="remove" />
        <button type="submit">Remove item</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [changeCart],
  queries: [cartQuery],
  routes: [homeRoute],
  mutationResponses: {
    [changeCart.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [{ render: () => renderCartList(db), target: 'cart-list' }],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table cart_item (id text primary key, name text not null, qty integer not null, position integer not null)',
  seed: async (db) => {
    await db.exec("insert into cart_item (id, name, qty, position) values ('a', 'Adapter', 2, 1)");
    await db.exec("insert into cart_item (id, name, qty, position) values ('b', 'Battery', 4, 2)");
  },
});
