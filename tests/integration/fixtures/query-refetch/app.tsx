/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, route, trustedHtml } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { RefetchCard } from './refetch-card';
import { readRefetch, refetchQuery } from './shared';

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const refetch = await readRefetch(request.db);
    return (
      <main>
        {trustedHtml(renderQueryScript({ href: '/_q/refetch', name: 'refetch', value: refetch }))}
        {trustedHtml('<script type="module" src="/client.ts"></script>')}
        <RefetchCard />
      </main>
    );
  },
});

const app = createApp({
  queries: [refetchQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table refetch_state (id integer primary key, message text not null)',
  seed: (db) =>
    db.exec(staticSql`insert into refetch_state (id, message) values (1, 'Initial message')`),
});
