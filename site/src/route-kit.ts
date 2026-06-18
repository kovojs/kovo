import type { DocPage, NavLink } from './content.js';

// Shared route data helpers. Route declarations are emitted as literal TSX in
// src/generated/app.routes.tsx so @kovojs/compiler can derive route/page
// navigation metadata (SPEC §4.5).

export const siteStylesheets = ['/assets/site.css'] as const;

/** Route paths drop the trailing slash (normalizePathname is canonical, SPEC
 * §6.3); content URLs keep it and static export writes `<path>/index.html`. */
export function routePath(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

export function link(page: DocPage | undefined): NavLink | undefined {
  return page ? { title: page.title, url: page.url } : undefined;
}
