import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Site-local content pipeline (SPEC §9.5 docs export is a real Kovo app; the
// markdown → HTML step is build tooling, not framework surface). The app's
// routes compose this rendered content as ordinary render-time string children
// (the server JSX runtime inserts child strings verbatim), so prose lives at
// the route/server boundary while chrome stays idiomatic TSX components.
//
// The heavy, toolchain-driven inputs (captures, tutorial snippets, generated
// API/diagnostics markdown) are produced by scripts/content-pipeline.mjs and
// read here as plain data, so SSR render and static export never run the
// compiler/CLI themselves.

import { parseFrontmatter, renderMarkdown } from '../scripts/md.mjs';
import { loadTutorialSnippets, substituteSnippets } from '../tutorial/extract-snippets.mjs';
import { galleryComponentCatalog } from '../../examples/gallery/src/component-catalog.js';
import { EXAMPLES, LLMS_ONLY_EXAMPLES } from '../scripts/examples.mjs';

import { clientHrefs } from './client/modules.js';

const copyHref = `${clientHrefs.code}#copy`;

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const genDir = path.join(siteRoot, 'gen');

export interface DocPage {
  /** API-reference pages carry their generated sidebar manifest so the route can
   * render the category-grouped API navigation instead of the flat heading TOC. */
  apiSidebar?: ApiSidebar;
  body: string;
  description: string;
  headings: Heading[];
  html: string;
  /** Markdown body with build-time captures + snippets substituted (for llms-full). */
  markdown: string;
  mirror: string;
  order: number;
  slug: string;
  source: string;
  text: string;
  title: string;
  url: string;
}

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface DocSection {
  key: string;
  pages: DocPage[];
  title: string;
}

export interface ApiSidebarSymbol {
  anchor: string;
  documented: boolean;
  kind: string;
  name: string;
  sourceHref: string;
}

export interface ApiSidebarCategory {
  anchor: string;
  symbols: ApiSidebarSymbol[];
  title: string;
}

export interface ApiSidebarSubpath {
  categories: ApiSidebarCategory[];
  importPath: string;
  sourceHref: string;
  title: string;
}

/** Structured API navigation for a generated reference page, produced by
 * `api-ref.mjs` (`gen/api/<slug>.sidebar.json`) and consumed by the `ApiSidebar`
 * component so the right rail can group symbols by subpath/category with counts,
 * source links, and scroll-spy — instead of a flat 200-item heading list. */
export interface ApiSidebar {
  package: string;
  slug: string;
  subpaths: ApiSidebarSubpath[];
}

export interface NavLink {
  title: string;
  url: string;
}

export interface NavGroup {
  /** Section key (docs/tutorial/guides/api/reference/components/examples). Drives
   * the context-dependent sidebar split: "learn" sections group together, the
   * rest group together, so a reader only sees the family they're browsing. */
  key: string;
  pages: NavLink[];
  title: string;
}

export interface SearchEntry {
  /** Symbol kind for API-symbol entries (function/type/const); absent for page
   * entries. Lets the ⌘K result list show a kind badge and deep-link to the
   * symbol anchor. */
  kind?: string;
  section: string;
  text: string;
  title: string;
  url: string;
}

export interface SpecContent {
  html: string;
  ids: Set<string>;
  source: string;
  text: string;
}

export interface SiteContent {
  groups: NavGroup[];
  loaderGzipBytes: number;
  search: SearchEntry[];
  sections: DocSection[];
  spec: SpecContent;
}

const SECTIONS = [
  { dir: 'content/docs', key: 'docs', title: 'Getting Started' },
  { dir: 'content/tutorial', key: 'tutorial', title: 'Tutorial' },
  { dir: 'content/guides', key: 'guides', title: 'Guides' },
  { dir: 'content/evidence', key: 'evidence', title: 'Evidence & Design Notes' },
  { dir: 'gen/api', key: 'api', title: 'API Reference' },
  { dir: 'gen/reference', key: 'reference', title: 'Reference' },
] as const;

export const SECTION_INTROS: Record<string, string> = {
  api: 'Generated reference for every public package — types, functions, and the contracts they keep.',
  components:
    'Rendered component fixtures covering the headless primitive contracts and the styled UI package.',
  docs: 'Install Kovo, absorb the mental model, and find your way around a project.',
  examples:
    'Complete Kovo apps you can run in the browser, embedded beside the authored source that renders them.',
  evidence:
    'Curated design notes and verification references promoted from the repository docs corpus.',
  guides: 'Task-focused deep dives into each part of the framework, from queries to deployment.',
  reference:
    'Everything generated from the framework itself — the per-package API reference, the diagnostics catalog, and the normative specification.',
  tutorial:
    'Build a real e-commerce app in eight chapters — catalog, cart, optimistic updates, streaming, and a behavior graph your CI can check.',
};

function readJsonIfPresent<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Content pages embed build-time captures with {{capture:name}} — produced by
 * the real toolchain in content-pipeline.mjs (W3 doctrine). Unknown names throw
 * so embedded compiler/CLI output cannot silently drift. */
function substituteCaptures(body: string, captures: Record<string, string>): string {
  return body.replace(/\{\{capture:([a-z-]+)\}\}/g, (_match, name: string) => {
    const value = captures[name];
    if (value === undefined) throw new Error(`content: unknown capture "${name}"`);
    return value;
  });
}

/** SPEC subsections like "**13.1 CSS.**" are bold paragraphs, not headings —
 * stamp them with number-derived ids so § citations resolve. */
function stampSpecParagraphIds(html: string): string {
  return html.replace(
    /<p><strong>(\d+(?:\.\d+)*)/g,
    (_match, number: string) => `<p id="${number.replaceAll('.', '-')}"><strong>${number}`,
  );
}

/** Rewrite /spec/# citations whose exact anchor doesn't exist to the nearest
 * enclosing section that does (e.g. #16-1 → #16). */
function resolveSpecAnchors(html: string, specIds: Set<string>): string {
  return html.replace(/href="\/spec\/#([0-9-]+)"/g, (_match, anchor: string) => {
    let candidate = anchor;
    while (candidate && !specIds.has(candidate)) {
      candidate = candidate.includes('-') ? candidate.slice(0, candidate.lastIndexOf('-')) : '';
    }
    return `href="/spec/${candidate ? `#${candidate}` : ''}"`;
  });
}

interface RawPage {
  body: string;
  description: string;
  mirror: string;
  order: number;
  slug: string;
  source: string;
  title: string;
  url: string;
}

function loadSectionFiles(section: { dir: string; key: string; title: string }): RawPage[] {
  const directory = path.join(siteRoot, section.dir);
  if (!existsSync(directory)) return [];

  const pages: RawPage[] = [];
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.md')) continue;
    const source = readFileSync(path.join(directory, file), 'utf8');
    const { body, data } = parseFrontmatter(source) as {
      body: string;
      data: Record<string, string | number>;
    };
    const slug = (data.slug as string) ?? file.replace(/\.md$/, '');
    pages.push({
      body,
      description: (data.description as string) ?? '',
      mirror: `/${section.key}/${slug}.md`,
      order: (data.order as number) ?? 999,
      slug,
      source,
      title: (data.title as string) ?? slug,
      url: `/${section.key}/${slug}/`,
    });
  }

  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return pages;
}

let cached: Promise<SiteContent> | undefined;

/** Load + render the full content corpus once. Cached so SSR render, static
 * export, and the search/llms emitters all share one pass. */
export function loadSiteContent(): Promise<SiteContent> {
  cached ??= buildSiteContent();
  return cached;
}

async function buildSiteContent(): Promise<SiteContent> {
  const captures = readJsonIfPresent<Record<string, string>>(
    path.join(genDir, 'captures.json'),
    {},
  );
  // Snippets are pure file extraction (no toolchain), so read them directly.
  const snippets = loadTutorialSnippets() as Map<string, { code: string; lang: string }>;

  // Spec first so every page's § citations resolve against its real anchors.
  const specSource = readFileSync(path.join(repoRoot, 'SPEC.md'), 'utf8');
  const specRendered = (await renderMarkdown(specSource, { anchorStyle: 'spec', copyHref })) as {
    headings: Heading[];
    html: string;
    text: string;
  };
  const specHtml = stampSpecParagraphIds(specRendered.html);
  const specIds = new Set<string>([
    ...specRendered.headings.map((heading) => heading.id),
    ...[...specHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] as string),
  ]);
  const finish = (html: string): string => resolveSpecAnchors(html, specIds);

  const sections: DocSection[] = [];
  const search: SearchEntry[] = [];

  for (const section of SECTIONS) {
    const rawPages = loadSectionFiles(section);
    const pages: DocPage[] = [];
    for (const raw of rawPages) {
      const substituted = substituteSnippets(
        substituteCaptures(raw.body, captures),
        snippets,
      ) as string;
      const rendered = (await renderMarkdown(substituted, { copyHref })) as {
        headings: Heading[];
        html: string;
        text: string;
        title: string;
      };
      const html = finish(rendered.html);
      // API pages carry their generated sidebar manifest, used both for the
      // category-grouped navigation and for per-symbol search entries.
      const apiSidebar =
        section.key === 'api'
          ? readJsonIfPresent<ApiSidebar | undefined>(
              path.join(genDir, 'api', `${raw.slug}.sidebar.json`),
              undefined,
            )
          : undefined;
      pages.push({
        ...(apiSidebar ? { apiSidebar } : {}),
        body: raw.body,
        description: raw.description,
        headings: rendered.headings,
        html,
        markdown: substituted,
        mirror: raw.mirror,
        order: raw.order,
        slug: raw.slug,
        source: substituteSnippets(raw.source, snippets) as string,
        text: rendered.text,
        title: raw.title || rendered.title,
        url: raw.url,
      });
      search.push({
        section: section.title,
        text: `${rendered.headings.map((heading) => heading.text).join(' ')} ${rendered.text}`.slice(
          0,
          6000,
        ),
        title: raw.title || rendered.title,
        url: raw.url,
      });
      // One search entry per documented API symbol, deep-linked to its anchor so
      // ⌘K lands directly on the symbol rather than the package page top.
      if (apiSidebar) {
        for (const subpath of apiSidebar.subpaths) {
          for (const category of subpath.categories) {
            for (const symbol of category.symbols) {
              search.push({
                kind: symbol.kind,
                section: `${subpath.importPath} · ${category.title}`,
                text: `${symbol.name} ${subpath.importPath} ${apiSidebar.package} ${symbol.kind}`,
                title: symbol.name,
                url: `${raw.url}#${symbol.anchor}`,
              });
            }
          }
        }
      }
    }
    sections.push({ key: section.key, pages, title: section.title });
  }

  search.push({
    section: 'Specification',
    text: specRendered.text.slice(0, 6000),
    title: 'Kovo Specification',
    url: '/spec/',
  });
  search.push(...componentSearchEntries(), ...exampleSearchEntries());

  return {
    groups: navGroups(sections),
    loaderGzipBytes: Number(captures['loader-gzip-bytes'] ?? 0),
    search,
    sections,
    spec: { html: finish(specHtml), ids: specIds, source: specSource, text: specRendered.text },
  };
}

/** Global sidebar groups: every content section plus the Components + Examples
 * section landings (their per-page lists are owned by those route modules). Each
 * group carries its section `key` so the chrome can split the sidebar by family. */
function navGroups(sections: DocSection[]): NavGroup[] {
  const groups: NavGroup[] = sections
    .filter((section) => section.pages.length > 0)
    .map((section) => ({
      key: section.key,
      pages: section.pages.map((page) => ({ title: page.title, url: page.url })),
      title: section.title,
    }));
  groups.push({
    key: 'components',
    pages: [
      { title: 'Components', url: '/components/' },
      ...galleryComponentCatalog.map((entry) => ({
        title: entry.title,
        url: `/components/${entry.component}/`,
      })),
    ],
    title: 'Components',
  });
  groups.push({
    key: 'examples',
    pages: [
      { title: 'Examples', url: '/examples/' },
      ...(EXAMPLES as ExampleSearchManifest[]).map((example) => ({
        title: example.title,
        url: `/examples/${example.name}/`,
      })),
    ],
    title: 'Examples',
  });
  return groups;
}

interface ExampleSearchManifest {
  blurb: string;
  name: string;
  title: string;
}

function componentSearchEntries(): SearchEntry[] {
  return galleryComponentCatalog.map((entry) => ({
    section: 'Components',
    text: [
      entry.title,
      entry.component,
      entry.summary,
      `@kovojs/ui/${entry.component}`,
      `kovo add ${entry.component}`,
      `packages/ui/src/${entry.component}.tsx`,
      `examples/gallery/src/interactive/${entry.component}-demo.tsx`,
    ].join(' '),
    title: entry.title,
    url: `/components/${entry.component}/`,
  }));
}

function exampleSearchEntries(): SearchEntry[] {
  const humanExamples = EXAMPLES as ExampleSearchManifest[];
  const agentExamples = LLMS_ONLY_EXAMPLES as ExampleSearchManifest[];
  return [
    ...humanExamples.map((example) => exampleSearchEntry(example, `/examples/${example.name}/`)),
    ...agentExamples.map((example) =>
      exampleSearchEntry(
        example,
        example.name === 'devtool'
          ? '/guides/dataflow-devtool/'
          : example.name === 'reference'
            ? '/guides/auth-better-auth/'
            : `/examples/${example.name}/`,
      ),
    ),
  ];
}

function exampleSearchEntry(example: ExampleSearchManifest, url: string): SearchEntry {
  return {
    section: 'Examples',
    text: [
      example.title,
      example.name,
      example.blurb,
      url,
      example.name === 'reference' ? 'Better Auth security auth csrf session guards' : '',
      example.name === 'devtool' ? 'dataflow MCP kovo_explain graph devtool' : '',
    ].join(' '),
    title: example.title,
    url,
  };
}
