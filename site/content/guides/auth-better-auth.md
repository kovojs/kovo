---
title: Better Auth integration
description: Wire Better Auth into Kovo's starter, keep auth writes isolated, and guard routes and mutations with typed sessions.
order: 2.6
---

# Better Auth integration

Use this when you want Better Auth to own browser sessions in a Kovo app. The happy path is the
starter `create-kovo` already ships: Better Auth owns the cookies and auth tables, Kovo owns the
typed session, CSRF, guards, and route/mutation wiring.

If you already have another session source and only need route guards, start with
[Security & authorization](/guides/security/) instead.

## Wire the starter

`create-kovo` already splits the auth integration into a few small files:

| File                            | Role                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/schema.ts`                 | App tables plus Better Auth's `user` / `session` / `account` / `verification` tables.                  |
| `src/db.ts`                     | The app-facing read surface: `readonlyAppDb`.                                                          |
| `src/_kovo/app-runtime-db.ts`   | The framework-owned runtime handles, including Better Auth's writable `appRuntimeAuthDb`.              |
| `src/auth.ts`                   | Better Auth config, typed Kovo session, CSRF config, auth mutations, and the shared `appAuthed` guard. |
| `src/components/auth-forms.tsx` | Login form and `FormError` binding for invalid credentials.                                            |
| `src/app.tsx`                   | `sessionProvider`, guarded routes, Better Auth mounts, and mutation registration in the request shell. |

Start by keeping the auth wiring in one shared `src/auth.ts` module. This is the same shape the
starter uses, with one addition: `appSignUp`.

The smallest Kovo-facing piece is the session provider:

```ts
import { betterAuthSession } from '@kovojs/better-auth';

declare const appSession: {
  provider(value: unknown): unknown;
};
declare const auth: unknown;

export const appSessionProvider = appSession.provider(
  betterAuthSession(auth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: { id: user.id, email: user.email, name: user.name ?? user.email },
  })),
);
```

Here is the full starter-shaped module:

```text
// Adapted from packages/create-kovo/templates/src/auth.ts.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  authed as betterAuthAuthed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  type BetterAuthSessionPayload,
} from '@kovojs/better-auth';
import { publicAccess, s, session, type CsrfOptions } from '@kovojs/server';

import { appRuntimeAuthDb } from './_kovo/app-runtime-db.js';
import { authSchema } from './schema.js';

export interface AppSession {
  id: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles?: readonly ('admin' | 'member')[];
  };
}

export interface AppRequest {
  db: AppDb;
  headers: Headers;
  authCsrfId?: string | null;
  session?: AppSession | null;
}

interface BetterAuthAppSession {
  id: string;
}

interface BetterAuthAppUser {
  id: string;
  email: string;
  name?: string | null;
  roles?: readonly ('admin' | 'member')[] | null;
}

function requireAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.KOVO_CSRF_SECRET;
  if (!secret || secret === 'replace-with-a-deployed-secret') {
    throw new Error(
      'Set BETTER_AUTH_SECRET (or KOVO_CSRF_SECRET) to a strong random value.',
    );
  }
  return secret;
}

export const appCsrf = {
  field: 'csrf',
  secret: requireAuthSecret(),
  sessionId(request: AppRequest) {
    // Before sign-in Kovo binds CSRF to its own anonymous cookie. After sign-in,
    // bind to the real session id.
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
} satisfies CsrfOptions<AppRequest>;

export const appSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
      email: s.string(),
      name: s.string(),
    }),
  }),
);

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  secret: requireAuthSecret(),
  emailAndPassword: { enabled: true },
  // Kovo already stamps and verifies CSRF for its mutation forms.
  advanced: { disableCSRFCheck: true },
  database: drizzleAdapter(appRuntimeAuthDb, { provider: 'pg', schema: authSchema }),
});
export { auth };

function mapBetterAuthSession(
  value: BetterAuthSessionPayload<BetterAuthAppSession, BetterAuthAppUser>,
): AppSession {
  return {
    id: value.session.id,
    user: {
      id: value.user.id,
      email: value.user.email,
      name: value.user.name ?? value.user.email,
      ...(value.user.roles === undefined || value.user.roles === null
        ? {}
        : { roles: value.user.roles }),
    },
  };
}

export const appSessionProvider = appSession.provider(
  betterAuthSession<BetterAuthAppSession, BetterAuthAppUser, AppSession, AppRequest>(
    auth,
    mapBetterAuthSession,
  ),
);

export const appAuthed = betterAuthAuthed<AppRequest>();

export const appSignIn = betterAuthSignInEmailMutation<'auth/sign-in', AppRequest>(auth, {
  access: publicAccess('sign-in runs before authentication'),
  csrf: appCsrf,
  defaultRedirectTo: '/',
});

export const appSignUp = betterAuthSignUpEmailMutation<'auth/sign-up', AppRequest>(auth, {
  access: publicAccess('sign-up runs before authentication'),
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
  guard: appAuthed,
});
```

Use the shared guard in the request shell, then keep the page-level redirect as the no-JS fallback:

```text
// Adapted from packages/create-kovo/templates/src/app.tsx.
import { createApp, redirect, route } from '@kovojs/server';
import { mount } from '@kovojs/better-auth';

const app = createApp({
  csrf: appCsrf,
  db: appRuntimeDbProvider,
  endpoints: [
    mount('/api/auth', auth, { method: 'GET' }),
  ],
  mutations: [addContact, appSignIn, appSignUp, appSignOut],
  sessionProvider: appSessionProvider,
  routes: [
    route('/', {
      access: { guards: [{ guard: appAuthed, name: 'appAuthed' }], kind: 'guard-chain' },
      guard: appAuthed,
      page(_context, request: AppRequest) {
        if (!request.session) return redirect('/login', {});
        return <HomePage request={request} />;
      },
    }),
  ],
});
```

That is the default-deny shape to copy: one shared `appAuthed`, declared once on the route or
mutation, then reused everywhere private.

## Run it

Scaffold the starter, add `appSignUp` if you want first-user registration, then run the app:

```sh
pnpm create kovo my-app
cd my-app
pnpm install
vp dev
```

Then check the whole loop:

1. Open `/`. The guarded route redirects you to `/login`.
2. Submit the sign-up form, or sign in with `demo@example.com` and the generated `KOVO_DEMO_PASSWORD`
   from `.env`.
3. In the Network panel, inspect the `/_m/auth/sign-in` or `/_m/auth/sign-up` response. You should
   see Better Auth's `Set-Cookie` header and a redirect to `/`.
4. Follow the redirect back to `/`. The same guarded route now renders because `appAuthed` sees
   `request.session`.

What is nice here is that the login form and the guarded page are ordinary Kovo surfaces. No custom
auth middleware is hiding off to the side.

## Add the production shape

### Keep auth writes off the app read handle

The starter does not pass one wide-open database handle everywhere.

```text
// Adapted from packages/create-kovo/templates/src/db.ts and src/_kovo/app-runtime-db.ts.
export const readonlyAppDb: AppReadonlyDb = appRuntimeReadonlyDb;

export const appRuntimeAuthDb: AppDb = lazyAppDatabaseValue(() =>
  getAppDatabase().systemDb({
    operation: 'write',
    reason: 'Better Auth adapter manages session tables before an app session exists',
    surface: 'src/auth.ts',
  }),
);
```

Use `readonlyAppDb` for queries and app-authored reads. Keep `appRuntimeAuthDb` inside `src/auth.ts`
for the Better Auth adapter. That matches the starter's provenance comments and keeps the auth
library's pre-session writes out of your app-facing read surface.

### Mount Better Auth's callback handler

Kovo mutations are the right place for browser credential forms. Better Auth's own redirect protocol
handler belongs on a mounted endpoint instead:

```ts
import { mount } from '@kovojs/better-auth';
import { createApp } from '@kovojs/server';

declare const auth: unknown;

const app = createApp({
  endpoints: [mount('/api/auth', auth, { method: 'GET' })],
});
```

Use `GET` for the usual OAuth callback flow. If a provider posts back to the mount prefix, declare a
second mount with `method: 'POST'`. `mount()` always records the path as a CSRF-exempt endpoint
because the forgery protection there is Better Auth's provider `state`, not Kovo's mutation token.

### Add role-based guards after the session guard

Start private pages with `appAuthed`. Layer role checks on top when the page is not for every signed-in
user:

```tsx
import { role } from '@kovojs/better-auth';
import { route } from '@kovojs/server';

declare function AdminPage(props: { email: string }): string;

export const adminRoute = route('/admin', {
  guard: role<AppRequest>('admin'),
  page(_context, request: AppRequest) {
    return <AdminPage email={request.session?.user.email ?? ''} />;
  },
});
```

`role()` denies anonymous callers as unauthenticated and signed-in non-admins as unauthorized. That
keeps the redirect-vs-403 split in one guard vocabulary.

### Keep the sign-out and rolling-session headers

`betterAuthSignOutMutation()` does more than redirect. It forwards Better Auth's clearing
`Set-Cookie` headers and adds:

```http
Clear-Site-Data: "cookies", "storage", "executionContexts"
```

`betterAuthSession()` also calls `auth.api.getSession({ headers, returnHeaders: true })`. When
Better Auth refreshes a rolling session or writes its cookie cache on an authenticated GET, Kovo
forwards those refresh `Set-Cookie` headers through the session provider response channel. Do not
drop those headers in a custom adapter or proxy layer, or active users will age out at the original
session boundary.

## Handle failure

Keep invalid credentials in the form itself. The starter already does this with `FormError`:

```text
// Adapted from packages/create-kovo/templates/src/components/auth-forms.tsx.
/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';

import { appSignIn } from '../auth.js';

type LoginFormSlots = ComponentRenderSlots<{ appSignIn: typeof appSignIn }>;

export const LoginForm = component({
  mutations: { appSignIn },
  render: (_queries, _state, _slots: LoginFormSlots) => (
    <form mutation={appSignIn}>
      <input type="hidden" name="next" value="/" />
      <input name="email" type="email" autocomplete="email" required />
      <input name="password" type="password" autocomplete="current-password" required />
      <FormError
        code="INVALID_CREDENTIALS"
        message="Invalid email or password."
      />
      <button type="submit">Sign in</button>
    </form>
  ),
});
```

That failure code comes straight from `betterAuthSignInEmailMutation()` and
`betterAuthSignUpEmailMutation()`. Keep the form bound to the real mutation export and Kovo will
render the same `INVALID_CREDENTIALS` state on the enhanced path and the full-page no-JS path.

## Next

- [Security & authorization](/guides/security/) - route guards, `role()`, CSRF posture, and the
  access audits behind this guide.
- [Project structure](/getting-started/project-structure/) - where the starter keeps `src/auth.ts`,
  `src/db.ts`, and the generated runtime files.
- [Endpoints & webhooks](/guides/endpoints-webhooks/) - when a raw `endpoint()` or verifier is the
  better fit than a typed mutation.

<details>
<summary>Spec & diagnostics</summary>

Typed sessions, auth redirects, and mutation reauth flow: SPEC §6.5. CSRF is default-on for
mutation forms, including anonymous login/signup, and `csrf: false` is reserved for non-mutation
surfaces such as Better Auth callback mounts: SPEC §6.6. Mutation header forwarding, endpoint
mounts, and the request shell live in SPEC §9.1 and §9.5. Default-deny access decisions live in
SPEC §10.2.

API reference: [@kovojs/better-auth](/api/better-auth/), [@kovojs/core](/api/core/), [@kovojs/server](/api/server/).

</details>
