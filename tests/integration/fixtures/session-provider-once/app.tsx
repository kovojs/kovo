// SPEC §6.5 + §9.5: the request shell resolves the sessionProvider once, then
// route/query/mutation guards and handlers observe that same session value.
import {
  createApp,
  csrfField,
  domain,
  endpoint,
  guards,
  mutation,
  query,
  route,
  s,
} from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

interface AppSession {
  id: string;
  user: { id: string; roles: readonly string[] };
}
type AppRequest = Request & { session?: AppSession | null };

interface SessionEvent {
  caseKey: string;
  kind: string;
  subject: string;
}

const sessionEvents: SessionEvent[] = [];

const sessionDomain = domain('session-once');
const csrf = {
  secret: 'session-provider-once-secret-0123456789',
  sessionId: () => 'session-provider-once-session',
};

function appendSessionEvent(caseKey: string, kind: string, subject: string): void {
  sessionEvents.push({ caseKey, kind, subject });
}

function record(request: AppRequest, kind: string): void {
  const caseKey = request.headers.get('x-session-case') ?? new URL(request.url).pathname;
  const subject = request.session?.user.id ?? 'anonymous';
  appendSessionEvent(caseKey, kind, subject);
}

function recordingAuthed(kind: string) {
  return async (request: AppRequest) => {
    record(request, `guard:${kind}`);
    return guards.authed<AppRequest>()(request);
  };
}

export const sessionOnceQuery = query('session-once', {
  args: s.object({ case: s.string() }),
  guard: recordingAuthed('query'),
  instanceKey: (input) => `session-once:${(input as { case: string }).case}`,
  load: async (_input: { case: string }, { request }: { request: AppRequest }) => {
    record(request, 'load:query');
    return { userId: request.session?.user.id ?? 'anonymous' };
  },
  reads: [sessionDomain],
});

export const sessionOnceMutation = mutation('session-once/mutate', {
  defaultRedirectTo: '/route',
  guard: recordingAuthed('mutation'),
  input: s.object({}),
  handler: async (_input: unknown, request: AppRequest) => {
    record(request, 'handler:mutation');
    return { userId: request.session?.user.id ?? 'anonymous' };
  },
});

const routeCase = route('/route', {
  guard: recordingAuthed('route'),
  page: async (_context, request: AppRequest) => {
    record(request, 'page:route');
    return `<main><h1>Session Once</h1><p data-user>${request.session?.user.id}</p><form method="post" action="/_m/session-once/mutate">${csrfField(request, { ...csrf, audience: sessionOnceMutation.key })}</form></main>`;
  },
});

const eventsEndpoint = endpoint('/__session-provider-events', {
  auth: { justification: 'integration lifecycle observation endpoint', kind: 'none' },
  handler(request) {
    const caseKey = new URL(request.url).searchParams.get('case') ?? '';
    return Response.json(
      sessionEvents.filter((event) => event.caseKey === caseKey),
      { headers: { 'cache-control': 'no-store' } },
    );
  },
  method: 'GET',
  reason: 'integration lifecycle observation endpoint',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

export default defineFixture({
  app: createApp<AppSession>({
    csrf,
    endpoints: [eventsEndpoint],
    mutations: [sessionOnceMutation],
    queries: [sessionOnceQuery],
    routes: [routeCase],
    sessionProvider: async (request) => {
      const caseKey = request.headers.get('x-session-case') ?? new URL(request.url).pathname;
      const session = {
        id: `session-${caseKey}`,
        user: { id: `user-${caseKey}`, roles: [] },
      };
      // SPEC §6.5/§9.5: the provider runs before the shell attaches managed request.db. Record the
      // lifecycle observation in process; the raw endpoint above exposes it without resolving a
      // session of its own, which also exercises the endpoint ambient-session boundary.
      appendSessionEvent(caseKey, 'provider', session.user.id);
      return session;
    },
  }),
});
