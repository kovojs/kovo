import { loadSiteContent, type DocPage, type DocSection } from './content.js';
import { buildExampleRoutePages } from './examples.js';
import { buildGalleryRoutePages } from './gallery.js';
import {
  sectionIndexInput,
  type DocsRoutePageData,
  type SectionIndexInput,
} from './route-data.js';
import { link, routePath } from './route-kit.js';

export interface SiteRoutePage {
  body: DocsRoutePageData;
  meta: { description: string; title: string };
  modulepreloads?: readonly string[];
  routePath: string;
  url: string;
}

export interface SiteRouteData {
  landing: {
    loaderGzipBytes: number;
    meta: { description: string; title: string };
  };
  pages: readonly SiteRoutePage[];
}

export interface SiteRouteDataDeps {
  clientModules: { put(input: { path: string; source: string; version: string }): string };
}

export async function buildSiteRouteData({
  clientModules,
}: SiteRouteDataDeps): Promise<SiteRouteData> {
  const content = await loadSiteContent();
  const { groups, loaderGzipBytes, sections, spec } = content;
  const pages: SiteRoutePage[] = [];

  for (const section of sections) {
    pages.push(
      section.key === 'reference'
        ? docsPage(
            '/reference/',
            {
              activePath: '/reference/',
              content: { kind: 'section-index', section: referenceHubIndex() },
              groups,
            },
            {
              description:
                'Reference — generated API docs, the diagnostics catalog, and the normative spec.',
              title: 'Reference · Kovo',
            },
          )
        : sectionIndexPage(section, groups),
    );

    for (const [position, page] of section.pages.entries()) {
      pages.push(
        markdownPage(section, page, section.pages[position - 1], section.pages[position + 1], groups),
      );
    }
  }

  for (const galleryPage of await buildGalleryRoutePages({ clientModules })) {
    pages.push(
      docsPage(
        galleryPage.url,
        { activePath: galleryPage.activePath, content: galleryPage.content, groups },
        galleryPage.meta,
        galleryPage.modulepreloads ? { modulepreloads: galleryPage.modulepreloads } : {},
      ),
    );
  }

  for (const examplePage of await buildExampleRoutePages()) {
    pages.push(
      docsPage(
        examplePage.url,
        { activePath: examplePage.activePath, content: examplePage.content, groups },
        examplePage.meta,
      ),
    );
  }

  const specBanner = `<p class="note-banner">This is the normative specification, rendered verbatim from <a href="https://github.com/kovojs/kovo/blob/main/SPEC.md" rel="external">SPEC.md</a> at build time. The docs explain; the spec decides.</p>`;
  pages.push(
    docsPage(
      '/spec/',
      {
        activePath: '/spec/',
        content: {
          html: `${specBanner}<article class="prose">${spec.html}</article>`,
          kind: 'html',
          prose: false,
        },
        groups,
      },
      {
        description: 'Kovo — Product Requirements & Technical Specification (normative).',
        title: 'Specification · Kovo',
      },
    ),
  );

  return {
    landing: {
      loaderGzipBytes,
      meta: {
        description:
          'The web framework that hands your agent the fix — database to DOM, interactive at first paint, statically verifiable.',
        title: 'Kovo — the web framework that hands your agent the fix',
      },
    },
    pages,
  };
}

function sectionIndexPage(section: DocSection, groups: DocsRoutePageData['groups']): SiteRoutePage {
  return docsPage(
    `/${section.key}/`,
    {
      activePath: `/${section.key}/`,
      content: { kind: 'section-index', section: sectionIndexInput(section) },
      groups,
    },
    {
      description: `${section.title} — Kovo documentation`,
      title: `${section.title} · Kovo`,
    },
  );
}

function markdownPage(
  section: DocSection,
  page: DocPage,
  prev: DocPage | undefined,
  next: DocPage | undefined,
  groups: DocsRoutePageData['groups'],
): SiteRoutePage {
  return docsPage(
    page.url,
    {
      activePath: page.url,
      ...(page.apiSidebar ? { apiSidebar: page.apiSidebar } : {}),
      content: { html: page.html, kind: 'html' },
      eyebrow: section.title,
      groups,
      headings: page.headings,
      next: link(next),
      prev: link(prev),
    },
    {
      description: page.description || `${page.title} — Kovo documentation`,
      title: `${page.title} · Kovo`,
    },
  );
}

function docsPage(
  url: string,
  body: DocsRoutePageData,
  meta: SiteRoutePage['meta'],
  extra: Pick<SiteRoutePage, 'modulepreloads'> = {},
): SiteRoutePage {
  return {
    body,
    meta,
    ...extra,
    routePath: routePath(url),
    url,
  };
}

function referenceHubIndex(): SectionIndexInput {
  return {
    key: 'reference',
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
        description:
          'The normative spec, rendered verbatim from SPEC.md. The docs explain; the spec decides.',
      },
    ],
    title: 'Reference',
  };
}
