import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const receiptDomain = domain('receipt');

export const receiptQuery = query('receipt', {
  reads: [receiptDomain],
  load: async (
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<{ created: boolean }> => {
    const db = context?.request?.db;
    if (!db) throw new Error('receipt query requires request.db');
    const rows = await db.query<{ count: number }>(
      staticSql`select count(*) as count from receipts`,
    );
    return { created: Number(rows[0]?.count ?? 0) > 0 };
  },
});
