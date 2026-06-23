import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  authed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
} from '@kovojs/better-auth';
import { s, session, type CsrfValidationOptions } from '@kovojs/server';

import { appDb, type AppDb } from './db.js';
import { authSchema } from './schema.js';

// Load .env into process.env for runtimes that don't do it automatically (plain
// `node`, the dev/test servers). In production, real env vars are already set, so
// a missing .env is fine.
try {
  (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch {
  // No .env file present — rely on the ambient environment.
}

// Real Better Auth, backed by the same SQLite/Drizzle database as the app data
// (src/db.ts), wired into Kovo through the `@kovojs/better-auth` adapter:
// `betterAuthSession` turns Better Auth's session into `req.session`, and the
// sign-in/out mutations below are ordinary CSRF-protected Kovo mutations. They are
// module constants so the compiler can statically wire and CSRF-stamp the forms
// that reference them (src/components/auth-forms.tsx).

export interface AppSession {
  id: string;
  user: { id: string; email: string; name: string };
}

export interface AppRequest {
  db: AppDb;
  headers: Headers;
  authCsrfId?: string | null;
  session?: AppSession | null;
}

// The CSRF HMAC key. create-kovo writes a fresh per-project secret into .env;
// fail closed rather than ship a known constant (SPEC.md §6.6).
function requireAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.KOVO_CSRF_SECRET;
  if (!secret || secret === 'replace-with-a-deployed-secret') {
    throw new Error(
      'Set BETTER_AUTH_SECRET (or KOVO_CSRF_SECRET) to a strong random value (e.g. `openssl rand -base64 32`).',
    );
  }
  return secret;
}

export const appCsrf = {
  field: 'csrf',
  secret: requireAuthSecret(),
  sessionId(request: AppRequest) {
    // Once signed in, bind the token to the session. Before sign-in there is no
    // session, so bind anonymous (login) forms to a stable id — the token is still
    // an HMAC under the private secret, so it is unforgeable cross-site (SPEC §6.6).
    return request.session?.id ?? request.authCsrfId ?? 'kovo-starter-anon';
  },
} satisfies CsrfValidationOptions<AppRequest>;

export const appSession = session(
  s.object({
    id: s.string(),
    user: s.object({ id: s.string(), email: s.string(), name: s.string() }),
  }),
);

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  secret: requireAuthSecret(),
  emailAndPassword: { enabled: true },
  // Kovo stamps and verifies its own CSRF token on every mutation form
  // (SPEC.md §6.6), and these endpoints are reached server-side via `auth.api`,
  // so Better Auth's own origin-based CSRF check is redundant here.
  advanced: { disableCSRFCheck: true },
  database: drizzleAdapter(appDb, { provider: 'sqlite', schema: authSchema }),
});

export const appSessionProvider = appSession.provider(
  betterAuthSession(auth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: { id: user.id, email: user.email, name: user.name },
  })),
);

export const appSignIn = betterAuthSignInEmailMutation<'auth/sign-in', AppRequest>(auth, {
  csrf: appCsrf,
  defaultRedirectTo: '/',
});

export const appSignOut = betterAuthSignOutMutation<
  'auth/sign-out',
  AppRequest,
  AppRequest & { session: AppSession }
>(auth, {
  csrf: appCsrf,
  defaultRedirectTo: '/login',
  guard: authed<AppRequest>(),
});

/**
 * Create the demo account so a fresh `vp dev` can sign in immediately. Safe to
 * call repeatedly — a duplicate sign-up is ignored.
 */
export async function seedDemoUser(): Promise<void> {
  try {
    await auth.api.signUpEmail({
      asResponse: true,
      body: { email: 'demo@example.com', name: 'Demo User', password: 'password123' },
      headers: new Headers(),
    });
  } catch {
    // Already seeded.
  }
}
