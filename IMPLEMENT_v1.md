# Jiso v1 Implementation Ledger

Companion to `SPEC.md`. `SPEC.md` is normative for framework behavior; this file tracks the
remaining implementation work needed to call v1 done.

Status: active, compacted on 2026-06-13. Detailed historical evidence lives in the active plans
listed below and in `plans/archive.md`.

## Current Rule

Keep this file focused on what remains. Do not append session transcripts here. When a slice lands,
update the relevant active plan with concise evidence and only mirror the result here if it changes
the v1 completion state.

## Active Ledgers

- `plans/codebase-quality-round2.md` - compiler, Drizzle, runtime, server/app-shell, harness, and
  test-structure hardening.
- `plans/ui.md` - `@jiso/headless-ui`, `@jiso/ui`, gallery, and UI conformance closure.
- `plans/app-shell.md` - request shell, Vite build/dev/export, static export, and adoption closure.
- `plans/diagnostics.md` - diagnostics surfacing. Current state is implemented; keep only if future
  diagnostics work reopens.
- `plans/archive.md` - completed or superseded plans, including auth, machine endpoints,
  TSX-only authoring, and earlier compiler/UI/code-quality work.

## Completed Rollup

- [x] Vite+ baseline is wired at the root with `vite-plus`, `vp check`, `vp run`, Oxlint/Oxfmt,
      TypeScript static checking, and CI setup.
- [x] Workspace package skeleton exists for `core`, `compiler`, `runtime`, `server`, `drizzle`,
      `cli`, `test`, `create-jiso`, `headless-ui`, `ui`, and the conformance packages.
- [x] P0 wire fixtures exist for enhanced mutation, no-JS PRG, 422 fragment, typed read, and
      `<fw-defer>` stream behavior.
- [x] Core diagnostics registry exists and is consumed by compiler, Drizzle, CLI, server, and test
      surfaces.
- [x] P2 runtime baseline exists: delegated event loading, execution triggers, `ctx.signal`, query
      hydration/update plans, visible-return typed-read refetch, BroadcastChannel plumbing,
      bfcache-safe pagehide behavior, no custom elements, and a 4KB inline loader budget.
- [x] P3 server/core data plane exists: `domain`, `query`, `mutation`, `route`, typed navigation,
      typed sessions, CSRF, FormData coercion, guards/rate limits, mutation replay, query endpoints,
      query reruns, and commerce usage.
- [x] P4 generated touch-graph workflow exists for the Postgres v1 surface: Drizzle extraction,
      generated invalidation registries, commerce touch graph generation, and conformance pinning.
- [x] P5 enhanced wire exists: fragments, DOM morphing, query patch application, typed-read refetch,
      template stamps, Tailwind stylesheet hints, and runtime/browser coverage.
- [x] P6 optimism exists: typed `OptimisticFor`, generated invalidation sets, pending stamps,
      named queues, rebase/restore behavior, and commerce-level mutation/query matrix coverage.
- [x] P7 stateless liveness exists through BroadcastChannel mutation sync and visible-return/focus
      refetch behavior. Server-side live bus/SSE/Redis remains out of v1.
- [x] P8 CLI exists with stable `fw check`, `fw explain`, optimistic/update coverage,
      unguarded/unscoped audits, and diffable output.
- [x] P9/v1.5 test API exists with pglite-backed harnessing, static-vs-observed read/write
      verification, FW402/FW403/FW404/FW405/FW407/FW408/FW410/FW411 diagnostics, and commerce
      verification-loop acceptance.
- [x] D1-D6 are implemented or archived: Tailwind-first CSS, keyed list/reorder behavior,
      streaming details, adopt-don't-invent features, blessed Better Auth adapter, and machine
      endpoints.
- [x] D9 TSX-only authoring is implemented and archived: commerce TSX migration, FW235 error,
      Constitution #3 rewording, FW226 demotion, and TSX-only starter/docs/agent constraints.
- [x] D10 diagnostics surfacing is implemented: blocking Vite dev transform, dev teaching-error
      documents, static-export/build refusal, and `fw mcp` agent surface.

## Remaining Work

- [ ] P1 compiler cleanup: finish the parser/model migration tracked by
      `plans/codebase-quality-round2.md` Phase 2.
- [ ] P1: remove compatibility reparses where parser facts are sufficient.
- [ ] P1: retire source-string lowerers/validators or explicitly justify remaining source use as
      parser/scanner internals, diagnostics, or unavoidable emitted-artifact verification.
- [ ] P1: keep explicit source patches and offset maps as the lowering contract.
- [ ] P1: shrink remaining compiler mega-modules only where it clarifies ownership without hiding
      behavior.

- [ ] Phase 1/6/7 quality cleanup: finish `fw-check` and harness de-tautologization in
      `plans/codebase-quality-round2.md`.
- [ ] Quality: replace remaining source-text or generated-artifact shape assertions with public
      behavior or structured `@jiso/test` fixtures.
- [ ] Quality: keep intentional byte-for-byte wire pins explicitly scoped.
- [ ] Quality: move reusable monolith-test mechanics into package fixtures when touching those
      paths.

- [ ] Phase 3 Drizzle hardening: complete the Postgres v1 extraction cleanup in
      `plans/codebase-quality-round2.md`.
- [ ] Drizzle: delete remaining bespoke lexer/compat extraction paths where ts-morph/project facts
      can replace them.
- [ ] Drizzle: cover or degrade remaining invisible source/project query-loader and mutation
      surfaces.
- [x] Drizzle: keep SQLite/MySQL conformance deferred to late hardening; do not broaden v1 beyond
      the blessed Postgres surface.

- [ ] Phase 4 runtime hardening: finish the runtime apply/loader cleanup in
      `plans/codebase-quality-round2.md`.
- [x] Runtime: keep inline-loader readable/minified output mechanically tied to canonical parser
      helpers.
- [ ] Runtime: finish splitting broad runtime tests along apply/query/loader/minifier seams.
- [ ] Runtime: re-run browser runtime tests after each apply or loader surface change.

- [ ] D7 UI libraries: finish `@jiso/headless-ui`, vendored `@jiso/ui`, and gallery closure in
      `plans/ui.md`.
- [ ] UI: re-audit H2 and H3 primitive completeness across exports, primitive tests, styled
      wrappers, gallery routes, behavior contracts, merge fixtures, and compiled interactive demos.
- [ ] UI: close remaining field/fieldset native validity/form integration behavior.
- [ ] UI: close remaining state, focus, menu, and canceled-change restoration gaps for select,
      combobox, autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast,
      and command.
- [ ] UI: expand G1/G2/G6 until each relevant primitive/styled component has static fixture,
      behavior/provenance coverage, and browser-backed interactive evidence where behavior is
      user-visible.
- [ ] UI: add G3 axe checks and G4 visual baselines once route/state coverage is stable enough.

- [ ] D8 app shell: finish R6/R7 in `plans/app-shell.md`.
- [ ] App shell: continue subtractive extraction until server `index.ts`, Vite, static export,
      replay, document, and app boundaries are small and obvious.
- [ ] App shell: prove Vite build/static export/adoption through server, starter, commerce, and
      docs surfaces.
- [ ] App shell: keep one wire-html emitter and one compile/static-export diagnostic seam.
- [ ] App shell: delete dead compatibility modules and aliases when public replacements are pinned.

- [ ] P10 acceptance: run and record final clean-checkout acceptance once the implementation items
      above are closed.
- [ ] P10: `pnpm run check`.
- [ ] P10: `pnpm run test`.
- [ ] P10: `pnpm run test:browser`.
- [ ] P10: `pnpm run test:conformance`.
- [ ] P10: `pnpm run check:build`.
- [ ] P10: `pnpm run check:fw`.
- [ ] P10: final docs/starter/reference-app audit against `SPEC.md` and active ledgers.
- [ ] P10: keep external/non-code launch or study evidence separate from code completion evidence.

## Integration Policy

- Keep main on the highest-conflict local path, currently compiler Phase 2 unless a newer blocking
  integration issue appears.
- Use up to five `gpt-5.5` medium sub-agents in sibling git worktrees for large,
  closure-oriented, non-overlapping implementation slices.
- Each worker owns an explicit file/module area, commits only its slice, and returns worktree,
  branch, commit range, files changed, checks run, checklist items addressed, and integration
  notes.
- Integrate one branch at a time. Run focused gates after each branch and broad gates after each
  mini-wave.
- Update active plan checkboxes only with same-session evidence for the exact claim.

## Final Done Definition

Jiso v1 is done only when:

- [ ] Every remaining item above is checked with direct evidence.
- [ ] `plans/codebase-quality-round2.md`, `plans/ui.md`, and `plans/app-shell.md` have no open
      v1-blocking checklist items.
- [ ] The final clean-checkout gates pass.
- [ ] `SPEC.md` and implementation behavior agree, or any discovered conflict has been resolved in
      `SPEC.md` or the implementation before release.
