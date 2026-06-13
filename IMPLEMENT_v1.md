# Jiso v1 Checklist

`SPEC.md` is the behavior source of truth. This file tracks only v1 blockers; keep detailed evidence
in the active plan files.

## Decisions

- Vite Plus (`vp ...`, `https://viteplus.dev/`) is the workspace orchestrator, with oxlint/oxfmt and
  `@typescript/native-preview` static checking.
- v1 blesses `@jiso/drizzle` Postgres. SQLite/MySQL conformance is deferred to late hardening.
- App-authored code is TSX/JSX. Lowered IR, stamps, emitted modules, and source patches are generated
  artifacts.

## Plan Ledgers

- `plans/codebase-quality-round2.md`: compiler, Drizzle, runtime, server, harness, tests.
- `plans/ui.md`: primitives, wrappers, gallery, UI conformance.
- `plans/app-shell.md`: request shell, Vite build/dev/export, static export, adoption.

## Blockers

- [ ] Compiler Phase 2 is closed.
  - [ ] Compatibility reparses are removed where parser/model facts are sufficient.
  - [ ] Unjustified source-string lowerers and validators are retired.
  - [ ] Source patches and offset maps are proven as the lowering contract.
- [ ] Quality/harness cleanup is closed.
  - [ ] Fragile generated-source assertions are replaced with behavior checks or structured
        `@jiso/test` fixtures, except intentional wire pins.
  - [ ] Reusable monolith-test mechanics live in package fixtures.
- [ ] Drizzle Postgres support is closed.
  - [ ] Bespoke extraction paths replaced by ts-morph/project facts are deleted.
  - [ ] Remaining invisible loader/mutation surfaces are covered or FW406-degraded.
- [ ] Runtime support is closed.
  - [ ] Inline-loader minifier/apply paths are unified.
  - [ ] Broad runtime tests are split across apply, query, loader, and minifier boundaries.
- [ ] Server/app-shell support is closed.
  - [ ] Subtractive extraction is complete across root exports, Vite, static export, replay,
        document, and app boundaries.
  - [ ] Vite build/static export/adoption is proven across server, starter, commerce, and docs.
  - [ ] Pinned compatibility modules and aliases are removed after replacements are proven.
- [ ] UI support is closed.
  - [ ] Remaining primitive exports, behavior contracts, wrappers, gallery routes, and compiled demos
        are complete.
  - [ ] State, focus, form/validity, canceled-change restoration, axe, and visual baseline gaps are
        closed.

## Final Gates

- [ ] Active plan ledgers have no open v1-blocking items.
- [ ] Clean checkout passes `pnpm run check`.
- [ ] Clean checkout passes `pnpm run test`.
- [ ] Clean checkout passes `pnpm run test:browser`.
- [ ] Clean checkout passes `pnpm run test:conformance`.
- [ ] Clean checkout passes `pnpm run check:build`.
- [ ] Clean checkout passes `pnpm run check:fw`.
- [ ] No unresolved `SPEC.md`/implementation behavior conflicts remain.
