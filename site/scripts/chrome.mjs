import { component } from '../../dist/core/src/index.mjs';
import { jisoLoaderSource } from '../../dist/runtime/src/index.mjs';

/**
 * Site chrome: jiso components (runtime IR form, SPEC §4.1/§4.5 — layouts are
 * render-time function composition) plus the document assembly the D8 shell
 * will own once R2/R3 land; until then this is the site-local equivalent,
 * using the same inline-loader placement as tests/p10-perf.node.mjs.
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

export const SiteHeader = component('site-header', {
  state: () => ({}),
  render: (_, _state, { activePath = '' } = {}) =>
    `<header class="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <a href="/" class="flex items-center gap-2 text-lg font-bold tracking-tight text-jiso-ink">
          <span class="text-jiso-accent" aria-hidden="true">&#9670;</span>jiso
        </a>
        <nav class="flex items-center gap-4 text-sm font-medium text-slate-600">
          ${NAV.map(
            (item) =>
              `<a href="${item.href}" class="${
                activePath.startsWith(
                  item.href.split('/')[1] ? `/${item.href.split('/')[1]}` : item.href,
                )
                  ? 'text-jiso-accent-dark'
                  : 'hover:text-jiso-ink'
              } hidden sm:inline">${item.label}</a>`,
          ).join('')}
        </nav>
        <div class="ml-auto flex items-center gap-3">
          <button
            type="button"
            on:click="/c/search.js#open"
            class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-300"
          >
            <span>Search</span>
            <kbd class="rounded border border-slate-300 bg-white px-1.5 font-mono text-[0.7rem] text-slate-500">&#8984;K</kbd>
          </button>
          <a
            href="https://github.com/jiso-sh/jiso"
            class="text-sm font-medium text-slate-600 hover:text-jiso-ink"
            rel="external"
          >GitHub</a>
        </div>
      </div>
    </header>`,
});

export const SiteFooter = component('site-footer', {
  state: () => ({}),
  render: () =>
    `<footer class="border-t border-slate-200 py-10 text-sm text-slate-500">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <p>Jiso &mdash; interactive at first paint, legible at every layer, statically verifiable.</p>
        <p class="flex gap-4">
          <a class="hover:text-jiso-ink" href="/spec/">Specification</a>
          <a class="hover:text-jiso-ink" href="/llms.txt">llms.txt</a>
          <a class="hover:text-jiso-ink" href="https://github.com/jiso-sh/jiso" rel="external">GitHub</a>
        </p>
      </div>
    </footer>`,
});

export const DocsSidebar = component('docs-sidebar', {
  state: () => ({}),
  render: (_, _state, { groups = [], activePath = '' } = {}) =>
    `<nav class="w-60 shrink-0 text-sm" aria-label="Documentation">
      ${groups
        .map(
          (group) =>
            `<section class="mb-6">
              <h2 class="mb-2 font-semibold tracking-wide text-jiso-ink">${escapeHtml(group.title)}</h2>
              <ul class="space-y-1 border-l border-slate-200">
                ${group.pages
                  .map(
                    (page) =>
                      `<li><a href="${page.url}" class="${
                        page.url === activePath
                          ? 'border-l-2 border-jiso-accent pl-3 font-medium text-jiso-accent-dark'
                          : 'border-l-2 border-transparent pl-3 text-slate-600 hover:border-slate-300 hover:text-jiso-ink'
                      } block py-0.5">${escapeHtml(page.title)}</a></li>`,
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
  render: (_, _state, { prev, next } = {}) =>
    `<nav class="mt-12 flex justify-between gap-4 border-t border-slate-200 pt-6 text-sm" aria-label="Pagination">
      <span>${
        prev
          ? `<a href="${prev.url}" class="text-jiso-accent-dark hover:underline">&larr; ${escapeHtml(prev.title)}</a>`
          : ''
      }</span>
      <span>${
        next
          ? `<a href="${next.url}" class="text-jiso-accent-dark hover:underline">${escapeHtml(next.title)} &rarr;</a>`
          : ''
      }</span>
    </nav>`,
});

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
 * §16.1); the search island is the only handler module and loads on first
 * interaction only.
 */
export function renderDocument({ body, description, path, title }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="stylesheet" href="/assets/site.css" />
    <script>${jisoLoaderSource}</script>
  </head>
  <body class="bg-white font-sans text-jiso-ink antialiased">
    ${SiteHeader.definition.render({}, {}, { activePath: path })}
    ${body}
    ${SiteFooter.definition.render({}, {})}
    ${SEARCH_DIALOG}
  </body>
</html>
`;
}

/** Docs layout: sidebar + article + prev/next, composed at render time (§4.5). */
export function renderDocsPage({ activePath, groups, html, next, prev }) {
  return `<div class="mx-auto flex max-w-7xl gap-10 px-4 py-10 sm:px-6">
    <aside class="hidden lg:block">${DocsSidebar.definition.render({}, {}, { activePath, groups })}</aside>
    <main class="min-w-0 flex-1">
      <article class="prose">${html}</article>
      ${PrevNext.definition.render({}, {}, { next, prev })}
    </main>
  </div>`;
}
