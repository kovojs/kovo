import { describe, expect, it } from 'vitest';

import { stampPendingQueries as stampPendingQueriesFromIndex } from './client.js';
import { readDeps, stampPendingQueries } from './pending.js';
import { FakePendingElement, FakePendingRoot } from './runtime-test-fakes.js';

describe('pending query stamps', () => {
  it('exports the pending stamper through the runtime barrel', () => {
    expect(stampPendingQueriesFromIndex).toBe(stampPendingQueries);
  });

  it('stamps only islands that depend on affected queries', () => {
    const cart = new FakePendingElement({ 'kovo-deps': 'cart' });
    const recommendations = new FakePendingElement({ 'kovo-deps': 'product:p1, cart' });
    const profile = new FakePendingElement({ 'kovo-deps': 'profile' });
    const empty = new FakePendingElement({ 'kovo-deps': ' , ' });
    const root = new FakePendingRoot([cart, recommendations, profile, empty]);

    // SPEC.md §10.4: optimistic mutation predictions mark dependent islands
    // pending until the server response covers or discards the predicted query.
    expect(stampPendingQueries(root, ['cart'], true)).toEqual(['cart', 'product:p1,cart']);
    expect(cart.attributes).toMatchObject({ 'aria-busy': 'true', 'kovo-pending': '' });
    expect(recommendations.attributes).toMatchObject({ 'aria-busy': 'true', 'kovo-pending': '' });
    expect(profile.attributes).not.toHaveProperty('kovo-pending');
    expect(empty.attributes).not.toHaveProperty('kovo-pending');

    expect(stampPendingQueries(root, ['cart'], false)).toEqual(['cart', 'product:p1,cart']);
    expect(cart.attributes).not.toHaveProperty('kovo-pending');
    expect(cart.attributes).not.toHaveProperty('aria-busy');
    expect(recommendations.attributes).not.toHaveProperty('kovo-pending');
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
