import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runStyleApiV1Migration } from './migrate-style-api-v1.mjs';

describe('style API v1 migration executable', () => {
  it('keeps the whole write batch unchanged when any file is refused', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-style-api-v1-'));
    const rewritePath = path.join(root, 'button.ts');
    const refusalPath = path.join(root, 'theme.ts');
    const rewriteSource =
      "import type { StyleRecord } from '@kovojs/style';\nexport type Props = { style: StyleRecord };\n";
    const refusalSource =
      "import { createTheme } from '@kovojs/style';\nexport const theme = createTheme;\n";

    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);

      const result = runStyleApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['button.ts', 'theme.ts'],
      });

      expect(result.summary).toEqual({ refused: 1, rewritten: 1, unchanged: 0 });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('atomically replaces a fully mechanical write batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-style-api-v1-'));
    const sourcePath = path.join(root, 'button.ts');

    try {
      writeFileSync(
        sourcePath,
        "import type { StyleRecord } from '@kovojs/style';\nexport type Props = { style: StyleRecord };\n",
      );

      const result = runStyleApiV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['button.ts'],
      });

      expect(result.summary).toEqual({ refused: 0, rewritten: 1, unchanged: 0 });
      expect(readFileSync(sourcePath, 'utf8')).toContain(
        "import type { StyleHandle } from '@kovojs/style';",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
