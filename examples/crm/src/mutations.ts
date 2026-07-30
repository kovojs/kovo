import { queue, s, SchemaValidationError, type Schema } from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';

import { app } from './kovo.js';
import {
  CRM_DEMO_USER_ID,
  CRM_STAGES,
  contact,
  deal,
  type AddContactInput,
  type CloseDealInput,
  type CreateDealInput,
  type CrmStage,
} from './model.js';
import {
  contactDealCountQuery,
  contactListQuery,
  dealByIdQuery,
  dealListQuery,
  openDealsQuery,
  pipelineByStageQuery,
} from './queries.js';
import type { ContactListResult, OpenDealsResult, PipelineByStageResult } from './queries.js';
import { contacts, deals } from './schema.js';

const duplicateEmailError = s.object({ email: s.string() });
const contactOwnershipError = s.object({ contactId: s.string() });
const dealOwnershipError = s.object({ dealId: s.string() });
const contactIdSchema = prefixedUuidSchema('c');
const dealIdSchema = prefixedUuidSchema('d');
const crmStageSchema: Schema<CrmStage> = {
  parse(input: unknown): CrmStage {
    if (typeof input !== 'string' || !isCrmStage(input)) {
      throw validationFailure('Expected CRM stage', []);
    }
    return input;
  },
};

// Every pipeline mutation can affect shared dashboard summaries, so they serialize through one
// conceptual queue. This is execution vocabulary, not a hand-maintained query registry.
const CRM_QUEUE = queue('crm');

const addContactInput = s.object({
  id: contactIdSchema,
  name: s.string(),
  email: s.string(),
});

export const addContact = app.mutation({
  access: [app.authenticated],
  errors: {
    DUPLICATE_EMAIL: duplicateEmailError,
  },
  input: addContactInput,
  optimistic: [contactListQuery.optimistic(addContactInput, predictAddContact)],
  queue: CRM_QUEUE,
  registry: { touches: [contact] },
  async handler({ id, name, email }, request, context) {
    const db = request.db;
    const ownerId = request.session.user.id;
    const [existing] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
    if (existing) {
      return context.fail('DUPLICATE_EMAIL', { email });
    }

    try {
      await db.insert(contacts).values({ id, name, email, ownerId, dealCount: 0 });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return context.fail('DUPLICATE_EMAIL', { email });
      }
      throw error;
    }
    return { id };
  },
});

const createDealInput = s.object({
  id: dealIdSchema,
  contactId: s.string(),
  stage: crmStageSchema,
  amount: s.number().int().min(0),
});

export const createDeal = app.mutation({
  access: [app.authenticated],
  errors: {
    CONTACT_NOT_FOUND: contactOwnershipError,
  },
  input: createDealInput,
  optimistic: [
    contactDealCountQuery.optimistic(createDealInput, (value) => ({
      ...value,
      count: value.count + 1,
    })),
    contactListQuery.optimistic(createDealInput, predictCreateDealContacts),
    dealByIdQuery.optimistic(createDealInput, {
      keys: (input) => [{ id: input.id }],
      apply(_value, input) {
        return {
          amount: input.amount,
          contactId: input.contactId,
          id: input.id,
          ownerId: CRM_DEMO_USER_ID,
          stage: input.stage,
        };
      },
    }),
    dealListQuery.optimistic(createDealInput, (value, input) => ({
      ...value,
      items: [
        ...value.items,
        {
          amount: input.amount,
          contactId: input.contactId,
          id: input.id,
          ownerId: CRM_DEMO_USER_ID,
          stage: input.stage,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    })),
    openDealsQuery.optimistic(createDealInput, (value, input) => ({
      ...value,
      items:
        input.stage === 'open'
          ? [
              ...value.items,
              {
                amount: input.amount,
                contactId: input.contactId,
                id: input.id,
                ownerId: CRM_DEMO_USER_ID,
                stage: input.stage,
              },
            ].sort((left, right) => left.id.localeCompare(right.id))
          : value.items,
    })),
    pipelineByStageQuery.optimistic(createDealInput, predictCreateDealPipeline),
  ],
  queue: CRM_QUEUE,
  registry: { touches: [contact, deal] },
  async handler({ id, contactId, stage, amount }, request, context) {
    const db = request.db;
    const ownerId = request.session.user.id;
    const [ownedContact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId)))
      .limit(1);
    if (!ownedContact) {
      return context.fail('CONTACT_NOT_FOUND', { contactId });
    }
    await db.insert(deals).values({ id, contactId, stage, amount, ownerId });
    await db
      .update(contacts)
      .set({ dealCount: sql`${contacts.dealCount} + 1` })
      .where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId)));
    return { id };
  },
});

const moveDealInput = s.object({
  dealId: s.string(),
  stage: crmStageSchema,
});

export const moveDeal = app.mutation({
  access: [app.authenticated],
  errors: {
    DEAL_NOT_FOUND: dealOwnershipError,
  },
  input: moveDealInput,
  optimistic: [
    contactDealCountQuery.optimistic(moveDealInput, (value) => value),
    dealByIdQuery.optimistic(moveDealInput, {
      keys: (input) => [{ id: input.dealId }],
      apply(value, input) {
        return value ? { ...value, stage: input.stage } : null;
      },
    }),
    dealListQuery.optimistic(moveDealInput, (value, input) => ({
      ...value,
      items: value.items.map((item) =>
        item.id === input.dealId ? { ...item, stage: input.stage } : item,
      ),
    })),
    // Moving a deal can change filtered and grouped views in ways that need row context. A no-op
    // prediction preserves the current value until the returned server fragment reconciles it.
    openDealsQuery.optimistic(moveDealInput, (value) => value),
    pipelineByStageQuery.optimistic(moveDealInput, (value) => value),
  ],
  queue: CRM_QUEUE,
  registry: { touches: [deal] },
  async handler({ dealId, stage }, request, context) {
    const db = request.db;
    const ownerId = request.session.user.id;
    const [ownedDeal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)))
      .limit(1);
    if (!ownedDeal) {
      return context.fail('DEAL_NOT_FOUND', { dealId });
    }
    await db
      .update(deals)
      .set({ stage })
      .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)));
    return { dealId };
  },
});

/**
 * Row-carrying helper for updating pipelineByStage when the old stage and amount are already known.
 */
export function applyMoveDealPipeline(
  current: { buckets: { stage: string; total: number }[] },
  movedDeal: { amount: number; fromStage: string; toStage: string },
): { buckets: { stage: string; total: number }[] } {
  const next = structuredClone(current);
  const from = next.buckets.find((entry) => entry.stage === movedDeal.fromStage);
  if (from) from.total -= movedDeal.amount;
  const to = next.buckets.find((entry) => entry.stage === movedDeal.toStage);
  if (to) to.total += movedDeal.amount;
  else next.buckets.push({ stage: movedDeal.toStage, total: movedDeal.amount });
  return {
    buckets: next.buckets
      .filter((entry) => entry.total !== 0)
      .sort((left, right) => left.stage.localeCompare(right.stage)),
  };
}

const closeDealInput = s.object({
  dealId: s.string(),
});

export const closeDeal = app.mutation({
  access: [app.authenticated],
  errors: {
    DEAL_NOT_FOUND: dealOwnershipError,
  },
  input: closeDealInput,
  optimistic: [
    contactDealCountQuery.optimistic(closeDealInput, (value) => value),
    // The commission is server-computed, but the detail instance can still predict its terminal
    // status immediately; the returned keyed query chunk replaces the amount with server truth.
    dealByIdQuery.optimistic(closeDealInput, {
      keys: (input) => [{ id: input.dealId }],
      apply(value) {
        return value ? { ...value, stage: 'won' } : null;
      },
    }),
    openDealsQuery.optimistic(closeDealInput, predictCloseDealOpenList),
    // Views that include the server-computed commission retain their current value until the
    // returned fragment supplies authoritative truth.
    dealListQuery.optimistic(closeDealInput, (value) => value),
    pipelineByStageQuery.optimistic(closeDealInput, (value) => value),
  ],
  queue: CRM_QUEUE,
  registry: { touches: [deal] },
  async handler({ dealId }, request, context) {
    const db = request.db;
    const ownerId = request.session.user.id;
    const [ownedDeal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)))
      .limit(1);
    if (!ownedDeal) {
      return context.fail('DEAL_NOT_FOUND', { dealId });
    }
    await db
      .update(deals)
      .set({ stage: 'won', amount: sql`compute_commission(${deals.amount})` })
      .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)));
    return { dealId };
  },
});

export const crmMutations = [addContact, createDeal, moveDeal, closeDeal];

export function predictAddContact(
  value: Readonly<ContactListResult>,
  input: AddContactInput,
): ContactListResult {
  const row = {
    dealCount: 0,
    email: input.email,
    id: input.id,
    name: input.name,
    ownerId: CRM_DEMO_USER_ID,
  };
  return {
    ...value,
    items: [...value.items, row].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function predictCreateDealContacts(
  value: Readonly<ContactListResult>,
  input: CreateDealInput,
): ContactListResult {
  return {
    ...value,
    items: value.items.map((item) =>
      item.id === input.contactId ? { ...item, dealCount: item.dealCount + 1 } : item,
    ),
  };
}

export function predictCreateDealPipeline(
  value: Readonly<PipelineByStageResult>,
  input: CreateDealInput,
): PipelineByStageResult {
  const matching = value.buckets.find((entry) => entry.stage === input.stage);
  const buckets = matching
    ? value.buckets.map((entry) =>
        entry.stage === input.stage ? { ...entry, total: entry.total + input.amount } : entry,
      )
    : [...value.buckets, { stage: input.stage, total: input.amount }];
  return {
    ...value,
    buckets: buckets.toSorted((left, right) => left.stage.localeCompare(right.stage)),
  };
}

export function predictMoveDealPipeline(
  current: { buckets: { stage: string; total: number }[] },
  movedDeal: { amount: number; fromStage: string; toStage: string },
): { buckets: { stage: string; total: number }[] } {
  return applyMoveDealPipeline(current, movedDeal);
}

export function predictCloseDealOpenList(
  value: Readonly<OpenDealsResult>,
  input: CloseDealInput,
): OpenDealsResult {
  return {
    ...value,
    items: value.items.filter((item) => item.id !== input.dealId),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = Reflect.get(error, 'code');
  if (code === '23505') return true;
  const message = Reflect.get(error, 'message');
  return (
    typeof message === 'string' &&
    /duplicate key|unique constraint|unique violation/iu.test(message)
  );
}

function isCrmStage(value: string): value is CrmStage {
  return CRM_STAGES.some((stage) => stage === value);
}

function prefixedUuidSchema(prefix: 'c' | 'd'): Schema<string> {
  const pattern = new RegExp(
    `^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  );
  return {
    parse(input: unknown): string {
      if (typeof input !== 'string' || !pattern.test(input)) {
        throw validationFailure(`Expected ${prefix}-prefixed UUID`, ['id']);
      }
      return input;
    },
  };
}

function validationFailure(message: string, path: readonly string[]): SchemaValidationError {
  return new SchemaValidationError([{ message, path }]);
}
