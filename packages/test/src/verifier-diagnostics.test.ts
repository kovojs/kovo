import { describe, expect, it } from 'vitest';

import { diagnosticsForObservations } from '@kovojs/test/internal/verifier-diagnostics';
import { expectedDiagnosticMessage } from './test-fixtures.js';

describe('@kovojs/test verifier diagnostics', () => {
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
        code: 'KV405',
        domain: 'product',
        message: expectedDiagnosticMessage('KV405'),
        severity: 'warn',
        site: 'cart.domain.ts:2',
      },
      {
        code: 'KV403',
        domain: 'product',
        message: expectedDiagnosticMessage('KV403'),
        severity: 'warn',
      },
    ]);
  });
});
