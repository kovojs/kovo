export function markLoad(event: Event): void {
  const target = event.target as Element | null;
  if (target) target.textContent = 'loaded';
}
