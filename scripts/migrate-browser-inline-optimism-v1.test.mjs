import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeBrowserInlineOptimismV1Migration,
  runBrowserInlineOptimismV1Migration,
} from './migrate-browser-inline-optimism-v1.mjs';

describe('browser inline optimism v1 migration executable', () => {
  it('refuses retired browser-root optimism contracts at their import specifiers', () => {
    const analysis = analyzeBrowserInlineOptimismV1Migration({
      fileName: 'optimism.ts',
      source:
        "import type { OptimisticFor as Coverage, OptimisticPlan } from '@kovojs/browser';\n" +
        'export type Plan = Coverage<unknown> | OptimisticPlan;\n',
    });

    expect(analysis.status).toBe('refused');
    if (analysis.status !== 'refused') throw new Error('expected refusal');
    expect(analysis.refusals).toHaveLength(2);
    expect(analysis.refusals.map((entry) => entry.category)).toEqual([
      'app-context',
      'app-context',
    ]);
    expect(analysis.refusals.map((entry) => analysis.source.slice(entry.start, entry.end))).toEqual(
      ['OptimisticFor as Coverage', 'OptimisticPlan'],
    );
  });

  it('refuses retired server support types and namespace access', () => {
    const analysis = analyzeBrowserInlineOptimismV1Migration({
      fileName: 'bindings.ts',
      source:
        "import type { QueryOptimisticBinding } from '@kovojs/server';\n" +
        "import * as browser from '@kovojs/browser';\n" +
        'type Pair = QueryOptimisticBinding | browser.OptimisticEntry;\n',
    });

    expect(analysis.status).toBe('refused');
    if (analysis.status !== 'refused') throw new Error('expected refusal');
    expect(analysis.refusals).toHaveLength(2);
  });

  it('keeps generated ABI imports and same-named local declarations unchanged', () => {
    const source =
      "import type { OptimisticFor } from '@kovojs/browser/generated';\n" +
      'interface OptimisticPlan { readonly local: true }\n' +
      'export type Generated = OptimisticFor<unknown> | OptimisticPlan;\n';

    expect(
      analyzeBrowserInlineOptimismV1Migration({
        fileName: 'generated-consumer.ts',
        source,
      }),
    ).toEqual({ source, status: 'unchanged', refusals: [] });
  });

  it('reports stable byte anchors and never partially writes a refusal-only batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-browser-inline-optimism-v1-'));
    const refusalPath = path.join(root, 'refusal.ts');
    const unchangedPath = path.join(root, 'unchanged.ts');
    try {
      writeFileSync(
        refusalPath,
        "import type { OptimisticPlan } from '@kovojs/browser';\nexport type Plan = OptimisticPlan;\n",
      );
      writeFileSync(unchangedPath, "import { install } from '@kovojs/browser';\nvoid install;\n");
      const result = runBrowserInlineOptimismV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['refusal.ts', 'unchanged.ts'],
      });

      expect(result.summary).toEqual({ refused: 1, rewritten: 0, unchanged: 1 });
      expect(result.files[0]).toMatchObject({
        path: 'refusal.ts',
        state: 'refused',
        refusals: [
          {
            category: 'app-context',
            anchor: { start: 14, end: 28 },
          },
        ],
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
