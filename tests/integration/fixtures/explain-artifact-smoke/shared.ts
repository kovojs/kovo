import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface CartResult {
  count: number;
}

export const cartDomain = domain('cart');

export const cartQuery = query('cart', {
  reads: [cartDomain],
  async load(_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>): Promise<CartResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('cart query requires request.db');
    const rows = await db.query<{ count: number }>(
      staticSql`select count(*)::int as count from cart_items`,
    );
    return { count: Number(rows[0]?.count ?? 0) };
  },
});
