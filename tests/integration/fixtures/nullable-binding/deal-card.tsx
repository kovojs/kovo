/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { dealQuery, type DealResult } from './shared';

export const DealCard = component({
  queries: { deal: dealQuery },
  render: ({ deal }: { deal: DealResult }) => (
    <deal-card>
      <output>{deal.contact?.name}</output>
      {deal.contact ? (
        <a href="/contacts/server" aria-label="Server Contact">
          Contact
        </a>
      ) : (
        <a>Contact</a>
      )}
    </deal-card>
  ),
});
