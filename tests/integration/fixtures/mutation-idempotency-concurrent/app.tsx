/** @jsxImportSource @kovojs/server */
// SPEC.md §9.1/§10.3: concurrent duplicate Kovo-Idem mutation requests reserve
// one replay record before the handler runs, so the write executes once.
import { createApp, createMemoryMutationReplayStore, mutation, route, s } from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { IdemConcurrentStatus } from './idem-concurrent-status';
import { idemConcurrentDomain, idemConcurrentQuery } from './shared';

const csrf = {
  secret: 'mutation-idempotency-concurrent-secret',
  sessionId: () => 'mutation-idempotency-concurrent-session',
};

export const slowRecord = mutation('mutation-idempotency-concurrent/record', {
  input: s.object({ note: s.string() }),
  registry: {
    queries: [idemConcurrentQuery],
    tables: ['concurrent_entries'],
    touches: [idemConcurrentDomain],
  },
  handler: async (input: { note: string }, request: KovoFixtureRequest, context) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await request.db.query({
      text: 'insert into concurrent_entries (note) values ($1)',
      values: [input.note],
    });
    context.invalidate(idemConcurrentDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <IdemConcurrentStatus />
      <form mutation={slowRecord}>
        <input name="note" value="race" />
        <button type="submit">Record once</button>
      </form>
    </main>
  ),
});

export default defineFixture({
  app: createApp({
    csrf,
    mutationReplayStore: createMemoryMutationReplayStore(),
    mutations: [slowRecord],
    queries: [idemConcurrentQuery],
    routes: [homeRoute],
  }),
  schema: `create table concurrent_entries (
    id integer primary key generated always as identity,
    note text not null
  )`,
});
