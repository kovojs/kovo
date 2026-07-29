# World-class DevEx — app-contract-dependent API batches

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 5b. Dependency: D1 and the relevant Track 4 primitives.
Gates: G17, G18, G22-G24. Every batch carries the full standing API/migration/snapshot/packed proof
checklist from the charter.

## Server

- [ ] Keep only decision-ledger-backed daily declarations at the server root.
- [ ] Move each advanced capability family to its named semantic task path.
- [ ] Internalize resolved options, generated protocol/fragment shapes, framework DB carriers,
      live-target authority, and `isKovoApp`.
- [ ] Delete `committedSecretWaiver` or implement a real explain-visible AST lint before retaining
      any replacement.
- [ ] Remove duplicate server-root homes for core storage/verifier/scoped-key/browser-trust
      constructors.
- [ ] Keep and document `runtime-bootstrap` for the `SPEC.md` §6.6 literal-first boundary.
- [ ] Reach the server ≤120 root target only through decision-backed concept reduction.

## Better Auth and optimism

- [x] Reduce Better Auth human root to guards, CSRF/environment config, mounting, and mature
      workflows.
  - Evidence: `pnpm run check:api-surface` reports zero undecided exports; the root exports only
    reviewed app-binding types, guards, environment/CSRF, mount, session, and password-reset APIs.
- [x] Move generated backend binding/carrier machinery to a generated/private assembly boundary
      and converge Postgres/SQLite shapes.
  - Evidence: `/generated/postgres` and `/generated/sqlite` own compiler assembly while
    `/postgres` and `/sqlite` expose the same app-owned options/result contract without accepting
    a human-supplied system DB capability.
- [ ] Add real mount/OAuth and password-reset journeys or mark incomplete workflows experimental.
- [ ] Make inline mutation optimism the sole taught ordinary path.
- [ ] Remove duplicate plans/cast adapters unless an advanced example proves a standalone need.

## Test harness

- [x] Implement an app-scoped harness whose types come from the imported app contract.
  - Evidence: `packages/test/src/harness.test.ts` compiles inferred DB, request, route, mutation,
    query, result, and declared-error types from the supplied app.
- [x] Load runtime proof facts only from digest-verified, complete, matching app artifacts.
  - Evidence: the focused harness suite executes imported app handles using only a verified graph
    artifact and matching lock/source/config digests.
- [x] Reject stale, partial, failed-build, and wrong-app artifacts.
  - Evidence: the harness suite proves all four refusal paths plus missing identity and non-absolute
    artifact/project paths.
- [x] Move useful RLS/CSRF helpers to `@kovojs/test` and remove the parallel server/testing home.
  - Evidence: package-export conformance covers `@kovojs/test/csrf` and `/postgres`;
    `pnpm run check:api-surface` records the removed `@kovojs/server/testing` home.
- [x] Remove `/test-case` unless a sound Vitest fixture API replaces it.
  - Evidence: the decision/migration gates classify and exercise removal of the subpath and
    `kovoTest` family; the package-export conformance fixture has no `/test-case` import.
- [x] Split ordinary harness dependencies from Playwright and optional/native backend engines.
  - Evidence: `pnpm run check:test-package-budget` proves the harness runtime closure contains none
    of the optional Playwright, PGlite, or native SQLite peers.
- [x] Ratify installed-size and dependency-count budgets before adding the harness to the starter.
  - Evidence: the budget gate measures 3,088,503 installed bytes, nine package-store entries, and a
    243,685-byte tarball within the dated ratchets.
- [x] Add the dependency and a real inferred harness example to the packed starter.
  - Evidence: G24 runs `templates/src/app.test.ts` with `createKovoTestHarness`, an imported app
    contract, and the digest-verified successful-build graph (1 passed, 2 skipped).

## Exit

- [ ] Server/core roots meet G22 through ledger-backed decisions, not `/types` barrels.
- [ ] Packed starter harness satisfies G24 and all 5b standing batch checks pass.

## Latest verification

Latest verification: G24 passes in 290.89 seconds real; `pnpm run check:api-surface` reports 1,674
ledger-backed declarations across 1,873 subpaths and passes 28 API/migration tests. The combined
5b exit remains open pending the other standing batch checks.
