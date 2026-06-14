import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCrmDb, type CrmDb } from './db.js';
import { addContactOptimistic, createDealOptimistic, moveDealOptimistic } from './mutations.js';
import {
  contactDealCountQuery,
  contactListQuery,
  dealListQuery,
  openDealsQuery,
} from './queries.js';
import { contacts, deals } from './schema.js';
import type { AddContactInput, CreateDealInput, MoveDealInput } from './forms.js';

// SPEC.md §10.5 / §11.4 point 4: soundness for the COMPILER-DERIVED pairs is the
// commuting diagram patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))
// run against REAL Postgres semantics via the in-process PGlite driver. Each case
// loads the query (before), runs the real Drizzle mutation effect, reloads the
// query (truth), and checks the GENERATED transform the app ships predicts the
// same value — modulo placeholder columns (server-assigned ids etc., which these
// fully-supplied inserts do not need). A deliberately-broken expectation at the
// end proves the harness fails loudly.

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

describe('CRM derived optimism — commuting diagrams over real Postgres (pglite)', () => {
  it('addContact × contactList (INSERT × AGG sorted push) commutes', async () => {
    const input: AddContactInput = {
      id: 'c3',
      name: 'Alan Turing',
      email: 'alan@example.com',
      ownerId: 'u1',
    };
    const { before, truth } = await commute(
      (db) => contactListQuery.load(undefined, db),
      (db) =>
        db
          .insert(contacts)
          .values({ ...input, dealCount: 0 })
          .then(() => undefined),
    );
    expect(addContactOptimistic.transforms.contactList(before, input)).toEqual(truth);
  });

  it('createDeal × dealList (INSERT × AGG sorted push) commutes', async () => {
    const input: CreateDealInput = {
      id: 'd3',
      contactId: 'c1',
      stage: 'open',
      amount: 7500,
      ownerId: 'u1',
    };
    const { before, truth } = await commute(
      (db) => dealListQuery.load(undefined, db),
      (db) =>
        db
          .insert(deals)
          .values(input)
          .then(() => undefined),
    );
    expect(createDealOptimistic.transforms.dealList(before, input)).toEqual(truth);
  });

  it('createDeal × contactDealCount (INSERT × COUNT inc) commutes', async () => {
    const input: CreateDealInput = {
      id: 'd3',
      contactId: 'c1',
      stage: 'open',
      amount: 7500,
      ownerId: 'u1',
    };
    const { before, truth } = await commute(
      (db) => contactDealCountQuery.load(undefined, db),
      (db) =>
        db
          .insert(deals)
          .values(input)
          .then(() => undefined),
    );
    expect(createDealOptimistic.transforms.contactDealCount(before, input)).toEqual(truth);
  });

  it('createDeal × openDeals (INSERT × filtered AGG, open) commutes', async () => {
    const input: CreateDealInput = {
      id: 'd3',
      contactId: 'c1',
      stage: 'open',
      amount: 7500,
      ownerId: 'u1',
    };
    const { before, truth } = await commute(
      (db) => openDealsQuery.load(undefined, db),
      (db) =>
        db
          .insert(deals)
          .values(input)
          .then(() => undefined),
    );
    expect(createDealOptimistic.transforms.openDeals(before, input)).toEqual(truth);
  });

  it('moveDeal × dealList (UPDATE keyed-row stage) commutes', async () => {
    const input: MoveDealInput = { dealId: 'd1', stage: 'won' };
    const { before, truth } = await commute(
      (db) => dealListQuery.load(undefined, db),
      (db) =>
        db
          .update(deals)
          .set({ stage: input.stage })
          .where(eq(deals.id, input.dealId))
          .then(() => undefined),
    );
    expect(moveDealOptimistic.transforms.dealList(before, input)).toEqual(truth);
  });

  it('moveDeal × contactDealCount (no count change) commutes', async () => {
    const input: MoveDealInput = { dealId: 'd1', stage: 'won' };
    const { before, truth } = await commute(
      (db) => contactDealCountQuery.load(undefined, db),
      (db) =>
        db
          .update(deals)
          .set({ stage: input.stage })
          .where(eq(deals.id, input.dealId))
          .then(() => undefined),
    );
    expect(moveDealOptimistic.transforms.contactDealCount(before, input)).toEqual(truth);
  });

  it('fails loudly when a derived prediction disagrees with Postgres', async () => {
    const input: CreateDealInput = {
      id: 'd3',
      contactId: 'c1',
      stage: 'open',
      amount: 7500,
      ownerId: 'u1',
    };
    const { before, truth } = await commute(
      (db) => contactDealCountQuery.load(undefined, db),
      (db) =>
        db
          .insert(deals)
          .values(input)
          .then(() => undefined),
    );
    // Wrong: increments by 5 instead of 1.
    const broken = { count: before.count + 5 };
    expect(broken).not.toEqual(truth);
  });
});
