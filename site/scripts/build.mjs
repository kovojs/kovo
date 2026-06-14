import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateApiReference } from './api-ref.mjs';
import { captureAll } from './capture.mjs';
import { renderDocument, renderDocsPage, renderSectionIndex } from './chrome.mjs';
import { generateDiagnosticsReference } from './diagnostics-ref.mjs';
import { renderLanding } from './landing.mjs';
import { buildLlmsFull, buildLlmsIndex } from './llms.mjs';
import { parseFrontmatter, renderMarkdown } from './md.mjs';
import { loadTutorialSnippets, substituteSnippets } from '../tutorial/extract-snippets.mjs';

/**
 * Static export (plan W2/W9 surface; site-local stand-in for D8 R6).
 * Output contract: dist/ is deployable to any static host, works with JS
 * disabled, and every docs page has a raw .md mirror plus an llms.txt entry.
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);
const outDir = path.join(siteRoot, 'dist');

const SECTIONS = [
  { dir: 'content/docs', key: 'docs', title: 'Getting Started' },
  { dir: 'content/tutorial', key: 'tutorial', title: 'Tutorial' },
  { dir: 'content/guides', key: 'guides', title: 'Guides' },
  { dir: 'gen/api', key: 'api', title: 'API Reference' },
  { dir: 'gen/reference', key: 'reference', title: 'Reference' },
];

// docs/prelaunch-checklist.md tracks jiso.dev confirmation; mirrors stay
// origin-relative in HTML, so only llms.txt bakes this in.
const SITE_ORIGIN = 'https://jiso.dev';
const ROUTE_MANIFEST_FILE = '.jiso-site-routes.json';

async function loadSection(section) {
  const directory = path.join(siteRoot, section.dir);
  if (!existsSync(directory)) return { ...section, pages: [] };

  const pages = [];
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.md')) continue;
    const source = await readFile(path.join(directory, file), 'utf8');
    const { body, data } = parseFrontmatter(source);
    const slug = data.slug ?? file.replace(/\.md$/, '');
    pages.push({
      body,
      description: data.description ?? '',
      mirror: `/${section.key}/${slug}.md`,
      order: data.order ?? 999,
      slug,
      source,
      title: data.title ?? slug,
      url: `/${section.key}/${slug}/`,
    });
  }

  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return { ...section, pages };
}

async function writePage(urlPath, html) {
  const target = path.join(outDir, urlPath.replace(/^\//, ''), 'index.html');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
}

/** Content pages can embed build-time captures with {{capture:name}} — the
 * value is regenerated from the real toolchain every build (W3 doctrine), so
 * embedded compiler/CLI output cannot drift. Unknown names fail the build. */
function substituteCaptures(body, captures) {
  const values = {
    'lowering-client': `\`\`\`js\n${captures.lowering.client}\n\`\`\``,
    'lowering-input': `\`\`\`tsx\n${captures.lowering.input}\n\`\`\``,
    'lowering-lint': captures.lowering.lint,
    'lowering-server': `\`\`\`js\n${captures.lowering.server}\n\`\`\``,
  };
  return body.replace(/\{\{capture:([a-z-]+)\}\}/g, (_match, name) => {
    const value = values[name];
    if (value === undefined) throw new Error(`build: unknown capture "${name}"`);
    return value;
  });
}

/** SPEC subsections like "**13.1 CSS.**" are bold paragraphs, not headings —
 * stamp them with the same number-derived ids so § citations can resolve. */
function stampSpecParagraphIds(html) {
  return html.replace(
    /<p><strong>(\d+(?:\.\d+)*)/g,
    (_match, number) => `<p id="${number.replaceAll('.', '-')}"><strong>${number}`,
  );
}

/** Rewrite /spec/# citations whose exact anchor doesn't exist to the nearest
 * enclosing section that does (e.g. #16-1 → #16). The W9 gate then proves
 * every emitted anchor resolves. */
function resolveSpecAnchors(html, specIds) {
  return html.replace(/href="\/spec\/#([0-9-]+)"/g, (_match, anchor) => {
    let candidate = anchor;
    while (candidate && !specIds.has(candidate)) {
      candidate = candidate.includes('-') ? candidate.slice(0, candidate.lastIndexOf('-')) : '';
    }
    return `href="/spec/${candidate ? `#${candidate}` : ''}"`;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function loadGalleryRoutes() {
  const viteModulePath = resolveViteModulePath();
  const { createServer } = await import(pathToFileURL(viteModulePath).href);
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root: repoRootPath,
    server: { middlewareMode: true },
  });

  try {
    const gallery = await vite.ssrLoadModule('/examples/gallery/src/demo-fixtures.tsx');
    return gallery.galleryRoutes;
  } finally {
    await vite.close();
  }
}

function resolveViteModulePath() {
  const candidates = [
    path.join(siteRoot, 'node_modules/vite/dist/node/index.js'),
    path.join(repoRootPath, 'node_modules/vite/dist/node/index.js'),
    path.join(repoRootPath, 'node_modules/.pnpm/node_modules/vite/dist/node/index.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error('build: Vite is required to render gallery TSX fixtures');
}

function galleryUrl(routePath) {
  return `/gallery${routePath}/`;
}

function renderGalleryPage(route, routes) {
  const nav = routes
    .map(
      (candidate) =>
        `<a href="${galleryUrl(candidate.path)}"${
          candidate.path === route.path ? ' aria-current="page"' : ''
        }>${escapeHtml(candidate.title)}</a>`,
    )
    .join('');

  const demo = route
    .render()
    .replace(
      /\shref="\/(?!assets\/|c\/|docs\/|tutorial\/|guides\/|gallery\/|api\/|spec\/|fonts\/|llms\.txt|$)([^"]*)"/g,
      (_match, href) => {
        if (href.startsWith('components/')) return ` href="/gallery/${href}/"`;
        return ` href="${galleryUrl(route.path)}"`;
      },
    );

  return `<div class="gallery-page">
    <header class="gallery-head">
      <p class="eyebrow">Gallery</p>
      <h1>${escapeHtml(route.title)}</h1>
      <p>Static fixture output for the ${escapeHtml(route.title)} component contract.</p>
    </header>
    <nav class="gallery-nav" aria-label="Gallery components">${nav}</nav>
    <div class="gallery-demo">${demo}</div>
  </div>`;
}

function textFromHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  await generateApiReference(); // W6: emit gen/api before sections load.
  await generateDiagnosticsReference(); // Agent layer: emit gen/reference/diagnostics.md before sections load.
  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });

  // Assets: Tailwind CSS from the vite build, public/ verbatim (incl. /c/).
  const cssSource = path.join(siteRoot, 'dist-css/assets/site.css');
  if (!existsSync(cssSource)) {
    throw new Error('build: run `vite build` first — dist-css/assets/site.css is missing');
  }
  await mkdir(path.join(outDir, 'assets'), { recursive: true });
  await cp(cssSource, path.join(outDir, 'assets/site.css'));
  await cp(path.join(siteRoot, 'public'), outDir, { recursive: true });

  // W3: regenerate every artifact from the real toolchain; throws on drift.
  const captures = await captureAll(repoRoot);

  // W5: tutorial snippets are extracted from the checked-in step states —
  // {{snippet:…}} references that no longer resolve fail the build.
  const snippets = loadTutorialSnippets();

  // /spec renders first so every page's § citations resolve against its ids.
  const specSource = await readFile(new URL('SPEC.md', repoRoot), 'utf8');
  const spec = await renderMarkdown(specSource, { anchorStyle: 'spec' });
  const specHtml = stampSpecParagraphIds(spec.html);
  const specIds = new Set([
    ...spec.headings.map((heading) => heading.id),
    ...[...specHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
  ]);
  const finishPage = (html) => resolveSpecAnchors(html, specIds);

  const sections = [];
  for (const section of SECTIONS) sections.push(await loadSection(section));
  const galleryRoutes = await loadGalleryRoutes();
  const routeManifest = [];
  async function writeRoutePage(urlPath, html) {
    routeManifest.push(urlPath);
    await writePage(urlPath, html);
  }
  const gallerySection = {
    key: 'gallery',
    pages: [
      {
        title: 'Interactive Gallery',
        url: '/gallery/interactive/',
      },
      ...galleryRoutes.map((route) => ({
        title: route.title,
        url: galleryUrl(route.path),
      })),
    ],
    title: 'Gallery',
  };
  const groups = sections
    .filter((section) => section.pages.length > 0)
    .concat(gallerySection)
    .map((section) => ({
      pages: section.pages.map((page) => ({ title: page.title, url: page.url })),
      title: section.title,
    }));

  const searchIndex = [];

  for (const section of sections) {
    await writeRoutePage(
      `/${section.key}/`,
      finishPage(
        renderDocument({
          body: renderDocsPage({
            activePath: `/${section.key}/`,
            groups,
            html: renderSectionIndex(section),
            prose: false,
          }),
          description: `${section.title} — Jiso documentation`,
          path: `/${section.key}/`,
          title: `${section.title} · Jiso`,
        }),
      ),
    );

    for (const [position, page] of section.pages.entries()) {
      const { headings, html, text, title } = await renderMarkdown(
        substituteSnippets(substituteCaptures(page.body, captures), snippets),
      );
      const prev = section.pages[position - 1];
      const next = section.pages[position + 1];

      await writeRoutePage(
        page.url,
        finishPage(
          renderDocument({
            body: renderDocsPage({
              activePath: page.url,
              eyebrow: section.title,
              groups,
              headings,
              html,
              next: next && { title: next.title, url: next.url },
              prev: prev && { title: prev.title, url: prev.url },
            }),
            description: page.description || `${page.title} — Jiso documentation`,
            path: page.url,
            title: `${page.title || title} · Jiso`,
          }),
        ),
      );

      // Agent surface: raw markdown mirror at a stable URL (tutorial snippets
      // substituted so the mirror carries real code, not placeholders).
      const mirrorTarget = path.join(outDir, page.mirror.replace(/^\//, ''));
      await mkdir(path.dirname(mirrorTarget), { recursive: true });
      await writeFile(mirrorTarget, substituteSnippets(page.source, snippets), 'utf8');

      searchIndex.push({
        section: section.title,
        text: `${headings.map((heading) => heading.text).join(' ')} ${text}`.slice(0, 6000),
        title: page.title,
        url: page.url,
      });
    }
  }

  await writeRoutePage(
    '/gallery/',
    finishPage(
      renderDocument({
        body: renderDocsPage({
          activePath: '/gallery/',
          groups,
          html: renderSectionIndex(gallerySection),
          prose: false,
        }),
        description: 'Jiso component gallery — rendered headless and styled component fixtures.',
        path: '/gallery/',
        title: 'Gallery · Jiso',
      }),
    ),
  );

  await writeRoutePage(
    '/gallery/interactive/',
    finishPage(
      renderDocument({
        body: renderDocsPage({
          activePath: '/gallery/interactive/',
          groups,
          html: `<div class="gallery-page">
    <header class="gallery-head">
      <p class="eyebrow">Gallery</p>
      <h1>Interactive Gallery</h1>
      <p>Compiled Jiso UI primitive demos with generated client handlers.</p>
    </header>
  </div>`,
          prose: false,
        }),
        description: 'Compiled Jiso UI primitive demos with generated client handlers.',
        path: '/gallery/interactive/',
        title: 'Interactive Gallery · Jiso',
      }),
    ),
  );

  for (const [position, route] of galleryRoutes.entries()) {
    const prev = galleryRoutes[position - 1];
    const next = galleryRoutes[position + 1];
    const html = renderGalleryPage(route, galleryRoutes);
    const url = galleryUrl(route.path);

    await writeRoutePage(
      url,
      finishPage(
        renderDocument({
          body: renderDocsPage({
            activePath: url,
            groups,
            html,
            next: next && { title: next.title, url: galleryUrl(next.path) },
            prev: prev && { title: prev.title, url: galleryUrl(prev.path) },
            prose: false,
          }),
          description: `${route.title} component gallery fixture.`,
          path: url,
          title: `${route.title} · Gallery · Jiso`,
        }),
      ),
    );

    searchIndex.push({
      section: 'Gallery',
      text: textFromHtml(html).slice(0, 6000),
      title: route.title,
      url,
    });
  }

  searchIndex.push({
    section: 'Gallery',
    text: 'Compiled Jiso UI primitive demos with generated client handlers.',
    title: 'Interactive Gallery',
    url: '/gallery/interactive/',
  });

  // /spec — SPEC.md verbatim, number-derived § anchors (plan exit criterion 6).
  await writeRoutePage(
    '/spec/',
    finishPage(
      renderDocument({
        body: `<div class="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
        <p class="note-banner">
          This is the normative specification, rendered verbatim from
          <a href="https://github.com/jiso-sh/jiso/blob/main/SPEC.md" rel="external">SPEC.md</a>
          at build time. The docs explain; the spec decides.
        </p>
        <article class="prose">${specHtml}</article>
      </div>`,
        description: 'Jiso — Product Requirements & Technical Specification (normative).',
        path: '/spec/',
        title: 'Specification · Jiso',
      }),
    ),
  );
  await writeFile(path.join(outDir, 'spec.md'), specSource, 'utf8');
  searchIndex.push({
    section: 'Specification',
    text: spec.text.slice(0, 6000),
    title: 'Jiso Specification',
    url: '/spec/',
  });

  // Landing (W4). Chromeless: the landing ships its own always-dark header
  // and footer; the docs chrome (and the Jiso name) stay everywhere else.
  await writeRoutePage(
    '/',
    finishPage(
      renderDocument({
        body: renderLanding(captures),
        chromeless: true,
        description:
          'The web framework that hands your agent the fix — database to DOM. Build-time checks from backend to frontend; pages interactive at first paint.',
        path: '/',
        title: 'Kovo — the web framework that hands your agent the fix',
      }),
    ),
  );

  // SPEC.md section 9.5 static export replays declared route documents. The
  // docs-site app shell consumes this manifest so stale files in dist/ cannot
  // silently become exported routes.
  await writeFile(
    path.join(outDir, ROUTE_MANIFEST_FILE),
    `${JSON.stringify({ routes: routeManifest }, null, 2)}\n`,
    'utf8',
  );

  // W8 search index.
  await writeFile(path.join(outDir, 'search-index.json'), JSON.stringify(searchIndex), 'utf8');

  // Agent surface: llms.txt index over the md mirrors, plus llms-full.txt — the
  // whole corpus concatenated for ingestion. Both come from the same loaded
  // sections (incl. the generated API + diagnostics pages) so they cannot drift
  // from the human pages. Bodies get the same snippet/capture substitution the
  // pages and mirrors do, so the full text carries real code, not placeholders.
  await writeFile(
    path.join(outDir, 'llms.txt'),
    buildLlmsIndex(sections, { origin: SITE_ORIGIN, specMirror: '/spec.md' }),
    'utf8',
  );
  await writeFile(
    path.join(outDir, 'llms-full.txt'),
    buildLlmsFull(sections, {
      origin: SITE_ORIGIN,
      renderBody: (page) => substituteSnippets(substituteCaptures(page.body, captures), snippets),
      spec: { body: specSource, title: 'Jiso Specification', url: '/spec/' },
    }),
    'utf8',
  );

  // 404 for static hosts.
  await writeFile(
    path.join(outDir, '404.html'),
    renderDocument({
      body: `<main class="mx-auto grid min-h-[60vh] max-w-3xl place-items-center px-6">
        <div class="text-center">
          <p class="e404-code">404</p>
          <h1 class="mt-3 text-4xl font-bold tracking-tight">Page not found</h1>
          <p class="mt-4" style="color: var(--dim)">No route declares this path &mdash; in a Jiso app, <code class="font-mono text-sm">vp check</code> would have caught that link.</p>
          <div class="mt-8 flex justify-center gap-4">
            <a class="btn-solid" href="/docs/installation/">Read the docs</a>
            <a class="btn-line" href="/">Go home</a>
          </div>
        </div>
      </main>`,
      description: 'Page not found',
      path: '/404',
      title: 'Not found · Jiso',
    }),
    'utf8',
  );

  const pageCount =
    sections.reduce((total, section) => total + section.pages.length, 0) +
    galleryRoutes.length +
    1 +
    1;
  process.stdout.write(
    `site-build/v1\npages=${pageCount + sections.length + 2} sections=${sections.length} loader=${captures.loader.gzipBytes}B-gzip\nOK\n`,
  );
}

await main();
