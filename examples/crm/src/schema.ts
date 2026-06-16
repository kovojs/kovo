import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// SPEC.md §10.1 (schema as domain registry) + §11.1: the Drizzle-blessed data
// layer for the CRM example. Each table carries its kovo({ domain, key })
// annotation, so the static extractor derives the touch graph, query shapes, and
// write effects directly from this source. The derived-optimism transforms in
// generated/optimistic/ are produced from these tables + the query loaders and
// mutation handlers — never hand-authored — and the deliberately out-of-grammar
// pairs (GROUP BY pipeline, opaque commission) punt to the hand-written
// overrides in mutations.ts (SPEC.md §10.4 / §10.5).

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    ownerId: text('owner_id').notNull(),
    dealCount: integer('deal_count').notNull(),
  },
  kovo({ domain: 'contact', key: 'id' }),
);

export const deals = pgTable(
  'deals',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    stage: text('stage').notNull(),
    amount: integer('amount').notNull(),
    ownerId: text('owner_id').notNull(),
  },
  kovo({ domain: 'deal', key: 'id' }),
);

export const activities = pgTable(
  'activities',
  {
    id: serial('id').primaryKey(),
    dealId: text('deal_id').notNull(),
    kind: text('kind').notNull(),
    note: text('note').notNull(),
  },
  kovo({ domain: 'activity', key: 'id' }),
);
