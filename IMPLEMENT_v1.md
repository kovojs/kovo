# Jiso v1 Implementation Ledger

Companion to `SPEC.md`. `SPEC.md` is normative for framework behavior; this file only tracks what
still blocks v1 completion.

Status: active, compacted on 2026-06-13.

## Current Rule

Keep this file as a release ledger, not an audit log. Detailed evidence belongs in the active plan
that owns the work; mirror only changes that alter v1 completion state.

## Active Ledgers

- `plans/codebase-quality-round2.md` - compiler, Drizzle, runtime, server, harness, and test
  hardening.
- `plans/ui.md` - `@jiso/headless-ui`, `@jiso/ui`, gallery, and UI conformance closure.
- `plans/app-shell.md` - request shell, Vite build/dev/export, static export, and adoption closure.
- `plans/archive.md` - completed or superseded plans.

## Done Baseline

- [x] Root tooling is on Vite+ with `vite-plus`, `vp check`, `vp run`, Oxlint/Oxfmt, TypeScript
      static checking, and CI setup.
- [x] Core package skeleton and P0 wire fixtures exist.
- [x] Runtime/server/data-plane baselines exist for mutation/query flow, typed navigation, sessions,
      CSRF, guards, replay, fragments, DOM morphing, query patches, and typed-read refetch.
- [x] Postgres v1 Drizzle touch-graph generation and conformance pinning exist. SQLite/MySQL remain
      deferred to late hardening.
- [x] Optimistic UI, stateless liveness, CLI diagnostics, pglite-backed test API, TSX-only authoring,
      Better Auth, machine endpoints, and D10 diagnostics surfacing are implemented or archived.

## Remaining Work

- [ ] P1 compiler closure: finish Phase 2 in `plans/codebase-quality-round2.md`.
  - [ ] Remove compatibility reparses where parser facts are sufficient.
  - [ ] Retire source-string lowerers/validators or justify remaining source use as scanner,
        diagnostics, or emitted-artifact verification internals.
  - [ ] Keep explicit source patches and offset maps as the lowering contract.
  - [ ] Shrink compiler mega-modules only where ownership becomes clearer.

- [ ] Phase 1/6/7 quality closure: finish `fw-check`, harness, and test-structure cleanup in
      `plans/codebase-quality-round2.md`.
  - [ ] Replace remaining source-text/generated-shape assertions with public behavior or structured
        `@jiso/test` fixtures, except intentional scoped wire pins.
  - [ ] Move reusable monolith-test mechanics into package fixtures when touching those paths.

- [ ] Phase 3 Drizzle closure: finish the blessed Postgres v1 extraction hardening in
      `plans/codebase-quality-round2.md`.
  - [ ] Delete bespoke lexer/compat extraction paths replaceable by ts-morph/project facts.
  - [ ] Cover or degrade remaining invisible source/project query-loader and mutation surfaces.

- [ ] Phase 4 runtime closure: finish apply/loader/test cleanup in
      `plans/codebase-quality-round2.md`.
  - [ ] Split remaining broad runtime tests along apply/query/loader/minifier boundaries.
  - [ ] Re-run browser runtime tests after each apply or loader surface change.

- [ ] D7 UI closure: finish `@jiso/headless-ui`, vendored `@jiso/ui`, gallery, and conformance work
      in `plans/ui.md`.
  - [ ] Complete H2/H3 primitive exports, tests, styled wrappers, gallery routes, behavior contracts,
        merge fixtures, and compiled interactive demos.
  - [ ] Close field/fieldset native validity/form behavior.
  - [ ] Close state, focus, menu, and canceled-change restoration gaps.
  - [ ] Add stable G1/G2/G6 coverage, then G3 axe checks and G4 visual baselines.

- [ ] D8 app-shell closure: finish R6/R7 in `plans/app-shell.md`.
  - [ ] Finish subtractive server extraction across `index.ts`, Vite, static export, replay,
        document, and app boundaries.
  - [ ] Prove Vite build/static export/adoption across server, starter, commerce, and docs.
  - [ ] Keep one wire-html emitter and one compile/static-export diagnostic seam.
  - [ ] Delete pinned compatibility modules and aliases when replacements are proven.

- [ ] P10 final acceptance from a clean checkout.
  - [ ] `pnpm run check`
  - [ ] `pnpm run test`
  - [ ] `pnpm run test:browser`
  - [ ] `pnpm run test:conformance`
  - [ ] `pnpm run check:build`
  - [ ] `pnpm run check:fw`
  - [ ] Final docs/starter/reference-app audit against `SPEC.md` and active ledgers.

## Integration Policy

- Keep main on the highest-conflict local path, currently compiler Phase 2 unless a newer blocker
  appears.
- Keep up to five `gpt-5.5` medium sub-agents in sibling git worktrees on large, closure-oriented,
  non-overlapping slices.
- Require each worker to own a module area, commit only its slice, and hand off branch, commit
  range, changed files, checks, checklist coverage, and integration notes.
- Integrate one branch at a time with focused gates after each branch and broad gates after each
  mini-wave.
- Update checkboxes only with same-session evidence for the exact claim.

## Final Done Definition

Jiso v1 is done only when:

- [ ] Every remaining item above is checked with direct evidence.
- [ ] `plans/codebase-quality-round2.md`, `plans/ui.md`, and `plans/app-shell.md` have no open
      v1-blocking checklist items.
- [ ] The final clean-checkout gates pass.
- [ ] `SPEC.md` and implementation behavior agree, or any discovered conflict has been resolved in
      `SPEC.md` or the implementation before release.
