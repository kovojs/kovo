import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeTestHarnessV2Migration,
  runTestHarnessV2Migration,
} from './migrate-test-harness-v2.mjs';

describe('app-scoped test harness v2 migration', () => {
  it('accepts the explicit app, artifact, and project-root contract unchanged', () => {
    const source = [
      "import { createKovoTestHarness } from '@kovojs/test/harness';",
      'const harness = await createKovoTestHarness(app, {',
      "  artifact: new URL('../dist/.kovo/graph.json', import.meta.url),",
      "  projectRoot: new URL('../', import.meta.url),",
      '});',
      '',
    ].join('\n');

    expect(analyzeTestHarnessV2Migration({ fileName: 'src/app.test.ts', source })).toEqual({
      refusals: [],
      source,
      status: 'unchanged',
    });
  });

  it('refuses caller-authored proof graphs and in-process page fixtures', () => {
    const source = [
      'import {',
      '  createKovoTestHarness,',
      '  type HarnessPageFixture,',
      '  type KovoTestTouchGraph,',
      "} from '@kovojs/test/harness';",
      'declare const pages: Record<string, HarnessPageFixture>;',
      'declare const touchGraph: KovoTestTouchGraph;',
      'createKovoTestHarness({ db, pages, touchGraph });',
      '',
    ].join('\n');
    const result = analyzeTestHarnessV2Migration({
      fileName: 'src/app.test.ts',
      source,
    });

    expect(result.status).toBe('refused');
    expect(new Set(result.refusals.map(({ category }) => category))).toEqual(
      new Set(['app-context', 'deployment-posture']),
    );
  });

  it('refuses the retired test-case adapter and dynamic namespace access', () => {
    const source = [
      "import { kovoTest, type KovoTestRunner } from '@kovojs/test/test-case';",
      "const harnessModule = import('@kovojs/test/harness');",
      'void [harnessModule, kovoTest];',
      'declare const runner: KovoTestRunner;',
      'void runner;',
      '',
    ].join('\n');
    const result = analyzeTestHarnessV2Migration({
      fileName: 'src/app.test.ts',
      source,
    });

    expect(result.status).toBe('refused');
    expect(new Set(result.refusals.map(({ category }) => category))).toEqual(
      new Set(['app-context', 'dynamic-import']),
    );
  });

  it('reports source-anchored refusals in both check and write modes without editing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-test-harness-v2-'));
    const sourcePath = path.join(root, 'app.test.ts');
    const source = [
      "import { createKovoTestHarness } from '@kovojs/test/harness';",
      'export const harness = createKovoTestHarness({ db });',
      '',
    ].join('\n');

    try {
      writeFileSync(sourcePath, source);
      const checked = runTestHarnessV2Migration({
        cwd: root,
        mode: 'check',
        sourcePaths: ['app.test.ts'],
      });
      const written = runTestHarnessV2Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['app.test.ts'],
      });

      for (const result of [checked, written]) {
        expect(result.schema).toBe('kovo-api-migration-result/v1');
        expect(result.batch).toBe('test-harness-v2');
        expect(result.summary).toEqual({ refused: 1, rewritten: 0, unchanged: 0 });
        expect(result.files[0]?.refusals?.[0]?.anchor).toEqual({
          start: expect.any(Number),
          end: expect.any(Number),
        });
      }
      expect(readFileSync(sourcePath, 'utf8')).toBe(source);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
