import { describe, expect, it } from 'vitest';

import { createCompileFactLedger } from './compile-fact-ledger.js';

describe('CompileFactLedger', () => {
  it('merges typed fact families with stable owner metadata and snapshot hashes', () => {
    const ledger = createCompileFactLedger();
    const owner = { phase: 'lower' as const, pass: 'style-extraction' };

    ledger.append('queryUpdatePlans', owner, [
      { componentName: 'CartBadge', paths: ['cart.count'], query: 'cart' },
      { componentName: 'CartBadge', paths: ['cart.total'], query: 'cart' },
    ]);
    ledger.append('outputContexts', owner, [
      { context: 'attribute', sink: 'class', source: 'client-query', writer: 'style' },
      { context: 'attribute', sink: 'class', source: 'client-query', writer: 'style' },
    ]);

    const snapshot = ledger.snapshot();

    expect(snapshot.queryUpdatePlans).toEqual([
      { componentName: 'CartBadge', paths: ['cart.count', 'cart.total'], query: 'cart' },
    ]);
    expect(snapshot.outputContexts).toHaveLength(1);
    expect(snapshot.owners).toEqual([owner]);
    expect(snapshot.familyHashes.queryUpdatePlans).toMatch(/^[0-9a-f]{8}$/);
    expect(snapshot.factHash).toBe(ledger.snapshot().factHash);

    const changed = createCompileFactLedger();
    changed.append('queryUpdatePlans', owner, [
      { componentName: 'CartBadge', paths: ['cart.count'], query: 'cart' },
    ]);

    expect(changed.snapshot().factHash).not.toBe(snapshot.factHash);
  });
});
