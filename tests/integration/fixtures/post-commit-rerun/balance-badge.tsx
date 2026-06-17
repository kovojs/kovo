/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { balanceQuery, type BalanceResult } from './shared';

export const BalanceBadge = component({
  queries: { balance: balanceQuery },
  render: ({ balance }: { balance: BalanceResult }) => (
    <balance-badge kovo-fragment-target="balance-badge">
      <span>Balance:</span> <output>{balance.balance}</output>
    </balance-badge>
  ),
});
