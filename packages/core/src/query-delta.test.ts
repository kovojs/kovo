import { describe, expect, it } from 'vitest';

import type { JsonValue } from './index.js';
import {
  applyQueryDelta,
  buildQueryDelta,
  QueryDeltaApplyError,
  queryDeltaIsSmaller,
  type QueryDeltaListMeta,
} from './query-delta.js';

const CART_META: readonly QueryDeltaListMeta[] = [{ domain: 'cart', key: 'id', path: 'items' }];

function affected(domain: string, keys: readonly string[]): Map<string, Set<string>> {
  return new Map([[domain, new Set(keys)]]);
}

describe('buildQueryDelta', () => {
  it('emits only change-record-scoped rows plus non-collection fields', () => {
    const value: JsonValue = {
      count: 3,
      items: [
        { id: 'p1', qty: 2, name: 'Mug' },
        { id: 'p2', qty: 1, name: 'Hat' },
      ],
    };

    const delta = buildQueryDelta(value, affected('cart', ['p1']), CART_META);

    expect(delta).toEqual({
      set: { count: 3 },
      lists: { items: { key: 'id', upsert: [{ id: 'p1', qty: 2, name: 'Mug' }] } },
    });
  });

  it('reports removed keys when an affected key is absent from the re-run value', () => {
    const value: JsonValue = { count: 1, items: [{ id: 'p1', qty: 2 }] };

    // The mutation touched p2 (deleted it); it is gone from the re-run value.
    const delta = buildQueryDelta(value, affected('cart', ['p1', 'p2']), CART_META);

    expect(delta?.lists?.items).toEqual({
      key: 'id',
      upsert: [{ id: 'p1', qty: 2 }],
      remove: ['p2'],
    });
  });

  it('falls back to full (undefined) when the domain carries no explicit keys', () => {
    const value: JsonValue = { count: 1, items: [{ id: 'p1', qty: 2 }] };
    expect(buildQueryDelta(value, affected('cart', []), CART_META)).toBeUndefined();
    expect(buildQueryDelta(value, new Map(), CART_META)).toBeUndefined();
  });

  it('falls back to full when there is no collection metadata or value is not an object', () => {
    expect(buildQueryDelta({ count: 1 }, affected('cart', ['p1']), [])).toBeUndefined();
    expect(buildQueryDelta([1, 2, 3], affected('cart', ['p1']), CART_META)).toBeUndefined();
    expect(buildQueryDelta(42, affected('cart', ['p1']), CART_META)).toBeUndefined();
  });

  it('falls back to full when a row is missing its key field', () => {
    const value: JsonValue = { items: [{ qty: 2 }] };
    expect(buildQueryDelta(value, affected('cart', ['p1']), CART_META)).toBeUndefined();
  });
});

describe('applyQueryDelta', () => {
  it('upserts an existing row in place', () => {
    const base: JsonValue = {
      count: 2,
      items: [
        { id: 'p1', qty: 1 },
        { id: 'p2', qty: 5 },
      ],
    };
    const next = applyQueryDelta(base, {
      set: { count: 3 },
      lists: { items: { key: 'id', upsert: [{ id: 'p1', qty: 2 }] } },
    });
    expect(next).toEqual({
      count: 3,
      items: [
        { id: 'p1', qty: 2 },
        { id: 'p2', qty: 5 },
      ],
    });
  });

  it('appends new rows and removes by key, preserving surviving order', () => {
    const base: JsonValue = {
      items: [
        { id: 'p1', qty: 1 },
        { id: 'p2', qty: 1 },
      ],
    };
    const next = applyQueryDelta(base, {
      lists: { items: { key: 'id', upsert: [{ id: 'p3', qty: 9 }], remove: ['p1'] } },
    });
    expect(next).toEqual({
      items: [
        { id: 'p2', qty: 1 },
        { id: 'p3', qty: 9 },
      ],
    });
  });

  it('does not mutate the base value', () => {
    const base: JsonValue = { count: 1, items: [{ id: 'p1', qty: 1 }] };
    const snapshot = structuredClone(base);
    applyQueryDelta(base, { set: { count: 2 }, lists: { items: { key: 'id', remove: ['p1'] } } });
    expect(base).toEqual(snapshot);
  });

  it('throws on a missing base so the caller refetches full', () => {
    expect(() => applyQueryDelta(undefined, { set: { count: 1 } })).toThrow(QueryDeltaApplyError);
  });

  it('throws when a delta targets a base field whose shape moved (deploy skew)', () => {
    const base: JsonValue = { items: { not: 'an array' } };
    expect(() =>
      applyQueryDelta(base, { lists: { items: { key: 'id', upsert: [{ id: 'p1' }] } } }),
    ).toThrow(QueryDeltaApplyError);
  });
});

describe('round-trip equivalence (the §9.1.1 apply_delta ≡ full gate)', () => {
  const meta = CART_META;
  const base: JsonValue = {
    count: 2,
    total: 30,
    items: [
      { id: 'p1', qty: 1, name: 'Mug' },
      { id: 'p2', qty: 1, name: 'Hat' },
    ],
  };

  const scenarios: { name: string; full: JsonValue; keys: string[] }[] = [
    {
      name: 'quantity bump',
      full: {
        count: 3,
        total: 40,
        items: [
          { id: 'p1', qty: 2, name: 'Mug' },
          { id: 'p2', qty: 1, name: 'Hat' },
        ],
      },
      keys: ['p1'],
    },
    {
      name: 'remove an item',
      full: { count: 1, total: 20, items: [{ id: 'p2', qty: 1, name: 'Hat' }] },
      keys: ['p1'],
    },
    {
      name: 'add an item',
      full: {
        count: 3,
        total: 50,
        items: [
          { id: 'p1', qty: 1, name: 'Mug' },
          { id: 'p2', qty: 1, name: 'Hat' },
          { id: 'p3', qty: 1, name: 'Pen' },
        ],
      },
      keys: ['p3'],
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}: applying the delta to the base equals the full re-run`, () => {
      const delta = buildQueryDelta(scenario.full, affected('cart', scenario.keys), meta);
      expect(delta).toBeDefined();
      // Order-insensitive comparison for items (the delta appends new rows).
      const applied = applyQueryDelta(base, delta!) as { items: JsonValue[] };
      const expected = scenario.full as { items: JsonValue[] };
      expect(sortItems(applied)).toEqual(sortItems(expected));
    });
  }

  function sortItems(value: { items: JsonValue[] }): JsonValue {
    return {
      ...value,
      items: [...value.items].sort((a, b) =>
        String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)),
      ),
    };
  }
});

describe('queryDeltaIsSmaller', () => {
  it('is true when the delta serializes smaller than the full value', () => {
    const value: JsonValue = {
      count: 2,
      items: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, qty: 1, name: `Item ${i}` })),
    };
    const delta = buildQueryDelta(value, affected('cart', ['p1']), CART_META);
    expect(delta).toBeDefined();
    expect(queryDeltaIsSmaller(delta!, value)).toBe(true);
  });

  it('is false when the delta is not smaller (whole collection touched)', () => {
    const value: JsonValue = { items: [{ id: 'p1', qty: 1 }] };
    const delta = buildQueryDelta(value, affected('cart', ['p1']), CART_META);
    expect(delta).toBeDefined();
    expect(queryDeltaIsSmaller(delta!, value)).toBe(false);
  });
});
