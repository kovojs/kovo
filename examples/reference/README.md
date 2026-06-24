# Kovo Reference Example (Auth & Security)

A minimal reference app focused on **authentication, authorization, and request
security** in Kovo. It is deliberately small so the security-critical surface —
sessions, CSRF, guards, and the scope-audit graph — is easy to read in full.

## What it demonstrates

- **Authentication via `@kovojs/better-auth`** (`src/app.ts`): a typed
  `session()` schema, a `betterAuthSession` session provider, and
  `betterAuthSignInEmailMutation` / `betterAuthSignOutMutation` sign-in and
  sign-out mutations.
- **CSRF protection**: `csrfField` / `csrfToken` with a per-session
  `CsrfValidationOptions`, threaded through the login and logout forms.
- **Route guards**: `authed<...>()` on `/account` and `role<...>('admin')` on
  `/admin`, so authorization is checked at the route boundary.
- **Reference shell tests** exercise the same auth and scope behavior through
  routes, forms, and mutations instead of hand-authored graph fixtures.
- **App shell** (`src/app-shell.ts`): a `createApp()` wiring the routes,
  mutations, mutation responses (redirects + failure re-render), and a public
  shell with a `/c/` client module — including synthetic-replay export.

This example has **no live demo service**, so it does not appear in the
human-facing `/examples/` route; its authored source is surfaced to agents via
`llms.txt` / `llms-full.txt`.

## Run

```bash
# Run the tests (the primary way to exercise this example):
pnpm --filter @kovojs/example-reference test       # vitest

# Static export of the public shell:
node examples/reference/scripts/export-static.mjs
```

`vp` is the Vite-plus toolchain runner; `kovo` is the framework CLI. This
reference app is exercised primarily through its `app.test.ts` /
`app-shell.test.ts` suites.
