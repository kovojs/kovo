import type { CartQueryResult, OrderHistoryResult, ProductGridResult } from '../app.js';

export const commerceTouchGraph = {
  "cart.addItem": {
    "touches": [
      {
        "domain": "cart",
        "keys": null,
        "site": "examples/commerce/src/app.ts:266",
        "via": "cart_items"
      },
      {
        "domain": "order",
        "keys": null,
        "site": "examples/commerce/src/app.ts:271",
        "via": "orders"
      },
      {
        "domain": "product",
        "keys": "arg:productId",
        "predicate": "eq",
        "site": "examples/commerce/src/app.ts:279",
        "via": "products"
      }
    ],
    "reads": [],
    "unresolved": []
  }
} as const;

export const commerceQueryDomains = [
  {
    "domains": ["cart"],
    "query": "cart"
  },
  {
    "domains": ["product"],
    "query": "productGrid"
  },
  {
    "domains": ["order"],
    "query": "orderHistory"
  }
] as const;

export const commerceInvalidationSets = {
  'cart/add': [
    { query: 'cart', domains: ['cart'], keys: null },
    { query: 'orderHistory', domains: ['order'], keys: null },
    { query: 'productGrid', domains: ['product'], keys: null },
  ],
} as const;

export interface CommerceInvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
}

declare module '@kovojs/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: OrderHistoryResult;
  }

  interface MutationRegistry {
    'cart/add': typeof import('../app.js').addToCart;
  }

  interface InvalidationSets extends CommerceInvalidationSets {}
}
