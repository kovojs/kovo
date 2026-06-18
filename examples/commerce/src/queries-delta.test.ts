import { applyQueryDelta, buildQueryDelta, queryDeltaIsSmaller } from '@kovojs/core';
import type { JsonValue } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { orderHistoryQuery } from './queries.js';

// SPEC §9.1.1: prove the real commerce `orderHistory` query ships a
// change-record-scoped delta — only the newly paid order row, keyed by id —
// and that applying it to the client's held history reconstructs the full
// re-run. A mutation that records changed order ids on the `order` domain can
// use exactly this scoping.
describe('commerce orderHistory delta (SPEC §9.1.1)', () => {
  it('declares delta-eligible collections matching its result shape', () => {
    expect(orderHistoryQuery.delta).toEqual([{ domain: 'order', key: 'id', path: 'items' }]);
  });

  it('ships only the new order row and round-trips to the full re-run', () => {
    const heldHistory: JsonValue = {
      items: [{ id: 'o1', productId: 'p1', qty: 1, total: 10, userId: 'u1' }],
    };
    // The full re-run after a new order is inserted.
    const fullReRun: JsonValue = {
      items: [
        { id: 'o1', productId: 'p1', qty: 1, total: 10, userId: 'u1' },
        { id: 'o2', productId: 'p2', qty: 3, total: 60, userId: 'u1' },
      ],
    };

    const affected = new Map([['order', new Set(['o2'])]]);
    const delta = buildQueryDelta(fullReRun, affected, orderHistoryQuery.delta ?? []);

    // Only the touched order row crosses the wire, not the whole history.
    expect(delta).toEqual({
      lists: {
        items: {
          key: 'id',
          upsert: [{ id: 'o2', productId: 'p2', qty: 3, total: 60, userId: 'u1' }],
        },
      },
    });
    expect(queryDeltaIsSmaller(delta!, fullReRun)).toBe(true);

    // Applying the delta to the client's held history equals the full re-run.
    expect(applyQueryDelta(heldHistory, delta!)).toEqual(fullReRun);
  });
});
