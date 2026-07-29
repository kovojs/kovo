import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeBrowserAuthoringV1Migration,
  runBrowserAuthoringV1Migration,
} from './migrate-browser-authoring-v1.mjs';

describe('browser authoring API v1 migration executable', () => {
  it('rewrites static trust reasons to structured metadata', () => {
    const analysis = analyzeBrowserAuthoringV1Migration({
      fileName: 'content.ts',
      source:
        "import { trustedHtml as html, trustedUrl } from '@kovojs/browser';\n" +
        "export const body = html(markup, 'reviewed markdown');\n" +
        'export const href = trustedUrl(url, `allowlisted checkout redirect`);\n',
    });

    expect(analysis).toMatchObject({ status: 'rewritten' });
    expect(analysis.source).toContain("html(markup, { reason: 'reviewed markdown' })");
    expect(analysis.source).toContain(
      'trustedUrl(url, { reason: `allowlisted checkout redirect` })',
    );
  });

  it('refuses trust decisions and raw derive input names', () => {
    const analysis = analyzeBrowserAuthoringV1Migration({
      fileName: 'client.ts',
      source:
        "import { derive, trustedHtml } from '@kovojs/browser';\n" +
        "export const value = derive(['cart'], cart => cart.count);\n" +
        'export const body = trustedHtml(markup, reason);\n',
    });

    expect(analysis.status).toBe('refused');
    if (analysis.status !== 'refused') throw new Error('expected refusal');
    expect(analysis.refusals.map((entry) => entry.category)).toEqual([
      'app-context',
      'trust-decision',
    ]);
  });

  it('ignores local export declarations without a module specifier', () => {
    expect(
      analyzeBrowserAuthoringV1Migration({
        fileName: 'bindings.ts',
        source: 'const local = 1;\nexport { local };\nexport type { LocalType };\n',
      }),
    ).toEqual({
      source: 'const local = 1;\nexport { local };\nexport type { LocalType };\n',
      status: 'unchanged',
      refusals: [],
    });
  });

  it('keeps the whole write batch unchanged when any file is refused', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-browser-authoring-v1-'));
    const rewritePath = path.join(root, 'rewrite.ts');
    const refusalPath = path.join(root, 'refuse.ts');
    const rewriteSource =
      "import { trustedHtml } from '@kovojs/browser';\ntrustedHtml(markup, 'reviewed output');\n";
    const refusalSource =
      "import { derive } from '@kovojs/browser';\nderive(['cart'], cart => cart.count);\n";

    try {
      writeFileSync(rewritePath, rewriteSource);
      writeFileSync(refusalPath, refusalSource);
      const result = runBrowserAuthoringV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['rewrite.ts', 'refuse.ts'],
      });

      expect(result.summary).toEqual({ refused: 1, rewritten: 1, unchanged: 0 });
      expect(readFileSync(rewritePath, 'utf8')).toBe(rewriteSource);
      expect(readFileSync(refusalPath, 'utf8')).toBe(refusalSource);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('atomically writes a fully mechanical batch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-browser-authoring-v1-'));
    const sourcePath = path.join(root, 'content.ts');
    try {
      writeFileSync(
        sourcePath,
        "import { trustedUrl } from '@kovojs/browser';\ntrustedUrl(url, 'reviewed redirect');\n",
      );
      const result = runBrowserAuthoringV1Migration({
        cwd: root,
        mode: 'write',
        sourcePaths: ['content.ts'],
      });

      expect(result.summary).toEqual({ refused: 0, rewritten: 1, unchanged: 0 });
      expect(readFileSync(sourcePath, 'utf8')).toContain(
        "trustedUrl(url, { reason: 'reviewed redirect' })",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
