# World-class DevEx — first loop

Status: **implementation complete; final catalog, hosted budgets, and deployment proof pending**

Charter: `plans/worldclass-devex.md` Track 1. Gates: G1-G11 and G15. `SPEC.md` and the
standing rules remain authoritative.

## Completed outcomes

- [x] Derive parsing, help, completion, command references, semantic programmatic requests, and
      0/1/2 exit behavior from one command schema.
  - Evidence: CLI schema/contract/exit suites pass; `packages/cli/src/command-schema.ts` owns all
    14 commands and `site/scripts/cli-ref.mjs` consumes its manifest.
- [x] Make checks source-current and artifacts explicit, authenticated, and fail closed; make
      builds transactional and keep failed redacted debug facts outside deploy output.
  - Evidence: `packages/cli/src/graph-input.test.ts`, source-check, and transactional-output suites
    reject missing/stale/partial/wrong-app proof and preserve the last good `dist`.
- [x] Provide the complete post-bind ready report, loopback-only development origin, automatic
      `/__kovo`, production/static absence, and framework-owned lifecycle/source/build/test
      orchestration with no app-facing `vp` vocabulary.
  - Evidence: focused CLI/dev-server/Better Auth/creator tests plus `check:publish` cover the ready
    facts, local handoff, route boundary, and generated starter scripts.
- [x] Make creator prompts/flags, host posture, SQLite acknowledgement/KV447 output, install-aware
      handoff, public styled starter, and test-bootstrap ordering deterministic.
  - Evidence: creator contract and starter runtime suites cover zero-write SQLite refusal,
    Linux/macOS support, explicit Windows/WSL non-support, public UI/style use, and no internal
    classifier mock.
- [x] Project the seven first-run and top-20 authoring failures through one safe diagnostic record;
      add bounded `doctor` and transactional `add --list|--dry-run|--install` workflows.
  - Evidence: diagnostic-empathy, doctor, and add suites prove cause/anchor/next-step parity,
    credential non-disclosure, zero-write dry run, staged promotion, and unambiguous rollback.

## Remaining proof

- [ ] Run the default Postgres/PGlite and explicit SQLite journeys from the final canonical packed
      manifest through create→install→ready→first-200→login→CRUD→ready-warm→check→build→test,
      with zero undocumented environment edits and zero pinned WCAG 2.2 A/AA axe violations.
- [ ] Reconfirm retired KF-DEVEX-007 on one final canonical packed-manifest run in which the
      44-component copy-in fixture retains unimported files, typechecks, checks, and builds with
      peak RSS ≤2.0 GiB.
  - A below-cap partial run or package-local test does not satisfy this item. After the report
    passes, run `node scripts/known-failure-register.mjs --run-available --cadence all` with
    `--packed-manifest .release/packed-packages.json` against the same manifest and require all ten
    entries to report `retired-pass`.
- [ ] Ratify cold/warm/one-file G4 budgets on a pushed packed seed `S` without dropping any of the
      11 ordered diagnostic-producing phases, then commit reviewed bindings before selecting final
      candidate `R`.
  - Required proof: the ratification-only DevEx Nightly run records a named runner, exact workload
    fingerprint, N≥5 samples, statistic, measured noise, rationale, and threshold formula; the
    resulting bindings land before `R`, whose exact ordinary Nightly run must meet them.
- [ ] Complete one exact-`R` packed create→build→deploy→public-200 journey on Cloud Run.
  - Required proof: the manual G11 artifact binds public URL, exact `R` SHA, build token, retention
    posture, and cleanup. The reviewed `g11-cloud-run` environment and its five GCP variables are
    currently absent; do not create cloud/IAM state without explicit authority.
- [ ] Close Track 1 only when the final packed journeys, KF-DEVEX-007 final-subject
      reconfirmation, all-cadence register run, ratified G2-G4/G16 bindings, exact-`R` ordinary
      Nightly, and G11 are all green.

## Current verification

- Authenticated packed Postgres/PGlite and experimental SQLite journeys at `b0bf20b05` passed the
  former nine-phase contract with zero undocumented environment edits and zero pinned WCAG 2.2
  A/AA axe violations. The current ten-phase contract is
  create→install→ready→first-200→login→CRUD→ready-warm→check→build→test and remains open for
  final-subject reconfirmation.
- Focused command/diagnostic/doctor/add/creator/graph/build tests cover the completed outcomes
  above; `pnpm run check:spec-conformance-closure` at `b865601f1` passed 92 codes, 72 error classes,
  and 204 sites across evidence for 37 files, 108 witnesses, and all 6 mandatory categories.
- Final-candidate full-catalog/all-cadence proof, hosted ratification bindings, exact-`R` ordinary
  Nightly, and external G11 evidence are intentionally not claimed here.
