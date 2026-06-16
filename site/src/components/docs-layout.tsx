/** @jsxImportSource @kovojs/server */
import { escapeHtml } from '@kovojs/server';

import type { DocSection, Heading, NavGroup, NavLink } from '../content.js';
import { SECTION_INTROS } from '../content.js';
import {
  DocsSidebar,
  PrevNext,
  SiteFooter,
  SiteHeader,
  renderToc,
  type ClientHrefs,
} from './chrome.js';

// The docs page shell: header + sidebar + article + on-this-page rail + footer,
// composed at render time (SPEC §4.5). The mobile sidebar is an L0 disclosure —
// zero JavaScript. Markdown prose arrives as a pre-rendered HTML string and is
// spliced in as a verbatim child (the server JSX runtime inserts child strings
// as written), keeping prose at the route boundary while chrome stays TSX.

export interface PageOptions {
  activePath: string;
  clients: ClientHrefs;
  contentHtml: string;
  eyebrow?: string | undefined;
  groups: NavGroup[];
  headings?: Heading[] | undefined;
  next?: NavLink | undefined;
  prev?: NavLink | undefined;
  prose?: boolean;
}

/** Render a full docs page body (everything inside <body> except the document
 * shell's search dialog, which the DocumentTemplate owns). */
export function renderDocsBody(options: PageOptions): string {
  const {
    activePath,
    clients,
    contentHtml,
    eyebrow,
    groups,
    headings = [],
    next,
    prev,
    prose = true,
  } = options;
  const sidebar = DocsSidebar.definition.render({ activePath, groups });
  const toc = renderToc(headings);

  return (
    <>
      {SiteHeader.definition.render({ activePath, clients })}
      <div class="mx-auto flex max-w-[80rem] gap-12 px-4 py-12 sm:px-6">
        <aside class="hidden lg:block">{sidebar}</aside>
        <main class="min-w-0 flex-1">
          <details class="doc-mobile lg:hidden">
            <summary>Menu</summary>
            <div>{sidebar}</div>
          </details>
          {eyebrow ? <p class="eyebrow">{escapeHtml(eyebrow)}</p> : ''}
          {prose ? <article class="prose">{contentHtml}</article> : contentHtml}
          {prev || next ? PrevNext.definition.render({ prev, next }) : ''}
        </main>
        <aside class="hidden w-56 shrink-0 xl:block">{toc}</aside>
      </div>
      {SiteFooter.definition.render()}
    </>
  );
}

export interface SectionIndexInput {
  key: string;
  pages: { description?: string; title: string; url: string }[];
  title: string;
}

/** Section landing pages: a card grid in the ledger style. */
export function renderSectionIndex(section: SectionIndexInput): string {
  const numbered = section.key === 'tutorial';
  return (
    <>
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
    </>
  );
}

/** Convenience: the section-index input for a content DocSection. */
export function sectionIndexInput(section: DocSection): SectionIndexInput {
  return {
    key: section.key,
    pages: section.pages.map((page) => ({
      description: page.description,
      title: page.title,
      url: page.url,
    })),
    title: section.title,
  };
}
