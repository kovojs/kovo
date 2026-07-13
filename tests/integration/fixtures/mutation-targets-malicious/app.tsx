// SPEC.md §6.5/§9.1: Kovo-Targets is untrusted wire input. Unknown,
// duplicated, malformed, or unauthorized targets must not leak protected data.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, csrfField, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const COOKIE = 'kovo_target_session';

function userId(request: Request): string | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return null;
  return decodeURIComponent(entry.slice(COOKIE.length + 1)) || null;
}

const csrf = {
  secret: 'mutation-target-selection-csrf-secret-32-bytes',
  sessionId: (request: Request) => userId(request) ?? 'anonymous-target-session',
};

async function renderPublic(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ count: number }>(
    staticSql`select count(*)::int as count from target_refreshes`,
  );
  return `<output data-public-status>public:${rows[0]?.count ?? 0}</output>`;
}

function renderPrivate(request: Request): string {
  const id = userId(request) ?? 'anonymous';
  return `<output data-private-panel>private:${id}:secret</output>`;
}

export const refreshTargets = mutation('targets/refresh', {
  input: s.object({ value: s.string() }),
  registry: { tables: ['target_refreshes'] },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query({
      text: 'insert into target_refreshes (value) values ($1)',
      values: [input.value],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <h1>Mutation targets</h1>
    <section kovo-fragment-target="public-status" kovo-deps="public">${await renderPublic(request.db)}</section>
    <section kovo-fragment-target="private-panel" kovo-deps="private">private redacted</section>
    <form method="post" action="/_m/targets/refresh">
      ${csrfField(request, { ...csrf, audience: refreshTargets.key })}
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    csrf,
    mutations: [refreshTargets],
    mutationResponses: {
      [refreshTargets.key]: ({ request }) => {
        const db = (request as unknown as KovoFixtureRequest).db;
        const fragmentRenderers = [
          { render: () => renderPublic(db), target: 'public-status' },
          ...(userId(request)
            ? [{ render: () => renderPrivate(request), target: 'private-panel' }]
            : []),
        ];
        return { fragmentRenderers };
      },
    },
    routes: [homeRoute],
  }),
  schema: `create table target_refreshes (
    id integer primary key generated always as identity,
    value text not null
  )`,
});
