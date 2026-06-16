/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { escapeHtml } from '@kovojs/server';

import type { Heading, NavGroup, NavLink } from '../content.js';

// Site chrome as idiomatic Kovo components (SPEC §4.1) composed at render time
// (SPEC §4.5 — layouts are render-time function composition, not a nested-layout
// primitive). The header/footer/sidebar/toc are rendered per route so the active
// path is exact; the document shell (loader, theme script, search dialog) is
// owned by the DocumentTemplate. on:click islands resolve to versioned client
// modules registered in src/client/modules.ts.

export interface ClientHrefs {
  code: string;
  search: string;
  theme: string;
}

const NAV: NavLink[] = [
  { url: '/docs/why-kovo/', title: 'Docs' },
  { url: '/tutorial/', title: 'Tutorial' },
  { url: '/guides/', title: 'Guides' },
  { url: '/gallery/', title: 'Gallery' },
  { url: '/examples/', title: 'Examples' },
  { url: '/api/', title: 'API' },
  { url: '/reference/', title: 'Reference' },
  { url: '/spec/', title: 'Spec' },
];

const SUN_ICON = `<svg class="dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m9.9 9.9 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m9.9-9.9 1.4-1.4"/></svg>`;
const MOON_ICON = `<svg class="hidden dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`;

export interface SiteHeaderProps {
  activePath?: string;
  clients: ClientHrefs;
}

export const SiteHeader = component('site-header', {
  render: ({ activePath = '', clients }: SiteHeaderProps) => (
    <header class="site-bar">
      <div class="site-bar-inner">
        <a href="/" class="site-logo">
          <span class="mark">&#9670;</span> KOVO
        </a>
        <nav class="site-nav">
          {NAV.map((item) => {
            const section = item.url.split('/')[1];
            const active = activePath.startsWith(section ? `/${section}` : item.url);
            return (
              <a href={item.url} class={active ? 'active' : undefined}>
                {escapeHtml(item.title)}
              </a>
            );
          })}
        </nav>
        <div class="site-right">
          <button type="button" class="search-btn" on:click={`${clients.search}#open`}>
            <span>Search</span>
            <kbd>&#8984;K</kbd>
          </button>
          <button
            type="button"
            class="icon-btn"
            on:click={`${clients.theme}#toggle`}
            aria-label="Toggle dark mode"
          >
            {SUN_ICON}
            {MOON_ICON}
          </button>
          <a class="icon-btn" href="https://github.com/kovojs/kovo" rel="external">
            GitHub
          </a>
        </div>
      </div>
    </header>
  ),
});

export const SiteFooter = component('site-footer', {
  render: () => (
    <footer class="site-footer">
      <div class="site-footer-inner">
        <span>
          <span class="mark">&#9670;</span> Kovo &mdash; interactive at first paint &middot; legible
          at every layer &middot; statically verifiable
        </span>
        <span class="links">
          <a href="/spec/">Spec</a>
          <a href="/llms.txt">llms.txt</a>
          <a href="https://github.com/kovojs/kovo" rel="external">
            GitHub
          </a>
        </span>
      </div>
    </footer>
  ),
});

export interface DocsSidebarProps {
  activePath?: string;
  groups: NavGroup[];
}

export const DocsSidebar = component('docs-sidebar', {
  render: ({ activePath = '', groups }: DocsSidebarProps) => (
    <nav class="doc-sidebar" aria-label="Documentation">
      {groups.map((group) => (
        <section class="side-group">
          <h2>{escapeHtml(group.title)}</h2>
          <ul>
            {group.pages.map((page) => (
              <li>
                <a href={page.url} class={page.url === activePath ? 'active' : undefined}>
                  {escapeHtml(page.title)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  ),
});

export interface PrevNextProps {
  next?: NavLink | undefined;
  prev?: NavLink | undefined;
}

function prevNextCard(page: NavLink | undefined, direction: 'prev' | 'next') {
  if (!page) return <span class="pn-spacer"></span>;
  return (
    <a href={page.url} class={`pn-card ${direction}`}>
      <span class="pn-label">{direction === 'next' ? 'Next' : 'Previous'}</span>
      <span class="pn-title">
        {direction === 'next'
          ? `${escapeHtml(page.title)} &rarr;`
          : `&larr; ${escapeHtml(page.title)}`}
      </span>
    </a>
  );
}

export const PrevNext = component('docs-prev-next', {
  render: ({ prev, next }: PrevNextProps) => (
    <nav class="pn" aria-label="Pagination">
      {prevNextCard(prev, 'prev')}
      {prevNextCard(next, 'next')}
    </nav>
  ),
});

/** Right-hand "On this page" rail from the page's h2/h3 headings. Returns an
 * empty string for short pages so the layout can drop the rail. */
export function renderToc(headings: Heading[] = []): string {
  const entries = headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  if (entries.length < 2) return '';
  return (
    <nav class="toc" aria-label="On this page">
      <p>On this page</p>
      <ul>
        {entries.map((heading) => (
          <li>
            <a class={`toc-depth-${heading.depth}`} href={`#${heading.id}`}>
              {escapeHtml(heading.text)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
