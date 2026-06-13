# Jiso v1 Remaining Work

`SPEC.md` is the normative source of truth for framework behavior. This file is the compact v1
execution index: it tracks only work that still blocks release and points to the active ledgers that
own the details.

Status: active, compacted on 2026-06-13.

## Active Ledgers

- `plans/codebase-quality-round2.md` - compiler, Drizzle, runtime, server, harness, and test
  hardening.
- `plans/ui.md` - headless primitives, styled UI wrappers, gallery, and UI conformance.
- `plans/app-shell.md` - request shell, Vite build/dev/export, static export, and adoption.
- `plans/archive.md` - completed or superseded plans.

## Release Blockers

- [ ] Compiler Phase 2 closure.
  - [ ] Remove compatibility reparses where parser facts are sufficient.
  - [ ] Retire source-string lowerers/validators, or explicitly justify remaining source use as
        scanner, diagnostic, source-patch, or emitted-artifact verification internals.
  - [ ] Keep explicit source patches and offset maps as the lowering contract.
  - [ ] Split compiler mega-modules only where the ownership boundary becomes clearer.

- [ ] Quality, harness, and test-structure closure.
  - [ ] Replace remaining fragile generated-source assertions with public behavior or structured
        `@jiso/test` fixtures, except intentional wire pins.
  - [ ] Move reusable monolith-test mechanics into package fixtures when touching those paths.
  - [ ] Keep plan evidence current without turning plans back into audit logs.

- [ ] Drizzle Postgres v1 closure.
  - [ ] Delete remaining bespoke lexer or compatibility extraction paths that ts-morph/project facts
        can replace.
  - [ ] Cover or degrade remaining invisible query-loader and mutation surfaces with FW406 where
        extraction cannot be proven.
  - [ ] Keep SQLite/MySQL conformance deferred to late hardening.

- [ ] Runtime closure.
  - [ ] Finish inline-loader minifier and apply-path unification.
  - [ ] Split remaining broad runtime tests along apply, query, loader, and minifier boundaries.
  - [ ] Re-run browser runtime coverage after each apply or loader surface change.

- [ ] Server and app-shell closure.
  - [ ] Finish subtractive server extraction across root exports, Vite, static export, replay,
        document, and app boundaries.
  - [ ] Prove Vite build/static export/adoption across server, starter, commerce, and docs.
  - [ ] Keep one wire-html emitter and one compile/static-export diagnostic seam.
  - [ ] Delete pinned compatibility modules and aliases once replacements are proven.

- [ ] UI closure.
  - [ ] Finish remaining headless primitive exports, behavior contracts, form/validity behavior,
        styled wrappers, gallery routes, and compiled demos.
  - [ ] Close state, focus, menu, and canceled-change restoration gaps.
  - [ ] Add stable gallery/browser/conformance coverage, then axe checks and visual baselines.

- [ ] Final clean-checkout acceptance.
  - [ ] `pnpm run check`
  - [ ] `pnpm run test`
  - [ ] `pnpm run test:browser`
  - [ ] `pnpm run test:conformance`
  - [ ] `pnpm run check:build`
  - [ ] `pnpm run check:fw`
  - [ ] Final docs, starter, and reference-app audit against `SPEC.md` and the active ledgers.

## Done Definition

- [ ] Every release blocker above is checked with direct same-session evidence.
- [ ] `plans/codebase-quality-round2.md`, `plans/ui.md`, and `plans/app-shell.md` have no open
      v1-blocking checklist items.
- [ ] Final gates pass from a clean checkout.
- [ ] Any conflict between `SPEC.md` and implementation behavior is resolved before release.
