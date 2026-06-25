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
  directory: string;
  title: string;
  entries: readonly KovoRulesTocEntry[];
}

interface KovoRulesTocEntry {
  path: string;
  slug: string;
  title: string;
}

export const kovoRulesTocSections: readonly KovoRulesTocSection[] = [
  {
    directory: 'docs/',
    title: 'Getting Started',
    entries: [
      { title: 'Why Kovo?', path: 'docs/why-kovo.md', slug: 'why-kovo' },
      { title: 'Quickstart', path: 'docs/quickstart.md', slug: 'quickstart' },
      { title: 'Thinking in Kovo', path: 'docs/mental-model.md', slug: 'mental-model' },
      { title: 'Installation', path: 'docs/installation.md', slug: 'installation' },
      { title: 'Project structure', path: 'docs/project-structure.md', slug: 'project-structure' },
      { title: 'Stability & Versioning', path: 'docs/stability.md', slug: 'stability' },
    ],
  },
  {
    directory: 'tutorial/',
    title: 'Tutorial',
    entries: [
      {
        title: '1. Scaffold & the first page',
        path: 'tutorial/01-first-page.md',
        slug: '01-first-page',
      },
      { title: '2. Components & islands', path: 'tutorial/02-islands.md', slug: '02-islands' },
      { title: '3. Queries & data binding', path: 'tutorial/03-queries.md', slug: '03-queries' },
      { title: '4. Mutations & forms', path: 'tutorial/04-mutations.md', slug: '04-mutations' },
      {
        title: '5. Invalidation & optimistic updates',
        path: 'tutorial/05-optimistic.md',
        slug: '05-optimistic',
      },
      { title: '6. Streaming & defer', path: 'tutorial/06-streaming.md', slug: '06-streaming' },
      {
        title: '7. Testing & verification',
        path: 'tutorial/07-verification.md',
        slug: '07-verification',
      },
      { title: '8. Wrap-up & deploy', path: 'tutorial/08-wrap-up.md', slug: '08-wrap-up' },
    ],
  },
  {
    directory: 'guides/',
    title: 'Guides',
    entries: [
      { title: 'Routing & navigation', path: 'guides/routing.md', slug: 'routing' },
      { title: 'Layouts', path: 'guides/layouts.md', slug: 'layouts' },
      { title: 'Queries & invalidation', path: 'guides/queries.md', slug: 'queries' },
      { title: 'Live queries', path: 'guides/live-queries.md', slug: 'live-queries' },
      { title: 'Domains, writes & data access', path: 'guides/data-layer.md', slug: 'data-layer' },
      { title: 'Mutations & forms', path: 'guides/mutations.md', slug: 'mutations' },
      { title: 'Security & authorization', path: 'guides/security.md', slug: 'security' },
      {
        title: 'Better Auth integration',
        path: 'guides/auth-better-auth.md',
        slug: 'auth-better-auth',
      },
      { title: 'Optimistic updates', path: 'guides/optimistic.md', slug: 'optimistic' },
      { title: 'Interactive islands & client state', path: 'guides/islands.md', slug: 'islands' },
      { title: 'Styling with StyleX', path: 'guides/styling.md', slug: 'styling' },
      { title: 'Request shell', path: 'guides/request-shell.md', slug: 'request-shell' },
      {
        title: 'Endpoints & webhooks',
        path: 'guides/endpoints-webhooks.md',
        slug: 'endpoints-webhooks',
      },
      { title: 'Deployment', path: 'guides/deployment.md', slug: 'deployment' },
      { title: 'Static export', path: 'guides/static-export.md', slug: 'static-export' },
      { title: 'Testing with @kovojs/test', path: 'guides/testing.md', slug: 'testing' },
      { title: 'Dataflow devtool', path: 'guides/dataflow-devtool.md', slug: 'dataflow-devtool' },
      { title: 'The kovo & vp CLIs', path: 'guides/cli.md', slug: 'cli' },
      {
        title: 'Reading kovo check & kovo explain',
        path: 'guides/kovo-explain.md',
        slug: 'kovo-explain',
      },
      { title: 'Streaming & defer', path: 'guides/streaming.md', slug: 'streaming' },
      {
        title: 'Compiler internals',
        path: 'guides/compiler-internals.md',
        slug: 'compiler-internals',
      },
      { title: 'Accessibility', path: 'guides/accessibility.md', slug: 'accessibility' },
      { title: 'Components & copy-in UI', path: 'guides/components.md', slug: 'components' },
    ],
  },
  {
    directory: 'api/',
    title: 'API Reference',
    entries: [
      { title: '@kovojs/core', path: 'api/core.md', slug: 'core' },
      { title: '@kovojs/icons', path: 'api/icons.md', slug: 'icons' },
      { title: '@kovojs/server', path: 'api/server.md', slug: 'server' },
      { title: '@kovojs/browser', path: 'api/browser.md', slug: 'browser' },
      { title: '@kovojs/test', path: 'api/test.md', slug: 'test' },
      { title: '@kovojs/drizzle', path: 'api/drizzle.md', slug: 'drizzle' },
      { title: '@kovojs/headless-ui', path: 'api/headless-ui.md', slug: 'headless-ui' },
      { title: '@kovojs/style', path: 'api/style.md', slug: 'style' },
      { title: '@kovojs/better-auth', path: 'api/better-auth.md', slug: 'better-auth' },
      { title: '@kovojs/ui', path: 'api/ui.md', slug: 'ui' },
      { title: '@kovojs/cli', path: 'api/cli.md', slug: 'cli' },
      { title: 'create-kovo', path: 'api/create-kovo.md', slug: 'create-kovo' },
    ],
  },
  {
    directory: 'reference/',
    title: 'Reference',
    entries: [{ title: 'Diagnostics', path: 'reference/diagnostics.md', slug: 'diagnostics' }],
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
    '## Table Of Contents',
    '',
    'Docs root: `./.kovo/docs/`.',
    'Path rule: `why-kovo` in `docs/` means `./.kovo/docs/docs/why-kovo.md`; `core` in `api/` means `./.kovo/docs/api/core.md`.',
    '',
    ...kovoRulesTocSections.map(
      (section) =>
        `- ${section.title} (\`${section.directory}\`): ${section.entries
          .map((entry) => entry.slug)
          .join(', ')}`,
    ),
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
