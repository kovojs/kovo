export const kovoRulesBeginMarker = '<!-- BEGIN:kovo-rules -->';
export const kovoRulesEndMarker = '<!-- END:kovo-rules -->';
export const defaultKovoRulesSource = './.kovo/docs/kovo-rules.md';

export interface KovoDocsMirrorFile {
  path: string;
  source: string;
}

export interface KovoDocsMirrorRemote {
  path: string;
  url: string;
}

interface KovoRulesTocSection {
  title: string;
  entries: readonly KovoRulesTocEntry[];
}

interface KovoRulesTocEntry {
  title: string;
  path: string;
}

export const kovoRulesTocSections: readonly KovoRulesTocSection[] = [
  {
    title: 'Getting Started',
    entries: [
      { title: 'Why Kovo?', path: 'docs/why-kovo.md' },
      { title: 'Quickstart', path: 'docs/quickstart.md' },
      { title: 'Thinking in Kovo', path: 'docs/mental-model.md' },
      { title: 'Installation', path: 'docs/installation.md' },
      { title: 'Project structure', path: 'docs/project-structure.md' },
      { title: 'Stability & Versioning', path: 'docs/stability.md' },
    ],
  },
  {
    title: 'Tutorial',
    entries: [
      { title: '1. Scaffold & the first page', path: 'tutorial/01-first-page.md' },
      { title: '2. Components & islands', path: 'tutorial/02-islands.md' },
      { title: '3. Queries & data binding', path: 'tutorial/03-queries.md' },
      { title: '4. Mutations & forms', path: 'tutorial/04-mutations.md' },
      { title: '5. Invalidation & optimistic updates', path: 'tutorial/05-optimistic.md' },
      { title: '6. Streaming & defer', path: 'tutorial/06-streaming.md' },
      { title: '7. Testing & verification', path: 'tutorial/07-verification.md' },
      { title: '8. Wrap-up & deploy', path: 'tutorial/08-wrap-up.md' },
    ],
  },
  {
    title: 'Guides',
    entries: [
      { title: 'Routing & navigation', path: 'guides/routing.md' },
      { title: 'Layouts', path: 'guides/layouts.md' },
      { title: 'Queries & invalidation', path: 'guides/queries.md' },
      { title: 'Live queries', path: 'guides/live-queries.md' },
      { title: 'Domains, writes & data access', path: 'guides/data-layer.md' },
      { title: 'Mutations & forms', path: 'guides/mutations.md' },
      { title: 'Security & authorization', path: 'guides/security.md' },
      { title: 'Better Auth integration', path: 'guides/auth-better-auth.md' },
      { title: 'Optimistic updates', path: 'guides/optimistic.md' },
      { title: 'Interactive islands & client state', path: 'guides/islands.md' },
      { title: 'Styling with StyleX', path: 'guides/styling.md' },
      { title: 'Request shell', path: 'guides/request-shell.md' },
      { title: 'Endpoints & webhooks', path: 'guides/endpoints-webhooks.md' },
      { title: 'Deployment', path: 'guides/deployment.md' },
      { title: 'Static export', path: 'guides/static-export.md' },
      { title: 'Testing with @kovojs/test', path: 'guides/testing.md' },
      { title: 'Dataflow devtool', path: 'guides/dataflow-devtool.md' },
      { title: 'The kovo & vp CLIs', path: 'guides/cli.md' },
      { title: 'Reading kovo check & kovo explain', path: 'guides/kovo-explain.md' },
      { title: 'Streaming & defer', path: 'guides/streaming.md' },
      { title: 'Compiler internals', path: 'guides/compiler-internals.md' },
      { title: 'Accessibility', path: 'guides/accessibility.md' },
      { title: 'Components & copy-in UI', path: 'guides/components.md' },
    ],
  },
  {
    title: 'API Reference',
    entries: [
      { title: '@kovojs/core', path: 'api/core.md' },
      { title: '@kovojs/icons', path: 'api/icons.md' },
      { title: '@kovojs/server', path: 'api/server.md' },
      { title: '@kovojs/browser', path: 'api/browser.md' },
      { title: '@kovojs/test', path: 'api/test.md' },
      { title: '@kovojs/drizzle', path: 'api/drizzle.md' },
      { title: '@kovojs/headless-ui', path: 'api/headless-ui.md' },
      { title: '@kovojs/style', path: 'api/style.md' },
      { title: '@kovojs/better-auth', path: 'api/better-auth.md' },
      { title: '@kovojs/ui', path: 'api/ui.md' },
      { title: '@kovojs/cli', path: 'api/cli.md' },
      { title: 'create-kovo', path: 'api/create-kovo.md' },
    ],
  },
  {
    title: 'Reference',
    entries: [{ title: 'Diagnostics', path: 'reference/diagnostics.md' }],
  },
];

const additionalMirrorDocs: readonly KovoDocsMirrorRemote[] = [
  { path: 'llms.txt', url: 'https://kovo.sh/llms.txt' },
  { path: 'llms-full.txt', url: 'https://kovo.sh/llms-full.txt' },
  { path: 'spec.md', url: 'https://kovo.sh/spec.md' },
];

export const kovoDocsMirrorRemotes: readonly KovoDocsMirrorRemote[] = [
  { path: 'kovo-rules.md', url: 'https://kovo.sh/kovo-rules.md' },
  ...additionalMirrorDocs,
  ...kovoRulesTocSections.flatMap((section) =>
    section.entries.map((entry) => ({ path: entry.path, url: `https://kovo.sh/${entry.path}` })),
  ),
];

export function bundledKovoRulesSource(): string {
  return [
    '# Kovo Docs',
    '',
    '## Commands',
    '',
    '- `kovo check`: verify the app graph and framework invariants.',
    '- `kovo explain <target>`: inspect routes, mutations, queries, guards, layouts, and graph edges.',
    '- `kovo update-docs`: refresh this block and the local docs mirror at `./.kovo/docs/`.',
    '',
    '## Read First',
    '',
    'Read the local docs below before changing Kovo framework code or app structure.',
    '',
    '## Table Of Contents',
    '',
    '- Spec: `./.kovo/docs/spec.md`',
    ...kovoRulesTocSections.flatMap((section) => [
      '',
      `### ${section.title}`,
      '',
      ...section.entries.map((entry) => `- ${entry.title}: \`./.kovo/docs/${entry.path}\``),
    ]),
    '',
  ].join('\n');
}

export function renderKovoRulesBlock({
  rulesSource = bundledKovoRulesSource(),
  source = defaultKovoRulesSource,
  version,
}: {
  rulesSource?: string;
  source?: string;
  version: string;
}): string {
  return [
    kovoRulesBeginMarker,
    `<!-- kovo-rules-version: ${version} -->`,
    `<!-- kovo-rules-source: ${source} -->`,
    '',
    rulesSource.trim(),
    '',
    kovoRulesEndMarker,
    '',
  ].join('\n');
}

export function replaceKovoRulesBlock(documentSource: string, rulesBlock: string): string {
  const beginCount = countMarker(documentSource, kovoRulesBeginMarker);
  const endCount = countMarker(documentSource, kovoRulesEndMarker);

  if (beginCount === 0 && endCount === 0) {
    const separator = documentSource.trimEnd() ? '\n\n' : '';
    return `${documentSource.trimEnd()}${separator}${rulesBlock}`;
  }

  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(
      `Expected exactly one ${kovoRulesBeginMarker} and one ${kovoRulesEndMarker} marker in AGENTS.md`,
    );
  }

  const begin = documentSource.indexOf(kovoRulesBeginMarker);
  const end = documentSource.indexOf(kovoRulesEndMarker);
  if (end < begin) {
    throw new Error(`${kovoRulesEndMarker} appears before ${kovoRulesBeginMarker} in AGENTS.md`);
  }

  const afterEnd = end + kovoRulesEndMarker.length;
  return `${documentSource.slice(0, begin)}${rulesBlock.trimEnd()}${documentSource.slice(afterEnd)}`;
}

export function bundledKovoDocsMirrorFiles({
  source = 'bundled',
  version,
}: {
  source?: 'bundled' | 'fetched';
  version: string;
}): KovoDocsMirrorFile[] {
  const files = new Map<string, string>();
  files.set('kovo-rules.md', bundledKovoRulesSource());
  files.set(
    'llms.txt',
    [
      '# Kovo',
      '',
      'Compact local docs index for Kovo app agents.',
      '',
      '- Spec: `./spec.md`',
      '- Full docs corpus: `./llms-full.txt`',
      '- Kovo rules: `./kovo-rules.md`',
      '- Project structure: `./docs/project-structure.md`',
      '- CLI: `./guides/cli.md`',
      '- Diagnostics: `./reference/diagnostics.md`',
      '',
    ].join('\n'),
  );
  files.set(
    'llms-full.txt',
    [
      '# Kovo Full Docs',
      '',
      'Bundled starter snapshot. Run `kovo update-docs` to fetch the latest public docs.',
      '',
      bundledKovoRulesSource().trim(),
      '',
    ].join('\n'),
  );
  files.set('spec.md', fallbackDoc('Kovo Spec', 'https://kovo.sh/spec.md'));
  for (const section of kovoRulesTocSections) {
    for (const entry of section.entries) {
      files.set(entry.path, fallbackDoc(entry.title, `https://kovo.sh/${entry.path}`));
    }
  }
  files.set(
    'metadata.json',
    `${JSON.stringify(
      {
        docs: [...kovoDocsMirrorRemotes],
        generatedBy: 'kovo update-docs',
        source,
        version,
      },
      null,
      2,
    )}\n`,
  );

  return [...files].map(([path, fileSource]) => ({ path, source: fileSource }));
}

function countMarker(source: string, marker: string): number {
  let count = 0;
  let index = -marker.length;
  while ((index = source.indexOf(marker, index + marker.length)) !== -1) count += 1;
  return count;
}

function fallbackDoc(title: string, url: string): string {
  return [
    `# ${title}`,
    '',
    `Bundled starter placeholder for ${url}.`,
    '',
    'Run `kovo update-docs` to fetch the latest local copy.',
    '',
  ].join('\n');
}
