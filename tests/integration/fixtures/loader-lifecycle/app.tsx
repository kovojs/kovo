// SPEC.md §4.4/§4.7: delegated handlers receive ctx.signal, and enhanced
// fragment morphs that remove an island abort its loader-scoped lifecycle.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

type LifecycleStage = 'active' | 'replaced';

async function readStage(db: KovoFixtureRequest['db']): Promise<LifecycleStage> {
  const rows = await db.query<{ stage: LifecycleStage }>(
    'select stage from lifecycle_state where id = 1',
  );
  return rows[0]?.stage ?? 'active';
}

async function renderShell(db: KovoFixtureRequest['db']): Promise<string> {
  const stage = await readStage(db);
  if (stage === 'replaced') {
    return `<section data-stage="replaced">
      <replacement-runner-host kovo-c="replacement-runner">
        <button type="button" data-replacement-runner on:click="/client.ts#startReplacementTask">
        Replacement task
        </button>
      </replacement-runner-host>
    </section>`;
  }

  return `<section data-stage="active">
    <primary-runner-host kovo-c="primary-runner">
      <button type="button" data-primary-runner on:click="/client.ts#startLongTask">
      Start primary task
      </button>
    </primary-runner-host>
  </section>`;
}

export const swapIsland = mutation('loader-lifecycle/swap', {
  csrf: false,
  input: s.object({}),
  handler: async (_input, request: KovoFixtureRequest) => {
    await request.db.exec("update lifecycle_state set stage = 'replaced' where id = 1");
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <h1>Loader lifecycle</h1>
    <p data-lifecycle-status>idle</p>
    <div kovo-fragment-target="lifecycle-shell">${await renderShell(request.db)}</div>
    <form method="post" action="/_m/loader-lifecycle/swap" enhance data-mutation="loader-lifecycle/swap">
      <button type="submit">Swap island</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [swapIsland],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== swapIsland.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderShell(db), target: 'lifecycle-shell' }],
    };
  },
});

export default defineFixture({
  app,
  schema:
    "create table lifecycle_state (id integer primary key, stage text not null default 'active')",
  seed: (db) => db.exec("insert into lifecycle_state (id, stage) values (1, 'active')"),
});
