import { describe, expect, it } from 'vitest';

import { createQueryStore } from './client.js';
import {
  applyOptimisticTransforms,
  canonicalInstanceKeyValue,
  optimisticPlanFromAuthoredMap,
  OptimisticRebaser,
  type AuthoredOptimisticEntry,
} from './optimism.js';
import { applyQueryChunksToRuntime } from './query-apply.js';
import { readQueryChunks } from './wire-parser.js';

// SPEC.md §10.2/§10.4/§13.2 (capability-gaps §3): the bridge that lets an inline
// `mutation({ optimistic })` map predict the CORRECT instance of a keyed query. The authoring
// surface co-locates a `{ keys, transform }` keyed entry; `optimisticPlanFromAuthoredMap` lowers
// the `keys` derivation into `OptimisticPlan.keys` so the existing instance-keyed runtime targets
// the right `<kovo-query name key>` store slot and rebases by key, instead of an `'await-fragment'`
// full round-trip.
describe('instance-keyed optimistic bridge', () => {
  // The vote mutation input: `targetId` is the voted question id; `questionDetail` is keyed by
  // that question id (SPEC §10.2 WHERE eq-predicate resolved to args.id).
  type VoteInput = { id: string; targetId: string };
  type Detail = { id: string; score: number } | null;

  const detailEntry: AuthoredOptimisticEntry<VoteInput, Detail> = {
    keys: (input) => ({ id: input.targetId }), // SPEC §10.2: instance key from the mutation input
    transform(draft, _input) {
      if (draft) draft.score += 1;
    },
  };

  it('reduces a §10.2 key derivation to the canonical key VALUE (the keyValue half only)', () => {
    // `canonicalInstanceKeyValue` is the `keyValue` HALF of `name:keyValue` (SPEC §10.2:1040):
    // a single-arg `{ id }` yields just the value, and composite args join in declared order. The
    // FULL instance key the store/wire share is assembled by `optimisticPlanFromAuthoredMap` (which
    // prefixes the query name); this helper alone does NOT produce a store slot.
    expect(canonicalInstanceKeyValue({ id: 'q3' })).toBe('q3');
    expect(canonicalInstanceKeyValue('q7')).toBe('q7');
    expect(canonicalInstanceKeyValue({ org: 'o1', id: 'q3' })).toBe('o1:q3');
  });

  it('lowers a keyed entry into OptimisticPlan.keys and leaves unkeyed entries flat', () => {
    const plan = optimisticPlanFromAuthoredMap<VoteInput>(
      {
        questionScore: (draft) => {
          (draft as { score: number }).score += 1;
        },
        questionDetail: detailEntry,
        questionList: 'await-fragment',
      },
      'votes',
    );

    expect(plan.queue).toBe('votes');
    expect(Object.keys(plan.transforms).sort()).toEqual([
      'questionDetail',
      'questionList',
      'questionScore',
    ]);
    expect(plan.transforms.questionList).toBe('await-fragment');
    // Only the keyed query carries a derivation; the unkeyed ones are absent from `keys`.
    expect(Object.keys(plan.keys ?? {})).toEqual(['questionDetail']);
    const derive = plan.keys?.questionDetail;
    // SPEC §10.2:1040 (L13/KV313 regression): the lowered derivation yields the FULL canonical
    // `name:keyValue` instance key the store/wire share — NOT the bare `q3` value (which would
    // orphan the prediction in an empty `questionDetail␞q3` slot).
    expect(
      typeof derive === 'function'
        ? derive({ domain: 'mutation', input: { id: 'v1', targetId: 'q3' } })
        : derive,
    ).toBe('questionDetail:q3');
  });

  it('predicts on the targeted instance only, never a sibling instance', () => {
    const store = createQueryStore();
    // Two instances of the SAME keyed query coexist on the page, slotted by the canonical
    // `name:keyValue` instance key the server/hydration emit (SPEC §10.2:1040).
    store.set('questionDetail', { id: 'q3', score: 5 }, 'questionDetail:q3');
    store.set('questionDetail', { id: 'q7', score: 9 }, 'questionDetail:q7');

    const plan = optimisticPlanFromAuthoredMap<VoteInput>({ questionDetail: detailEntry });
    const pending = applyOptimisticTransforms(store, { id: 'v1', targetId: 'q3' }, plan);

    // Instant prediction lands on the q3 instance; q7 is untouched.
    expect(store.get('questionDetail', 'questionDetail:q3')).toEqual({ id: 'q3', score: 6 });
    expect(store.get('questionDetail', 'questionDetail:q7')).toEqual({ id: 'q7', score: 9 });
    // Rolls back to the pre-transform snapshot of the right instance on error.
    pending.restore();
    expect(store.get('questionDetail', 'questionDetail:q3')).toEqual({ id: 'q3', score: 5 });
  });

  it('rebases the keyed prediction over arriving server truth by key (§10.4 settle-before-rebase)', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('questionDetail', { id: 'q3', score: 5 }, 'questionDetail:q3');

    const plan = optimisticPlanFromAuthoredMap<VoteInput>({ questionDetail: detailEntry });
    rebaser.add('vote-1', { id: 'v1', targetId: 'q3' }, plan);

    expect(store.get('questionDetail', 'questionDetail:q3')).toEqual({ id: 'q3', score: 6 });
    expect(rebaser.pendingCount('questionDetail', 'questionDetail:q3')).toBe(1);

    // Server truth for the q3 instance arrives (score already 5 server-side; the +1 rebases on top).
    rebaser.applyServerTruth('questionDetail', { id: 'q3', score: 5 }, 'questionDetail:q3');
    expect(store.get('questionDetail', 'questionDetail:q3')).toEqual({ id: 'q3', score: 6 });

    // Its own response settles the pending transform; truth then wins outright (score 6 server-side).
    rebaser.settle('vote-1');
    rebaser.applyServerTruth('questionDetail', { id: 'q3', score: 6 }, 'questionDetail:q3');
    expect(store.get('questionDetail', 'questionDetail:q3')).toEqual({ id: 'q3', score: 6 });
    expect(rebaser.pendingCount('questionDetail', 'questionDetail:q3')).toBe(0);
  });

  // L13 (SPEC §10.2:1040, KV313) regression: an args-object key derivation on a SPEC-canonically
  // keyed query must predict into the SAME store slot the real server-truth/hydration wire chunk
  // decodes to (`name␞name:keyValue`), not an orphaned bare-value slot (`name␞keyValue`). Drives the
  // REAL wire-parser + apply path so the "same slot" claim is grounded in the shipped decode, and
  // FAILS on the pre-fix behavior (which keyed the prediction by the bare `p1`).
  it('keyed-optimism predicts into the SAME slot as server-truth/hydration (L13/KV313)', () => {
    type AddToCartInput = { id: string; qty: number };
    type Product = { stock: number } | null;

    const store = createQueryStore();

    // Server-truth: the canonical typed-read/hydration chunk the server emits for a query whose
    // `instanceKey: (input) => 'product:' + input.id` resolves to `product:p1` (query.ts:857-864 →
    // renderQueryWireHtml emits `<kovo-query name="product" key="product:p1">`). Decode it with the
    // shipped browser wire-parser and apply it the way hydration does.
    const serverChunks = readQueryChunks(
      '<kovo-query name="product" key="product:p1">{"stock":4}</kovo-query>',
    );
    applyQueryChunksToRuntime(store, serverChunks);

    // The wire-parser/store currency is the FULL `product:p1` instance key (§10.2:1040).
    expect(serverChunks).toEqual([{ key: 'product:p1', name: 'product', value: { stock: 4 } }]);
    expect(store.get<Product>('product', 'product:p1')).toEqual({ stock: 4 });

    // An authored keyed-optimism entry deriving the instance from the mutation args (the §10.2
    // `{ id }` form), predicting an `addToCart` that decrements available stock.
    const addToCart: AuthoredOptimisticEntry<AddToCartInput, Product> = {
      keys: (input) => ({ id: input.id }),
      transform(draft, input) {
        if (draft) draft.stock -= input.qty;
      },
    };
    const plan = optimisticPlanFromAuthoredMap<AddToCartInput>({ product: addToCart });

    // The lowered derivation produces the FULL `product:p1`, NOT the bare `p1` (the fixed bug).
    const derive = plan.keys?.product;
    expect(
      typeof derive === 'function' && derive({ domain: 'mutation', input: { id: 'p1', qty: 1 } }),
    ).toBe('product:p1');

    const pending = applyOptimisticTransforms(store, { id: 'p1', qty: 1 }, plan);

    // The optimistic value is VISIBLE in the server-truth slot (not orphaned): stock 4 -> 3.
    expect(store.get<Product>('product', 'product:p1')).toEqual({ stock: 3 });
    // No orphan was created at the bare-value slot the old code would have targeted.
    expect(store.get('product', 'p1')).toBeUndefined();

    // And it rolls back into the same canonical slot on server rejection.
    pending.restore();
    expect(store.get<Product>('product', 'product:p1')).toEqual({ stock: 4 });
  });
});
