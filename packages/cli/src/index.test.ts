import { describe, expect, it } from 'vitest';

import { fwCheck } from './index.js';

describe('fw check', () => {
  it('emits stable OK output for an empty semantic graph', () => {
    expect(fwCheck({})).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('reports FW310 optimistic coverage gaps without failing the command', () => {
    expect(
      fwCheck({
        optimistic: [
          { mutation: 'cart/add', query: 'cartQuery.items', status: 'UNHANDLED' },
          { mutation: 'cart/add', query: 'cartQuery.count', status: 'hand-written' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cartQuery.items Invalidated query lacks optimistic transform.\n',
    });
  });

  it('reports unresolved touch graph sites as FW406', () => {
    expect(
      fwCheck({
        touchGraph: {
          'cart.addItem': {
            touches: [],
            unresolved: [
              {
                code: 'FW406',
                message: 'Statically un-analyzable write site; manual touches required.',
                site: 'cart.domain.ts:20',
              },
            ],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW406 cart.domain.ts:20 Statically un-analyzable write site; manual touches required.\n',
    });
  });

  it('fails when a query reads a domain no mutation can invalidate', () => {
    expect(
      fwCheck({
        queries: [{ domains: ['cart', 'product'], query: 'productPage' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW407 productPage reads product but no mutation touch graph writes that domain.\n',
    });
  });

  it('accepts query read domains covered by the touch graph', () => {
    expect(
      fwCheck({
        queries: [{ domains: ['cart'], query: 'cart' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });
});
