import { describe, expect, it } from 'vitest';

import { createQueryStore } from './client.js';
import {
  applyOptimisticTransforms,
  canonicalInstanceKeyValue,
  optimisticPlanFromAuthoredMap,
  OptimisticRebaser,
  type AuthoredOptimisticEntry,
} from './optimism.js';

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

  it('reduces a §10.2 key derivation to the canonical instance-key value', () => {
    // A single-arg keyed query (`{ id }`) yields just the value; a string passes through; multiple
    // args join in declared order (SPEC §10.2 `name:keyValue`).
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
    expect(typeof derive === 'function' ? derive({ domain: 'mutation', input: { id: 'v1', targetId: 'q3' } }) : derive).toBe('q3');
  });

  it('predicts on the targeted instance only, never a sibling instance', () => {
    const store = createQueryStore();
    // Two instances of the SAME keyed query coexist on the page (SPEC §10.2).
    store.set('questionDetail', { id: 'q3', score: 5 }, 'q3');
    store.set('questionDetail', { id: 'q7', score: 9 }, 'q7');

    const plan = optimisticPlanFromAuthoredMap<VoteInput>({ questionDetail: detailEntry });
    const pending = applyOptimisticTransforms(store, { id: 'v1', targetId: 'q3' }, plan);

    // Instant prediction lands on q3; q7 is untouched.
    expect(store.get('questionDetail', 'q3')).toEqual({ id: 'q3', score: 6 });
    expect(store.get('questionDetail', 'q7')).toEqual({ id: 'q7', score: 9 });
    // Rolls back to the pre-transform snapshot of the right instance on error.
    pending.restore();
    expect(store.get('questionDetail', 'q3')).toEqual({ id: 'q3', score: 5 });
  });

  it('rebases the keyed prediction over arriving server truth by key (§10.4 settle-before-rebase)', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('questionDetail', { id: 'q3', score: 5 }, 'q3');

    const plan = optimisticPlanFromAuthoredMap<VoteInput>({ questionDetail: detailEntry });
    rebaser.add('vote-1', { id: 'v1', targetId: 'q3' }, plan);

    expect(store.get('questionDetail', 'q3')).toEqual({ id: 'q3', score: 6 });
    expect(rebaser.pendingCount('questionDetail', 'q3')).toBe(1);

    // Server truth for the q3 instance arrives (score already 5 server-side; the +1 rebases on top).
    rebaser.applyServerTruth('questionDetail', { id: 'q3', score: 5 }, 'q3');
    expect(store.get('questionDetail', 'q3')).toEqual({ id: 'q3', score: 6 });

    // Its own response settles the pending transform; truth then wins outright (score 6 server-side).
    rebaser.settle('vote-1');
    rebaser.applyServerTruth('questionDetail', { id: 'q3', score: 6 }, 'q3');
    expect(store.get('questionDetail', 'q3')).toEqual({ id: 'q3', score: 6 });
    expect(rebaser.pendingCount('questionDetail', 'q3')).toBe(0);
  });
});
