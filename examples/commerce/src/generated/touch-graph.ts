export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: 'examples/commerce/src/app.ts:207',
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: 'examples/commerce/src/app.ts:212',
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: 'examples/commerce/src/app.ts:219',
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;
