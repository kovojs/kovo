import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const inventoryDomain = domain('inventory');

export interface InventoryResult {
  [key: string]: unknown;
  count: number;
  label: string;
}

export async function readInventory(db: KovoFixtureRequest['db']): Promise<InventoryResult> {
  const rows = await db.query<InventoryResult>(
    staticSql`select count, label from inventory_state where id = 1`,
  );
  return rows[0] ?? { count: 0, label: 'Sold out' };
}

export const inventoryQuery = query('inventory', {
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('inventory query requires request.db');
    return readInventory(db);
  },
  reads: [inventoryDomain],
});
