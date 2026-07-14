/** @jsxImportSource @kovojs/server */
// SPEC.md §6.5/§9.1: Kovo-Targets is untrusted wire input. Unknown,
// duplicated, malformed, or unauthorized targets must not leak protected data.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { PrivatePanel } from './private-panel';
import { PublicStatus } from './public-status';
import {
  privateTargetQuery,
  publicTargetQuery,
  targetPrivate,
  targetPublic,
  userId,
} from './shared';

const csrf = {
  secret: 'mutation-target-selection-csrf-secret-32-bytes',
  sessionId: (request: Request) => userId(request) ?? 'anonymous-target-session',
};

export const refreshTargets = mutation('targets/refresh', {
  input: s.object({ value: s.string() }),
  registry: {
    queries: [publicTargetQuery, privateTargetQuery],
    tables: ['target_refreshes'],
    touches: [targetPublic, targetPrivate],
  },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query({
      text: 'insert into target_refreshes (value) values ($1)',
      values: [input.value],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: (_context, request: KovoFixtureRequest) => (
    <main>
      <h1>Mutation targets</h1>
      <PublicStatus />
      {userId(request) ? (
        <PrivatePanel />
      ) : (
        <section data-private-redacted>private redacted</section>
      )}
      <form mutation={refreshTargets}></form>
    </main>
  ),
});

export default defineFixture({
  app: createApp({
    csrf,
    mutations: [refreshTargets],
    queries: [publicTargetQuery, privateTargetQuery],
    routes: [homeRoute],
  }),
  schema: `create table target_refreshes (
    id integer primary key generated always as identity,
    value text not null
  )`,
});
