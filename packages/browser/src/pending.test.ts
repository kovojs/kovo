import { describe, expect, it } from 'vitest';

import {
  encodeFrameworkIdentityToken,
  encodeFrameworkQueryDependencyToken,
} from '@kovojs/core/internal/wire-input-grammar';

import { familyPendingQuerySelector, readDeps, stampPendingQueries } from './pending.js';
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
    expect(stampPendingQueries(root, [familyPendingQuerySelector('cart')], true)).toEqual([
      'cart',
      'product:p1,cart',
    ]);
    expect(cart.attributes).toMatchObject({ 'aria-busy': 'true', 'kovo-pending': '' });
    expect(recommendations.attributes).toMatchObject({ 'aria-busy': 'true', 'kovo-pending': '' });
    expect(profile.attributes).not.toHaveProperty('kovo-pending');
    expect(empty.attributes).not.toHaveProperty('kovo-pending');

    expect(stampPendingQueries(root, [familyPendingQuerySelector('cart')], false)).toEqual([
      'cart',
      'product:p1,cart',
    ]);
    expect(cart.attributes).not.toHaveProperty('kovo-pending');
    expect(cart.attributes).not.toHaveProperty('aria-busy');
    expect(recommendations.attributes).not.toHaveProperty('kovo-pending');
    expect(recommendations.attributes).not.toHaveProperty('aria-busy');
  });

  it('strictly decodes canonical dependency tokens separated by ASCII spaces', () => {
    expect(readDeps(' cart product%3Ap1  inventory ')).toEqual([
      { kind: 'exact', name: 'cart' },
      { kind: 'exact', name: 'product:p1' },
      { kind: 'exact', name: 'inventory' },
    ]);
    expect(readDeps(null)).toEqual([]);
    expect(() => readDeps('cart,product%3Ap1')).toThrow(/canonical query identity tokens/iu);
    expect(() => readDeps('product:p1')).toThrow(/canonical query identity tokens/iu);
    expect(() => readDeps('cart\ninventory')).toThrow(/canonical query identity tokens/iu);
  });

  it('decodes keyed dependency frames without aliasing an unkeyed name', () => {
    const keyed = encodeFrameworkQueryDependencyToken('foo', 'bar')!;
    const collidingUnkeyed = encodeFrameworkQueryDependencyToken('bar')!;
    const reservedUnkeyed = encodeFrameworkQueryDependencyToken('!foo!bar')!;
    expect(readDeps(`${keyed} ${collidingUnkeyed} ${reservedUnkeyed}`)).toEqual([
      { key: 'bar', kind: 'exact', name: 'foo' },
      { kind: 'exact', name: 'bar' },
      { kind: 'exact', name: '!foo!bar' },
    ]);
    expect(() => readDeps('!foo!bar!tail')).toThrow(/canonical query identity tokens/iu);
    expect(() => readDeps(`${keyed} ${keyed}`)).toThrow(/unique/iu);
    expect(() => readDeps(`${collidingUnkeyed} ${collidingUnkeyed}`)).toThrow(/unique/iu);
  });

  it('rejects dependency metadata outside the shared wire length and entry budgets', () => {
    const identity = `product:${'漢'.repeat(5_000)}`;
    const token = encodeFrameworkIdentityToken(identity)!;
    expect(token.length).toBeGreaterThan(4_096);
    expect(() => readDeps(token)).toThrow(/bounded wire length/iu);
    expect(() =>
      readDeps(
        Array.from({ length: 65 }, (_, index) =>
          encodeFrameworkQueryDependencyToken(`query-${index}`),
        ).join(' '),
      ),
    ).toThrow(/bounded identity count/iu);
  });

  it('keeps exact instances separate from name families and key/name collisions', () => {
    const keyedFoo = new FakePendingElement({
      'kovo-deps': encodeFrameworkQueryDependencyToken('foo', 'bar')!,
    });
    const unkeyedFoo = new FakePendingElement({
      'kovo-deps': encodeFrameworkQueryDependencyToken('foo')!,
    });
    const unkeyedBar = new FakePendingElement({
      'kovo-deps': encodeFrameworkQueryDependencyToken('bar')!,
    });
    const root = new FakePendingRoot([keyedFoo, unkeyedFoo, unkeyedBar]);

    expect(stampPendingQueries(root, readDeps('!foo!bar'), true)).toEqual(['bar']);
    expect(keyedFoo.attributes).toHaveProperty('kovo-pending');
    expect(unkeyedFoo.attributes).not.toHaveProperty('kovo-pending');
    expect(unkeyedBar.attributes).not.toHaveProperty('kovo-pending');

    stampPendingQueries(root, readDeps('!foo!bar'), false);
    expect(stampPendingQueries(root, [familyPendingQuerySelector('bar')], true)).toEqual(['bar']);
    expect(keyedFoo.attributes).not.toHaveProperty('kovo-pending');
    expect(unkeyedBar.attributes).toHaveProperty('kovo-pending');
  });
});
