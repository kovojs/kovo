import { createApp, renderQueryScript, route } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { RefetchCard } from './refetch-card';
import { readRefetch, refetchQuery } from './shared';

async function renderCard(db: KovoFixtureRequest['db']): Promise<string> {
  const refetch = await readRefetch(db);
  return RefetchCard.definition.render({ refetch }) as unknown as string;
}

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const refetch = await readRefetch(request.db);
    const card = await renderCard(request.db);
    return `${renderQueryScript({ name: 'refetch', value: refetch })}
    <script type="module" src="/client.ts"></script>
    <main>
      <kovo-fragment target="refetch-card">${card}</kovo-fragment>
    </main>`;
  },
});

const app = createApp({
  queries: [refetchQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table refetch_state (id integer primary key, message text not null)',
  seed: (db) => db.exec("insert into refetch_state (id, message) values (1, 'Initial message')"),
});
