import { describe, expect, it } from 'vitest';

import { stampPendingQueries as stampPendingQueriesFromIndex } from './index.js';
import { readDeps, stampPendingQueries } from './pending.js';
import { FakePendingElement, FakePendingRoot } from './runtime-test-fakes.js';

describe('pending query stamps', () => {
  it('exports the pending stamper through the runtime barrel', () => {
    expect(stampPendingQueriesFromIndex).toBe(stampPendingQueries);
  });

  it('stamps only islands that depend on affected queries', () => {
    const cart = new FakePendingElement({ 'fw-deps': 'cart' });
    const recommendations = new FakePendingElement({ 'fw-deps': 'product:p1, cart' });
    const profile = new FakePendingElement({ 'fw-deps': 'profile' });
    const empty = new FakePendingElement({ 'fw-deps': ' , ' });
    const root = new FakePendingRoot([cart, recommendations, profile, empty]);

    // SPEC.md §10.4: optimistic mutation predictions mark dependent islands
    // pending until the server response covers or discards the predicted query.
    expect(stampPendingQueries(root, ['cart'], true)).toEqual(['cart', 'product:p1,cart']);
    expect(cart.attributes).toMatchObject({ 'aria-busy': 'true', 'fw-pending': '' });
    expect(recommendations.attributes).toMatchObject({ 'aria-busy': 'true', 'fw-pending': '' });
    expect(profile.attributes).not.toHaveProperty('fw-pending');
    expect(empty.attributes).not.toHaveProperty('fw-pending');

    expect(stampPendingQueries(root, ['cart'], false)).toEqual(['cart', 'product:p1,cart']);
    expect(cart.attributes).not.toHaveProperty('fw-pending');
    expect(cart.attributes).not.toHaveProperty('aria-busy');
    expect(recommendations.attributes).not.toHaveProperty('fw-pending');
    expect(recommendations.attributes).not.toHaveProperty('aria-busy');
  });

  it('parses dependency lists with whitespace and comma separators', () => {
    expect(readDeps(' cart, product:p1\ninventory\t\tcart ')).toEqual([
      'cart',
      'product:p1',
      'inventory',
      'cart',
    ]);
    expect(readDeps(null)).toEqual([]);
  });
});
