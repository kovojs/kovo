import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
import { publicAccess, s, session } from '@kovojs/server';

import { appRuntimeDbReady, createAppAuthBindings } from './_kovo/app-runtime-db.js';

// Real Better Auth is instantiated inside the framework-owned `_kovo` runtime module.
// This app-authored module receives only sanitized session and credential-mutation
// bindings, never Better Auth's `$context` or its secret-readable system adapter
// (SPEC §6.6/§10.3 capability ownership). The bindings remain module constants so
// the compiler can statically wire and CSRF-stamp the forms that reference them.

export interface AppSession {
  id: string;
  user: { id: string; email: string; name: string };
}

// Framework bootstrap loads and pins the deployment environment before app modules run. The
// constructor validates the CSRF secret and returns only its opaque, retained-config derivation.
// Session/anonymous binding is package-owned; app source receives no signer or binding callback
// (SPEC §6.6/§10.3).
export const appCsrf = betterAuthCsrfFromEnvironment({
  field: 'csrf',
});

export const appSession = session(
  s.object({
    id: s.string(),
    user: s.object({ id: s.string(), email: s.string(), name: s.string() }),
  }),
);

const authBindings = createAppAuthBindings({
  csrf: appCsrf,
  signInAccess: publicAccess('sign-in runs before authentication'),
});

export const appSessionProvider = appSession.provider(authBindings.sessionProvider);
export const appSignIn = authBindings.signIn;
export const appSignOut = authBindings.signOut;
// ESM evaluates this module once before app.tsx. Keep privileged demo-user setup as boot-only
// top-level work and export no repeatable system-DB callable (SPEC §6.6/§10.3).
await appRuntimeDbReady;
await authBindings.seedDemoUser();
