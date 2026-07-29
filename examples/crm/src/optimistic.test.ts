import '../../../tests/example-generated-graphs.setup.js';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCrmDb, type CrmDb } from './db.js';
import {
  CRM_DEMO_USER_ID,
  type CloseDealInput,
  type CreateDealInput,
  type MoveDealInput,
} from './model.js';
import {
  predictCloseDealOpenList,
  predictCreateDealContacts,
  predictCreateDealPipeline,
  predictMoveDealPipeline,
} from './mutations.js';
import type { ContactListResult, OpenDealsResult, PipelineByStageResult } from './queries.js';
import { contacts, deals } from './schema.js';

async function beforeAndAfter<Value>(
  load: (db: CrmDb) => Promise<Value>,
  change: (db: CrmDb) => unknown,
): Promise<{ before: Value; after: Value }> {
  const db = await createCrmDb();
  const before = await load(db);
  await change(db);
  return { before, after: await load(db) };
}

describe('CRM optimistic demo behavior', () => {
  it('updates the contact list and pipeline summary for a new deal', async () => {
    const input: CreateDealInput = {
      amount: 7500,
      contactId: 'c1',
      id: 'd3',
      stage: 'open',
    };

    const contactList = await beforeAndAfter(loadContactList, createDealEffect(input));
    expect(predictCreateDealContacts(contactList.before, input)).toEqual(contactList.after);

    const pipeline = await beforeAndAfter(loadPipelineByStage, createDealEffect(input));
    expect(predictCreateDealPipeline(pipeline.before, input)).toEqual(pipeline.after);
  });

  it('keeps a row-carrying prediction helper for stage summaries', async () => {
    const input: MoveDealInput = { dealId: 'd1', stage: 'won' };
    const { before, after } = await beforeAndAfter(loadPipelineByStage, (db) =>
      db.update(deals).set({ stage: input.stage }).where(eq(deals.id, input.dealId)),
    );
    expect(
      predictMoveDealPipeline(before, {
        amount: 5000,
        fromStage: 'open',
        toStage: input.stage,
      }),
    ).toEqual(after);
  });

  it('removes a closed deal from the open pipeline', async () => {
    const input: CloseDealInput = { dealId: 'd1' };
    const { before, after } = await beforeAndAfter(loadOpenDeals, (db) =>
      db
        .update(deals)
        .set({ stage: 'won', amount: sql`compute_commission(${deals.amount})` })
        .where(eq(deals.id, input.dealId)),
    );
    expect(predictCloseDealOpenList(before, input)).toEqual(after);
  });
});

async function loadContactList(db: CrmDb): Promise<ContactListResult> {
  return {
    items: await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        ownerId: contacts.ownerId,
        dealCount: contacts.dealCount,
      })
      .from(contacts)
      .orderBy(contacts.id),
  };
}

async function loadPipelineByStage(db: CrmDb): Promise<PipelineByStageResult> {
  return {
    buckets: await db
      .select({
        stage: deals.stage,
        total: sql<number>`coalesce(sum(${deals.amount}), 0)::int`,
      })
      .from(deals)
      .groupBy(deals.stage)
      .orderBy(deals.stage),
  };
}

async function loadOpenDeals(db: CrmDb): Promise<OpenDealsResult> {
  return {
    items: await db
      .select({
        id: deals.id,
        contactId: deals.contactId,
        stage: deals.stage,
        amount: deals.amount,
        ownerId: deals.ownerId,
      })
      .from(deals)
      .where(eq(deals.stage, 'open'))
      .orderBy(deals.id),
  };
}

function createDealEffect(input: CreateDealInput) {
  return async (db: CrmDb) => {
    await db.insert(deals).values({ ...input, ownerId: CRM_DEMO_USER_ID });
    await db
      .update(contacts)
      .set({ dealCount: sql`${contacts.dealCount} + 1` })
      .where(eq(contacts.id, input.contactId));
  };
}
