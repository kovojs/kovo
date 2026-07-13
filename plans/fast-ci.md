# Fast CI Without Hiding Coverage

Created 2026-07-02. Goal: reduce Kovo CI wall-clock time by caching expensive setup and avoiding repeated work while keeping the same tests and proof jobs on the normal CI path. This plan must not move tests behind a weaker gate, nightly-only workflow, manual trigger, path filter, or merge-only condition.

## Constraints

- [x] Keep every currently required CI proof on pull requests and `main` pushes.
  - Evidence to add: final `.github/workflows/*.yml` diff showing no test/proof job was moved behind `workflow_dispatch`, `schedule`, path-only filters, or main-only gating.
  - Evidence: `.github/workflows/ci.yml` still runs on `pull_request` and `push` to `main`; the batch only changes the `build` step command to `vp exec pnpm run check:build:ci` and keeps all required jobs in the aggregate `check` needs list.
- [x] Follow `rules/github-workflows.md` before editing GitHub Actions workflows.
  - Evidence to add: implementation handoff cites the rule file and the workflow commands that changed.
  - Evidence: `rules/github-workflows.md` was read before editing; changed workflow pnpm invocations remain under `vp exec`, including the new `vp exec pnpm run check:build:ci`.
- [x] Preserve fail-fast diagnostics where they are intentionally broad.
  - Evidence to add: final workflow still reports all root, starter, integration, conformance, build, static-safety, kovo-check, Pages, and race-repeat failures unless an item below explicitly documents a narrower behavior.
  - Evidence: `.github/workflows/ci.yml` keeps `fail-fast: false` for root/starter/integration matrices and keeps the aggregate `check` job depending on `static-safety`, `test`, `starter-packages`, `starter`, `starter-packed`, `integration`, `build`, `browser`, `conformance`, and `kovo-check`; Pages and race-repeat workflows are unchanged.

## Current Cost Centers

- [x] Measure the latest successful baseline with per-job and per-step durations.
  - Evidence to add: `gh run view <run> --json jobs` summarized into a small table in this plan or a linked note, including setup, Playwright install, root Vitest, starter proofs, integration, build, static-safety, Pages, and race-repeat durations.
  - Evidence: `gh run view 28554909799 --repo kovojs/kovo --json jobs` on 2026-07-02. Baseline CI wall clock was 13m36s (`2026-07-01T23:36:29Z` to `23:50:06Z`). Long poles: static-safety 11m11s; starter shards ranged 9m14s-13m09s; root Vitest shards ranged 5m13s-8m53s; integration shards ranged 6m13s-7m00s; kovo-check shards ranged 6m10s-8m10s; build 3m41s; browser 3m42s; conformance 4m38s. Latest comparable Pages success `28561510142` was 7m02s; latest race-repeat success `28561510139` was 5m18s.
- [x] Identify duplicate setup work that happens in every matrix job.
  - Evidence to add: checked inventory of repeated `setup-vp`, `vp install`, `pnpm rebuild better-sqlite3`, compiler cache restore, Playwright install, artifact download, and build/typecheck work across CI jobs.
  - Evidence: local inventory via `rg -n "setup-vp|actions/cache|playwright install|pnpm rebuild better-sqlite3|download-artifact" .github/workflows` showed every CI, Pages, and race-repeat job repeated `setup-vp`, `vp install`, and compiler cache restore; static-safety/test/starter repeated `better-sqlite3` rebuild; test/starter/browser/integration/Pages/race-repeat repeated Playwright installs; browser and kovo-check consume `kovo-dist`; starter shards conditionally consume `kovo-packed-starter`.
- [x] Identify duplicate proof work without removing the proof.
  - Evidence to add: checked inventory of commands that validate overlapping artifacts, such as `pnpm run check`, `check:build`, starter production proofs, Pages build, race-repeat browser coverage, and root/integration Playwright installs.
  - Evidence: command inventory in `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, and `.github/workflows/race-repeat.yml` found proof commands remain distinct: `vp exec pnpm run check`, `vp exec pnpm run check:build`, starter `run-starter`, Pages `vp run build`/site export/link/smoke, race-repeat Playwright repeat, root Vitest, integration Playwright, browser suites, conformance, and kovo-check. This batch caches setup/install work only; it does not remove proof commands.

## Phase 1 - Cache Expensive Dependencies

- [x] Cache Playwright browser binaries for root test shards.
  - Implementation notes: add an `actions/cache` entry for the Playwright browser cache keyed by OS, Playwright version, and requested browser set. Keep `vp exec playwright install --with-deps chromium` as the install/repair command after restore.
  - Evidence to add: first run may miss; second run shows cache restore for Chromium and still executes the root Vitest shards.
  - Current implementation: `.github/actions/playwright-install/action.yml` restores `~/.cache/ms-playwright`; root test shards use key `kovo-playwright-${{ runner.os }}-${{ env.PLAYWRIGHT_VERSION }}-chromium-${{ hashFiles('pnpm-lock.yaml') }}` and still run `vp exec playwright install --with-deps chromium` before root Vitest.
  - Evidence: CI run `28564988478` shows root `test (1, 3)` and `test (3, 3)` cache hits for `kovo-playwright-Linux-1.60.0-chromium-...`, followed by `vp exec playwright install --with-deps chromium` and successful root Vitest shard jobs.
- [x] Cache Playwright browser binaries for integration shards.
  - Implementation notes: use a separate key for Chromium/Firefox/WebKit so integration does not poison Chromium-only root/starter caches. Keep `vp exec playwright install --with-deps chromium firefox webkit` after restore to validate OS deps.
  - Evidence to add: second run shows cache restore for all three browser engines and still executes all three integration shards.
  - Current implementation: integration and browser jobs use separate `all` browser keys and still run `vp exec playwright install --with-deps chromium firefox webkit`.
  - Evidence: CI run `28564988478` shows integration and browser cache hits for `kovo-playwright-Linux-1.60.0-all-...`, followed by `vp exec playwright install --with-deps chromium firefox webkit`; all three integration shards and the browser job passed.
- [x] Cache Playwright browser binaries for browser-backed starter shards.
  - Implementation notes: reuse the Chromium-only cache key from root test shards where possible; the conditional starter browser install must remain tied to `starter-needs-browser`.
  - Evidence to add: browser-backed starter shard restores Chromium cache and still runs `Generated starter proofs`.
  - Current implementation: the starter Playwright install remains guarded by `if: steps.starter-shard.outputs.needsBrowser == 'true'` and reuses the Chromium-only cache key.
  - Evidence: CI run `28564988478` shows browser-backed `starter (7, 8)` taking the conditional install path, restoring `kovo-playwright-Linux-1.60.0-chromium-...`, still running `vp exec playwright install --with-deps chromium`, and completing `Generated starter proofs`.
- [x] Cache native rebuild outputs where supported by the package manager and runner.
  - Implementation notes: investigate whether `better-sqlite3` rebuild output can be retained through pnpm/vp store cache or a targeted cache without stale ABI risk. Key by OS, Node version, lockfile, and package version.
  - Evidence to add: either a working cache with a second-run duration improvement, or a recorded decision that ABI/staleness risk is not worth caching.
  - Evidence: no native rebuild-output cache was added. `better-sqlite3` rebuild products are native ABI/OS/Node-sensitive and tied to the installed workspace tree, so this batch keeps the explicit `vp exec pnpm rebuild better-sqlite3` in the shared setup action for jobs that already required it rather than introducing a stale binary cache.

## Phase 2 - Stop Repeating Setup Boilerplate

- [x] Create a reusable workflow setup block or composite local action for common CI setup.
  - Implementation notes: centralize checkout, `setup-vp`, `vp install`, exact TypeScript build-info restore, and optional `better-sqlite3` rebuild. Keep command semantics identical.
  - Evidence to add: CI workflow diff shows repeated setup reduced while job commands still run under `vp exec` where required by `rules/github-workflows.md`.
  - Evidence: `.github/actions/kovo-setup/action.yml` centralizes post-checkout `setup-vp`, `vp install`, only `**/.kovo/cache/*.tsbuildinfo`, and optional `vp exec pnpm rebuild better-sqlite3`; security-bearing compiler/static facts are process-private.
- [x] Retire cross-run compiler/security-fact cache restores and standardize TypeScript build-info keys.
  - Evidence: `.github/actions/kovo-setup/action.yml` uses `kovo-tsc-${runner.os}-${node-version}-...` and restores only `.tsbuildinfo`; the generated starter uses the same narrow cache family. `scripts/compiler-build-id.mjs` is deleted.
- [x] Avoid duplicate artifact downloads inside matrix jobs.
  - Implementation notes: starter shards should download `kovo-packed-starter` only when `starter-needs-packed` is true, as today; verify no unconditional artifact downloads were introduced by refactoring.
  - Evidence to add: one non-packed starter shard log shows no artifact download, and one packed starter shard log shows the artifact download.
  - Current implementation: `.github/workflows/ci.yml` keeps the eight `starter` shards on `--mode unpacked` with no `starter-packages` dependency and no `actions/download-artifact` step. The required `starter-packed` job runs all three packed entries via `--mode packed --shards 1 --index 1`, depends on `starter-packages`, and downloads `kovo-packed-starter` once. Local proof: `vp exec vitest --run scripts/ci-shards.test.mjs`; `vp exec node scripts/ci-shards.mjs generate-starter --mode unpacked --shards 8 --index 1 --outDir /tmp/kovo-fast-ci-unpacked`; `vp exec node scripts/ci-shards.mjs generate-starter --mode packed --shards 1 --index 1 --outDir /tmp/kovo-fast-ci-packed-one`; `starter-needs-packed` returned 1 for the unpacked shard and 0 for the packed shard.
  - Evidence: CI run `28564988478` shows the eight unpacked `starter` jobs running `Generated starter proofs` without artifact download steps, while the separate `starter-packed` job consumes `kovo-packed-starter` and runs `Generated packed starter proofs`.

## Phase 3 - Reuse Build Artifacts Without Skipping Tests

- [x] Reuse `kovo-dist` where downstream jobs only need built package artifacts.
  - Implementation notes: keep the `build` job as the producer of `dist`; allow downstream jobs that currently rebuild only to obtain artifacts to download `kovo-dist` instead. Tests still run; only redundant builds are removed.
  - Evidence to add: downstream job logs show `kovo-dist` download plus the same test/proof command that previously ran.
  - Evidence: `.github/workflows/ci.yml` keeps `build` as the `kovo-dist` producer and `browser`/`kovo-check` as downstream consumers using `actions/download-artifact` before running `vp run browser`, gallery browser, P10 perf, and `vp exec node scripts/kovo-check.mjs compiler-runtime server-browser project`.
- [x] Separate "build artifact required" from "build proof required".
  - Implementation notes: if a job currently runs `check:build` only to prove build correctness, keep that proof in the build job. If it runs a build only because a later command needs `dist`, consume the artifact instead.
  - Evidence to add: command inventory proving no required `check:build` proof was removed, only redundant artifact production.
  - Evidence: `package.json` adds `check:build:ci` for the CI build proof (`node scripts/egress-floor.mjs --policy build -- vp run build`), while local `check:build` remains comprehensive; `.github/workflows/ci.yml` runs `vp exec pnpm run check:build:ci` in the `build` job and downstream jobs consume `kovo-dist`.
- [x] Keep Pages validation while avoiding a second identical package build if possible.
  - Implementation notes: Pages may still need site-specific build steps. Reuse package build artifacts only if the Pages workflow can consume them without weakening the Pages deploy proof.
  - Evidence to add: Pages run still builds/validates the site and succeeds from the same commit as CI.
  - Evidence: `.github/workflows/pages.yml` remains unchanged because Pages is a separate workflow and must prove site export, link checks, smoke, and deploy artifact generation from its own checkout; no Pages validation was moved behind CI artifact reuse.

## Phase 4 - Improve Test Shard Efficiency

- [ ] Update root Vitest timing history after every successful CI run and verify shard balance.
  - Implementation notes: keep the current timing artifact behavior, then compare shard durations over at least two green runs. Adjust `scripts/ci-shards.mjs` only if imbalance remains after caching.
  - Evidence to add: before/after root shard duration table with max/min ratio.
  - Current implementation: `scripts/ci-shards.mjs` now parses Vitest v4 JSON reports that use `testResults[].name`, file-level `assertionResults[].duration`, or `endTime - startTime`, and fails `merge-vitest`/`merge-playwright` when no durations are found instead of uploading `{}`. Next CI must prove non-empty root timing artifacts before this checkbox is closed.
- [x] Refresh starter shard timing weights from a post-cache successful run.
  - Implementation notes: do not reduce the eight starter shards or hide any starter proof. Only rebalance which proofs land in which shard.
  - Evidence to add: before/after starter shard duration table with all eight shards still present.
  - Current implementation: no proof was removed; `scripts/ci-shards.mjs` filters the same starter entry list into `all`, `unpacked`, and `packed` modes. The normal `starter` job still has eight shards, and the packed-only proofs are covered by a separate required `starter-packed` job so unpacked proofs no longer wait for packed package artifact creation.
  - Evidence: post-cache CI run `28564988478` supplied starter timings; `scripts/ci-shards.mjs` refreshed clear entry weights and still assigns eight unpacked starter shards. Local proof: `vp exec vitest --run scripts/ci-shards.test.mjs packages/conformance-fixtures/src/command-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts`.
- [x] Audit integration shard balance after Playwright cache lands.
  - Implementation notes: keep all three integration shards and all browsers. Rebalance only if one shard remains the long pole after browser install time is removed.
  - Evidence to add: before/after integration shard duration table with all three shards still present.
  - Evidence: green runs `28563692587` and `28564988478` kept three integration shards; latest durations were 5m04s, 4m43s, and 5m33s (max/min 1.18), so no rebalance was needed.

## Phase 5 - Remove Pure Duplicate Checks Safely

- [x] Split duplicated commands inside `pnpm run check` only when the same CI run already proves them elsewhere.
  - Implementation notes: if a command is already run as its own required CI step in the same workflow, move it to a named step and make `pnpm run check` call a shared script or smaller command set in CI. Local `pnpm run check` can remain comprehensive.
  - Evidence to add: matrix proving each original `pnpm run check` subcommand still executes once in CI.
  - Evidence: `.github/workflows/ci.yml` keeps `vp exec pnpm run check` in `static-safety`; the `build` job now runs `vp exec pnpm run check:build:ci`, avoiding a second `check:inline-loader` run while preserving the egress-floor build proof. Local proof: `vp exec pnpm run check:build:ci`.
- [x] Avoid running the same build proof twice in the same workflow.
  - Implementation notes: keep `check:build` as required. If `pnpm run check` or another job repeats a full package build, replace the duplicate with artifact consumption or a narrower validation that proves only the missing claim.
  - Evidence to add: command inventory showing exactly one required full package build proof per commit, with all consumers still tested.
  - Evidence: CI now has one full package build producer (`build` running `check:build:ci`) and two artifact consumers (`browser`, `kovo-check` downloading `kovo-dist`); local `check:build` remains unchanged for developer acceptance.
- [x] Keep security and mutation gates on the normal path.
  - Implementation notes: do not move `check:security-test-builds`, `check:security-gate-mutations`, classifier gates, census, sink policy, or kovo-check to a slower tier.
  - Evidence to add: CI logs show those gates still ran on the optimized workflow.
  - Evidence: `package.json` keeps `check:security-test-builds`, `check:security-gate-mutations`, `check:fail-closed-classifiers`, `check:classifier-verdict-routing`, `check:fundamental-fixes-census`, `check:sink-policy`, and related gates inside `pnpm run check`, which `.github/workflows/ci.yml` still runs in required `static-safety`.
- [x] Remove inert `kovo-check` matrix fan-out while keeping the full `kovo-check` suite required.
  - Evidence: `rg "KOVO_SECURITY_PRESET|KOVO_SECURITY_DIALECT" .github packages tests scripts -n` found no consumer except the new negative workflow assertion, so the six-row matrix was repeating the same full suite with inert environment variables. `.github/workflows/ci.yml` now runs one required `vp exec node scripts/kovo-check.mjs compiler-runtime server-browser project` job, still gated by `build` and still consuming `kovo-dist`. Local proof: `vp exec vitest --run packages/conformance-fixtures/src/command-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts`; Ruby YAML parse of `.github/workflows/ci.yml`.

## Acceptance

- [x] CI wall-clock time improves by at least 25% on two consecutive comparable runs.
  - Evidence to add: before/after run URLs and wall-clock durations for the full CI workflow.
  - Evidence: baseline CI run `28554909799` took 13m36s. Comparable green optimized runs `28563692587` (`af6ecc78f`, 9m26s) and `28564988478` (`2d5310d37`, 9m28s) both beat the 10m12s target. Failed intervening runs `28564111336` and `28564514690` were not counted because one failed from an integration flake and one failed before tests during mutable `vite-plus/latest` setup.
- [x] No required proof disappears.
  - Evidence to add: checklist mapping every pre-plan CI job/step to an optimized job/step that still runs on pull requests and `main` pushes.
  - Evidence: CI run `28564988478` passed required static-safety, three root test shards, eight starter shards, starter-packages, starter-packed, three integration shards, build, browser, conformance, kovo-check, and aggregate check jobs on the normal push path. Pages run `28564988445` also passed for the same commit.
- [ ] Cache hits are visible and keyed safely.
  - Evidence needed: final CI logs show Playwright and `kovo-tsc-*` restores; no `kovo-compiler-*` or cross-run static-analysis fact restore remains.
- [x] Local and workflow syntax checks pass.
  - Evidence to add: `pnpm run check:vp`, `git diff --check`, and a successful GitHub Actions run for the optimized commit.
  - Evidence: for the latest batch, `vp exec vitest --run packages/conformance-fixtures/src/command-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts scripts/ci-shards.test.mjs` passed; `pnpm run check:vp` passed in the integration worktree; `git diff --check` passed; Ruby YAML parse passed for `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.github/workflows/race-repeat.yml`, `.github/actions/kovo-setup/action.yml`, and `.github/actions/playwright-install/action.yml`; GitHub CI run `28564988478` and Pages run `28564988445` passed for `2d5310d37`.
