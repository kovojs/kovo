import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';
import { publicAccess } from '@kovojs/server';

export const account = { key: 'slot_account' };

export interface BalanceResult {
  accountId: string;
  balance: number;
}

export async function readBalance(db: KovoFixtureRequest['db']): Promise<BalanceResult> {
  const rows = await db.query(
    'select account_id as "accountId", balance from slot_account where id = 1',
  );
  return rows[0] as unknown as BalanceResult;
}

export const balanceQuery = {
  access: publicAccess('integration fixture manual balance query has no runtime guard'),
  key: 'slotBalance',
  load: (_input: unknown, context: { request: KovoFixtureRequest }) =>
    readBalance(context.request.db),
  reads: [account],
};
