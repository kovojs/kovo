import { route, type RouteDeclaration } from '@kovojs/server';

import { clientHrefs } from './client/modules.js';
import { renderDocsBody, type PageOptions } from './components/docs-layout.js';
import type { DocPage, NavLink } from './content.js';

// Shared route helpers so each section module (docs, gallery, examples, spec)
// declares routes the same way. The app shell owns head/loader/meta; a route's
// page() returns the composed body.

export type AnyRoute = RouteDeclaration<string, undefined, undefined, unknown, unknown, unknown>;

export const siteStylesheets = ['/assets/site.css'] as const;

/** Route paths drop the trailing slash (normalizePathname is canonical, SPEC
 * §6.3); content URLs keep it and static export writes `<path>/index.html`. */
export function routePath(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

export function link(page: DocPage | undefined): NavLink | undefined {
  return page ? { title: page.title, url: page.url } : undefined;
}

/** Declare a docs-chrome page route from a URL, meta, and composed body. */
export function docRoute(
  url: string,
  meta: { description: string; title: string },
  body: Omit<PageOptions, 'clients'>,
  extra: { modulepreloads?: readonly string[] } = {},
): AnyRoute {
  return route(routePath(url), {
    meta,
    ...(extra.modulepreloads ? { modulepreloads: extra.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return renderDocsBody({ ...body, clients: clientHrefs });
    },
  }) as AnyRoute;
}
