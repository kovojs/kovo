# Papercuts 2

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
small but user-visible framework/template papercuts found while dogfooding a new
basic todo app at `/Users/mini/kovo-dogfood-todo` from local `create-kovo`.

## Scope

The run scaffolded a fresh SQLite app with local `packages/create-kovo/dist/index.mjs`,
converted the generated contact book into a minimal authenticated todo list, and
exercised install, test, check, build, dev server on `0.0.0.0:5188`, browser login,
add, and toggle. Production fixes are intentionally out of scope for this ledger.

## Issues

- [ ] **Fresh scaffold can reference unpublished `@kovojs/*` versions.**
  - Observed behavior: `pnpm install` in `/Users/mini/kovo-dogfood-todo` failed
    immediately with `ERR_PNPM_NO_MATCHING_VERSION` for `@kovojs/server@0.1.3`;
    npm reported the latest published `@kovojs/server` as `0.1.2`.
  - Root cause: `create-kovo` renders the monorepo package version into generated
    `package.json` dependencies, but the current framework package set has not
    been published at that exact version. A fresh app outside the monorepo has no
    local workspace fallback.
  - Why it matters: the first post-scaffold command from the CLI's "Next steps"
    fails before the app can run, even though the scaffold itself succeeded.
  - Repro evidence: `node packages/create-kovo/dist/index.mjs /Users/mini/kovo-dogfood-todo --name kovo-dogfood-todo --dialect sqlite --disable-git`
    succeeded, then `pnpm install` in the generated app failed fetching
    `@kovojs/server@0.1.3`.
  - Acceptance: generated apps should either install from published, mutually
    available versions or provide an explicit local-development path when run
    from an unpublished monorepo checkout.

- [ ] **SQLite starter omits pnpm native-build approval for `better-sqlite3`.**
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

- [ ] **SQLite Better Auth seed uses incompatible date column types.**
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

- [ ] **Enhanced auth sign-in still succeeds without navigating.**
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

- [ ] **Compiler cache JSON is regenerated in a format that `vp check` rejects.**
  - Observed behavior: after running tests/dev/browser flows, `pnpm run check`
    failed on formatting for `.kovo/cache/compiler/blobs/*.json`,
    `.kovo/cache/compiler/entries/*.json`, and `.kovo/cache/compiler/manifest.json`.
  - Root cause: Kovo compiler cache artifacts are emitted as compact JSON under
    `.kovo/cache/`, the generated `.gitignore` does not ignore that cache, and
    the default `vp check` scans the directory.
  - Why it matters: an app can go from green to red just by running normal dev or
    test flows before `check`, and the reported files are framework cache
    artifacts rather than authored source.
  - Repro evidence: `pnpm run check` failed twice on `.kovo/cache/compiler/*`;
    `pnpm exec vp check --fix` formatted those artifacts, after which
    `pnpm run check` passed.
  - Acceptance: generated apps should ignore `.kovo/cache/`, the formatter should
    exclude it, or the compiler should emit cache JSON in formatter-stable shape.

- [ ] **Query-read extraction misses helper-mediated `context.db` reads, yielding empty mutation fragments.**
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

## Refuted / Not Carried Forward

- Better Auth's peer warning for `drizzle-orm@^0.45.2` versus `1.0.0-rc.3` was
  observed during install, but this run did not prove a direct failure caused by
  the peer range itself after the SQLite date-column workaround.
- Browser console warnings about COOP/OAC on `http://100.108.214.117:5188` were
  expected for an HTTP private-network origin and did not block the app workflow.

## Latest Verification

- `pnpm --filter create-kovo run build:dist` in `/Users/mini/kovo`: passed before
  scaffolding the dogfood app.
- `pnpm run test` in `/Users/mini/kovo-dogfood-todo`: 2 files, 5 tests passed
  after local SQLite build-script and auth-schema workarounds.
- Browser dogfood on `http://100.108.214.117:5188`: sign-in set the session cookie
  but stayed on `/login`; after manual navigation plus explicit registry wiring,
  enhanced add returned a 12 KB fragment, enhanced toggle returned a 12 KB
  fragment with keyed `todo` change, the new todo became visible, and its row
  changed to `Done`.
- `pnpm exec vp check --fix && pnpm run check && pnpm run build:prod` in
  `/Users/mini/kovo-dogfood-todo`: passed after formatting regenerated cache
  files and applying local app workarounds.
