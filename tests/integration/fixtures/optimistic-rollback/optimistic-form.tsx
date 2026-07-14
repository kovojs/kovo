/** @jsxImportSource @kovojs/server */
import { component, form, FormError } from '@kovojs/core';
import { query } from '@kovojs/server';

interface OutOfStockFailure {
  code: 'OUT_OF_STOCK';
  payload: { available: number };
}

const addItemForm = form<'optimistic-rollback/add', { quantity: number }, OutOfStockFailure>(
  'optimistic-rollback/add',
);
const optimisticFormQuery = query('optimisticForm', {
  load: () => ({ ready: true }),
  reads: [],
});

export const OptimisticForm = component({
  mutations: { addItem: addItemForm },
  queries: { optimisticForm: optimisticFormQuery },
  render: () => (
    <form id="optimistic-form" mutation={addItemForm} enhance>
      <input type="hidden" name="quantity" value="2" />
      <FormError
        code="OUT_OF_STOCK"
        message={(failure: OutOfStockFailure) => `Only ${failure.payload.available} available`}
      />
      <button type="submit">Add optimistically</button>
    </form>
  ),
});
