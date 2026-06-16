// SPEC §6.5 + §10.3: mutation guards run before the transaction/write path, and
// enhanced guard failures stay on the typed mutation error fragment vocabulary.
import { createApp, guards, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

interface AuthSession {
  user: { id: string; roles: readonly string[] };
}
type AuthRequest = KovoFixtureRequest & { session?: AuthSession | null };

const COOKIE = 'kovo_guarded_mutation_session';

function readSessionCookie(request: Request): AuthSession | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return null;

  const id = decodeURIComponent(entry.slice(COOKIE.length + 1));
  return id ? { user: { id, roles: [] } } : null;
}

async function readCount(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ count: number }>('select count from guarded_counter where id = 1');
  return rows[0]?.count ?? 0;
}

async function renderStatus(db: KovoFixtureRequest['db']): Promise<string> {
  const count = await readCount(db);
  return `<output kovo-fragment-target="guarded-count" data-count>${count}</output>`;
}

export const guardedIncrement = mutation('guarded-mutation/increment', {
  csrf: false,
  guard: guards.authed<AuthRequest>(),
  input: s.object({}),
  transaction: async (_request, run) => run(_request),
  handler: async (_input: unknown, request: AuthRequest) => {
    await request.db.exec('update guarded_counter set count = count + 1 where id = 1');
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const status = await renderStatus(request.db);
    return `<main>
      <h1>Guarded Mutation</h1>
      ${status}
      <div kovo-fragment-target="guarded-error"></div>
      <form method="post" action="/_m/guarded-mutation/increment" enhance data-mutation="guarded-mutation/increment" kovo-deps="guarded-count">
        <button type="submit">Increment protected counter</button>
      </form>
    </main>`;
  },
});

export default defineFixture({
  app: createApp<AuthSession>({
    mutations: [guardedIncrement],
    routes: [homeRoute],
    sessionProvider: (request) => readSessionCookie(request),
    mutationResponse: ({ key, request }) => {
      if (key !== guardedIncrement.key) return undefined;
      return {
        failureTarget: 'guarded-error',
        fragmentRenderers: [
          {
            render: () => renderStatus((request as unknown as KovoFixtureRequest).db),
            target: 'guarded-count',
          },
        ],
        redirectTo: '/',
        renderFailureFragment: (failure) =>
          `<div kovo-fragment-target="guarded-error" role="alert" data-error-code="${failure.error.code}">Sign in required</div>`,
      };
    },
  }),
  schema: 'create table guarded_counter (id integer primary key, count integer not null default 0)',
  seed: (db) => db.exec('insert into guarded_counter (id, count) values (1, 0)'),
});
