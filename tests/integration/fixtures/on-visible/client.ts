export function markVisible(event: Event): void {
  const target = event.target as Element | null;
  if (target) target.textContent = 'visible-ran';
}
