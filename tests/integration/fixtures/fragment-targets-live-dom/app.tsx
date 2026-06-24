// SPEC.md §9.1: Kovo-Targets is collected from the live DOM, including patched-in targets.
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

async function readStage(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ stage: number }>('select stage from live_dom_state where id = 1');
  return rows[0]?.stage ?? 0;
}

async function renderLauncher(db: KovoFixtureRequest['db']): Promise<string> {
  const stage = await readStage(db);
  const dynamic =
    stage === 0
      ? ''
      : `<section kovo-fragment-target="dynamic-panel" kovo-deps="wire">
          <output data-bind="wire.dynamic">Panel ${stage}</output>
        </section>`;
  return `<section kovo-fragment-target="launcher" kovo-c="live-launcher" kovo-deps="wire">
    <output data-bind="wire.stage">Stage ${stage}</output>
    ${dynamic}
    <form method="post" action="/_m/fragment-targets-live-dom/advance" enhance data-mutation="fragment-targets-live-dom/advance">
      <button type="submit">${stage === 0 ? 'Install panel' : 'Refresh panel'}</button>
    </form>
  </section>`;
}

async function renderDynamic(db: KovoFixtureRequest['db']): Promise<string> {
  const stage = await readStage(db);
  return `<section kovo-fragment-target="dynamic-panel" kovo-c="dynamic-panel" kovo-deps="wire"><output data-bind="wire.dynamic">Panel ${stage}</output></section>`;
}

export const advance = mutation('fragment-targets-live-dom/advance', {
  access: publicAccess(
    'integration fixture mutation fragment-targets-live-dom/advance has no runtime guard',
  ),
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec('update live_dom_state set stage = stage + 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="launcher">${await renderLauncher(request.db)}</kovo-fragment>
  </main>`,
});

const app = createApp({
  mutations: [advance],
  routes: [homeRoute],
  mutationResponses: {
    [advance.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          { render: () => renderLauncher(db), target: 'launcher' },
          { render: () => renderDynamic(db), target: 'dynamic-panel' },
        ],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table live_dom_state (id integer primary key, stage integer not null)',
  seed: (db) => db.exec('insert into live_dom_state (id, stage) values (1, 0)'),
});
