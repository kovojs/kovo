// SPEC.md §9.1: mutation handlers may attach narrow transport headers.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>(
    'select count(*)::int as count from header_events',
  );
  return `<output data-bind="headers.count">${rows[0]?.count ?? 0}</output>`;
}

export const touchHeaders = mutation('mutation-response-headers/touch', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec('insert into header_events default values');
    context.setCookie?.('header_seen', 'yes', { httpOnly: true, path: '/', sameSite: 'Strict' });
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="header-status" kovo-deps="headers">${await renderStatus(request.db)}</kovo-fragment>
    <form method="post" action="/_m/mutation-response-headers/touch" enhance data-mutation="mutation-response-headers/touch" kovo-deps="headers">
      <button type="submit">Touch headers</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [touchHeaders],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== touchHeaders.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderStatus(db), target: 'header-status' }],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table header_events (id serial primary key)',
});
