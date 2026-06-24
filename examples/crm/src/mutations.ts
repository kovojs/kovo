import {
  guards,
  mutation,
  s,
  SchemaValidationError,
  type MutationContext,
  type Schema,
} from '@kovojs/server';
import { and, eq, sql } from 'drizzle-orm';
import type { OptimisticPlan } from '@kovojs/browser';

import type { CrmDb } from './db.js';
import {
  CRM_DEMO_USER_ID,
  CRM_STAGES,
  contact,
  deal,
  type AddContactInput,
  type CloseDealInput,
  type CreateDealInput,
  type CrmStage,
  type MoveDealInput,
} from './model.js';
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
  secret: exampleDeploymentSecret('KOVO_CRM_CSRF_SECRET', EXAMPLE_ONLY_CRM_CSRF_SECRET),
  sessionId(request: CrmCsrfRequest) {
    return request.session?.id;
  },
};

/**
 * The CRM's session-presence guard. Exported so the interactive app's layouts can
 * carry it as their route guard — every CRM page reads the seeded owner's data, so
 * each route is an authenticated surface (its KV436 access decision, SPEC §10.2).
 */
export const authed = guards.authed<CrmRequest>();

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

export async function addContactHandler(
  { id, name, email }: AddContactInput,
  request: CrmRequest,
  context: MutationContext<{ DUPLICATE_EMAIL: typeof duplicateEmailError }>,
) {
  const db = request.db;
  const ownerId = crmUserId(request);
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
}

export const addContact = mutation('addContact', {
  csrf: crmCsrf,
  errors: {
    DUPLICATE_EMAIL: duplicateEmailError,
  },
  guard: authed,
  input: s.object({
    id: contactIdSchema,
    name: s.string(),
    email: s.string(),
  }),
  optimistic: {
    contactList(draft, $input) {
      const row = {
        dealCount: 0,
        email: $input.email,
        id: $input.id,
        name: $input.name,
        ownerId: CRM_DEMO_USER_ID,
      };
      const index = draft.items.findIndex((entry) => entry.id > row.id);
      if (index < 0) draft.items.push(row);
      else draft.items.splice(index, 0, row);
    },
  },
  queue: 'crm',
  registry: { touches: [contact] },
  handler: addContactHandler,
});

export const addContactOptimistic = optimisticPlan<AddContactInput>(addContact);

export async function createDealHandler(
  { id, contactId, stage, amount }: CreateDealInput,
  request: CrmRequest,
  context: MutationContext<{ CONTACT_NOT_FOUND: typeof contactOwnershipError }>,
) {
  const db = request.db;
  const ownerId = crmUserId(request);
  if (!(await hasOwnedContact(db, contactId, ownerId))) {
    return context.fail('CONTACT_NOT_FOUND', { contactId });
  }
  await db.insert(deals).values({ id, contactId, stage, amount, ownerId });
  await db
    .update(contacts)
    .set({ dealCount: sql`${contacts.dealCount} + 1` })
    .where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId)));
  return { id };
}

export const createDeal = mutation('createDeal', {
  csrf: crmCsrf,
  errors: {
    CONTACT_NOT_FOUND: contactOwnershipError,
  },
  guard: authed,
  input: s.object({
    id: dealIdSchema,
    contactId: s.string(),
    stage: crmStageSchema,
    amount: s.number().int().min(0),
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
        ownerId: CRM_DEMO_USER_ID,
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
        ownerId: CRM_DEMO_USER_ID,
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
  registry: { touches: [contact, deal] },
  handler: createDealHandler,
});

export const createDealOptimistic = optimisticPlan<CreateDealInput>(createDeal);

export async function moveDealHandler(
  { dealId, stage }: MoveDealInput,
  request: CrmRequest,
  context: MutationContext<{ DEAL_NOT_FOUND: typeof dealOwnershipError }>,
) {
  const db = request.db;
  const ownerId = crmUserId(request);
  if (!(await hasOwnedDeal(db, dealId, ownerId))) {
    return context.fail('DEAL_NOT_FOUND', { dealId });
  }
  await db
    .update(deals)
    .set({ stage })
    .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)));
  return { dealId };
}

export const moveDeal = mutation('moveDeal', {
  csrf: crmCsrf,
  errors: {
    DEAL_NOT_FOUND: dealOwnershipError,
  },
  guard: authed,
  input: s.object({
    dealId: s.string(),
    stage: crmStageSchema,
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
  registry: { touches: [deal] },
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

export async function closeDealHandler(
  { dealId }: CloseDealInput,
  request: CrmRequest,
  context: MutationContext<{ DEAL_NOT_FOUND: typeof dealOwnershipError }>,
) {
  const db = request.db;
  const ownerId = crmUserId(request);
  if (!(await hasOwnedDeal(db, dealId, ownerId))) {
    return context.fail('DEAL_NOT_FOUND', { dealId });
  }
  await db
    .update(deals)
    .set({ stage: 'won', amount: sql`compute_commission(${deals.amount})` })
    .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)));
  return { dealId };
}

export const closeDeal = mutation('closeDeal', {
  csrf: crmCsrf,
  errors: {
    DEAL_NOT_FOUND: dealOwnershipError,
  },
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
  registry: { touches: [deal] },
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

function exampleDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === '23505') return true;
  const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
  return /duplicate key|unique constraint|unique violation/iu.test(message);
}

function crmUserId(request: CrmRequest): string {
  const userId = request.session?.user?.id;
  if (!userId) throw validationFailure('Authenticated CRM user is required', ['session']);
  return userId;
}

async function hasOwnedContact(db: CrmDb, contactId: string, ownerId: string): Promise<boolean> {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId)))
    .limit(1);
  return contact !== undefined;
}

async function hasOwnedDeal(db: CrmDb, dealId: string, ownerId: string): Promise<boolean> {
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.ownerId, ownerId)))
    .limit(1);
  return deal !== undefined;
}

function isCrmStage(value: string): value is CrmStage {
  return (CRM_STAGES as readonly string[]).includes(value);
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
