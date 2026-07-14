/** @jsxImportSource @kovojs/server */
// SPEC.md §9.1: Kovo-Targets is collected from the live DOM, including a
// nested target patched in by a generated, attested launcher rerender. The
// nested target is observable but does not gain independent render authority.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { Launcher } from './launcher';
import { wireDomain, wireQuery } from './shared';

export const advance = mutation('fragment-targets-live-dom/advance', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [wireQuery],
    tables: ['live_dom_state'],
    touches: [wireDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec(staticSql`update live_dom_state set stage = stage + 1 where id = 1`);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <Launcher />
    </main>
  ),
});

const app = createApp({
  mutations: [advance],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table live_dom_state (id integer primary key, stage integer not null)',
  seed: (db) => db.exec(staticSql`insert into live_dom_state (id, stage) values (1, 0)`),
});
