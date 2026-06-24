// I2 fixture: authenticated session via the login() helper. A sign-in mutation
// validates credentials and sets a session cookie; a `guards.authed()` route reads
// the cookie-derived session (via sessionProvider) and renders the signed-in user.
// Exercises the public auth surface: sessionProvider, guards.authed, setCookie.
import { createApp, guards, mutation, publicAccess, route, s } from '@kovojs/server';
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
  access: publicAccess('integration fixture mutation auth/sign-in has no runtime guard'),
  csrf: false,
  errors: { INVALID_CREDENTIALS: s.object({}) },
  input: s.object({ email: s.string(), password: s.string() }),
  handler: (input, _request, context) => {
    if (input.email !== DEMO.email || input.password !== DEMO.password) {
      return context.fail('INVALID_CREDENTIALS', {});
    }
    context.setCookie?.(COOKIE, input.email, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    });
    return { email: input.email };
  },
});

// Clears the session cookie (the logout half of the round-trip). Emptying the value
// makes readSessionCookie() resolve to null; maxAge:0 also expires it in the browser.
export const signOut = mutation('auth/sign-out', {
  access: publicAccess('integration fixture mutation auth/sign-out has no runtime guard'),
  csrf: false,
  input: s.object({}),
  handler: (_input: unknown, _request, context) => {
    context.setCookie?.(COOKIE, '', { httpOnly: true, maxAge: 0, path: '/', sameSite: 'lax' });
    return {};
  },
});

const loginRoute = route('/login', {
  access: publicAccess('integration fixture route /login has no runtime guard'),
  page: () =>
    `<main><h1>Sign in</h1><form method="post" action="/_m/auth/sign-in" enhance data-mutation="auth/sign-in">
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Sign in</button>
    </form></main>`,
});

const accountRoute = route('/account', {
  access: { kind: 'guard-chain', guards: [{ name: 'guards.authed' }] },
  guard: guards.authed<AuthRequest>(),
  page: (_context, request: AuthRequest) =>
    `<main><h1>Account</h1><p>Signed in as ${request.session?.user?.id ?? '(anonymous)'}</p>
      <form method="post" action="/_m/auth/sign-out" enhance data-mutation="auth/sign-out">
        <button type="submit">Sign out</button>
      </form></main>`,
});

const app = createApp<AuthSession>({
  mutations: [signIn, signOut],
  routes: [loginRoute, accountRoute],
  sessionProvider: (request) => readSessionCookie(request),
});

export default defineFixture({ app });
