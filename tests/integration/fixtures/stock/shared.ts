// Shared query + domain for the stock (error-union) fixture. Declares no Kovo
// components, so the compiler plugin leaves it untouched.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface StockResult {
  stock: number;
}

export const item = domain('item');

export async function readStock(db: KovoFixtureRequest['db']): Promise<StockResult> {
  const rows = await db.query<{ stock: number }>(staticSql`select stock from item where id = 1`);
  return { stock: Number(rows[0]?.stock ?? 0) };
}

export const itemQuery = query('item', {
  reads: [item],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>): Promise<StockResult> => {
    const db = context?.request?.db;
    if (!db) throw new Error('item query requires request.db');
    return readStock(db);
  },
});
