// Morph survival fixture: a focused keyed input lives inside a fragment target
// whose sibling server-truth text changes on enhanced mutation (SPEC §9.1).
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

async function readVersion(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ version: number }>('select version from profile where id = 1');
  return rows[0]?.version ?? 0;
}

async function renderEditor(db: KovoFixtureRequest['db']): Promise<string> {
  const version = await readVersion(db);
  return `<section kovo-fragment-target="profile-editor" kovo-key="profile-editor" kovo-deps="profile">
    <form kovo-key="draft-form" method="post" action="/_m/profile/save-draft" enhance data-mutation="profile/save-draft" kovo-deps="profile">
      <label for="draft">Draft</label>
      <input id="draft" name="draft" kovo-key="draft" value="server draft ${version}">
      <p>Server version <output data-bind="profile.version">${version}</output></p>
      <button type="submit">Refresh server truth</button>
    </form>
  </section>`;
}

export const saveDraft = mutation('profile/save-draft', {
  access: publicAccess('integration fixture mutation profile/save-draft has no runtime guard'),
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec('update profile set version = version + 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const editor = await renderEditor(request.db);
    return `<main>
      <kovo-fragment target="profile-editor">${editor}</kovo-fragment>
    </main>`;
  },
});

const app = createApp({
  mutations: [saveDraft],
  routes: [homeRoute],
  mutationResponses: {
    [saveDraft.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        redirectTo: '/',
        fragmentRenderers: [{ render: () => renderEditor(db), target: 'profile-editor' }],
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table profile (id integer primary key, version integer not null default 0)',
  seed: (db) => db.exec('insert into profile (id, version) values (1, 0)'),
});
