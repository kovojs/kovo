/** @jsxImportSource @kovojs/server */
// SPEC.md §4.5: fragment-target children lower to server-renderable slot functions.
import { component } from '@kovojs/core';

import { balanceQuery, type BalanceResult } from './shared';

export const BalanceShell = component({
  queries: { slotBalance: balanceQuery },
  render: ({ slotBalance }: { slotBalance: BalanceResult }) => (
    <section data-account={slotBalance.accountId}>
      <h1>Account {slotBalance.accountId}</h1>
      <div data-slot="children">
        <p data-hoisted-slot="balance">
          Hoisted slot for {slotBalance.accountId}: <output>{slotBalance.balance}</output>
        </p>
      </div>
    </section>
  ),
});
