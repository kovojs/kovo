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
 */

const COMMERCE = {
  appBase: '/examples/commerce/app/',
  // Authored TSX the reader should see — never lowered IR / generated stamps
  // (SPEC §5.2: hand-authored lowered IR is FW235; we display, not author).
  sources: [
    'src/components/product-grid.tsx',
    'src/components/cart-badge.tsx',
    'src/components/order-history.tsx',
  ],
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Re-root the export's origin-absolute /assets and /c references (incl. the
 * inline loader's `on:*` handler refs like `/c/commerce.client.js#fn` and the
 * modulepreload href) under the iframe base. The loader itself is inlined and
 * resolves handlers relative to origin, so every such ref must carry the base
 * prefix once the export is served from a subdirectory. */
function rerootHtml(html, appBase) {
  const prefix = appBase.replace(/\/$/, '');
  return html.replaceAll('="/assets/', `="${prefix}/assets/`).replaceAll('="/c/', `="${prefix}/c/`);
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
 * Build the commerce static export straight into the docs `dist/` under
 * COMMERCE.appBase, then re-root its absolute refs so it runs from there.
 * Reuses examples/commerce/scripts/export-static.mjs (`vp run export`) as the
 * producer — the same bridge the example ships for standalone hosting.
 */
export async function buildCommerceEmbed({ outDir, repoRootPath }) {
  const exportStaticPath = path.join(repoRootPath, 'examples/commerce/scripts/export-static.mjs');
  const { exportCommerceStaticApp } = await import(pathToFileURL(exportStaticPath).href);
  const appDir = path.join(outDir, COMMERCE.appBase.replace(/^\//, ''));

  const result = await exportCommerceStaticApp({ outDir: appDir });
  if (result.diagnostics.length > 0) {
    throw new Error(
      `build: commerce static export reported ${result.diagnostics.length} diagnostic(s); refusing to embed a broken app`,
    );
  }

  // Drop the build manifest the export copies in — it's not part of the served
  // app and would otherwise ship inside the docs site.
  await rm(path.join(appDir, '.vite'), { force: true, recursive: true });

  for (const file of await htmlFilesUnder(appDir)) {
    await writeFile(file, rerootHtml(await readFile(file, 'utf8'), COMMERCE.appBase), 'utf8');
  }

  return { appBase: COMMERCE.appBase, htmlCount: result.artifacts.length };
}

/** Read the authored source files an example wants to showcase. */
export async function loadCommerceSources({ repoRootPath }) {
  const commerceRoot = path.join(repoRootPath, 'examples/commerce');
  const files = [];
  for (const relative of COMMERCE.sources) {
    const absolute = path.join(commerceRoot, relative);
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
export function renderExampleSplit({ appBase, blurb, files, idBase, title }) {
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
          <a class="example-open" href="${appBase}" target="_blank" rel="noopener">Open in new tab &#8599;</a>
        </div>
        <iframe class="example-frame" src="${appBase}" title="${escapeHtml(
          title,
        )} running app" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>
      </section>
      <section class="example-source" aria-label="${escapeHtml(title)} source code">
        ${inputs}
        <div class="example-tablist" role="tablist">${labels}</div>
        <div class="example-panels">${panels}</div>
      </section>
    </div>
  </div>`;
}

export const EXAMPLES = { commerce: COMMERCE };
