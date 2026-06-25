# Better Testing Infrastructure

**Date:** 2026-06-25
**Scope:** CI job topology, test sharding, assertion quality, and maintainability for the GitHub
`CI` workflow.
**Goal:** completed CI should return useful pass/fail feedback in about 5 minutes, with required
jobs normally between 2 and 5 minutes. Jobs below 2 minutes should be consolidated where that does
not hide signal; jobs above 5 minutes should be split or moved behind a narrower trigger. Required
CI must use at most 16 concurrent jobs so GitHub Actions headroom remains available for Pages,
reruns, and other workflows.

## Current Evidence

Measured with `gh run list --workflow CI --status completed --limit 12` and `gh run view --json jobs`
on the 12 most recent fully completed CI runs, excluding the in-progress run at
`2026-06-25T05:58:08Z`.

| Run                                                                    | Result  | Wall time | Notes                    |
| ---------------------------------------------------------------------- | ------- | --------: | ------------------------ |
| [28145146883](https://github.com/kovojs/kovo/actions/runs/28145146883) | failure |    17m32s | `integration` ran 17m21s |
| [28136545956](https://github.com/kovojs/kovo/actions/runs/28136545956) | failure |    12m28s | `integration` ran 12m17s |
| [28135495606](https://github.com/kovojs/kovo/actions/runs/28135495606) | success |    11m31s | green baseline           |
| [28134536706](https://github.com/kovojs/kovo/actions/runs/28134536706) | failure |    11m56s | `integration` ran 11m49s |
| [28134330476](https://github.com/kovojs/kovo/actions/runs/28134330476) | failure |    12m29s | `integration` ran 12m20s |
| [28133702807](https://github.com/kovojs/kovo/actions/runs/28133702807) | failure |    12m52s | `integration` ran 12m44s |
| [28133678709](https://github.com/kovojs/kovo/actions/runs/28133678709) | success |    12m00s | green baseline           |
| [28133134501](https://github.com/kovojs/kovo/actions/runs/28133134501) | success |    12m11s | green baseline           |
| [28131999039](https://github.com/kovojs/kovo/actions/runs/28131999039) | success |    14m39s | `integration` ran 14m32s |
| [28131488093](https://github.com/kovojs/kovo/actions/runs/28131488093) | success |    12m27s | green baseline           |
| [28131388297](https://github.com/kovojs/kovo/actions/runs/28131388297) | failure |    12m43s | failure baseline         |
| [28131373869](https://github.com/kovojs/kovo/actions/runs/28131373869) | failure |    12m22s | failure baseline         |

Median job durations across those runs:

| Job                                                                                             |      Median |    Max | Read                                         |
| ----------------------------------------------------------------------------------------------- | ----------: | -----: | -------------------------------------------- |
| `integration`                                                                                   |      12m11s | 17m21s | primary blocker; must shard                  |
| `test (3, 4)`                                                                                   |       3m48s |  5m10s | acceptable median, occasional over-budget    |
| `kovo-check (server-browser)`                                                                   |       2m58s |  3m54s | healthy                                      |
| `test (1, 4)` / `(2, 4)` / `(4, 4)`                                                             | 1m32s-2m43s |  4m43s | shard 4 is too short; matrix is imbalanced   |
| `conformance (drizzle-pin)`                                                                     |       2m19s |  3m40s | healthy as a standalone shard                |
| `browser`, `gallery-browser`, `publish-check`, `format`                                         | 1m07s-1m33s |  2m57s | useful signal but too short as separate jobs |
| `p10-perf`, `compiler-perf`, `sql-safety`, `api-surface`, small conformance, small `kovo-check` | 0m21s-0m55s |  1m58s | runner overhead dominates                    |

## Target CI Topology

- [x] **Cap required CI at 16 concurrent jobs.**
  - Treat 16 required jobs, excluding the final zero-work aggregator, as the hard topology budget.
  - Reserve the remaining Free-plan concurrency headroom for `pages.yml`, reruns, queued pushes, and
    occasional GitHub scheduling jitter.
  - Prefer consolidation over adding a 17th required job; if a new required check needs a slot, merge
    or retire another slot first.
  - Evidence when complete: the workflow graph has no more than 16 required jobs runnable before the
    final aggregator.
  - Evidence 2026-06-25: local workflow assertion counted exactly 16 required slots before `check`;
    `.github/workflows/ci.yml` parses with Ruby Psych.

- [x] **Prohibit hand-maintained shard file lists.**
  - Use native runner sharding (`vitest --shard`, Playwright `--shard`), stable logical suites, or
    deterministic ephemeral shard manifests generated during CI.
  - Do not maintain manually curated lists like "these 37 specs are shard 1"; they drift and make test
    movement expensive.
  - Logical suites are allowed when they are intuitive ownership groups, for example `integration:data`,
    `integration:browser`, `integration:security`, or conformance package groups.
  - Ephemeral generated manifests are allowed only when the generator discovers the current test set,
    reads machine-generated timing history, writes manifests under `$RUNNER_TEMP`, and validates that
    every discovered test appears exactly once.
  - Evidence when complete: CI sharding is expressed as native shard counts or named suite commands,
    with no checked-in per-shard spec-file manifests.
  - Evidence 2026-06-25: CI uses generated root Vitest manifests under `$RUNNER_TEMP/kovo-shards`,
    native Playwright `--shard=1..5/5`, and named conformance/kovo-check suite groups; no checked-in
    shard manifest files were added.

- [ ] **Add deterministic generated shard support.**
  - Create a shared script, likely `scripts/ci-shards.mjs`, that can generate per-job shard manifests
    under `$RUNNER_TEMP/kovo-shards`.
  - The script must discover tests at runtime, load a machine-generated duration history when present,
    and fall back to deterministic path-based/default-duration balancing when history is absent.
  - Use the Longest Processing Time first algorithm: sort discovered test files by estimated duration
    descending, then assign each file to the currently lightest shard; sort files within each shard for
    stable logs.
  - Unknown tests should receive a conservative default duration, such as the suite p75 or median when
    p75 is unavailable.
  - The script must fail if a discovered test is missing, duplicated, or assigned outside the requested
    shard count.
  - Matrix jobs should generate manifests locally from the same deterministic inputs and then run only
    their own manifest; do not add a serial `prepare-shards` job unless discovery becomes expensive
    enough to justify the added critical-path dependency.
  - Evidence when complete: unit tests for bin packing, unknown-duration fallback, and duplicate/missing
    validation, plus a CI run showing generated shard files are created only under `$RUNNER_TEMP`.
  - Progress 2026-06-25: `scripts/ci-shards.mjs` implements LPT generation, fallback estimates,
    assignment validation, and history merging; focused tests cover the algorithm and validation. The
    remaining checkbox evidence is a completed CI run proving `$RUNNER_TEMP` manifest creation.

- [ ] **Persist timing history as a machine-generated artifact.**
  - Add a reporter or post-processing step that emits per-file durations for root Vitest and Playwright
    integration suites.
  - Upload the latest timing history as a CI artifact, and let shard jobs download the newest successful
    `main` artifact when available.
  - Update estimates with a rolling average, for example `next = 0.7 * previous + 0.3 * latest`, so one
    slow runner does not reshuffle the suite too aggressively.
  - Key Playwright durations by project plus file when multiple browser projects run the same spec.
  - Evidence when complete: uploaded timing artifact, documented JSON shape, and a local merge test for
    old/new duration histories.
  - Progress 2026-06-25: CI uploads per-shard root and integration timing artifacts shaped as
    `{ "<project:file or file>": { "seconds": number } }`, and `scripts/ci-shards.test.mjs` covers
    rolling history merge. The remaining checkbox evidence is a completed CI artifact upload.

- [x] **Add a CI timing report script.**
  - Produce a checked-in script, likely `scripts/ci-timing-report.mjs`, that can summarize the last
    N completed CI runs by workflow wall time and job duration.
  - It must exclude `in_progress`/`queued` runs, include both success and failure conclusions, and print
    jobs outside the 2-5 minute target.
  - Evidence when complete: command output from the script against recent completed GitHub runs and a
    unit test for duration bucketing.
  - Evidence 2026-06-25: `node scripts/ci-timing-report.mjs --limit 3` reported completed CI runs
    `28150112422`, `28145146883`, and `28136545956`, including jobs outside the 2-5 minute target;
    focused Vitest coverage proves duration bucketing and summary formatting.

- [ ] **Shard `integration` into five CI jobs first.**
  - Replace the single `integration` job with a five-job matrix.
  - Start at five shards because recent `integration` runs are p50 12m11s and max 17m21s; five-way
    sharding should fit the 5-minute target while staying inside the 16-job total budget.
  - Prefer generated ephemeral manifests once `scripts/ci-shards.mjs` and timing artifacts exist; until
    then, use Playwright native sharding as the simple transition path.
  - Keep `fail-fast: false`, the current browser install rule from `rules/github-workflows.md`, and the
    current final `check` aggregator.
  - First target: every integration shard lands between 2 and 5 minutes on three consecutive completed
    CI runs.
  - Evidence when complete: three completed GitHub CI runs showing all integration shards green and no
    integration shard above 5 minutes.

- [ ] **Balance integration shards with measured per-spec durations if native Playwright sharding is uneven.**
  - Add a lightweight reporter that writes per-spec durations as a CI artifact.
  - If any integration shard stays above 5 minutes or below 2 minutes after five-way sharding, adjust
    the generated shard count, native shard count, or logical-suite grouping.
  - Do not introduce checked-in per-spec shard manifests; manual shard ownership is not worth the
    maintenance cost.
  - Evidence when complete: timing artifact plus a before/after generated-shard or logical-suite table.

- [ ] **Rebalance the root `vitest --shard=1/4` matrix.**
  - `test (3, 4)` is the long shard and `test (4, 4)` is often below 2 minutes.
  - Try generated ephemeral manifests first once duration history exists; otherwise try three native
    shards or keep four native shards, then pick the smallest shard count that keeps each root test job
    in the 2-5 minute band.
  - Do not use manually maintained root-test file lists.
  - Evidence when complete: three completed CI runs with root test shards in range and no loss of test
    coverage.

- [ ] **Consolidate very short static/safety gates into balanced jobs.**
  - Candidate grouping: `format` + `api-surface` + `sql-safety` + `compiler-perf`.
  - Preserve failure clarity by naming steps clearly and leaving command output intact.
  - Do not combine this with browser or integration gates; those have different setup and failure modes.
  - Evidence when complete: consolidated job duration is 2-5 minutes and individual step failures remain
    readable in a failed GitHub run.

- [ ] **Consolidate small conformance shards without burying `drizzle-pin`.**
  - Keep `drizzle-pin` standalone unless timings show it can absorb one tiny suite and stay below 5
    minutes.
  - Group `better-auth-pin`, `auth-spike`, `webhook-spike`, and `app-shell-spike` into one or two
    balanced conformance jobs instead of four sub-minute jobs.
  - Evidence when complete: conformance jobs land in the 2-5 minute band on three completed CI runs.

- [ ] **Consolidate tiny `kovo-check` shards.**
  - Keep `server-browser` standalone while it is near 3 minutes.
  - Combine `compiler-runtime` and `project`, or run the default all-suite command if it stays below 5
    minutes after artifact download.
  - Evidence when complete: `kovo-check` jobs are in range and still use the `build` artifact rather
    than rebuilding dist.

- [ ] **Evaluate combining `browser` and `gallery-browser` setup.**
  - Both jobs install Playwright/browser assets and are below 2 minutes on median.
  - Combine only if one job can run both suites in 2-5 minutes without making cross-browser failures
    harder to identify.
  - Evidence when complete: combined browser job timing plus a deliberately failed browser assertion or
    log sample proving the failing suite is obvious.

- [ ] **Keep the `build` dependency path explicit.**
  - `build` is short, but it feeds `p10-perf` and `kovo-check`; do not hide it inside an unrelated job
    unless downstream artifact reuse remains clear.
  - Evidence when complete: CI graph still has one authoritative `kovo-dist` producer and downstream jobs
    download that artifact.

- [ ] **Move optional slow breadth checks out of required PR feedback if new checks push wall time above
      5 minutes.**
  - Keep required PR checks focused on correctness gates needed before merge.
  - Use scheduled or manual workflows for stress repeats, expanded browser matrices, and broad perf
    sweeps that cannot fit the 5-minute target.
  - Evidence when complete: required CI is under target and non-required breadth checks still run on a
    documented cadence.

## Assertion And Harness Quality

- [x] **Turn flaky retry passes into a hard CI failure.**
  - `tests/integration/playwright.config.ts` already has a flaky reporter and `KOVO_FAIL_ON_FLAKY`.
  - Set the env var in CI so retry-passed tests cannot disappear inside a green run.
  - Evidence when complete: a controlled flaky fixture or reporter unit test proves retry-passed exits
    non-zero in CI mode.
  - Evidence 2026-06-25: `.github/workflows/ci.yml` sets `KOVO_FAIL_ON_FLAKY=1` on the integration
    matrix; `tests/flaky-reporter.meta.test.ts` proves a retry-passed flaky outcome calls
    `process.exit(1)`.

- [ ] **Add a scheduled race-prone repeat workflow or job.**
  - Run a curated list of cross-tab, streaming, optimistic, and morph tests with `--repeat-each=3`.
  - Keep it non-required unless the measured runtime fits the 5-minute required budget.
  - Evidence when complete: scheduled workflow run URL and a documented logical-suite selection, not a
    hand-maintained per-spec shard list.

- [ ] **Define assertion tiers for integration specs.**
  - Tier 1: semantic user-visible assertions through `@kovojs/test` page helpers.
  - Tier 2: protocol/header assertions for wire contracts.
  - Tier 3: generated artifact/internal ABI assertions only when the public behavior cannot expose the
    contract.
  - Evidence when complete: a short guide in `tests/integration/README.md` and at least three converted
    brittle specs.

- [ ] **Reduce hand-authored lowered-IR coverage in favor of app-authored TSX fixtures.**
  - SPEC.md §5.2 treats hand-authored lowered IR as invalid app source; integration tests should cover
    app-authored TSX for public behavior and reserve internal IR fixtures for compiler-unit tests.
  - Start with `counter`, `optimistic-success`, and one query-backed fixture.
  - Evidence when complete: those fixtures exercise compiler-emitted wiring without direct
    `@kovojs/*/internal` client imports.

- [x] **Add a test-inventory meta-test.**
  - Assert every integration spec has an owner axis (`compiler`, `server`, `browser`, `data`, `security`,
    `a11y`, `perf`) and intended CI tier (`required`, `scheduled`, `local-only`).
  - Use the inventory to decide shard groupings and to prevent accidental growth of the required slow
    path.
  - Evidence when complete: failing meta-test for an unclassified spec and passing inventory for the
    current suite.
  - Evidence 2026-06-25: `tests/integration/spec-inventory.ts` classifies every current integration spec
    by owner axis and tier, and `tests/integration-inventory.meta.test.ts` asserts both full-suite
    coverage and fail-closed behavior for `new-unknown-behavior.spec.ts`.

- [x] **Centralize repeated wire/header assertions.**
  - Move repeated checks for `Set-Cookie`, CSRF, cache headers, `Kovo-*` protocol headers, and fragment
    content types into helper assertions under `packages/test/src`.
  - Keep helpers behavior-oriented; avoid helpers that merely snapshot implementation details.
  - Evidence when complete: at least five specs use the helpers and the helper tests cover failure
    messages.
  - Evidence 2026-06-25: `mutation-response-headers`, `mutation-prg-no-js`, `query-args-search`,
    `respond-file`, and `storage-download-route` specs use `@kovojs/test/headers`; helper tests passed,
    and the five converted specs passed under Chromium.

- [ ] **Keep semantic snapshots narrow and audited.**
  - Continue using semantic snapshots only where DOM shape is the behavior.
  - Prefer explicit role/text/state assertions for workflows; snapshot allowlist drift should remain
    covered by `tests/snapshot-allowlist.meta.test.ts`.
  - Evidence when complete: one snapshot-heavy spec converted to explicit assertions and the meta-test
    remains green.

- [x] **Add assertion failure message quality checks for custom helpers.**
  - Custom assertions should say what behavior failed, show the received wire/header/DOM fragment, and
    avoid opaque deep-equality dumps for large HTML.
  - Evidence when complete: helper unit tests include at least one expected failure message.
  - Evidence 2026-06-25: `packages/test/src/assertions.test.ts` asserts expected failure messages for
    optimistic prediction mismatches and typed mutation error mismatches; `vp exec vitest --run
packages/test/src/assertions.test.ts packages/test/src/headers.test.ts --reporter=dot` passed.

- [ ] **Codify when package-internal imports are allowed in tests.**
  - Unit tests may import internals to lock implementation invariants.
  - Cross-package integration tests should import public app APIs unless the test is explicitly about a
    generated/internal ABI.
  - Evidence when complete: documented rule plus a meta-test or lint check for
    `tests/integration/**` internal imports with an allowlist.
  - Progress 2026-06-25: `tests/integration/README.md` documents the rule for integration specs, and
    `tests/integration-import-boundary.meta.test.ts` enforces allowlisted non-harness internal imports
    in `tests/integration/specs/**`. Fixture app-source imports remain open under the lowered-IR/public
    fixture migration item.

## Latest Verification

- Focused Vitest gate passed: `scripts/ci-shards.test.mjs`, `scripts/ci-timing-report.test.mjs`,
  and `tests/flaky-reporter.meta.test.ts` (9 tests).
- `vp exec vitest --run tests/integration-import-boundary.meta.test.ts --reporter=dot` passed.
- `vp exec vitest --run tests/integration-inventory.meta.test.ts --reporter=dot` passed.
- `vp exec vitest --run packages/test/src/assertions.test.ts packages/test/src/headers.test.ts
--reporter=dot` passed (12 tests).
- `vp exec playwright test --config tests/integration/playwright.config.ts --project=chromium
tests/integration/specs/mutation-response-headers.spec.ts
tests/integration/specs/mutation-prg-no-js.spec.ts tests/integration/specs/query-args-search.spec.ts
tests/integration/specs/respond-file.spec.ts tests/integration/specs/storage-download-route.spec.ts`
  passed (8 tests).
- CI-mode shard generation with `RUNNER_TEMP="$(mktemp -d)"` wrote the selected manifest under
  `$RUNNER_TEMP/kovo-shards`.
- `node scripts/ci-timing-report.mjs --limit 3` successfully summarized the latest three completed CI
  runs and printed out-of-target jobs.
- `ruby -e 'require "psych"; Psych.load_file(".github/workflows/ci.yml")'`,
  `node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))'`, and `git diff --check`
  passed.

## Acceptance Gates

- [ ] **CI runtime gate:** three consecutive completed required CI runs finish in 5 minutes or less, with
      no required job except the final aggregator below 2 minutes or above 5 minutes.
- [ ] **Signal gate:** a failed static check, failed conformance test, failed browser test, and failed
      integration shard each identify the failing suite/spec from the GitHub job list and first visible log
      page.
- [ ] **Maintainability gate:** new integration tests have inventory metadata, use public app APIs by
      default, and use shared assertion helpers for common wire/header contracts.
- [ ] **No coverage regression gate:** the final `check` job still depends on every required shard and
      fails on any failure, cancellation, or skipped required job.
