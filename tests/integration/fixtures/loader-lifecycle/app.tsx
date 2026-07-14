/** @jsxImportSource @kovojs/server */
// SPEC.md §4.4/§4.7/§9.1: delegated handlers receive ctx.signal, and
// the generated live-component mutation response aborts an island it removes.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, stream } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { PrimaryRunner } from './primary-runner';

export const swapIsland = mutation('loader-lifecycle/swap', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: { tables: ['lifecycle_state'] },
  handler: async (_input, request: KovoFixtureRequest) => {
    await request.db.exec(staticSql`update lifecycle_state set stage = 'replaced' where id = 1`);
    return {};
  },
  async *stream() {
    yield stream.fragment({
      html: (
        <replacement-runner-host data-stage="replaced">
          <button type="button" data-replacement-runner on:click="/client.ts#startReplacementTask">
            Replacement task
          </button>
        </replacement-runner-host>
      ),
      target: 'lifecycle-shell',
    });
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Loader lifecycle</h1>
      <p data-lifecycle-status>idle</p>
      <div kovo-fragment-target="lifecycle-shell">
        <PrimaryRunner />
      </div>
      <form mutation={swapIsland} enhance stream>
        <button type="submit">Swap island</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [swapIsland],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    "create table lifecycle_state (id integer primary key, stage text not null default 'active')",
  seed: (db) => db.exec(staticSql`insert into lifecycle_state (id, stage) values (1, 'active')`),
});
