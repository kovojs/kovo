import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/integration/define';

export interface BalanceResult {
  balance: number;
}

export const account = domain('account');

export async function readBalance(db: KovoFixtureRequest['db']): Promise<BalanceResult> {
  const rows = await db.query<{ balance: number }>('select balance from account where id = 1');
  return { balance: Number(rows[0]?.balance ?? 0) };
}

export const balanceQuery = query('balance', {
  reads: [account],
  load: (
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<BalanceResult> => {
    const db = context?.request?.db;
    if (!db) throw new Error('balance query requires request.db');
    return readBalance(db);
  },
});
