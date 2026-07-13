/** @jsxImportSource @kovojs/server */
// SPEC §9.1 morph survival (plans/bugs-and-testing.md C8; testing-audit §5.3): a
// fragment morph preserves user-agent/DOM-resident state. This fixture opens a
// <details> by user action, then triggers an UNRELATED morph of the enclosing
// fragment (an incremented counter) and asserts the open state survives.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { Panel } from './panel';
import { panelDomain, panelQuery } from './shared';

export const bump = mutation('morph-native-state/bump', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { queries: [panelQuery], tables: ['panel'], touches: [panelDomain] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update panel set value = value + 1 where id = 1`);
    context.invalidate(panelDomain);
    return {};
  },
});

const home = route('/', {
  page: () => (
    <main>
      <Panel />
      <form mutation={bump} enhance>
        <button type="submit">Bump</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [bump],
  queries: [panelQuery],
  routes: [home],
});

export default defineFixture({
  app,
  schema: 'create table panel (id integer primary key, value integer not null)',
  seed: (db) => db.exec(staticSql`insert into panel (id, value) values (1, 0)`),
});
