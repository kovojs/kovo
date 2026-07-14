/** @jsxImportSource @kovojs/server */
// SPEC.md §6.3/§9.1: enhanced submission preserves real POST form markup,
// while the success response is generated from the mutation's changed domain and
// the live query-backed component attested by the browser.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { SubmitControls } from './submit-controls';
import { submissionDomain, submissionQuery } from './shared';

export const submitOrder = mutation('enhanced-submit-controls/submit', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({
    includeGift: s.boolean(),
    intent: s.string(),
    quantity: s.number().int().min(1),
  }),
  registry: {
    queries: [submissionQuery],
    tables: ['enhanced_submit_log'],
    touches: [submissionDomain],
  },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query({
      text: 'insert into enhanced_submit_log (quantity, include_gift, intent) values ($1, $2, $3)',
      values: [input.quantity, input.includeGift ? 1 : 0, input.intent],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Enhanced submit controls</h1>
      <SubmitControls />
    </main>
  ),
});

const app = createApp({
  mutations: [submitOrder],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: `create table enhanced_submit_log (
    id integer primary key generated always as identity,
    quantity integer not null,
    include_gift integer not null,
    intent text not null
  )`,
});
