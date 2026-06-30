import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  COMMANDS_MANIFEST,
  formatNoArgsMessage,
} from '../../packages/cli/src/commands-manifest.ts';

import { generateCliReference } from './cli-ref.mjs';

describe('cli-ref generator', () => {
  let outDir;

  afterEach(async () => {
    if (outDir) await rm(outDir, { force: true, recursive: true });
    outDir = undefined;
  });

  it('renders command docs and sidebar entries from the command manifest', async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'kovo-cli-ref-'));
    await writeFile(
      path.join(outDir, 'cli.md'),
      [
        '---',
        'title: "@kovojs/cli"',
        'description: CLI',
        'order: 11',
        '---',
        '',
        '# @kovojs/cli',
        '',
        'Generated from source.',
        '',
        '## Functions',
        '',
        '### `kovoCheck`',
        '',
        'Programmatic check docs.',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(outDir, 'cli.sidebar.json'),
      `${JSON.stringify(
        {
          package: '@kovojs/cli',
          slug: 'cli',
          subpaths: [
            {
              title: '@kovojs/cli',
              importPath: '@kovojs/cli',
              categories: [{ title: 'Functions', anchor: 'functions', symbols: [] }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = await generateCliReference({ outDir });
    const page = await readFile(path.join(outDir, 'cli.md'), 'utf8');
    const sidebar = JSON.parse(await readFile(path.join(outDir, 'cli.sidebar.json'), 'utf8'));
    const commandNames = COMMANDS_MANIFEST.map((entry) => entry.name);

    expect(result.commands).toEqual(commandNames);
    expect(page).toContain(formatNoArgsMessage().trimEnd());
    for (const name of commandNames) {
      expect(page).toContain(`### kovo ${name}`);
    }
    expect(sidebar.subpaths[0].categories[0].symbols.map((symbol) => symbol.name)).toEqual(
      commandNames.map((name) => `kovo ${name}`),
    );
  });
});
