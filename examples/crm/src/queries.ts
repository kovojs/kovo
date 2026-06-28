import { guards, query, s, type QueryLoadContext, type Reader } from '@kovojs/server';
import { count, eq, sql } from 'drizzle-orm';

import type { CrmDb } from './db.js';
import { deal } from './model.js';
import type { CrmRequest } from './mutations.js';
import { activities, contacts, deals } from './schema.js';

// Drizzle reads are extracted from each loader and exposed as generated query-read registries during
// tests/runtime.
//
// SPEC §9.4/§10.3 (MARQUEE / KV433 Stage 1): a query loader receives the framework-owned read-only
// managed handle as `context.db`, typed `Reader<CrmDb>` — the write verbs are removed at the type
// level and throw `KovoReadonlyHandleError` at runtime.
type CrmQueryLoadContext = QueryLoadContext<CrmRequest, CrmDb>;

// Every CRM read returns the signed-in owner's pipeline/contacts, so each query is an
// authenticated surface with the session-presence guard that is its KV436 access decision
// (SPEC §10.2), matching the guarded mutations and routes.
const crmRead = guards.authed<CrmRequest>();

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
export const contactListQuery = query({
  guard: crmRead,
  load: async (_input: unknown, context?: CrmQueryLoadContext): Promise<ContactListResult> => {
    const db = crmQueryDb(context);
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
export const dealListQuery = query({
  guard: crmRead,
  load: async (_input: unknown, context?: CrmQueryLoadContext): Promise<DealListResult> => {
    const db = crmQueryDb(context);
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
export const contactDealCountQuery = query({
  guard: crmRead,
  output: s.object({ count: s.number() }),
  reads: [deal],
  load: async (_input: unknown, context?: CrmQueryLoadContext): Promise<ContactDealCountResult> => {
    const db = crmQueryDb(context);
    const rows = await db.select({ value: count() }).from(deals);
    return { count: Number(rows[0]?.value ?? 0) };
  },
});

/** AGG(deals WHERE stage = 'open') — the open pipeline (a filtered rowset). */
export const openDealsQuery = query({
  guard: crmRead,
  load: async (_input: unknown, context?: CrmQueryLoadContext): Promise<OpenDealsResult> => {
    const db = crmQueryDb(context);
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
export const pipelineByStageQuery = query({
  guard: crmRead,
  output: s.object({
    buckets: s.array(s.object({ stage: s.string(), total: s.number() })),
  }),
  reads: [deal],
  load: async (_input: unknown, context?: CrmQueryLoadContext): Promise<PipelineByStageResult> => {
    const db = crmQueryDb(context);
    const buckets = await db
      .select({ stage: deals.stage, total: sql<number>`coalesce(sum(${deals.amount}), 0)::int` })
      .from(deals)
      .groupBy(deals.stage)
      .orderBy(deals.stage);
    return { buckets: buckets };
  },
});

/** AGG(activities) ordered by id — timeline rows for deal-detail regions. */
export const activityListQuery = query({
  guard: crmRead,
  load: async (_input: unknown, context?: CrmQueryLoadContext): Promise<ActivityListResult> => {
    const db = crmQueryDb(context);
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

// SPEC §9.4 (MARQUEE): resolve the framework-threaded read-only handle. The loader no longer takes
// db from the request — the framework owns the handle.
function crmQueryDb(context?: CrmQueryLoadContext): Reader<CrmDb> {
  const db = context?.db;
  if (!db) {
    throw new Error('CRM query loaders require the framework-provided context.db');
  }
  return db;
}
