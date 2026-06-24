// SPEC.md §4.4/§4.7: fragment morphs that remove islands abort their ctx.signal
// and leave patched/replacement islands inert until a declared trigger or interaction.
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type MorphStage = 'active' | 'removed';

async function readStage(db: KovoFixtureRequest['db']): Promise<MorphStage> {
  const rows = await db.query<{ stage: MorphStage }>(
    'select stage from morph_abort_state where id = 1',
  );
  return rows[0]?.stage ?? 'active';
}

async function renderShell(db: KovoFixtureRequest['db']): Promise<string> {
  const stage = await readStage(db);
  if (stage === 'removed') {
    return `<section data-morph-stage="removed">
      <replacement-abort-island kovo-c="replacement-abort-island">
        <button type="button" on:click="/client.ts#touchReplacement">Touch replacement</button>
      </replacement-abort-island>
    </section>`;
  }

  return `<section data-morph-stage="active">
    <abortable-island kovo-c="abortable-island">
      <button type="button" on:click="/client.ts#startAbortable">Start abortable</button>
    </abortable-island>
    <pending-visible-island kovo-c="pending-visible-island" on:visible="/client.ts#visibleSideEffect" style="display:none">
      Pending visible trigger
    </pending-visible-island>
  </section>`;
}

export const removeIsland = mutation('morph-remove-aborts/remove', {
  access: publicAccess('integration fixture mutation morph-remove-aborts/remove has no runtime guard'),
  csrf: false,
  input: s.object({}),
  handler: async (_input, request: KovoFixtureRequest) => {
    await request.db.exec("update morph_abort_state set stage = 'removed' where id = 1");
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <h1>Morph remove aborts</h1>
    <p data-morph-abort-status>idle</p>
    <div kovo-fragment-target="morph-abort-shell">${await renderShell(request.db)}</div>
    <form method="post" action="/_m/morph-remove-aborts/remove" enhance data-mutation="morph-remove-aborts/remove">
      <button type="submit">Remove island</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [removeIsland],
  routes: [homeRoute],
  mutationResponses: {
    [removeIsland.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [{ render: () => renderShell(db), target: 'morph-abort-shell' }],
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    "create table morph_abort_state (id integer primary key, stage text not null default 'active')",
  seed: (db) => db.exec("insert into morph_abort_state (id, stage) values (1, 'active')"),
});
