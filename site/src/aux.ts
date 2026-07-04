import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '@kovojs/server';
import { bundledKovoRulesSource } from '@kovojs/core/internal/agent-docs';

import { siteStaticExportApp } from './app.js';
import { loadSiteContent } from './content.js';

// Agent + static-host surface emitted alongside the replayed route documents:
//   - search-index.json  the ⌘K search island's corpus (W8)
//   - <section>/<slug>.md raw markdown mirrors (snippets substituted)
//   - spec.md            the normative spec corpus (SPEC.md + spec/*.md)
//   - kovo-rules.md      the condensed app-local AGENTS.md rules block body
//   - llms.txt           llms.txt-convention index over the mirrors
//   - llms-full.txt      the whole corpus for ingestion
//   - 404.html           the app's own themed not-found document
// All come from the one content pass, so they cannot drift from the human pages.

import { buildExamplesLlmsSection } from '../scripts/examples.mjs';
import { buildLlmsFull, buildLlmsIndex, buildLlmsTier } from '../scripts/llms.mjs';

import { buildGalleryLlmsSection } from './gallery-llms.js';
import { injectMarkdownAlternateLink } from './document-template.js';

const SITE_ORIGIN = 'https://kovo.sh';

// scripts/examples.mjs lives at site/scripts/; the repo root is two levels up
// (matching src/examples.ts and build.mjs).
const repoRootPath = fileURLToPath(new URL('../../', import.meta.url));
const rootPackagePath = path.join(repoRootPath, 'package.json');

interface MirrorPage {
  mirror: string;
  url: string;
}

export async function emitAuxOutputs(outDir: string): Promise<void> {
  const { content, sections } = await loadAgentSections();
  const version = await docsVersionStamp();

  // Search index.
  await writeFile(path.join(outDir, 'search-index.json'), JSON.stringify(content.search), 'utf8');

  await writeMarkdownMirrors(outDir, sections, content.spec.source);
  await writeFile(path.join(outDir, 'kovo-rules.md'), bundledKovoRulesSource(), 'utf8');

  // llms.txt + llms-full.txt + smaller tiers — one source feeds every agent corpus and
  // the human pages. The version is an explicit build input: the emitter reads package
  // metadata and CI-provided commit env, while llms.mjs remains deterministic and never
  // shells out to git.
  const tierInputs = [
    {
      path: '/llms-guides.txt',
      sections: sections.filter((section) =>
        ['getting-started', 'tutorial', 'guides'].includes(section.key),
      ),
      title: 'Guides, getting started, and tutorial',
    },
    {
      path: '/llms-api.txt',
      sections: sections.filter((section) => ['api', 'reference'].includes(section.key)),
      title: 'API and reference',
    },
  ];
  const tiers = tierInputs.map((tier) => {
    const body = buildLlmsTier(tier.sections, {
      origin: SITE_ORIGIN,
      renderBody: (page: { markdown: string }) => page.markdown,
      title: tier.title,
      version,
    });
    return { ...tier, body, bytes: Buffer.byteLength(body, 'utf8') };
  });
  for (const tier of tiers) {
    await writeFile(path.join(outDir, tier.path.replace(/^\//, '')), tier.body, 'utf8');
  }
  await writeFile(
    path.join(outDir, 'llms.txt'),
    buildLlmsIndex(sections, {
      origin: SITE_ORIGIN,
      specMirror: '/spec.md',
      tiers: tiers.map(({ bytes, path, title }) => ({ bytes, path, title })),
      version,
    }),
    'utf8',
  );
  await writeFile(
    path.join(outDir, 'llms-full.txt'),
    buildLlmsFull(sections, {
      origin: SITE_ORIGIN,
      renderBody: (page: { markdown: string }) => page.markdown,
      spec: { body: content.spec.source, title: 'Kovo Specification', url: '/spec/' },
      version,
    }),
    'utf8',
  );
  await writeFile(path.join(outDir, '_headers'), buildHeadersFile(), 'utf8');
  await writeFile(path.join(outDir, 'robots.txt'), buildRobotsTxt(), 'utf8');
  await writeFile(path.join(outDir, 'sitemap.xml'), buildSitemapXml(sections), 'utf8');
  await injectMarkdownAlternateLinks(outDir, [
    ...sections.flatMap((section) =>
      section.pages.map((page) => ({ mirror: page.mirror, url: page.url })),
    ),
    { mirror: '/spec.md', url: '/spec/' },
  ]);

  // 404 for static hosts — the app's own not-found document (loader + theme +
  // chrome), so a missing path looks like the rest of the site.
  const handler = createRequestHandler(siteStaticExportApp);
  const response = await handler(new Request(`${SITE_ORIGIN}/__not_found__`));
  await writeFile(path.join(outDir, '404.html'), await response.text(), 'utf8');
}

export async function stageMarkdownMirrorPublicAssets(outDir: string): Promise<void> {
  const { content, sections } = await loadAgentSections();
  await writeMarkdownMirrors(outDir, sections, content.spec.source);
}

async function loadAgentSections() {
  const content = await loadSiteContent();

  // Synthetic Examples section so the agent layer surfaces the runnable example
  // apps (otherwise a bespoke human-only route family invisible to llms.txt).
  const examplesSection = await buildExamplesLlmsSection({ repoRootPath });
  // Components before Examples to match the human sidebar order (content.ts navGroups).
  const gallerySection = buildGalleryLlmsSection(SITE_ORIGIN);
  return { content, sections: [...content.sections, gallerySection, examplesSection] };
}

async function writeMarkdownMirrors(
  outDir: string,
  sections: readonly { pages: readonly { mirror: string; source: string }[] }[],
  specSource: string,
) {
  for (const section of sections) {
    for (const page of section.pages) {
      const target = path.join(outDir, page.mirror.replace(/^\//, ''));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, page.source, 'utf8');
    }
  }
  await writeFile(path.join(outDir, 'spec.md'), specSource, 'utf8');
}

async function docsVersionStamp(): Promise<string> {
  const manifest = JSON.parse(await readFile(rootPackagePath, 'utf8')) as { version?: string };
  const version = manifest.version ?? '0.0.0';
  // CI passes one of these values; local builds deliberately fall back to `unknown`
  // instead of reading git here, preserving deterministic llms builders in tests.
  const commit = process.env.KOVO_DOCS_COMMIT || process.env.GITHUB_SHA || 'unknown';
  return `@kovojs ${version} (${commit})`;
}

function buildHeadersFile(): string {
  return `${[
    '/llms*.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '  X-Content-Type-Options: nosniff',
    '  Cache-Control: public, max-age=300, must-revalidate',
    '/spec.md',
    '  Content-Type: text/markdown; charset=utf-8',
    '  X-Content-Type-Options: nosniff',
    '  Cache-Control: public, max-age=300, must-revalidate',
    '/**/*.md',
    '  Content-Type: text/markdown; charset=utf-8',
    '  X-Content-Type-Options: nosniff',
    '  Cache-Control: public, max-age=300, must-revalidate',
    '',
  ].join('\n')}`;
}

function buildRobotsTxt(): string {
  return `${[
    'User-agent: *',
    'Allow: /',
    '# Agent-readable docs index: https://kovo.sh/llms.txt',
    '# Full agent corpus: https://kovo.sh/llms-full.txt',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n')}`;
}

function buildSitemapXml(sections: readonly { key: string; pages: readonly { url: string }[] }[]) {
  const paths = new Set<string>(['/']);
  for (const section of sections) {
    paths.add(`/${section.key}/`);
    for (const page of section.pages) paths.add(page.url);
  }
  paths.add('/reference/');
  paths.add('/spec/');

  const urls = [...paths].sort((left, right) => left.localeCompare(right));
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${SITE_ORIGIN}${url}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')}`;
}

async function injectMarkdownAlternateLinks(outDir: string, pages: readonly MirrorPage[]) {
  for (const page of pages) {
    const target = path.join(outDir, routeDocumentPath(page.url));
    let html: string;
    try {
      html = await readFile(target, 'utf8');
    } catch {
      continue;
    }
    await writeFile(target, injectMarkdownAlternateLink(html, page.mirror), 'utf8');
  }
}

function routeDocumentPath(url: string): string {
  const clean = url.replace(/^\/+/, '');
  if (clean === '') return 'index.html';
  return path.join(clean, 'index.html');
}
