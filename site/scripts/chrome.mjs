import { component } from '../../dist/core/src/index.mjs';
import { jisoLoaderSource } from '../../dist/runtime/src/index.mjs';

/**
 * Site chrome: jiso components (runtime IR form, SPEC §4.1/§4.5 — layouts are
 * render-time function composition) plus the document assembly the D8 shell
 * will own once R2/R3 land; until then this is the site-local equivalent,
 * using the same inline-loader placement as tests/p10-perf.node.mjs.
 *
 * Theming: class-based dark mode. THEME_SCRIPT applies `.dark` before first
 * paint from localStorage('theme') ?? prefers-color-scheme; the header toggle
 * is an L1 island (/c/theme.js) that records an explicit choice.
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

const LOGO_MARK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="jiso-mark" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2dd4bf"/><stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <path d="M12 1.8 22.2 12 12 22.2 1.8 12Z" fill="url(#jiso-mark)"/>
  <path d="M12 6.8 17.2 12 12 17.2 6.8 12Z" fill="white" fill-opacity="0.9" class="dark:fill-slate-950"/>
</svg>`;

const SUN_ICON = `<svg class="size-5 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m9.9 9.9 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m9.9-9.9 1.4-1.4"/>
</svg>`;

const MOON_ICON = `<svg class="hidden size-5 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>
</svg>`;

const GITHUB_ICON = `<svg class="size-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
</svg>`;

const SEARCH_ICON = `<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
</svg>`;

export const SiteHeader = component('site-header', {
  state: () => ({}),
  render: (_, _state, { activePath = '' } = {}) =>
    `<header class="sticky top-0 z-20 border-b border-slate-900/10 bg-white/80 backdrop-blur-md dark:border-slate-50/10 dark:bg-slate-950/80">
      <div class="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
        <a href="/" class="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white">
          ${LOGO_MARK}<span>jiso</span>
        </a>
        <nav class="flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          ${NAV.map((item) => {
            const section = item.href.split('/')[1];
            const active = activePath.startsWith(section ? `/${section}` : item.href);
            return `<a href="${item.href}" class="${
              active
                ? 'text-jiso-600 dark:text-jiso-400'
                : 'hover:text-slate-900 dark:hover:text-white'
            } hidden sm:inline">${item.label}</a>`;
          }).join('')}
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            on:click="/c/search.js#open"
            class="flex items-center gap-2.5 rounded-full border border-slate-200 bg-slate-50 py-1.5 pr-2 pl-3.5 text-sm text-slate-500 transition hover:border-slate-300 sm:w-56 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700"
          >
            ${SEARCH_ICON}
            <span class="hidden sm:inline">Search docs&hellip;</span>
            <kbd class="ml-auto hidden rounded-md border border-slate-200 bg-white px-1.5 font-mono text-[0.7rem] text-slate-500 sm:inline dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">&#8984;K</kbd>
          </button>
          <button
            type="button"
            on:click="/c/theme.js#toggle"
            aria-label="Toggle dark mode"
            class="grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >${SUN_ICON}${MOON_ICON}</button>
          <a
            href="https://github.com/jiso-sh/jiso"
            aria-label="Jiso on GitHub"
            class="grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            rel="external"
          >${GITHUB_ICON}</a>
        </div>
      </div>
    </header>`,
});

export const SiteFooter = component('site-footer', {
  state: () => ({}),
  render: () =>
    `<footer class="border-t border-slate-900/10 py-12 text-sm text-slate-500 dark:border-slate-50/10 dark:text-slate-400">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <p class="flex items-center gap-2.5">${LOGO_MARK}<span>Interactive at first paint &middot; legible at every layer &middot; statically verifiable.</span></p>
        <p class="flex gap-5">
          <a class="transition hover:text-slate-900 dark:hover:text-white" href="/spec/">Specification</a>
          <a class="transition hover:text-slate-900 dark:hover:text-white" href="/llms.txt">llms.txt</a>
          <a class="transition hover:text-slate-900 dark:hover:text-white" href="https://github.com/jiso-sh/jiso" rel="external">GitHub</a>
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
            `<section class="mb-7">
              <h2 class="mb-2.5 text-xs font-semibold tracking-widest text-slate-900 uppercase dark:text-white">${escapeHtml(group.title)}</h2>
              <ul class="space-y-0.5 border-l border-slate-200 dark:border-slate-800">
                ${group.pages
                  .map(
                    (page) =>
                      `<li><a href="${page.url}" class="${
                        page.url === activePath
                          ? '-ml-px border-l-2 border-jiso-500 pl-3 font-medium text-jiso-700 dark:border-jiso-400 dark:text-jiso-300'
                          : '-ml-px border-l-2 border-transparent pl-3 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white'
                      } block py-1">${escapeHtml(page.title)}</a></li>`,
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
        ? `<a href="${page.url}" class="group flex-1 rounded-xl border border-slate-200 p-4 transition hover:border-jiso-400 dark:border-slate-800 dark:hover:border-jiso-500 ${direction === 'next' ? 'text-right' : ''}">
            <span class="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">${direction === 'next' ? 'Next' : 'Previous'}</span>
            <span class="mt-1 block font-medium text-slate-900 transition group-hover:text-jiso-600 dark:text-white dark:group-hover:text-jiso-400">${
              direction === 'next'
                ? `${escapeHtml(page.title)} &rarr;`
                : `&larr; ${escapeHtml(page.title)}`
            }</span>
          </a>`
        : '<span class="flex-1"></span>';
    return `<nav class="mt-14 flex gap-4 text-sm" aria-label="Pagination">
      ${card(prev, 'prev')}${card(next, 'next')}
    </nav>`;
  },
});

/** Right-hand "On this page" rail from the page's h2/h3 headings. */
function renderToc(headings = []) {
  const entries = headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  if (entries.length < 2) return '';
  return `<nav class="toc sticky top-24" aria-label="On this page">
    <p class="mb-3 text-xs font-semibold tracking-widest text-slate-900 uppercase dark:text-white">On this page</p>
    <ul class="border-l border-slate-200 dark:border-slate-800">
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
export function renderDocument({ body, description, path, title }) {
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
  <body class="bg-white font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
    ${SiteHeader.definition.render({}, {}, { activePath: path })}
    ${body}
    ${SiteFooter.definition.render({}, {})}
    ${SEARCH_DIALOG}
  </body>
</html>
`;
}

/** Docs layout: sidebar + article + on-this-page rail, composed at render
 * time (§4.5). The mobile sidebar is an L0 disclosure — zero JavaScript. */
export function renderDocsPage({ activePath, eyebrow, groups, headings, html, next, prev, prose = true }) {
  const sidebar = DocsSidebar.definition.render({}, {}, { activePath, groups });
  return `<div class="mx-auto flex max-w-7xl gap-12 px-4 py-12 sm:px-6">
    <aside class="hidden lg:block">${sidebar}</aside>
    <main class="min-w-0 flex-1">
      <details class="mb-8 rounded-xl border border-slate-200 px-4 py-3 text-sm lg:hidden dark:border-slate-800">
        <summary class="cursor-pointer font-medium text-slate-700 dark:text-slate-300">Documentation menu</summary>
        <div class="pt-4">${sidebar}</div>
      </details>
      ${eyebrow ? `<p class="mb-3 text-sm font-semibold text-jiso-600 dark:text-jiso-400">${escapeHtml(eyebrow)}</p>` : ''}
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

/** Section landing pages: a designed card grid instead of a markdown link list. */
export function renderSectionIndex(section) {
  const numbered = section.key === 'tutorial';
  const cards = section.pages
    .map((page, index) => {
      const title = numbered ? page.title.replace(/^\d+\.\s*/, '') : page.title;
      return `<li>
        <a href="${page.url}" class="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-jiso-400 hover:shadow-lg hover:shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-jiso-500 dark:hover:shadow-black/30">
          ${
            numbered
              ? `<span class="mb-3 inline-flex size-8 items-center justify-center rounded-lg bg-jiso-50 font-mono text-sm font-semibold text-jiso-700 dark:bg-jiso-950 dark:text-jiso-300">${String(index + 1).padStart(2, '0')}</span>`
              : ''
          }
          <h2 class="font-semibold text-slate-900 group-hover:text-jiso-600 dark:text-white dark:group-hover:text-jiso-400 ${section.key === 'api' ? 'font-mono text-[0.95rem]' : ''}">${escapeHtml(title)}</h2>
          ${page.description ? `<p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">${escapeHtml(page.description)}</p>` : ''}
          <span class="mt-auto pt-3 text-sm font-medium text-jiso-600 opacity-0 transition group-hover:opacity-100 dark:text-jiso-400">Read &rarr;</span>
        </a>
      </li>`;
    })
    .join('');

  return `<div class="mb-10 max-w-2xl">
      <h1 class="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">${escapeHtml(section.title)}</h1>
      ${SECTION_INTROS[section.key] ? `<p class="mt-4 text-lg leading-relaxed text-slate-600 dark:text-slate-400">${escapeHtml(SECTION_INTROS[section.key])}</p>` : ''}
    </div>
    <ul class="grid gap-4 sm:grid-cols-2">${cards}</ul>`;
}
