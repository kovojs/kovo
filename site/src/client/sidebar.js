/**
 * Desktop docs-sidebar position sync (SPEC §4.7 on:load). This is intentionally
 * eager because the current nav item should be visible at first paint.
 */

const SIDEBAR_SELECTOR = '[data-docs-sidebar="desktop"]';
const CURRENT_SELECTOR = '[data-current-section="true"],[data-current-page="true"]';

function currentSidebarItem(nav) {
  return nav.querySelector(CURRENT_SELECTOR);
}

export function sync(event) {
  const nav = event?.target?.matches?.(SIDEBAR_SELECTOR)
    ? event.target
    : document.querySelector(SIDEBAR_SELECTOR);
  if (!nav || nav.clientHeight === 0) return;

  requestAnimationFrame(() => {
    const current = currentSidebarItem(nav);
    if (!current) return;

    const navRect = nav.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    if (currentRect.top >= navRect.top && currentRect.bottom <= navRect.bottom) return;

    const currentTop = currentRect.top - navRect.top + nav.scrollTop;
    nav.scrollTop = Math.max(0, currentTop - nav.clientHeight * 0.35);
  });
}
