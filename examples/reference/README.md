# Kovo Reference Example (Auth & Security)

A minimal reference app focused on **authentication, authorization, and request
security** in Kovo. It is deliberately small so the security-critical surface —
sessions, CSRF, guards, and the scope-audit graph — is easy to read in full.

## What it demonstrates

- **Local auth fixture** (`src/auth.ts`): a typed `session()` schema and ordinary Kovo mutations
  exercise login/logout without database bootstrap. It is deliberately nonproduction; deployable
  apps use `@kovojs/better-auth`'s fixed SQLite/Postgres binding constructors described in the
  Better Auth guide.
- **CSRF protection**: `csrfField` / `csrfToken` with a per-session
  `CsrfOptions`, threaded through the login and logout forms.
- **Route guards**: `guards.authed<...>()` on `/account` and `guards.role<...>('admin')` on
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

The fixed `correct` test password is available only under `NODE_ENV=test`. Development requires an
explicit local-only acknowledgement and an operator-chosen, nondefault password of at least 16
characters. The fixture also requires an exact loopback request URL and framework-resolved loopback
peer. Do not expose it through a tunnel or reverse proxy.

```bash
# Run the tests (the primary way to exercise this example):
pnpm --filter @kovojs/example-reference test       # vitest

# Static export of the public shell:
node examples/reference/scripts/export-static.mjs

# If you wire the authenticated shell into a local dev server:
KOVO_ENABLE_LOCAL_AUTH_FIXTURE=I_UNDERSTAND_THIS_IS_LOCAL_ONLY \
KOVO_LOCAL_AUTH_FIXTURE_PASSWORD='<unique local password, 16+ characters>' \
  kovo dev ./examples/reference/src/app-shell.ts
```

`vp` is the Vite-plus toolchain runner; `kovo` is the framework CLI. This
reference app is exercised primarily through its `app.test.ts` /
`app-shell.test.ts` suites.
