import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

async function renderCount(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ value: number }>('select value from nav_lifecycle_counter where id = 1');
  const value = rows[0]?.value ?? 0;
  return `<output id="counter-value">${value}</output>`;
}

const increment = mutation('nav-lifecycle/increment', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec('update nav_lifecycle_counter set value = value + 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <h1>Navigation lifecycle</h1>
    <kovo-fragment target="counter-panel">
      <section id="counter-panel">
        ${await renderCount(request.db)}
      </section>
    </kovo-fragment>
    <form method="post" action="/_m/nav-lifecycle/increment" enhance data-mutation="nav-lifecycle/increment">
      <button type="submit">Increment</button>
    </form>
    <a href="/away">Leave page</a>
  </main>`,
});

const awayRoute = route('/away', {
  page: () => '<main><h1>Away</h1><a href="/">Return</a></main>',
});

const app = createApp({
  mutations: [increment],
  routes: [homeRoute, awayRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== increment.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      redirectTo: '/',
      fragmentRenderers: [{ render: () => renderCount(db), target: 'counter-panel' }],
    };
  },
});

export default defineFixture({
  app,
  schema:
    'create table nav_lifecycle_counter (id integer primary key, value integer not null default 0)',
  seed: (db) => db.exec('insert into nav_lifecycle_counter (id, value) values (1, 0)'),
});
