import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

export const record = mutation('methods/record', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    await request.db.exec("insert into method_events (kind) values ('mutation')");
    return {};
  },
});

const homeRoute = route('/', {
  meta: { title: 'HTTP Methods' },
  page: () => `<main>
    <h1>HTTP Methods</h1>
    <form method="post" action="/_m/methods/record" data-mutation="methods/record">
      <button type="submit">Record</button>
    </form>
  </main>`,
});

const doneRoute = route('/done', {
  page: () => '<main><h1>Recorded</h1></main>',
});

export default defineFixture({
  app: createApp({
    mutations: [record],
    routes: [homeRoute, doneRoute],
    mutationResponse: ({ key }) => {
      if (key !== record.key) return undefined;
      return { redirectTo: '/done' };
    },
  }),
  schema: 'create table method_events (id serial primary key, kind text not null)',
});
