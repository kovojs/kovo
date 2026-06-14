import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCrmDb, type CrmDb } from './db.js';
import { applyMoveDealPipeline, closeDealOptimistic, createDealOptimistic } from './mutations.js';
import { contactListQuery, openDealsQuery, pipelineByStageQuery } from './queries.js';
import { contacts, deals } from './schema.js';
import type { CloseDealInput, CreateDealInput } from './forms.js';

// SPEC.md §10.4/§10.5: custom (hand-written) optimism must be just as SOUND as
// derived optimism. These commuting diagrams prove the hand-written overrides
// (the PUNTed / opaque pairs) predict exactly what real Postgres does:
//   - createDeal × contactList: the hand-written dealCount increment matches the
//     server's `sql\`${col} + 1\`` column arithmetic (opaque-set PUNT).
//   - createDeal × pipelineByStage: the hand-written stage-bucket add matches the
//     SUM(amount) GROUP BY stage truth (opaque-shape{group-by-having} PUNT).
//   - moveDeal × pipelineByStage: `applyMoveDealPipeline` (the row-carrying sound
//     transform behind the 'await-fragment' decision) matches the GROUP BY truth.
//   - closeDeal × openDeals: the hand-written remove-row matches the open set
//     after a 'won' close, even though the new amount is server-computed (opaque).

async function commute<Value>(
  load: (db: CrmDb) => Promise<Value>,
  effect: (db: CrmDb) => Promise<void>,
): Promise<{ before: Value; truth: Value }> {
  const db = await createCrmDb();
  const before = await load(db);
  await effect(db);
  const truth = await load(db);
  return { before, truth };
}

function createDealEffect(input: CreateDealInput) {
  return async (db: CrmDb) => {
    await db.insert(deals).values(input);
    await db
      .update(contacts)
      .set({ dealCount: sql`${contacts.dealCount} + 1` })
      .where(eq(contacts.id, input.contactId));
  };
}

describe('CRM custom (hand-written) optimism — commuting diagrams (SPEC §10.4/§10.5)', () => {
  it('createDeal × contactList (hand-written dealCount += 1) commutes', async () => {
    const input: CreateDealInput = {
      id: 'd3',
      contactId: 'c1',
      stage: 'open',
      amount: 7500,
      ownerId: 'u1',
    };
    const { before, truth } = await commute(
      (db) => contactListQuery.load(undefined, db),
      createDealEffect(input),
    );
    expect(createDealOptimistic.transforms.contactList(before, input)).toEqual(truth);
  });

  it('createDeal × pipelineByStage (hand-written bucket add) commutes — existing + new bucket', async () => {
    for (const input of [
      { id: 'd3', contactId: 'c1', stage: 'open', amount: 7500, ownerId: 'u1' },
      { id: 'd4', contactId: 'c2', stage: 'lost', amount: 300, ownerId: 'u1' },
    ] satisfies CreateDealInput[]) {
      const { before, truth } = await commute(
        (db) => pipelineByStageQuery.load(undefined, db),
        createDealEffect(input),
      );
      expect(createDealOptimistic.transforms.pipelineByStage(before, input)).toEqual(truth);
    }
  });

  it('moveDeal × pipelineByStage (applyMoveDealPipeline, row-carrying) commutes — both directions', async () => {
    // d1 is 'open' / 5000; move it to 'won' (existing bucket) then 'lost' (new).
    for (const toStage of ['won', 'lost']) {
      const { before, truth } = await commute(
        (db) => pipelineByStageQuery.load(undefined, db),
        (db) =>
          db
            .update(deals)
            .set({ stage: toStage })
            .where(eq(deals.id, 'd1'))
            .then(() => undefined),
      );
      const predicted = applyMoveDealPipeline(before, {
        amount: 5000,
        fromStage: 'open',
        toStage,
      });
      expect(predicted).toEqual(truth);
    }
  });

  it('closeDeal × openDeals (hand-written remove-row) commutes despite opaque commission', async () => {
    const input: CloseDealInput = { dealId: 'd1' };
    const { before, truth } = await commute(
      (db) => openDealsQuery.load(undefined, db),
      (db) =>
        db
          .update(deals)
          .set({ stage: 'won', amount: sql`${deals.amount} * 2` })
          .where(eq(deals.id, input.dealId))
          .then(() => undefined),
    );
    const openDealsTransform = closeDealOptimistic.transforms.openDeals;
    // The override is a transform (not 'await-fragment') for openDeals.
    expect(typeof openDealsTransform).toBe('function');
    if (typeof openDealsTransform !== 'function') return;
    expect(openDealsTransform(before, input)).toEqual(truth);
  });

  it('records await-fragment for the server-computed / GROUP BY pairs', () => {
    expect(closeDealOptimistic.transforms.dealList).toBe('await-fragment');
    expect(closeDealOptimistic.transforms.pipelineByStage).toBe('await-fragment');
  });
});
