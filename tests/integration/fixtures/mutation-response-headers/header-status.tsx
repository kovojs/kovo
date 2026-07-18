/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { touchHeaders } from './app';
import { headersQuery } from './shared';

const touchHeadersForm = form<'mutation-response-headers/touch', Record<string, never>>(
  'mutation-response-headers/touch',
);

export const HeaderStatus = component({
  mutations: { touchHeaders: touchHeadersForm },
  queries: { headers: headersQuery },
  render: ({ headers }: { headers: { count: number } }) => (
    <section>
      <output>{headers.count}</output>
      <form mutation={touchHeaders} enhance>
        <button type="submit">Touch headers</button>
      </form>
    </section>
  ),
});
