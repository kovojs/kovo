/**
 * Desktop docs-sidebar scroll positioning (SPEC §4.7 on:load). Current state is
 * server-rendered and updated through framework-owned navigation morphing.
 */

const SIDEBAR_SELECTOR = '[data-docs-sidebar="desktop"]';
const CURRENT_SELECTOR = '[data-current-section="true"],[data-current-page="true"]';

let installed = false;

function currentSidebarItem(nav) {
  return nav.querySelector(CURRENT_SELECTOR);
}

function syncNow(target) {
  const nav = target?.matches?.(SIDEBAR_SELECTOR)
    ? target
    : document.querySelector(SIDEBAR_SELECTOR);
  if (!nav || nav.clientHeight === 0) return;

  const current = currentSidebarItem(nav);
  if (!current) return;

  const navRect = nav.getBoundingClientRect();
  const currentRect = current.getBoundingClientRect();
  if (currentRect.top >= navRect.top && currentRect.bottom <= navRect.bottom) return;

  const currentTop = currentRect.top - navRect.top + nav.scrollTop;
  nav.scrollTop = Math.max(0, currentTop - nav.clientHeight * 0.35);
}

function installNavigationSync() {
  if (installed) return;
  installed = true;
  addEventListener('kovo:navigate', () => syncNow());
}

export function sync(event) {
  installNavigationSync();
  syncNow(event?.target);
}
