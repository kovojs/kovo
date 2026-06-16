export function toggleState(event: Event): void {
  event.preventDefault();

  const button =
    event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('button') : null;
  if (!(button instanceof HTMLElement)) return;

  const active = button.getAttribute('data-state') !== 'on';
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('data-state', active ? 'on' : 'off');
}
