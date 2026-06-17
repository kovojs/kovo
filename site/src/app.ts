import { route } from '@kovojs/server';
import { createApp, createRequestHandler } from '@kovojs/server/app-shell/core';
import { toNodeHandler } from '@kovojs/server/app-shell/node';

import { clientHrefs, siteClientModules } from './client/modules.js';
import { renderSectionIndex, sectionIndexInput } from './components/docs-layout.js';
import { renderLanding } from './components/landing.js';
import { loadSiteContent, type DocPage, type DocSection } from './content.js';
import { siteDocumentTemplate } from './document-template.js';
import { buildExampleRoutes } from './examples.js';
import { buildGalleryRoutes } from './gallery.js';
import { docRoute, link, siteStylesheets, type AnyRoute } from './route-kit.js';

// The Kovo docs site as a real Kovo app (SPEC §9.5): every page is a declared
// route whose page() composes idiomatic chrome components with route-boundary
// markdown HTML. createApp() owns the document shell, the versioned client-module
// registry, and static export. Mirrors examples/stackoverflow/src/app-shell.ts.

const content = await loadSiteContent();
const { groups, loaderGzipBytes, sections, spec } = content;

const routes: AnyRoute[] = [];

// Landing — chromeless: it owns its header/footer (the global search dialog and
// theme script still apply via the DocumentTemplate).
routes.push(
  route('/', {
    meta: {
      description:
        'The web framework that hands your agent the fix — database to DOM, interactive at first paint, statically verifiable.',
      title: 'Kovo — the web framework that hands your agent the fix',
    },
    stylesheets: siteStylesheets,
    page() {
      return renderLanding({ clients: clientHrefs, loaderGzipBytes });
    },
  }) as AnyRoute,
);

// Content sections: a section index plus a page per markdown document. The
// `reference` section's index is replaced by the unified Reference hub (it links
// out to the API reference, this diagnostics catalog, and the spec).
for (const section of sections) {
  routes.push(section.key === 'reference' ? referenceHubRoute() : sectionIndexRoute(section));
  for (const [position, page] of section.pages.entries()) {
    routes.push(pageRoute(section, page, section.pages[position - 1], section.pages[position + 1]));
  }
}

// Gallery + Examples own their routes (and gallery registers its interactive
// client modules into the same registry createApp serves).
routes.push(...(await buildGalleryRoutes({ clientModules: siteClientModules, groups })));
routes.push(...(await buildExampleRoutes({ groups })));

// /spec — SPEC.md verbatim with number-derived § anchors.
const specBanner = `<p class="note-banner">This is the normative specification, rendered verbatim from <a href="https://github.com/kovojs/kovo/blob/main/SPEC.md" rel="external">SPEC.md</a> at build time. The docs explain; the spec decides.</p>`;
routes.push(
  docRoute(
    '/spec/',
    {
      description: 'Kovo — Product Requirements & Technical Specification (normative).',
      title: 'Specification · Kovo',
    },
    {
      activePath: '/spec/',
      contentHtml: `${specBanner}<article class="prose">${spec.html}</article>`,
      groups,
      prose: false,
    },
  ),
);

function sectionIndexRoute(section: DocSection): AnyRoute {
  return docRoute(
    `/${section.key}/`,
    {
      description: `${section.title} — Kovo documentation`,
      title: `${section.title} · Kovo`,
    },
    {
      activePath: `/${section.key}/`,
      contentHtml: renderSectionIndex(sectionIndexInput(section)),
      groups,
      prose: false,
    },
  );
}

function pageRoute(
  section: DocSection,
  page: DocPage,
  prev: DocPage | undefined,
  next: DocPage | undefined,
): AnyRoute {
  return docRoute(
    page.url,
    {
      description: page.description || `${page.title} — Kovo documentation`,
      title: `${page.title} · Kovo`,
    },
    {
      activePath: page.url,
      ...(page.apiSidebar ? { apiSidebar: page.apiSidebar } : {}),
      contentHtml: page.html,
      eyebrow: section.title,
      groups,
      headings: page.headings,
      next: link(next),
      prev: link(prev),
    },
  );
}

// The unified Reference landing hub at /reference/: a card grid linking to the
// API reference, the diagnostics catalog, and the normative spec. Their URLs
// (/api/, /reference/diagnostics/, /spec/) are unchanged; this only replaces the
// /reference/ index that previously listed just the diagnostics catalog.
function referenceHubRoute(): AnyRoute {
  return docRoute(
    '/reference/',
    {
      description: 'Reference — generated API docs, the diagnostics catalog, and the normative spec.',
      title: 'Reference · Kovo',
    },
    {
      activePath: '/reference/',
      contentHtml: renderSectionIndex({
        key: 'reference',
        title: 'Reference',
        pages: [
          {
            title: 'API Reference',
            url: '/api/',
            description: 'Generated reference for every public package — types, functions, and contracts.',
          },
          {
            title: 'Diagnostics',
            url: '/reference/diagnostics/',
            description: 'Every framework diagnostic (KV###) and its fix, kept in sync with the registry.',
          },
          {
            title: 'Specification',
            url: '/spec/',
            description: 'The normative spec, rendered verbatim from SPEC.md. The docs explain; the spec decides.',
          },
        ],
      }),
      groups,
      prose: false,
    },
  );
}

export const siteStaticExportApp = createApp({
  clientModules: siteClientModules,
  document: { lang: 'en', template: siteDocumentTemplate },
  routes,
});

export const siteNodeHandler = toNodeHandler(createRequestHandler(siteStaticExportApp));

export default siteStaticExportApp;
