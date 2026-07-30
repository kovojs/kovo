import type { JsonValue } from '@kovojs/core';
import { s } from '@kovojs/server';
import { and, count, eq, sql } from 'drizzle-orm';

import { app } from './kovo.js';
import { deal } from './model.js';
import { activities, contacts, deals } from './schema.js';

// Drizzle reads are extracted from each loader and exposed as generated query-read registries during
// tests/runtime.
//
// SPEC §9.4/§10.3 (MARQUEE / KV433 Stage 1): `defineKovo({ db })` infers the framework-owned
// read-only managed handle at `context.db`; write verbs are absent at the type level and throw
// `KovoReadonlyHandleError` at runtime.

// Every CRM read returns the signed-in owner's pipeline/contacts, so each query is an
// authenticated surface with the session-presence guard that is its KV436 access decision
// (SPEC §10.2), matching the guarded mutations and routes.
// Keep the Drizzle selects inline so the graph emitter can read the same source
// the app runs.

export type ContactRow = {
  readonly [key: string]: JsonValue;
  id: string;
  name: string;
  email: string;
  ownerId: string;
  dealCount: number;
};

export type DealRow = {
  readonly [key: string]: JsonValue;
  id: string;
  contactId: string;
  stage: string;
  amount: number;
  ownerId: string;
};

export type ContactListResult = {
  readonly [key: string]: JsonValue;
  items: ContactRow[];
};

export type DealListResult = {
  readonly [key: string]: JsonValue;
  items: DealRow[];
};

export type DealDetailResult = DealRow | null;

export type ContactDealCountResult = {
  readonly [key: string]: JsonValue;
  count: number;
};

export type OpenDealsResult = {
  readonly [key: string]: JsonValue;
  items: DealRow[];
};

export type PipelineStageBucket = {
  readonly [key: string]: JsonValue;
  stage: string;
  total: number;
};

export type PipelineByStageResult = {
  readonly [key: string]: JsonValue;
  buckets: PipelineStageBucket[];
};

export type ActivityRow = {
  readonly [key: string]: JsonValue;
  id: number;
  dealId: string;
  kind: string;
  note: string;
};

export type ActivityListResult = {
  readonly [key: string]: JsonValue;
  items: ActivityRow[];
};

/** AGG(contacts) — the full contact book, ordered by id (a derivable rowset). */
export const contactListQuery = app.query({
  access: [app.authenticated],
  load: async (_input, context): Promise<ContactListResult> => {
    const db = context.db;
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
export const dealListQuery = app.query({
  access: [app.authenticated],
  load: async (_input, context): Promise<DealListResult> => {
    const db = context.db;
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

/**
 * One owner-scoped deal instance. The exact `{ id }` argument becomes the canonical browser
 * instance key used by query hydration, keyed optimism, and mutation settlement (SPEC §10.2).
 */
export const dealByIdQuery = app.query({
  access: [app.authenticated],
  args: s.object({ id: s.string() }),
  load: async (input, context): Promise<DealDetailResult> => {
    const db = context.db;
    const ownerId = context.request.session.user.id;
    const [item] = await db
      .select({
        id: deals.id,
        contactId: deals.contactId,
        stage: deals.stage,
        amount: deals.amount,
        ownerId: deals.ownerId,
      })
      .from(deals)
      .where(and(eq(deals.id, input.id), eq(deals.ownerId, ownerId)))
      .limit(1);
    return item ?? null;
  },
});

/** COUNT(deals) — the scalar count of deals across the pipeline (derivable). */
export const contactDealCountQuery = app.query({
  access: [app.authenticated],
  output: s.object({ count: s.number() }),
  reads: [deal],
  load: async (_input, context): Promise<ContactDealCountResult> => {
    const db = context.db;
    const rows = await db.select({ value: count() }).from(deals);
    return { count: Number(rows[0]?.value ?? 0) };
  },
});

/** AGG(deals WHERE stage = 'open') — the open pipeline (a filtered rowset). */
export const openDealsQuery = app.query({
  access: [app.authenticated],
  load: async (_input, context): Promise<OpenDealsResult> => {
    const db = context.db;
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
export const pipelineByStageQuery = app.query({
  access: [app.authenticated],
  output: s.object({
    buckets: s.array(s.object({ stage: s.string(), total: s.number() })),
  }),
  reads: [deal],
  load: async (_input, context): Promise<PipelineByStageResult> => {
    const db = context.db;
    const buckets = await db
      .select({ stage: deals.stage, total: sql<number>`coalesce(sum(${deals.amount}), 0)::int` })
      .from(deals)
      .groupBy(deals.stage)
      .orderBy(deals.stage);
    return { buckets: buckets };
  },
});

/** AGG(activities) ordered by id — timeline rows for deal-detail regions. */
export const activityListQuery = app.query({
  access: [app.authenticated],
  load: async (_input, context): Promise<ActivityListResult> => {
    const db = context.db;
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
  dealByIdQuery,
  dealListQuery,
  contactDealCountQuery,
  openDealsQuery,
  pipelineByStageQuery,
  activityListQuery,
];
