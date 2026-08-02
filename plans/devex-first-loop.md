# World-class DevEx — first loop

Status: **implementation complete; final catalog, hosted budget, and deployment proof pending**

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

- [ ] Reconfirm retired KF-DEVEX-007 on one final canonical packed-manifest run in which the
      44-component copy-in fixture retains unimported files, typechecks, checks, and builds with
      peak RSS ≤2.0 GiB.
  - A below-cap partial run or package-local test does not satisfy this item. After the report
    passes, run `pnpm run test:devex-known-failures-nightly` against the same manifest and require
    `retired-pass`.
- [ ] Ratify and meet cold/warm/one-file G4 budgets on the final packed workload without dropping
      any of the 11 ordered diagnostic-producing phases.
  - Required proof: the hosted ratification-only DevEx Nightly run records a named runner, exact
    workload fingerprint, N≥5 samples, statistic, measured noise, rationale, and reviewed threshold
    formula in `devex-budgets.json`.
- [ ] Complete one packed create→build→deploy→public-200 journey on Cloud Run.
  - Required proof: the manual G11 artifact binds public URL, source SHA, build token, retention
    posture, and cleanup. The reviewed `g11-cloud-run` environment and its five GCP variables are
    currently absent; do not create cloud/IAM state without explicit authority.
- [ ] Close Track 1 only when the final packed journeys, KF-DEVEX-007 final-subject
      reconfirmation, ratified G2-G4 and G16 budgets, and G11 are all green.

## Current verification

- Authenticated packed Postgres/PGlite and experimental SQLite journeys at `b0bf20b05` pass all
  nine phases with zero undocumented environment edits and zero pinned WCAG 2.2 A/AA axe
  violations.
- Focused command/diagnostic/doctor/add/creator/graph/build tests cover the completed outcomes
  above; `pnpm run check:spec-conformance-closure` reports 92 codes and 72 error classes.
- Final-candidate full-catalog/nightly, hosted ratification, and external G11 evidence are
  intentionally not claimed here.
