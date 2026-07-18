/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { updateCard } from './app';
import { cardQuery, type CardResult } from './shared';

const updateCardForm = form<'binding-text-attr/update', Record<string, never>>(
  'binding-text-attr/update',
);

// SPEC §9.1: the compiler owns this query-backed component's live target,
// reconstruction identity, and mutation response authority.
export const BindingCard = component({
  mutations: { updateCard: updateCardForm },
  queries: { card: cardQuery },
  render: ({ card }: { card: CardResult }) => (
    <binding-card>
      <output>{card.text}</output>
      <button
        type="button"
        {...{
          'aria-label': card.label,
          'data-bind:aria-label': 'card.label',
          'data-bind:data-state': 'card.status',
          'data-state': card.status,
        }}
      >
        Server binding
      </button>
      <form mutation={updateCard} enhance>
        <button type="submit">Update server card</button>
      </form>
    </binding-card>
  ),
});
