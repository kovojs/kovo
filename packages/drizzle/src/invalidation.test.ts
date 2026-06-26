import { describe, expect, it } from 'vitest';

import type { TouchGraph } from '@kovojs/core/internal/graph';

import { deriveMutationTouchRegistry, serializeMutationTouchRegistry } from './invalidation.js';

// bugz-3 M9 / SPEC §10.1: a domain whose rows live across multiple tables
// (parent+child / relational) has its row keys split across distinct per-table
// identity spaces. A key-scoped change to one such table is NOT a provable single-row
// identity of the domain, so `deriveMutationTouchRegistry` must mark the touch
// `crossTable` and the runtime must over-invalidate the domain rather than narrow by
// raw key equality (which silently drops a same-domain child reader).
describe('deriveMutationTouchRegistry relational-domain over-invalidation (bugz-3 M9)', () => {
  // `cart` maps from two tables (carts + cart_items); `product` from one.
  const tableDomains = { cart_items: 'cart', carts: 'cart', products: 'product' };
  const touchGraph: TouchGraph = {
    'cart.removeItem': {
      reads: [],
      touches: [
        { domain: 'cart', keys: 'arg:itemId', site: 'cart.domain.ts:12', via: 'cart_items' },
      ],
      unresolved: [],
    },
    'product.update': {
      reads: [],
      touches: [
        { domain: 'product', keys: 'arg:productId', site: 'product.domain.ts:8', via: 'products' },
      ],
      unresolved: [],
    },
  };
  const mutations = [
    { mutation: 'removeCartItem', touchGraphKey: 'cart.removeItem' },
    { mutation: 'updateProduct', touchGraphKey: 'product.update' },
  ];

  it('flags a relational-domain touch crossTable from the tableDomains map; single-table touches are unmarked', () => {
    expect(deriveMutationTouchRegistry({ mutations, tableDomains, touchGraph })).toEqual({
      // The child-table DELETE on a multi-table domain is crossTable → over-invalidate.
      removeCartItem: [{ crossTable: true, domain: 'cart', keys: 'arg:itemId' }],
      // The single-table touch stays narrowable (no marker).
      updateProduct: [{ domain: 'product', keys: 'arg:productId' }],
    });
  });

  it('recovers the relational signal from the touch graph alone when a domain is touched via >1 table', () => {
    // No `tableDomains` supplied: `cart` is still relational because the graph itself
    // shows it written via two tables (carts + cart_items) across mutations.
    const graph: TouchGraph = {
      'cart.add': {
        reads: [],
        touches: [{ domain: 'cart', keys: 'arg:cartId', site: 'cart.ts:4', via: 'carts' }],
        unresolved: [],
      },
      'cart.removeItem': {
        reads: [],
        touches: [{ domain: 'cart', keys: 'arg:itemId', site: 'cart.ts:12', via: 'cart_items' }],
        unresolved: [],
      },
    };
    expect(
      deriveMutationTouchRegistry({
        mutations: [
          { mutation: 'addToCart', touchGraphKey: 'cart.add' },
          { mutation: 'removeCartItem', touchGraphKey: 'cart.removeItem' },
        ],
        touchGraph: graph,
      }),
    ).toEqual({
      addToCart: [{ crossTable: true, domain: 'cart', keys: 'arg:cartId' }],
      removeCartItem: [{ crossTable: true, domain: 'cart', keys: 'arg:itemId' }],
    });
  });

  it('does NOT mark single-table domains crossTable (narrowing optimization preserved)', () => {
    // No tableDomains, single via per domain → no relational signal anywhere.
    expect(deriveMutationTouchRegistry({ mutations, touchGraph })).toEqual({
      removeCartItem: [{ domain: 'cart', keys: 'arg:itemId' }],
      updateProduct: [{ domain: 'product', keys: 'arg:productId' }],
    });
  });

  it('serializes the crossTable marker into the generated touch registry', () => {
    const registry = deriveMutationTouchRegistry({ mutations, tableDomains, touchGraph });
    const source = serializeMutationTouchRegistry(registry);
    expect(source).toContain("    { domain: 'cart', keys: 'arg:itemId', crossTable: true },");
    // Single-table touch is serialized without the marker (unchanged shape).
    expect(source).toContain("    { domain: 'product', keys: 'arg:productId' },");
  });
});
