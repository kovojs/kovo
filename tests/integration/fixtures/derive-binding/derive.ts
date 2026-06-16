interface InventoryResult {
  count?: number;
}

export function Inventory$disableWhenUnavailable(value: unknown): true | null {
  const inventory = value as InventoryResult | undefined;
  return (inventory?.count ?? 0) <= 0 ? true : null;
}

export function applyInventoryDerives(value: unknown, root: Document): void {
  const disabled = Inventory$disableWhenUnavailable(value);
  for (const element of root.querySelectorAll(
    '[data-bind\\:disabled="/derive.ts#Inventory\\$disableWhenUnavailable"]',
  )) {
    if (disabled) {
      element.setAttribute('disabled', '');
    } else {
      element.removeAttribute('disabled');
    }
  }
}
