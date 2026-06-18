import { guards, mutation, s, type MutationContext } from '@kovojs/server';
import { eq, sql } from 'drizzle-orm';
import type { OptimisticFor } from '@kovojs/runtime';

import type { CrmDb } from './db.js';
import {
  closeDealForm,
  createDealForm,
  moveDealForm,
  type AddContactInput,
  type CloseDealInput,
  type CreateDealInput,
  type MoveDealInput,
} from './forms.js';
import { contacts, deals } from './schema.js';
import { contact, deal } from './domains.js';

import { addContactDerivedOptimistic } from './generated/optimistic/add-contact.js';
import { createDealDerivedOptimistic } from './generated/optimistic/create-deal.js';
import { moveDealDerivedOptimistic } from './generated/optimistic/move-deal.js';
import { closeDealDerivedOptimistic } from './generated/optimistic/close-deal.js';

/**
 * The per-request value handed to every CRM mutation: a Drizzle/PGlite db plus
 * the fixed demo session used by the interactive app.
 */
export interface CrmRequest {
  db: CrmDb;
  session?: {
    id?: string;
    user?: { id?: string; roles?: readonly string[] } | null;
  } | null;
}

export interface CrmCsrfRequest {
  session?: { id?: string } | null;
}

export const EXAMPLE_ONLY_CRM_CSRF_SECRET = 'crm-reference-demo-csrf-secret';

export const crmCsrf = {
  field: 'csrf',
  secret: EXAMPLE_ONLY_CRM_CSRF_SECRET,
  sessionId(request: CrmCsrfRequest) {
    return request.session?.id;
  },
};

const authed = guards.authed<CrmRequest>();

const duplicateEmailError = s.object({ email: s.string() });

export async function addContactHandler(
  { id, name, email, ownerId }: AddContactInput,
  request: CrmRequest,
  context: MutationContext<{ DUPLICATE_EMAIL: typeof duplicateEmailError }>,
) {
  const db = request.db;
  const [existing] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
  if (existing) {
    return context.fail('DUPLICATE_EMAIL', { email });
  }

  await db.insert(contacts).values({ id, name, email, ownerId, dealCount: 0 });
  return { id };
}

export const addContact = mutation('addContact', {
  csrf: crmCsrf,
  errors: {
    DUPLICATE_EMAIL: duplicateEmailError,
  },
  guard: authed,
  input: s.object({
    id: s.string(),
    name: s.string(),
    email: s.string(),
    ownerId: s.string(),
  }),
  registry: { touches: [contact] },
  handler: addContactHandler,
});

export const addContactOptimistic = addContactDerivedOptimistic;

export async function createDealHandler(
  { id, contactId, stage, amount, ownerId }: CreateDealInput,
  request: CrmRequest,
) {
  const db = request.db;
  await db.insert(deals).values({ id, contactId, stage, amount, ownerId });
  await db
    .update(contacts)
    .set({ dealCount: sql`${contacts.dealCount} + 1` })
    .where(eq(contacts.id, contactId));
  return { id };
}

export const createDeal = mutation('createDeal', {
  csrf: crmCsrf,
  guard: authed,
  input: s.object({
    id: s.string(),
    contactId: s.string(),
    stage: s.string(),
    amount: s.number().int().min(0),
    ownerId: s.string(),
  }),
  registry: { touches: [contact, deal] },
  handler: createDealHandler,
});

// Hand-written optimistic patches for UI values the generated plan cannot know:
// contactList needs the server-side dealCount increment, and pipelineByStage is a
// grouped summary.
export const createDealOptimistic = {
  ...createDealDerivedOptimistic,
  transforms: {
    ...createDealDerivedOptimistic.transforms,
    contactList: (current, $input) => {
      const next = structuredClone(current);
      const target = next.items.find((item) => item.id === $input.contactId);
      if (target) target.dealCount += 1;
      return next;
    },
    pipelineByStage: (current, $input) => {
      const next = structuredClone(current);
      const bucket = next.buckets.find((entry) => entry.stage === $input.stage);
      if (bucket) bucket.total += $input.amount;
      else next.buckets.push({ stage: $input.stage, total: $input.amount });
      next.buckets.sort((left, right) => left.stage.localeCompare(right.stage));
      return next;
    },
  },
} satisfies OptimisticFor<typeof createDealForm>;

export async function moveDealHandler({ dealId, stage }: MoveDealInput, request: CrmRequest) {
  const db = request.db;
  await db.update(deals).set({ stage }).where(eq(deals.id, dealId));
  return { dealId };
}

export const moveDeal = mutation('moveDeal', {
  csrf: crmCsrf,
  guard: authed,
  input: s.object({
    dealId: s.string(),
    stage: s.string(),
  }),
  registry: { touches: [deal] },
  handler: moveDealHandler,
});

// Moving a deal can change filtered and grouped views in ways that need row
// context, so the demo waits for the server fragment for those regions.
export const moveDealOptimistic = {
  ...moveDealDerivedOptimistic,
  transforms: {
    ...moveDealDerivedOptimistic.transforms,
    openDeals: 'await-fragment',
    pipelineByStage: 'await-fragment',
  },
} satisfies OptimisticFor<typeof moveDealForm>;

/**
 * Row-carrying helper for updating pipelineByStage when the old stage and amount
 * are already known.
 */
export function applyMoveDealPipeline(
  current: { buckets: { stage: string; total: number }[] },
  deal: { amount: number; fromStage: string; toStage: string },
): { buckets: { stage: string; total: number }[] } {
  const next = structuredClone(current);
  const from = next.buckets.find((entry) => entry.stage === deal.fromStage);
  if (from) from.total -= deal.amount;
  const to = next.buckets.find((entry) => entry.stage === deal.toStage);
  if (to) to.total += deal.amount;
  else next.buckets.push({ stage: deal.toStage, total: deal.amount });
  // Empty buckets disappear and the surviving buckets stay stage-sorted.
  return {
    buckets: next.buckets
      .filter((entry) => entry.total !== 0)
      .sort((left, right) => left.stage.localeCompare(right.stage)),
  };
}

export async function closeDealHandler({ dealId }: CloseDealInput, request: CrmRequest) {
  const db = request.db;
  await db
    .update(deals)
    .set({ stage: 'won', amount: sql`compute_commission(${deals.amount})` })
    .where(eq(deals.id, dealId));
  return { dealId };
}

export const closeDeal = mutation('closeDeal', {
  csrf: crmCsrf,
  guard: authed,
  input: s.object({
    dealId: s.string(),
  }),
  registry: { touches: [deal] },
  handler: closeDealHandler,
});

// A closed deal leaves the open list immediately. Views that include the
// server-computed commission wait for the returned fragment.
export const closeDealOptimistic = {
  ...closeDealDerivedOptimistic,
  transforms: {
    ...closeDealDerivedOptimistic.transforms,
    openDeals: (current, $input) => {
      const next = structuredClone(current);
      const index = next.items.findIndex((item) => item.id === $input.dealId);
      if (index >= 0) next.items.splice(index, 1);
      return next;
    },
    dealList: 'await-fragment',
    pipelineByStage: 'await-fragment',
  },
} satisfies OptimisticFor<typeof closeDealForm>;

export const crmMutations = [addContact, createDeal, moveDeal, closeDeal];
