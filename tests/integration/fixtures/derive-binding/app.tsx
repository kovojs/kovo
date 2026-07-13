/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { InventoryPanel } from './inventory-panel';
import { inventoryDomain, inventoryQuery } from './shared';

export const sellOutInventory = mutation('derive-binding/sell-out', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: {
    queries: [inventoryQuery],
    tables: ['inventory_state'],
    touches: [inventoryDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      staticSql`update inventory_state set count = 0, label = 'Sold out' where id = 1`,
    );
    context.invalidate(inventoryDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      {trustedHtml('<script type="module" src="/client.ts"></script>')}
      <InventoryPanel />
    </main>
  ),
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
    db.exec(staticSql`insert into inventory_state (id, count, label) values (1, 3, 'Available')`),
});
