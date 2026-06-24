// SPEC.md §9.1/§10.3: duplicate Kovo-Idem mutation requests replay the stored response.
import {
  createApp,
  createMemoryMutationReplayStore,
  csrfField,
  mutation,
  route,
  s,
  publicAccess,
} from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const csrf = {
  secret: 'idempotent-mutation-secret',
  sessionId: () => 'idempotent-mutation-session',
};

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>(
    'select count(*)::int as count from ledger_entries',
  );
  return `<output data-bind="idem.count">${rows[0]?.count ?? 0}</output>`;
}

export const recordEntry = mutation('idempotent-mutation/record', {
  access: publicAccess(
    'integration fixture mutation idempotent-mutation/record has no runtime guard',
  ),
  input: s.object({ note: s.string() }),
  handler: async (input: { note: string }, request: KovoFixtureRequest) => {
    await request.db.exec(
      `insert into ledger_entries (note) values ('${input.note.replaceAll("'", "''")}')`,
    );
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="idem-status" kovo-deps="idem">${await renderStatus(request.db)}</kovo-fragment>
    <form method="post" action="/_m/idempotent-mutation/record" enhance data-mutation="idempotent-mutation/record" kovo-deps="idem">
      ${csrfField(request, csrf)}
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
