import { describe, expect, it } from 'vitest';

import { encodeFrameworkIdentityToken } from '@kovojs/core/internal/wire-input-grammar';

import { readDeps, stampPendingQueries } from './pending.js';
import { FakePendingElement, FakePendingRoot } from './runtime-test-fakes.js';

describe('pending query stamps', () => {
  it('stamps only islands that depend on affected queries', () => {
    const cart = new FakePendingElement({ 'kovo-deps': 'cart' });
    const recommendations = new FakePendingElement({ 'kovo-deps': 'product%3Ap1 cart' });
    const profile = new FakePendingElement({ 'kovo-deps': 'profile' });
    const empty = new FakePendingElement({ 'kovo-deps': '   ' });
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

  it('strictly decodes canonical dependency tokens separated by ASCII spaces', () => {
    expect(readDeps(' cart product%3Ap1  inventory cart ')).toEqual([
      'cart',
      'product:p1',
      'inventory',
      'cart',
    ]);
    expect(readDeps(null)).toEqual([]);
    expect(() => readDeps('cart,product%3Ap1')).toThrow(/canonical identity tokens/iu);
    expect(() => readDeps('product:p1')).toThrow(/canonical identity tokens/iu);
    expect(() => readDeps('cart\ninventory')).toThrow(/canonical identity tokens/iu);
  });

  it('preserves long valid DOM identities independently of the HTTP budget', () => {
    const identity = `product:${'漢'.repeat(5_000)}`;
    const token = encodeFrameworkIdentityToken(identity)!;
    expect(token.length).toBeGreaterThan(4_096);
    expect(readDeps(token)).toEqual([identity]);
  });
});
