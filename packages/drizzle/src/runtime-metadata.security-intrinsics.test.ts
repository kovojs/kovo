import { describe, expect, it } from 'vitest';
import { pgTable, text } from 'drizzle-orm/pg-core';

import { kovo } from './drizzle-surface.js';
import { extractKovoRuntimeDbMetadata } from './runtime-metadata.js';

describe('runtime metadata security intrinsics', () => {
  it('retains reviewed owner and secret metadata under late Object.assign poison', () => {
    const originalAssign = Object.assign;
    Object.assign = ((target: object) => target) as typeof Object.assign;
    let annotation;
    try {
      annotation = kovo({
        domain: 'account',
        key: 'id',
        owner: 'ownerId',
        secret: ['secret'],
      });
    } finally {
      Object.assign = originalAssign;
    }
    const accounts = pgTable(
      'accounts',
      {
        id: text('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
        secret: text('secret').notNull(),
      },
      annotation,
    );

    const metadata = extractKovoRuntimeDbMetadata([accounts]);
    expect(metadata.authorizationClassificationsByTable.get('accounts')).toEqual(['owned']);
    expect(metadata.ownerSourcesByTable.get('accounts')).toEqual({
      columnKey: 'ownerId',
      columnName: 'owner_id',
      table: 'accounts',
    });
    expect([...(metadata.secretColumnNamesByTable.get('accounts') ?? [])]).toEqual(['secret']);
  });

  it('retains authorization classifications under late filter poison', () => {
    const accounts = pgTable(
      'accounts_filter',
      { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
      kovo({ domain: 'account', key: 'id', owner: 'ownerId' }),
    );
    const originalFilter = Array.prototype.filter;
    Array.prototype.filter = function () {
      return [];
    } as typeof Array.prototype.filter;
    try {
      const metadata = extractKovoRuntimeDbMetadata([accounts]);
      expect(metadata.authorizationClassificationsByTable.get('accounts_filter')).toEqual([
        'owned',
      ]);
      expect(metadata.ownerSourcesByTable.has('accounts_filter')).toBe(true);
    } finally {
      Array.prototype.filter = originalFilter;
    }
  });

  it('uses boot-pinned map, set, object, and array controls for extraction', () => {
    const accounts = pgTable(
      'accounts_intrinsics',
      {
        id: text('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
        passwordHash: text('password_hash').notNull(),
        secret: text('secret').notNull(),
      },
      kovo({ domain: 'account', key: 'id', owner: 'ownerId', secret: ['secret'] }),
    );
    const originals = {
      arrayFilter: Array.prototype.filter,
      arrayFlatMap: Array.prototype.flatMap,
      arrayIsArray: Array.isArray,
      mapForEach: Map.prototype.forEach,
      mapGet: Map.prototype.get,
      mapHas: Map.prototype.has,
      mapSet: Map.prototype.set,
      objectEntries: Object.entries,
      objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
      objectGetOwnPropertySymbols: Object.getOwnPropertySymbols,
      objectKeys: Object.keys,
      objectValues: Object.values,
      setAdd: Set.prototype.add,
      setForEach: Set.prototype.forEach,
      setHas: Set.prototype.has,
      setSize: Object.getOwnPropertyDescriptor(Set.prototype, 'size')!,
    };
    let metadata;
    try {
      Array.prototype.filter = (() => []) as typeof Array.prototype.filter;
      Array.prototype.flatMap = (() => []) as typeof Array.prototype.flatMap;
      Array.isArray = (() => false) as typeof Array.isArray;
      Map.prototype.forEach = (() => undefined) as typeof Map.prototype.forEach;
      Map.prototype.get = (() => undefined) as typeof Map.prototype.get;
      Map.prototype.has = (() => false) as typeof Map.prototype.has;
      Map.prototype.set = function () {
        return this;
      } as typeof Map.prototype.set;
      Object.entries = (() => []) as typeof Object.entries;
      Object.getOwnPropertyDescriptor = (() => undefined) as typeof Object.getOwnPropertyDescriptor;
      Object.getOwnPropertySymbols = (() => []) as typeof Object.getOwnPropertySymbols;
      Object.keys = (() => []) as typeof Object.keys;
      Object.values = (() => []) as typeof Object.values;
      Set.prototype.add = function () {
        return this;
      } as typeof Set.prototype.add;
      Set.prototype.forEach = (() => undefined) as typeof Set.prototype.forEach;
      Set.prototype.has = (() => false) as typeof Set.prototype.has;
      Object.defineProperty(Set.prototype, 'size', { configurable: true, get: () => 0 });
      metadata = extractKovoRuntimeDbMetadata([accounts]);
    } finally {
      Array.prototype.filter = originals.arrayFilter;
      Array.prototype.flatMap = originals.arrayFlatMap;
      Array.isArray = originals.arrayIsArray;
      Map.prototype.forEach = originals.mapForEach;
      Map.prototype.get = originals.mapGet;
      Map.prototype.has = originals.mapHas;
      Map.prototype.set = originals.mapSet;
      Object.entries = originals.objectEntries;
      Object.getOwnPropertyDescriptor = originals.objectGetOwnPropertyDescriptor;
      Object.getOwnPropertySymbols = originals.objectGetOwnPropertySymbols;
      Object.keys = originals.objectKeys;
      Object.values = originals.objectValues;
      Set.prototype.add = originals.setAdd;
      Set.prototype.forEach = originals.setForEach;
      Set.prototype.has = originals.setHas;
      Object.defineProperty(Set.prototype, 'size', originals.setSize);
    }

    expect(metadata.authorizationClassificationsByTable.get('accounts_intrinsics')).toEqual([
      'owned',
    ]);
    expect(metadata.ownerSourcesByTable.get('accounts_intrinsics')?.columnName).toBe('owner_id');
    expect([...(metadata.governedColumnNamesByTable.get('accounts_intrinsics') ?? [])]).toEqual([
      'id',
      'owner_id',
      'password_hash',
    ]);
    expect([...(metadata.secretColumnNamesByTable.get('accounts_intrinsics') ?? [])]).toEqual([
      'secret',
    ]);
  });

  it('returns frozen non-native snapshots with no captured-prototype mutation receiver', () => {
    const accounts = pgTable(
      'accounts_frozen',
      { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
      kovo({ domain: 'account', key: 'id', owner: 'ownerId' }),
    );
    const metadata = extractKovoRuntimeDbMetadata([accounts]);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.authorizationClassificationsByTable)).toBe(true);
    expect(
      Object.isFrozen(metadata.authorizationClassificationsByTable.get('accounts_frozen')!),
    ).toBe(true);
    expect(
      (metadata.authorizationClassificationsByTable as unknown as { set?: unknown }).set,
    ).toBeUndefined();
    expect(() =>
      Map.prototype.set.call(metadata.authorizationClassificationsByTable, 'accounts_frozen', [
        'public',
      ]),
    ).toThrow();
    expect(() =>
      Set.prototype.add.call(metadata.schemaTableNames, 'attacker_public_table'),
    ).toThrow();
    expect(metadata.authorizationClassificationsByTable.get('accounts_frozen')).toEqual(['owned']);
    expect(metadata.schemaTableNames.has('attacker_public_table')).toBe(false);
  });
});
