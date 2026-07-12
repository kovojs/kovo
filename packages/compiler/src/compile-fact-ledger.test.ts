import { describe, expect, it } from 'vitest';

import { createCompileFactLedger } from './compile-fact-ledger.js';

describe('CompileFactLedger', () => {
  it('does not let late array traversal erase authority-bearing facts', () => {
    const ledger = createCompileFactLedger();
    const owner = { phase: 'validate' as const, pass: 'output-security' };
    const facts = [
      {
        context: 'url-attribute' as const,
        sink: 'href',
        source: 'client-query' as const,
        writer: 'query attribute binding',
      },
    ];
    const originalMap = Array.prototype.map;
    let poisonHits = 0;

    try {
      Array.prototype.map = function eraseFacts(callback, thisArg) {
        if (this === facts) {
          poisonHits += 1;
          return [];
        }
        return Reflect.apply(originalMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      ledger.append('outputContexts', owner, facts);
    } finally {
      Array.prototype.map = originalMap;
    }

    expect(ledger.snapshot().outputContexts).toEqual(facts);
    expect(poisonHits).toBe(0);
  });

  it('does not retain caller-owned fact or owner authority after append', () => {
    const ledger = createCompileFactLedger();
    const owner = { phase: 'validate' as const, pass: 'output-security' };
    const facts = [
      {
        context: 'url-attribute' as const,
        sink: 'href',
        source: 'client-query' as const,
        writer: 'query attribute binding',
      },
    ];

    ledger.append('outputContexts', owner, facts);
    facts[0]!.sink = 'srcdoc';
    owner.pass = 'attacker-pass';
    facts.length = 0;

    const snapshot = ledger.snapshot();
    expect(snapshot.outputContexts).toEqual([
      {
        context: 'url-attribute',
        sink: 'href',
        source: 'client-query',
        writer: 'query attribute binding',
      },
    ]);
    expect(snapshot.owners).toEqual([{ phase: 'validate', pass: 'output-security' }]);
    expect(Object.isFrozen(snapshot.outputContexts[0])).toBe(true);
  });

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
    expect(snapshot.familyHashes.queryUpdatePlans).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.factHash).toBe(ledger.snapshot().factHash);

    const changed = createCompileFactLedger();
    changed.append('queryUpdatePlans', owner, [
      { componentName: 'CartBadge', paths: ['cart.count'], query: 'cart' },
    ]);

    expect(changed.snapshot().factHash).not.toBe(snapshot.factHash);
  });
});
