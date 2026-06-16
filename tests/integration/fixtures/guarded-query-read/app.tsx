// SPEC §6.5 + §9.4: query guards run for initial render callers and typed-read
// endpoint callers; the query endpoint must not leak protected data anonymously.
import { createApp, domain, guards, query, route, runQuery, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

interface AuthSession {
  user: { id: string; roles: readonly string[] };
}
type AuthRequest = Request & { session?: AuthSession | null };

const COOKIE = 'kovo_guarded_query_session';
const accountDomain = domain('account');

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

export const accountQuery = query('account', {
  args: s.object({ view: s.string() }),
  guard: guards.authed<AuthRequest>(),
  instanceKey: (input) => `account:${(input as { view?: string }).view ?? ''}`,
  load: (input: { view: string }, { request }: { request: AuthRequest }) => ({
    id: request.session?.user.id ?? 'anonymous',
    view: input.view,
  }),
  reads: [accountDomain],
});

const homeRoute = route('/', {
  search: s.object({ view: s.string() }),
  page: async ({ search }, request: AuthRequest) => {
    const result = await runQuery(accountQuery, search, request);
    if (!result.ok) {
      return `<main>
        <h1>Account Query</h1>
        <p data-denied>${result.error.code}</p>
      </main>`;
    }

    return `<main>
      <h1>Account Query</h1>
      <kovo-query name="account:${search.view}">${JSON.stringify(result.value)}</kovo-query>
      <p data-account>${result.value.id}:${result.value.view}</p>
    </main>`;
  },
});

export default defineFixture({
  app: createApp<AuthSession>({
    queries: [accountQuery],
    routes: [homeRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
});
