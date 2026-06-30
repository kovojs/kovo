# Bugz 22

Created 2026-06-30. Source of truth remains `SPEC.md`. These confirmed defects came from an
exhaustive dogfood pass against local `main` after the durable-tasks batch. Companion papercuts:
`plans/papercuts-20.md`.

## Scope

Fresh linked SQLite apps under `/Users/mini/kovo-dogfood-20260630-*` covered durable tasks,
islands/live targets, storage/assets, endpoints/auth, and routing/export/deploy skew. Each candidate
below was independently verified by a skeptical sub-agent and deduped against existing
`plans/bugz*` and `plans/papercuts*` ledgers.

## Issues

- [x] **B1 — SQLite starter mutations can 500 at runtime because the framework default transaction
      wrapper returns async handlers from a better-sqlite3 sync transaction callback.** (high,
      framework/runtime; found by `t2-islands-live` + `t3-storage`)
  - Observed behavior: a fresh SQLite starter can pass `check`, `test`, and `build:prod`, then a
    signed-in enhanced POST to `/_m/mutations/add-contact` returns HTTP 500 with
    `TypeError: Transaction function cannot return a promise`.
  - Root cause: `packages/server/src/mutation.ts:521-533` calls `db.transaction((tx) =>
runHandler(...))`; mutation handlers are Promise-capable (`packages/server/src/mutation/definition.ts:282`)
    while the SQLite starter uses `better-sqlite3` (`packages/create-kovo/templates/src/db.sqlite.ts:1`),
    whose transaction callbacks must be synchronous.
  - Why it matters: SPEC §10.3 requires a coherent mutation transaction lifecycle. The advertised
    SQLite starter now fails its generated async mutation path unless authors override the framework
    transaction policy.
  - Repro evidence: verifier reproduced a driver-level better-sqlite3 Promise-return transaction
    failure and an app-level generated `addContact` HTTP 500 in
    `/Users/mini/kovo-dogfood-20260630-t3-storage`; Russell reproduced the same in
    `/Users/mini/kovo-dogfood-20260630-t2-islands-live`.
  - Acceptance: default framework transaction handling supports async mutation handlers for SQLite
    without losing rollback semantics, or fails closed with an explicit diagnostic. Add a SQLite
    runtime/prod-artifact test that submits the generated `add-contact` mutation successfully.
  - Fixed evidence: `pnpm exec vitest --run packages/server/src/mutation.test.ts
packages/server/src/managed-db.test.ts packages/server/src/guards.test.ts` proves async
    better-sqlite3-style default transactions commit/roll back correctly; `pnpm exec vitest --run
packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts -t "serves generated SQLite
add-contact mutations"` proves the generated SQLite starter production artifact submits and
    persists `add-contact`.

- [x] **B2 — Query-backed components later in a multi-component module lose live-target ownership
      when the first component is not server-refreshable.** (med, framework/compiler soundness;
      found by `t2-islands-live`)
  - Observed behavior: a module with state-only `TriageIsland`, state-only `DraftScoreIsland`, then
    query-backed `ContactStatsRegion` renders `data-bind="contacts.count"` but has no `kovo-deps`,
    `kovo-fragment-target`, `kovo-live-component`, or live-target renderer. Enhanced add-contact
    returns the query chunk and `contacts-region` fragment but no stats fragment, so the stats
    region silently goes stale.
  - Root cause: `packages/compiler/src/scan/parse.ts:450-452`
    `componentHasInferredServerRefreshTarget(model)` checks only `firstComponentModel(model)`;
    `packages/compiler/src/app-graph.ts:220` and `:241` then return no fragment/live-target facts.
    The module graph is still derived from first-component identity in
    `packages/compiler/src/compile.ts:236` and `:389`.
  - Why it matters: SPEC §4.8 and §9.1 make compiler-owned live-target coverage the server-truth
    update path. A green build can ship a query-bound region that looks reactive but cannot receive
    mutation truth.
  - Repro evidence: verifier inspected
    `/Users/mini/kovo-dogfood-20260630-t2-islands-live/src/components/interaction-lab.tsx`, generated
    artifacts, and a built server smoke. Only `components/interaction-lab/triage-island` appeared in
    component graph facts; signed-in `/` had the stats bind but no live stamps; enhanced add-contact
    returned no stats fragment.
  - Acceptance: compiler graph/lowering records fragment/live-target facts for every eligible
    component in a multi-component module. Prove with compiler coverage and a prod-artifact mutation
    response test where a later query-backed component receives refreshed server truth.
  - Fixed evidence: `pnpm exec vitest --run packages/compiler/src/registry.test.ts
packages/compiler/src/stamps.test.ts packages/compiler/src/fragment-targets.test.ts
packages/compiler/src/query-coverage.test.ts packages/compiler/src/compile-component.test.ts`
    proves per-component graph/stamp/renderer coverage; `pnpm exec vitest --run
packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts -t "refreshes later
query-backed components"` proves the production mutation response includes the later component's
    refreshed fragment.

- [x] **B3 — SQLite apps can build with durable tasks but every request fails at runtime because the
      default node `JobRunner` always creates the Postgres durable queue.** (high, framework build
      gate/runtime; found by `t1-durable`)
  - Observed behavior: adding a durable task to a SQLite scaffold leaves `pnpm run build:prod` green,
    but runtime request handling fails before page rendering with `TypeError: Durable tasks require a
Postgres-compatible db client...`.
  - Root cause: `packages/server/src/app.ts:329-332` starts the task runtime before request
    handling; `packages/server/src/task-runtime.ts:80` unconditionally creates
    `PostgresDurableTaskQueue`; `packages/server/src/task-queue.ts:158` is Postgres-specific
    (`jsonb`, `timestamptz`, partial indexes). The node build diagnostics only check `JobRunner`
    capability, not store compatibility.
  - Why it matters: SPEC §9.6 says the default node runner drains from Postgres; SQLite support is
    not required, but the build must fail closed or diagnose the incompatible durable store instead
    of shipping a green artifact that 500s every request.
  - Repro evidence: verifier Darwin confirmed `/Users/mini/kovo-dogfood-20260630-t1-durable`
    `pnpm run build:prod` exits 0, while `pnpm run test`/runtime request startup fails with the
    Postgres-compatible db-client error.
  - Acceptance: a SQLite build that registers durable tasks fails at build/check time with an
    actionable diagnostic naming the Postgres durable-task store requirement, or the framework ships
    a supported SQLite durable queue. Add a starter/build test for the fail-closed path.
  - Fixed evidence: `pnpm exec vitest --run packages/server/src/build.test.ts
packages/server/src/task-runtime.test.ts packages/server/src/app.test.ts` proves KV446
    fail-closed durable-store diagnostics and startup error-shell routing; `pnpm exec vitest --run
packages/create-kovo/src/index.build.scaffold.test.ts -t "fails production build when a SQLite
app registers durable tasks"` proves the generated SQLite durable-task build fails with the
    actionable Postgres store diagnostic.

## Refuted / Not Carried Forward

- Auth/endpoint/webhook/rate-limit shell checks passed after app-author corrections.
- State islands, derives, and the optimistic/live success path passed after the SQLite transaction
  workaround, which helped isolate B1 as the root runtime failure.
- Storage upload parsing was not the transaction root cause; async schema/file parsing happens
  before the default transaction wrapper.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`; baseline linked scaffold `check`, `test`,
  `build:prod`, and dev HTTP smoke passed.
- Fix pass: focused server/compiler suites plus the split create-kovo prod-artifact/scaffold tests
  named under B1-B3 passed.
- `pnpm install` at the monorepo root completed after multi-app dogfood.
