import { s } from '@kovojs/server';

import { app } from './scaffold-kovo.js';

/**
 * A typed reservation interaction with no ambient or database authority. It gives a fresh app a
 * real mutation/form path while leaving inventory persistence to the selected deployment adapter.
 */
export const reserveProduct = app.mutation({
  access: app.publicAccess('stateless commerce scaffold reservation'),
  input: s.object({
    productId: s.string(),
    quantity: s.string(),
  }),
  handler(input) {
    return {
      productId: input.productId,
      quantity: input.quantity,
      status: 'reserved',
    };
  },
  redirectTo() {
    return '/?reserved=1';
  },
});
