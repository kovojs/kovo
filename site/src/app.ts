import { route } from '@kovojs/server';
import { createApp, createRequestHandler, type RouteDeclaration } from '@kovojs/server/app-shell/core';
import { toNodeHandler } from '@kovojs/server/app-shell/node';

import { clientHrefs } from './client/modules.js';
import { siteClientModules } from './client/modules.js';
import {
  renderDocsBody,
  renderSectionIndex,
  sectionIndexInput,
} from './components/docs-layout.js';
import { loadSiteContent, type DocPage, type DocSection, type NavLink } from './content.js';
import { siteDocumentTemplate } from './document-template.js';

// The Kovo docs site as a real Kovo app (SPEC §9.5): every page is a declared
// route whose page() composes idiomatic chrome components with route-boundary
// markdown HTML. createApp() owns the document shell, the versioned client-module
// registry, and static export. This mirrors examples/stackoverflow/src/app-shell.ts.

const siteStylesheets = ['/assets/site.css'] as const;

type AnyRoute = RouteDeclaration<string, undefined, undefined, unknown, unknown, unknown>;

/** Route paths are declared without a trailing slash (normalizePathname is
 * canonical/trailing-removed, SPEC §6.3); content URLs keep the trailing slash,
 * and static export writes each to `<path>/index.html`. */
function routePath(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

function link(page: DocPage | undefined): NavLink | undefined {
  return page ? { title: page.title, url: page.url } : undefined;
}

const content = await loadSiteContent();
const { groups, sections, spec } = content;

const routes: AnyRoute[] = [];

// Landing (placeholder until the chromeless landing is ported). It still renders
// through the real app shell so the document/loader contract holds.
routes.push(
  route('/', {
    meta: {
      description:
        'The web framework that hands your agent the fix — database to DOM, interactive at first paint, statically verifiable.',
      title: 'Kovo — the web framework that hands your agent the fix',
    },
    stylesheets: siteStylesheets,
    page() {
      return renderDocsBody({
        activePath: '/',
        clients: clientHrefs,
        contentHtml: renderSectionIndex({
          key: 'docs',
          pages: sections
            .filter((section) => section.pages.length > 0)
            .map((section) => ({
              description: `${section.pages.length} pages`,
              title: section.title,
              url: `/${section.key}/`,
            })),
          title: 'Kovo',
        }),
        groups,
        prose: false,
      });
    },
  }) as AnyRoute,
);

for (const section of sections) {
  routes.push(sectionIndexRoute(section));
  for (const [position, page] of section.pages.entries()) {
    routes.push(pageRoute(section, page, section.pages[position - 1], section.pages[position + 1]));
  }
}

// Gallery + Examples section indexes (the per-component / per-example pages are
// ported in their own slices). Placeholders keep the nav links resolvable.
for (const placeholder of [
  { intro: 'Rendered component fixtures.', key: 'gallery', title: 'Gallery' },
  { intro: 'Runnable example apps.', key: 'examples', title: 'Examples' },
]) {
  routes.push(
    route(`/${placeholder.key}`, {
      meta: { description: placeholder.intro, title: `${placeholder.title} · Kovo` },
      stylesheets: siteStylesheets,
      page() {
        return renderDocsBody({
          activePath: `/${placeholder.key}/`,
          clients: clientHrefs,
          contentHtml: renderSectionIndex({ key: placeholder.key, pages: [], title: placeholder.title }),
          groups,
          prose: false,
        });
      },
    }) as AnyRoute,
  );
}

// /spec — SPEC.md verbatim with number-derived § anchors.
routes.push(
  route('/spec', {
    meta: {
      description: 'Kovo — Product Requirements & Technical Specification (normative).',
      title: 'Specification · Kovo',
    },
    stylesheets: siteStylesheets,
    page() {
      const banner = `<p class="note-banner">This is the normative specification, rendered verbatim from <a href="https://github.com/kovojs/kovo/blob/main/SPEC.md" rel="external">SPEC.md</a> at build time. The docs explain; the spec decides.</p>`;
      return renderDocsBody({
        activePath: '/spec/',
        clients: clientHrefs,
        contentHtml: `${banner}<article class="prose">${spec.html}</article>`,
        groups,
        prose: false,
      });
    },
  }) as AnyRoute,
);

function sectionIndexRoute(section: DocSection): AnyRoute {
  return route(`/${section.key}`, {
    meta: {
      description: `${section.title} — Kovo documentation`,
      title: `${section.title} · Kovo`,
    },
    stylesheets: siteStylesheets,
    page() {
      return renderDocsBody({
        activePath: `/${section.key}/`,
        clients: clientHrefs,
        contentHtml: renderSectionIndex(sectionIndexInput(section)),
        groups,
        prose: false,
      });
    },
  }) as AnyRoute;
}

function pageRoute(
  section: DocSection,
  page: DocPage,
  prev: DocPage | undefined,
  next: DocPage | undefined,
): AnyRoute {
  return route(routePath(page.url), {
    meta: {
      description: page.description || `${page.title} — Kovo documentation`,
      title: `${page.title} · Kovo`,
    },
    stylesheets: siteStylesheets,
    page() {
      return renderDocsBody({
        activePath: page.url,
        clients: clientHrefs,
        contentHtml: page.html,
        eyebrow: section.title,
        groups,
        headings: page.headings,
        next: link(next),
        prev: link(prev),
      });
    },
  }) as AnyRoute;
}

export const siteStaticExportApp = createApp({
  clientModules: siteClientModules,
  document: { lang: 'en', template: siteDocumentTemplate },
  routes,
});

export const siteNodeHandler = toNodeHandler(createRequestHandler(siteStaticExportApp));

export default siteStaticExportApp;
