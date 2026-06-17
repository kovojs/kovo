import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

async function readVersion(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ version: number }>(
    'select version from nested_island_parent where id = 1',
  );
  return rows[0]?.version ?? 0;
}

async function renderPanel(db: KovoFixtureRequest['db']): Promise<string> {
  const version = await readVersion(db);
  return `<section id="parent-panel" kovo-fragment-target="parent-panel" kovo-key="parent-panel" kovo-deps="parent">
    <p>Parent version <output data-bind="parent.version">${version}</output></p>
    <nested-counter kovo-c="nested-counter" kovo-key="nested-counter" kovo-state='{"count":0}'>
      <button type="button" on:click="/client.ts#incrementNested">
        Nested count <span data-bind="state.count">0</span>
      </button>
    </nested-counter>
  </section>`;
}

const refreshParent = mutation('morph-nested-island-state/refresh', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec('update nested_island_parent set version = version + 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <script type="module" src="/client.ts"></script>
    <kovo-fragment target="parent-panel">${await renderPanel(request.db)}</kovo-fragment>
    <form id="refresh-parent" method="post" action="/_m/morph-nested-island-state/refresh">
      <button type="submit">Refresh parent</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [refreshParent],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== refreshParent.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderPanel(db), target: 'parent-panel' }],
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table nested_island_parent (id integer primary key, version integer not null)',
  seed: (db) => db.exec('insert into nested_island_parent (id, version) values (1, 0)'),
});
