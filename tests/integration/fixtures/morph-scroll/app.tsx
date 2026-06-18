// Morph survival fixture: a keyed scroll container keeps browser-owned
// scrollTop while server-truth content is reconciled (SPEC §9.1).
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

async function readVersion(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ version: number }>('select version from scroll_state where id = 1');
  return rows[0]?.version ?? 0;
}

async function renderPanel(db: KovoFixtureRequest['db']): Promise<string> {
  const version = await readVersion(db);
  const rows = Array.from({ length: 28 }, (_value, index) => {
    const rowNumber = index + 1;
    const label =
      rowNumber === 14 ? `Inserted content version ${version}` : `Stable row ${rowNumber}`;
    return `<p kovo-key="row-${rowNumber}" data-row="${rowNumber}">${label}</p>`;
  }).join('');

  return `<section kovo-fragment-target="scroll-panel" kovo-deps="scroll" kovo-key="scroll-panel">
    <div
      kovo-key="scroll-region"
      data-scroll-region
      style="height: 110px; overflow: auto; border: 1px solid currentColor;"
    >
      ${rows}
    </div>
    <p>Server version <output data-bind="scroll.version">${version}</output></p>
  </section>`;
}

export const refreshScroll = mutation('scroll/refresh', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec('update scroll_state set version = version + 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const panel = await renderPanel(request.db);
    return `<main>
      <kovo-fragment target="scroll-panel">${panel}</kovo-fragment>
      <form method="post" action="/_m/scroll/refresh" enhance data-mutation="scroll/refresh" kovo-deps="scroll">
        <button type="submit">Refresh content</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [refreshScroll],
  routes: [homeRoute],
  mutationResponses: {
    [refreshScroll.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        redirectTo: '/',
        fragmentRenderers: [{ render: () => renderPanel(db), target: 'scroll-panel' }],
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table scroll_state (id integer primary key, version integer not null default 0)',
  seed: (db) => db.exec('insert into scroll_state (id, version) values (1, 0)'),
});
