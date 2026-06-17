import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Embed runnable example apps in the docs site (plan: examples-in-docs-site).
 * Each example is a self-contained static export served from a stable base path
 * and shown in a sandboxed <iframe> next to its authored source. The export is
 * produced by the example's own static-export bridge (SPEC §9.5) — we re-root
 * its absolute asset/handler refs under the iframe base so the docs site can
 * serve it from a subdirectory without colliding with the docs' own /assets and
 * /c namespaces.
 *
 * Manifest-driven: every example declares its dir, export bridge, and the source
 * files to surface; build/render is one generic path (commerce, crm, so all run
 * through it). `sources` show authored TSX next to the data/optimism story
 * (queries, mutations, derived transforms) — never lowered IR / generated
 * components (SPEC §5.2: hand-authored lowered IR is KV235; we display, not author).
 */

/** @typedef {{ name: string, title: string, blurb: string, dir: string,
 *   exportModule: string, exportFn: string, appExportField: string,
 *   embed: 'static' | 'service', serviceUrlEnv?: string,
 *   sources: string[] }} ExampleManifest */

/** @type {ExampleManifest[]} */
export const EXAMPLES = [
  {
    name: 'commerce',
    title: 'Commerce',
    blurb:
      'A full Kovo storefront — product grid, cart badge, and order history — running live next to the authored components, queries, and derived optimism that drive it.',
    dir: 'examples/commerce',
    exportModule: 'examples/commerce/scripts/export-static.mjs',
    exportFn: 'exportCommerceStaticApp',
    appExportField: 'commerce.client.js',
    embed: 'static',
    sources: [
      'src/components/product-grid.tsx',
      'src/components/cart-badge.tsx',
      'src/components/order-history.tsx',
      'src/queries.ts',
      'src/generated/optimistic/cart-add.ts',
    ],
  },
  {
    name: 'crm',
    title: 'CRM',
    blurb:
      'A multi-page sales CRM — pipeline dashboard, contact book, and per-deal detail — over a real Drizzle/PGlite database. The source tabs show the derived + hand-written optimism mix that powers create/move/close-deal.',
    dir: 'examples/crm',
    exportModule: 'examples/crm/scripts/export-static.mjs',
    exportFn: 'exportCrmStaticApp',
    appExportField: '',
    embed: 'service',
    serviceUrlEnv: 'KOVO_EXAMPLE_CRM_URL',
    sources: [
      'src/components/pipeline.tsx',
      'src/components/contacts.tsx',
      'src/components/deal-detail.tsx',
      'src/queries.ts',
      'src/mutations.ts',
      'src/generated/optimistic/create-deal.ts',
    ],
  },
  {
    name: 'stackoverflow',
    title: 'Stack Overflow',
    blurb:
      'A multi-page Q&A site — ranked question list and per-question answers — over a real Drizzle/PGlite database. The source tabs show the fully compiler-derived optimism behind voting and posting answers.',
    dir: 'examples/stackoverflow',
    exportModule: 'examples/stackoverflow/scripts/export-static.mjs',
    exportFn: 'exportSoStaticApp',
    appExportField: '',
    embed: 'service',
    serviceUrlEnv: 'KOVO_EXAMPLE_STACKOVERFLOW_URL',
    sources: [
      'src/components/question-list.tsx',
      'src/components/question-detail.tsx',
      'src/queries.ts',
      'src/mutations.ts',
      'src/generated/optimistic/vote-up.ts',
    ],
  },
];

/** The docs-site base path the example's static export is served from. */
export function exampleAppBase(name) {
  return `/examples/${name}/app/`;
}

/** The docs-site page path for an example's two-pane embed. */
export function examplePagePath(name) {
  return `/examples/${name}/`;
}

export function exampleLiveAppHref(manifest) {
  if (manifest.embed === 'static') return exampleAppBase(manifest.name);
  const href = process.env[manifest.serviceUrlEnv ?? '']?.trim();
  return href ? href.replace(/\/?$/, '/') : undefined;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Re-root every origin-absolute attribute value under the iframe base so the
 * export runs from a subdirectory. This covers in-app navigation (`href="/"`,
 * `href="/deals/d1"` — the multi-page links), assets (`/assets/…`), and any
 * inline-loader handler refs / modulepreloads (`/c/foo.client.js#fn`). The match
 * is `="/` not followed by another `/` (so protocol-relative `="//host"` and
 * full `="https://…"` URLs are left alone). A `<base href>` can't do this — it
 * only rewrites relative URLs, never root-absolute ones. */
function rerootHtml(html, appBase) {
  const prefix = appBase.replace(/\/$/, '');
  return html.replace(/="\/(?!\/)/g, `="${prefix}/`);
}

async function htmlFilesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFilesUnder(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/**
 * Build one example's static export straight into the docs `dist/` under its
 * app base, then re-root its absolute refs so it runs from there. Reuses the
 * example's own export bridge (`vp run export`) as the producer.
 */
export async function buildExampleEmbed(manifest, { outDir, repoRootPath }) {
  if (manifest.embed !== 'static') {
    throw new Error(`build: ${manifest.name} is a dynamic service example, not a static embed`);
  }

  const exportStaticPath = path.join(repoRootPath, manifest.exportModule);
  const module = await import(pathToFileURL(exportStaticPath).href);
  const exportFn = module[manifest.exportFn];
  if (typeof exportFn !== 'function') {
    throw new Error(`build: ${manifest.exportModule} must export ${manifest.exportFn}()`);
  }

  const appBase = exampleAppBase(manifest.name);
  const appDir = path.join(outDir, appBase.replace(/^\//, ''));

  const result = await exportFn({ outDir: appDir });
  if (result.diagnostics.length > 0) {
    throw new Error(
      `build: ${manifest.name} static export reported ${result.diagnostics.length} diagnostic(s); refusing to embed a broken app`,
    );
  }

  // Drop the build manifest the export copies in — not part of the served app.
  await rm(path.join(appDir, '.vite'), { force: true, recursive: true });

  for (const file of await htmlFilesUnder(appDir)) {
    await writeFile(file, rerootHtml(await readFile(file, 'utf8'), appBase), 'utf8');
  }

  return { appBase, htmlCount: result.artifacts.length };
}

/** Read the authored source files an example surfaces in its code panel. A
 * missing file throws (fails the build loudly) rather than silently dropping a tab. */
export async function loadExampleSources(manifest, { repoRootPath }) {
  const exampleRoot = path.join(repoRootPath, manifest.dir);
  const files = [];
  for (const relative of manifest.sources) {
    const absolute = path.join(exampleRoot, relative);
    files.push({ code: await readFile(absolute, 'utf8'), name: relative });
  }
  return files;
}

/**
 * Two-pane example page: a sandboxed <iframe> running the export on the left,
 * a zero-JS tabbed source viewer on the right. Tabs are CSS-only (radio inputs
 * + `:checked` sibling rules), so the page works with JavaScript disabled —
 * the docs degradation contract (SPEC §8). `files` carry pre-highlighted code
 * windows (rendered through the shared Shiki pipeline by the caller).
 */
export function renderExampleSplit({ appHref, blurb, files, idBase, title }) {
  const tabRules = files
    .map((_, index) => `#${idBase}-${index}:checked~.example-panels>[data-index="${index}"]`)
    .join(',');
  const labelRules = files
    .map((_, index) => `#${idBase}-${index}:checked~.example-tablist>[for="${idBase}-${index}"]`)
    .join(',');

  const inputs = files
    .map(
      (_, index) =>
        `<input type="radio" name="${idBase}" id="${idBase}-${index}" class="example-tab-input"${
          index === 0 ? ' checked' : ''
        } />`,
    )
    .join('');
  const labels = files
    .map(
      (file, index) =>
        `<label for="${idBase}-${index}" class="example-tab" title="${escapeHtml(
          file.name,
        )}">${escapeHtml(file.name.split('/').pop())}</label>`,
    )
    .join('');
  const panels = files
    .map((file, index) => `<div class="example-panel" data-index="${index}">${file.html}</div>`)
    .join('');

  return `<div class="example-page">
    <header class="example-head">
      <p class="eyebrow">Examples</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(blurb)}</p>
    </header>
    <style>${tabRules}{display:block}${labelRules}{color:var(--ink);border-bottom-color:var(--teal)}</style>
    <div class="example-split">
      <section class="example-live" aria-label="${escapeHtml(title)} running app">
        <div class="example-bar">
          <span class="example-bar-title">Live app</span>
          ${
            appHref
              ? `<a class="example-open" href="${escapeHtml(appHref)}" target="_blank" rel="noopener">Open in new tab &#8599;</a>`
              : ''
          }
        </div>
        ${
          appHref
            ? `<iframe class="example-frame" src="${escapeHtml(appHref)}" title="${escapeHtml(
                title,
              )} running app" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>`
            : `<div class="example-frame example-frame-empty"><p>Dynamic demo service not configured for this static build.</p></div>`
        }
      </section>
      <section class="example-source" aria-label="${escapeHtml(title)} source code">
        ${inputs}
        <div class="example-tablist" role="tablist">${labels}</div>
        <div class="example-panels">${panels}</div>
      </section>
    </div>
  </div>`;
}
