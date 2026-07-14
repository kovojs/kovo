/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { receiptQuery } from './shared';

export const ReceiptStatus = component({
  queries: { receipt: receiptQuery },
  render: ({ receipt }: { receipt: { created: boolean } }) => {
    if (receipt.created) throw new Error('receipt renderer leaked details');
    return <output data-bind="receipt.status">Ready</output>;
  },
});
