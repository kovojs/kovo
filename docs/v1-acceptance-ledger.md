# v1 Acceptance Ledger

`rules/v1-acceptance.md` is the normative acceptance contract. This ledger maps
each criterion to repo evidence or an external evidence ledger before v1 freeze;
it does not claim that v1 is complete.

Last ledger audit: 2026-06-12.

## Required Gates

| v1 acceptance criterion      | Required evidence                                                                                                                                                               | Current evidence artifact                                                                                                                                   | Status                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 16.1 Perf                    | TTI equivalent to FCP, opt-in prerendered nav under 50ms perceived, and no session-length memory growth across 100 navigations.                                                 | `pnpm run test:p10-perf`, driven by `tests/p10-perf.node.mjs`.                                                                                              | ready to run            |
| 16.2 Legibility              | Five outside developers complete the devtools-only study in under 60 seconds per task.                                                                                          | Protocol and dated pending ledger in `docs/legibility-study.md`; no outside results recorded yet.                                                           | pending external study  |
| 16.3 Verifiability           | TypeScript/static checking, `kovo check`, graph assertions, and framework-owned browser suites pass; no app-level browser tests are required for the commerce behavior surface. | `pnpm run check`, `pnpm run check:kovo`, `pnpm run test:browser`, commerce graph-answerability coverage, and `kovo-explain/v1` / `kovo-check/v1` snapshots. | ready to run            |
| 16.4 Constitution            | Fixpoint/render-equivalence green; every feature has authorable lowering evidence; `invalidate()` appears only at documented escape-hatch sites.                                | `rules/constitution.md`, `rules/compiler-hard-rules.md`, fixpoint/render-equivalence checks, and an `invalidate()` grep recorded in the acceptance run.     | ready to run            |
| 16.5 Coverage                | Every commerce mutation/query pair has an explicit optimistic status and zero unhandled KV310s.                                                                                 | Commerce matrix assertions in `examples/commerce/src/app.test.ts` and `kovo check` optimistic output.                                                       | ready to run            |
| 16.6 Navigation typed        | Literal hrefs/redirects resolve against the route registry, and a route-path rename breaks links, GET forms, and redirects under `vp check`.                                    | Commerce route/link/redirect checks plus route-rename proof in `packages/browser/src/index.test.ts`.                                                        | ready to run            |
| 16.7 Declared execution only | `on:load` sites are KV211-justified and isomorphic islands are KV302-justified.                                                                                                 | `kovo check` diagnostics plus acceptance grep outputs for `on:load`, `KV211`, `isomorphic: true`, and `KV302`.                                              | ready to run            |
| 16.8 Update coverage         | Every query-dependent commerce DOM position has an explicit status and zero unhandled KV311s.                                                                                   | KV311/update-coverage graph assertions and `kovo check coverage` output.                                                                                    | ready to run            |
| Pre-launch                   | Trademark, domain, npm-scope, and linguistic screens have dated evidence.                                                                                                       | Dated pending ledger in `rules/prelaunch-checklist.md`; no external completion evidence recorded yet.                                                       | pending external checks |

## Dated Ledger Audit

This audit records the state of the acceptance evidence packet on 2026-06-12.
It keeps local runnability separate from the external evidence required by the
legibility gate and the Phase 10 pre-launch checklist.

| Date       | Reviewer | Area                         | Evidence inspected                                                                                     | Result                                                                          | Status                                  |
| ---------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-06-12 | TBD      | v1 acceptance map            | Required Gates table in this document against `rules/v1-acceptance.md`.                                | Every v1 acceptance criterion has a row and a named evidence source or ledger.  | ready to run                            |
| 2026-06-12 | TBD      | Outside legibility study     | `docs/legibility-study.md` protocol, pending result rows, dated readiness ledger, and completion rule. | Runnable study packet exists; five outside-developer sessions are not recorded. | pending external study                  |
| 2026-06-12 | TBD      | Pre-launch external checks   | `rules/prelaunch-checklist.md` required checks and evidence ledgers.                                   | Trademark, domain, npm-scope, and linguistic evidence remain missing.           | pending external checks                 |
| 2026-06-12 | Codex    | Local integration acceptance | `pnpm run acceptance` at commit `5e693a7`.                                                             | check, test, browser, build, perf, conformance, and kovo-check gates passed.    | passed local run                        |
| 2026-06-12 | Codex    | Local integration acceptance | `pnpm run acceptance` at commit `036e494`.                                                             | check, test, browser, build, perf, conformance, and kovo-check gates passed.    | passed local run                        |
| 2026-06-12 | Codex    | Local integration acceptance | `pnpm run acceptance` at commit `ec876f5`.                                                             | check, test, browser, build, perf, conformance, and kovo-check gates passed.    | passed local run                        |
| 2026-06-12 | Codex    | Pre-launch ledger honesty    | `rules/prelaunch-checklist.md` Dated Audit Ledger plus the four required evidence ledger sections.     | Evidence packet is reviewable; external launch evidence is still absent.        | packet ready; external evidence pending |

## Acceptance Command Set

Run from a clean checkout before any v1 freeze claim:

```sh
pnpm run acceptance
```

The top-level acceptance script expands to:

```sh
pnpm run check
pnpm run test
pnpm run test:browser
pnpm run check:build
pnpm run test:p10-perf
pnpm run test:conformance
pnpm run check:kovo
```

Record the date, commit SHA, command output location, and pass/fail result in
this section when the full acceptance run is performed. The current ledger has
one passing local integration run; the final freeze run still needs to happen at
the intended v1 commit after external evidence is complete.

| Date       | Commit            | Command               | Result  | Notes                                                                                                                                                  |
| ---------- | ----------------- | --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-12 | `5e693a7`         | `pnpm run acceptance` | passed  | Local round9 integration run passed in terminal output: check, test, browser, build, perf, conformance, kovo-check.                                    |
| 2026-06-12 | `036e494`         | `pnpm run acceptance` | passed  | Local round25 integration run passed in terminal output: check, test, browser, build, perf, conformance, kovo-check. This is not the final freeze run. |
| 2026-06-12 | `ec876f5`         | `pnpm run acceptance` | passed  | Local round28 integration run passed in terminal output: check, test, browser, build, perf, conformance, kovo-check. This is not the final freeze run. |
| TBD        | TBD at freeze run | `pnpm run acceptance` | pending | Final clean-checkout freeze run still required after external legibility and pre-launch evidence.                                                      |

## Final Clean-Checkout Checklist

Use this checklist for the final local acceptance run. Record the resulting
command log path and commit SHA in the Acceptance Command Set table above.

| Step | Command or check                                                         | Evidence required before freeze                                                            | Status  |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------- |
| 1    | Start from a clean worktree at the intended v1 commit.                   | `git status --short --branch` output showing no local changes.                             | pending |
| 2    | `pnpm install --frozen-lockfile` if dependencies changed.                | Install log or note that lockfile/dependency graph was unchanged.                          | pending |
| 3    | `pnpm run acceptance`                                                    | Passing log covering check, test, browser, build, perf, conformance, and kovo-check gates. | pending |
| 4    | `grep -r "invalidate(" examples/commerce packages/create-kovo/templates` | Only documented escape-hatch sites, or an explicit zero-result note.                       | pending |
| 5    | `grep -r "on:load" examples/commerce packages/create-kovo/templates`     | Only KV211-justified sites, or an explicit zero-result note.                               | pending |
| 6    | `git diff --check`                                                       | No whitespace errors after recording final docs evidence.                                  | pending |

## Freeze Rule

Do not close the active v1 cleanup ledger until every v1 acceptance row above has passing dated
evidence, `docs/legibility-study.md` contains five dated outside developer result rows,
`rules/prelaunch-checklist.md` contains dated completion evidence for every external launch check,
and the full acceptance command set has passed from a clean checkout.
