// SPEC §6.5: null/undefined sessionProvider results mean anonymous, not a
// malformed session value.
import { createApp, guards, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

interface AppSession {
  user: { id: string; roles: readonly string[] };
}
type AppRequest = Request & { session?: AppSession | null };

const publicRoute = route('/public', {
  page: (_context, request: AppRequest) =>
    `<main><h1>Public</h1><p data-session>${request.session?.user.id ?? 'anonymous'}</p></main>`,
});

const accountRoute = route('/account', {
  guard: guards.authed<AppRequest>(),
  page: (_context, request: AppRequest) =>
    `<main><h1>Account</h1><p data-user>${request.session?.user.id}</p></main>`,
});

export default defineFixture({
  app: createApp<AppSession>({
    routes: [publicRoute, accountRoute],
    sessionProvider: (request) => {
      const mode = new URL(request.url).searchParams.get('mode');
      if (mode === 'user') return { user: { id: 'ada@example.com', roles: [] } };
      if (mode === 'undefined') return undefined;
      return null;
    },
  }),
});
