export function markIdle(event: Event): void {
  const target = event.target as Element | null;
  if (target) target.textContent = 'idle-ran';
}
