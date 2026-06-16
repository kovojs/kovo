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

// @ts-expect-error - site-local .mjs build tooling, no type declarations.
import { parseFrontmatter, renderMarkdown } from '../scripts/md.mjs';
// @ts-expect-error - site-local .mjs build tooling, no type declarations.
import { loadTutorialSnippets, substituteSnippets } from '../tutorial/extract-snippets.mjs';

import { clientHrefs } from './client/modules.js';

const copyHref = `${clientHrefs.code}#copy`;

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const genDir = path.join(siteRoot, 'gen');

export interface DocPage {
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

export interface NavLink {
  title: string;
  url: string;
}

export interface NavGroup {
  pages: NavLink[];
  title: string;
}

export interface SearchEntry {
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
  { dir: 'gen/api', key: 'api', title: 'API Reference' },
  { dir: 'gen/reference', key: 'reference', title: 'Reference' },
] as const;

export const SECTION_INTROS: Record<string, string> = {
  api: 'Generated reference for every public package — types, functions, and the contracts they keep.',
  docs: 'Install Kovo, absorb the mental model, and find your way around a project.',
  examples:
    'Complete Kovo apps you can run in the browser, embedded beside the authored source that renders them.',
  gallery:
    'Rendered component fixtures covering the headless primitive contracts and the styled UI package.',
  guides: 'Task-focused deep dives into each part of the framework, from queries to deployment.',
  reference:
    'Generated catalogs for agents and humans — every framework diagnostic and its fix, kept in sync with the registry.',
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
      pages.push({
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
    }
    sections.push({ key: section.key, pages, title: section.title });
  }

  search.push({
    section: 'Specification',
    text: specRendered.text.slice(0, 6000),
    title: 'Kovo Specification',
    url: '/spec/',
  });

  return {
    groups: navGroups(sections),
    loaderGzipBytes: Number(captures['loader-gzip-bytes'] ?? 0),
    search,
    sections,
    spec: { html: finish(specHtml), ids: specIds, source: specSource, text: specRendered.text },
  };
}

/** Global sidebar groups: every content section plus the Gallery + Examples
 * section landings (their per-page lists are owned by those route modules). */
function navGroups(sections: DocSection[]): NavGroup[] {
  const groups: NavGroup[] = sections
    .filter((section) => section.pages.length > 0)
    .map((section) => ({
      pages: section.pages.map((page) => ({ title: page.title, url: page.url })),
      title: section.title,
    }));
  groups.push({ pages: [{ title: 'Gallery', url: '/gallery/' }], title: 'Gallery' });
  groups.push({ pages: [{ title: 'Examples', url: '/examples/' }], title: 'Examples' });
  return groups;
}
