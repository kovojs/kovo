import { count, eq, sql } from 'drizzle-orm';

import type { CrmDb } from './db.js';
import type { Domain } from '@kovojs/server';
import { activity, contact, deal } from './model.js';
import { activities, contacts, deals } from './schema.js';

// Small query factory for the demo. Each query names the domains it reads and
// exposes a loader that can run against either the app request context or a test db.
type CrmQueryLoadContext = CrmDb | { db?: CrmDb; request?: { db?: CrmDb } };

interface QueryDefinition<Key extends string, Value> {
  key: Key;
  load: (input: unknown, context: CrmQueryLoadContext) => Promise<Value>;
  reads: readonly Domain<string>[];
}

function query<const Key extends string, Value>(
  key: Key,
  definition: {
    load: (input: unknown, db: CrmDb) => Promise<Value>;
    reads: readonly Domain<string>[];
  },
): QueryDefinition<Key, Value> {
  return {
    key,
    reads: definition.reads,
    load(input, context) {
      return definition.load(input, crmQueryDb(context));
    },
  };
}

// Keep the Drizzle selects inline so the graph emitter can read the same source
// the app runs.

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  ownerId: string;
  dealCount: number;
}

export interface DealRow {
  id: string;
  contactId: string;
  stage: string;
  amount: number;
  ownerId: string;
}

export interface ContactListResult {
  items: ContactRow[];
}

export interface DealListResult {
  items: DealRow[];
}

export interface ContactDealCountResult {
  count: number;
}

export interface OpenDealsResult {
  items: DealRow[];
}

export interface PipelineStageBucket {
  stage: string;
  total: number;
}

export interface PipelineByStageResult {
  buckets: PipelineStageBucket[];
}

export interface ActivityRow {
  id: number;
  dealId: string;
  kind: string;
  note: string;
}

export interface ActivityListResult {
  items: ActivityRow[];
}

/** AGG(contacts) — the full contact book, ordered by id (a derivable rowset). */
export const contactListQuery = query('contactList', {
  reads: [contact],
  load: async (_input: unknown, db: CrmDb): Promise<ContactListResult> => {
    const items = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        ownerId: contacts.ownerId,
        dealCount: contacts.dealCount,
      })
      .from(contacts)
      .orderBy(contacts.id);
    return { items: items };
  },
});

/** AGG(deals) ordered by id — the full pipeline list (a derivable rowset). */
export const dealListQuery = query('dealList', {
  reads: [deal],
  load: async (_input: unknown, db: CrmDb): Promise<DealListResult> => {
    const items = await db
      .select({
        id: deals.id,
        contactId: deals.contactId,
        stage: deals.stage,
        amount: deals.amount,
        ownerId: deals.ownerId,
      })
      .from(deals)
      .orderBy(deals.id);
    return { items: items };
  },
});

/** COUNT(deals) — the scalar count of deals across the pipeline (derivable). */
export const contactDealCountQuery = query('contactDealCount', {
  reads: [deal],
  load: async (_input: unknown, db: CrmDb): Promise<ContactDealCountResult> => {
    const rows = await db.select({ value: count() }).from(deals);
    return { count: Number(rows[0]?.value ?? 0) };
  },
});

/** AGG(deals WHERE stage = 'open') — the open pipeline (a filtered rowset). */
export const openDealsQuery = query('openDeals', {
  reads: [deal],
  load: async (_input: unknown, db: CrmDb): Promise<OpenDealsResult> => {
    const items = await db
      .select({
        id: deals.id,
        contactId: deals.contactId,
        stage: deals.stage,
        amount: deals.amount,
        ownerId: deals.ownerId,
      })
      .from(deals)
      .where(eq(deals.stage, 'open'))
      .orderBy(deals.id);
    return { items: items };
  },
});

/**
 * SUM(amount) GROUP BY stage — the pipeline value per stage.
 */
export const pipelineByStageQuery = query('pipelineByStage', {
  reads: [deal],
  load: async (_input: unknown, db: CrmDb): Promise<PipelineByStageResult> => {
    const buckets = await db
      .select({ stage: deals.stage, total: sql<number>`coalesce(sum(${deals.amount}), 0)::int` })
      .from(deals)
      .groupBy(deals.stage)
      .orderBy(deals.stage);
    return { buckets: buckets };
  },
});

/** AGG(activities) ordered by id — timeline rows for deal-detail regions. */
export const activityListQuery = query('activityList', {
  reads: [activity],
  load: async (_input: unknown, db: CrmDb): Promise<ActivityListResult> => {
    const items = await db
      .select({
        id: activities.id,
        dealId: activities.dealId,
        kind: activities.kind,
        note: activities.note,
      })
      .from(activities)
      .orderBy(activities.id);
    return { items: items };
  },
});

export const crmQueries = [
  contactListQuery,
  dealListQuery,
  contactDealCountQuery,
  openDealsQuery,
  pipelineByStageQuery,
  activityListQuery,
];

function crmQueryDb(context: CrmQueryLoadContext): CrmDb {
  if ('select' in context) return context;

  const db = context.db ?? context.request?.db;
  if (!db) {
    throw new Error('CRM query loaders require a CrmDb or context.db/request.db');
  }
  return db;
}
