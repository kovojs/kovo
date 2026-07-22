import { describe, expect, it } from 'vitest';

import { compilerSourceSyntaxBudget } from './source-syntax-budget.js';

describe('compiler source syntax budget', () => {
  it('admits the exact node boundary and rejects max plus one', () => {
    const source = Array.from({ length: 300 }, (_, index) => `const v${index} = ${index};`).join(
      '\n',
    );
    const measured = compilerSourceSyntaxBudget('boundary.tsx', source, {
      maxDepth: 10_000,
      maxNodes: 10_000,
    });
    expect(measured.ok).toBe(true);

    expect(
      compilerSourceSyntaxBudget('boundary.tsx', source, {
        maxDepth: 10_000,
        maxNodes: measured.nodeCount,
      }),
    ).toMatchObject({ nodeCount: measured.nodeCount, ok: true });
    expect(
      compilerSourceSyntaxBudget('boundary.tsx', source, {
        maxDepth: 10_000,
        maxNodes: measured.nodeCount - 1,
      }),
    ).toMatchObject({ nodeCount: measured.nodeCount, ok: false, reason: 'nodes' });
  });

  it('admits the exact depth boundary and rejects max plus one', () => {
    const source = `${'<div>'.repeat(80)}x${'</div>'.repeat(80)}`;
    const measured = compilerSourceSyntaxBudget('boundary.tsx', source, {
      maxDepth: 10_000,
      maxNodes: 10_000,
    });
    expect(measured.ok).toBe(true);

    expect(
      compilerSourceSyntaxBudget('boundary.tsx', source, {
        maxDepth: measured.maxDepth,
        maxNodes: 10_000,
      }),
    ).toMatchObject({ maxDepth: measured.maxDepth, ok: true });
    expect(
      compilerSourceSyntaxBudget('boundary.tsx', source, {
        maxDepth: measured.maxDepth - 1,
        maxNodes: 10_000,
      }),
    ).toMatchObject({ maxDepth: measured.maxDepth, ok: false, reason: 'depth' });
  });
});
