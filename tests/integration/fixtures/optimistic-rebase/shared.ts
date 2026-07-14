import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface CartSummary extends Record<string, unknown> {
  count: number;
}

export const cartDomain = domain('optimistic_cart');

export async function readCart(db: KovoFixtureRequest['db']): Promise<CartSummary> {
  const rows = await db.query<CartSummary>(
    staticSql`select count from optimistic_cart where id = 1`,
  );
  return rows[0] ?? { count: 0 };
}

export const cartQuery = query('cart', {
  reads: [cartDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('optimistic rebase cart query requires request.db');
    return readCart(db);
  },
});
