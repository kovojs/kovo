// I3 fixture entry: the click → server-mutation → DOM-morph round trip. This module
// declares no Kovo components (they live in count-badge.tsx), so the compiler plugin
// leaves its exports — including `export default defineFixture(...)` — intact. NOTE:
// the plugin claims any module whose source contains the call token for a Kovo
// component (vite.ts), so keep that token out of comments in non-component modules.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

import { CountBadge } from './count-badge';
import { counter, readCount } from './shared';

function renderBadge(db: KovoFixtureRequest['db']): Promise<string> {
  return readCount(db).then((count) => CountBadge.definition.render({ count }) as unknown as string);
}

export const increment = mutation('counter/increment', {
  // Fixture: skip the CSRF/session dance (plans/integration-test-suite.md).
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec('update counter set value = value + 1 where id = 1');
    context.invalidate(counter);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const badge = await renderBadge(request.db);
    return `<main>
      <kovo-fragment target="count-badge">${badge}</kovo-fragment>
      <form method="post" action="/_m/counter/increment" enhance data-mutation="counter/increment" kovo-deps="counter">
        <button type="submit">Increment</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [increment],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== increment.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      redirectTo: '/',
      fragmentRenderers: [{ render: () => renderBadge(db), target: 'count-badge' }],
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table counter (id integer primary key, value integer not null default 0)',
  seed: (db) => db.exec('insert into counter (id, value) values (1, 0)'),
});
