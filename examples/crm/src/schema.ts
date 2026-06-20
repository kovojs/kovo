import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// Drizzle tables for the CRM demo. The kovo annotations connect table writes to
// the contact, deal, and activity domains used by the generated invalidation graph.

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    ownerId: text('owner_id').notNull(),
    dealCount: integer('deal_count').notNull(),
    // Presentational fields used by the UI; demo forms leave them to defaults.
    company: text('company').notNull().default('Independent'),
    title: text('title').notNull().default('Contact'),
  },
  kovo({ domain: 'contact', key: (t) => t.id }),
);

export const deals = pgTable(
  'deals',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    stage: text('stage').notNull(),
    amount: integer('amount').notNull(),
    ownerId: text('owner_id').notNull(),
    // Human deal name shown in the pipeline.
    title: text('title').notNull().default('New opportunity'),
  },
  kovo({ domain: 'deal', key: (t) => t.id }),
);

export const activities = pgTable(
  'activities',
  {
    id: serial('id').primaryKey(),
    dealId: text('deal_id').notNull(),
    kind: text('kind').notNull(),
    note: text('note').notNull(),
  },
  kovo({ domain: 'activity', key: (t) => t.id }),
);
