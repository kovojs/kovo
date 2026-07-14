/** @jsxImportSource @kovojs/server */
import { component, FieldError, form } from '@kovojs/core';
import { query } from '@kovojs/server';

const reserveForm = form<'validation/reserve', { quantity: number }>('validation/reserve');
const reservationFormQuery = query('reservationForm', {
  load: () => ({ ready: true }),
  reads: [],
});

export const ReservationForm = component({
  mutations: { reserve: reserveForm },
  queries: { reservationForm: reservationFormQuery },
  render: (_queries, _state, { forms }) => {
    const invalid = forms.reserve.failure?.code === 'VALIDATION';

    return (
      <form mutation={reserveForm} enhance>
        <label>
          Quantity{' '}
          <input name="quantity" type="number" value={forms.reserve.submitted?.quantity ?? 0} />
        </label>
        {invalid ? (
          <span data-error-path="quantity">
            <FieldError name="quantity" />
          </span>
        ) : null}
        <button type="submit">Reserve</button>
      </form>
    );
  },
});
