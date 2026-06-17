import { createApp, mutation, renderQueryScript, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

import { ProfileStatus } from './profile-status';
import { ProfileSummary } from './profile-summary';
import { profileDomain, profileQuery, readProfile } from './shared';

async function renderSummary(db: KovoFixtureRequest['db']): Promise<string> {
  const profile = await readProfile(db);
  return ProfileSummary.definition.render({ profile }) as unknown as string;
}

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const profile = await readProfile(db);
  return ProfileStatus.definition.render({ profile }) as unknown as string;
}

export const publishProfile = mutation('shared-query-consumers/publish', {
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [profileQuery],
    touches: [profileDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      "update profile set name = 'Grace Hopper', status = 'published' where id = 1",
    );
    context.invalidate(profileDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const profile = await readProfile(request.db);
    const summary = await renderSummary(request.db);
    const status = await renderStatus(request.db);
    return `${renderQueryScript({ name: 'profile', value: profile })}
    <main>
      <kovo-fragment target="profile-summary">${summary}</kovo-fragment>
      <kovo-fragment target="profile-status">${status}</kovo-fragment>
      <form method="post" action="/_m/shared-query-consumers/publish" enhance data-mutation="shared-query-consumers/publish" kovo-deps="profile">
        <button type="submit">Publish profile</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [publishProfile],
  queries: [profileQuery],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== publishProfile.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [
        { render: () => renderSummary(db), target: 'profile-summary' },
        { render: () => renderStatus(db), target: 'profile-status' },
      ],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table profile (id integer primary key, name text not null, status text not null)',
  seed: (db) =>
    db.exec("insert into profile (id, name, status) values (1, 'Ada Lovelace', 'draft')"),
});
