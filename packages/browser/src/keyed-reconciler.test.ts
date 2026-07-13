import { describe, expect, it } from 'vitest';

import { reconcileKeyed } from './keyed-reconciler.js';
import { morphStructuralTree, type StructuralMorphNode } from './morph.js';

describe('keyed reconciliation kernel', () => {
  it('matches, removes, inserts, and reorders rows by key while preserving matched identity', () => {
    const current = [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
      { key: 'c', value: 3 },
    ];
    const inserted = { key: 'd', value: 4 };

    const next = reconcileKeyed(current, [current[2]!, inserted, current[0]!], {
      create(item) {
        return { ...item };
      },
      currentKey(item) {
        return item.key;
      },
      match(currentItem, nextItem) {
        currentItem.value = nextItem.value;
        return currentItem;
      },
      nextKey(item) {
        return item.key;
      },
    });

    // SPEC.md §13.2: keyed identity, not position, owns reuse and order.
    expect(next.map((item) => item.key)).toEqual(['c', 'd', 'a']);
    expect(next[0]).toBe(current[2]);
    expect(next[1]).not.toBe(inserted);
    expect(next[2]).toBe(current[0]);
    expect(next).not.toContain(current[1]);
  });

  it('keeps structural morph duplicate-key diagnostics on the shared kernel adapter', () => {
    const current: StructuralMorphNode = {
      children: [
        { key: 'dup', type: 'li' },
        { key: 'dup', type: 'li' },
      ],
      type: 'ul',
    };

    expect(() =>
      morphStructuralTree(current, {
        children: [{ key: 'dup', type: 'li' }],
        type: 'ul',
      }),
    ).toThrow('Duplicate current structural morph key: dup');
  });

  it('uses boot-captured array, Map, and Set controls after late prototype poisoning', () => {
    const current = [{ key: 'a' }, { key: 'b' }];
    const nextRows = [{ key: 'b' }, { key: 'c' }];
    const originalMap = Array.prototype.map;
    const originalFilter = Array.prototype.filter;
    const originalEntries = Array.prototype.entries;
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalIsArray = Array.isArray;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    const originalMapSet = Map.prototype.set;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    let result: Array<{ key: string }> | undefined;

    try {
      Array.prototype.map = () => {
        throw new Error('late Array.map poison');
      };
      Array.prototype.filter = () => {
        throw new Error('late Array.filter poison');
      };
      Array.prototype.entries = () => {
        throw new Error('late Array.entries poison');
      };
      Array.prototype[Symbol.iterator] = () => {
        throw new Error('late Array iterator poison');
      };
      Array.isArray = () => false;
      Map.prototype.get = () => {
        throw new Error('late Map.get poison');
      };
      Map.prototype.has = () => {
        throw new Error('late Map.has poison');
      };
      Map.prototype.set = () => {
        throw new Error('late Map.set poison');
      };
      Set.prototype.add = () => {
        throw new Error('late Set.add poison');
      };
      Set.prototype.has = () => {
        throw new Error('late Set.has poison');
      };

      result = reconcileKeyed(current, nextRows, {
        create: (item) => ({ ...item }),
        currentKey: (item) => item.key,
        match: (item) => item,
        nextKey: (item) => item.key,
      });
    } finally {
      Array.prototype.map = originalMap;
      Array.prototype.filter = originalFilter;
      Array.prototype.entries = originalEntries;
      Array.prototype[Symbol.iterator] = originalIterator;
      Array.isArray = originalIsArray;
      Map.prototype.get = originalMapGet;
      Map.prototype.has = originalMapHas;
      Map.prototype.set = originalMapSet;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
    }

    expect(result?.map((item) => item.key)).toEqual(['b', 'c']);
    expect(result?.[0]).toBe(current[1]);
  });

  it('rejects sparse inherited row substitutions instead of consulting Array.prototype', () => {
    const sparse = new Array<{ key: string }>(1);
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let error: unknown;
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        value: { key: 'forged' },
        writable: true,
      });
      try {
        reconcileKeyed(sparse, [], {
          create: (item) => item,
          currentKey: (item) => item.key,
          match: (item) => item,
          nextKey: (item) => item.key,
        });
      } catch (caught) {
        error = caught;
      }
    } finally {
      if (originalZero) Object.defineProperty(Array.prototype, '0', originalZero);
      else Reflect.deleteProperty(Array.prototype, '0');
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toContain('dense own data');
  });

  it('keeps large keyed reconciliation linear-time', () => {
    const current: Array<{ key: string }> = [];
    const nextRows: Array<{ key: string }> = [];
    for (let index = 0; index < 25_000; index += 1) {
      current.push({ key: `row-${index}` });
      nextRows.push({ key: `row-${24_999 - index}` });
    }
    const start = performance.now();
    const result = reconcileKeyed(current, nextRows, {
      create: (item) => ({ ...item }),
      currentKey: (item) => item.key,
      match: (item) => item,
      nextKey: (item) => item.key,
    });
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(25_000);
    expect(result[0]).toBe(current[24_999]);
    expect(elapsed).toBeLessThan(1_500);
  });
});
