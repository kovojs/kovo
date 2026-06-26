---
title: Better Auth integration
description: Wire Better Auth into Kovo routes, sessions, CSRF-protected mutations, and guarded pages.
order: 2.6
---

# Better Auth integration

`create-kovo` ships a working Better Auth integration. Use the scaffold as the reference before
inventing a custom auth path: it puts Better Auth tables beside app tables, adapts sessions into
Kovo request context, and exposes sign-in/sign-out as ordinary CSRF-protected Kovo mutations.

## Files in the starter

| File                            | Role                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `src/schema.ts`                 | App tables plus Better Auth's user/session/account/verification tables.               |
| `src/db.ts`                     | The Drizzle database passed to both app queries and Better Auth.                      |
| `src/auth.ts`                   | Better Auth instance, Kovo session provider, CSRF options, auth mutations, demo seed. |
| `src/components/auth-forms.tsx` | Sign-in and sign-out forms bound to the auth mutations.                               |
| `src/app.tsx`                   | `sessionProvider`, guarded home route, `/login`, and mutation registration.           |

## Wire the session provider

The integration path is:

1. Create `betterAuth({ database: drizzleAdapter(appDb, ...) })`.
2. Define the Kovo session schema with `session(s.object(...))`.
3. Wrap Better Auth with `betterAuthSession()`.
4. Pass the provider to `createApp({ sessionProvider })`.

That keeps `request.session` typed in routes and mutations without making page components call the
auth library directly.

The smallest Kovo-facing piece is the session adapter:

```ts
import { betterAuthSession } from '@kovojs/better-auth';

export const appSessionProvider = commerceSession.provider(
  betterAuthSession(auth, ({ session, user }) => ({
    id: session.id,
    user: { id: user.id, email: user.email, name: user.name },
  })),
);
```

Use one shared auth module so the session shape, Better Auth adapter, and CSRF binding stay in one
place:

```ts
import { betterAuthSession } from '@kovojs/better-auth';
import { s, session, type CsrfValidationOptions } from '@kovojs/server';

export interface AppRequest {
  authCsrfId?: string | null;
  session?: { id: string; user: { id: string; email: string; name: string } } | null;
}

export const appSession = session(
  s.object({
    id: s.string(),
    user: s.object({ id: s.string(), email: s.string(), name: s.string() }),
  }),
);

function requireAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.KOVO_CSRF_SECRET;
  if (!secret) throw new Error('Set BETTER_AUTH_SECRET or KOVO_CSRF_SECRET.');
  return secret;
}

export const appCsrf = {
  field: 'csrf',
  secret: requireAuthSecret(),
  sessionId(request: AppRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
} satisfies CsrfValidationOptions<AppRequest>;

export const appSessionProvider = appSession.provider(
  betterAuthSession(auth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: { id: user.id, email: user.email, name: user.name },
  })),
);
```

## Sign-in and sign-out mutations

The starter uses:

```ts
betterAuthSignInEmailMutation(auth, {
  csrf: appCsrf,
  defaultRedirectTo: '/',
});
```

and:

```ts
betterAuthSignOutMutation(auth, {
  csrf: appCsrf,
  defaultRedirectTo: '/login',
  guard: authed<AppRequest>(),
});
```

They are normal Kovo mutations. Register them in `createApp({ mutations: [...] })`, render them from
forms, and let the server handle enhanced and no-JS outcomes through the mutation contract.

## CSRF before and after login

Login forms do not have a session yet, so the starter binds their token to an anonymous id under a
private HMAC secret. After login, the same CSRF config binds to `request.session.id`. Keep that
single config in `src/auth.ts` and reuse it for product mutations.

`create-kovo` writes a fresh local `KOVO_CSRF_SECRET` into `.env` and a placeholder into
`.env.example`. The app fails closed if the secret is missing or still the placeholder. In
production, set `BETTER_AUTH_SECRET` or `KOVO_CSRF_SECRET` through real secret management.

## Guard pages and mutations

Use route-level redirects for pages:

```tsx
import { redirect, route } from '@kovojs/server';

export const homeRoute = route('/', {
  page(_context, request: AppRequest) {
    if (!request.session) return redirect('/login', {});
    return <HomePage request={request} />;
  },
});
```

Use `authed<AppRequest>()` for mutations that require a signed-in user. Auth failures and typed
authorization failures are different server outcomes; keep those rules in the route/mutation facts
instead of hiding them in component code.

## Verify the integration

```sh
vp check
vp test
npm run build:prod
```

## Next

- [Project structure](/getting-started/project-structure/) - see where the starter keeps this
  wiring.
- [Security & authorization](/guides/security/) - the broader CSRF and guard model behind the
  starter snippet.

<details>
<summary>Spec & diagnostics</summary>

Session typing, CSRF binding before/after login, and fail-closed secret handling: SPEC §6.6. Route
guards and redirect outcomes: SPEC §9.5, §10.2.

</details>
