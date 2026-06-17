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

// SPEC.md §10.3/§10.4/§10.5: each mutation couples a stable key, an input schema,
// and an inline-Drizzle handler whose write effects the static extractor lowers
// into the symbolic-effect IR. Handlers are named top-level functions so the
// extractor resolves a stable `writeKey` per mutation (it groups effects by the
// function name). The deriver pushes those effects through the query shapes
// (queries.ts) to produce the generated/optimistic/* transforms. Where a pair is
// out-of-grammar (GROUP BY pipelineByStage) or opaque (server-computed
// commission / sql column arithmetic), the deriver PUNTs; this module hand-writes
// those transforms and MERGES them with the generated derived plan — the MIX of
// compiler-derived and custom optimism via the override path (§10.4).

/**
 * The per-request value handed to every CRM mutation: a real Drizzle/PGlite db
 * plus an optional session (so the built-in `guards.authed()` applies). The
 * extractor reads the inline Drizzle writes off `request.db`; the guard keeps the
 * mutations off the `kovo check` UNGUARDED audit (SPEC.md §11.2).
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

/** The shared `authed` guard for every CRM mutation. */
const authed = guards.authed<CrmRequest>();

const duplicateEmailError = s.object({ email: s.string() });

// ── addContact ───────────────────────────────────────────────────────────────
// INSERT contact ⇒ contactList push is fully compiler-derived (no overrides).

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

// ── createDeal ───────────────────────────────────────────────────────────────
// INSERT deal + UPDATE contacts.dealCount via a sql column-arithmetic SET. The
// deriver covers dealList (push), contactDealCount (COUNT inc), and openDeals
// (push-if-open). The contacts.dealCount SET is `sql\`${col} + 1\`` ⇒ Opaque ⇒
// contactList PUNTs (opaque-set) and is hand-written below. pipelineByStage is
// GROUP BY ⇒ PUNT (opaque-shape{group-by-having}) ⇒ also hand-written.

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

// CUSTOM (hand-written):
//  - contactList: the deriver returns a program, but the contacts.dealCount SET
//    is the opaque `sql\`${col} + 1\`` value (not lowerable), so we hand-write the
//    increment, mirroring the server's column arithmetic.
//  - pipelineByStage (PUNT opaque-shape{group-by-having}): add the new deal's
//    amount to its stage bucket, creating the bucket if absent.
// Both commute with the real createDeal effect over Postgres.
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

// ── moveDeal ─────────────────────────────────────────────────────────────────
// UPDATE deals.stage. dealList is a derived update-row. openDeals is a membership
// transition on the `stage = 'open'` filter: a Const target ('won'/'lost') that
// violates the filter is a derivable EXIT, but entry (-> 'open') punts
// (membership-entry, the client lacks the row's other columns). We hand-write
// openDeals so BOTH directions are sound. pipelineByStage is GROUP BY ⇒ PUNT ⇒
// hand-written via applyMoveDealPipeline (driven by the dealList row).

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

// CUSTOM (hand-written). openDeals (PUNT membership-entry): a moveDeal can move a
// deal INTO 'open' (entry the deriver punts) or out of it; we await the server
// fragment for the authoritative open set rather than fabricate a row the client
// may not hold. pipelineByStage (PUNT opaque-shape{group-by-having}): the scalar
// client value cannot know the deal's prior stage/amount, so we also await the
// server fragment; the sound full transform `applyMoveDealPipeline` (exercised by
// the soundness test) is what a row-carrying client would run.
export const moveDealOptimistic = {
  ...moveDealDerivedOptimistic,
  transforms: {
    ...moveDealDerivedOptimistic.transforms,
    openDeals: 'await-fragment',
    pipelineByStage: 'await-fragment',
  },
} satisfies OptimisticFor<typeof moveDealForm>;

/**
 * The sound, hand-written pipelineByStage transform for moveDeal, parameterized
 * by the moved deal's prior stage + amount (which a row-carrying client holds in
 * its dealList rows). Subtract the amount from the old bucket and add it to the
 * new one; this commutes with the SUM(amount) GROUP BY stage server truth.
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
  // The pipelineByStage query GROUP BYs the live rows and orders by stage, so an
  // emptied bucket disappears and the surviving buckets stay stage-sorted.
  return {
    buckets: next.buckets
      .filter((entry) => entry.total !== 0)
      .sort((left, right) => left.stage.localeCompare(right.stage)),
  };
}

// ── closeDeal ────────────────────────────────────────────────────────────────
// UPDATE deals SET stage = 'won', amount = compute_commission(amount). The amount
// SET is a raw sql server compute ⇒ Opaque. The deriver still returns a program
// for dealList / openDeals, but it embeds the opaque commission value, so the
// program is NOT lowerable — those pairs are hand-written. dealList +
// pipelineByStage wait for the server fragment (the commission is server truth);
// openDeals is hand-written to remove the row (a 'won' deal always exits the open
// set, soundly, regardless of the opaque amount).

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

// CUSTOM (hand-written).
//  - openDeals: a closed deal always leaves the open set, so we soundly remove it
//    client-side even though the new amount is opaque.
//  - dealList + pipelineByStage: the new amount is the server-computed commission
//    (opaque-set / GROUP BY), so we record the 'await-fragment' decision — wait
//    for the server fragment rather than guess the commission.
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
