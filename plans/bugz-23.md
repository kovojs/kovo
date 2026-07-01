# Bugz 23

Created 2026-07-01. Source of truth remains `SPEC.md`. These confirmed defects came from an
exhaustive dogfood pass against local `main` after `plans/fundamental-fixes.md` and
`plans/capability-surface-redesign.md` were marked complete. Companion papercuts:
`plans/papercuts-22.md`.

## Scope

Fresh linked SQLite apps under `/Users/mini/kovo-dogfood-fundamental-20260630-234210/*`
covered the baseline starter, query write reachability, production runtime contracts, webhook
mutation dispatch, starter islands/static export, and direct DB fact enforcement. The carried
bug below was reproduced by the main agent and independently verified by skeptical sub-agent
`019f1c8d-a389-75d3-84f0-a85c1b07f927`.

## Issues

- [x] **B1 - Mutation handler WRITE-SINK facts are emitted and explained but not enforced by
      `kovo build` or `kovo check`.** (high, framework soundness/build-gate regression; found by
      `direct-db-facts`)
  - Observed behavior: registered mutations that call `request.db.insert(...)` and destructured
    `db.insert(...)` build successfully with `--no-cache`; `kovo explain --endpoints` reports
    resolved `WRITE-SINK surface=mutation` facts for both mutations, but `kovo check
dist/.kovo/graph.json` still prints `OK`.
  - Root cause: the compiler already turns mutation `handlerWriteSinks` into KV330/KV406 diagnostics
    (`packages/compiler/src/validate/component-contracts.ts:435-522`), but build preflight filters
    generic mutation KV330 component diagnostics (`packages/cli/src/commands/build-export.ts:606-620`)
    on the assumption that production builds derive mutation write safety elsewhere. The check gate
    consumes graph diagnostics and other findings (`packages/cli/src/graph-output.ts:772-814`) but
    never fails on `graph.handlerWriteSinks`; those same facts are only rendered by
    `kovo explain --endpoints` (`packages/cli/src/graph-output.ts:336-365`).
  - Why it matters: `plans/capability-surface-redesign.md` records mutation direct-DB gates as
    completed, and `SPEC.md` §10.3/§11.4 require mutation/domain writes and audit output to stay
    complete. A green build/check can now ship a direct mutation DB write that the framework itself
    has recognized as a write sink.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-fundamental-20260630-234210/direct-db-facts`,
    `pnpm exec kovo build ./src/app.tsx --no-cache` exits 0; `pnpm exec kovo explain --endpoints
dist/.kovo/graph.json | rg 'WRITE-SINK|direct-request|destructured'` reports the two mutation
    sinks plus the starter `addContact` sink; `pnpm exec kovo check dist/.kovo/graph.json` exits 0
    with `kovo-check/v1` / `OK`.
  - Acceptance: `kovo build` and `kovo check` fail when mutation `handlerWriteSinks` are present
    unless the sink is explicitly modeled as the allowed domain/mutation write path; resolved sinks
    surface KV330 and unresolved sinks surface KV406 or stricter. Add focused CLI tests for mutation
    write-sink graph facts, not only task/webhook facts, and keep `kovo explain` and the enforced
    gate on the same fact source.
  - Fixed evidence: `pnpm exec vitest run packages/cli/src/index.kovo-check.test.ts -t "handler
    direct-write facts"` and `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts -t
"blocks task and webhook direct DB writes"` passed; the original `direct-db-facts` no-cache
    build now exits 1 with KV330 for both unsafe mutation handlers.

## Latest Verification

- Baseline scaffold:
  `/Users/mini/kovo-dogfood-fundamental-20260630-234210/base` passed `pnpm run check`,
  `pnpm run test`, cache-free `pnpm exec kovo build ./src/app.tsx --no-cache`, and a dev HTTP smoke.
- Main-thread repro for B1: `pnpm exec kovo build ./src/app.tsx --no-cache`,
  `pnpm exec kovo explain --endpoints dist/.kovo/graph.json`, and
  `pnpm exec kovo check dist/.kovo/graph.json` in `direct-db-facts`.
- Independent verifier `019f1c8d-a389-75d3-84f0-a85c1b07f927` confirmed the same command results and
  source root cause.
