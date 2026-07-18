/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { submitOrder } from './app';
import { submissionQuery, type SubmissionReport } from './shared';

interface SubmitOrderInput {
  includeGift: boolean;
  intent: 'confirm' | 'preview';
  quantity: number;
}

const submitOrderForm = form<'enhanced-submit-controls/submit', SubmitOrderInput>(
  'enhanced-submit-controls/submit',
);

export const SubmitControls = component({
  mutations: { submitOrder: submitOrderForm },
  queries: { submission: submissionQuery },
  render: ({ submission }: { submission: SubmissionReport }) => (
    <section>
      <form mutation={submitOrder} enhance>
        <label>
          Quantity <input name="quantity" type="number" value="2" min="1" />
        </label>
        <input name="includeGift" type="hidden" value="true" />
        <input name="adminNote" value="do-not-include" disabled />
        <button type="submit" name="intent" value="confirm">
          Submit order
        </button>
      </form>
      <form mutation={submitOrder} enhance>
        <input name="quantity" type="hidden" value="2" />
        <input name="includeGift" type="hidden" value="true" />
        <button type="submit" name="intent" value="preview">
          Preview order
        </button>
      </form>
      <output data-submit-report>
        {submission.intent === null
          ? 'no submissions yet'
          : `intent=${submission.intent}; quantity=${submission.quantity}; includeGift=${submission.includeGift}; adminNote=missing`}
      </output>
    </section>
  ),
});
