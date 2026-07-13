/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ProfileStatus } from './profile-status';
import { ProfileSummary } from './profile-summary';
import { profileDomain, profileQuery, readProfile } from './shared';

export const publishProfile = mutation('shared-query-consumers/publish', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [profileQuery],
    tables: ['profile'],
    touches: [profileDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      staticSql`update profile set name = 'Grace Hopper', status = 'published' where id = 1`,
    );
    context.invalidate(profileDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const profile = await readProfile(request.db);
    return (
      <main>
        {trustedHtml(renderQueryScript({ name: 'profile', value: profile }))}
        <ProfileSummary />
        <ProfileStatus />
        <form
          method="post"
          action="/_m/shared-query-consumers/publish"
          enhance
          data-mutation="shared-query-consumers/publish"
        >
          <button type="submit">Publish profile</button>
        </form>
      </main>
    );
  },
});

const app = createApp({
  mutations: [publishProfile],
  queries: [profileQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table profile (id integer primary key, name text not null, status text not null)',
  seed: (db) =>
    db.exec(staticSql`insert into profile (id, name, status) values (1, 'Ada Lovelace', 'draft')`),
});
