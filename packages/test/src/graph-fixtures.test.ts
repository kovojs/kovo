import { describe, expect, it } from 'vitest';

import {
  graphFragmentTargetForQuery,
  graphInvalidatedByQueries,
  graphInvalidatedQueries,
  graphMutationFact,
  graphMutationUpdateConsumers,
  graphOptimisticStatusMatrix,
  graphPageFact,
  graphQueryConsumers,
} from './graph-fixtures.js';

const graph = {
  components: [
    { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
  ],
  mutations: [
    { invalidates: ['cart', 'product'], key: 'cart/add' },
    { invalidates: ['attachment'], key: 'order/receipt' },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
  ],
  pages: [
    { queries: ['cart', 'productGrid'], route: '/cart' },
    { queries: [], route: '/admin' },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
};

describe('@jiso/test graph fixture seam', () => {
  it('looks up graph facts by public graph keys', () => {
    expect(graphPageFact(graph, '/cart')).toEqual({
      queries: ['cart', 'productGrid'],
      route: '/cart',
    });
    expect(graphMutationFact(graph, 'cart/add')).toEqual({
      invalidates: ['cart', 'product'],
      key: 'cart/add',
    });
    expect(graphFragmentTargetForQuery(graph, 'productGrid')).toBe('product-grid');
  });

  it('derives query consumers from component and page graph facts', () => {
    expect(graphQueryConsumers(graph)).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['component:ProductGrid', 'page:/cart'], query: 'productGrid' },
      { consumers: [], query: 'orderHistory' },
    ]);
    expect(graphMutationUpdateConsumers(graph, 'cart/add')).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['component:ProductGrid', 'page:/cart'], query: 'productGrid' },
    ]);
  });

  it('derives invalidation and optimistic matrices without fw-explain text parsing', () => {
    expect(graphInvalidatedQueries(graph, 'cart/add')).toEqual(['cart', 'productGrid']);
    expect(Object.fromEntries(graphInvalidatedByQueries(graph))).toEqual({
      cart: ['cart/add'],
      orderHistory: [],
      productGrid: ['cart/add'],
    });
    expect(graphOptimisticStatusMatrix(graph)).toEqual({
      'cart/add': {
        cart: 'hand-written',
        orderHistory: 'no-invalidation',
        productGrid: 'await-fragment',
      },
      'order/receipt': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
    });
  });

  it('fails loudly when required graph facts are absent', () => {
    expect(() => graphPageFact(graph, '/missing')).toThrow('Graph includes page route /missing');
    expect(() => graphMutationFact(graph, 'missing')).toThrow('Graph includes mutation missing');
    expect(() => graphFragmentTargetForQuery(graph, 'orderHistory')).toThrow(
      'Graph includes a fragment target for query orderHistory',
    );
  });
});
