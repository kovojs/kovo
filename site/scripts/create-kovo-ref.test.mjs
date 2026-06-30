import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CREATE_KOVO_REFERENCE, CREATE_KOVO_USAGE } from '../../packages/create-kovo/src/index.ts';

import { generateCreateKovoReference } from './create-kovo-ref.mjs';

describe('create-kovo reference generator', () => {
  it('emits the command page and sidebar from the shared reference schema', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'kovo-create-kovo-ref-'));
    try {
      await generateCreateKovoReference({ outDir });
      const page = await readFile(path.join(outDir, 'create-kovo.md'), 'utf8');
      const sidebar = JSON.parse(
        await readFile(path.join(outDir, 'create-kovo.sidebar.json'), 'utf8'),
      );

      expect(page).toContain(CREATE_KOVO_USAGE);
      for (const option of CREATE_KOVO_REFERENCE.options) {
        expect(page).toContain(`\`${option.flag}\``);
        expect(page).toContain(option.docsDescription ?? option.description);
      }
      for (const example of CREATE_KOVO_REFERENCE.examples) {
        expect(page).toContain(example);
      }
      for (const section of CREATE_KOVO_REFERENCE.sections) {
        expect(page).toContain(`## ${section.title}`);
        for (const paragraph of section.body) expect(page).toContain(paragraph);
      }
      expect(sidebar.package).toBe('create-kovo');
      expect(sidebar.subpaths[0].categories[0].symbols[0]).toMatchObject({
        anchor: 'usage',
        kind: 'command',
        name: 'create-kovo',
      });
      expect(sidebar.subpaths[0].categories[1].symbols.map((symbol) => symbol.name)).toEqual([
        'Options',
        ...CREATE_KOVO_REFERENCE.sections.map((section) => section.title),
      ]);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
