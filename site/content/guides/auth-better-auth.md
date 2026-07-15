---
title: Better Auth integration
description: Use Kovo's generated Better Auth boundary for sessions, credential mutations, CSRF, and production-safe configuration.
order: 2.6
---

# Better Auth integration

Use the generated integration when you want email-and-password sessions in a Kovo app. The starter
keeps Better Auth's secret, raw router, and writable database adapter behind a framework-owned
module. Your app receives a session provider and two ordinary Kovo mutations: sign in and sign out.

If you already have another session source, start with
[Security & authorization](/guides/security/) instead.

## Scaffold the integration

Create an app and run it:

```sh
pnpm create kovo my-app
cd my-app
pnpm install
pnpm run dev
```

Open `/`. The guarded route redirects to `/login`. Sign in as `demo@example.com` with the random
`KOVO_DEMO_PASSWORD` written to the generated, gitignored `.env` file.

The app-authored part of `src/auth.ts` is deliberately small:

```ts
import { authed, betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
import { s, session } from '@kovojs/server';

export const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf' });
export const appSession = session(
  s.object({ id: s.string(), user: s.object({ id: s.string(), email: s.string() }) }),
);
export const appAuthed = authed<AppRequest>();
```

The same module asks the generated runtime boundary for sanitized bindings:

```text
import { publicAccess } from '@kovojs/server';

import { appRuntimeDbReady, createAppAuthBindings } from './_kovo/app-runtime-db.js';

const authBindings = createAppAuthBindings({
  csrf: appCsrf,
  signInAccess: publicAccess('sign-in runs before authentication'),
  signOutAccess: [appAuthed],
});

export const appSessionProvider = appSession.provider(authBindings.sessionProvider);
export const appSignIn = authBindings.signIn;
export const appSignOut = authBindings.signOut;

await appRuntimeDbReady;
await authBindings.seedDemoUser();
```

Keep the two awaits as boot-only top-level work. Do not export `seedDemoUser`, alias it, or call it
from a request path. In production it is disabled. In development it creates a credential without
creating a session; the user still has to submit the CSRF-protected sign-in form.

## Wire the request shell

Register the generated values like any other Kovo session, CSRF configuration, and mutations:

```tsx
import { createApp, redirect, route } from '@kovojs/server';

declare const appAuthed: any;
declare const appCsrf: any;
declare const appRuntimeDbProvider: any;
declare const appSessionProvider: any;
declare const appSignIn: any;
declare const appSignOut: any;
declare const addContact: any;
declare function HomePage(props: { userName: string }): string;

const app = createApp({
  csrf: appCsrf,
  db: appRuntimeDbProvider,
  mutations: [addContact, appSignIn, appSignOut],
  sessionProvider: appSessionProvider,
  routes: [
    route('/', {
      access: [appAuthed],
      page(_context, request: AppRequest) {
        if (!request.session) return redirect('/login', {});
        return <HomePage userName={request.session.user.name} />;
      },
    }),
  ],
});
```

The route access decision is the security boundary. The redirect is the no-JavaScript experience
for an anonymous visitor.

## Keep the generated boundary intact

The starter splits responsibility across these files:

| File                                  | Role                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `src/auth.ts`                         | Session schema, guard, opaque CSRF configuration, and sanitized auth bindings. |
| `src/_kovo/app-runtime-db-options.ts` | Validated schema and seed configuration for boot and `kovo db`.                |
| `src/_kovo/app-runtime-db.ts`         | Framework-owned database and Better Auth construction boundary.                |
| `src/db.ts`                           | App-facing read-only database value.                                           |
| `src/app.tsx`                         | Request shell, guarded routes, and credential mutation registration.           |

Do not replace this with a raw `betterAuth()` call in `src/auth.ts`. Do not export the system
database, Better Auth instance, signing secret, environment reader, or a generic signing helper.
The generated boundary consumes an opaque system-database capability and returns only frozen,
sanitized bindings.

The Postgres and SQLite starters use the same public shape. `create-kovo --sqlite` swaps the
generated database and schema modules without widening the values available to app source.

## Configure production

Set these values in the deployment secret store:

```dotenv
NODE_ENV=production
BETTER_AUTH_URL=https://app.example.com
BETTER_AUTH_SECRET=<at-least-32-characters-of-random-material>
```

`BETTER_AUTH_URL` is required in production. It must be a canonical HTTPS origin: no path, query,
fragment, credentials, or trailing slash. The generated boundary accepts `BETTER_AUTH_SECRET`, or
falls back to `KOVO_CSRF_SECRET`, and uses the value without exposing it to generated app code.

Do not set `BETTER_AUTH_SECRETS` or `BETTER_AUTH_TRUSTED_ORIGINS`. Kovo rejects those upstream
override variables because they would create a second authority outside the reviewed constructor.
The integration also pins secure-cookie posture, disables Better Auth telemetry, and routes password
hashing and verification through Kovo's pinned Argon2 implementation.

### Start custom runners lock-first

Kovo-generated server entries install the runtime lock automatically. A custom Node entry must make
the bootstrap its literal first import:

```ts
import '@kovojs/server/runtime-bootstrap';

import { createServer } from 'node:http';
import { createRequestHandler, toNodeHandler } from '@kovojs/server';
import app from './app.js';

createServer(toNodeHandler(createRequestHandler(app))).listen(3000);
```

The Better Auth Postgres and SQLite constructors refuse to read options or secrets before this lock
is installed. Importing app or auth code first and bootstrapping later is unsupported; restart the
process with the correct import order.

## Add a role guard

Start private pages with `appAuthed`. Add a role check when a page is not for every signed-in user:

```tsx
import { role } from '@kovojs/better-auth';
import { route } from '@kovojs/server';

declare function AdminPage(props: { email: string }): string;

export const adminRoute = route('/admin', {
  access: [role<AppRequest>('admin')],
  page(_context, request: AppRequest) {
    return <AdminPage email={request.session?.user.email ?? ''} />;
  },
});
```

`role()` reports anonymous callers as unauthenticated and signed-in callers without the role as
unauthorized.

## Handle invalid credentials

Keep the error in the form. The starter binds `FormError` to the real mutation export:

```tsx
import { FormError } from '@kovojs/core';

<form mutation={appSignIn}>
  <input type="hidden" name="next" value="/" />
  <input name="email" type="email" autocomplete="email" required />
  <input name="password" type="password" autocomplete="current-password" required />
  <FormError code="INVALID_CREDENTIALS" message="Invalid email or password." />
  <button type="submit">Sign in</button>
</form>;
```

Kovo renders the same failure on enhanced and full-page submissions. Sign-out also forwards Better
Auth's cookie-clearing headers. Keep both operations behind the generated bindings instead of
reimplementing their response handling.

## Next

- [Security & authorization](/guides/security/) - add owner-scoped reads and review access decisions.
- [Project structure](/getting-started/project-structure/) - see where the generated runtime files live.
- [Deployment](/guides/deployment/) - set the production origin, secret, and lock-first entrypoint.

<details>
<summary>Spec & diagnostics</summary>

Typed sessions, anonymous CSRF binding, and credential mutation behavior: SPEC §6.6. Capability
ownership and the no-raw-secret/no-system-database boundary: SPEC §10.3 C9. Default-deny access
decisions: SPEC §10.2. Custom runner bootstrap order: SPEC §9.5.

API reference: [@kovojs/better-auth](/api/better-auth/), [@kovojs/server](/api/server/).

</details>
