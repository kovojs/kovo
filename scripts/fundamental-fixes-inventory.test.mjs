import { describe, expect, it } from 'vitest';

import {
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
  });
});
