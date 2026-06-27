# Papercut Super Codex 1

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
small but user-visible framework/template papercuts found while dogfooding several
fresh local Kovo apps.

## Scope

Exercised local monorepo packages from `/Users/mini/kovo` through generated apps:

- `/tmp/kovo-dogfood-super-2026-06-27/sqlite-advanced`
- `/tmp/kovo-dogfood-super-2026-06-27/postgres-advanced`
- `/Users/mini/kovo-dogfood-super-2026-06-27/sqlite-ui-auth`
- `/Users/mini/kovo-dogfood-super-2026-06-27/postgres-prod-static`
- `/Users/mini/kovo-dogfood-super-2026-06-27/sqlite-diagnostics`

Covered scaffold, local package linking, install, formatter/type/test checks,
production build preflight, dev server boot, Better Auth sign-in, CSRF-stamped
mutation forms, no-JS mutation redirect, enhanced mutation fragment wire, query
refresh chunks, and endpoint posture headers. This pass intentionally did not fix
production code.

## Issues

- [ ] **Local dogfood linking breaks for apps scaffolded under `/tmp` on macOS.**
  - Observed behavior: after `node /Users/mini/kovo/scripts/link-local-kovo.mjs /tmp/kovo-dogfood-super-2026-06-27/sqlite-advanced /Users/mini/kovo && pnpm install`, pnpm warned that every linked Kovo package came from a non-existent `/private/Users/mini/kovo/packages/*` path. `pnpm run check` then failed to resolve `@kovojs/server/vite` from `vite.config.ts`.
  - Root cause: `scripts/link-local-kovo.mjs` resolves the app root through the macOS `/tmp -> /private/tmp` real path but leaves the Kovo root as `/Users/mini/kovo`; `relative(appRoot, kovoRoot)` becomes `../../../Users/mini/kovo/...`, which resolves under `/private/Users/...` from a `/private/tmp/...` app.
  - Why it matters: the dogfood skill recommends `/tmp/kovo-dogfood-*`; following that supported contributor workflow makes the first generated local app fail before framework behavior can be exercised.
  - Repro evidence: `/tmp/.../sqlite-advanced/package.json` contained `link:../../../Users/mini/kovo/packages/server`; `pnpm run check` reported `Could not resolve '@kovojs/server/vite'` and `ERR_MODULE_NOT_FOUND`.
  - Acceptance: `scripts/link-local-kovo.mjs` should write link/workspace paths that survive macOS `/tmp` symlink normalization, with a regression that scaffolds under `os.tmpdir()`, links local packages, and resolves `@kovojs/server/vite`.

- [ ] **Fresh SQLite starter can fail its own formatter gate.**
  - Observed behavior: in `/Users/mini/kovo-dogfood-super-2026-06-27/sqlite-ui-auth`, after local linking and install, `pnpm run check` failed immediately with `Formatting issues found package.json`; `pnpm exec vp check --fix package.json` rewrote the file and the same `pnpm run check` then passed.
  - Root cause: `packages/create-kovo/templates/package.sqlite.json` is not in the order/shape enforced by the generated `vp check` formatter: it places `packageManager`/`pnpm` before `type` and keeps `pnpm.onlyBuiltDependencies` inline, while the formatter moves `packageManager` near the end and expands the array.
  - Why it matters: SQLite is an advertised scaffold dialect, and the starter's first documented validation command should not fail on generated metadata formatting.
  - Repro evidence: `pnpm run check` failed on `package.json`; after `pnpm exec vp check --fix package.json`, `pnpm run check` passed all formatter, lint/type, sound-subset, and endpoint-posture checks.
  - Acceptance: the SQLite package template should be formatter-stable; a create-kovo test should run `vp check` against both generated Postgres and SQLite manifests without `--fix`.

- [ ] **Generated starter check is green while production build preflight is red.**
  - Observed behavior: unchanged generated apps passed `pnpm run check`, but `pnpm run build:prod` failed with `kovo build check preflight failed`. The preflight emitted `WARN KV310 addContact -> contacts`, `ERROR KV436 MUTATION addContact`, `ERROR KV436 MUTATION auth/sign-out`, and `ERROR KV402 addContact touches contact`.
  - Root cause: the generated app relies on type-level `QueryRegistry`/`InvalidationSets` augmentation plus `optimistic.contacts`, which is enough for the dev/type check path, but `packages/cli/src/commands/build-export.ts` constructs the production check graph from runtime app declarations plus Drizzle static facts. The app-authored `addContact` mutation has no runtime `registry.touches`/`registry.queries`, so the build graph sees Drizzle's `contact` touch as undeclared and misses optimistic coverage. The same build graph/access pass reports `guard=-` for starter mutations authored with guard/access decisions, so access recovery is also inconsistent.
  - Why it matters: `SPEC.md` §9.5 makes production build replay/checks part of the same app aggregate, and app authors need one starter validation command that predicts deployability. A green `check` followed by red `build:prod` is a high-friction late failure.
  - Repro evidence: `/Users/mini/kovo-dogfood-super-2026-06-27/postgres-prod-static`: `pnpm run check` passed, then `pnpm run build:prod` failed with KV310/KV436/KV402. The same failure reproduced in `/Users/mini/kovo-dogfood-super-2026-06-27/sqlite-ui-auth` after fixing package formatting.
  - Acceptance: unchanged generated Postgres and SQLite starters should pass `pnpm run build:prod`, or the starter should generate the runtime registry/access facts the build preflight requires; create-kovo build integration should include the actual `build:prod` command, not just `tsc`, app tests, and dev boot.

- [ ] **Parallel production builds collide on a dev WebSocket port.**
  - Observed behavior: running `pnpm run build:prod` concurrently in two separate generated apps printed `WebSocket server error: Port 24678 is already in use` before the shared build-preflight diagnostics. A serial rerun did not print the WebSocket error.
  - Root cause: the production build path appears to load enough Vite/dev-server plumbing to initialize a fixed HMR WebSocket listener even though the command is `kovo build ./src/app.tsx`; the port collision is unrelated to the app's production preflight failure.
  - Why it matters: CI matrices and agent dogfood runs commonly build multiple apps concurrently. A production build should not expose dev HMR port state or add misleading infrastructure errors ahead of actionable framework diagnostics.
  - Repro evidence: concurrent `pnpm run build:prod` in `sqlite-ui-auth` and `sqlite-diagnostics` both printed `WebSocket server error: Port 24678 is already in use`; a later serial `pnpm run build:prod` in `sqlite-ui-auth` omitted that line and failed only on the Kovo preflight diagnostics.
  - Acceptance: two independent `kovo build` processes should not attempt to bind a shared dev HMR WebSocket port; a regression can spawn two starter builds concurrently and assert stderr contains no WebSocket port-collision line.

## Refuted / Not Carried Forward

- Runtime auth and guarded routing worked in the SQLite starter once the app was linked outside `/tmp`: `/` returned `303 Location: /login?next=%2F`, `/login` emitted CSRF and security headers, posting valid demo credentials with `Origin` returned `303 Location: /`, and the guarded home page rendered `Demo User`.
- The no-JS contact mutation fallback worked: posting a valid `/_m/addContact` form with CSRF/idempotency fields returned `303 Location: /`, and the refreshed home page showed the added contact and updated count.
- The enhanced mutation fragment path worked when sent with browser-equivalent headers: `Kovo-Fragment: true`, `Kovo-Targets: contacts-region=contacts`, and the live-target token returned `200 text/vnd.kovo.fragment+html` with `<kovo-query name="contacts">` and `<kovo-fragment target="contacts-region">`.
- A dev-server exit seen on port 5179 was not carried forward because the same auth/request flow did not reproduce the exit on port 5180; `/api/health` continued returning `{"ok":true}`.
- A raw mutation POST without `Origin` returned CSRF 422. That is expected security posture; the valid browser-like POST with `Origin`/`Referer` succeeded.

## Latest Verification

- `node packages/create-kovo/src/index.ts ... --sqlite/--postgres --disable-git`: generated five fresh dogfood apps.
- `node scripts/link-local-kovo.mjs ... && pnpm install`: reproduced broken `/tmp` link specs and successful non-`/tmp` local linking.
- `pnpm run check` in `sqlite-ui-auth`: failed before formatter fix, then passed after `pnpm exec vp check --fix package.json`.
- `pnpm run check && pnpm run build:prod` in `postgres-prod-static`: check passed; build failed with KV310/KV436/KV402.
- `pnpm run build:prod` in `sqlite-ui-auth`: serial build reproduced the same preflight failure without the WebSocket collision.
- `pnpm run dev -- --host 127.0.0.1 --port 5180` plus curl flows: verified login, guarded page rendering, no-JS mutation redirect, enhanced mutation fragment wire, and `/api/health` headers.
