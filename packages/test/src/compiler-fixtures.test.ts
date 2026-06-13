import { describe, expect, it } from 'vitest';

import { compilerDiagnosticFacts, compilerUpdateCoverageFacts } from './compiler-fixtures.js';

describe('@jiso/test compiler fixture facts', () => {
  it('projects diagnostics without source-offset pins', () => {
    expect(
      compilerDiagnosticFacts(
        [
          {
            code: 'FW311',
            fileName: 'components/cart.tsx',
            length: 12,
            message: 'missing update coverage',
            severity: 'warn',
            start: { column: 5, line: 9 },
          },
          {
            code: 'FW210',
            message: 'lint',
            severity: 'lint',
          },
        ],
        ['FW311'],
      ),
    ).toEqual([
      {
        code: 'FW311',
        fileName: 'components/cart.tsx',
        message: 'missing update coverage',
        severity: 'warn',
      },
    ]);
  });

  it('projects update coverage without source spans', () => {
    expect(
      compilerUpdateCoverageFacts([
        {
          componentName: 'CartBadge',
          detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
          position: 'expression',
          query: 'cart.discount',
          sourceSpan: { length: 13, start: 355 },
          status: 'UNHANDLED',
        },
      ]),
    ).toEqual([
      {
        component: 'CartBadge',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'cart.discount',
        status: 'UNHANDLED',
      },
    ]);
  });
});
