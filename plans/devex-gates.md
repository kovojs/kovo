# World-class DevEx — release measurement

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 2. Gates: G1-G4, G10, G12, G14, G16-G18.
Measurements are informational until `devex-budgets.json` records their runner, sample count,
statistic, noise allowance, rationale, and binding threshold.

## Known failures

The baseline ID denominator is closed and ownership is explicit: Track 2 owns each packed
reproducer, while the named implementation work item owns retirement.

| ID           | Reproducer owner | Fix track | Implementation owner                            | Gates  |
| ------------ | ---------------- | --------- | ----------------------------------------------- | ------ |
| KF-DEVEX-001 | Track 2          | Track 1   | Track 1 development-origin work item            | G1     |
| KF-DEVEX-002 | Track 2          | Track 1   | Track 1 dev-reporter work item                  | G2     |
| KF-DEVEX-003 | Track 2          | Track 1   | Track 1 help/version exit-contract work item    | G5     |
| KF-DEVEX-004 | Track 2          | Track 1   | Track 1 source-proof work item                  | G7     |
| KF-DEVEX-005 | Track 2          | Track 1   | Track 1 transactional-build work item           | G8     |
| KF-DEVEX-006 | Track 2          | Track 1   | Track 1 source/deployment-proof split work item | G1, G7 |
| KF-DEVEX-007 | Track 2          | Track 1   | Track 1 kovo-add source-closure work item       | G4     |
| KF-DEVEX-008 | Track 2          | Track 5   | Track 5b test-harness batch                     | G24    |
| KF-DEVEX-009 | Track 2          | Track 3   | Track 3 version-matched agent-docs work item    | G13    |
| KF-DEVEX-010 | Track 2          | Track 1   | Track 1 diagnostic-empathy work item            | G9     |

- [x] Add a versioned machine-readable register for each confirmed baseline defect.
  - Evidence: `scripts/known-failure-register.json` contains the closed ten-ID baseline under
    `known-failures/v1`.
- [x] Give every entry a stable ID, owner, observed layer, expected-failure probe, retirement
      condition, and scorecard/track owner.
  - Evidence: `pnpm run test:devex-foundation-schema` validates all ten rows and reports no
    pending reproducer.
- [x] Make the register gate fail for missing probes, duplicate IDs, stale paths, or an
      unexpectedly passing probe that was not retired.
  - Evidence: `scripts/known-failure-register.test.mjs` passes its schema, path, classifier, and
    retirement mutation cases.
- [x] Reproduce the auth-origin, silent-ready, help-exit, vacuous-check, stale-graph, KV417
      coupling, full-catalog OOM, starter internal mock, placeholder-doc success, and opaque-500
      defects through packed or artifact-level probes.
  - Evidence: `pnpm run test:devex-known-failures-available` returns retired-pass for
    KF-DEVEX-001-006 and KF-DEVEX-008-010; only nightly KF-DEVEX-007 remains expected-failing.

## Packed journeys

- [x] Build deterministic packed tarballs for the framework and both starter variants.
  - Evidence: `node scripts/pack-public-packages.mjs` authenticated all 14 packages before the
    two exact journey runs.
- [x] Run default Postgres/PGlite-dev create→install→ready→first-200→login→CRUD→test→check→build.
  - Evidence: the combined packed report at commit `b0bf20b05` passes all nine Postgres phases.
- [x] Run the corresponding explicitly experimental SQLite journey.
  - Evidence: the combined packed report at commit `b0bf20b05` passes all nine SQLite phases.
- [x] Preserve failed apps as redacted CI artifacts.
  - Evidence: diagnosed journey failures produced bounded, redacted failure manifests;
    `scripts/golden-journey/artifacts.test.mjs` proves the preservation contract.
- [x] Capture styled-UI screenshot and terminal-state accessibility results.
  - Evidence: both exact reports contain authenticated screenshots and zero axe violations across
    login and authenticated-CRUD states.
- [x] Capture concepts encountered before first authenticated CRUD.
  - Evidence: both exact reports separate imports, bindings, config keys, creator flags, prompts,
    and environment edits; both record zero environment edits.
- [x] Capture cold install duration, installed bytes, and direct/transitive dependency counts.
  - Evidence: both exact reports record install time/RSS, physical bytes/files, and direct plus
    transitive production dependency counts.
- [ ] Integrate the offline agent journey owned by `plans/devex-agent-loop.md`.
  - The authenticated packed runner and adversarial fixture are present; the child ledger records
    the remaining structured-diagnostic integration dependency and proving command.

## Benchmark and budgets

- [x] Add a deterministic benchmark driver for cold, warm, and one-file incremental checks.
  - Evidence: the authenticated N=1 packed smoke in Latest verification proves the v3 cold,
    warm-prime/timed, and changed-revision incremental phase census with direct CLI duration/RSS.
- [x] Record ready, edit-to-diagnostic, edit-to-served-result, phase timings, peak RSS, and browser
      bootstrap bytes.
  - Evidence: the authenticated N=1 command in Latest verification records all eleven benchmark
    metrics and binds ready/edit observations to exact response, diagnostic, and source digests.
- [x] Version the budget schema and reject malformed, invented, or unratified binding budgets.
  - Evidence: `pnpm run test:devex-foundation-schema` validates `kovo-devex-budgets/v5` and its
    hostile ratification fixtures while reporting all 16 metrics as unratified.
- [ ] Ratify each numeric gate from a named runner, baseline, target rationale, sample count,
      statistic, measured noise, and threshold formula.

## Inventory and public-surface evidence

- [x] Exclude nested dependencies, generated/dist/cache trees, packed fixtures, and throwaway apps
      from authored-consumer evidence.
  - Evidence: the foundation inventory reports 47 excluded directories and passes the reviewed
    exclusion policy.
- [x] Report authored examples, docs, package internals, generated emit, conformance, and tests as
      separate consumer classes.
  - Evidence: the inventory reports 90/128/154/18/4/456 files across the six classes.
- [x] Report manifest subpaths, analyzed TypeScript entrypoints, exported declarations, and
      generated-family members as distinct units.
  - Evidence: the current census separates 1,839 manifest subpaths, 102 TypeScript entrypoints,
    1,849 exported declarations, and 1,737 generated-family members.
- [x] Add hostile fixtures proving excluded files cannot create false consumers.
  - Evidence: `scripts/public-api-inventory.test.mjs` passes nested dependency, generated/cache,
    packed-app, and throwaway-app hostile cases.
- [x] Add the packed all-44-component reproducer while unimported copied files remain on disk.
  - Evidence: executable KF-DEVEX-007 materializes the attested packed release, copies all 44
    components, retains unimported files, and reproduces the bounded memory failure.

## CI posture

- [x] Set a total DevEx CI minute budget and classify every new gate as per-PR, nightly, or manual.
  - Evidence: `pnpm run test:devex-track2` reports 65/65 per-PR and 290/300 nightly
    runner-minutes and validates every declared gate against its workflow.
- [x] Publish bounded PR reports for public surface, docs freshness, and speed deltas.
  - Evidence: `pnpm run test:devex-track2` proves the always-run, fail-closed
    `kovo-devex-pr-report/v1` workflow and renderer.
- [x] Keep one compact current scorecard-status block in the charter rather than appending
      historical transcripts.
  - Evidence: `plans/worldclass-devex.md` carries one replace-in-place current-status paragraph
    immediately above the atomic scorecard.
- [ ] Track 2 exit: packed journeys deterministic, known-failure mappings complete, budgets
      ratified, and PR reports visible.

## Latest verification

- `pnpm run test:devex-foundation-schema` passed (4 files, 51 tests), reporting 1,839 public
  subpaths, 1,849 exported declarations, 47 excluded directories, and a complete ten-ID register.
- `pnpm run test:devex-known-failures-available` passed: nine retired behaviors pass,
  nightly KF-DEVEX-007 remains the sole expected failure, and executable closure is complete.
- Exact authenticated packed journeys at `b0bf20b05` passed for Postgres/PGlite and SQLite,
  including login, enhanced CRUD, test, check, controlled-retention build, screenshot, and a11y.
- `pnpm exec vitest run scripts/fcp-harness.test.mjs` passed (17 tests).
- `node scripts/devex-benchmark.mjs --scenario .release/devex/kovo-packed-scenario.json --samples 1`
  authenticated commit `f65c080ac`: cold 10,069.35 ms / 2,173,337,600 bytes; warm 9,548.86 ms /
  2,282,389,504 bytes; incremental 9,809.03 ms / 2,275,278,848 bytes; ready
  6,528.73/6,608.75 ms cold/warm; edit-to-diagnostic 1,063.01 ms; edit-to-served-result 1,032.01
  ms; bootstrap 2,173 bytes. This proves the drivers only and is not ratification evidence.
- `pnpm run check:publish` rebuilt, packed, inspected, and attested all 14 public packages; it
  validated 3,096 classified documentation samples and the packed CLI consumer installed with 265
  production dependencies and zero advisories.
