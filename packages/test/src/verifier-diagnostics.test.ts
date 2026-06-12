import { describe, expect, it } from 'vitest';

import { diagnosticsForObservations } from '@jiso/test/verifier-diagnostics';
import { expectedDiagnosticMessage } from './test-fixtures.js';

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
        message: expectedDiagnosticMessage('FW405'),
        severity: 'warn',
        site: 'cart.domain.ts:2',
      },
      {
        code: 'FW403',
        domain: 'product',
        message: expectedDiagnosticMessage('FW403'),
        severity: 'warn',
      },
    ]);
  });
});
