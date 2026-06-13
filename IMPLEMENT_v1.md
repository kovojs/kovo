# Jiso v1 Remaining Work

`SPEC.md` is the behavior source of truth. This file is the top-level v1 closeout checklist; keep
implementation evidence in `plans/codebase-quality-round2.md`, `plans/ui.md`, and `plans/app-shell.md`.
Deferred/post-freeze workstreams (`plans/better-docs.md`, `plans/react-interop.md`) are tracked
separately and do not gate the v1 framework freeze.

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
- [x] Runtime: unify inline-loader minifier/apply paths and finish splitting broad runtime tests across
      apply, query, loader, and minifier boundaries. (Apply-path unification + inline-loader parity +
      compat-export removal done; the five remaining ≥330-line monoliths are now split — Phase 4/7
      closed. Runtime 69 files / 306 tests + 16 browser pass.)
- [x] Server/app-shell: finish subtractive extraction across root exports, Vite, static export, replay,
      document, and app boundaries; remove compatibility aliases only after replacements are proven.
      (Phase 5 / app-shell R1–R7 closed; `check`, `test`, `check:build` green this session.)
- [x] App-shell adoption: prove Vite build/static export behavior across server, starter, commerce, and
      docs. (Starter/commerce/docs export adoption tests green within `pnpm run test` 2508 + `check:build`.)
- [x] UI: finish remaining primitive exports, behavior contracts, wrappers, gallery routes, compiled
      demos, state/focus/form/validity behavior, canceled-change restoration, axe checks, and visual
      baselines. (H1–H3 primitive families and the G1–G6 gallery gates all closed — see
      `plans/ui.md`. 530 unit + 39 gallery-browser pass.)

## Deferred (post-freeze workstreams, not v1-blocking)

- [ ] Docs: rewrite the docs site for approachability and dual human/agent consumption. Owner
      deferred this to "analysis only" on 2026-06-13 — content/positioning is a separate workstream
      from the framework freeze. See `plans/better-docs.md`.
- [ ] React interop (`@jiso/react`): tentative, design agreed but unapproved; `SPEC.md` intentionally
      untouched. Post-v1. See `plans/react-interop.md`.

## Final Acceptance

- [ ] Active implementation ledgers (`codebase-quality-round2`, `ui`, `app-shell`) have no open
      v1-blocking items. (Operating-rule checkboxes, `better-docs`, and `react-interop` are excluded
      per the Deferred section above.)
- [ ] Clean checkout passes `pnpm run check`.
- [ ] Clean checkout passes `pnpm run test`.
- [ ] Clean checkout passes `pnpm run test:browser`.
- [ ] Clean checkout passes `pnpm run test:conformance`.
- [ ] Clean checkout passes `pnpm run check:build`.
- [ ] Clean checkout passes `pnpm run check:fw`.
- [ ] No unresolved `SPEC.md` behavior conflict remains.
