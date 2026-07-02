// SPEC.md §9.1/§10.3: duplicate Kovo-Idem mutation requests replay the stored response.
import {
  createApp,
  createMemoryMutationReplayStore,
  csrfField,
  mutation,
  route,
  s,
} from '@kovojs/server';
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const csrf = {
  secret: 'idempotent-mutation-secret-at-least-32-bytes',
  sessionId: () => 'idempotent-mutation-session',
};

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>(
    staticSql`select count(*)::int as count from ledger_entries`,
  );
  return `<output data-bind="idem.count">${rows[0]?.count ?? 0}</output>`;
}

export const recordEntry = mutation('idempotent-mutation/record', {
  input: s.object({ note: s.string() }),
  registry: { tables: ['ledger_entries'] },
  handler: async (input: { note: string }, request: KovoFixtureRequest) => {
    await request.db.exec({
      text: 'insert into ledger_entries (note) values ($1)',
      values: [input.note],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="idem-status" kovo-deps="idem">${await renderStatus(request.db)}</kovo-fragment>
    <form method="post" action="/_m/idempotent-mutation/record" enhance data-mutation="idempotent-mutation/record" kovo-deps="idem">
      ${csrfField(request, { ...csrf, audience: recordEntry.key })}
      <input name="note" value="first">
      <button type="submit">Record entry</button>
    </form>
  </main>`,
});

const app = createApp({
  csrf,
  mutationReplayStore: createMemoryMutationReplayStore(),
  mutations: [recordEntry],
  routes: [homeRoute],
  mutationResponses: {
    [recordEntry.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [{ render: () => renderStatus(db), target: 'idem-status' }],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table ledger_entries (id serial primary key, note text not null)',
});
