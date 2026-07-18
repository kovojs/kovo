/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { sellOutInventory } from './app';
import { inventoryQuery, type InventoryResult } from './shared';

const sellOutForm = form<'derive-binding/sell-out', Record<string, never>>(
  'derive-binding/sell-out',
);

// SPEC §9.1: the compiler-generated live target owns the sell-out response;
// the named derive remains a lazy browser-only binding update.
export const InventoryPanel = component({
  mutations: { sellOut: sellOutForm },
  queries: { inventory: inventoryQuery },
  render: ({ inventory }: { inventory: InventoryResult }) => (
    <inventory-panel id="inventory-panel">
      <p>
        <span>{inventory.label}</span>: <span>{inventory.count}</span>
      </p>
      <button type="button" data-bind:disabled="/derive.ts#Inventory$disableWhenUnavailable">
        Ship order
      </button>
      <form mutation={sellOutInventory} enhance>
        <button type="submit">Sell out</button>
      </form>
    </inventory-panel>
  ),
});
