/** @jsxImportSource @kovojs/server */
// SPEC.md §9.1/§9.2: the success response is generated from a changed
// domain and an attested live component; a post-commit component render failure
// returns the stable framework-owned render-error fragment.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ReceiptStatus } from './receipt-status';
import { receiptDomain, receiptQuery } from './shared';

export const createReceipt = mutation('render-error-fragment/create', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ id: s.string(), secret: s.string() }),
  registry: { queries: [receiptQuery], tables: ['receipts'] },
  handler: async (input: { id: string; secret: string }, request: KovoFixtureRequest, context) => {
    await request.db.exec({
      text: 'insert into receipts (id, secret) values ($1, $2)',
      values: [input.id, input.secret],
    });
    context.invalidate(receiptDomain, {
      input: { secret: input.secret },
      keys: [input.id],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <ReceiptStatus />
      <form mutation={createReceipt} enhance>
        <input name="id" value="r1" />
        <input name="secret" value="committed-secret" />
        <button type="submit">Create receipt</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [createReceipt],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table receipts (id text primary key, secret text not null)',
});
