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
});

function comparablePlan(plan: InlineOptimisticPlanFact): InlineOptimisticPlanFact {
  return {
    localName: 'plan',
    ...(plan.queue === undefined ? {} : { queue: plan.queue }),
    transforms: plan.transforms,
  };
}
