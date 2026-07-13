import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type {
  KovoFixtureReaderRequest,
  KovoFixtureRequest,
} from '@kovojs/test/internal/integration/define';

export interface CartCountResult {
  count: number;
}

type FixtureQueryRequest = KovoFixtureReaderRequest | KovoFixtureRequest;

export const cart = domain('cart');

async function readCartCount(request: FixtureQueryRequest): Promise<CartCountResult> {
  const db = request.db;
  if ('rawRead' in db) {
    const rows = await db.rawRead<{ count: number }>(
      staticSql`select count(*)::int as count from cart_items`,
      { reads: ['cart_items'] },
    );
    return { count: Number(rows[0]?.count ?? 0) };
  }
  const rows = await db.query<{ count: number }>(
    staticSql`select count(*)::int as count from cart_items`,
  );
  return { count: Number(rows[0]?.count ?? 0) };
}

export const cartQuery = query('cart', {
  reads: [cart],
  load: (_input: unknown, context?: QueryLoadContext<FixtureQueryRequest>) => {
    const request = context?.request;
    if (!request) throw new Error('cart query requires request');
    return readCartCount(request);
  },
});
