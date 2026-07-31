import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { kovoBuildStylesheetCssForTesting } from './build-export.js';

describe('production stylesheet extraction diagnostics', () => {
  it('rejects a package hash mismatch instead of returning partial app CSS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-stylesheet-diagnostics-'));
    const appPath = join(root, 'src/app.tsx');
    const packageDir = join(root, 'node_modules/@kovojs/ui');
    const appSource = [
      "import * as style from '@kovojs/style';",
      "export const partialStyles = style.create({ root: { color: 'partial-app-css' } });",
      '',
    ].join('\n');
    const packageSource = [
      "import * as style from '@kovojs/style';",
      "const base = style.create({ root: { color: 'untrusted-package-css' } });",
      'export const Button = () => <button {...style.attrs(base.root)}>Button</button>;',
      '',
    ].join('\n');

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(packageDir, 'src'), { recursive: true });
      writeFileSync(appPath, appSource, 'utf8');
      writeFileSync(join(packageDir, 'src/button.tsx'), packageSource, 'utf8');
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({
          exports: { './button': { default: './dist/button.mjs' } },
          kovo: {
            vendoredSource: true,
            vendoredSourceHashes: { button: `sha256-${'A'.repeat(43)}` },
          },
          name: '@kovojs/ui',
        }),
        'utf8',
      );

      await expect(kovoBuildStylesheetCssForTesting(appPath)).rejects.toThrow(
        /stylesheet extraction failed:[\s\S]*package @kovojs\/ui src\/button\.tsx:.*hash mismatch/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
