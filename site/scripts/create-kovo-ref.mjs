import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CREATE_KOVO_USAGE } from '../../packages/create-kovo/src/index.ts';

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
  return [
    '---',
    'title: "create-kovo"',
    'description: Scaffold a new Kovo app with Postgres or SQLite templates, local secrets, tests, and CI wiring.',
    'order: 11',
    '---',
    '',
    '# create-kovo',
    '',
    '`create-kovo` scaffolds a new Kovo application from the maintained starter templates. It is a public CLI package, not an app import surface.',
    '',
    'Source: [`packages/create-kovo/src/index.ts`](https://github.com/kovojs/kovo/blob/main/packages/create-kovo/src/index.ts)',
    '',
    '## Usage',
    '',
    '```sh',
    CREATE_KOVO_USAGE,
    '```',
    '',
    '## Options',
    '',
    '| Option | Description |',
    '| --- | --- |',
    '| `<target-directory>` | Required output directory. The command creates it when it does not exist and refuses to write into a non-empty directory. |',
    '| `--name <package-name>` | Override the generated `package.json` name. Names are normalized to lowercase npm-compatible words and dashes. |',
    '| `--dialect postgres\\|sqlite` | Select the database starter. Defaults to `postgres`. |',
    '| `--postgres` | Alias for `--dialect postgres`. |',
    '| `--sqlite` | Alias for `--dialect sqlite`. |',
    '| `--help`, `-h` | Print usage and exit without writing files. |',
    '',
    '## Examples',
    '',
    '```sh',
    'create-kovo my-app',
    'create-kovo my-app --name acme-contacts --dialect sqlite',
    'create-kovo my-app --postgres',
    '```',
    '',
    '## Generated project',
    '',
    'The scaffold writes the application source, Vite+/Kovo config, test files, README, CI workflow, and database-specific schema/auth/database files for the selected dialect. It also writes `.env`, `.env.example`, and `.gitignore`.',
    '',
    'The `.env` file contains a per-project random `KOVO_CSRF_SECRET`; `.env` is gitignored, while `.env.example` keeps the deployment placeholder visible. The starter auth module fails closed when the secret is missing or still set to the placeholder.',
    '',
    '## Write safety',
    '',
    'The command resolves every template destination under the target root before writing and rejects path traversal. Existing non-empty directories and non-directory targets fail before any scaffold file is written.',
    '',
    '## Related docs',
    '',
    '- [Installation](/docs/installation/) - installing Kovo packages.',
    '- [Project structure](/docs/project-structure/) - what the generated files are for.',
    '- [The kovo & vp CLIs](/guides/cli/) - day-to-day project commands after scaffolding.',
    '',
  ].join('\n');
}

function sidebar() {
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
              {
                name: 'Generated project',
                anchor: 'generated-project',
                kind: 'section',
                documented: true,
                sourceHref: SOURCE_HREF,
              },
              {
                name: 'Write safety',
                anchor: 'write-safety',
                kind: 'section',
                documented: true,
                sourceHref: SOURCE_HREF,
              },
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
