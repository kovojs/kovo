# World-class DevEx — release measurement

Status: **measurement infrastructure complete; final all-cadence, ratification, and ordinary Nightly proof pending**

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
- [x] Provide a deterministic authenticated packed-journey runner for default Postgres/PGlite and
      explicit experimental SQLite, preserving bounded redacted failures and recording phases,
      screenshots, accessibility, concepts, install size/time, and dependencies.
  - Evidence: the combined report at `b0bf20b05` exercised both former nine-phase journeys;
    artifact tests prove bounded redacted preservation. The code-owned contract now requires
    create→install→ready→first-200→login→CRUD→ready-warm→check→build→test, whose final-subject run
    remains open below.
- [x] Provide deterministic cold/warm/incremental, ready/edit, RSS, phase-census, and browser-byte
      measurement drivers with a fail-closed ratification schema.
  - Evidence: `scripts/devex-benchmark.mjs`, `kovo-devex-budgets/v8`, and their hostile policy
    fixtures validate the driver and reject invented or unratified authority.
- [x] Inventory public surface and consumer evidence without conflating manifest subpaths,
      TypeScript entrypoints, declarations, or generated-family members.
  - Evidence: at clean exact audit subject `838007981`,
    `node scripts/public-api-inventory.mjs --check` reports 1,873/136/1,640/1,737 and consumer
    classes 105/114/1,892/18/4/416 with 47 excluded
    directories. Built-tree counts are not accepted as the census.
- [x] Enforce a classified DevEx CI budget and bounded PR reports for public surface, docs
      freshness, and speed deltas.
  - Evidence: `pnpm run test:devex-track2` reports 147/147 per-PR and 290/300 ordinary-nightly
    runner-minutes, passes 105/105 focused tests, and validates the always-run fail-closed report
    contract.
  - Cost: the 37-minute cap increase is a bounded hosted-capacity quarantine. Exact-SHA run
    `30772577578` (`dfea1ba6d`) reached the former KF-DEVEX-001/010 listener and KF-DEVEX-005 build
    ceilings while the same run completed comparable SQLite/full-path work in 291–379s.
    G2's post-bind contract and G8's transactional semantics are unchanged. A repeat at these new
    ceilings is a hard stop: instrument and optimize the common path; do not widen them again.
- [x] Isolate hosted ratification from ordinary nightly topology and make release authorization
      select a complete exact-SHA ordinary run rather than a newer ratification-only run.
  - Evidence: `.github/workflows/devex-nightly.yml`, `.github/workflows/release.yml`, and the
    workflow security suites require the four ordinary jobs exactly once; the ratification-only
    path emits and validates exactly the candidate budgets, policy, and three baselines before
    upload, while release authority rejects skipped, duplicate, mismatched, or paginated runs.

## Current known-failure state

All ten entries, including KF-DEVEX-007, are `state: retired` in the register. KF-DEVEX-007's
recorded evidence is the canonical three-sample authenticated packed run. The release candidate
still requires same-manifest full-catalog and all-cadence register reconfirmation; the earlier
retirement does not substitute for that final-subject proof. Hosted ratification and the ordinary
release-authorizing Nightly are separate job topologies and separate evidence.

- [ ] Run both current ten-phase packed journeys against the final canonical manifest and require
      create→install→ready→first-200→login→CRUD→ready-warm→check→build→test, zero undocumented
      environment edits, and zero pinned WCAG 2.2 A/AA axe violations.
- [ ] Run the final full-catalog reproducer from the canonical packed manifest with all 44 copied
      components present, including unimported files; require typecheck/check/build exit 0 and each
      process-tree peak RSS ≤2.0 GiB.
- [ ] Run `node scripts/known-failure-register.mjs --run-available --cadence all` with
      `--packed-manifest .release/packed-packages.json` from that same manifest and require all ten
      entries to report `retired-pass` before closing the final integration ledger.
- [ ] Push a clean ratification seed `S`, collect the benchmark, packed-journey, and full-catalog
      N≥5 artifacts on the accepted runner, review noise/formulas, and commit only justified G2-G4,
      G16, and full-catalog bindings.
  - Workflow success alone does not authorize budget edits. `S` is a measurement subject, not the
    final release candidate.
- [ ] After those bindings land, select final `R`, complete its exact local proof, and require an
      exact-SHA ordinary DevEx Nightly with all four release jobs green.
  - The ratification-only run for `S` cannot authorize `R` because it omits the ordinary job set.
- [ ] Close Track 2 only after the final packed/full-catalog/all-cadence proofs are deterministic,
      all retired entries pass against `R`, hosted budgets are bound and met by `R`'s ordinary
      Nightly, and PR reports remain green.

## Latest accepted evidence

- `node scripts/public-api-inventory.mjs --check` and `node scripts/api-decision-ledger.mjs` passed
  at clean exact audit subject `838007981` on 2026-08-01, with Core 33/target:60 and Server
  116/target:116.
- Prior N=1 smoke measurements prove driver completeness only; they are not ratification evidence.
- Final full-catalog/all-cadence results, hosted N≥5 bindings, and an exact-`R` ordinary Nightly are
  intentionally absent at this checkpoint and remain open above.
