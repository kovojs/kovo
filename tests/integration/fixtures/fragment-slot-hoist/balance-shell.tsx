/** @jsxImportSource @kovojs/server */
// SPEC.md §4.5: fragment-target children lower to server-renderable slot functions.
import { component } from '@kovojs/core';
import { renderComponent } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/integration/define';

import { balanceQuery, readBalance, type BalanceResult } from './shared';

interface BalanceShellSlots {
  children?: unknown;
}

export const BalanceShell = component({
  queries: { slotBalance: balanceQuery },
  render: (
    { slotBalance }: { slotBalance: BalanceResult },
    _state,
    { children }: BalanceShellSlots,
  ) => (
    <section
      kovo-deps="slotBalance"
      kovo-fragment-target="balance-shell"
      data-account={slotBalance.accountId}
    >
      <h1>Account {slotBalance.accountId}</h1>
      <div data-slot="children">{children}</div>
    </section>
  ),
});

export function BalanceShell$slot_children(props: BalanceResult): string {
  return (
    <p data-hoisted-slot="balance">
      Hoisted slot for {props.accountId}: <output>{props.balance}</output>
    </p>
  ) as unknown as string;
}

export async function renderBalanceShell(db: KovoFixtureRequest['db']): Promise<string> {
  const slotBalance = await readBalance(db);
  return renderComponent(
    BalanceShell,
    { slotBalance },
    {
      slots: { children: BalanceShell$slot_children(slotBalance) },
    },
  );
}
