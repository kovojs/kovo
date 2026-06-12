import { component } from '../../dist/core/src/index.mjs';
import { jisoLoaderSource } from '../../dist/runtime/src/index.mjs';

/**
 * Site chrome: jiso components (runtime IR form, SPEC §4.1/§4.5 — layouts are
 * render-time function composition) plus the document assembly the D8 shell
 * will own once R2/R3 land; until then this is the site-local equivalent,
 * using the same inline-loader placement as tests/p10-perf.node.mjs.
 *
 * Design: the landing's terminal-ledger system, themed. Dark is the landing
 * palette; light is its paper counterpart (tokens in src/styles.css).
 * THEME_SCRIPT applies `.dark` before first paint from
 * localStorage('theme') ?? prefers-color-scheme; the header toggle is an
 * L1 island (/c/theme.js) that records an explicit choice.
 */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const NAV = [
  { href: '/docs/installation/', label: 'Docs' },
  { href: '/tutorial/', label: 'Tutorial' },
  { href: '/guides/', label: 'Guides' },
  { href: '/api/', label: 'API' },
  { href: '/spec/', label: 'Spec' },
];

const THEME_SCRIPT = `(()=>{try{const t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch{}})()`;

const SUN_ICON = `<svg class="dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m9.9 9.9 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m9.9-9.9 1.4-1.4"/>
</svg>`;

const MOON_ICON = `<svg class="hidden dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>
</svg>`;

export const SiteHeader = component('site-header', {
  state: () => ({}),
  render: (_, _state, { activePath = '' } = {}) =>
    `<header class="site-bar">
      <div class="site-bar-inner">
        <a href="/" class="site-logo"><span class="mark">&#9670;</span> JISO</a>
        <nav class="site-nav">
          ${NAV.map((item) => {
            const section = item.href.split('/')[1];
            const active = activePath.startsWith(section ? `/${section}` : item.href);
            return `<a href="${item.href}"${active ? ' class="active"' : ''}>${item.label}</a>`;
          }).join('')}
        </nav>
        <div class="site-right">
          <button type="button" class="search-btn" on:click="/c/search.js#open">
            <span>Search</span><kbd>&#8984;K</kbd>
          </button>
          <button type="button" class="icon-btn" on:click="/c/theme.js#toggle" aria-label="Toggle dark mode">
            ${SUN_ICON}${MOON_ICON}
          </button>
          <a class="icon-btn" href="https://github.com/jiso-sh/jiso" rel="external">GitHub</a>
        </div>
      </div>
    </header>`,
});

export const SiteFooter = component('site-footer', {
  state: () => ({}),
  render: () =>
    `<footer class="site-footer">
      <div class="site-footer-inner">
        <span><span class="mark">&#9670;</span> Jiso &mdash; interactive at first paint &middot; legible at every layer &middot; statically verifiable</span>
        <span class="links">
          <a href="/spec/">Spec</a>
          <a href="/llms.txt">llms.txt</a>
          <a href="https://github.com/jiso-sh/jiso" rel="external">GitHub</a>
        </span>
      </div>
    </footer>`,
});

export const DocsSidebar = component('docs-sidebar', {
  state: () => ({}),
  render: (_, _state, { groups = [], activePath = '' } = {}) =>
    `<nav class="doc-sidebar" aria-label="Documentation">
      ${groups
        .map(
          (group) =>
            `<section class="side-group">
              <h2>${escapeHtml(group.title)}</h2>
              <ul>
                ${group.pages
                  .map(
                    (page) =>
                      `<li><a href="${page.url}"${page.url === activePath ? ' class="active"' : ''}>${escapeHtml(page.title)}</a></li>`,
                  )
                  .join('')}
              </ul>
            </section>`,
        )
        .join('')}
    </nav>`,
});

export const PrevNext = component('docs-prev-next', {
  state: () => ({}),
  render: (_, _state, { prev, next } = {}) => {
    const card = (page, direction) =>
      page
        ? `<a href="${page.url}" class="pn-card ${direction}">
            <span class="pn-label">${direction === 'next' ? 'Next' : 'Previous'}</span>
            <span class="pn-title">${
              direction === 'next'
                ? `${escapeHtml(page.title)} &rarr;`
                : `&larr; ${escapeHtml(page.title)}`
            }</span>
          </a>`
        : '<span class="pn-spacer"></span>';
    return `<nav class="pn" aria-label="Pagination">
      ${card(prev, 'prev')}${card(next, 'next')}
    </nav>`;
  },
});

/** Right-hand "On this page" rail from the page's h2/h3 headings. */
function renderToc(headings = []) {
  const entries = headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  if (entries.length < 2) return '';
  return `<nav class="toc" aria-label="On this page">
    <p>On this page</p>
    <ul>
      ${entries
        .map(
          (heading) =>
            `<li><a class="toc-depth-${heading.depth}" href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`,
        )
        .join('')}
    </ul>
  </nav>`;
}

const SEARCH_DIALOG = `<dialog id="site-search" class="search-dialog" aria-label="Search documentation">
  <input
    type="search"
    class="search-input"
    placeholder="Search docs&hellip;"
    on:input="/c/search.js#query"
    fw-state="{}"
  />
  <ul class="search-results" id="site-search-results"></ul>
</dialog>`;

/**
 * Full document assembly (site-local stand-in for D8 R2). The inline loader
 * ships in <head> so delegated listeners exist before first paint (SPEC §4.4,
 * §16.1); islands (search, theme, copy) load on first interaction only. The
 * theme script also runs pre-paint so there is no light-mode flash.
 */
export function renderDocument({ body, chromeless = false, description, path, title }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <script>${THEME_SCRIPT}</script>
    <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/jetbrains-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/assets/site.css" />
    <script>${jisoLoaderSource}</script>
  </head>
  <body class="font-sans antialiased">
    ${chromeless ? '' : SiteHeader.definition.render({}, {}, { activePath: path })}
    ${body}
    ${chromeless ? '' : SiteFooter.definition.render({}, {})}
    ${SEARCH_DIALOG}
  </body>
</html>
`;
}

/** Docs layout: sidebar + article + on-this-page rail, composed at render
 * time (§4.5). The mobile sidebar is an L0 disclosure — zero JavaScript. */
export function renderDocsPage({ activePath, eyebrow, groups, headings, html, next, prev, prose = true }) {
  const sidebar = DocsSidebar.definition.render({}, {}, { activePath, groups });
  return `<div class="mx-auto flex max-w-[80rem] gap-12 px-4 py-12 sm:px-6">
    <aside class="hidden lg:block">${sidebar}</aside>
    <main class="min-w-0 flex-1">
      <details class="doc-mobile lg:hidden">
        <summary>Menu</summary>
        <div>${sidebar}</div>
      </details>
      ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
      ${prose ? `<article class="prose">${html}</article>` : html}
      ${prev || next ? PrevNext.definition.render({}, {}, { next, prev }) : ''}
    </main>
    <aside class="hidden w-56 shrink-0 xl:block">${renderToc(headings)}</aside>
  </div>`;
}

const SECTION_INTROS = {
  api: 'Generated reference for every public package — types, functions, and the contracts they keep.',
  docs: 'Install Jiso, absorb the mental model, and find your way around a project.',
  guides:
    'Task-focused deep dives into each part of the framework, from queries to deployment.',
  tutorial:
    'Build a real e-commerce app in eight chapters — catalog, cart, optimistic updates, streaming, and a behavior graph your CI can check.',
};

/** Section landing pages: a card grid in the ledger style. */
export function renderSectionIndex(section) {
  const numbered = section.key === 'tutorial';
  const cards = section.pages
    .map((page, index) => {
      const title = numbered ? page.title.replace(/^\d+\.\s*/, '') : page.title;
      return `<li>
        <a href="${page.url}" class="index-card${section.key === 'api' ? ' mono-title' : ''}">
          ${numbered ? `<span class="num">${String(index + 1).padStart(2, '0')}</span>` : ''}
          <h2>${escapeHtml(title)}</h2>
          ${page.description ? `<p>${escapeHtml(page.description)}</p>` : ''}
          <span class="read">Read &rarr;</span>
        </a>
      </li>`;
    })
    .join('');

  return `<div class="index-head">
      <h1>${escapeHtml(section.title)}</h1>
      ${SECTION_INTROS[section.key] ? `<p>${SECTION_INTROS[section.key]}</p>` : ''}
    </div>
    <ul class="index-grid">${cards}</ul>`;
}
