# v1 Acceptance Ledger

`SPEC.md` section 16 is the normative acceptance contract. This ledger maps each
criterion to repo evidence or an external evidence ledger before v1 freeze; it
does not claim that v1 is complete.

Last ledger audit: 2026-06-11.

## Required Gates

| SPEC §16 criterion           | Required evidence                                                                                                                                                             | Current evidence artifact                                                                                                                             | Status                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 16.1 Perf                    | TTI equivalent to FCP, opt-in prerendered nav under 50ms perceived, and no session-length memory growth across 100 navigations.                                               | `pnpm run test:p10-perf`, driven by `tests/p10-perf.node.mjs`.                                                                                        | ready to run            |
| 16.2 Legibility              | Five outside developers complete the devtools-only study in under 60 seconds per task.                                                                                        | Protocol and dated pending ledger in `docs/legibility-study.md`; no outside results recorded yet.                                                     | pending external study  |
| 16.3 Verifiability           | TypeScript/static checking, `fw check`, graph assertions, and framework-owned browser suites pass; no app-level browser tests are required for the commerce behavior surface. | `pnpm run check`, `pnpm run check:fw`, `pnpm run test:browser`, commerce graph-answerability coverage, and `fw-explain/v1` / `fw-check/v1` snapshots. | ready to run            |
| 16.4 Constitution            | Fixpoint/render-equivalence green; every feature has authorable lowering evidence; `invalidate()` appears only at documented escape-hatch sites.                              | `docs/constitution.md`, `docs/compiler-hard-rules.md`, fixpoint/render-equivalence checks, and an `invalidate()` grep recorded in the acceptance run. | ready to run            |
| 16.5 Coverage                | Every commerce mutation/query pair has an explicit optimistic status and zero unhandled FW310s.                                                                               | Commerce matrix assertions in `examples/commerce/src/app.test.ts` and `fw check` optimistic output.                                                   | ready to run            |
| 16.6 Navigation typed        | Literal hrefs/redirects resolve against the route registry, and a route-path rename breaks links, GET forms, and redirects under `vp check`.                                  | Commerce route/link/redirect checks plus route-rename proof in `packages/runtime/src/index.test.ts`.                                                  | ready to run            |
| 16.7 Declared execution only | `on:load` sites are FW211-justified and isomorphic islands are FW302-justified.                                                                                               | `fw check` diagnostics plus acceptance grep outputs for `on:load`, `FW211`, `isomorphic: true`, and `FW302`.                                          | ready to run            |
| 16.8 Update coverage         | Every query-dependent commerce DOM position has an explicit status and zero unhandled FW311s.                                                                                 | FW311/update-coverage graph assertions and `fw check coverage` output.                                                                                | ready to run            |
| Pre-launch                   | Trademark, domain, npm-scope, and linguistic screens have dated evidence.                                                                                                     | Dated pending ledger in `docs/prelaunch-checklist.md`; no external completion evidence recorded yet.                                                  | pending external checks |

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
pnpm run check:fw
```

Record the date, commit SHA, command output location, and pass/fail result in
this section when the full acceptance run is performed. The current docs-only
audit has not run the full command set.

| Date       | Commit            | Command               | Result  | Notes                                                |
| ---------- | ----------------- | --------------------- | ------- | ---------------------------------------------------- |
| 2026-06-11 | TBD at freeze run | `pnpm run acceptance` | pending | Full clean-checkout acceptance run not yet recorded. |

## Freeze Rule

Do not mark `IMPLEMENT_v1.md` P10 complete until every SPEC §16 row above has
passing dated evidence, `docs/legibility-study.md` contains five dated outside
developer result rows, `docs/prelaunch-checklist.md` contains dated completion
evidence for every external launch check, and the full acceptance command set has
passed from a clean checkout.
