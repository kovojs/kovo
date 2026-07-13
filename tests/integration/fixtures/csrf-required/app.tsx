/** @jsxImportSource @kovojs/server */
// SPEC.md §6.6/§9.1: mutation POSTs validate CSRF before parsing or guards.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CsrfTotal } from './csrf-total';
import { csrfDomain, csrfQuery } from './shared';

const csrf = {
  secret: 'csrf-required-secret-at-least-32-bytes',
  sessionId: () => 'csrf-required-session',
};

export const deposit = mutation('csrf-required/deposit', {
  defaultRedirectTo: '/',
  input: s.object({ amount: s.number().int().min(1) }),
  registry: { queries: [csrfQuery], tables: ['payments'], touches: [csrfDomain] },
  handler: async (input: { amount: number }, request: KovoFixtureRequest, context) => {
    await request.db.exec({
      text: 'insert into payments (amount) values ($1)',
      values: [input.amount],
    });
    context.invalidate(csrfDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <CsrfTotal />
      <form mutation={deposit} enhance>
        <input type="number" name="amount" value="1" />
        <button type="submit">Deposit with csrf</button>
      </form>
    </main>
  ),
});

const app = createApp({
  csrf,
  mutations: [deposit],
  queries: [csrfQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table payments (id serial primary key, amount integer not null)',
});
