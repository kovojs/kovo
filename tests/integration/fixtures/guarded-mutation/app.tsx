/** @jsxImportSource @kovojs/server */
// SPEC §6.5 + §10.3: mutation guards run before the transaction/write path.
// Unauthenticated enhanced failures return Kovo-Reauth; authenticated
// authorization failures stay on typed mutation error fragments.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, guards, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { GuardedPanel } from './guarded-panel';
import { guardedCount, guardedCountQuery } from './shared';

interface AuthSession {
  user: { id: string; roles: readonly string[] };
}
type AuthRequest = KovoFixtureRequest & { session?: AuthSession | null };

const COOKIE = 'kovo_guarded_mutation_session';
const csrf = {
  secret: 'guarded-mutation-secret-0123456789',
  sessionId: () => 'guarded-mutation-session',
};

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

export const guardedIncrement = mutation('guarded-mutation/increment', {
  defaultRedirectTo: '/',
  guard: guards.authed<AuthRequest>(),
  input: s.object({}),
  registry: {
    queries: [guardedCountQuery],
    tables: ['guarded_counter'],
    touches: [guardedCount],
  },
  transaction: async (_request, run) => run(_request),
  handler: async (_input: unknown, request: AuthRequest, context) => {
    await request.db.exec(staticSql`update guarded_counter set count = count + 1 where id = 1`);
    context.invalidate(guardedCount);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <h1>Guarded Mutation</h1>
      <GuardedPanel />
    </main>
  ),
});

export default defineFixture({
  app: createApp<AuthSession>({
    csrf,
    mutations: [guardedIncrement],
    queries: [guardedCountQuery],
    routes: [homeRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
  schema: 'create table guarded_counter (id integer primary key, count integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into guarded_counter (id, count) values (1, 0)`),
});
