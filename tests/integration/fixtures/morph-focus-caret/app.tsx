/** @jsxImportSource @kovojs/server */
// Morph survival fixture: a focused keyed input lives inside a fragment target
// whose sibling server-truth text changes on enhanced mutation (SPEC §9.1).
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ProfileEditor } from './profile-editor';
import { profileDomain, profileQuery } from './shared';

export const saveDraft = mutation('profile/save-draft', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ draft: s.string() }),
  registry: { queries: [profileQuery], tables: ['profile'], touches: [profileDomain] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update profile set version = version + 1 where id = 1`);
    context.invalidate(profileDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <ProfileEditor />
    </main>
  ),
});

const app = createApp({
  mutations: [saveDraft],
  queries: [profileQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table profile (id integer primary key, version integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into profile (id, version) values (1, 0)`),
});
