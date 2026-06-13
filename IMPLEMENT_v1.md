# Jiso v1 Remaining Work

`SPEC.md` is the behavior source of truth. This file is the top-level v1 closeout checklist; keep
implementation evidence in `plans/codebase-quality-round2.md`, `plans/ui.md`, `plans/app-shell.md`,
and `plans/better-docs.md`.

## Fixed Scope

- Workspace orchestration: Vite Plus (`vp ...`, `https://viteplus.dev/`) with oxlint/oxfmt and
  TypeScript static checking.
- Database target: `@jiso/drizzle` Postgres for v1. SQLite/MySQL conformance waits for late hardening.
- Authored app surface: TSX/JSX only. Lowered IR, stamps, emitted modules, and source patches are
  generated artifacts.

## Open Blockers

- [x] Compiler: close Phase 2 by removing compatibility reparses, retiring unjustified
      source-string lowerers/validators, and proving source patches plus offset maps as the lowering
      contract.
- [x] Harness/tests: replace fragile generated-source assertions with behavior checks or structured
      `@jiso/test` fixtures, while preserving intentional wire pins. (Phase 1 closed; `check:fw`
      49 pass — see `plans/codebase-quality-round2.md`.)
- [x] Drizzle: close Postgres extraction by deleting bespoke paths in favor of ts-morph/project facts
      and covering or FW406-degrading remaining invisible loader/mutation surfaces. (Phase 3 closed;
      `test:conformance` + drizzle suite 479 pass.)
- [ ] Runtime: unify inline-loader minifier/apply paths and finish splitting broad runtime tests across
      apply, query, loader, and minifier boundaries. (Apply-path unification + inline-loader parity +
      compat-export removal done; opportunistic test-seam splitting continues — ~5 monoliths remain.)
- [x] Server/app-shell: finish subtractive extraction across root exports, Vite, static export, replay,
      document, and app boundaries; remove compatibility aliases only after replacements are proven.
      (Phase 5 / app-shell R1–R7 closed; `check`, `test`, `check:build` green this session.)
- [x] App-shell adoption: prove Vite build/static export behavior across server, starter, commerce, and
      docs. (Starter/commerce/docs export adoption tests green within `pnpm run test` 2508 + `check:build`.)
- [ ] UI: finish remaining primitive exports, behavior contracts, wrappers, gallery routes, compiled
      demos, state/focus/form/validity behavior, canceled-change restoration, axe checks, and visual
      baselines.
- [ ] Docs: rewrite the docs site for approachability and dual human/agent consumption — "Why Jiso?"
      positioning, voice cleanup, real API references from source JSDoc, and an agent layer. See
      `plans/better-docs.md`.

## Final Acceptance

- [ ] Active plan ledgers have no open v1-blocking items.
- [ ] Clean checkout passes `pnpm run check`.
- [ ] Clean checkout passes `pnpm run test`.
- [ ] Clean checkout passes `pnpm run test:browser`.
- [ ] Clean checkout passes `pnpm run test:conformance`.
- [ ] Clean checkout passes `pnpm run check:build`.
- [ ] Clean checkout passes `pnpm run check:fw`.
- [ ] No unresolved `SPEC.md` behavior conflict remains.
