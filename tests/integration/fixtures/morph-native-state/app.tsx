// SPEC §9.1 morph survival (plans/bugs-and-testing.md C8; testing-audit §5.3): a
// fragment morph preserves user-agent/DOM-resident state. This fixture opens a
// <details> by user action, then triggers an UNRELATED morph of the enclosing
// fragment (an incremented counter) and asserts the open state survives.
import { createApp, domain, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const panelDomain = domain('panel');

async function count(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ value: number }>('select value from panel where id = 1');
  return rows[0]?.value ?? 0;
}

// The server always renders <details> CLOSED — only the user's open is at stake.
function renderPanel(value: number): string {
  return `<section kovo-fragment-target="panel" kovo-deps="panel">
    <details data-testid="panel-details"><summary>More</summary><p>Body</p></details>
    <output data-testid="count">${value}</output>
  </section>`;
}

export const bump = mutation('morph-native-state/bump', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec('update panel set value = value + 1 where id = 1');
    context.invalidate(panelDomain);
    return {};
  },
});

const home = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="panel">${renderPanel(await count(request.db))}</kovo-fragment>
    <form method="post" action="/_m/morph-native-state/bump" enhance data-mutation="morph-native-state/bump" kovo-deps="panel">
      <button type="submit">Bump</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [bump],
  routes: [home],
  mutationResponses: {
    [bump.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [{ render: async () => renderPanel(await count(db)), target: 'panel' }],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table panel (id integer primary key, value integer not null)',
  seed: (db) => db.exec('insert into panel (id, value) values (1, 0)'),
});
