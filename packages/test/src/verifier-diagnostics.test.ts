import { describe, expect, it } from 'vitest';
import { diagnosticsForObservations } from './verifier-diagnostics.js';

describe('@jiso/test verifier diagnostics', () => {
  it('reports unobserved conditional branches before unobserved domains', () => {
    expect(
      diagnosticsForObservations(
        [
          {
            branch: 'cart-line',
            domain: 'cart',
            kind: 'write',
            mutationRead: undefined,
            rowKey: undefined,
            sql: undefined,
            table: 'cart_items',
          },
        ],
        {
          'cart.addItem': {
            touches: [
              {
                branch: 'cart-line',
                domain: 'cart',
                keys: 'arg:productId',
                site: 'cart.domain.ts:1',
                via: 'cart_items',
              },
              {
                branch: 'stock-reserve',
                domain: 'product',
                keys: 'arg:productId',
                site: 'cart.domain.ts:2',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
      ),
    ).toEqual([
      {
        branch: 'stock-reserve',
        code: 'FW405',
        domain: 'product',
        message: 'Conditional write branch was never executed under instrumentation.',
        severity: 'warn',
        site: 'cart.domain.ts:2',
      },
      {
        code: 'FW403',
        domain: 'product',
        message: 'Declared domain was never observed written.',
        severity: 'warn',
      },
    ]);
  });
});
