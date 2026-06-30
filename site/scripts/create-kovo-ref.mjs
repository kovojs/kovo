import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CREATE_KOVO_REFERENCE } from '../../packages/create-kovo/src/index.ts';

/**
 * Command reference for the standalone `create-kovo` bin.
 *
 * `create-kovo` is a public CLI package, not an importable library package, so
 * `api-ref.mjs` intentionally cannot discover it from package exports. This
 * generator emits the command page from the bin's exported usage literal and
 * the scaffold contract in `packages/create-kovo/src/index.ts`, keeping the docs
 * in the same generated API section as `@kovojs/cli` without pretending the bin
 * has a package import surface.
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_HREF = 'https://github.com/kovojs/kovo/blob/main/packages/create-kovo/src/index.ts';

function page() {
  const optionsRows = [
    '| Option | Description |',
    '| --- | --- |',
    '| `<target-directory>` | Required output directory. The command creates it when it does not exist and refuses to write into a non-empty directory. |',
    ...CREATE_KOVO_REFERENCE.options.map(
      (option) => `| \`${option.flag}\` | ${option.docsDescription ?? option.description} |`,
    ),
  ];

  return [
    '---',
    `title: "${CREATE_KOVO_REFERENCE.title}"`,
    'description: Scaffold a new Kovo app with Postgres or SQLite templates, local secrets, tests, and CI wiring.',
    'order: 11',
    '---',
    '',
    `# ${CREATE_KOVO_REFERENCE.title}`,
    '',
    '`create-kovo` scaffolds a new Kovo application from the maintained starter templates. It is a public CLI package, not an app import surface.',
    '',
    'Source: [`packages/create-kovo/src/index.ts`](https://github.com/kovojs/kovo/blob/main/packages/create-kovo/src/index.ts)',
    '',
    '## Usage',
    '',
    '```sh',
    CREATE_KOVO_REFERENCE.usage,
    '```',
    '',
    '## Options',
    '',
    ...optionsRows,
    '',
    '## Examples',
    '',
    '```sh',
    ...CREATE_KOVO_REFERENCE.examples,
    '```',
    '',
    ...CREATE_KOVO_REFERENCE.sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.body,
      '',
    ]),
    '',
    '## Related docs',
    '',
    '- [Installation](/getting-started/installation/) - installing Kovo packages.',
    '- [Project structure](/getting-started/project-structure/) - what the generated files are for.',
    '- [The kovo & vp CLIs](/guides/cli/) - day-to-day project commands after scaffolding.',
    '',
  ].join('\n');
}

function sidebar() {
  const referenceSections = CREATE_KOVO_REFERENCE.sections.map((section) => ({
    name: section.title,
    anchor: section.anchor,
    kind: 'section',
    documented: true,
    sourceHref: SOURCE_HREF,
  }));

  return {
    package: 'create-kovo',
    slug: 'create-kovo',
    subpaths: [
      {
        title: 'create-kovo',
        importPath: 'create-kovo',
        sourceHref: SOURCE_HREF,
        categories: [
          {
            title: 'Command',
            anchor: 'usage',
            symbols: [
              {
                name: 'create-kovo',
                anchor: 'usage',
                kind: 'command',
                documented: true,
                sourceHref: SOURCE_HREF,
              },
            ],
          },
          {
            title: 'Reference',
            anchor: 'options',
            symbols: [
              {
                name: 'Options',
                anchor: 'options',
                kind: 'section',
                documented: true,
                sourceHref: SOURCE_HREF,
              },
              ...referenceSections,
            ],
          },
        ],
      },
    ],
  };
}

export async function generateCreateKovoReference({
  outDir = path.join(siteRoot, 'gen/api'),
} = {}) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'create-kovo.md'), page(), 'utf8');
  await writeFile(
    path.join(outDir, 'create-kovo.sidebar.json'),
    `${JSON.stringify(sidebar(), null, 2)}\n`,
    'utf8',
  );
  return { command: 'create-kovo' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generateCreateKovoReference();
  process.stdout.write(`create-kovo-ref/v1 command=${result.command}\nOK\n`);
}
