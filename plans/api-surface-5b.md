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

- [ ] Reduce Better Auth human root to guards, CSRF/environment config, mounting, and mature
      workflows.
- [ ] Move generated backend binding/carrier machinery to a generated/private assembly boundary
      and converge Postgres/SQLite shapes.
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
- [ ] Add the dependency and a real inferred harness example to the packed starter.
  - Current gap: the starter dependency is present, but `templates/src/app.test.ts` still teaches
    the HTTP subprocess journey and does not import `createKovoTestHarness`.

## Exit

- [ ] Server/core roots meet G22 through ledger-backed decisions, not `/types` barrels.
- [ ] Packed starter harness satisfies G24 and all 5b standing batch checks pass.

## Latest verification

Focused verification: five harness/Postgres/export/migration/budget test files pass (17 tests);
`pnpm run check:test-package-budget` passes its build, offline install, exact dependency closure,
measured budgets, and two mutation tests. The packed starter harness example and G24 remain open.
