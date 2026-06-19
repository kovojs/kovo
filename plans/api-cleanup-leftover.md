# API Cleanup Leftover Work

Status: completed on 2026-06-19. This ledger closes the stale leftovers from
`plans/audit-api-20260618-merged.md` after reconciling them against current `main`.
`plans/api-export-cleanup.md` is already retired in `plans/archive.md`; this file records only the
remaining follow-through that was still active here.

## Completed Items

- [x] Move generated core registry seeds off the human-public `@kovojs/core` root.
  - Evidence: `packages/core/src/generated.ts` owns `FragmentTargets`, `ComponentRegistry`, and
    `LiveTargetRegistry` as `@generated`; `packages/compiler/src/emit/registry.ts` now emits
    `declare module '@kovojs/core/generated'` for those registries.
  - Verification: `pnpm exec vitest run packages/core/src/index.test.ts packages/compiler/src/registry.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/fragment-targets.test.ts`;
    `pnpm --dir site run api:check` reports `exports=478 documented=412`.

- [x] Redesign the public `@kovojs/cli` verifier inputs as opaque runtime-validated values.
  - Evidence: `packages/cli/src/api.ts` no longer imports `@kovojs/core/internal/graph`;
    `packages/cli/src/index.ts` exposes `KovoCheckInput`/`KovoExplainInput` as `unknown` and casts
    only after `validateKovoExplainInput`.
  - Verification: `pnpm exec vitest run packages/cli/src/index.kovo-check.test.ts`;
    `pnpm --dir site run api:check` renders the CLI input aliases as `unknown`.

- [x] Internalize the headless-ui foundation kit and token sheet from the public root.
  - Evidence: `packages/headless-ui/src/index.ts` is empty, `packages/headless-ui/src/internal.ts`
    exposes the foundation helpers as internal, and `api-surface-baseline.json` dropped 58 root
    headless foundation exports. `@kovojs/ui` copy-in source now uses local `safe-url` and
    navigation type helpers instead of the headless root.
  - Verification: `pnpm run check:api-surface` reports `public-exports-needing-attention=1571
(baseline=1571, fixed-this-run=0)`; `pnpm exec vitest run packages/headless-ui/src/lib/foundation-exports.test.ts packages/headless-ui/src/lib/safe-url.test.ts packages/ui/src/copy-in.test.ts packages/ui/src/headless-subpath-parity.test.ts`.

- [x] Keep the headless reducer and `@kovoPrimitiveHandler` layer public for the current L1
      island-authoring contract.
  - Evidence: the existing gallery and emitted client-module model still hand-imports reducers and
    compiler-wired handlers; moving handlers to internal would violate `rules/api-surface.md`
    import-boundary constraints until a generated handler ABI and different L1 authoring story land.
  - Verification: `pnpm run check:imports`; `pnpm run check:kovo`.

- [x] Reverify the stale merge blockers.
  - Evidence: the earlier `check:publish` and `check:kovo` blockers were stale against current
    `main`; both are green after the API cleanup changes.
  - Verification: `pnpm run check:publish`; `pnpm run check:kovo`.

## Latest Verification

- [x] Focused API cleanup gates are green.
  - Evidence: `pnpm exec tsc --noEmit --pretty false`; `pnpm run check:api-surface`;
    `pnpm run check:exports`; `pnpm run check:imports`; `pnpm --dir site run api:check`;
    `pnpm run check:publish`; `pnpm run check:kovo`.
