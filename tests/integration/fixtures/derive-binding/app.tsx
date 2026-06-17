import { createApp, domain, mutation, query, renderQueryScript, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

const inventoryDomain = domain('inventory');

interface InventoryResult {
  [key: string]: unknown;
  count: number;
  label: string;
}

async function readInventory(db: KovoFixtureRequest['db']): Promise<InventoryResult> {
  const rows = await db.query('select count, label from inventory_state where id = 1');
  return rows[0] as unknown as InventoryResult;
}

export const inventoryQuery = query('inventory', {
  load: (_input: unknown, context?: { request: KovoFixtureRequest }) =>
    readInventory(context?.request.db as KovoFixtureRequest['db']),
  reads: [inventoryDomain],
});

export const sellOutInventory = mutation('derive-binding/sell-out', {
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [inventoryQuery],
    touches: [inventoryDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec("update inventory_state set count = 0, label = 'Sold out' where id = 1");
    context.invalidate(inventoryDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const inventory = await readInventory(request.db);
    return `${renderQueryScript({ name: 'inventory', value: inventory })}
    <script type="module" src="/client.ts"></script>
    <main>
      <inventory-panel id="inventory-panel" kovo-deps="inventory">
        <p><span data-bind="inventory.label">${inventory.label}</span>: <span data-bind="inventory.count">${inventory.count}</span></p>
        <button type="button" data-bind:disabled="/derive.ts#Inventory$disableWhenUnavailable">Ship order</button>
      </inventory-panel>
      <form method="post" action="/_m/derive-binding/sell-out" enhance data-mutation="derive-binding/sell-out" kovo-deps="inventory">
        <button type="submit">Sell out</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [sellOutInventory],
  queries: [inventoryQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table inventory_state (id integer primary key, count integer not null, label text not null)',
  seed: (db) =>
    db.exec("insert into inventory_state (id, count, label) values (1, 3, 'Available')"),
});
