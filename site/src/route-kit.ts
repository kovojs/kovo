import { stylesheet } from '@kovojs/server';

import type { DocPage, NavLink } from './content.js';
import { siteThemeCss } from './theme.js';

// Shared route data helpers used by the authored docs app shell and content builders.

export const siteStylesheets = [
  stylesheet('./styles.css', {
    href: '/assets/site.css',
    theme: siteThemeCss,
  }),
] as const;

export const siteUiStylesheets = [
  stylesheet('./generated/kovo-ui.css', {
    href: '/assets/kovo-ui.css',
  }),
] as const;

export function siteStylesheetsForRoute(path: string): readonly (typeof siteStylesheets)[number][] {
  return path === '/components' || path.startsWith('/components/')
    ? [...siteStylesheets, ...siteUiStylesheets]
    : siteStylesheets;
}

/** Route paths drop the trailing slash (normalizePathname is canonical, SPEC
 * §6.3); content URLs keep it and static export writes `<path>/index.html`. */
export function routePath(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

export function link(page: DocPage | undefined): NavLink | undefined {
  return page ? { title: page.title, url: page.url } : undefined;
}
