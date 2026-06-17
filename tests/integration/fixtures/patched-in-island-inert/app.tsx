// Morph application fixture: an island patched in by a fragment is discovered by
// delegated future events, but its handler module is not imported eagerly (SPEC §4.4, §9.1).
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

async function readInstalled(db: KovoFixtureRequest['db']): Promise<boolean> {
  const rows = await db.query<{ installed: number }>(
    'select installed from island_patch where id = 1',
  );
  return rows[0]?.installed === 1;
}

async function renderZone(db: KovoFixtureRequest['db']): Promise<string> {
  const installed = await readInstalled(db);
  return `<section kovo-fragment-target="patch-zone" kovo-deps="island" kovo-key="patch-zone">
    ${
      installed
        ? `<patched-island kovo-c="patched-island" kovo-key="patched-island" kovo-state='{"count":0}'>
            <button type="button" on:click="/client.ts#activate" data-p-label="patched">Activate patched island</button>
            <output data-island-output data-bind="state.count">0</output>
          </patched-island>`
        : '<p data-empty-zone>No island yet</p>'
    }
  </section>`;
}

export const addIsland = mutation('island/add', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec('update island_patch set installed = 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const zone = await renderZone(request.db);
    return `<main>
      <kovo-fragment target="patch-zone">${zone}</kovo-fragment>
      <form method="post" action="/_m/island/add" enhance data-mutation="island/add" kovo-deps="island">
        <button type="submit">Patch island</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [addIsland],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== addIsland.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      redirectTo: '/',
      fragmentRenderers: [{ render: () => renderZone(db), target: 'patch-zone' }],
    };
  },
});

export default defineFixture({
  app,
  schema:
    'create table island_patch (id integer primary key, installed integer not null default 0)',
  seed: (db) => db.exec('insert into island_patch (id, installed) values (1, 0)'),
});
