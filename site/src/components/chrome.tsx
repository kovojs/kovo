/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { escapeHtml } from '@kovojs/server/internal/html';

import type { ApiSidebar as ApiSidebarData, Heading, NavGroup, NavLink } from '../content.js';

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

interface NavItem extends NavLink {
  /** Extra path prefixes that should also mark this nav item active. Used so the
   * unified "Reference" entry highlights for the API reference, diagnostics
   * catalog, and the spec (their URLs stay /api/, /reference/, /spec/). */
  match?: string[];
}

// API reference, diagnostics catalog, and the spec are unified under one
// "Reference" nav entry (a /reference/ landing hub links to all three); their
// URLs are unchanged.
const NAV: NavItem[] = [
  { url: '/docs/why-kovo/', title: 'Docs' },
  { url: '/tutorial/', title: 'Tutorial' },
  { url: '/guides/', title: 'Guides' },
  { url: '/gallery/', title: 'Gallery' },
  { url: '/examples/', title: 'Examples' },
  { url: '/reference/', title: 'Reference', match: ['/api', '/reference', '/spec'] },
];

const SUN_ICON = `<svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m9.9 9.9 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m9.9-9.9 1.4-1.4"/></svg>`;
const MOON_ICON = `<svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`;

export interface SiteHeaderProps {
  activePath?: string;
  clients: ClientHrefs;
}

export const SiteHeader = component({
  render: ({ activePath = '', clients }: SiteHeaderProps) => (
    <header class="site-bar">
      <div class="site-bar-inner">
        <a href="/" class="site-logo">
          <span class="mark">&#9670;</span> KOVO
        </a>
        <nav class="site-nav">
          {NAV.map((item) => {
            const prefixes = item.match ?? [item.url.replace(/\/$/, '') || item.url];
            const active = prefixes.some((prefix) => activePath.startsWith(prefix));
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

export const SiteFooter = component({
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

export const DocsSidebar = component({
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

export const PrevNext = component({
  render: ({ prev, next }: PrevNextProps) => (
    <nav class="pn" aria-label="Pagination">
      {prevNextCard(prev, 'prev')}
      {prevNextCard(next, 'next')}
    </nav>
  ),
});

// Source-link glyph for a symbol row (links to the defining file + line).
const SOURCE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

export interface ApiSidebarProps {
  apiSidebar: ApiSidebarData;
}

/** Right-hand rail for generated API reference pages: symbols grouped into
 * collapsible subpath/category groups with counts, each linking to its anchor
 * plus its defining source line. Replaces the flat heading TOC, which is
 * unusable at 200+ symbols. */
export const ApiSidebar = component({
  render: ({ apiSidebar }: ApiSidebarProps) => (
    <nav class="api-nav" aria-label="Symbols on this page">
      <div class="api-nav-head">
        <p>On this page</p>
      </div>
      {apiSidebar.subpaths.map((subpath) => (
        <details class="api-nav-subpath" open>
          <summary>
            <span>{escapeHtml(subpath.importPath)}</span>
            <span class="api-nav-count">
              {String(
                subpath.categories.reduce((count, category) => count + category.symbols.length, 0),
              )}
            </span>
          </summary>
          <a class="api-nav-src-pkg" href={subpath.sourceHref} rel="external">
            source
          </a>
          {subpath.categories.map((category) => (
            <details class="api-nav-group" open>
              <summary>
                {escapeHtml(category.title)}{' '}
                <span class="api-nav-count">{String(category.symbols.length)}</span>
              </summary>
              <ul>
                {category.symbols.map((symbol) => (
                  <li>
                    <a href={`#${symbol.anchor}`}>{escapeHtml(symbol.name)}</a>
                    <a
                      class="api-nav-src"
                      href={symbol.sourceHref}
                      rel="external"
                      aria-label={`Source for ${escapeHtml(symbol.name)}`}
                    >
                      {SOURCE_ICON}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </details>
      ))}
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
