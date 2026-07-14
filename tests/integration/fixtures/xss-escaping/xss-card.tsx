/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';
import { trustedUrl } from '@kovojs/server';

import { payloadQuery, type PayloadResult } from './shared';

const updatePayloadForm = form<'xss/update', Record<string, never>>('xss/update');

// SPEC §§4.8/9.1: generated bindings own output escaping. This visible
// query-plan consumer does not accept a server fragment because the query plan
// must apply its URL-scheme sanitizer after every server-truth update.
export const XssCard = component({
  disableServerRefresh: true,
  queries: { payload: payloadQuery },
  render: ({ payload }: { payload: PayloadResult }) => (
    <tsx-xss-card>
      <output>{payload.text}</output>
      <a
        href={trustedUrl('https://example.com', 'fixture safe initial URL')}
        {...{ 'data-bind:href': 'payload.url' }}
      >
        link
      </a>
    </tsx-xss-card>
  ),
});

// The compiler-generated hidden target supplies the attested, app-scoped
// authority that permits the mutation to rerun payloadQuery. Its fragment never
// overwrites the visible query-plan consumer after safe bindings are applied.
export const XssResponseAuthority = component({
  mutations: { updatePayload: updatePayloadForm },
  queries: { payload: payloadQuery },
  render: ({ payload }: { payload: PayloadResult }) => (
    <xss-response-authority aria-hidden="true" hidden>
      <span>{payload.text}</span>
    </xss-response-authority>
  ),
});
