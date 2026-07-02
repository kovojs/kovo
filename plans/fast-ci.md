# Fast CI Without Hiding Coverage

Created 2026-07-02. Goal: reduce Kovo CI wall-clock time by caching expensive setup and avoiding repeated work while keeping the same tests and proof jobs on the normal CI path. This plan must not move tests behind a weaker gate, nightly-only workflow, manual trigger, path filter, or merge-only condition.

## Constraints

- [ ] Keep every currently required CI proof on pull requests and `main` pushes.
  - Evidence to add: final `.github/workflows/*.yml` diff showing no test/proof job was moved behind `workflow_dispatch`, `schedule`, path-only filters, or main-only gating.
- [ ] Follow `rules/github-workflows.md` before editing GitHub Actions workflows.
  - Evidence to add: implementation handoff cites the rule file and the workflow commands that changed.
- [ ] Preserve fail-fast diagnostics where they are intentionally broad.
  - Evidence to add: final workflow still reports all root, starter, integration, conformance, build, static-safety, kovo-check, Pages, and race-repeat failures unless an item below explicitly documents a narrower behavior.

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

- [ ] Cache Playwright browser binaries for root test shards.
  - Implementation notes: add an `actions/cache` entry for the Playwright browser cache keyed by OS, Playwright version, and requested browser set. Keep `vp exec playwright install --with-deps chromium` as the install/repair command after restore.
  - Evidence to add: first run may miss; second run shows cache restore for Chromium and still executes the root Vitest shards.
  - Current implementation: `.github/actions/playwright-install/action.yml` restores `~/.cache/ms-playwright`; root test shards use key `kovo-playwright-${{ runner.os }}-${{ env.PLAYWRIGHT_VERSION }}-chromium-${{ hashFiles('pnpm-lock.yaml') }}` and still run `vp exec playwright install --with-deps chromium` before root Vitest.
- [ ] Cache Playwright browser binaries for integration shards.
  - Implementation notes: use a separate key for Chromium/Firefox/WebKit so integration does not poison Chromium-only root/starter caches. Keep `vp exec playwright install --with-deps chromium firefox webkit` after restore to validate OS deps.
  - Evidence to add: second run shows cache restore for all three browser engines and still executes all three integration shards.
  - Current implementation: integration and browser jobs use separate `all` browser keys and still run `vp exec playwright install --with-deps chromium firefox webkit`.
- [ ] Cache Playwright browser binaries for browser-backed starter shards.
  - Implementation notes: reuse the Chromium-only cache key from root test shards where possible; the conditional starter browser install must remain tied to `starter-needs-browser`.
  - Evidence to add: browser-backed starter shard restores Chromium cache and still runs `Generated starter proofs`.
  - Current implementation: the starter Playwright install remains guarded by `if: steps.starter-shard.outputs.needsBrowser == 'true'` and reuses the Chromium-only cache key.
- [x] Cache native rebuild outputs where supported by the package manager and runner.
  - Implementation notes: investigate whether `better-sqlite3` rebuild output can be retained through pnpm/vp store cache or a targeted cache without stale ABI risk. Key by OS, Node version, lockfile, and package version.
  - Evidence to add: either a working cache with a second-run duration improvement, or a recorded decision that ABI/staleness risk is not worth caching.
  - Evidence: no native rebuild-output cache was added. `better-sqlite3` rebuild products are native ABI/OS/Node-sensitive and tied to the installed workspace tree, so this batch keeps the explicit `vp exec pnpm rebuild better-sqlite3` in the shared setup action for jobs that already required it rather than introducing a stale binary cache.

## Phase 2 - Stop Repeating Setup Boilerplate

- [x] Create a reusable workflow setup block or composite local action for common CI setup.
  - Implementation notes: centralize checkout, `setup-vp`, `vp install`, compiler cache key, compiler cache restore, and optional `better-sqlite3` rebuild. Keep command semantics identical.
  - Evidence to add: CI workflow diff shows repeated setup reduced while job commands still run under `vp exec` where required by `rules/github-workflows.md`.
  - Evidence: `.github/actions/kovo-setup/action.yml` centralizes post-checkout `setup-vp`, `vp install`, compiler build-id computation, compiler cache restore, and optional `vp exec pnpm rebuild better-sqlite3`. Local validation: `pnpm run check:vp`; `git diff --check`; Ruby YAML parse of CI, Pages, race-repeat, and both local actions. Checkout remains explicit in each job because local repository actions cannot be loaded until after checkout.
- [x] Standardize compiler cache keys across jobs.
  - Implementation notes: compute the compiler build id once per job through the shared setup and keep the current package/compiler source hash inputs. Do not broaden the key so far that stale compiler artifacts can cross source changes.
  - Evidence to add: CI run shows cache restore/save behavior for `.kovo/cache` on static-safety, build, test, starter, conformance, kovo-check, Pages, and race-repeat jobs.
  - Evidence: `.github/actions/kovo-setup/action.yml` keeps the existing key shape `kovo-compiler-${{ runner.os }}-${{ steps.compiler-cache-key.outputs.id }}-${{ hashFiles('packages/compiler/src/**', 'packages/*/package.json', 'pnpm-lock.yaml') }}` and is used by static-safety, build, test, starter, conformance, kovo-check, Pages, and race-repeat jobs.
- [ ] Avoid duplicate artifact downloads inside matrix jobs.
  - Implementation notes: starter shards should download `kovo-packed-starter` only when `starter-needs-packed` is true, as today; verify no unconditional artifact downloads were introduced by refactoring.
  - Evidence to add: one non-packed starter shard log shows no artifact download, and one packed starter shard log shows the artifact download.
  - Current implementation: `.github/workflows/ci.yml` keeps the eight `starter` shards on `--mode unpacked` with no `starter-packages` dependency and no `actions/download-artifact` step. The required `starter-packed` job runs all three packed entries via `--mode packed --shards 1 --index 1`, depends on `starter-packages`, and downloads `kovo-packed-starter` once. Local proof: `vp exec vitest --run scripts/ci-shards.test.mjs`; `vp exec node scripts/ci-shards.mjs generate-starter --mode unpacked --shards 8 --index 1 --outDir /tmp/kovo-fast-ci-unpacked`; `vp exec node scripts/ci-shards.mjs generate-starter --mode packed --shards 1 --index 1 --outDir /tmp/kovo-fast-ci-packed-one`; `starter-needs-packed` returned 1 for the unpacked shard and 0 for the packed shard.

## Phase 3 - Reuse Build Artifacts Without Skipping Tests

- [ ] Reuse `kovo-dist` where downstream jobs only need built package artifacts.
  - Implementation notes: keep the `build` job as the producer of `dist`; allow downstream jobs that currently rebuild only to obtain artifacts to download `kovo-dist` instead. Tests still run; only redundant builds are removed.
  - Evidence to add: downstream job logs show `kovo-dist` download plus the same test/proof command that previously ran.
- [ ] Separate "build artifact required" from "build proof required".
  - Implementation notes: if a job currently runs `check:build` only to prove build correctness, keep that proof in the build job. If it runs a build only because a later command needs `dist`, consume the artifact instead.
  - Evidence to add: command inventory proving no required `check:build` proof was removed, only redundant artifact production.
- [ ] Keep Pages validation while avoiding a second identical package build if possible.
  - Implementation notes: Pages may still need site-specific build steps. Reuse package build artifacts only if the Pages workflow can consume them without weakening the Pages deploy proof.
  - Evidence to add: Pages run still builds/validates the site and succeeds from the same commit as CI.

## Phase 4 - Improve Test Shard Efficiency

- [ ] Update root Vitest timing history after every successful CI run and verify shard balance.
  - Implementation notes: keep the current timing artifact behavior, then compare shard durations over at least two green runs. Adjust `scripts/ci-shards.mjs` only if imbalance remains after caching.
  - Evidence to add: before/after root shard duration table with max/min ratio.
- [ ] Refresh starter shard timing weights from a post-cache successful run.
  - Implementation notes: do not reduce the eight starter shards or hide any starter proof. Only rebalance which proofs land in which shard.
  - Evidence to add: before/after starter shard duration table with all eight shards still present.
  - Current implementation: no proof was removed; `scripts/ci-shards.mjs` filters the same starter entry list into `all`, `unpacked`, and `packed` modes. The normal `starter` job still has eight shards, and the packed-only proofs are covered by a separate required `starter-packed` job so unpacked proofs no longer wait for packed package artifact creation.
- [ ] Audit integration shard balance after Playwright cache lands.
  - Implementation notes: keep all three integration shards and all browsers. Rebalance only if one shard remains the long pole after browser install time is removed.
  - Evidence to add: before/after integration shard duration table with all three shards still present.

## Phase 5 - Remove Pure Duplicate Checks Safely

- [ ] Split duplicated commands inside `pnpm run check` only when the same CI run already proves them elsewhere.
  - Implementation notes: if a command is already run as its own required CI step in the same workflow, move it to a named step and make `pnpm run check` call a shared script or smaller command set in CI. Local `pnpm run check` can remain comprehensive.
  - Evidence to add: matrix proving each original `pnpm run check` subcommand still executes once in CI.
- [ ] Avoid running the same build proof twice in the same workflow.
  - Implementation notes: keep `check:build` as required. If `pnpm run check` or another job repeats a full package build, replace the duplicate with artifact consumption or a narrower validation that proves only the missing claim.
  - Evidence to add: command inventory showing exactly one required full package build proof per commit, with all consumers still tested.
- [ ] Keep security and mutation gates on the normal path.
  - Implementation notes: do not move `check:security-test-builds`, `check:security-gate-mutations`, classifier gates, census, sink policy, or kovo-check to a slower tier.
  - Evidence to add: CI logs show those gates still ran on the optimized workflow.
- [x] Remove inert `kovo-check` matrix fan-out while keeping the full `kovo-check` suite required.
  - Evidence: `rg "KOVO_SECURITY_PRESET|KOVO_SECURITY_DIALECT" .github packages tests scripts -n` found no consumer except the new negative workflow assertion, so the six-row matrix was repeating the same full suite with inert environment variables. `.github/workflows/ci.yml` now runs one required `vp exec node scripts/kovo-check.mjs compiler-runtime server-browser project` job, still gated by `build` and still consuming `kovo-dist`. Local proof: `vp exec vitest --run packages/conformance-fixtures/src/command-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts`; Ruby YAML parse of `.github/workflows/ci.yml`.

## Acceptance

- [ ] CI wall-clock time improves by at least 25% on two consecutive comparable runs.
  - Evidence to add: before/after run URLs and wall-clock durations for the full CI workflow.
  - Current evidence: optimized run `28562997661` for `f0faf34f4` succeeded in 13m08s (`2026-07-02T03:21:19Z` to `03:34:27Z`) versus baseline `28554909799` at 13m36s. This proves the first two batches were green but not sufficient; the long pole was queued `kovo-check` jobs, with the last shard finishing at `03:34:22Z`.
- [ ] No required proof disappears.
  - Evidence to add: checklist mapping every pre-plan CI job/step to an optimized job/step that still runs on pull requests and `main` pushes.
- [ ] Cache hits are visible and keyed safely.
  - Evidence to add: logs showing Playwright and compiler cache restores, with keys including OS and relevant tool/package versions.
- [ ] Local and workflow syntax checks pass.
  - Evidence to add: `pnpm run check:vp`, `git diff --check`, and a successful GitHub Actions run for the optimized commit.
  - Current evidence: for the starter split, `vp exec vitest --run scripts/ci-shards.test.mjs` passed with 14 tests; `pnpm run check:vp` passed; `git diff --check` passed; Ruby YAML parse passed for `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.github/workflows/race-repeat.yml`, `.github/actions/kovo-setup/action.yml`, and `.github/actions/playwright-install/action.yml`. GitHub Actions evidence still pending.
