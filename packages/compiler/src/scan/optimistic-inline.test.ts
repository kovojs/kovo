import { describe, expect, it } from 'vitest';

import {
  inlineOptimisticPlansFromSource,
  serializeInlineOptimisticPlanIr,
  type InlineOptimisticPlanFact,
} from './optimistic-inline.js';

describe('inline optimistic mutation lowering', () => {
  it('lowers inline mutation optimism and standalone draft plans to byte-identical IR', () => {
    const inlineSource = `
      import { mutation, s } from '@kovojs/server';

      export const addToCart = mutation('cart/add', {
        input: s.object({ productId: s.string(), quantity: s.number() }),
        queue: 'cart',
        optimistic: {
          cart(draft, input) {
            draft.count = (draft.count ?? 0) + input.quantity;
          },
          productGrid: 'await-fragment',
        },
        handler() {
          return 'ok';
        },
      });
    `;
    const standaloneSource = `
      export const addToCartOptimistic = {
        queue: 'cart',
        transforms: {
          cart(draft, input) {
            draft.count = (draft.count ?? 0) + input.quantity;
          },
          productGrid: 'await-fragment',
        },
      };
    `;

    const inline = inlineOptimisticPlansFromSource('inline.ts', inlineSource)[0];
    const standalone = inlineOptimisticPlansFromSource('standalone.ts', standaloneSource)[0];
    if (!inline || !standalone) throw new Error('expected optimistic plans');

    expect(inline).toMatchObject({ localName: 'addToCart', mutation: 'cart/add', queue: 'cart' });
    expect(standalone).toMatchObject({ localName: 'addToCartOptimistic', queue: 'cart' });
    expect(serializeInlineOptimisticPlanIr(comparablePlan(inline))).toBe(
      serializeInlineOptimisticPlanIr(comparablePlan(standalone)),
    );
  });

  it('serializes a stable transform-plan IR for fixpoint checks', () => {
    const source = `
      export const closeDeal = mutation('closeDeal', {
        optimistic: {
          openDeals(draft, input) {
            const index = draft.items.findIndex((item) => item.id === input.dealId);
            if (index >= 0) draft.items.splice(index, 1);
          },
          dealList: 'await-fragment',
        },
        handler() {},
      });
    `;
    const [plan] = inlineOptimisticPlansFromSource('mutations.ts', source);
    if (!plan) throw new Error('expected optimistic plan');

    expect(serializeInlineOptimisticPlanIr(plan)).toMatchInlineSnapshot(`
      "plan closeDeal mutation="closeDeal"
      openDeals openDeals(draft, input) {
                  const index = draft.items.findIndex((item) => item.id === input.dealId);
                  if (index >= 0) draft.items.splice(index, 1);
                }
      dealList dealList: 'await-fragment'
      "
    `);
  });

  it('captures the per-entry keyed `{ keys, transform }` instance-key derivation (SPEC §10.2/§10.4)', () => {
    const source = `
      export const voteUpMutation = mutation('voteUp', {
        optimistic: {
          questionScore(draft, _input) {
            draft.score += 1;
          },
          questionDetail: {
            keys: (input) => ({ id: input.targetId }),
            transform(draft, _input) {
              if (draft) draft.score += 1;
            },
          },
          questionList: 'await-fragment',
        },
        handler() {},
      });
    `;
    const [plan] = inlineOptimisticPlansFromSource('mutations.ts', source);
    if (!plan) throw new Error('expected optimistic plan');

    const detail = plan.transforms.find((transform) => transform.query === 'questionDetail');
    expect(detail?.status).toBe('hand-written');
    // The instance-key derivation is captured as a typed lowering fact, not folded into the
    // transform source string (SPEC §5.2 #9).
    expect(detail?.keys).toBe('(input) => ({ id: input.targetId })');
    expect(detail?.source).toContain('transform(draft, _input)');
    // The keyed derivation appears in the canonical fixpoint IR so recompilation cannot drop it.
    expect(serializeInlineOptimisticPlanIr(plan)).toContain(
      'questionDetail keys (input) => ({ id: input.targetId })',
    );
  });

  it('captures a standalone OptimisticFor sibling `keys` map (SPEC §10.4)', () => {
    const source = `
      export const voteOptimistic = {
        keys: {
          questionDetail: (input) => ({ id: input.targetId }),
        },
        transforms: {
          questionDetail(draft, _input) {
            if (draft) draft.score += 1;
          },
          questionList: 'await-fragment',
        },
      } satisfies OptimisticFor<typeof voteUpMutation>;
    `;
    const [plan] = inlineOptimisticPlansFromSource('optimistic.ts', source);
    if (!plan) throw new Error('expected optimistic plan');

    const detail = plan.transforms.find((transform) => transform.query === 'questionDetail');
    expect(detail?.keys).toBe('(input) => ({ id: input.targetId })');
    const list = plan.transforms.find((transform) => transform.query === 'questionList');
    expect(list?.keys).toBeUndefined();
  });
});

function comparablePlan(plan: InlineOptimisticPlanFact): InlineOptimisticPlanFact {
  return {
    localName: 'plan',
    ...(plan.queue === undefined ? {} : { queue: plan.queue }),
    transforms: plan.transforms,
  };
}
