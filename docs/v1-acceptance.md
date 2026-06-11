# v1 Acceptance Ledger

`SPEC.md` section 16 is the normative acceptance contract. This ledger maps each criterion to the repo evidence used before v1 freeze; it does not claim that v1 is complete.

## Required Gates

| Criterion          | Evidence Source                                                                                         | Status  |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------- |
| Perf               | `pnpm run check:perf` plus `tests/p10-perf.node.mjs` Playwright/CDP memory and navigation assertions    | ready   |
| Legibility         | `docs/legibility-study.md` results ledger with five outside developers                                  | pending |
| Verifiability      | `pnpm run check`, `pnpm run check:fw`, commerce graph assertions, framework-owned browser suites        | ready   |
| Constitution       | `docs/constitution.md`, fixpoint/render-equivalence checks, documented `invalidate()` escape-hatch scan | ready   |
| Coverage           | Commerce graph assertions for mutation/query optimistic status and zero unhandled FW310s                | pending |
| Navigation typed   | Commerce route/link/redirect checks plus route-rename proof                                             | pending |
| Declared execution | `on:load`/FW211 and FW302 justification scan                                                            | ready   |
| Update coverage    | FW311/update-coverage graph assertions for commerce query-dependent DOM positions                       | pending |
| Pre-launch         | `docs/prelaunch-checklist.md` dated trademark, domain, npm-scope, and linguistic-screen evidence        | pending |

## Freeze Rule

Do not mark `IMPLEMENT_v1.md` P10 complete until every row above is `ready` or `done`, the legibility and pre-launch ledgers contain dated outside evidence, and the full acceptance command set has been run from a clean checkout.
