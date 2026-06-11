export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: 'examples/commerce/src/app.ts:196',
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: 'examples/commerce/src/app.ts:201',
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: 'examples/commerce/src/app.ts:208',
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;
