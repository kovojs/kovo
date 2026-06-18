import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS_MANIFEST } from '../../packages/cli/src/commands-manifest.ts';

import { slugify } from './md.mjs';

// Source link for command rows in the API sidebar: the bin's dispatch file. A
// fixed ref keeps the generated manifest deterministic.
const CLI_SOURCE_HREF = 'https://github.com/kovojs/kovo/blob/main/packages/cli/src/index.ts';

/**
 * Command-first `/api/cli/` generator.
 *
 * The base `cli.md` is produced by `generateApiReference()` from the real
 * `packages/cli/src/api.ts` TypeScript source (the programmatic `kovoCheck`/
 * `kovoExplain` verifier surface). That guarantees the programmatic reference
 * cannot drift from the source. This step runs AFTER api-ref and rewrites that
 * file into a command-first layout:
 *
 *   - A `## Commands` section on top, one `### kovo <command>` per dispatched
 *     command, rendered from the shared `@kovojs/cli` command manifest
 *     (`packages/cli/src/commands-manifest.ts`) — the same manifest the bin's
 *     `index.ts` imports its usage strings from, so the docs cannot drift from
 *     the binary (a vitest drift guard ties the two together).
 *   - The existing api-ref-generated function/type reference demoted under a
 *     `## Programmatic API` parent heading, kept verbatim so it stays generated
 *     from real TS source.
 *
 * Output is deterministic (no timestamps/abs paths). Command examples are
 * emitted in ```sh fences (never ```ts) so they are not picked up by the
 * `@example` typecheck gate (`scripts/api-examples-check.mjs`).
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));

/** Render a flags table for a command, or an empty list if it has no flags. */
function renderFlags(entry) {
  if (!entry.flags || entry.flags.length === 0) return [];
  return [
    '| Flag | Description |',
    '| --- | --- |',
    ...entry.flags.map((f) => `| \`${f.flag}\` | ${f.description} |`),
    '',
  ];
}

/** Render the usage block (one ```sh fence containing all usage lines). */
function renderUsage(entry) {
  const lines = Array.isArray(entry.usage) ? entry.usage : [entry.usage];
  return ['```sh', ...lines, '```', ''];
}

/** Render example invocations, one ```sh fence per example. */
function renderExamples(entry) {
  if (!entry.examples || entry.examples.length === 0) return [];
  return [
    '**Examples**',
    '',
    ...entry.examples.flatMap((example) => ['```sh', example, '```', '']),
  ];
}

/** Render one `### kovo <command>` section. */
function renderCommand(entry) {
  return [
    `### kovo ${entry.name}`,
    '',
    entry.summary,
    '',
    ...renderUsage(entry),
    ...renderFlags(entry),
    ...renderExamples(entry),
  ];
}

/**
 * Split the api-ref-generated `cli.md` into its frontmatter and the body that
 * follows the `# kovo` title + "Generated from …" intro line. We keep the
 * frontmatter verbatim (title/order must stay so the page keeps its slot in the
 * API section) and re-emit a command-first body, demoting the programmatic
 * sections under `## Programmatic API`.
 */
function transform(source) {
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!fmMatch) {
    throw new Error('cli-ref: cli.md is missing YAML frontmatter; run api-ref first.');
  }
  const frontmatter = fmMatch[0].replace(/\n$/, '');
  const afterFrontmatter = source.slice(fmMatch[0].length);

  // The programmatic content is everything from the first `## ` heading onward.
  const firstSection = afterFrontmatter.indexOf('\n## ');
  if (firstSection === -1) {
    throw new Error('cli-ref: cli.md has no `## ` sections to demote.');
  }
  // Demote the top-level api-ref sections (`## Functions`, `## Types & interfaces`,
  // `## Constants`) to `### ` so they nest under the new `## Programmatic API`.
  // Symbol entries are already `### `; bump those to `#### ` to preserve hierarchy.
  const programmaticRaw = afterFrontmatter.slice(firstSection + 1);
  const programmatic = programmaticRaw
    .split('\n')
    .map((line) => {
      if (/^### /.test(line)) return `#${line}`; // ### `kovoCheck` -> #### `kovoCheck`
      if (/^## /.test(line)) return `#${line}`; // ## Functions     -> ### Functions
      return line;
    })
    .join('\n');

  const commandSection = COMMANDS_MANIFEST.flatMap((entry) => renderCommand(entry));

  const body = [
    '# kovo',
    '',
    'Command-line interface for the Kovo toolchain. Generated from the shared',
    '`@kovojs/cli` command manifest (`packages/cli/src/commands-manifest.ts`) and the',
    "package's public TypeScript source. Do not edit by hand.",
    '',
    'Run `kovo` with no arguments to list the available commands:',
    '',
    '```sh',
    'kovo: explain, check, audit, export, mcp',
    '```',
    '',
    '## Commands',
    '',
    ...commandSection,
    '## Programmatic API',
    '',
    'The `kovo` package also exposes a small in-process verifier surface so callers',
    'can run the checks against an extracted graph without spawning the bin',
    '(SPEC.md §11.4). This reference is generated from `packages/cli/src/api.ts`.',
    '',
    programmatic,
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`.replace(/\n{3,}/g, '\n\n');
}

/**
 * Rewrite the api-ref-generated `cli.sidebar.json` to match the command-first
 * page: a "Commands" group on top (one row per `kovo <command>`, anchored to its
 * `### kovo <command>` heading), with the programmatic `Functions`/`Types`
 * groups kept after it inside the `kovo` subpath group. Without this, the API
 * rail would advertise only the two programmatic functions and omit every
 * command.
 */
function transformSidebar(manifest) {
  const commands = {
    title: 'Commands',
    anchor: 'commands',
    symbols: COMMANDS_MANIFEST.map((entry) => ({
      name: `kovo ${entry.name}`,
      anchor: slugify(`kovo ${entry.name}`),
      kind: 'command',
      documented: true,
      sourceHref: CLI_SOURCE_HREF,
    })),
  };
  return {
    ...manifest,
    subpaths: manifest.subpaths.map((subpath, index) =>
      index === 0 ? { ...subpath, categories: [commands, ...subpath.categories] } : subpath,
    ),
  };
}

export async function generateCliReference({ outDir = path.join(siteRoot, 'gen/api') } = {}) {
  const cliPath = path.join(outDir, 'cli.md');
  const source = await readFile(cliPath, 'utf8');
  const transformed = transform(source);
  await writeFile(cliPath, transformed, 'utf8');

  // Keep the API navigation in step with the command-first page.
  const sidebarPath = path.join(outDir, 'cli.sidebar.json');
  if (existsSync(sidebarPath)) {
    const manifest = JSON.parse(await readFile(sidebarPath, 'utf8'));
    await writeFile(
      sidebarPath,
      `${JSON.stringify(transformSidebar(manifest), null, 2)}\n`,
      'utf8',
    );
  }

  return { commands: COMMANDS_MANIFEST.map((entry) => entry.name) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generateCliReference();
  process.stdout.write(`cli-ref/v1 commands=${result.commands.join(',')}\nOK\n`);
}
