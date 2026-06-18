import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCrmDb, type CrmDb } from './db.js';
import type { CloseDealInput, CreateDealInput, MoveDealInput } from './model.js';
import {
  applyMoveDealPipeline,
  closeDealOptimistic,
  createDealOptimistic,
  moveDealOptimistic,
} from './mutations.js';
import { contactListQuery, openDealsQuery, pipelineByStageQuery } from './queries.js';
import { contacts, deals } from './schema.js';

async function beforeAndAfter<Value>(
  load: (db: CrmDb) => Promise<Value>,
  change: (db: CrmDb) => Promise<void>,
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
      ownerId: 'u1',
      stage: 'open',
    };

    const contactList = await beforeAndAfter(
      (db) => contactListQuery.load(undefined, db),
      createDealEffect(input),
    );
    expect(createDealOptimistic.transforms.contactList(contactList.before, input)).toEqual(
      contactList.after,
    );

    const pipeline = await beforeAndAfter(
      (db) => pipelineByStageQuery.load(undefined, db),
      createDealEffect(input),
    );
    expect(createDealOptimistic.transforms.pipelineByStage(pipeline.before, input)).toEqual(
      pipeline.after,
    );
  });

  it('uses server fragments for stage moves, but keeps a row-carrying helper for summaries', async () => {
    const input: MoveDealInput = { dealId: 'd1', stage: 'won' };

    expect(moveDealOptimistic.transforms.openDeals).toBe('await-fragment');
    expect(moveDealOptimistic.transforms.pipelineByStage).toBe('await-fragment');

    const { before, after } = await beforeAndAfter(
      (db) => pipelineByStageQuery.load(undefined, db),
      (db) => db.update(deals).set({ stage: input.stage }).where(eq(deals.id, input.dealId)),
    );
    expect(
      applyMoveDealPipeline(before, { amount: 5000, fromStage: 'open', toStage: input.stage }),
    ).toEqual(after);
  });

  it('removes a closed deal from the open pipeline while waiting for server-computed totals', async () => {
    const input: CloseDealInput = { dealId: 'd1' };

    const { before, after } = await beforeAndAfter(
      (db) => openDealsQuery.load(undefined, db),
      (db) =>
        db
          .update(deals)
          .set({ stage: 'won', amount: sql`compute_commission(${deals.amount})` })
          .where(eq(deals.id, input.dealId)),
    );

    const openDealsTransform = closeDealOptimistic.transforms.openDeals;
    expect(typeof openDealsTransform).toBe('function');
    if (typeof openDealsTransform === 'function') {
      expect(openDealsTransform(before, input)).toEqual(after);
    }
    expect(closeDealOptimistic.transforms.dealList).toBe('await-fragment');
    expect(closeDealOptimistic.transforms.pipelineByStage).toBe('await-fragment');
  });
});

function createDealEffect(input: CreateDealInput) {
  return async (db: CrmDb) => {
    await db.insert(deals).values(input);
    await db
      .update(contacts)
      .set({ dealCount: sql`${contacts.dealCount} + 1` })
      .where(eq(contacts.id, input.contactId));
  };
}
