# Bugz 15

Created 2026-06-29. Source of truth remains `SPEC.md`. One confirmed soundness defect in
security-relevant cookie machinery, escalated from the postgres-template dogfood sweep
(companion papercuts ledger: `plans/papercuts-super-6.md`), reproduced first-hand by the main
thread against a clean `create-kovo` (default postgres) prod build.

It fails **closed** (no authentication, not a bypass) — it is not an exploit — but it is a
normative cookie-handling soundness defect that renders the blessed auth integration
completely unusable in production, so it is filed here rather than as a DX papercut.

## Scope

- App: a fresh `create-kovo` default (postgres/PGlite) scaffold, link-local to the monorepo,
  built with `pnpm run build:prod` and run as the README-documented prod command
  (`NODE_ENV=production node dist/server/server.mjs`).
- Out of scope: the interactivity / file / CSP / forms papercuts (in `papercuts-super-6.md`).

## Issues

- [ ] **B1 — The production cookie floor renames Better Auth's session cookie to `__Host-…`, but Better Auth reads the unprefixed name, so production login is completely non-functional — every authenticated request bounces to `/login`.** (HIGH, framework; found by `t2-auth-lifecycle`)
  - Observed / impact: under `NODE_ENV=production`, sign-in succeeds (`303 → /`, `Set-Cookie: __Host-better-auth.session_token=…; Secure; HttpOnly; SameSite=Lax`), but the very next `GET /` with that exact cookie jar returns `303 → /login?next=%2F` (unauthenticated). Resending the **same token value** under the original bare name `better-auth.session_token` returns `200` with `Demo User`/`Sign out` (authenticated). The framework writes the session cookie under a name Better Auth cannot read back, so login appears to succeed and then the user is bounced straight back to `/login` on every subsequent request. Dev (no `Secure` → no prefix) works, so `pnpm run check` and `build:prod` are both green and never catch it.
  - Root cause: a trigger divergence between Kovo's prefix rule and Better Auth's. (1) `packages/better-auth/src/internal/credential.ts:42-47` `forwardBetterAuthSetCookie` re-emits each parsed Better Auth `Set-Cookie` via `context.setCookie(name, value, options)` with **no cookie class**. (2) `packages/server/src/cookies.ts:301` defaults an omitted class to `'session'` (the credential floor), and `:271-284` `applyCookieNamePrefix` prepends `__Host-` when `Secure` + `Path=/` + no `Domain`; `:160-161,:205` the `Secure` floor is engaged by `NODE_ENV=production`. So the forwarded `better-auth.session_token` is silently renamed to `__Host-better-auth.session_token`. (3) On the read side, Better Auth `dist/cookies/index.mjs:18-44` `createCookieGetter` names the cookie `${secureCookiePrefix}${name}` where `secureCookiePrefix` is `__Secure-` or empty (**never `__Host-`**); with the starter's http `baseURL` (`src/auth.ts:73` default `'http://localhost:5173'`) it reads the bare name. Kovo prefixes on `NODE_ENV=production` while Better Auth prefixes on `baseURL` protocol, so http-under-prod **guarantees** the mismatch.
  - Why it matters: the default postgres starter ships Better Auth as the blessed, documented auth integration, and the README's own prod command (`package.json` `start`/`serve` = `NODE_ENV=production node dist/server/server.mjs`) is exactly the trigger. In production no user can stay logged in. It fails closed (a denial-of-auth, not a bypass), but the blessed integration is unusable and both gates are green — a soundness gap in the cookie-name floor.
  - Repro evidence (self-verified, clean base scaffold): `KOVO_DEMO_PASSWORD=… KOVO_DATA_DIR=/tmp/prodpg6 NODE_ENV=production PORT=3014 node dist/server/server.mjs`; (1) GET `/login`, extract csrf; (2) POST `/_m/auth/sign-in` (Origin/Referer set) → `303 → /` + `Set-Cookie: __Host-better-auth.session_token=…`; (3) `GET /` with that jar → `303 → /login?next=%2F` (UNAUTH); (4) `GET /` resending the same token under bare `better-auth.session_token` → `200` + `Demo User` (AUTH). Step 3 vs 4 isolates the prefix rename as the sole cause.
  - Fix / acceptance: align the two prefix rules — either `forwardBetterAuthSetCookie` must not let the prod floor `__Host-`-rename Better Auth's cookies (forward them under a class/name Better Auth can read back), or the auth integration must configure Better Auth's `cookiePrefix`/secure-cookie behavior to match the `__Host-` name the floor produces. Prove with an e2e test: a `NODE_ENV=production` sign-in followed by an authenticated `GET /` with the returned cookie jar returns `200` (stays logged in).

## Latest Verification

- **B1 (self-verified, clean `create-kovo` default scaffold, prod build):** sign-in sets `__Host-better-auth.session_token`; `GET /` with that jar → `303 /login?next=%2F`; resending the same token under the bare name → `200` "Demo User". Cookie-floor rename confirmed at `cookies.ts:271-284,:301`; Better Auth read-name confirmed via the bare-name 200.
