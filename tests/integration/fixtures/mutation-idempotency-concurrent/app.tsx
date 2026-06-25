// SPEC.md §9.1/§10.3: concurrent duplicate Kovo-Idem mutation requests reserve
// one replay record before the handler runs, so the write executes once.
import {
  createApp,
  createMemoryMutationReplayStore,
  csrfField,
  mutation,
  route,
  s,
} from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const csrf = {
  secret: 'mutation-idempotency-concurrent-secret',
  sessionId: () => 'mutation-idempotency-concurrent-session',
};

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>(
    'select count(*)::int as count from concurrent_entries',
  );
  return `<output data-bind="idem.count">${rows[0]?.count ?? 0}</output>`;
}

export const slowRecord = mutation('mutation-idempotency-concurrent/record', {
  input: s.object({ note: s.string() }),
  handler: async (input: { note: string }, request: KovoFixtureRequest) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await request.db.query('insert into concurrent_entries (note) values ($1)', [input.note]);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="idem-concurrent-status" kovo-deps="idem">${await renderStatus(request.db)}</kovo-fragment>
    <form method="post" action="/_m/mutation-idempotency-concurrent/record">
      ${csrfField(request, { ...csrf, audience: slowRecord.key })}
      <input name="note" value="race">
      <button type="submit">Record once</button>
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    csrf,
    mutationReplayStore: createMemoryMutationReplayStore(),
    mutations: [slowRecord],
    mutationResponses: {
      [slowRecord.key]: ({ request }) => {
        const db = (request as unknown as KovoFixtureRequest).db;
        return {
          fragmentRenderers: [{ render: () => renderStatus(db), target: 'idem-concurrent-status' }],
        };
      },
    },
    routes: [homeRoute],
  }),
  schema: `create table concurrent_entries (
    id integer primary key generated always as identity,
    note text not null
  )`,
});
