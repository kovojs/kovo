/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { csrfQuery, type CsrfTotalResult } from './shared';

export const CsrfTotal = component({
  queries: { csrf: csrfQuery },
  render: ({ csrf }: { csrf: CsrfTotalResult }) => (
    <section>
      <output>{csrf.total}</output>
    </section>
  ),
});
