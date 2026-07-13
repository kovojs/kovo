// SPEC.md §9.1: mutation handlers may attach narrow transport headers.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, csrfField, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const csrf = {
  secret: 'mutation-response-headers-csrf-secret-32-bytes',
  sessionId: () => 'mutation-response-headers-browser-session',
};

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>(
    staticSql`select count(*)::int as count from header_events`,
  );
  return `<output data-bind="headers.count">${rows[0]?.count ?? 0}</output>`;
}

export const touchHeaders = mutation('mutation-response-headers/touch', {
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { tables: ['header_events'] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`insert into header_events (id) values (default)`);
    context.setCookie?.('header_seen', 'yes', {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="header-status" kovo-deps="headers">${await renderStatus(request.db)}</kovo-fragment>
    <form method="post" action="/_m/mutation-response-headers/touch" enhance data-mutation="mutation-response-headers/touch" kovo-deps="headers">
      ${csrfField(request, { ...csrf, audience: touchHeaders.key })}
      <button type="submit">Touch headers</button>
    </form>
  </main>`,
});

const app = createApp({
  csrf,
  mutations: [touchHeaders],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table header_events (id serial primary key)',
});
