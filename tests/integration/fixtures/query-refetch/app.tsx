/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route } from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { RefetchCard } from './refetch-card';
import { refetchQuery } from './shared';

const homeRoute = route('/', {
  page: () => (
    <main>
      {trustedHtml('<script type="module" src="/client.ts"></script>', {
        reason: 'framework integration fixture markup',
      })}
      <RefetchCard />
    </main>
  ),
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
