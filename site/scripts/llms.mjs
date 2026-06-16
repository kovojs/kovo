/**
 * Agent layer (plan: agent layer). Generates the two llms.txt-convention files
 * from the same sources the human pages render from:
 *
 *   llms.txt       — an index: project name, one-line description, then a
 *                    section per content group listing each page as
 *                    `- [Title](url): description`. Links point at the raw .md
 *                    mirrors build.mjs writes, so check-links.mjs can verify them.
 *   llms-full.txt  — the full corpus: every docs/guides/tutorial/API/reference
 *                    page concatenated into one agent-ingestible markdown file,
 *                    each preceded by `# <title>` and its canonical URL, plus
 *                    the normative SPEC.md.
 *
 * One source feeds both files and the human pages (plan "one source feeds
 * both"). Output is deterministic: no timestamps, no absolute paths.
 */

const PROJECT_NAME = 'Kovo';
const TAGLINE = [
  '> The TypeScript web framework where agents get build-time errors and users get instant pages.',
  '> Server-rendered MPA, zero hydration, statically verifiable end-to-end.',
];

function sectionsWithPages(sections) {
  return sections.filter((section) => section.pages.length > 0);
}

/**
 * llms.txt index. `sections` are the loaded content sections (each with
 * `title` and `pages` carrying `title`/`description`/`mirror`). `origin` is the
 * site origin so links are absolute; `specMirror` is the raw spec URL path.
 *
 * @param {ReadonlyArray<{ title: string; pages: ReadonlyArray<{ title: string; description?: string; mirror: string }> }>} sections
 * @param {{ origin: string; specMirror?: string }} [options]
 */
export function buildLlmsIndex(sections, { origin, specMirror = '/spec.md' } = {}) {
  return [
    `# ${PROJECT_NAME}`,
    '',
    ...TAGLINE,
    '',
    'Every documentation page is available as raw markdown at the URLs below.',
    `The full corpus for ingestion is at ${origin}/llms-full.txt`,
    `The normative specification is at ${origin}${specMirror}`,
    '',
    ...sectionsWithPages(sections).flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.pages.map(
        (page) =>
          `- [${page.title}](${origin}${page.mirror})${page.description ? `: ${page.description}` : ''}`,
      ),
      '',
    ]),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}

/**
 * llms-full.txt corpus. `renderBody(page)` returns the page's markdown body
 * with build-time snippets/captures substituted (owned by build.mjs, which
 * holds the captures and snippets); `spec` is { title, url, body } for the
 * normative SPEC.md appended at the end. `origin` makes the per-page URLs
 * absolute.
 */
export function buildLlmsFull(sections, { origin, renderBody, spec } = {}) {
  const parts = [
    `# ${PROJECT_NAME} — full documentation`,
    '',
    ...TAGLINE,
    '',
    `This file concatenates every documentation page for agent ingestion. Each page is preceded by its title and canonical URL. The normative specification follows the docs. Source: ${origin}/`,
    '',
  ];

  for (const section of sectionsWithPages(sections)) {
    for (const page of section.pages) {
      parts.push(
        '---',
        '',
        `# ${page.title}`,
        '',
        `URL: ${origin}${page.url}`,
        page.description ? `\n${page.description}\n` : '',
        renderBody(page).trim(),
        '',
      );
    }
  }

  if (spec) {
    parts.push(
      '---',
      '',
      `# ${spec.title}`,
      '',
      `URL: ${origin}${spec.url}`,
      '',
      spec.body.trim(),
      '',
    );
  }

  return `${parts
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trimEnd()}\n`;
}
