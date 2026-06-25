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

export const kovoDocsMirrorRemotes: readonly KovoDocsMirrorRemote[] = [
  { path: 'kovo-rules.md', url: 'https://kovo.sh/kovo-rules.md' },
  { path: 'llms.txt', url: 'https://kovo.sh/llms.txt' },
  { path: 'llms-full.txt', url: 'https://kovo.sh/llms-full.txt' },
  { path: 'spec.md', url: 'https://kovo.sh/spec.md' },
  { path: 'docs/project-structure.md', url: 'https://kovo.sh/docs/project-structure.md' },
  { path: 'guides/cli.md', url: 'https://kovo.sh/guides/cli.md' },
  { path: 'guides/security.md', url: 'https://kovo.sh/guides/security.md' },
  { path: 'guides/routing.md', url: 'https://kovo.sh/guides/routing.md' },
  { path: 'guides/layouts.md', url: 'https://kovo.sh/guides/layouts.md' },
  { path: 'guides/queries.md', url: 'https://kovo.sh/guides/queries.md' },
  { path: 'guides/mutations.md', url: 'https://kovo.sh/guides/mutations.md' },
  { path: 'guides/testing.md', url: 'https://kovo.sh/guides/testing.md' },
  { path: 'reference/diagnostics.md', url: 'https://kovo.sh/reference/diagnostics.md' },
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
    '- Docs index: `./.kovo/docs/llms.txt`',
    '- Full docs corpus: `./.kovo/docs/llms-full.txt`',
    '- Project structure: `./.kovo/docs/docs/project-structure.md`',
    '- CLI: `./.kovo/docs/guides/cli.md`',
    '- Diagnostics: `./.kovo/docs/reference/diagnostics.md`',
    '- Security: `./.kovo/docs/guides/security.md`',
    '- Routes/layouts: `./.kovo/docs/guides/routing.md`, `./.kovo/docs/guides/layouts.md`',
    '- Queries/mutations: `./.kovo/docs/guides/queries.md`, `./.kovo/docs/guides/mutations.md`',
    '- Testing: `./.kovo/docs/guides/testing.md`',
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
  files.set(
    'docs/project-structure.md',
    fallbackDoc('Project Structure', 'https://kovo.sh/docs/project-structure.md'),
  );
  files.set('guides/cli.md', fallbackDoc('CLI', 'https://kovo.sh/guides/cli.md'));
  files.set('guides/security.md', fallbackDoc('Security', 'https://kovo.sh/guides/security.md'));
  files.set('guides/routing.md', fallbackDoc('Routing', 'https://kovo.sh/guides/routing.md'));
  files.set('guides/layouts.md', fallbackDoc('Layouts', 'https://kovo.sh/guides/layouts.md'));
  files.set('guides/queries.md', fallbackDoc('Queries', 'https://kovo.sh/guides/queries.md'));
  files.set('guides/mutations.md', fallbackDoc('Mutations', 'https://kovo.sh/guides/mutations.md'));
  files.set('guides/testing.md', fallbackDoc('Testing', 'https://kovo.sh/guides/testing.md'));
  files.set(
    'reference/diagnostics.md',
    fallbackDoc('Diagnostics', 'https://kovo.sh/reference/diagnostics.md'),
  );
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
