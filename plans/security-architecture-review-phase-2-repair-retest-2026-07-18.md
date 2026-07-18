# Phase 2 private-summary repair retest — 2026-07-18

## Identity and relationship to the independent review

- Repair tip: `0a310f85cdec2ec87a47f0bcf0dc4c56e30a5d4c`.
- Commit range after the independently reviewed tip: `e920f2018..0a310f85c` (red tests/C13
  enrollment, then production repair and forcing mutants).
- Historical verdict: `plans/security-architecture-review-phase-2-follow-up-2026-07-18.md`
  remains the independent **REJECT** of `56a3d969a`; this file does not rewrite it.
- Independence limit: the reviewer who found the two defects implemented this narrow repair after
  checkpointing the REJECT. This is an exact-fix-tip implementer retest, not the independent
  architecture re-review still required before classifier deletion.

## Verdict

**ACCEPT the narrow private-summary repair at `0a310f85c`.** Both blockers discovered at
`56a3d969a` are closed in every focused OPP/KV414/KV438 consumer, direct safe calls remain open, and
dedicated forcing mutants kill both weakenings.

**This ACCEPT does not authorize production-classifier deletion.** The full C13 command at the base
tip also exposed unrelated finite-IR false closures in the real starter, the handler-only TASK B
deletion/survivor inventory is not complete, and this repair needs an independent exact-integrated-
tip review after those changes land.

## Repaired invariants

1. `privateScopeHelperCallCarrierIsProven` now requires exactly one non-spread argument: the exact
   framework-enrolled request/context carrier. A strict-TypeScript widened direct alias can no
   longer run an extra argument's side effect before the proved helper reads the carrier; even an
   empty tuple spread stays outside the finite positive grammar.
2. Helper aliases derive from an immutable snapshot containing only structurally proved direct
   helpers. The OPP consumer no longer recursively follows another const initializer. The helper
   itself and one direct immutable const alias remain positive; two-hop aliases, containers,
   properties, mutable/escaped aliases, and same-text shadows remain closed.
3. C13 explicitly anchors the widened-alias, spread, two-hop OPP, and two-hop/widened KV438 cases.
   Three new forcing mutants restore the sole-argument, transitive-helper-map, and OPP-recursive-
   alias defects; all are killed.

## Verification at the repair tip

- Focused new repros: 5/5 passed (widened extra argument, empty spread, two-hop OPP, widened KV438,
  and two-hop KV438).
- Integrated private-summary/scope/mass suite: 6 files, 232/232 tests passed, including the existing
  direct-helper and one-direct-alias positive controls.
- `pnpm run check:security-gate-mutations`: 102/102 mutants killed.
- `pnpm --filter @kovojs/drizzle build:dist`: passed.
- C13 harness unit gate: 1 file, 9/9 tests passed.
- Focused C13 execution for `finite-security-operation-ir` plus `drizzle-analyzer-provenance`: 8/9
  files and 421/422 tests passed. The only failure was the semantic summary-budget case timing out
  after 70.74 seconds under the batched 60-second limit; the identical case passes isolated in
  27.76 seconds. This remains a real C13/deletion blocker even though it is not a repair regression.

## Remaining deletion conditions

- Integrate the starter finite-IR usability repair and make the complete
  `pnpm run check:security-classifier-corpus` command green at the final tip.
- Inventory named TASK B predicates and surviving request/process authority owners; delete only
  predicates with replacement C13/mutation evidence and record P/G.
- Run the full classifier/compiler/integration/browser/build/package/performance/memory gates.
- Obtain an independent review of the exact integrated deletion candidate. This implementer retest
  is evidence for that review, not a substitute for it.
