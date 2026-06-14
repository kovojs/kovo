# v1 Cleanup Plan

Status: active. Created on 2026-06-13.

`SPEC.md` remains the source of truth for framework behavior. The v1 implementation gates are green,
and the completed closeout ledgers have been archived. This file is now the standalone active ledger
for cleanup discovered during final verification. Prefer code cleanup over wording cleanup: only
reword old claims when the claim is historical or when code cleanup is explicitly out of v1 scope.

## Archived Context

- `IMPLEMENT_v1.md` was the top-level v1 closeout checklist. It reached green acceptance, but some
  checked prose used broad phrases such as "remaining monoliths are split" and "source-string
  lowerers/validators retired." Treat its status as historical: v1 gates passed, not every possible
  cleanup is done forever.
- `plans/codebase-quality-round2.md` closed Phases 0-7 for compiler, Drizzle, runtime, server,
  harness, commerce, and test restructuring. Its durable result is the passing acceptance chain; its
  broad qualitative cleanup claims are the source of several items below.
- `plans/ui.md` closed the UI primitive/gallery workstream with focused unit and gallery browser
  coverage. Its durable result is the passing UI gates; its axe and "per-state" wording needs to be
  kept precise.
- Deferred work remains outside this plan: `plans/better-docs.md` and `plans/react-interop.md`.

## Verified Baseline

- [x] Full v1 acceptance is green: `pnpm run acceptance` EXIT=0.
      - Covered `check`, `test` (262 files / 2508 tests), `test:browser` (5 runtime browser files /
        16 tests), `check:build`, `test:p10-perf`, `test:conformance`, and `check:fw` (49 tests).
- [x] Focused UI gates are green.
      - `pnpm exec vitest --run packages/headless-ui packages/ui examples/gallery`: 52 files /
        530 tests.
      - `pnpm --filter @jiso/example-gallery run test:browser`: 1 file / 39 tests.
- [x] UI generated/gallery inventory is present.
      - 35 compiled interactive demos listed in `examples/gallery/package.json`; each has matching
        generated `.tsx` and `.client.js` files.
      - 44 static visual fixture HTML files exist under `examples/gallery/src/visual-fixtures`.
      - 49 `visualBaselineHash` assertions exist in `interactive-gallery.browser.test.ts`.
- [x] Current checkout is clean and `git diff --check` passed after plan archival.

## Cleanup Checklist

- [ ] Split remaining large test seams into focused executable surfaces.
      - Current evidence: `tests/fw-check.node.mjs` is 3919 lines.
      - Current evidence: `packages/runtime/src/inline-loader-parser-parity.test.ts` is 397 lines.
      - Do not close this by wording cleanup alone. Done when reusable mechanics are extracted into
        focused fixtures/tests and any remaining large file has a narrow, documented reason to stay
        whole as an executable acceptance/parity surface.
- [ ] Expand UI axe coverage to match the strongest accessibility claim.
      - Current evidence: `examples/gallery/src/interactive-gallery.browser.test.ts` has one
        full-route axe test and one representative generated-state axe test.
      - Current evidence: the same browser file has 39 total tests covering generated interactions,
        native state, form ownership, visual baselines, and representative accessibility checks.
      - Do not close this by wording cleanup alone. Done when browser tests run axe across every
        claimed primitive family/state tier, or the explicit accessibility claim is reduced only
        because a state cannot be meaningfully represented in an axe-stable DOM.
- [ ] Reduce runtime parser/apply duplication in code.
      - Current evidence: runtime still has `wire-parser.ts`, `wire-response-scanner.ts`, generated
        inline-loader parser code, and generated inline apply code.
      - Current evidence: mutation bodies, deferred streams, broadcast replay, query events, script
        hydration, and typed reads converge through shared query/apply seams, and inline output is
        parity-tested against canonical helpers.
      - Do not close this by wording cleanup alone. Done when duplicated parser/apply logic is
        actually removed or further centralized behind canonical helpers, with parity tests proving
        generated inline output still matches canonical runtime behavior.
- [ ] Remove Drizzle source-mode dependency; require project-mode extraction.
      - Policy: v1 Drizzle extraction must use TypeScript project symbols/types through ts-morph.
        Source-mode name/shape heuristics are not acceptable as a dependency for read/write facts.
      - Current evidence: v1 blesses Postgres; SQLite/MySQL conformance is deferred.
      - Current evidence: `packages/drizzle/src/static.ts` still contains source-mode FW406
        degradation paths alongside project-mode ts-morph extraction.
      - Do not close this by wording cleanup alone. Done when production Drizzle extraction requires
        project-mode proof for Postgres read/write facts, source-mode compatibility paths are deleted
        or reduced to fail-closed diagnostics only, and conformance proves real `drizzle-orm`
        Postgres surfaces through project-mode.
- [ ] Remove source-string decision-making from compiler post-parse phases.
      - Policy: after parsing, compiler decisions must use typed model facts and spans, not raw
        source snippets, regexes, `getText()`, or ad hoc string slicing.
      - Allowed source-text boundaries: parser/scanner input, diagnostic source-frame rendering,
        shared source-patch application by known spans, and generated-artifact verification.
      - Disallowed decision-making zones: `lower/**`, `validate/**`, `analyze/**`, `graph.ts`, and
        `emit/**` must consume model facts/spans instead of source strings.
      - Current evidence: compile passes use `SourceReplacement` and offset maps; the old
        `componentOptionSource` and `componentStateReturnObject()` compatibility helpers are gone.
      - Current evidence: parser/scanner/diagnostic source slicing and generated `renderSource()`
        remain by design.
      - Do not close this by wording cleanup alone. Done when remaining violations are replaced with
        parser/model facts, formatting-resistant fixtures cover the migrated behavior, and a
        mechanical guard prevents new post-parse source-string decision-making.
- [ ] Replace stale references to archived v1 ledgers when touching nearby files.
      - Current targets to watch: comments or docs that say an open question/work item is recorded in
        `IMPLEMENT_v1.md`, historical command transcripts in `plans/app-shell.md`, and any future
        roadmap reference that should point to this cleanup plan instead.
      - Done when `rg "IMPLEMENT_v1.md|codebase-quality-round2.md|plans/ui.md"` only finds
        historical archive entries or intentionally preserved historical evidence.

## Verification Rules

- [ ] For wording-only cleanup, run `git diff --check` and a narrow docs/plan formatting check if
      available.
- [ ] For compiler, runtime, Drizzle, server, or UI code changes, run the focused package tests plus
      `pnpm run check`.
- [ ] Before closing this plan, rerun `pnpm run acceptance`.
