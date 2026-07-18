# @kovojs/better-auth

Better Auth adapter for Kovo. It provides framework-owned SQLite and Postgres bindings with a
sanitized session provider, CSRF-protected sign-in/sign-out mutations, auth guards, role checks,
and an opaque redirect-protocol mount.

```sh
pnpm add @kovojs/better-auth better-auth
```

Construct auth through `createBetterAuthSqliteBindingsFromEnvironment` or
`createBetterAuthPostgresBindingsFromEnvironment`. Each returns only the Kovo-facing
`sessionProvider`, `signIn`, `signOut`, `mountAdapter`, and `seedDemoUser` operations; the raw
Better Auth object and database capability never leave the constructor. Caller-created
`betterAuth()` objects are intentionally not accepted by the public API (SPEC §6.6).

The opaque mount is redirect-only. Kovo rejects Better Auth JSON/HTML routes and external or
ambiguous redirects, strips every response body and unreviewed header, and emits only a canonical
same-origin `Location`, reviewed callback cookies, and Kovo's `no-store` cache floor (SPEC
§6.6/§9.1).

## Reference

- API: `/api/better-auth/`
- Guide: `/guides/auth-better-auth/`
