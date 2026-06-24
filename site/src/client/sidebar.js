/**
 * Desktop docs-sidebar position sync (SPEC §4.7 on:load). This is intentionally
 * eager because the current nav item should be visible at first paint.
 */

const SIDEBAR_SELECTOR = '[data-docs-sidebar="desktop"]';
const CURRENT_SELECTOR = '[data-current-section="true"],[data-current-page="true"]';

let installed = false;

function currentSidebarItem(nav) {
  return nav.querySelector(CURRENT_SELECTOR);
}

function normalizePath(path) {
  return path.replace(/\/+$/, '') || '/';
}

function updateCurrentSidebar(nav) {
  const currentPath = normalizePath(location.pathname);
  for (const link of nav.querySelectorAll('a[href]')) {
    const linkPath = normalizePath(new URL(link.getAttribute('href'), location.href).pathname);
    const current = linkPath === currentPath;
    if (current) {
      link.setAttribute('data-current-page', 'true');
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('data-current-page');
      link.removeAttribute('aria-current');
    }
  }

  for (const details of nav.querySelectorAll('details')) {
    const current = details.querySelector('[data-current-page="true"]') !== null;
    const summary = details.querySelector('summary');
    if (current) summary?.setAttribute('data-current-section', 'true');
    else summary?.removeAttribute('data-current-section');
    const arrow = summary?.querySelector('[aria-hidden="true"]');
    if (current) arrow?.setAttribute('data-current-section', 'true');
    else arrow?.removeAttribute('data-current-section');
  }
}

function syncNow(target) {
  const nav = target?.matches?.(SIDEBAR_SELECTOR)
    ? target
    : document.querySelector(SIDEBAR_SELECTOR);
  if (!nav || nav.clientHeight === 0) return;

  updateCurrentSidebar(nav);
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
