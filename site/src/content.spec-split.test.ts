import { describe, expect, it } from 'vitest';

import {
  combineNormativeSpecSources,
  rewriteRenderedSpecLinksForTest,
  specModuleAnchorsForTest,
  type SpecSourcePart,
} from './content.js';

describe('split normative spec content', () => {
  const parts: SpecSourcePart[] = [
    {
      relativePath: 'SPEC.md',
      source: '# Kovo Technical Specification\n\nSee [components](spec/04-component-model.md).\n',
    },
    {
      relativePath: 'spec/04-component-model.md',
      source: '## 4. Component Model\n\n### 4.8 Binding stamps\n\nComponent module text.\n',
    },
    {
      relativePath: 'spec/11-diagnostics.md',
      source:
        '### 11.3 Diagnostic codes (registry)\n\n| Code | Severity | Meaning |\n| --- | --- | --- |\n| KV201 | error | Closure capture. |\n',
    },
  ];

  it('keeps legacy single-file output byte-for-byte when no spec modules exist', () => {
    expect(combineNormativeSpecSources([parts[0]!])).toBe(parts[0]!.source);
  });

  it('appends split spec modules to the normative corpus with source boundaries', () => {
    const combined = combineNormativeSpecSources(parts);

    expect(combined).toContain('# Kovo Technical Specification');
    expect(combined).toContain('<!-- Source: spec/04-component-model.md -->');
    expect(combined).toContain('Component module text.');
    expect(combined).toContain('<!-- Source: spec/11-diagnostics.md -->');
    expect(combined).toContain('| KV201 | error | Closure capture. |');
  });

  it('rewrites spec module links to the combined /spec/ route without breaking numeric anchors', () => {
    const ids = new Set(['4', '4-8', '11-3']);
    const anchors = specModuleAnchorsForTest(parts);

    const html = [
      '<a href="spec/04-component-model.md">components</a>',
      '<a href="./spec/11-diagnostics.md">diagnostics</a>',
      '<a href="spec/04-component-model.md#4-8">binding</a>',
      '<a href="/spec/#4-8-2">nearest existing section</a>',
    ].join('');

    expect(rewriteRenderedSpecLinksForTest(html, ids, anchors)).toBe(
      [
        '<a href="/spec/#4">components</a>',
        '<a href="/spec/#11-3">diagnostics</a>',
        '<a href="/spec/#4-8">binding</a>',
        '<a href="/spec/#4-8">nearest existing section</a>',
      ].join(''),
    );
  });
});
