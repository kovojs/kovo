# v1 Acceptance Rule

This file is the standing v1 release gate. The dated evidence ledger lives in
`docs/v1-acceptance-ledger.md`.

## Required Gates

| Criterion                    | Required evidence                                                                                                                                                               | Current evidence artifact                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.1 Perf                    | TTI equivalent to FCP, opt-in prerendered navigation under 50ms perceived, and no session-length memory growth across 100 navigations.                                          | `pnpm run test:p10-perf`, driven by `tests/p10-perf.node.mjs`.                                                                                              |
| 16.2 Legibility              | Five outside developers complete the devtools-only study in under 60 seconds per task.                                                                                          | Protocol and dated pending ledger in `docs/legibility-study.md`.                                                                                            |
| 16.3 Verifiability           | TypeScript/static checking, `kovo check`, graph assertions, and framework-owned browser suites pass; no app-level browser tests are required for the commerce behavior surface. | `pnpm run check`, `pnpm run check:kovo`, `pnpm run test:browser`, commerce graph-answerability coverage, and `kovo-explain/v1` / `kovo-check/v1` snapshots. |
| 16.4 Constitution            | Fixpoint/render-equivalence green; every feature has authorable lowering evidence; `invalidate()` appears only at documented escape-hatch sites.                                | `rules/constitution.md`, `rules/compiler-hard-rules.md`, fixpoint/render-equivalence checks, and an `invalidate()` grep recorded in the acceptance run.     |
| 16.5 Coverage                | Every commerce mutation/query pair has an explicit optimistic status and zero unhandled KV310s.                                                                                 | Commerce matrix assertions in `examples/commerce/src/app.test.ts` and `kovo check` optimistic output.                                                       |
| 16.6 Navigation typed        | Literal hrefs/redirects resolve against the route registry, and a route-path rename breaks links, GET forms, and redirects under `vp check`.                                    | Commerce route/link/redirect checks plus route-rename proof in `packages/runtime/src/index.test.ts`.                                                        |
| 16.7 Declared execution only | `on:load` sites are KV211-justified and isomorphic islands are KV302-justified.                                                                                                 | `kovo check` diagnostics plus acceptance grep outputs for `on:load`, `KV211`, `isomorphic: true`, and `KV302`.                                              |
| 16.8 Update coverage         | Every query/state-dependent DOM position in the commerce app has an explicit status (`plan`, `isomorphic`, `fragment`, or `renderOnce`) with zero unhandled KV311s.             | KV311/update-coverage graph assertions and `kovo check coverage` output.                                                                                    |
| Pre-launch                   | Trademark, domain, npm-scope, and linguistic screens have dated evidence.                                                                                                       | Dated pending ledger in `rules/prelaunch-checklist.md`.                                                                                                     |

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

## Final Clean-Checkout Checklist

Use this checklist for the final local acceptance run. Record the resulting
command log path and commit SHA in `docs/v1-acceptance-ledger.md`.

| Step | Command or check                                                         | Evidence required before freeze                                                            |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1    | Start from a clean worktree at the intended v1 commit.                   | `git status --short --branch` output showing no local changes.                             |
| 2    | `pnpm install --frozen-lockfile` if dependencies changed.                | Install log or note that lockfile/dependency graph was unchanged.                          |
| 3    | `pnpm run acceptance`                                                    | Passing log covering check, test, browser, build, perf, conformance, and kovo-check gates. |
| 4    | `grep -r "invalidate(" examples/commerce packages/create-kovo/templates` | Only documented escape-hatch sites, or an explicit zero-result note.                       |
| 5    | `grep -r "on:load" examples/commerce packages/create-kovo/templates`     | Only KV211-justified sites, or an explicit zero-result note.                               |
| 6    | `git diff --check`                                                       | No whitespace errors after recording final docs evidence.                                  |

## Freeze Rule

Do not close the active v1 cleanup ledger until every row above has passing
dated evidence, `docs/legibility-study.md` contains five dated outside developer
result rows, `rules/prelaunch-checklist.md` contains dated completion evidence
for every external launch check, and the full acceptance command set has passed
from a clean checkout.
