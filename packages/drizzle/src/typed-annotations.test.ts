import { describe, expect, it } from 'vitest';

import { integer as pgInteger, pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';
import { kovo, sql, staticSql, type KovoStaticSql } from './runtime.js';
import { extractKovoRuntimeDbMetadata } from './runtime-metadata.js';

const accounts = pgTable(
  'typed_accounts',
  {
    id: pgText('id').primaryKey(),
    ownerId: pgText('owner_id').notNull(),
  },
  kovo((columns) => ({
    domain: 'typed-account',
    key: columns.id,
    owner: columns.ownerId,
  })),
);

const entries = pgTable(
  'typed_entries',
  {
    accountId: pgText('account_id').notNull(),
    id: pgText('id').primaryKey(),
    revision: pgInteger('revision').notNull(),
    secret: pgText('secret').notNull(),
  },
  kovo((columns) => ({
    atomic: columns.revision,
    domain: 'typed-entry',
    governed: [columns.accountId],
    key: columns.id,
    ownerVia: {
      fk: columns.accountId,
      parent: accounts,
      parentKey: accounts.id,
    },
    secret: [columns.secret],
    version: columns.revision,
  })),
);

const sqliteNotes = sqliteTable(
  'typed_notes',
  {
    id: sqliteInteger('id').primaryKey(),
    ownerId: sqliteText('owner_id').notNull(),
  },
  kovo((columns) => ({
    domain: 'typed-note',
    key: columns.id,
    owner: columns.ownerId,
  })),
);

const compositeEntries = pgTable(
  'typed_composite_entries',
  {
    accountId: pgText('account_id').notNull(),
    id: pgText('id').notNull(),
  },
  kovo((columns) => ({
    domain: 'typed-composite-entry',
    key: [columns.accountId, columns.id],
  })),
);

function negativeTypeContract() {
  pgTable(
    'typed_typo',
    { id: pgText('id').primaryKey() },
    kovo((columns) => ({
      domain: 'typed-typo',
      // @ts-expect-error annotation callbacks expose only real selection keys
      owner: columns.owenrId,
    })),
  );
  pgTable(
    'typed_wrong_owner',
    { id: pgText('id').primaryKey() },
    kovo(() => ({
      domain: 'typed-wrong-owner',
      // @ts-expect-error a column from another table lacks this callback's private witness
      owner: accounts.ownerId,
    })),
  );
  pgTable(
    'typed_typo_owner_via',
    {
      accountId: pgText('account_id').notNull(),
      id: pgText('id').primaryKey(),
    },
    kovo((columns) => ({
      domain: 'typed-typo-owner-via',
      ownerVia: {
        // @ts-expect-error owner-via child references expose only real selection keys
        fk: columns.accuntId,
        parent: accounts,
        parentKey: accounts.id,
      },
    })),
  );
  pgTable(
    'typed_wrong_parent_key',
    {
      accountId: pgText('account_id').notNull(),
      id: pgText('id').primaryKey(),
    },
    kovo((columns) => ({
      domain: 'typed-wrong-parent-key',
      ownerVia: {
        fk: columns.accountId,
        parent: accounts,
        // @ts-expect-error parentKey must belong to the declared parent table
        parentKey: entries.id,
      },
    })),
  );
  sqliteTable(
    'typed_typo_fan',
    {
      accountId: sqliteInteger('account_id').notNull(),
      id: sqliteInteger('id').primaryKey(),
    },
    kovo((columns) => ({
      domain: 'typed-typo-fan',
      // @ts-expect-error fan-out references expose only real selection keys
      fans: [{ domain: 'typed-account', via: columns.accuntId }],
    })),
  );
  pgTable(
    'typed_wrong_fan',
    { id: pgText('id').primaryKey() },
    kovo(() => ({
      domain: 'typed-wrong-fan',
      // @ts-expect-error fan-out edges must originate from the annotated table
      fans: [{ domain: 'typed-account', via: accounts.id }],
    })),
  );
  const structuralSqlFake = {
    getSQL() {
      return this;
    },
  };
  // @ts-expect-error Kovo SQL handles require the constructor's private witness
  const forgedSql: KovoStaticSql = structuralSqlFake;
  return forgedSql;
}

describe('@kovojs/drizzle typed annotations', () => {
  it('accepts concrete Postgres and SQLite identities without runtime string lookups', () => {
    const metadata = extractKovoRuntimeDbMetadata([accounts, entries, compositeEntries]);
    expect(accounts.ownerId.name).toBe('owner_id');
    expect(entries.accountId.name).toBe('account_id');
    expect(metadata.ownerSourcesByTable.get('typed_accounts')?.columnKey).toBe('ownerId');
    expect(metadata.ownerViaSourcesByTable.get('typed_entries')?.parentTable).toBe(
      'typed_accounts',
    );
    expect(sqliteNotes.ownerId.name).toBe('owner_id');
    expect([...(metadata.governedColumnKeysByTable.get('typed_composite_entries') ?? [])]).toEqual([
      'accountId',
      'id',
    ]);
    expect(sql<boolean>`active = ${true}`).toBeInstanceOf(Object);
    expect(staticSql<boolean>`active = TRUE`).toBeInstanceOf(Object);
    expect(negativeTypeContract).toBeTypeOf('function');
  });
});
