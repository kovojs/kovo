import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Embed runnable example apps in the docs site (plan: examples-in-docs-site).
 * Examples are usually dynamic demo services shown in a sandboxed <iframe> next
 * to authored source. Static export support remains available for future
 * L0/L1-safe examples.
 *
 * Manifest-driven: every example declares its dir, export bridge, and the source
 * files to surface; build/render is one generic path (commerce, crm, so all run
 * through it). `sources` show authored TSX next to the data/optimism story
 * (queries, mutations, derived transforms) — never lowered IR / generated
 * components (SPEC §5.2: hand-authored lowered IR is KV235; we display, not author).
 */

/** @typedef {{ name: string, title: string, blurb: string, dir: string,
 *   exportModule: string, exportFn: string, appExportField: string,
 *   embed: 'static' | 'service', serviceUrlEnv?: string, serviceUrl?: string,
 *   sources: string[] }} ExampleManifest */

/** @type {ExampleManifest[]} */
export const EXAMPLES = [
  {
    name: 'commerce',
    title: 'Commerce',
    blurb:
      'A full Kovo storefront — product grid, cart badge, and order history — running live next to the authored components, queries, and derived optimism that drive it.',
    dir: 'examples/commerce',
    exportModule: '',
    exportFn: '',
    appExportField: 'commerce.client.js',
    embed: 'service',
    serviceUrlEnv: 'KOVO_EXAMPLE_COMMERCE_URL',
    serviceUrl: 'https://kovo-commerce-sfqtuclaza-uc.a.run.app',
    sources: [
      'src/components/product-grid.tsx',
      'src/components/cart-badge.tsx',
      'src/components/order-history.tsx',
      'src/queries.ts',
      'scripts/emit-graph.mjs',
    ],
  },
  {
    name: 'crm',
    title: 'CRM',
    blurb:
      'A multi-page sales CRM — pipeline dashboard, contact book, and per-deal detail — over a real Drizzle/PGlite database. The source tabs show the derived + hand-written optimism mix that powers create/move/close-deal.',
    dir: 'examples/crm',
    exportModule: '',
    exportFn: '',
    appExportField: '',
    embed: 'service',
    serviceUrlEnv: 'KOVO_EXAMPLE_CRM_URL',
    serviceUrl: 'https://kovo-crm-sfqtuclaza-uc.a.run.app',
    sources: [
      'src/components/pipeline.tsx',
      'src/components/contacts.tsx',
      'src/components/deal-detail.tsx',
      'src/queries.ts',
      'src/mutations.ts',
      'scripts/emit-graph.mjs',
    ],
  },
  {
    name: 'stackoverflow',
    title: 'Stack Overflow',
    blurb:
      'A multi-page Q&A site — ranked question list and per-question answers — over a real Drizzle/PGlite database. The source tabs show the fully compiler-derived optimism behind voting and posting answers.',
    dir: 'examples/stackoverflow',
    exportModule: '',
    exportFn: '',
    appExportField: '',
    embed: 'service',
    serviceUrlEnv: 'KOVO_EXAMPLE_STACKOVERFLOW_URL',
    serviceUrl: 'https://kovo-stackoverflow-sfqtuclaza-uc.a.run.app',
    sources: [
      'src/components/question-list.tsx',
      'src/components/question-detail.tsx',
      'src/queries.ts',
      'src/mutations.ts',
      'scripts/emit-graph.mjs',
    ],
  },
];

/**
 * Examples that are surfaced in the agent layer (llms.txt / llms-full.txt) but
 * NOT in the human `/examples/` two-pane route. The route renders every EXAMPLES
 * entry as a live-iframe + source split; devtool (agent-facing MCP example) and
 * reference (auth/security example) have no live demo service to embed, so they
 * stay out of EXAMPLES (keeping the human route working) and are listed here so
 * agents still get their authored source. Same ExampleManifest shape, minus the
 * embed/service fields the human route needs. The component gallery has its own
 * agent-layer section (site/src/aux.ts buildGalleryLlmsSection, sourced from
 * examples/gallery/src/component-catalog.ts), so it is not listed here.
 *
 * @type {Array<{ name: string, title: string, blurb: string, dir: string, url?: string, sources: Array<string | { name?: string, path: string }> }>}
 */
export const LLMS_ONLY_EXAMPLES = [
  {
    name: 'devtool',
    title: 'Dataflow Devtools',
    blurb:
      "A devtool that visualizes a Kovo app's dataflow graph — select any node and trace the queries in and mutations out — and serves the same graph cards to agents over MCP. It is itself a Kovo app, dogfooding the framework on its own tooling (SPEC §5.3: agents consume the same artifact humans read).",
    dir: 'examples/devtool',
    url: '/examples/devtool.md',
    sources: [
      'src/app-shell.ts',
      { path: 'packages/devtool/src/graph-model.mjs' },
      { path: 'packages/devtool/src/cards.mjs' },
      { path: 'packages/devtool/src/render.mjs' },
      { path: 'packages/devtool/src/client/devtool-pz.client.js' },
    ],
  },
  {
    name: 'reference',
    title: 'Reference (Auth & Security)',
    blurb:
      'A minimal reference app showing Kovo authentication and authorization: better-auth session providers, sign-in/sign-out mutations with CSRF protection, role and authed guards on routes, and the explain graph the compiler proves scope audits against.',
    dir: 'examples/reference',
    url: '/examples/reference.md',
    sources: ['src/app.ts', 'src/app-shell.ts'],
  },
];

/**
 * Build a synthetic content-style `DocSection` for the example apps so the agent
 * layer (llms.txt / llms-full.txt) surfaces them alongside the markdown sections.
 * Examples are otherwise a bespoke route family fed only to the human pages, so
 * without this they are invisible to agents. The section is shaped exactly like a
 * `DocSection` (title + pages with title/description/mirror/url/markdown/source)
 * so it can be passed straight into `buildLlmsIndex` / `buildLlmsFull`.
 *
 * Each page's markdown body = the blurb + a one-line "what it demonstrates" + each
 * authored source file (from `loadExampleSources`) rendered as a fenced code block
 * labeled with its repo-relative path. The `.md` mirror lives at
 * `/examples/<name>.md` (a sibling of the content-section mirrors), so the URL the
 * index emits resolves to a real raw markdown file that check-links can verify.
 *
 * @returns {Promise<{ key: string, title: string, pages: Array<{ title: string,
 *   description: string, mirror: string, url: string, markdown: string, source: string }> }>}
 */
export async function buildExamplesLlmsSection({ repoRootPath }) {
  const manifests = [...EXAMPLES, ...LLMS_ONLY_EXAMPLES];
  const pages = [];
  for (const manifest of manifests) {
    const sources = await loadExampleSources(manifest, { repoRootPath });
    const blocks = sources.map((file) => {
      const lang = file.name.endsWith('.tsx') ? 'tsx' : file.name.endsWith('.mjs') ? 'js' : 'ts';
      return `\`\`\`${lang} title="${file.repoPath}"\n${file.code.trimEnd()}\n\`\`\``;
    });
    const body = [
      manifest.blurb,
      '',
      `Runnable Kovo example app under \`${manifest.dir}\`. The authored source below shows what it demonstrates — the components, queries, mutations, and derived optimism that drive it (lowered IR / generated components are artifacts, not authored; SPEC §5.2).`,
      '',
      ...blocks,
    ].join('\n');

    pages.push({
      title: manifest.title,
      description: manifest.blurb,
      mirror: `/examples/${manifest.name}.md`,
      url: manifest.url ?? `/examples/${manifest.name}/`,
      markdown: body,
      source: body,
    });
  }

  return { key: 'examples', title: 'Examples', pages };
}

/** The docs-site base path used when an example opts into a static export. */
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
  const serviceUrl = href || manifest.serviceUrl;
  return serviceUrl ? serviceUrl.replace(/\/?$/, '/') : undefined;
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
 * Build one static example into the docs `dist/` under its app base, then
 * re-root absolute refs so it runs from there.
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
  for (const source of manifest.sources) {
    const relative = typeof source === 'string' ? source : source.path;
    const absolute =
      typeof source === 'string'
        ? path.join(exampleRoot, relative)
        : path.join(repoRootPath, relative);
    const repoPath = path.relative(repoRootPath, absolute);
    files.push({
      code: await readFile(absolute, 'utf8'),
      name: typeof source === 'string' ? relative : (source.name ?? repoPath),
      repoPath,
    });
  }
  return files;
}

/**
 * Two-pane example page: a sandboxed <iframe> running the demo on the left, a
 * zero-JS tabbed source viewer on the right. Tabs are CSS-only (radio inputs
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
