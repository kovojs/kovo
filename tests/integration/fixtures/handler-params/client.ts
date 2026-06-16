export function recordParams(
  _event: Event,
  context: { params: { enabled?: boolean; itemId?: string; quantity?: number } },
): void {
  const result = document.querySelector('[data-result]');
  if (!result) return;
  result.textContent = JSON.stringify({
    enabled: context.params.enabled,
    itemId: context.params.itemId,
    quantity: context.params.quantity,
    quantityType: typeof context.params.quantity,
  });
}
