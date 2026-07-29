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
      annotation = kovo((columns) => ({
        domain: 'account',
        key: columns.id,
        owner: columns.ownerId,
        secret: [columns.secret],
      }));
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
      kovo((columns) => ({ domain: 'account', key: columns.id, owner: columns.ownerId })),
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
      kovo((columns) => ({
        domain: 'account',
        key: columns.id,
        owner: columns.ownerId,
        secret: [columns.secret],
      })),
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
      kovo((columns) => ({ domain: 'account', key: columns.id, owner: columns.ownerId })),
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

  it('rejects retired selector callbacks without invoking app code', () => {
    let selectorRan = false;
    const accounts = pgTable(
      'accounts_selector_reentry',
      {
        id: text('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
        secret: text('secret').notNull(),
      },
      kovo((columns) => ({
        domain: 'account',
        key: columns.id,
        owner: ((table: { ownerId: unknown; secret: unknown }) => {
          selectorRan = true;
          table.secret = table.ownerId;
          return table.ownerId;
        }) as never,
        secret: [columns.secret],
      })),
    );
    const originalSecret = accounts.secret;

    expect(() => extractKovoRuntimeDbMetadata([accounts])).toThrow(
      /owner annotation.*exact Drizzle column identity.*SPEC §10\.1/u,
    );
    expect(selectorRan).toBe(false);
    expect(accounts.secret).toBe(originalSecret);
  });

  it('rejects a retired selector before it can mutate another table by closure', () => {
    const createVault = () =>
      pgTable(
        'selector_vault',
        {
          id: text('id').primaryKey(),
          publicValue: text('public_value').notNull(),
          secret: text('secret').notNull(),
        },
        kovo((columns) => ({ domain: 'vault', key: columns.id, secret: [columns.secret] })),
      );
    let vault!: ReturnType<typeof createVault>;
    const trigger = pgTable(
      'selector_trigger',
      { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
      kovo((columns) => ({
        domain: 'trigger',
        key: columns.id,
        owner: ((table: { ownerId: unknown }) => {
          (vault.secret as typeof vault.secret & { name: string }).name = 'public_value';
          (vault as typeof vault & { secret: unknown }).secret = vault.publicValue;
          return table.ownerId;
        }) as never,
      })),
    );
    vault = createVault();
    const originalSecretColumn = vault.secret;

    expect(() => extractKovoRuntimeDbMetadata([trigger, vault])).toThrow(
      /owner annotation.*exact Drizzle column identity.*SPEC §10\.1/u,
    );
    expect(vault.secret).toBe(originalSecretColumn);
    expect(vault.secret.name).toBe('secret');
  });

  it('rejects ownerVia selectors that return a column identity from another table', () => {
    let selectorRan = false;
    const parent = pgTable(
      'selector_parent',
      { id: text('id').primaryKey() },
      kovo((columns) => ({ domain: 'parent', key: columns.id, reference: true })),
    );
    const foreign = pgTable(
      'selector_foreign',
      { id: text('id').primaryKey() },
      kovo((columns) => ({ domain: 'foreign', key: columns.id, reference: true })),
    );
    const child = pgTable(
      'selector_child',
      { id: text('id').primaryKey(), parentId: text('parent_id').notNull() },
      kovo((columns) => ({
        domain: 'child',
        key: columns.id,
        ownerVia: {
          fk: (() => {
            selectorRan = true;
            return foreign.id;
          }) as never,
          parent,
          parentKey: (() => {
            selectorRan = true;
            return foreign.id;
          }) as never,
        },
      })),
    );

    expect(() => extractKovoRuntimeDbMetadata([parent, foreign, child])).toThrow(
      /ownerVia annotation.*exact Drizzle column identity.*SPEC §10\.1/u,
    );
    expect(selectorRan).toBe(false);
  });

  it('rejects string and structural column lookalikes even when names and tables match', () => {
    const stringOwner = pgTable(
      'retired_string_owner',
      { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
      kovo((columns) => ({
        domain: 'retired-string-owner',
        key: columns.id,
        owner: 'ownerId' as never,
      })),
    );
    const structuralOwner = pgTable(
      'structural_owner',
      { id: text('id').primaryKey(), ownerId: text('owner_id').notNull() },
      kovo((columns) => ({
        domain: 'structural-owner',
        key: columns.id,
        owner: {
          name: columns.ownerId.name,
          table: columns.ownerId.table,
        } as never,
      })),
    );

    expect(() => extractKovoRuntimeDbMetadata([stringOwner])).toThrow(
      /owner annotation.*exact Drizzle column identity.*SPEC §10\.1/u,
    );
    expect(() => extractKovoRuntimeDbMetadata([structuralOwner])).toThrow(
      /owner annotation.*exact Drizzle column identity.*SPEC §10\.1/u,
    );
  });

  it('accepts one exact secret column without requiring an array wrapper', () => {
    const accounts = pgTable(
      'single_secret_identity',
      {
        id: text('id').primaryKey(),
        secret: text('secret').notNull(),
      },
      kovo((columns) => ({
        domain: 'single-secret-identity',
        key: columns.id,
        public: true,
        secret: columns.secret,
      })),
    );

    const metadata = extractKovoRuntimeDbMetadata([accounts]);
    expect([...(metadata.secretColumnNamesByTable.get('single_secret_identity') ?? [])]).toEqual([
      'secret',
    ]);
  });
});
