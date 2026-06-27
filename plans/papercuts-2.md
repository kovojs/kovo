# Papercuts 2

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
small but user-visible framework/template papercuts found while dogfooding a new
basic todo app at `/Users/mini/kovo-dogfood-todo` from local `create-kovo`.

## Scope

The run scaffolded a fresh SQLite app with local `packages/create-kovo/dist/index.mjs`,
linked generated `@kovojs/*` dependencies to the local monorepo packages,
converted the generated contact book into a minimal authenticated todo list, and
exercised install, test, check, build, dev server on `0.0.0.0:5188`, browser
login, add, and toggle. Production fixes are intentionally out of scope for this
ledger.

## Issues

- [x] **SQLite starter omits pnpm native-build approval for `better-sqlite3`.**
  - Observed behavior: after linking generated `@kovojs/*` dependencies to local
    packages, `pnpm install` completed but warned `Ignored build scripts:
better-sqlite3`; `pnpm run test` then failed before tests ran with
    `Could not locate the bindings file` from `better-sqlite3`.
  - Root cause: the generated SQLite app depends on a native package but its
    `package.json` does not include the pnpm allowlist that the monorepo root has:
    `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`. `pnpm rebuild better-sqlite3`
    returned success but did not create the missing binding.
  - Why it matters: the SQLite option is supposed to be the self-contained starter,
    but a default pnpm install leaves it unable to boot or test.
  - Repro evidence: initial `pnpm run test` failed at `src/db.ts:31` constructing
    `new Database(':memory:')`; adding `pnpm.onlyBuiltDependencies[0]=better-sqlite3`,
    removing `node_modules` and `pnpm-lock.yaml`, and reinstalling made
    `pnpm run test` pass.
  - Acceptance: the SQLite template should generate the pnpm native-build allowlist
    or otherwise make the post-scaffold install path build `better-sqlite3`
    noninteractively.
  - Evidence: `packages/create-kovo/templates/package.sqlite.json` now emits
    `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`; `pnpm exec vitest run
packages/create-kovo/src/index.test.ts` passed and asserts the SQLite
    generated package includes the native-build allowlist.

- [x] **SQLite Better Auth seed uses incompatible date column types.**
  - Observed behavior: `pnpm run build:prod` exited 0 but logged Better Auth
    `Failed to create user TypeError: SQLite3 can only bind numbers, strings,
bigints, buffers, and null` twice during `seedDemoUser()`.
  - Root cause: the SQLite template hand-authors Better Auth tables with text date
    columns such as `createdAt`, `updatedAt`, `expiresAt`, and token expiry fields,
    while Better Auth's Drizzle adapter passes Date-like values that this
    better-sqlite3/Drizzle path does not bind to text columns.
  - Why it matters: the generated demo credentials look available, but the demo
    user is not reliably seeded; the production build also reports scary auth
    errors while still succeeding.
  - Repro evidence: build log from `/Users/mini/kovo-dogfood-todo` showed the
    Better Auth error before the local workaround. Changing auth date fields to
    `integer(..., { mode: 'timestamp_ms' })` and matching integer DDL removed the
    error; `pnpm run test` and `pnpm run build:prod` then passed.
  - Acceptance: the SQLite template should either generate Better Auth's expected
    SQLite column modes or derive/materialize the auth schema from the Better Auth
    table metadata used by the conformance bridge.
  - Evidence: `packages/create-kovo/templates/src/schema.sqlite.ts` now uses
    `integer(..., { mode: 'timestamp_ms' })` for Better Auth date fields, and
    `packages/create-kovo/templates/src/db.sqlite.ts` creates matching integer
    DDL; `pnpm exec vitest run packages/create-kovo/src/index.test.ts`,
    temp generated SQLite app `pnpm run test`, and temp generated SQLite app
    `pnpm run build:prod` passed with no `SQLite3 can only bind` or
    `Failed to create user` log.

- [x] **Enhanced auth sign-in still succeeds without navigating.**
  - Observed behavior: signing in at
    `http://100.108.214.117:5188/login?next=%2F` set
    `better-auth.session_token`, but the browser stayed on the login URL.
    Manually navigating to `/` then showed the authenticated todo page.
  - Root cause: the enhanced submit path posted to `/_m/auth/sign-in` with empty
    `Kovo-Targets`/`Kovo-Live-Targets`; the server returned
    `200 text/vnd.kovo.fragment+html`, `kovo-changes: [{"domain":"auth"}]`, and
    an empty body instead of a client-consumable redirect or document navigation.
  - Why it matters: auth succeeded server-side but looked failed to the user. This
    is the same user-visible class as `papercuts-1`, but this dogfood run shows a
    remaining success-with-empty-fragment path after the earlier redirect fix.
  - Repro evidence: Playwright captured the sign-in response with status `200`,
    `content-length: 0`, `content-type: text/vnd.kovo.fragment+html`, and
    `kovo-changes: [{"domain":"auth"}]`; cookies included both `kovo_csrf` and
    `better-auth.session_token`.
  - Acceptance: successful enhanced auth mutations must navigate to the resolved
    `next`/default route even when the adapter records an `auth` change rather
    than returning a raw 303 response.
  - Evidence: `pnpm exec vitest run packages/browser/src/mutation-submit.test.ts
packages/browser/src/mutation-fetch.test.ts` covers modular empty auth
    fragments with safe `next` and unsafe fallback; `pnpm exec vitest run
packages/browser/src/inline-loader-enhanced-submit.test.ts` covers inline
    loader parity; `pnpm --filter @kovojs/browser run check:inline-loader`
    verifies the generated inline runtime is current.

- [x] **Compiler cache JSON is regenerated in a format that `vp check` rejects.**
  - Observed behavior: after running tests/dev/browser flows, `pnpm run check`
    failed on formatting for `.kovo/cache/compiler/blobs/*.json`,
    `.kovo/cache/compiler/entries/*.json`, and `.kovo/cache/compiler/manifest.json`.
  - Root cause: generated apps only ignored `.kovo/endpoint-posture.json`, even
    though `.kovo/` is framework-owned generated state: bundled agent docs,
    endpoint-posture output, compiler caches, and other CLI artifacts. Because
    `.kovo/cache/` remained visible, the default `vp check` scanned compact JSON
    cache files.
  - Why it matters: an app can go from green to red just by running normal dev or
    test flows before `check`, and the reported files are framework cache
    artifacts rather than authored source.
  - Repro evidence: `pnpm run check` failed twice on `.kovo/cache/compiler/*`;
    `pnpm exec vp check --fix` formatted those artifacts, after which
    `pnpm run check` passed.
  - Acceptance: generated apps should ignore the entire `.kovo/` directory.
  - Evidence: `packages/create-kovo/src/index.ts` now emits `.kovo/` in generated
    `.gitignore`; `pnpm exec vitest run packages/create-kovo/src/index.test.ts`
    passed and asserts `.kovo/` is present while the old
    `.kovo/endpoint-posture.json` partial ignore is absent.

- [x] **Query-read extraction misses helper-mediated `context.db` reads, yielding empty mutation fragments.**
  - Observed behavior: before explicit registry wiring, enhanced `addTodo` posted
    `Kovo-Targets: todos-region=todos` and a live target, wrote to the database,
    then returned `200 text/vnd.kovo.fragment+html` with
    `kovo-changes: [{"domain":"todo"}]`, `content-length: 0`, and no visible DOM
    update. A full reload later showed the inserted todo.
  - Root cause: Drizzle static extraction inferred mutation touches for `addTodo`
    and `toggleTodo`, but `extractQueryFactsFromProject` returned `[]` for
    `todosQuery`. The query loader reads through `const db = requireDb(context)`
    before `.from(todos)`, and that helper-mediated read-only handle path is not
    recognized as a query read. Runtime therefore has touches for `todo` but no
    generated query-read registry entry for `todos`.
  - Why it matters: the generated starter itself uses a helper to require
    framework-provided `context.db`; copying that pattern into a basic todo app
    makes enhanced mutation refresh silently return empty fragments unless the
    author adds explicit registry wiring.
  - Repro evidence: a source-level extractor run over the dogfood app returned
    `queryFacts: []`, `touchGraphKeys: ["addTodo", "toggleTodo"]`, and mutation
    touches for domain `todo`. The compiled component cache still knew
    `TodosRegion` had `queries:["todos"]`, but `queryUpdatePlans` and
    `updateCoverage` were empty. Adding local `todoDomain`, `reads: [todoDomain]`,
    and `registry: { queries: [todosQuery], touches: [todoDomain] }` made
    browser add/toggle return non-empty fragments and update the DOM.
  - Acceptance: query-read extraction should recognize the starter's
    `requireDb(context)` pattern, or the starter should generate explicit
    domain/read/touch wiring until inference is complete. Add a regression using
    the helper-mediated loader shape.
  - Evidence: `pnpm exec vitest run packages/drizzle/src/index.query-loader-receivers.test.ts`
    passes with a regression where `todosQuery` loads through
    `const db = requireDb(context)` and emits `reads: ["todo"]`.

## Refuted / Not Carried Forward

- The initial generated app referenced unpublished `@kovojs/*@0.1.3` packages.
  For dogfood runs this is release-state noise: the intended setup is to test
  the local Kovo monorepo packages unless the user explicitly asks to validate
  npm-published installs.
- Better Auth's peer warning for `drizzle-orm@^0.45.2` versus `1.0.0-rc.3` was
  observed during install, but this run did not prove a direct failure caused by
  the peer range itself after the SQLite date-column workaround.
- Browser console warnings about COOP/OAC on `http://100.108.214.117:5188` were
  expected for an HTTP private-network origin and did not block the app workflow.

## Latest Verification

- `pnpm exec vitest run packages/create-kovo/src/index.test.ts`: passed after
  both SQLite template fixes.
- `pnpm exec vitest run packages/browser/src/mutation-submit.test.ts
packages/browser/src/mutation-fetch.test.ts
packages/browser/src/inline-loader-enhanced-submit.test.ts`: passed after the
  enhanced auth empty-fragment navigation fix.
- `pnpm exec vitest run packages/drizzle/src/index.query-loader-receivers.test.ts
packages/drizzle/src/index.receiver-alias-bindings.test.ts
packages/drizzle/src/index.query-loader-config.test.ts
packages/drizzle/src/index.query-shapes.test.ts`: passed after the
  helper-mediated query-read extraction fix.
- `pnpm --filter @kovojs/browser run check:inline-loader`, `pnpm exec vp check
packages/create-kovo/src/index.test.ts
packages/create-kovo/templates/package.sqlite.json
packages/create-kovo/templates/src/schema.sqlite.ts
packages/create-kovo/templates/src/db.sqlite.ts
packages/create-kovo/templates/README.sqlite.md
packages/browser/src/mutation-fetch.ts
packages/browser/src/mutation-submit.test.ts
packages/browser/src/inline-loader-build.ts
packages/browser/src/inline-loader.ts
packages/browser/src/inline-loader-enhanced-submit.test.ts
packages/drizzle/src/static/schema.ts
packages/drizzle/src/index.query-loader-receivers.test.ts
plans/papercuts-2.md`, and `git diff --check`: passed for the integrated
  patch set.
