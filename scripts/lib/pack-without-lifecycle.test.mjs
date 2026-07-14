import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { packWithoutLifecycleScripts } from './pack-without-lifecycle.mjs';

describe('lifecycle-free package packing', () => {
  it('packs the reviewed files without executing a package prepack program', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-pack-no-lifecycle-'));
    const destination = path.join(root, 'tarballs');
    const marker = path.join(root, 'prepack-ran');
    mkdirSync(destination);

    try {
      writeFileSync(path.join(root, 'index.mjs'), 'export const safe = true;\n');
      writeFileSync(
        path.join(root, 'prepack.mjs'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
      );
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          files: ['index.mjs'],
          name: 'kovo-pack-no-lifecycle-fixture',
          scripts: { prepack: 'node prepack.mjs' },
          type: 'module',
          version: '1.0.0',
        }),
      );

      const tarball = packWithoutLifecycleScripts(
        { dirPath: root, name: 'kovo-pack-no-lifecycle-fixture' },
        destination,
      );

      expect(existsSync(tarball)).toBe(true);
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(tarball).byteLength).toBeGreaterThan(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
