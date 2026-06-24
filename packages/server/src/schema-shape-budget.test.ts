import { describe, expect, it } from 'vitest';

import { assertShapeWithinBudget, configureShapeBudget, parseSchemaAsync, s } from './schema.js';

// KV430 (SPEC §6.6/§9.5): the runtime input-shape budget that bounds untrusted wire
// input before the schema descends, closing the small-body-huge-shape DoS class.
describe('KV430 input-shape DoS budget', () => {
  it('rejects a deeply-nested input WITHOUT overflowing the call stack', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 50_000; i += 1) deep = { a: deep };
    // The check is iterative, so it throws a bounded validation error (depth), never a
    // RangeError: Maximum call stack size exceeded.
    expect(() => assertShapeWithinBudget(deep)).toThrowError(/depth/i);
  });

  it('rejects the 4000-deep array attack before the schema descends', async () => {
    let arr: unknown = [];
    for (let i = 0; i < 4000; i += 1) arr = [arr];
    await expect(parseSchemaAsync(s.array(s.string()), arr)).rejects.toThrow(/depth/i);
  });

  it('rejects an over-wide container', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 10_001; i += 1) wide[`k${i}`] = i;
    expect(() => assertShapeWithinBudget(wide)).toThrowError(/breadth/i);
  });

  it('rejects an over-large total node count', () => {
    configureShapeBudget({ maxNodes: 100 });
    try {
      const big = Array.from({ length: 500 }, (_, i) => ({ i }));
      expect(() => assertShapeWithinBudget(big)).toThrowError(/node count/i);
    } finally {
      configureShapeBudget({ maxNodes: 200_000 });
    }
  });

  it('passes a legitimate nested input and still parses it correctly', async () => {
    const ok = { items: ['a', 'b', 'c'], meta: { count: '3' } };
    expect(() => assertShapeWithinBudget(ok)).not.toThrow();
    const parsed = await parseSchemaAsync(
      s.object({ items: s.array(s.string()), meta: s.object({ count: s.number() }) }),
      ok,
    );
    expect(parsed.items).toEqual(['a', 'b', 'c']);
    expect(parsed.meta.count).toBe(3);
  });

  it('treats host objects (Date) as leaves and does not descend them', () => {
    expect(() => assertShapeWithinBudget({ when: new Date(), n: 1 })).not.toThrow();
  });

  it('configureShapeBudget tightens then restores the global ceiling', () => {
    configureShapeBudget({ maxDepth: 2 });
    try {
      // maxDepth 2 permits containers at depth 0..2; a container at depth 3 is rejected.
      expect(() => assertShapeWithinBudget({ a: { b: { c: { d: 1 } } } })).toThrowError(/depth/i);
      expect(() => assertShapeWithinBudget({ a: { b: 1 } })).not.toThrow();
    } finally {
      configureShapeBudget({ maxDepth: 64 });
    }
  });
});
