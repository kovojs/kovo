import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeUiHeadlessIconsV1Migration,
  runUiHeadlessIconsV1Migration,
} from './migrate-ui-headless-icons-v1.mjs';

describe('UI/headless/icons v1 API migration', () => {
  it('moves IconRenderResult imports to the canonical core render contract', () => {
    const source =
      "import type { IconProps, IconRenderResult as Rendered } from '@kovojs/icons';\n\nexport const result = null as Rendered | null;\n";
    const analysis = analyzeUiHeadlessIconsV1Migration({ fileName: 'src/icon.ts', source });

    expect(analysis.status).toBe('rewritten');
    expect(analysis.source).toContain("import type { IconProps } from '@kovojs/icons';");
    expect(analysis.source).toContain(
      "import type { ComponentRenderResult as Rendered } from '@kovojs/core';",
    );
    expect(analysis.source).not.toContain('IconRenderResult');
  });

  it('refuses ambiguous UI roots and app-specific internal helper replacements', () => {
    const source =
      "import { Button } from '@kovojs/ui';\nimport { selectItemSelected } from '@kovojs/headless-ui/select';\n";
    const analysis = analyzeUiHeadlessIconsV1Migration({ fileName: 'src/app.ts', source });

    expect(analysis.status).toBe('refused');
    expect(analysis.source).toBe(source);
    expect(analysis.refusals.map(({ category }) => category)).toEqual([
      'ambiguous-binding',
      'app-context',
    ]);
  });

  it('keeps write mode atomic when any file is refused', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-ui-api-v1-'));
    try {
      writeFileSync(
        path.join(root, 'rewrite.ts'),
        "import type { IconRenderResult } from '@kovojs/icons';\n",
      );
      writeFileSync(path.join(root, 'refuse.ts'), "import { Card } from '@kovojs/ui';\n");

      const result = runUiHeadlessIconsV1Migration({ cwd: root, mode: 'write' });

      expect(result.summary).toEqual({ rewritten: 1, unchanged: 0, refused: 1 });
      expect(readFileSync(path.join(root, 'rewrite.ts'), 'utf8')).toContain('IconRenderResult');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
