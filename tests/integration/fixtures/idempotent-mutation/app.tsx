/** @jsxImportSource @kovojs/server */
// SPEC.md §9.1/§10.3: duplicate Kovo-Idem mutation requests replay the stored response.
import { createApp, createMemoryMutationReplayStore, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { IdemStatus } from './idem-status';
import { idemDomain, idemQuery } from './shared';

const csrf = {
  secret: 'idempotent-mutation-secret-at-least-32-bytes',
  sessionId: () => 'idempotent-mutation-session',
};

export const recordEntry = mutation('idempotent-mutation/record', {
  defaultRedirectTo: '/',
  input: s.object({ note: s.string() }),
  registry: { queries: [idemQuery], tables: ['ledger_entries'], touches: [idemDomain] },
  handler: async (input: { note: string }, request: KovoFixtureRequest, context) => {
    await request.db.exec({
      text: 'insert into ledger_entries (note) values ($1)',
      values: [input.note],
    });
    context.invalidate(idemDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <IdemStatus />
      <form mutation={recordEntry} enhance>
        <input name="note" value="first" />
        <button type="submit">Record entry</button>
      </form>
    </main>
  ),
});

const app = createApp({
  csrf,
  mutationReplayStore: createMemoryMutationReplayStore(),
  mutations: [recordEntry],
  queries: [idemQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table ledger_entries (id serial primary key, note text not null)',
});
