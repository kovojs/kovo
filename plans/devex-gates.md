# World-class DevEx — release measurement

Status: **measurement infrastructure complete; final nightly proof and hosted ratification pending**

Charter: `plans/worldclass-devex.md` Track 2. Gates: G1-G4, G10, G12, G14, G16-G18.
Runner-bound measurements are informational until `devex-budgets.json` binds the named runner,
workload, sample count, statistic, noise allowance, rationale, and threshold formula.

## Known-failure ownership

Track 2 owns every reproducer; the named fix track and implementation item own behavior changes.
This literal table is also validated by `scripts/known-failure-register.mjs`.

| ID           | Reproducer | Fix track | Implementation owner                            | Gates  |
| ------------ | ---------- | --------- | ----------------------------------------------- | ------ |
| KF-DEVEX-001 | Track 2    | Track 1   | Track 1 development-origin work item            | G1     |
| KF-DEVEX-002 | Track 2    | Track 1   | Track 1 dev-reporter work item                  | G2     |
| KF-DEVEX-003 | Track 2    | Track 1   | Track 1 help/version exit-contract work item    | G5     |
| KF-DEVEX-004 | Track 2    | Track 1   | Track 1 source-proof work item                  | G7     |
| KF-DEVEX-005 | Track 2    | Track 1   | Track 1 transactional-build work item           | G8     |
| KF-DEVEX-006 | Track 2    | Track 1   | Track 1 source/deployment-proof split work item | G1, G7 |
| KF-DEVEX-007 | Track 2    | Track 1   | Track 1 kovo-add source-closure work item       | G4     |
| KF-DEVEX-008 | Track 2    | Track 5   | Track 5b test-harness batch                     | G24    |
| KF-DEVEX-009 | Track 2    | Track 3   | Track 3 version-matched agent-docs work item    | G13    |
| KF-DEVEX-010 | Track 2    | Track 1   | Track 1 diagnostic-empathy work item            | G9     |

## Completed infrastructure

- [x] Maintain one versioned ten-ID known-failure register with an executable packed/artifact probe,
      owner, observed layer, retirement condition, and gate mapping for every baseline defect.
  - Evidence: `scripts/known-failure-register.json` and its schema/mutation suite reject missing,
    duplicated, stale, or unexpectedly passing entries.
- [x] Run deterministic authenticated packed journeys for default Postgres/PGlite and explicit
      experimental SQLite, preserving bounded redacted failures and recording phases, screenshots,
      accessibility, concepts, install size/time, and dependencies.
  - Evidence: the combined report at `b0bf20b05` passes both nine-phase journeys; artifact tests
    prove bounded redacted preservation.
- [x] Provide deterministic cold/warm/incremental, ready/edit, RSS, phase-census, and browser-byte
      measurement drivers with a fail-closed ratification schema.
  - Evidence: `scripts/devex-benchmark.mjs`, `kovo-devex-budgets/v8`, and their hostile policy
    fixtures validate the driver and reject invented or unratified authority.
- [x] Inventory public surface and consumer evidence without conflating manifest subpaths,
      TypeScript entrypoints, declarations, or generated-family members.
  - Evidence: at clean exact HEAD `260ffd6f5`, `node scripts/public-api-inventory.mjs --check`
    reports 1,873/136/1,640/1,737 and consumer classes 105/114/1,892/18/4/416 with 33 excluded
    directories. Built-tree counts are not accepted as the census.
- [x] Enforce a classified DevEx CI budget and bounded PR reports for public surface, docs
      freshness, and speed deltas.
  - Evidence: `pnpm run test:devex-track2` reports 65/65 per-PR and 290/300 ordinary-nightly
    runner-minutes and validates the always-run fail-closed report contract.
- [x] Isolate hosted ratification from ordinary nightly topology and make release authorization
      select a complete exact-SHA ordinary run rather than a newer ratification-only run.
  - Evidence: `.github/workflows/devex-nightly.yml`, `.github/workflows/release.yml`, and the
    workflow security suites require the four ordinary jobs exactly once and reject skipped,
    duplicate, mismatched, or paginated authority.

## Current known-failure state

All ten entries, including KF-DEVEX-007, are `state: retired` in the register. KF-DEVEX-007's
recorded evidence is the canonical three-sample authenticated packed run. The release candidate
still requires a same-manifest full-catalog and nightly reconfirmation; the earlier retirement
does not substitute for that final-subject proof.

- [ ] Run the final full-catalog reproducer from the canonical packed manifest with all 44 copied
      components present, including unimported files; require typecheck/check/build exit 0 and each
      process-tree peak RSS ≤2.0 GiB.
- [ ] Run `pnpm run test:devex-known-failures-nightly` from that same manifest and require all ten
      entries to report `retired-pass` before closing the final integration ledger.
- [ ] Ratify G2-G4, G16, and full-catalog thresholds from the final hosted workload with N≥5.
  - Dispatch only the reviewed ratification path. Review the artifact and threshold derivation;
    workflow success alone does not authorize budget edits.
- [ ] Close Track 2 only after the final packed/nightly proofs are deterministic, all retired
      entries pass against the final subject, hosted budgets are bound, and PR reports remain
      green.

## Latest accepted evidence

- `node scripts/public-api-inventory.mjs --check` and `node scripts/api-decision-ledger.mjs` passed
  in the clean exact-HEAD worktree on 2026-08-01.
- Prior N=1 smoke measurements prove driver completeness only; they are not ratification evidence.
- Final full-catalog/nightly results and hosted N≥5 evidence are intentionally absent at this
  checkpoint and remain open above.
