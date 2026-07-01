import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectInventory,
  formatInventoryReport,
  inventorySource,
  summarizeInventory,
} from './fundamental-fixes-inventory.mjs';

describe('fundamental-fixes-inventory', () => {
  it('classifies syntactic recognizers and fail-closed sites without hard-coding repo counts', () => {
    const entries = inventorySource(
      [
        "if (callee.getText() === 'query') return true;",
        "if (node.text !== 'sql') return false;",
        "entry.importedName === 'trustedHtml' && entry.moduleSpecifier === '@kovojs/server';",
        'if (ts.isIdentifier(node)) return node.text;',
        "return { code: 'KV406', message: 'Statically un-analyzable write site' };",
      ].join('\n'),
      'packages/drizzle/src/static/example.ts',
    );
    const report = summarizeInventory(entries);

    expect(report.syntacticRecognitionCandidates).toBe(3);
    expect(report.candidateCountIsDoneSignal).toBe(false);
    expect(report.completionGate).toBe(
      'node scripts/fundamental-fixes-census-gate.mjs --require-complete',
    );
    expect(report.categories.literalTextComparisons.count).toBe(2);
    expect(report.categories.importSpecifierComparisons.count).toBe(1);
    expect(report.categories.astKindGates.count).toBe(1);
    expect(report.categories.kv406FailClosedSites.count).toBe(1);
  });

  it('formats the compact current-state report used as plan evidence', () => {
    const report = summarizeInventory([], {
      files: ['packages/compiler/src/compile.ts'],
      roots: ['packages/compiler/src'],
    });

    expect(formatInventoryReport(report)).toContain('fundamental-fixes inventory');
    expect(formatInventoryReport(report)).toContain('filesScanned: 1');
    expect(formatInventoryReport(report)).toContain(
      'syntacticRecognitionCandidates: 0 (informational; not a done signal)',
    );
    expect(formatInventoryReport(report)).toContain(
      'completionGate: node scripts/fundamental-fixes-census-gate.mjs --require-complete',
    );
  });

  it('preserves source collection filters for tests and data fixtures', async () => {
    const root = await fixtureRoot();
    await writeFixture(root, 'packages/compiler/src/compile.ts', 'ts.isIdentifier(node);\n');
    await writeFixture(
      root,
      'packages/compiler/src/compile.test.ts',
      'ts.isCallExpression(node);\n',
    );
    await writeFixture(
      root,
      'packages/compiler/src/compile.data.ts',
      'ts.isStringLiteral(node);\n',
    );
    await writeFixture(
      root,
      'packages/compiler/src/dist/generated.ts',
      'ts.isNumericLiteral(node);\n',
    );

    await expect(
      collectInventory({ root, roots: ['packages/compiler/src'] }),
    ).resolves.toMatchObject({
      filesScanned: 1,
      includeTests: false,
    });
    await expect(
      collectInventory({ includeTests: true, root, roots: ['packages/compiler/src'] }),
    ).resolves.toMatchObject({
      filesScanned: 3,
      includeTests: true,
    });
  });
});

async function fixtureRoot() {
  return mkdir(path.join(tmpdir(), `kovo-inventory-${process.pid}-${Date.now()}`), {
    recursive: true,
  });
}

async function writeFixture(rootDir, relativePath, source) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}
