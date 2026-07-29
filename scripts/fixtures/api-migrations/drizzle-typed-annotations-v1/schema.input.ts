// @ts-nocheck -- migration input intentionally uses the retired annotation shape.
import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
});

export const entries = pgTable(
  'entries',
  {
    accountId: text('account_id').notNull(),
    id: text('id').notNull(),
    secret: text('secret').notNull(),
  },
  kovo({
    domain: 'entry',
    key: 'accountId,id',
    ownerVia: { fk: 'accountId', parent: accounts, parentKey: 'id' },
    secret: ['secret'],
  }),
);
