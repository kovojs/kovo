// SPEC §6.5 + §9.5: sessionProvider is resolved once per route/query/mutation
// request, and all guarded work sees the same session value.
import { expect, test } from '@kovojs/test/internal/integration';
import type { KovoApp } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'session-provider-once' });

async function eventKinds(kovoApp: KovoApp, caseKey: string): Promise<string[]> {
  const rows = await kovoApp.db.query<{ kind: string }>(
    'select kind from session_once_events where case_key = $1 order by id',
    [caseKey],
  );
  return rows.map((row) => row.kind);
}

async function eventSubjects(kovoApp: KovoApp, caseKey: string): Promise<string[]> {
  const rows = await kovoApp.db.query<{ subject: string }>(
    'select distinct subject from session_once_events where case_key = $1 order by subject',
    [caseKey],
  );
  return rows.map((row) => row.subject);
}

test('resolves one session for each guarded route, query, and mutation request', async ({
  request,
  kovoApp,
}) => {
  const routeResponse = await request.get('/route', {
    headers: { 'x-session-case': 'route' },
  });
  expect(routeResponse.status()).toBe(200);
  await expect(routeResponse.text()).resolves.toContain('user-route');
  expect(await eventKinds(kovoApp, 'route')).toEqual(['provider', 'guard:route', 'page:route']);
  expect(await eventSubjects(kovoApp, 'route')).toEqual(['user-route']);

  const queryResponse = await request.get('/_q/session-once?case=query', {
    headers: { 'x-session-case': 'query' },
  });
  expect(queryResponse.status()).toBe(200);
  await expect(queryResponse.text()).resolves.toContain('{"userId":"user-query"}');
  expect(await eventKinds(kovoApp, 'query')).toEqual(['provider', 'guard:query', 'load:query']);
  expect(await eventSubjects(kovoApp, 'query')).toEqual(['user-query']);

  const mutationResponse = await request.post('/_m/session-once/mutate', {
    form: {},
    headers: {
      'Kovo-Fragment': 'true',
      'x-session-case': 'mutation',
    },
  });
  expect(mutationResponse.status()).toBe(200);
  expect(await eventKinds(kovoApp, 'mutation')).toEqual([
    'provider',
    'response:mutation',
    'guard:mutation',
    'handler:mutation',
  ]);
  expect(await eventSubjects(kovoApp, 'mutation')).toEqual(['user-mutation']);
});
