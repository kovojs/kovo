const seenItems = new Set<string>();
let callCount = 0;

export function record(_event: Event, context: { params: { itemId?: string } }): void {
  callCount += 1;
  const itemId = context.params.itemId ?? 'missing';
  seenItems.add(itemId);

  const output = document.querySelector('[data-log]');
  if (!output) return;
  output.textContent = JSON.stringify({
    callCount,
    itemId,
    seen: [...seenItems].sort(),
  });
}
