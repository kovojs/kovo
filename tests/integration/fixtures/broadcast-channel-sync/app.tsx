/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { PresencePanel } from './presence-panel';
import { presenceDomain, presenceQuery } from './shared';

export const publishPresence = mutation('broadcast-channel-sync/publish', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  registry: {
    queries: [presenceQuery],
    tables: ['broadcast_presence'],
    touches: [presenceDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update broadcast_presence set status = 'online' where id = 1`);
    context.invalidate(presenceDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      {trustedHtml('<script type="module" src="/client.ts"></script>')}
      <PresencePanel />
    </main>
  ),
});

const app = createApp({
  mutations: [publishPresence],
  queries: [presenceQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table broadcast_presence (id integer primary key, status text not null)',
  seed: (db) =>
    db.exec(staticSql`insert into broadcast_presence (id, status) values (1, 'offline')`),
});
