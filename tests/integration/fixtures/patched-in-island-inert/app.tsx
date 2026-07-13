/** @jsxImportSource @kovojs/server */
// Morph application fixture: an island patched in by a fragment is discovered by
// delegated future events, but its handler module is not imported eagerly (SPEC §4.4, §9.1).
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { PatchZone } from './patch-zone';
import { islandDomain, islandQuery } from './shared';

export const addIsland = mutation('island/add', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { queries: [islandQuery], tables: ['island_patch'], touches: [islandDomain] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update island_patch set installed = 1 where id = 1`);
    context.invalidate(islandDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <PatchZone />
      <form mutation={addIsland} enhance>
        <button type="submit">Patch island</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [addIsland],
  queries: [islandQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table island_patch (id integer primary key, installed integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into island_patch (id, installed) values (1, 0)`),
});
