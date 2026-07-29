import { kovo } from '@kovojs/drizzle';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

// Drizzle tables for the CRM demo. The kovo annotations connect table writes to
// the contact, deal, and activity domains used by the generated invalidation graph.

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    ownerId: text('owner_id').notNull(),
    dealCount: integer('deal_count').notNull(),
    // Presentational fields used by the UI; demo forms leave them to defaults.
    company: text('company').notNull().default('Independent'),
    title: text('title').notNull().default('Contact'),
  },
  // SPEC §10.1: contacts are owned by the CRM user (ownerId).
  kovo((columns) => ({ domain: 'contact', key: columns.id, owner: columns.ownerId })),
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
  // SPEC §10.1: deals are owned by the CRM user (ownerId).
  kovo((columns) => ({ domain: 'deal', key: columns.id, owner: columns.ownerId })),
);

export const activities = pgTable(
  'activities',
  {
    id: serial('id').primaryKey(),
    dealId: text('deal_id').notNull(),
    kind: text('kind').notNull(),
    note: text('note').notNull(),
  },
  // SPEC 10.1: activities inherit ownership from their parent deal.
  kovo((columns) => ({
    domain: 'activity',
    key: columns.id,
    ownerVia: { fk: columns.dealId, parent: deals, parentKey: deals.id },
  })),
);
