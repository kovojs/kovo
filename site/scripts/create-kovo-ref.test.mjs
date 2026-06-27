import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CREATE_KOVO_USAGE } from '../../packages/create-kovo/src/index.ts';

import { generateCreateKovoReference } from './create-kovo-ref.mjs';

describe('create-kovo reference generator', () => {
  it('emits the command page and sidebar from the CLI usage source', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'kovo-create-kovo-ref-'));
    try {
      await generateCreateKovoReference({ outDir });
      const page = await readFile(path.join(outDir, 'create-kovo.md'), 'utf8');
      const sidebar = JSON.parse(
        await readFile(path.join(outDir, 'create-kovo.sidebar.json'), 'utf8'),
      );

      expect(page).toContain(CREATE_KOVO_USAGE);
      expect(page).toContain('--disable-git');
      expect(page).toContain('already inside a Git or Mercurial repository');
      expect(page).toContain('## Generated project');
      expect(sidebar.package).toBe('create-kovo');
      expect(sidebar.subpaths[0].categories[0].symbols[0]).toMatchObject({
        anchor: 'usage',
        kind: 'command',
        name: 'create-kovo',
      });
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
