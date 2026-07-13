import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface CartItem {
  [key: string]: unknown;
  id: string;
  name: string;
  qty: number;
}

export interface CartResult {
  items: CartItem[];
}

export const cartDomain = domain('cart');

export async function readCart(db: KovoFixtureRequest['db']): Promise<CartResult> {
  const items = await db.query<CartItem>(
    staticSql`select id, name, qty from cart_item order by position asc`,
  );
  return { items };
}

export const cartQuery = query('cart', {
  reads: [cartDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('cart query requires request.db');
    return readCart(db);
  },
});
