import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeBrowserClientInstallerV1Migration,
  runBrowserClientInstallerV1Migration,
} from './migrate-browser-client-installer-v1.mjs';

describe('browser client installer v1 API migration', () => {
  it('rewrites a result-free canonical loader install to the client installer', () => {
    const source = [
      "import { installKovoLoader } from '@kovojs/browser/client';",
      '',
      'installKovoLoader({',
      '  importModule: (url) => import(url),',
      '  root: document,',
      '});',
      '',
    ].join('\n');
    const analysis = analyzeBrowserClientInstallerV1Migration({
      fileName: 'src/client.ts',
      source,
    });

    expect(analysis.status).toBe('rewritten');
    expect(analysis.source).toContain(
      "import { installKovoClient } from '@kovojs/browser/client';",
    );
    expect(analysis.source).toContain('installKovoClient({');
  });

  it('refuses app-owned state, transport, and allowlist decisions', () => {
    const source = [
      "import { createQueryStore, defaultEnhancedFetch, installKovoLoader } from '@kovojs/browser/client';",
      'const store = createQueryStore();',
      'installKovoLoader({',
      "  allowedClientModuleUrls: ['/c/manual.js'],",
      '  enhancedMutations: { fetch: defaultEnhancedFetch, store },',
      '  importModule: (url) => import(url),',
      '  queryStore: store,',
      '  root: document,',
      '});',
      '',
    ].join('\n');
    const analysis = analyzeBrowserClientInstallerV1Migration({
      fileName: 'src/client.ts',
      source,
    });

    expect(analysis.status).toBe('refused');
    expect(new Set(analysis.refusals.map(({ category }) => category))).toEqual(
      new Set(['app-context', 'dynamic-import', 'trust-decision']),
    );
  });

  it('keeps write mode atomic when any source needs application intent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-browser-client-v1-'));
    try {
      const rewrite = path.join(root, 'rewrite.ts');
      writeFileSync(
        rewrite,
        "import { installKovoLoader } from '@kovojs/browser/client';\ninstallKovoLoader({ root: document });\n",
      );
      writeFileSync(
        path.join(root, 'refuse.ts'),
        "import { createQueryStore } from '@kovojs/browser/client';\ncreateQueryStore();\n",
      );

      const result = runBrowserClientInstallerV1Migration({ cwd: root, mode: 'write' });
      expect(result.summary).toEqual({ rewritten: 1, unchanged: 0, refused: 1 });
      expect(readFileSync(rewrite, 'utf8')).toContain('installKovoLoader');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
