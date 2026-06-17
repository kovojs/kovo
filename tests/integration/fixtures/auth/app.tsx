// I2 fixture: authenticated session via the login() helper. A sign-in mutation
// validates credentials and sets a session cookie; a `guards.authed()` route reads
// the cookie-derived session (via sessionProvider) and renders the signed-in user.
// Exercises the public auth surface: sessionProvider, guards.authed, setCookie.
import { createApp, guards, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

interface AuthSession {
  user: { id: string; roles: readonly string[] };
}
type AuthRequest = KovoFixtureRequest & { session?: AuthSession | null };

const COOKIE = 'kovo_fixture_session';
const DEMO = { email: 'ada@example.com', password: 'correct' };

function readSessionCookie(request: Request): AuthSession | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return null;
  const email = decodeURIComponent(entry.slice(COOKIE.length + 1));
  return email ? { user: { id: email, roles: [] } } : null;
}

export const signIn = mutation('auth/sign-in', {
  csrf: false,
  errors: { INVALID_CREDENTIALS: s.object({}) },
  input: s.object({ email: s.string(), password: s.string() }),
  handler: (input, _request, context) => {
    if (input.email !== DEMO.email || input.password !== DEMO.password) {
      return context.fail('INVALID_CREDENTIALS', {});
    }
    context.setCookie?.(COOKIE, encodeURIComponent(input.email), {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    });
    return { email: input.email };
  },
});

const loginRoute = route('/login', {
  page: () =>
    `<main><h1>Sign in</h1><form method="post" action="/_m/auth/sign-in" enhance data-mutation="auth/sign-in">
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Sign in</button>
    </form></main>`,
});

const accountRoute = route('/account', {
  guard: guards.authed<AuthRequest>(),
  page: (_context, request: AuthRequest) =>
    `<main><h1>Account</h1><p>Signed in as ${request.session?.user?.id ?? '(anonymous)'}</p></main>`,
});

const app = createApp<AuthSession>({
  mutations: [signIn],
  routes: [loginRoute, accountRoute],
  sessionProvider: (request) => readSessionCookie(request),
});

export default defineFixture({ app });
