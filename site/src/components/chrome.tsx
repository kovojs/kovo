/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Code } from '@kovojs/icons/code';
import { Sun } from '@kovojs/icons/sun';
import * as style from '@kovojs/style';

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
  { url: '/components/', title: 'Components' },
  { url: '/examples/', title: 'Examples' },
  { url: '/reference/', title: 'Reference', match: ['/api', '/reference', '/spec'] },
];

// Context-dependent sidebar split (SPEC §4.5): a reader browsing the learning
// path (Getting Started + Tutorial + Guides) should not also see the whole
// Components/Examples/API/Reference tree, and vice versa. Group keys map to one
// of two families; the sidebar renders only the family of the active page.
const LEARN_FAMILY = new Set(['docs', 'tutorial', 'guides']);

function sidebarFamilyForPath(activePath: string): 'learn' | 'reference' {
  return ['/docs', '/tutorial', '/guides'].some(
    (prefix) => activePath === prefix || activePath.startsWith(`${prefix}/`),
  )
    ? 'learn'
    : 'reference';
}

/** The sidebar groups relevant to the page at `activePath`: the learning-path
 * sections together, or the Components/Examples/reference sections together. */
export function sidebarGroupsForPath(groups: NavGroup[], activePath: string): NavGroup[] {
  const family = sidebarFamilyForPath(activePath);
  const filtered = groups.filter(
    (group) => (LEARN_FAMILY.has(group.key) ? 'learn' : 'reference') === family,
  );
  return filtered.length > 0 ? filtered : groups;
}

const chromeStyles = style.create(
  {
    apiNav: {
      fontSize: '0.8rem',
      maxHeight: 'calc(100vh - 7rem)',
      overflowY: 'auto',
      position: 'sticky',
      scrollbarWidth: 'thin',
      top: '5.5rem',
    },
    apiNavCount: {
      color: 'var(--faint)',
      fontWeight: 400,
    },
    apiNavGroup: {
      margin: '0 0 0.5rem 1rem',
    },
    apiNavGroupSummary: {
      color: 'var(--dim)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.66rem',
      fontWeight: 600,
      letterSpacing: '0.12em',
      listStyle: 'none',
      padding: '0.3rem 0',
      textTransform: 'uppercase',
    },
    apiNavHead: {
      alignItems: 'baseline',
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '0.7rem',
    },
    apiNavHeadText: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      fontWeight: 600,
      letterSpacing: '0.2em',
      margin: 0,
      textTransform: 'uppercase',
    },
    apiNavItem: {
      alignItems: 'center',
      display: 'flex',
      justifyContent: 'space-between',
      marginLeft: -1,
    },
    apiNavLink: {
      borderLeftColor: 'transparent',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      color: 'var(--dim)',
      display: 'block',
      flex: 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.74rem',
      overflow: 'hidden',
      padding: '0.2rem 0 0.2rem 0.85rem',
      textDecoration: 'none',
      textOverflow: 'ellipsis',
      transition: 'color 0.15s, border-color 0.15s',
      whiteSpace: 'nowrap',
      ':hover': {
        borderColor: 'var(--faint)',
        color: 'var(--ink)',
      },
      '[data-active="true"]': {
        borderColor: 'var(--teal)',
        color: 'var(--teal)',
      },
    },
    apiNavList: {
      borderLeftColor: 'var(--edge)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      listStyle: 'none',
      margin: '0 0 0.6rem',
      padding: 0,
    },
    apiNavSource: {
      color: 'var(--edge)',
      display: 'inline-flex',
      flexShrink: 0,
      opacity: 1,
      padding: '0 0.3rem',
      transition: 'opacity 0.15s',
      ':hover': {
        color: 'var(--teal)',
      },
    },
    apiNavSourcePackage: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      letterSpacing: '0.1em',
      textDecoration: 'none',
      textTransform: 'uppercase',
      ':hover': {
        color: 'var(--teal)',
      },
    },
    apiNavSourcePackageInset: {
      display: 'inline-block',
      margin: '0.05rem 0 0.25rem 1rem',
    },
    apiNavSubpath: {
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      marginBottom: '0.65rem',
      paddingBottom: '0.55rem',
    },
    apiNavSubpathSummary: {
      alignItems: 'baseline',
      color: 'var(--ink)',
      cursor: 'pointer',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      fontWeight: 650,
      gap: '0.45rem',
      justifyContent: 'space-between',
      lineHeight: 1.35,
      listStyle: 'none',
      padding: '0.25rem 0',
    },
    apiNavSubpathTitle: {
      flex: 1,
      minWidth: 0,
      overflowWrap: 'anywhere',
    },
    apiSummaryArrow: {
      color: 'var(--faint)',
      flex: '0 0 auto',
      fontSize: '0.6rem',
    },
    docSidebar: {
      fontSize: '0.84rem',
      width: '15rem',
    },
    footer: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    footerInner: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1.5rem',
      justifyContent: 'space-between',
      margin: '0 auto',
      maxWidth: '80rem',
      padding: '1.4rem 1.5rem 2.2rem',
    },
    footerLink: {
      color: 'inherit',
      textDecoration: 'none',
      ':hover': {
        color: 'var(--ink)',
      },
    },
    footerLinks: {
      display: 'flex',
      gap: '1.5rem',
    },
    header: {
      backdropFilter: 'blur(8px)',
      background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      position: 'sticky',
      top: 0,
      zIndex: 20,
    },
    headerInner: {
      alignItems: 'center',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      gap: '2rem',
      margin: '0 auto',
      maxWidth: '80rem',
      padding: '0.8rem 1.5rem',
      '@media (max-width: 47.999rem)': {
        gap: '1rem',
        padding: '0.7rem 1rem',
      },
    },
    iconButton: {
      alignItems: 'center',
      background: 'none',
      border: 'none',
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      letterSpacing: '0.08em',
      padding: 0,
      textDecoration: 'none',
      textTransform: 'uppercase',
      transition: 'color 0.15s',
      ':hover': {
        color: 'var(--ink)',
      },
    },
    starButton: {
      alignItems: 'center',
      background: 'none',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--ink)',
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      gap: '0.4rem',
      letterSpacing: '0.06em',
      padding: '0.34rem 0.7rem',
      textDecoration: 'none',
      textTransform: 'uppercase',
      transition: 'border-color 0.15s, color 0.15s',
      ':hover': {
        borderColor: 'var(--accent)',
        color: 'var(--accent)',
      },
    },
    starGlyph: {
      color: 'var(--amber)',
      fontSize: '0.85rem',
      lineHeight: 1,
    },
    ghMark: {
      height: 15,
      width: 15,
    },
    themeIcon: {
      height: 18,
      width: 18,
    },
    sourceIcon: {
      height: 14,
      width: 14,
    },
    mark: {
      color: 'var(--teal)',
    },
    nav: {
      display: 'flex',
      gap: '1.4rem',
      '@media (max-width: 47.999rem)': {
        display: 'none',
      },
    },
    navLink: {
      color: 'var(--dim)',
      fontSize: '0.72rem',
      letterSpacing: '0.08em',
      textDecoration: 'none',
      textTransform: 'uppercase',
      ':hover': {
        color: 'var(--ink)',
      },
    },
    navLinkActive: {
      color: 'var(--teal)',
    },
    // Mobile header nav: a CSS-only <details> disclosure (L0, zero JS). The
    // desktop nav + GitHub link hide below 48rem; this hamburger drops a panel
    // with the full nav. The desktop search button collapses to an icon.
    mobileMenu: {
      display: 'none',
      position: 'relative',
      '@media (max-width: 47.999rem)': {
        display: 'block',
      },
    },
    mobileMenuSummary: {
      alignItems: 'center',
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'inline-flex',
      listStyle: 'none',
      transition: 'color 0.15s',
      '::-webkit-details-marker': {
        display: 'none',
      },
      ':hover': {
        color: 'var(--ink)',
      },
    },
    mobilePanel: {
      background: 'var(--bg)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 16px 40px -16px rgb(0 0 0 / 0.5)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: '11rem',
      padding: '0.5rem',
      position: 'absolute',
      right: 0,
      top: 'calc(100% + 0.7rem)',
      zIndex: 30,
    },
    mobilePanelLink: {
      color: 'var(--dim)',
      fontSize: '0.78rem',
      letterSpacing: '0.06em',
      padding: '0.55rem 0.7rem',
      textDecoration: 'none',
      textTransform: 'uppercase',
      ':hover': {
        background: 'var(--panel)',
        color: 'var(--ink)',
      },
    },
    searchIconButton: {
      alignItems: 'center',
      background: 'none',
      border: 'none',
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'none',
      padding: 0,
      transition: 'color 0.15s',
      ':hover': {
        color: 'var(--ink)',
      },
      '@media (max-width: 47.999rem)': {
        display: 'inline-flex',
      },
    },
    pagination: {
      display: 'flex',
      gap: '1rem',
      marginTop: '3.5rem',
    },
    paginationCard: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'block',
      flex: 1,
      padding: '0.9rem 1.1rem',
      textDecoration: 'none',
      transition: 'border-color 0.15s',
      ':hover': {
        borderColor: 'var(--teal)',
      },
    },
    paginationLabel: {
      color: 'var(--faint)',
      display: 'block',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      letterSpacing: '0.2em',
      textTransform: 'uppercase',
    },
    paginationNext: {
      textAlign: 'right',
    },
    paginationSpacer: {
      flex: 1,
    },
    paginationTitle: {
      color: 'var(--ink)',
      display: 'block',
      fontSize: '0.9rem',
      fontWeight: 550,
      marginTop: '0.35rem',
    },
    searchButton: {
      alignItems: 'center',
      background: 'none',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      gap: '0.7rem',
      letterSpacing: '0.1em',
      padding: '0.42rem 0.8rem',
      textTransform: 'uppercase',
      transition: 'border-color 0.15s, color 0.15s',
      ':hover': {
        borderColor: 'var(--faint)',
        color: 'var(--ink)',
      },
      '@media (max-width: 47.999rem)': {
        display: 'none',
      },
    },
    searchKey: {
      color: 'var(--faint)',
      fontFamily: 'inherit',
    },
    sideGroup: {
      marginBottom: '1.9rem',
    },
    sideGroupHeading: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      fontWeight: 600,
      letterSpacing: '0.2em',
      marginBottom: '0.7rem',
      textTransform: 'uppercase',
    },
    sideGroupLink: {
      borderLeftColor: 'transparent',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      color: 'var(--dim)',
      display: 'block',
      marginLeft: -1,
      padding: '0.22rem 0 0.22rem 0.85rem',
      textDecoration: 'none',
      transition: 'color 0.15s, border-color 0.15s',
      ':hover': {
        borderColor: 'var(--faint)',
        color: 'var(--ink)',
      },
    },
    sideGroupList: {
      borderLeftColor: 'var(--edge)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
    sideLinkActive: {
      borderColor: 'var(--teal)',
      color: 'var(--teal)',
    },
    siteLogo: {
      alignItems: 'center',
      color: 'var(--ink)',
      display: 'flex',
      fontWeight: 700,
      gap: '0.6rem',
      letterSpacing: '0.08em',
      textDecoration: 'none',
    },
    siteRight: {
      alignItems: 'center',
      display: 'flex',
      gap: '1.2rem',
      marginLeft: 'auto',
    },
    toc: {
      fontSize: '0.8rem',
      position: 'sticky',
      top: '5.5rem',
    },
    tocDepth3: {
      paddingLeft: '1.75rem',
    },
    tocHeading: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      fontWeight: 600,
      letterSpacing: '0.2em',
      marginBottom: '0.7rem',
      textTransform: 'uppercase',
    },
    tocLink: {
      color: 'var(--dim)',
      display: 'block',
      padding: '0.18rem 0 0.18rem 0.85rem',
      textDecoration: 'none',
      transition: 'color 0.15s',
      ':hover': {
        color: 'var(--ink)',
      },
    },
    tocList: {
      borderLeftColor: 'var(--edge)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      listStyle: 'none',
      margin: 0,
      padding: 0,
    },
  },
  { namespace: 'site-chrome', source: 'site/src/components/chrome.tsx' },
);

export interface SiteHeaderProps {
  activePath?: string;
  clients: ClientHrefs;
}

export const SiteHeader = component({
  render: ({ activePath = '', clients }: SiteHeaderProps) => (
    <header style={chromeStyles.header} data-site-bar>
      <div style={chromeStyles.headerInner}>
        <a href="/" style={chromeStyles.siteLogo}>
          <span style={chromeStyles.mark}>&#9670;</span> KOVO
        </a>
        <nav style={chromeStyles.nav}>
          {NAV.map((item) => {
            const prefixes = item.match ?? [item.url.replace(/\/$/, '') || item.url];
            const active = prefixes.some((prefix) => activePath.startsWith(prefix));
            return (
              <a
                href={item.url}
                style={[chromeStyles.navLink, active && chromeStyles.navLinkActive]}
              >
                {item.title}
              </a>
            );
          })}
        </nav>
        <div style={chromeStyles.siteRight}>
          <button
            type="button"
            style={chromeStyles.searchButton}
            on:click={`${clients.search}#open`}
          >
            <span>Search</span>
            <kbd style={chromeStyles.searchKey}>&#8984;K</kbd>
          </button>
          <button
            type="button"
            style={chromeStyles.searchIconButton}
            on:click={`${clients.search}#open`}
            aria-label="Search documentation"
          >
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
          <button
            type="button"
            style={chromeStyles.iconButton}
            on:click={`${clients.theme}#toggle`}
            aria-label="Toggle dark mode"
          >
            <Sun style={chromeStyles.themeIcon} />
          </button>
          <a
            style={chromeStyles.starButton}
            data-header-github
            href="https://github.com/kovojs/kovo"
            rel="external"
          >
            <svg
              viewBox="0 0 16 16"
              style={chromeStyles.ghMark}
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Star
          </a>
          <details style={chromeStyles.mobileMenu}>
            <summary style={chromeStyles.mobileMenuSummary} aria-label="Menu">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </summary>
            <nav style={chromeStyles.mobilePanel} aria-label="Site">
              {NAV.map((item) => {
                const prefixes = item.match ?? [item.url.replace(/\/$/, '') || item.url];
                const active = prefixes.some((prefix) => activePath.startsWith(prefix));
                return (
                  <a
                    href={item.url}
                    style={[chromeStyles.mobilePanelLink, active && chromeStyles.navLinkActive]}
                  >
                    {item.title}
                  </a>
                );
              })}
              <a
                style={chromeStyles.mobilePanelLink}
                href="https://github.com/kovojs/kovo"
                rel="external"
              >
                GitHub
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  ),
});

export const SiteFooter = component({
  render: () => (
    <footer style={chromeStyles.footer}>
      <div style={chromeStyles.footerInner}>
        <span>
          <span style={chromeStyles.mark}>&#9670;</span> Kovo &mdash; interactive at first paint
          &middot; legible at every layer &middot; statically verifiable
        </span>
        <span style={chromeStyles.footerLinks}>
          <a href="/spec/" style={chromeStyles.footerLink}>
            Spec
          </a>
          <a href="/llms.txt" style={chromeStyles.footerLink}>
            llms.txt
          </a>
          <a href="https://github.com/kovojs/kovo" rel="external" style={chromeStyles.footerLink}>
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
    <nav style={chromeStyles.docSidebar} aria-label="Documentation">
      {groups.map((group) => (
        <section style={chromeStyles.sideGroup}>
          <h2 style={chromeStyles.sideGroupHeading}>{group.title}</h2>
          <ul style={chromeStyles.sideGroupList}>
            {group.pages.map((page) => (
              <li>
                <a
                  href={page.url}
                  style={[
                    chromeStyles.sideGroupLink,
                    page.url === activePath && chromeStyles.sideLinkActive,
                  ]}
                >
                  {page.title}
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
  if (!page) return <span style={chromeStyles.paginationSpacer}></span>;
  return (
    <a
      href={page.url}
      style={[chromeStyles.paginationCard, direction === 'next' && chromeStyles.paginationNext]}
    >
      <span style={chromeStyles.paginationLabel}>{direction === 'next' ? 'Next' : 'Previous'}</span>
      <span style={chromeStyles.paginationTitle}>
        {direction === 'next' ? `${page.title} →` : `← ${page.title}`}
      </span>
    </a>
  );
}

export const PrevNext = component({
  render: ({ prev, next }: PrevNextProps) => (
    <nav style={chromeStyles.pagination} aria-label="Pagination">
      {prevNextCard(prev, 'prev')}
      {prevNextCard(next, 'next')}
    </nav>
  ),
});

export interface ApiSidebarProps {
  apiSidebar: ApiSidebarData;
}

/** Right-hand rail for generated API reference pages: symbols grouped into
 * collapsible subpath/category groups with counts, each linking to its anchor
 * plus its defining source line. Replaces the flat heading TOC, which is
 * unusable at 200+ symbols. */
export const ApiSidebar = component({
  render: ({ apiSidebar }: ApiSidebarProps) => (
    <nav style={chromeStyles.apiNav} aria-label="Symbols on this page" data-api-nav>
      <div style={chromeStyles.apiNavHead}>
        <p style={chromeStyles.apiNavHeadText}>On this page</p>
      </div>
      {apiSidebar.subpaths.map((subpath) => (
        <details style={chromeStyles.apiNavSubpath} open>
          <summary style={chromeStyles.apiNavSubpathSummary}>
            <span style={chromeStyles.apiSummaryArrow}>&#9656;</span>
            <span style={chromeStyles.apiNavSubpathTitle}>{subpath.importPath}</span>
            <span style={chromeStyles.apiNavCount}>
              {String(
                subpath.categories.reduce((count, category) => count + category.symbols.length, 0),
              )}
            </span>
          </summary>
          <a
            style={[chromeStyles.apiNavSourcePackage, chromeStyles.apiNavSourcePackageInset]}
            href={subpath.sourceHref}
            rel="external"
          >
            source
          </a>
          {subpath.categories.map((category) => (
            <details style={chromeStyles.apiNavGroup} open>
              <summary style={chromeStyles.apiNavGroupSummary}>
                <span style={chromeStyles.apiSummaryArrow}>&#9656;</span> {category.title}{' '}
                <span style={chromeStyles.apiNavCount}>{String(category.symbols.length)}</span>
              </summary>
              <ul style={chromeStyles.apiNavList}>
                {category.symbols.map((symbol) => (
                  <li style={chromeStyles.apiNavItem}>
                    <a href={`#${symbol.anchor}`} style={chromeStyles.apiNavLink}>
                      {symbol.name}
                    </a>
                    <a
                      style={chromeStyles.apiNavSource}
                      href={symbol.sourceHref}
                      rel="external"
                      aria-label={`Source for ${symbol.name}`}
                    >
                      <Code style={chromeStyles.sourceIcon} />
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
    <nav style={chromeStyles.toc} aria-label="On this page">
      <p style={chromeStyles.tocHeading}>On this page</p>
      <ul style={chromeStyles.tocList}>
        {entries.map((heading) => (
          <li>
            <a
              style={[chromeStyles.tocLink, heading.depth === 3 && chromeStyles.tocDepth3]}
              href={`#${heading.id}`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
