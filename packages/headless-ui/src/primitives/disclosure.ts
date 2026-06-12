export interface DisclosureTriggerState {
  open: boolean;
}

export interface DisclosureTriggerEvent extends Event {
  currentTarget: EventTarget & { dataset: Record<string, string | undefined> };
}

/**
 * @jisoPrimitiveHandler
 *
 * SPEC.md §4.6: chained primitive handlers run after author handlers and must
 * no-op when the author has already prevented the default action.
 */
export function disclosureTriggerClick(event: DisclosureTriggerEvent): void {
  if (event.defaultPrevented) return;

  const current = event.currentTarget.dataset.state;
  event.currentTarget.dataset.state = current === 'open' ? 'closed' : 'open';
}
