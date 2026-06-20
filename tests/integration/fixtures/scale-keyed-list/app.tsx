// SPEC §4.8 keyed stamps at volume (plans/bugs-and-testing.md P3 scale; testing-audit §5.6):
// a 300-row keyed list reconciled through a fragment patch must keep identity correct at
// scale — the right row removed, order preserved, no mis-keying or duplicate keys.
import { createApp, domain, mutation, query, route, s } from '@kovojs/server';
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
  return `<li kovo-key="${escapeAttribute(item.id)}" data-row="${escapeAttribute(item.id)}"><span data-bind=".qty">${item.qty}</span> <span data-bind=".name">${escapeHtml(item.name)}</span></li>`;
}

function renderList(cart: CartResult): string {
  return `<ul data-bind-list="cart.items" kovo-key="id" aria-label="Cart items">${cart.items.map(renderRow).join('')}<template kovo-stamp>${renderRow({ id: '', name: '', qty: 0 })}</template></ul>`;
}

async function renderCartList(db: KovoFixtureRequest['db']): Promise<string> {
  return `<cart-list kovo-fragment-target="cart-list" kovo-deps="cart">${renderList(await readCart(db))}</cart-list>`;
}

export const cartQuery = query('cart', {
  load: (_input: unknown, context?: { request: KovoFixtureRequest }) =>
    readCart(context?.request.db as KovoFixtureRequest['db']),
  reads: [cartDomain],
});

export const changeCart = mutation('scale-keyed-list/change', {
  csrf: false,
  input: s.object({}),
  registry: { queries: [cartQuery], touches: [cartDomain] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    // Remove a row in the middle and bump the first row's qty: identity must hold.
    await request.db.exec("delete from cart_item where id = 'r150'");
    await request.db.exec("update cart_item set qty = 999 where id = 'r0'");
    context.invalidate(cartDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const cart = await readCart(request.db);
    return `${renderQueryScript({ name: 'cart', value: cart })}
    <script type="module" src="/client.ts"></script>
    <main>
      ${await renderCartList(request.db)}
      <form method="post" action="/_m/scale-keyed-list/change" enhance data-mutation="scale-keyed-list/change" kovo-deps="cart">
        <button type="submit">Change</button>
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
  seed: (db) =>
    db.exec(
      "insert into cart_item (id, name, qty, position) select 'r' || g, 'Item ' || g, g, g from generate_series(0, 299) as g",
    ),
});
