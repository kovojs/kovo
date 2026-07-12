import { describe, expect, it } from 'vitest';

import { runLoweringPipeline, validateLoweringPipelinePassContracts } from './lowering-pipeline.js';
import { componentPipelineState } from './model-pipeline.js';
import { parseComponentModule } from './scan/parse.js';

describe('lowering pipeline pass contracts', () => {
  it('accepts the built-in pass order', () => {
    expect(() => validateLoweringPipelinePassContracts()).not.toThrow();
  });

  it('fails before running a pass whose declared input has not been produced', () => {
    const passes: Parameters<typeof validateLoweringPipelinePassContracts>[0] = [
      {
        kind: 'lower',
        name: 'structural-jsx',
        requires: ['style-span-probe'],
        run() {},
      },
    ];

    expect(() => validateLoweringPipelinePassContracts(passes)).toThrow(
      'Lowering pipeline pass "structural-jsx" requires "style-span-probe"',
    );
  });

  it('snapshots typed facts produced by lowering passes', () => {
    const source = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({
  active: { color: 'green' },
  inactive: { color: 'gray' },
});

export const CartBadge = component({
  queries: { cart: true },
  render: ({ cart }) => <span style={cart.active ? styles.active : styles.inactive}>Cart</span>,
});
`;
    const model = parseComponentModule('components/cart-badge.tsx', source);
    const result = runLoweringPipeline(
      componentPipelineState('components/cart-badge.tsx', source, model),
      'CartBadge',
      { fileName: 'components/cart-badge.tsx', source },
    );

    expect(result.factSnapshot.owners).toEqual(
      expect.arrayContaining([{ phase: 'lower', pass: 'style-extraction' }]),
    );
    expect(result.factSnapshot.queryUpdatePlans).toEqual([
      expect.objectContaining({
        componentName: 'CartBadge',
        query: 'cart',
        stamps: [
          expect.objectContaining({
            attr: 'class',
            derive: expect.objectContaining({
              expression: expect.stringContaining('cart.active'),
            }),
          }),
        ],
      }),
    ]);
    expect(result.factSnapshot.styleRuleUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ styleRef: 'styles.active' }),
        expect.objectContaining({ styleRef: 'styles.inactive' }),
      ]),
    );
    expect(result.factSnapshot.factHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
