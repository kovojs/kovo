/** @jsxImportSource @kovojs/server */
import { escapeHtml } from '@kovojs/server/internal/html';

import { SECTION_INTROS } from '../content.js';
import type { DocsRouteContent, DocsRoutePageData, SectionIndexInput } from '../route-data.js';
import {
  ApiSidebar,
  DocsSidebar,
  PrevNext,
  SiteFooter,
  SiteHeader,
  renderToc,
  type ClientHrefs,
} from './chrome.js';
import { ExampleSplit } from './example-split.js';
import { GalleryPage } from './gallery.js';

// The docs page shell is split across a persistent layout segment and a route
// page segment (SPEC §8). The stable header/footer live in DocsRouteLayoutShell;
// route-dependent sidebar/article/rail content stays in DocsRoutePage. Markdown
// prose arrives as a pre-rendered HTML string and is spliced in as a verbatim
// child (the server JSX runtime inserts child strings as written).

export type { DocsRouteContent, DocsRoutePageData, SectionIndexInput };

/** TSX route page for docs-chrome pages. Markdown/API prose remains the single
 * route-boundary HTML input; all surrounding route composition is authored TSX. */
export function DocsRouteLayoutShell({
  children,
  clients,
}: {
  children?: unknown;
  clients: ClientHrefs;
}): string {
  return (
    <div data-docs-route-layout>
      {SiteHeader.definition.render({ clients })}
      {children}
      {SiteFooter.definition.render()}
    </div>
  );
}

export function DocsRoutePage({ page }: { page: DocsRoutePageData }): string {
  const {
    activePath,
    apiSidebar,
    content,
    eyebrow,
    groups,
    headings = [],
    next,
    prev,
  } = page;
  const sidebar = DocsSidebar.definition.render({ activePath, groups });
  const toc = apiSidebar ? ApiSidebar.definition.render({ apiSidebar }) : renderToc(headings);

  return (
    <div data-docs-route-page>
      <div class="docs-shell">
        <aside class="docs-sidebar-rail">{sidebar}</aside>
        <main class="docs-main">
          <details class="doc-mobile">
            <summary>Menu</summary>
            <div>{sidebar}</div>
          </details>
          {eyebrow ? <p class="eyebrow">{escapeHtml(eyebrow)}</p> : ''}
          <DocsRouteContentView content={content} />
          {prev || next ? PrevNext.definition.render({ prev, next }) : ''}
        </main>
        <aside class="docs-toc-rail">{toc}</aside>
      </div>
    </div>
  );
}

function DocsRouteContentView({ content }: { content: DocsRouteContent }): string {
  if (content.kind === 'html') {
    return content.prose === false ? content.html : <article class="prose">{content.html}</article>;
  }
  if (content.kind === 'gallery') return <GalleryPage input={content.gallery} />;
  if (content.kind === 'example') return <ExampleSplit input={content.example} />;
  return <SectionIndex section={content.section} />;
}

/** Section landing pages: a card grid in the ledger style. */
export function SectionIndex({ section }: { section: SectionIndexInput }): string {
  const numbered = section.key === 'tutorial';
  return (
    <div data-section-index>
      <div class="index-head">
        <h1>{escapeHtml(section.title)}</h1>
        {SECTION_INTROS[section.key] ? <p>{escapeHtml(SECTION_INTROS[section.key]!)}</p> : ''}
      </div>
      <ul class="index-grid">
        {section.pages.map((page, index) => {
          const title = numbered ? page.title.replace(/^\d+\.\s*/, '') : page.title;
          return (
            <li>
              <a href={page.url} class={`index-card${section.key === 'api' ? ' mono-title' : ''}`}>
                {numbered ? <span class="num">{String(index + 1).padStart(2, '0')}</span> : ''}
                <h2>{escapeHtml(title)}</h2>
                {page.description ? <p>{escapeHtml(page.description)}</p> : ''}
                <span class="read">Read &rarr;</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
