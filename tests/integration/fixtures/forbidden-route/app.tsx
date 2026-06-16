// SPEC §6.5: authenticated-but-unauthorized route access receives a 403 instead
// of redirecting or leaking protected page content.
import { createApp, guards, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

interface AuthSession {
  user: { id: string; roles: readonly string[] };
}
type AuthRequest = Request & { session?: AuthSession | null };

const COOKIE = 'kovo_forbidden_route_session';

function readSessionCookie(request: Request): AuthSession | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return null;

  const [id = '', roles = ''] = decodeURIComponent(entry.slice(COOKIE.length + 1)).split('|');
  return { user: { id, roles: roles.split(',').filter(Boolean) } };
}

const adminRoute = route('/admin', {
  guard: guards.role<AuthRequest>('admin'),
  page: (_context, request) =>
    `<main><h1>Admin</h1><p data-secret>classified:${request.session?.user.id ?? 'none'}</p></main>`,
});

export default defineFixture({
  app: createApp<AuthSession>({
    errorShells: {
      forbidden: ({ status }) => ({
        body: `<main data-forbidden-shell><h1>Access denied</h1><p>status:${status}</p></main>`,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status,
      }),
    },
    routes: [adminRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
});
