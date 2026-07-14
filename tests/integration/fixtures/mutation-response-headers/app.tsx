/** @jsxImportSource @kovojs/server */
// SPEC.md §9.1: mutation handlers may attach narrow transport headers.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { HeaderStatus } from './header-status';
import { headersDomain, headersQuery } from './shared';

const csrf = {
  secret: 'mutation-response-headers-csrf-secret-32-bytes',
  sessionId: () => 'mutation-response-headers-browser-session',
};

export const touchHeaders = mutation('mutation-response-headers/touch', {
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [headersQuery],
    tables: ['header_events'],
    touches: [headersDomain],
  },
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
  page: () => (
    <main>
      <HeaderStatus />
    </main>
  ),
});

const app = createApp({
  csrf,
  mutations: [touchHeaders],
  queries: [headersQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table header_events (id serial primary key)',
});
