import { guards, mutation, s, type MutationContext } from '@kovojs/server';
import { eq, sql } from 'drizzle-orm';
import type { OptimisticPlan } from '@kovojs/browser';

import type { CrmDb } from './db.js';
import type { AddContactInput, CloseDealInput, CreateDealInput, MoveDealInput } from './model.js';
import { contacts, deals } from './schema.js';

import type {
  ContactDealCountResult,
  ContactListResult,
  DealListResult,
  OpenDealsResult,
  PipelineByStageResult,
} from './queries.js';

declare module '@kovojs/core' {
  interface QueryRegistry {
    contactDealCount: ContactDealCountResult;
    contactList: ContactListResult;
    dealList: DealListResult;
    openDeals: OpenDealsResult;
    pipelineByStage: PipelineByStageResult;
  }

  interface InvalidationSets {
    addContact: 'contactList';
    closeDeal: 'contactDealCount' | 'dealList' | 'openDeals' | 'pipelineByStage';
    createDeal: 'contactDealCount' | 'contactList' | 'dealList' | 'openDeals' | 'pipelineByStage';
    moveDeal: 'contactDealCount' | 'dealList' | 'openDeals' | 'pipelineByStage';
  }
}

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
  optimistic: {
    contactList(draft, $input) {
      const row = {
        dealCount: 0,
        email: $input.email,
        id: $input.id,
        name: $input.name,
        ownerId: $input.ownerId,
      };
      const index = draft.items.findIndex((entry) => entry.id > row.id);
      if (index < 0) draft.items.push(row);
      else draft.items.splice(index, 0, row);
    },
  },
  queue: 'crm',
  handler: addContactHandler,
});

export const addContactOptimistic = optimisticPlan<AddContactInput>(addContact);

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
  optimistic: {
    contactDealCount(draft, _$input) {
      draft.count = (draft.count ?? 0) + 1;
    },
    // Hand-written optimistic patches for UI values the generated plan cannot know:
    // contactList needs the server-side dealCount increment, and pipelineByStage is a
    // grouped summary.
    contactList(draft, $input) {
      const target = draft.items.find((item) => item.id === $input.contactId);
      if (target) target.dealCount += 1;
    },
    dealList(draft, $input) {
      const row = {
        amount: $input.amount,
        contactId: $input.contactId,
        id: $input.id,
        ownerId: $input.ownerId,
        stage: $input.stage,
      };
      const rowId = row.id ?? '';
      const index = draft.items.findIndex((entry) => entry.id > rowId);
      if (index < 0) draft.items.push(row);
      else draft.items.splice(index, 0, row);
    },
    openDeals(draft, $input) {
      const row = {
        amount: $input.amount,
        contactId: $input.contactId,
        id: $input.id,
        ownerId: $input.ownerId,
        stage: $input.stage,
      };
      const rowId = row.id ?? '';
      const index = draft.items.findIndex((entry) => entry.id > rowId);
      if (index < 0) draft.items.push(row);
      else draft.items.splice(index, 0, row);
    },
    pipelineByStage(draft, $input) {
      const bucket = draft.buckets.find((entry) => entry.stage === $input.stage);
      if (bucket) bucket.total += $input.amount;
      else draft.buckets.push({ stage: $input.stage, total: $input.amount });
      draft.buckets.sort((left, right) => left.stage.localeCompare(right.stage));
    },
  },
  queue: 'crm',
  handler: createDealHandler,
});

export const createDealOptimistic = optimisticPlan<CreateDealInput>(createDeal);

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
  optimistic: {
    contactDealCount(_draft, _$input) {},
    dealList(draft, $input) {
      const target = draft.items.find((entry) => entry.id === $input.dealId);
      if (target) target.stage = $input.stage;
    },
    // Moving a deal can change filtered and grouped views in ways that need row
    // context, so the demo waits for the server fragment for those regions.
    openDeals: 'await-fragment',
    pipelineByStage: 'await-fragment',
  },
  queue: 'crm',
  handler: moveDealHandler,
});

export const moveDealOptimistic = optimisticPlan<MoveDealInput>(moveDeal);

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
  optimistic: {
    contactDealCount(_draft, _$input) {},
    // A closed deal leaves the open list immediately. Views that include the
    // server-computed commission wait for the returned fragment.
    openDeals(draft, $input) {
      const index = draft.items.findIndex((item) => item.id === $input.dealId);
      if (index >= 0) draft.items.splice(index, 1);
    },
    dealList: 'await-fragment',
    pipelineByStage: 'await-fragment',
  },
  queue: 'crm',
  handler: closeDealHandler,
});

export const closeDealOptimistic = optimisticPlan<CloseDealInput>(closeDeal);

export const crmMutations = [addContact, createDeal, moveDeal, closeDeal];

function optimisticPlan<Input>(definition: {
  optimistic?: Record<string, unknown>;
  queue?: string;
}): OptimisticPlan<Input> {
  return {
    ...(definition.queue ? { queue: definition.queue } : {}),
    transforms: (definition.optimistic ?? {}) as OptimisticPlan<Input>['transforms'],
  };
}
