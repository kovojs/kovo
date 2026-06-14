import type { CartQueryResult, OrderHistoryResult, ProductGridResult } from '../app.js';

export const commerceTouchGraph = {
  "cart.addItem": {
    "touches": [
      {
        "domain": "cart",
        "keys": null,
        "site": "examples/commerce/src/app.ts:334",
        "via": "cart_items"
      },
      {
        "domain": "order",
        "keys": null,
        "site": "examples/commerce/src/app.ts:339",
        "via": "orders"
      },
      {
        "domain": "product",
        "keys": "arg:productId",
        "predicate": "eq",
        "site": "examples/commerce/src/app.ts:347",
        "via": "products"
      }
    ],
    "reads": [],
    "unresolved": []
  },
  "payment.webhook": {
    "touches": [
      {
        "domain": "order",
        "keys": "arg:data.object.id",
        "predicate": "eq",
        "site": "examples/commerce/src/app.ts:435",
        "via": "orders"
      }
    ],
    "reads": [],
    "unresolved": []
  },
  "order.receipt": {
    "touches": [
      {
        "domain": "attachment",
        "keys": "arg:orderId",
        "predicate": "eq",
        "site": "examples/commerce/src/app.ts:385",
        "via": "attachments"
      }
    ],
    "reads": [],
    "unresolved": []
  }
} as const;

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

declare module '@jiso/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: OrderHistoryResult;
  }

  interface InvalidationSets extends CommerceInvalidationSets {}
}
