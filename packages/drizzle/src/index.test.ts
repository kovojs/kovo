import { describe, expect, it } from 'vitest';

import {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  jiso,
  serializeDomainRegistry,
  serializeTouchGraph,
} from './index.js';

describe('@jiso/drizzle touch graph helpers', () => {
  it('creates deterministic touch graph entries from annotated tables', () => {
    const cartItems = { ...jiso({ domain: 'cart', key: 'cartId' }), name: 'cart_items' };
    const products = { ...jiso({ domain: 'product', key: 'id' }), name: 'products' };

    const entry = createTouchGraphEntry({
      writes: [
        {
          operation: 'update',
          site: 'cart.domain.ts:12',
          table: products,
          writeKey: 'arg:productId',
        },
        {
          operation: 'insert',
          site: 'cart.domain.ts:8',
          table: cartItems,
        },
      ],
    });

    expect(entry).toEqual({
      touches: [
        { domain: 'cart', keys: null, site: 'cart.domain.ts:8', via: 'cart_items' },
        { domain: 'product', keys: 'arg:productId', site: 'cart.domain.ts:12', via: 'products' },
      ],
      unresolved: [],
    });
  });

  it('serializes committed generated/touch-graph.ts output', () => {
    expect(
      serializeTouchGraph({
        'cart.addItem': createTouchGraphEntry({
          unresolved: [{ operation: 'raw', site: 'cart.domain.ts:20' }],
        }),
      }),
    ).toBe(`export const touchGraph = {
  "cart.addItem": {
    touches: [
    ],
    unresolved: [
      { code: 'FW406', site: "cart.domain.ts:20", message: "Statically un-analyzable write site; manual touches required." },
    ],
  },
} as const;
`);
  });

  it('reports FW406 diagnostics for unresolved write sites', () => {
    expect(
      diagnosticsForTouchGraph({
        'cart.addItem': createTouchGraphEntry({
          unresolved: [{ operation: 'raw', site: 'cart.domain.ts:20' }],
        }),
      }),
    ).toEqual([
      {
        code: 'FW406',
        message: 'Statically un-analyzable write site; manual touches required.',
        severity: 'warn',
        site: 'cart.domain.ts:20',
      },
    ]);
  });

  it('serializes deterministic domain registry output from table annotations', () => {
    const cartItems = { ...jiso({ domain: 'cart', key: 'cartId' }), name: 'cart_items' };
    const products = { ...jiso({ domain: 'product', key: 'id' }), name: 'products' };

    expect(serializeDomainRegistry([{ table: products }, { table: cartItems }]))
      .toBe(`export type DomainKey = "cart" | "product";

export const tableDomains = {
  "cart_items": "cart",
  "products": "product",
} as const satisfies Record<string, DomainKey>;
`);
  });

  it('serializes an empty domain registry as a never-keyed map', () => {
    expect(serializeDomainRegistry([])).toBe(`export type DomainKey = never;

export const tableDomains = {
} as const satisfies Record<string, DomainKey>;
`);
  });
});
