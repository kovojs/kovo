import { authed } from '@kovojs/better-auth';
import { publicAccess, s, session, type CsrfOptions } from '@kovojs/server';

import { createAppAuthBindings } from './_kovo/app-runtime-db.js';
import type { AppDb } from './db.js';

// Load .env into process.env for runtimes that don't do it automatically (plain
// `node`, the dev/test servers). In production, real env vars are already set, so
// a missing .env is fine.
try {
  process.loadEnvFile?.();
} catch {
  // No .env file present — rely on the ambient environment.
}

// Real Better Auth is instantiated inside the framework-owned `_kovo` runtime module.
// This app-authored module receives only sanitized session and credential-mutation
// bindings, never Better Auth's `$context` or its secret-readable system adapter
// (SPEC §6.6/§10.3 capability ownership). The bindings remain module constants so
// the compiler can statically wire and CSRF-stamp the forms that reference them.

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
    // Once signed in, bind the token to the session. Before sign-in, return no
    // app-owned binding so Kovo uses its framework-owned signed anonymous cookie
    // for login forms (SPEC.md §6.6).
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
} satisfies CsrfOptions<AppRequest>;

export const appSession = session(
  s.object({
    id: s.string(),
    user: s.object({ id: s.string(), email: s.string(), name: s.string() }),
  }),
);

/**
 * The app's session-presence guard. Routes and queries that show the signed-in
 * user's data carry it as their KV436 access decision (SPEC §10.2), matching the
 * guarded mutations.
 */
export const appAuthed = authed<AppRequest>();

const authBindings = createAppAuthBindings({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  csrf: appCsrf,
  secret: requireAuthSecret(),
  signInAccess: publicAccess('sign-in runs before authentication'),
  signOutAccess: [appAuthed],
});

export const appSessionProvider = appSession.provider(authBindings.sessionProvider);
export const appSignIn = authBindings.signIn;
export const appSignOut = authBindings.signOut;
export const seedDemoUser = authBindings.seedDemoUser;
