// SPEC §6.5 + §9.5: the request shell resolves the sessionProvider once, then
// route/query/mutation guards and handlers observe that same session value.
import { createApp, domain, guards, mutation, query, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

interface AppSession {
  id: string;
  user: { id: string; roles: readonly string[] };
}
type AppRequest = KovoFixtureRequest & { session?: AppSession | null };

const sessionDomain = domain('session-once');

async function record(request: AppRequest, kind: string): Promise<void> {
  const caseKey = request.headers.get('x-session-case') ?? new URL(request.url).pathname;
  const subject = request.session?.user.id ?? 'anonymous';
  await request.db.query(
    'insert into session_once_events (case_key, kind, subject) values ($1, $2, $3)',
    [caseKey, kind, subject],
  );
}

function recordingAuthed(kind: string) {
  return async (request: AppRequest) => {
    await record(request, `guard:${kind}`);
    return guards.authed<AppRequest>()(request);
  };
}

export const sessionOnceQuery = query('session-once', {
  args: s.object({ case: s.string() }),
  guard: recordingAuthed('query'),
  instanceKey: (input) => `session-once:${(input as { case: string }).case}`,
  load: async (_input: { case: string }, { request }: { request: AppRequest }) => {
    await record(request, 'load:query');
    return { userId: request.session?.user.id ?? 'anonymous' };
  },
  reads: [sessionDomain],
});

export const sessionOnceMutation = mutation('session-once/mutate', {
  csrf: false,
  guard: recordingAuthed('mutation'),
  input: s.object({}),
  handler: async (_input: unknown, request: AppRequest) => {
    await record(request, 'handler:mutation');
    return { userId: request.session?.user.id ?? 'anonymous' };
  },
});

const routeCase = route('/route', {
  guard: recordingAuthed('route'),
  page: async (_context, request: AppRequest) => {
    await record(request, 'page:route');
    return `<main><h1>Session Once</h1><p data-user>${request.session?.user.id}</p></main>`;
  },
});

export default defineFixture({
  app: createApp<AppSession>({
    mutations: [sessionOnceMutation],
    queries: [sessionOnceQuery],
    routes: [routeCase],
    sessionProvider: async (request) => {
      const appRequest = request as AppRequest;
      const caseKey = request.headers.get('x-session-case') ?? new URL(request.url).pathname;
      const session = {
        id: `session-${caseKey}`,
        user: { id: `user-${caseKey}`, roles: [] },
      };
      await appRequest.db.query(
        'insert into session_once_events (case_key, kind, subject) values ($1, $2, $3)',
        [caseKey, 'provider', session.user.id],
      );
      return session;
    },
    mutationResponse: async ({ key, request }) => {
      if (key !== sessionOnceMutation.key) return undefined;
      await record(request as unknown as AppRequest, 'response:mutation');
      return { redirectTo: '/route' };
    },
  }),
  schema: [
    `create table session_once_events (
      id serial primary key,
      case_key text not null,
      kind text not null,
      subject text not null
    )`,
  ],
});
