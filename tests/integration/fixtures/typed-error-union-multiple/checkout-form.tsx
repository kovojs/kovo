/** @jsxImportSource @kovojs/server */
import { component, form, FormError } from '@kovojs/core';
import { query } from '@kovojs/server';

import { checkout } from './app';

type CheckoutFailure =
  | { code: 'CARD_DECLINED'; payload: Record<string, never> }
  | { code: 'OUT_OF_STOCK'; payload: { available: number } };

const checkoutForm = form<'checkout/submit', { quantity: number }, CheckoutFailure>(
  'checkout/submit',
);
const checkoutFormQuery = query('checkoutForm', {
  load: () => ({ ready: true }),
  reads: [],
});

export const CheckoutForm = component({
  mutations: { checkout: checkoutForm },
  queries: { checkoutForm: checkoutFormQuery },
  render: (_queries, _state, { forms }) => (
    <form mutation={checkout} enhance>
      <label>
        Quantity{' '}
        <input name="quantity" type="number" value={forms.checkout.submitted?.quantity ?? 1} />
      </label>
      <FormError
        code="OUT_OF_STOCK"
        message={(failure: { payload: { available: number } }) =>
          `Only ${failure.payload.available} available`
        }
      />
      <FormError code="CARD_DECLINED" message="Card declined" />
      <button type="submit">Pay</button>
    </form>
  ),
});
