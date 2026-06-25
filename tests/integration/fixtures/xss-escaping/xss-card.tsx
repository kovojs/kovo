/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { payloadQuery, type PayloadResult } from './shared';

export const XssCard = component({
  disableServerRefresh: true,
  queries: { payload: payloadQuery },
  render: ({ payload }: { payload: PayloadResult }) => (
    <tsx-xss-card>
      <output>{payload.text}</output>
      <a href={payload.url}>link</a>
    </tsx-xss-card>
  ),
});
