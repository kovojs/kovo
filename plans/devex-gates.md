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

- [ ] Add a versioned machine-readable register for each confirmed baseline defect.
- [ ] Give every entry a stable ID, owner, observed layer, expected-failure probe, retirement
      condition, and scorecard/track owner.
- [ ] Make the register gate fail for missing probes, duplicate IDs, stale paths, or an
      unexpectedly passing probe that was not retired.
- [ ] Reproduce the auth-origin, silent-ready, help-exit, vacuous-check, stale-graph, KV417
      coupling, full-catalog OOM, starter internal mock, placeholder-doc success, and opaque-500
      defects through packed or artifact-level probes.

## Packed journeys

- [ ] Build deterministic packed tarballs for the framework and both starter variants.
- [ ] Run default Postgres/PGlite-dev create→install→ready→first-200→login→CRUD→test→check→build.
- [ ] Run the corresponding explicitly experimental SQLite journey.
- [ ] Preserve failed apps as redacted CI artifacts.
- [ ] Capture styled-UI screenshot and terminal-state accessibility results.
- [ ] Capture concepts encountered before first authenticated CRUD.
- [ ] Capture cold install duration, installed bytes, and direct/transitive dependency counts.
- [ ] Integrate the offline agent journey owned by `plans/devex-agent-loop.md`.

## Benchmark and budgets

- [ ] Add a deterministic benchmark driver for cold, warm, and one-file incremental checks.
- [ ] Record ready, edit-to-diagnostic, edit-to-served-result, phase timings, peak RSS, and browser
      bootstrap bytes.
- [ ] Version the budget schema and reject malformed, invented, or unratified binding budgets.
- [ ] Ratify each numeric gate from a named runner, baseline, target rationale, sample count,
      statistic, measured noise, and threshold formula.

## Inventory and public-surface evidence

- [ ] Exclude nested dependencies, generated/dist/cache trees, packed fixtures, and throwaway apps
      from authored-consumer evidence.
- [ ] Report authored examples, docs, package internals, generated emit, conformance, and tests as
      separate consumer classes.
- [ ] Report manifest subpaths, analyzed TypeScript entrypoints, exported declarations, and
      generated-family members as distinct units.
- [ ] Add hostile fixtures proving excluded files cannot create false consumers.
- [ ] Add the packed all-44-component reproducer while unimported copied files remain on disk.

## CI posture

- [ ] Set a total DevEx CI minute budget and classify every new gate as per-PR, nightly, or manual.
- [ ] Publish bounded PR reports for public surface, docs freshness, and speed deltas.
- [ ] Keep one compact current scorecard-status block in the charter rather than appending
      historical transcripts.
- [ ] Track 2 exit: packed journeys deterministic, known-failure mappings complete, budgets
      ratified, and PR reports visible.

## Latest verification

No implementation checkbox has been closed in this ledger yet.
