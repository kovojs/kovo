export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: 'examples/commerce/src/generated/touch-graph.ts:6',
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: 'examples/commerce/src/generated/touch-graph.ts:7',
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: 'examples/commerce/src/generated/touch-graph.ts:8',
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;
