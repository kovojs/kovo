# Jiso v1 Execution Index

`SPEC.md` is the behavior source of truth. This file tracks only what still blocks v1 and where the
active implementation ledgers live.

## Ground Rules

- Use Vite Plus (`vp ...`, `https://viteplus.dev/`) as the workspace check/build/test orchestrator,
  including configured oxlint/oxfmt and `@typescript/native-preview` static checking.
- v1 blesses `@jiso/drizzle` Postgres. SQLite/MySQL conformance is late-hardening work.
- App-authored code stays TSX/JSX; lowered IR, generated stamps, emitted modules, and source patches
  are compiler artifacts to verify.

## Active Plans

- `plans/codebase-quality-round2.md` - compiler, Drizzle, runtime, server, harness, test structure.
- `plans/ui.md` - headless primitives, wrappers, gallery, UI conformance.
- `plans/app-shell.md` - request shell, Vite build/dev/export, static export, adoption.

## Remaining v1 Work

- [ ] Close compiler Phase 2.
  - [ ] Remove compatibility reparses where model/parser facts are sufficient.
  - [ ] Retire unjustified source-string lowerers and validators.
  - [ ] Keep source patches and offset maps as the lowering contract.
- [ ] Close quality and harness cleanup.
  - [ ] Replace fragile generated-source assertions with behavior or structured `@jiso/test`
        fixtures, except intentional wire pins.
  - [ ] Move reusable monolith-test mechanics into package fixtures as those paths change.
- [ ] Close Drizzle Postgres support.
  - [ ] Delete bespoke extraction paths replaced by ts-morph/project facts.
  - [ ] Cover or FW406-degrade remaining invisible query-loader and mutation surfaces.
- [ ] Close runtime support.
  - [ ] Finish inline-loader minifier and apply-path unification.
  - [ ] Split broad runtime tests across apply, query, loader, and minifier boundaries.
- [ ] Close server and app-shell support.
  - [ ] Finish subtractive extraction across root exports, Vite, static export, replay, document,
        and app boundaries.
  - [ ] Prove Vite build/static export/adoption across server, starter, commerce, and docs.
  - [ ] Remove pinned compatibility modules and aliases once replacements are proven.
- [ ] Close UI support.
  - [ ] Finish remaining primitive exports, behavior contracts, form/validity behavior, wrappers,
        gallery routes, and compiled demos.
  - [ ] Close state, focus, menu, canceled-change restoration, axe, and visual baseline gaps.

## Release Gate

- [ ] Active plans above have no open v1-blocking checklist items.
- [ ] Final clean-checkout gates pass:
  - [ ] `pnpm run check`
  - [ ] `pnpm run test`
  - [ ] `pnpm run test:browser`
  - [ ] `pnpm run test:conformance`
  - [ ] `pnpm run check:build`
  - [ ] `pnpm run check:fw`
- [ ] Any conflict between `SPEC.md` and implementation behavior is resolved before release.
