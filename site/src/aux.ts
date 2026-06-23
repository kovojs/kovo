import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '@kovojs/server';

import { siteStaticExportApp } from './app.js';
import { loadSiteContent } from './content.js';

// Agent + static-host surface emitted alongside the replayed route documents:
//   - search-index.json  the ⌘K search island's corpus (W8)
//   - <section>/<slug>.md raw markdown mirrors (snippets substituted)
//   - spec.md            the normative spec, verbatim
//   - llms.txt           llms.txt-convention index over the mirrors
//   - llms-full.txt      the whole corpus for ingestion
//   - 404.html           the app's own themed not-found document
// All come from the one content pass, so they cannot drift from the human pages.

import { buildExamplesLlmsSection } from '../scripts/examples.mjs';
import { buildLlmsFull, buildLlmsIndex } from '../scripts/llms.mjs';

import { buildGalleryLlmsSection } from './gallery-llms.js';

const SITE_ORIGIN = 'https://kovo.sh';

// scripts/examples.mjs lives at site/scripts/; the repo root is two levels up
// (matching src/examples.ts and build.mjs).
const repoRootPath = fileURLToPath(new URL('../../', import.meta.url));

export async function emitAuxOutputs(outDir: string): Promise<void> {
  const content = await loadSiteContent();

  // Synthetic Examples section so the agent layer surfaces the runnable example
  // apps (otherwise a bespoke human-only route family invisible to llms.txt).
  const examplesSection = await buildExamplesLlmsSection({ repoRootPath });
  // Components before Examples to match the human sidebar order (content.ts navGroups).
  const gallerySection = buildGalleryLlmsSection(SITE_ORIGIN);
  const syntheticSections = [gallerySection, examplesSection];
  const sections = [...content.sections, ...syntheticSections];

  // Search index.
  await writeFile(path.join(outDir, 'search-index.json'), JSON.stringify(content.search), 'utf8');

  // Raw markdown mirrors (the agent surface llms.txt links to).
  for (const section of sections) {
    for (const page of section.pages) {
      const target = path.join(outDir, page.mirror.replace(/^\//, ''));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, page.source, 'utf8');
    }
  }
  await writeFile(path.join(outDir, 'spec.md'), content.spec.source, 'utf8');

  // llms.txt + llms-full.txt — one source feeds both and the human pages.
  await writeFile(
    path.join(outDir, 'llms.txt'),
    buildLlmsIndex(sections, { origin: SITE_ORIGIN, specMirror: '/spec.md' }),
    'utf8',
  );
  await writeFile(
    path.join(outDir, 'llms-full.txt'),
    buildLlmsFull(sections, {
      origin: SITE_ORIGIN,
      renderBody: (page: { markdown: string }) => page.markdown,
      spec: { body: content.spec.source, title: 'Kovo Specification', url: '/spec/' },
    }),
    'utf8',
  );

  // 404 for static hosts — the app's own not-found document (loader + theme +
  // chrome), so a missing path looks like the rest of the site.
  const handler = createRequestHandler(siteStaticExportApp);
  const response = await handler(new Request(`${SITE_ORIGIN}/__not_found__`));
  await writeFile(path.join(outDir, '404.html'), await response.text(), 'utf8');
}
