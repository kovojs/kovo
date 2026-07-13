/** @jsxImportSource @kovojs/server */
// SPEC.md §4.4/§4.7: fragment morphs that remove islands abort their ctx.signal
// and leave patched/replacement islands inert until a declared trigger or interaction.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { MorphAbortShell } from './morph-abort-shell';
import { morphAbortDomain, morphAbortQuery } from './shared';

export const removeIsland = mutation('morph-remove-aborts/remove', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: {
    queries: [morphAbortQuery],
    tables: ['morph_abort_state'],
    touches: [morphAbortDomain],
  },
  handler: async (_input, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update morph_abort_state set stage = 'removed' where id = 1`);
    context.invalidate(morphAbortDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Morph remove aborts</h1>
      <p data-morph-abort-status>idle</p>
      <MorphAbortShell />
      <form mutation={removeIsland} enhance>
        <button type="submit">Remove island</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [removeIsland],
  queries: [morphAbortQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    "create table morph_abort_state (id integer primary key, stage text not null default 'active')",
  seed: (db) => db.exec(staticSql`insert into morph_abort_state (id, stage) values (1, 'active')`),
});
