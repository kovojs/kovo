// SPEC §6.5 + §9.5: sessionProvider is resolved once per route/query/mutation
// request, and all guarded work sees the same session value.
import { expect, test } from '@kovojs/test/internal/integration';
import type { APIRequestContext } from '@playwright/test';

test.use({ kovoFixture: 'session-provider-once' });

interface SessionEvent {
  caseKey: string;
  kind: string;
  subject: string;
}

async function sessionEvents(request: APIRequestContext, caseKey: string): Promise<SessionEvent[]> {
  const response = await request.get(
    `/__session-provider-events?case=${encodeURIComponent(caseKey)}`,
  );
  expect(response.status()).toBe(200);
  return response.json() as Promise<SessionEvent[]>;
}

async function eventKinds(request: APIRequestContext, caseKey: string): Promise<string[]> {
  const rows = await sessionEvents(request, caseKey);
  return rows.map((row) => row.kind);
}

async function eventSubjects(request: APIRequestContext, caseKey: string): Promise<string[]> {
  const rows = await sessionEvents(request, caseKey);
  return [...new Set(rows.map((row) => row.subject))].sort();
}

function csrfTokenFrom(html: string): string {
  const match = html.match(/name="kovo-csrf" value="([^"]+)"/);
  if (!match) throw new Error('expected route document to include a mutation CSRF token');
  return match[1]!;
}

test('resolves one session for each guarded route, query, and mutation request', async ({
  request,
}) => {
  const routeResponse = await request.get('/route', {
    headers: { 'x-session-case': 'route' },
  });
  expect(routeResponse.status()).toBe(200);
  const routeHtml = await routeResponse.text();
  expect(routeHtml).toContain('user-route');
  const csrfToken = csrfTokenFrom(routeHtml);
  expect(await eventKinds(request, 'route')).toEqual(['provider', 'guard:route', 'page:route']);
  expect(await eventSubjects(request, 'route')).toEqual(['user-route']);

  const queryResponse = await request.get('/_q/session-once?case=query', {
    headers: { 'x-session-case': 'query' },
  });
  expect(queryResponse.status()).toBe(200);
  await expect(queryResponse.text()).resolves.toContain('{"userId":"user-query"}');
  expect(await eventKinds(request, 'query')).toEqual(['provider', 'guard:query', 'load:query']);
  expect(await eventSubjects(request, 'query')).toEqual(['user-query']);

  const mutationResponse = await request.post('/_m/session-once/mutate', {
    form: { 'kovo-csrf': csrfToken },
    headers: {
      'Kovo-Fragment': 'true',
      'x-session-case': 'mutation',
      origin: new URL(routeResponse.url()).origin,
    },
  });
  expect(mutationResponse.status()).toBe(200);
  expect(await eventKinds(request, 'mutation')).toEqual([
    'provider',
    'guard:mutation',
    'handler:mutation',
  ]);
  expect(await eventSubjects(request, 'mutation')).toEqual(['user-mutation']);
});
