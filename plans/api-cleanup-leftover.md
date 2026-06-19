# API Cleanup — Leftover Work

Tracks what the `agent/api-cleanup-impl` public-API cleanup **did not** complete, and why.
The cleanup was driven by `plans/audit-api-20260618-merged.md` (an audit taken at commit
`f8351a0f`); `main` had moved many merges past that point, so several plan items turned out to be
**stale or incorrect against current `main`** — those are recorded here, not silently dropped.

## What landed (green)

- 6 package internalization/removal slices (core, style, cli, test, drizzle, server) + the headline
  **`@kovojs/ui` `export *` removal** (32 files → ~845 headless re-exports left the public surface).
- Net public-surface reduction: `api-surface` baseline **2586 → ~1629** (the exact number floats as
  reverts below were applied).
- Green at merge on: `tsc`, `vp check` (format+lint+type), `api-surface`, `import-boundary`,
  `exports`-duplicates, manifest, `typecheck-examples`, `api-ref` (12/12), and the unit suite
  (~3065 tests). `vp run build` passes. (`check:kovo` — see below.)

## Deferred / NOT done (with rationale)

1. **Core registry seeds → `generated` tier — INFEASIBLE without a compiler change.**
   `FragmentTargets` / `ComponentRegistry` / `LiveTargetRegistry` stay on the public `.` barrel. TS
   `declare module '@kovojs/core'` augmentation (compiler `emit/registry.ts`) only merges with
   interfaces exported from the _barrel_ module, and `rules/api-surface.md`/the gate forbid
   `@generated` on a public subpath — mutually exclusive. To move them, the compiler must emit
   augmentation against a `@kovojs/core/generated` module instead. **Owner: compiler.**

2. **`@kovojs/cli` `kovoCheck`/`kovoExplain` opaque-input redesign — DEFERRED.**
   `KovoCheckInput`/`KovoExplainInput` remain `extends CoreGraph.*` (`@internal` types from
   `@kovojs/core/internal/graph`) — main's pre-existing shape (restored to avoid leaking `@internal`
   into `cli.md`). The proper fix is to make the verifiers accept an opaque runtime-validated input
   (`input: unknown`, validated by the existing `validateKovoExplainInput`) so app code never names
   the IR graph. This is a public-contract change (the external `explain-artifact-smoke` test imports
   `type KovoExplainInput`) and is also tracked by the in-flight `plans/api-export-cleanup.md`.

3. **headless-ui reducer + `@kovoPrimitiveHandler` handler layer → internal/generated — NOT done
   (kept public).** This layer is the _demonstrated L1 island-authoring contract_: the gallery demos
   hand-import and call both the reducers (`set*`/`toggle*`/`*Move`) and the handlers, and
   compiler-emitted client modules import the handlers. Internalizing it would break the gallery's
   authoring pattern and create app→internal / emitted-code→internal import-boundary violations. To
   actually demote it: (a) handlers must go to a **generated** tier (emitted code may import generated
   but not internal); (b) the gallery L1 demo corpus must migrate off hand-importing the reducers, or
   accept they remain the public L1 surface. Needs a product decision on the L1 authoring story.

4. **headless-ui foundation kit + token sheet → internal — NOT done.**
   `cn` / `defineVariants` / `computeFloatingPosition` / nav-typeahead / change-detail / state-attr
   helpers (~54 root-barrel symbols) and the `kovoUiTokenSheet*` token-sheet (~8) remain public.
   They showed no external consumers in a quick grep, but were left to avoid more consumer whack-a-mole
   under time pressure; verify consumers, then move to `@kovojs/headless-ui/internal` (and consider
   relocating the token sheet to `@kovojs/style`, the SPEC §13.1 token authority). `kovoHeadlessUiPrefix`
   **was** removed (clean — duplicated the `package.json` `kovo.prefix` manifest fact).

5. **`check:publish` — NOT verified locally (sandbox-blocked).** `node scripts/build-publish.mjs`
   (build + verify `publishConfig` targets resolve) was denied by the sandbox as a "publish" action.
   It does not publish to a registry, but it could not be run here. `vp run build` (the underlying
   build) **does** pass, so dist emits cleanly; CI should run `check:publish` to confirm
   publish-readiness of the new/changed `exports`/`publishConfig` (notably the added `@kovojs/core`
   `internal/{event,storage,component-render}` and `@kovojs/runtime/internal/morph` subpaths).

6. **`check:kovo` — see merge-status note below.** The runtime `./client` facade-shrink orphaned
   engine symbols that the framework harness `tests/kovo-check.node.mjs` imports; a fix re-homing them
   on runtime internal subpaths + repointing the harness was in progress at merge. If it did not fully
   land, `check:kovo` may be red in CI and must be finished (re-home `morphStructuralTree`,
   `installPagehideOptimismCleanup`, `readElementParams`, `refetchQueries` on `@kovojs/runtime/internal/*`
   and repoint `tests/kovo-check.node.mjs` to the internal/generated dist subpaths).

## Plan items deliberately REVERTED to public (deviations from the audit, with rationale)

The audit's "no consumer / test-only → internalize" calls were stale; current `main` has real
consumers, so under the owner's "internal unless we really need it" rule these were kept **public**:

- **`createMemoryVersionedClientModuleRegistry` + `VersionedClientModuleRegistry` types +
  `CreateAppOptions.clientModules`** — used by `examples/reference` + `site`.
- **`createMemoryMutationReplayStore` + `MutationReplayStore`/`MutationReplayReservation`** — used by
  `conformance/webhook-spike`. (`CreateAppOptions.mutationReplayStore` restored — was an accidental
  regression.)
- **`StructuralMorphNode` + `StructuralMorphBrowserState` + `StructuralMorphKey`** (runtime `./client`
  types) — used by `examples/commerce` + conformance test helpers.
- **Server Vite-dev family** (`createKovoAppShellViteDevIntegration`, `kovoAppShellViteDevPlugin`, +
  types) — used by the create-kovo starter template's own `vite.config.ts`, `site`, `examples/devtool`.
- **`@kovojs/test/html-fragment`** — split reverted to main's monolithic all-public form (the 23
  "unused" extractors are public again, as on main); the split's relative `./html-fragment-impl.js`
  import broke `check:kovo`'s source loading. This was the lowest-value internalization.

## Consumer migrations that WERE done (to keep the runtime facade-shrink)

- `@kovojs/runtime/client` narrowed to `installKovoLoader` + `createQueryStore` +
  `createBrowserKovoRoot` (new) + `defaultEnhancedFetch` (new) + kept public types. ~95 engine
  internals moved to `@kovojs/runtime/internal/{delegation,inline-loader,mutation,morph,output}`.
- 14 `tests/integration/fixtures/**` white-box engine fixtures repointed to the internal subpaths.
- create-kovo starter `templates/src/client.ts` migrated to `createBrowserKovoRoot()`.

## Coordination with active in-flight branches (IMPORTANT)

This branch was implemented **independently** per the owner's instruction, but overlapping work is
in flight on `main`'s trajectory and tracks `plans/api-export-cleanup.md`:

- **`agent/api-headless-subpaths`** — headless-ui subpath cleanup + ui import rewrites + gallery regen
  (same files as this branch's ui/headless work). High conflict/duplication risk; reconcile.
- **`agent/api-vite-export-internalization`** — the curated `@kojs/server/app-shell/vite` build/export
  facade (the _intended_ home for the Vite-dev family this branch kept public on root). The Vite-dev
  family should ultimately move to that curated subpath rather than stay on the server root.

`plans/api-export-cleanup.md` is the canonical roadmap for the remaining surface work (one-home-per-
symbol, `@kojs/cli` package rename, dropping app imports of `@kovojs/compiler`, removing vendor
webhook helpers) and should absorb the deferred items above.

## Verification status at merge

- Green: `tsc`, `vp check`, `api-surface`, `import-boundary`, `exports`, manifest, `typecheck-examples`,
  `api-ref` (12/12), unit suite (~3065), `vp run build`.
- Not locally green/verified: `check:publish` (sandbox-blocked), `check:kovo` (fix in progress at
  merge — confirm in CI), browser/integration/perf/conformance suites (not run here — require
  Playwright/long runs; run in CI).
