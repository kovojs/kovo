/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ParentPanel } from './parent-panel';
import { parentDomain, parentQuery } from './shared';

const refreshParent = mutation('morph-nested-island-state/refresh', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: {
    queries: [parentQuery],
    tables: ['nested_island_parent'],
    touches: [parentDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      staticSql`update nested_island_parent set version = version + 1 where id = 1`,
    );
    context.invalidate(parentDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      {trustedHtml('<script type="module" src="/client.ts"></script>')}
      <ParentPanel />
      <form id="refresh-parent" method="post" action="/_m/morph-nested-island-state/refresh">
        <button type="submit">Refresh parent</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [refreshParent],
  queries: [parentQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table nested_island_parent (id integer primary key, version integer not null)',
  seed: (db) => db.exec(staticSql`insert into nested_island_parent (id, version) values (1, 0)`),
});
