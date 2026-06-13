# Jiso v1 Execution Index

`SPEC.md` is the source of truth for framework behavior. This file only tracks what still blocks v1
release and where the detailed work lives.

Status: active, compacted on 2026-06-13.

## Baseline

- Use Vite Plus (`https://viteplus.dev/`, `vp ...`) for workspace checks, builds, typed example
  checks, browser gates, conformance gates, and fw-check orchestration.
- Keep `@typescript/native-preview` as the static checking path for v1. `SPEC.md` describes the
  contract as TypeScript static checking, not a separate framework-owned typechecker.
- Use the repo formatter/linter path (`vp check`, oxlint/oxfmt through Vite Plus where configured)
  instead of adding parallel style tooling.
- v1 blesses `@jiso/drizzle` Postgres. SQLite/MySQL conformance stays deferred to late hardening.
- App-authored code is TSX/JSX. Lowered IR, generated stamps, server/client modules, and source
  patches are compiler artifacts to inspect and test, not application source to hand-author.

## Active Ledgers

- `plans/codebase-quality-round2.md` - compiler, Drizzle, runtime, server, harness, and test
  structure.
- `plans/ui.md` - headless primitives, styled wrappers, gallery, and UI conformance.
- `plans/app-shell.md` - request shell, Vite build/dev/export, static export, and adoption.
- `plans/archive.md` - completed or superseded plan history.

## Remaining Blockers

- [ ] Compiler Phase 2 closure.
  - [ ] Remove compatibility reparses where parser/model facts are sufficient.
  - [ ] Retire unjustified source-string lowerers and validators.
  - [ ] Keep explicit source patches and offset maps as the lowering contract.

- [ ] Quality and harness closure.
  - [ ] Replace fragile generated-source assertions with behavior or structured `@jiso/test`
        fixtures, except intentional wire pins.
  - [ ] Move reusable monolith-test mechanics into package fixtures as those paths change.

- [ ] Drizzle Postgres closure.
  - [ ] Delete bespoke extraction paths that ts-morph/project facts can replace.
  - [ ] Cover or FW406-degrade remaining invisible query-loader and mutation surfaces.

- [ ] Runtime closure.
  - [ ] Finish inline-loader minifier and apply-path unification.
  - [ ] Split broad runtime tests along apply, query, loader, and minifier boundaries.

- [ ] Server and app-shell closure.
  - [ ] Finish subtractive extraction across root exports, Vite, static export, replay, document,
        and app boundaries.
  - [ ] Prove Vite build/static export/adoption across server, starter, commerce, and docs.
  - [ ] Remove pinned compatibility modules and aliases once replacements are proven.

- [ ] UI closure.
  - [ ] Finish remaining primitive exports, behavior contracts, form/validity behavior, wrappers,
        gallery routes, and compiled demos.
  - [ ] Close state, focus, menu, canceled-change restoration, axe, and visual baseline gaps.

- [ ] Final acceptance from a clean checkout.
  - [ ] `pnpm run check`
  - [ ] `pnpm run test`
  - [ ] `pnpm run test:browser`
  - [ ] `pnpm run test:conformance`
  - [ ] `pnpm run check:build`
  - [ ] `pnpm run check:fw`

## Done

- [ ] The remaining blockers above are closed with same-session evidence in the active ledgers.
- [ ] `plans/codebase-quality-round2.md`, `plans/ui.md`, and `plans/app-shell.md` have no open
      v1-blocking checklist items.
- [ ] Final gates pass from a clean checkout.
- [ ] Any conflict between `SPEC.md` and implementation behavior is resolved before release.
