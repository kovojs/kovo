export function openMenu(event: Event): void {
  event.preventDefault();
  const trigger = document.getElementById('menu-trigger');
  const menu = document.getElementById('account-menu');
  trigger?.setAttribute('aria-expanded', 'true');
  menu?.removeAttribute('hidden');
  menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}
