// SPEC.md §6.5/§9.4: direct typed reads parse search args before query guards,
// so malformed anonymous reads do not leak protected data existence through auth.
import { createApp, domain, guards, query, s } from '@kovojs/server';
import {
  defineFixture,
  delegatedFixtureSessionProvider,
} from '@kovojs/test/internal/integration/define';

interface AuthSession {
  user: { id: string; roles: readonly string[] };
}

type AuthRequest = Request & { session?: AuthSession | null };

const COOKIE = 'kovo_query_order_session';
const secretDomain = domain('secret');

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

export const secretQuery = query('secret', {
  args: s.object({ id: s.string() }),
  guard: guards.authed<AuthRequest>(),
  instanceKey: (input) => `secret:${(input as { id?: string }).id ?? ''}`,
  load: (input: { id: string }, { request }: { request: AuthRequest }) => ({
    id: input.id,
    owner: request.session?.user.id ?? 'anonymous',
    value: 'protected',
  }),
  reads: [secretDomain],
});

export default defineFixture({
  app: createApp<AuthSession>({
    queries: [secretQuery],
    sessionProvider: delegatedFixtureSessionProvider((request) => readSessionCookie(request)),
  }),
});
