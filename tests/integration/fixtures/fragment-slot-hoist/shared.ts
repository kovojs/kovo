import type { KovoFixtureRequest } from '@kovojs/test/integration/define';

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
  key: 'slotBalance',
  load: (_input: unknown, context: { request: KovoFixtureRequest }) =>
    readBalance(context.request.db),
  reads: [account],
};
