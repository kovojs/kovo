# Public API Audit — Merged & Decisions Applied (2026-06-18)

**Provenance.** Consolidates two parallel runs of `/audit-public-api` against commit `f8351a0f`
(`audit-api-20260618-180210.md` and `…-180215.md`), reconciled by a blind judge panel + source
fact-checks, then updated with the owner decisions taken this session. Supersedes both timestamped
reports.

**Scope:** Manifest-public package subpaths from `public-packages.json` (12 public packages; 75 export
subpaths at audit time; 3,081 indexed symbols).
**Lens:** Conservative JS framework API review — _make it internal unless we really need it public_.
Three tests qualify a symbol to stay public: **(1) Forced** — a kept public signature names it and it
can't be inlined; **(2) Real external use** — imported by an example/site/starter (tests don't count);
**(3) SPEC mandate**.
**Sources:** `SPEC.md`, `rules/api-surface.md`, `STABILITY.md`, `public-packages.json`,
`site/gen/api/*.md`, examples/site usage, source declarations.
**Commands:** inventory helper (`scratch/public-api-inventory.{json,md}`); `pnpm run check:api-surface`
→ **FAILS**, 872 undocumented exports, **all `@kovojs/ui`** (the `export *` re-exports).
**Git:** audited at `main` @ `f8351a0f`.

> **`./vite` note.** Both source reports flagged `@kovojs/server/./vite` as an unclassified manifest
> gap. That was **correct at `f8351a0f`** (the server public list ended at `./jsx-dev-runtime`). The
> manifest has since been updated to add `./vite` to `apiBoundary.public`, so a re-check against the
> current tree no longer shows the gap — the finding is resolved, not wrong.

---

## Decisions Applied (this session)

1. **`@kovojs/ui` stays a versioned public library** (owner override) — _not_ downgraded to copy-in
   source. Assumed **dual distribution** (versioned package primary; `kovo add` copy-in retained).
   Consequence: hold ui to full public-API discipline (drop `export *`, document + type the surface),
   and reconcile `STABILITY.md` / `registry.json` / `copy-in.test.ts`, which currently contradict the
   versioned classification.
2. **headless-ui low-level layer → demoted**, split by who consumes it: hand-authored-island
   **reducers** (`set*`/`toggle*`/`*Move`/`*Typeahead`, gallery-only) → `@kovojs/headless-ui/internal`;
   **`@kovoPrimitiveHandler` event handlers** → **generated tier** (not internal), because
   compiler-emitted app client modules import them and emitted code may import generated ABI but not
   `internal`.
3. **better-auth `mount` + `betterAuthSignUpEmailMutation` → fully-supported Keep** (no
   `@experimental`).
4. **runtime root wiring →** add a documented `createBrowserKovoRoot()` (+ default enhanced fetch);
   move `MorphRoot`/`MorphTarget`/`DomMorphTarget`/`TargetCollectorRoot`/`EnhancedMutationFetch`
   `@internal`.
5. **createApp extension points → internal:** `mutationReplayStore` (+ store/reservation types) and the
   `VersionedClientModule` registry. **Consequence:** the public `CreateAppOptions.{mutationReplayStore,
clientModules}` fields must be dropped or narrowed to an opaque type so the option surface no longer
   names internal types.
6. **server/build deployment presets `node()`/`vercel()`/`cloudflare()` → Keep** (config authoring),
   `@experimental` until SPEC names supported targets; drop the redundant `*Preset` descriptor types.
7. **Corrections folded in:** `@kovojs/server#invalidate` → demote (SPEC §10.3 discourages manual
   invalidation; prefer `context.invalidate`); `@kovojs/headless-ui#kovoHeadlessUiPrefix` → remove
   (duplicates the `package.json` `kovo.prefix` manifest fact). Citation fix: `applyFragments` is at
   `morph.ts:122`.

---

## Executive Summary

Direction after decisions: a **small, mostly-forced or example-proven public surface**; everything else
demoted to `internal`/`generated` or removed. The largest _retained_ public surface is now
`@kovojs/ui`'s component layer (owner decision), which converts a removal into a **document-and-type**
obligation.

**The work, highest-leverage first:**

1. **`@kovojs/ui`: drop the 32 `export *` lines** (≈845 re-exported headless symbols). This is the
   `rules/api-surface.md` violation and the entire `check:api-surface` failure (872 undocumented
   exports). Components import the headless symbols they use _by name_; do **not** re-export. **Sequence:**
   first retarget the compiler's generated handler imports off `@kovojs/ui/<x>` (below), then delete the
   wildcards. Then **document + properly type** ui's ~634 owned exports (versioned-library obligation).
2. **`@kovojs/runtime/client`: shrink to a bootstrap facade.** ~95 of 115 exports are loader internals
   with zero non-test use (morph engine, query-binding apply, enhanced-mutation submit, optimistic
   rebaser, broadcast, refetch, event bus, submit-context, inline-query hydration). Keep
   `installKovoLoader` + `KovoLoader(Options)` + `createQueryStore` (+ new `createBrowserKovoRoot()`);
   move the rest behind the existing `./internal/*`. Fixes the dangling `QueryApplyInterposition` /
   `OnDeltaMiss` / `RuntimeErrorReporter` / `FragmentChunk` recursive-publicness leaks.
3. **`@kovojs/server` root: relocate ~37 request-shell/wire internal types** (document-assembly,
   deferred-stream, query-endpoint wire, route-page result, diagnostic-document) to `./internal/{html,
wire,route}`, where their functions already live. Also fixes `RoutePageFailure`/`QueryEndpointFailure`
   naming the `@internal` `ResolvedGuardFailure`.
4. **`@kovojs/test`: collapse 13 subpaths.** Demote `harness-operations`, `sql-observer`, `verifier-sql`,
   `verifier-diagnostics` (keep only `DbVerificationDiagnostic`), `verifier`, and the unused 2/3 of
   `html-fragment` to internal. ~61/83 exports are undocumented; consumers are framework tests + the
   private conformance package.
5. **Adopt a `generated` tier** for compiler-emitted ABI now sitting on human-public/undocumented
   subpaths: server `jsx-runtime`/`jsx-dev-runtime` (16), core registry seeds (3), runtime
   `applyDeferredStreamResponseToRuntime` (4), and the headless `@kovoPrimitiveHandler` handlers (110).
   Mirror `@kovojs/runtime/generated`.
6. **Empty/duplicate cleanups:** remove the empty public subpaths `@kovojs/server/app-shell/{core,node,
client-modules}` and the empty `@kovojs/test` root; de-duplicate `DiagnosticCode` (keep on
   `@kovojs/core` only; drop the `@kovojs/cli` and `@kovojs/drizzle` re-exports).
7. **Reconcile docs/tests with reality:** `STABILITY.md` / `registry.json` / `copy-in.test.ts` describe
   `@kovojs/ui` as private copy-in, but the manifest + `package.json` publish it as a versioned library
   — update the docs/test to the (owner-chosen) versioned/dual model.

---

## Disposition Index

Disposition vocabulary: **Keep** (public, no change) · **Keep+fix** (public but must document/retype/
narrow) · **→Generated** (compiler-emitted ABI tier) · **→Internal** (repo-internal subpath) ·
**Remove** (delete the export).

### `@kovojs/core`

| Family                                                                                                                                                                                                                                                                             |   # | Disposition | Rationale                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | ----------- | ----------------------------------------------------------------------------- |
| Keep set: `component`, component/render types, routing, `form`/`Form`/failure types, `query`, `DiagnosticCode`/`Severity`, `JsonValue`, `StorageCapability` interfaces, webhook-verifier kit, `ComponentDefinitionInput`, augmentable Query/Mutation/Route/Invalidation registries | ~55 | Keep        | Forced by signatures / SPEC §4,§6,§10 / heavy example use.                    |
| registry seeds `FragmentTargets`,`ComponentRegistry`,`LiveTargetRegistry`                                                                                                                                                                                                          |   3 | →Generated  | Compiler augmentation ABI; new `@kovojs/core/generated`, `@generated`.        |
| `ComponentMutationForms`                                                                                                                                                                                                                                                           |   1 | →Internal   | 0 uses; fold into `ComponentRenderSlots` (keep `ComponentMutationFormState`). |
| `event`/`EventDefinition`/`EventOptions`/`EventPayload`                                                                                                                                                                                                                            |   4 | →Internal   | Test-only; SPEC mandates runtime `emit()`, not a core declaration primitive.  |
| storage adapters (`createMemoryStorage`/`FileSystem`/`S3Compatible` + helpers)                                                                                                                                                                                                     |   7 | →Internal   | 0 example/SPEC. Keep the `StorageCapability` interface.                       |
| `S3Compatible*` shim types                                                                                                                                                                                                                                                         |   8 | →Internal   | Only type the S3 adapter; follow it.                                          |

### `@kovojs/style`

| Family                                                                                                                                                              |   # | Disposition | Rationale                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | ----------- | -------------------------------------------------------------------------------------------------------- |
| Keep set: `create`, `attrs`, `emitAtomicCss`, `keyframes`, `defineTheme`, `tokens`, core style/theme types, `AtomicRule`, `defineVars`/`Vars`/`createTheme`/`Theme` | ~30 | Keep        | SPEC §13.1 names `defineVars`/`createTheme`; `AtomicRule` forced by `emitAtomicCss` w/ real example use. |
| `createAtomicStyles` + `AtomicCssResult`                                                                                                                            |   2 | →Internal   | Compiler-only ABI; `./internal` already exists.                                                          |
| `props` + `PropsResult`                                                                                                                                             |   2 | Remove      | React-shaped; 0 uses; duplicates `attrs`.                                                                |
| `firstThatWorks`                                                                                                                                                    |   1 | Remove      | Trivial; 0 uses; inline the array.                                                                       |
| `themeFromSeed`                                                                                                                                                     |   1 | →Internal   | Duplicate of `defineTheme` seed form.                                                                    |
| `defineConsts` + `Consts`                                                                                                                                           |   2 | →Internal   | Thin `Object.freeze`; 0 uses.                                                                            |
| `raw`                                                                                                                                                               |   1 | →Internal   | Escape hatch, 0 uses. **Keep `InlineStyle`** (forced by `StyleInput`).                                   |
| `DefineThemeOptions` base-arm types (`DefineThemeFromBaseOptions`,`ThemeSchemeValues`,`ThemeSystemOverrides`,`ThemeComponentTokensInput`)                           |   5 | →Internal   | `base:` arm has 0 uses; collapse `defineTheme` to seed form for v1.                                      |

### `@kovojs/server` (root `.`)

| Family                                                                                                                                                                                                                                                                                                                                                                           |    # | Disposition             | Rationale                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep set: authoring verbs (`route`,`query`,`mutation`,`write`,`endpoint`,`layout`,`domain`,`tag`,`session`,`guards`,`s`,`respond`,`csrf*`,`notFound`,`redirect`,`href`,`Link`,`errorBoundary`) + their result/config types, schema/validation error types, CSRF/CSP/cookie options, error-shell/app-render types, static-export facade, node adapter, `meta`/`i18n`/`stylesheet` | ~140 | Keep                    | SPEC §6/§9/§10; example-proven; forced supporting types.                                                                                     |
| `invalidate`                                                                                                                                                                                                                                                                                                                                                                     |    1 | →Internal/@experimental | SPEC §10.3 discourages manual invalidation; prefer `context.invalidate`; 0 examples.                                                         |
| PageHints (`PageHints`,`PageHintRenderContext`,`StylesheetManifestEntry`,`stylesheetsForTargets`)                                                                                                                                                                                                                                                                                |    4 | →Internal               | Render plumbing. **Keep `PageHintOptions`** (`RouteDefinition extends`).                                                                     |
| `MutationRegistry`,`RegisteredQueryDefinition`,`QueryRerun`,`MutationTouchSite`,`RunMutationOptions`                                                                                                                                                                                                                                                                             |    5 | →Internal/Generated     | Compiler-populated registry + run-option bag; 0 author use.                                                                                  |
| `mutationReplayStore` family (`createMemoryMutationReplayStore`,`MutationReplayStore`,`MutationReplayReservation`)                                                                                                                                                                                                                                                               |    3 | →Internal               | Owner decision; drop/narrow `CreateAppOptions.mutationReplayStore`.                                                                          |
| `VersionedClientModule` registry (`createMemoryVersionedClientModuleRegistry` + types)                                                                                                                                                                                                                                                                                           |    4 | →Internal               | Owner decision; drop/narrow `CreateAppOptions.clientModules`.                                                                                |
| webhook family                                                                                                                                                                                                                                                                                                                                                                   |   13 | Keep + →Internal        | **Keep** `webhook`+author types (SPEC §9.1, forced); 6 wire/replay/status types →Internal.                                                   |
| file-upload schema (`FileSchema`,`FileSchemaOptions`,`NumberSchema`,`StoredFile*`,`FileLike`)                                                                                                                                                                                                                                                                                    |    7 | Keep+fix                | Forced by `s.file()/s.number()`; document. `MaybePromise` → **Remove** (inline `Promise<T>\|T`).                                             |
| `ServerErrorHandler` / `ServerErrorDiagnosticContext`                                                                                                                                                                                                                                                                                                                            |    2 | Keep+fix / →Internal    | Keep `ServerErrorHandler` (example-used, document); narrow/internal the phase-taxonomy context.                                              |
| Vite dev family (`createKovoAppShellViteDevIntegration`,`kovoAppShellViteDevPlugin`,+types)                                                                                                                                                                                                                                                                                      |    6 | →Internal               | `kovo()` from `@kovojs/server/vite` is the SPEC entry; migrate `site`/`devtool` configs.                                                     |
| component-render helpers (`renderComponentMutationFailure`,`componentMutationFailureSlots`,`ComponentRenderOptions`,`ComponentMutationFailureRenderOptions`)                                                                                                                                                                                                                     |    4 | →Internal               | 0 use. **Keep** `mutationFormAttributes`+`renderMutationFormAttributes`+`MutationFormAttributes` (heavy example use).                        |
| guard types (`GuardFailureResponseOptions`,`RequestLifecycleOptions`)                                                                                                                                                                                                                                                                                                            |    2 | →Internal               | Internal run/render option bags. **Keep** `GuardFailure` (deprecated cycle) + `Unauthenticated*`/`Forbidden*` (forced by `RouteDefinition`). |

### `@kovojs/server` (secondary subpaths)

| Family                                                                        |   # | Disposition        | Rationale                                                                                            |
| ----------------------------------------------------------------------------- | --: | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `createKovoViteIntegration` + `KovoViteIntegration`                           |   2 | →Internal          | Duplicates `kovo()`; 0 uses.                                                                         |
| `KovoViteDevServer`/`KovoViteMiddleware`/`KovoVitePostHook`                   |   3 | →Internal          | Restated Vite/Connect plumbing; 0 uses.                                                              |
| `KovoVitePlugin`                                                              |   1 | Keep+fix           | `kovo()` return type — narrow to Vite's `Plugin` or `{name:'kovo'}`.                                 |
| `kovo` + `KovoVitePluginOptions` (`./vite`)                                   |   2 | Keep               | SPEC §9.5 dev entry; example-used. (Also: classify `./vite` public — now done in tree.)              |
| deploy presets `node`/`vercel`/`cloudflare` + `*Options`                      |   6 | Keep @experimental | Owner decision; config authoring; SPEC doesn't yet name targets.                                     |
| preset descriptor types `NodePreset`/`VercelPreset`/`CloudflarePreset`        |   3 | Remove             | Redundant with `KovoPreset`; narrow return types.                                                    |
| `writeKovoNeutralBuild` + `WriteKovoNeutralBuildOptions` + `KovoNeutralBuild` |   3 | →Internal          | "Phase 0" CLI-only; leaks app-shell types. (Keep `defineConfig`/`KovoConfig`/`KovoPreset` contract.) |
| static-export manifest family (5 of 6)                                        |   5 | →Internal          | Internal build-artifact shapes. **Keep `StaticExportNonExportablePolicy`** (forced).                 |
| `jsx-runtime` + `jsx-dev-runtime` ABI                                         |  16 | →Generated         | JSX automatic-runtime ABI; reclassify `apiBoundary.generated`, `@generated`.                         |
| empty subpaths `app-shell/{core,node,client-modules}`                         |   0 | Remove             | Public subpaths exporting `export {}` — dead surface.                                                |

### `@kovojs/runtime`

| Family                                                                                                                                                                                                          |   # | Disposition    | Rationale                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Keep set (root `.`): `derive`, `handler`+context types, `trustedHtml`, `tempId`, `OptimisticFor` family                                                                                                         | ~18 | Keep           | SPEC §4.3/§4.8/§10.4-6; example-proven.                                                                             |
| `./client` bootstrap: `installKovoLoader`,`KovoLoader`,`KovoLoaderOptions`,`createQueryStore`,`QueryStore`/`QuerySnapshot`/`QueryUpdatePlan`                                                                    |  ~7 | Keep+fix       | The real human entry. Fix `KovoLoaderOptions` naming unexported `QueryApplyInterposition`.                          |
| `createBrowserKovoRoot()` + default fetch                                                                                                                                                                       | new | **Add (Keep)** | Owner decision; one helper so apps name zero low-level types.                                                       |
| `MorphRoot`,`MorphTarget`,`DomMorphTarget`,`TargetCollectorRoot`,`EnhancedMutationFetch`                                                                                                                        |   5 | →Internal      | Replaced by the helper.                                                                                             |
| `applyDeferredStreamResponseToRuntime` + 3 deferred-stream types                                                                                                                                                |   4 | →Generated     | Compiler-bootstrap ABI; starter imports from `./generated`; fix unexported return type.                             |
| `./client` loader internals (morph engine, query-bindings apply, enhanced-mutation submit, optimistic engine, event bus, broadcast, refetch, inline-query hydration, submit-context, handler-context/lifecycle) | ~95 | →Internal      | Zero non-test use; many leak unexported types. Move behind `./internal/{delegation,inline-loader,mutation,output}`. |

### `@kovojs/test` + `@kovojs/drizzle`

| Family                                                                                                                                                                                                           |   # | Disposition | Rationale                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: | ----------- | --------------------------------------------------------------------------------------------- |
| Keep set: `drizzle#kovo`+annotation types; test `propertyTest`/`assertMutationError`/`createKovoTestHarness`+ctx/options; `pglite`; `kovoTest`/`KovoTestCase`/`KovoTestRunner`; `enhancedMutationHeaders` family | ~25 | Keep        | SPEC §10/§11/§12; documented; example/site-used.                                              |
| `drizzle/derive#deriveOptimistic`                                                                                                                                                                                |   1 | →Internal   | Recursive-publicness (built from `core/internal/derivation`); CLI-only.                       |
| `drizzle#DiagnosticCode`                                                                                                                                                                                         |   1 | Remove      | Triple-exposed; import from `@kovojs/core`.                                                   |
| `test/harness#KovoTestRequest`                                                                                                                                                                                   |   1 | Remove      | Undocumented `{db}`, not referenced by the harness signature.                                 |
| `test/verifier` (`createDbVerifier`+DTOs)                                                                                                                                                                        |   5 | →Internal   | Harness wraps it; `TouchGraph` param internal; 3/5 undocumented.                              |
| `test/verifier-diagnostics` (assertions+message)                                                                                                                                                                 |   5 | →Internal   | Verifier internals. **Keep `DbVerificationDiagnostic`** via `./harness`.                      |
| `test/harness-operations`, `test/sql-observer`, `test/verifier-sql`                                                                                                                                              |  10 | →Internal   | Adapter/instrumentation internals; private-conformance-only; some leak `ObservationRecorder`. |
| `test/html-fragment` unused extractors/DTOs                                                                                                                                                                      |  23 | →Internal   | 0 example use; leak generated wire shapes.                                                    |
| `test/html-fragment` example-used extractors                                                                                                                                                                     |  11 | Keep+fix    | Real example use; **document**; consider consolidating behind `PageAssertion.fragment()`.     |
| `test/headers` generic helpers (`cookiePair`,`firstSetCookiePair`,`headerValues`,`setCookieValues`,`HeaderRecord`)                                                                                               |   5 | Keep+fix    | 4 example-used; **document**. `HeaderSource` → **Remove** (inline).                           |
| `test/page#createPageAssertion`                                                                                                                                                                                  |   1 | →Internal   | Thin constructor. **Keep `PageAssertion`** (harness return) via `./harness`.                  |
| `test#.` empty root                                                                                                                                                                                              |   0 | Remove      | Documented entry exporting nothing.                                                           |

### `@kovojs/compiler` + `@kovojs/cli` + `create-kovo`

| Family                                                                                |   # | Disposition     | Rationale                                                                                            |
| ------------------------------------------------------------------------------------- | --: | --------------- | ---------------------------------------------------------------------------------------------------- |
| `cli#kovoCheck`,`kovoExplain`,`runKovoCommand`,explain option types,`KovoCheckResult` | ~11 | Keep            | SPEC §11.4; `runKovoCommand` is a thin `string[]→number` facade (dispatcher stays `@internal`).      |
| `cli#KovoCheckInput`/`KovoExplainInput`                                               |   2 | Remove/redesign | Recursive-publicness onto `core/internal/graph`; make verifiers take opaque runtime-validated input. |
| `cli#DiagnosticCode`                                                                  |   1 | Remove          | Duplicate of core's; 0 cli use.                                                                      |
| `@kovojs/compiler`, `create-kovo`                                                     |   0 | (Keep)          | Confirmed: no app-facing public exports; no IR leak.                                                 |

### `@kovojs/headless-ui`

| Family                                                                                                                                     |    # | Disposition        | Rationale                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---: | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `*Attributes` builders + their `*AttributeOptions` + item/enum/orientation value types + `safeUrl`/`CollectionOrientation`/`TextDirection` | ~423 | Keep               | The versioned primitive contract (SPEC §4.6); ui + examples consume the builders; forced supporting types.                               |
| `@kovoPrimitiveHandler` event handlers (`*Click`,`*KeyDown`,…)                                                                             |  110 | →Generated         | Compiler-emitted client modules import them; generated tier (importable-by-emitted-code).                                                |
| reducers (`set*`,`toggle*`,`*Move`,`*Typeahead`,`*RovingIndex`,parsers)                                                                    |  180 | →Internal          | Gallery-only hand-authoring; `@kovojs/headless-ui/internal`.                                                                             |
| machinery types (`*State`,`*ChangeResult`,`*ChangeDetail`,`*Event`,`*PrimitiveAttributes`)                                                 |  220 | →Internal / narrow | Keep only the `*State`/`*AttributeOptions` the kept builders force; drop trivial `=Event` aliases; narrow opaque `*PrimitiveAttributes`. |
| root foundation kit (`cn`,`defineVariants`,`computeFloatingPosition`,nav/typeahead/change-detail/state-attr helpers)                       |   54 | →Internal          | Primitive-internal; 0 external use; duplicates `@kovojs/style`+clsx/cva.                                                                 |
| token sheet (`kovoUiTokenSheet*`)                                                                                                          |    8 | →Internal          | Tokens belong in `@kovojs/style`; keep only `kovoUiTokenSheetCss` if the build script needs it.                                          |
| `kovoHeadlessUiPrefix`                                                                                                                     |    1 | Remove             | Duplicates `package.json` `kovo.prefix` (SPEC §6.1.1 makes prefixes manifest-owned).                                                     |

### `@kovojs/ui` — versioned public library (owner decision)

| Family                                               |   # | Disposition        | Rationale                                                                                                                                       |
| ---------------------------------------------------- | --: | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `export *` headless re-exports                       | 845 | Remove             | `rules/api-surface.md` violation + the gate failure. Import headless symbols by name; don't re-export. Retarget compiler handler imports first. |
| `Component` factories (`Button`,`Dialog*`,`Table`,…) | 214 | Keep+fix           | Versioned public; **document** + replace `(props?: Record<string,unknown>) => any` with real typed props/returns.                               |
| `*Props` interfaces                                  | 187 | Keep+fix           | Versioned public component props; **document**.                                                                                                 |
| `*StyleOverrides` / `*StateProps`                    |  34 | Keep+fix (decide)  | Decide if per-slot overrides are a public contract; document or narrow.                                                                         |
| variant/enum types (`BadgeVariant`,`ButtonSize`,…)   |  13 | Keep+fix           | Document; import headless-origin ones (`MeterDataState`,…) from `@kovojs/headless-ui`.                                                          |
| `*Styles` namespace objects                          |  46 | Remove (un-export) | Exposing the full `StyleNamespaces<{…}>` literal pins every internal style key; module-local.                                                   |
| `*Classes` / `*ClassNames`                           | 186 | Remove (un-export) | Compiled atomic-class strings; pure implementation detail.                                                                                      |

---

## Top-Leverage Actions (with migration + sequencing)

1. **Fix the failing gate (`@kovojs/ui`).** Delete the 32 `export * from '@kovojs/headless-ui/*'` lines.
   **Before** deleting, retarget the compiler so generated `*.client.js` modules import primitive
   handlers from `@kovojs/headless-ui` (generated tier) instead of `@kovojs/ui/<x>` — verified consumers
   include `examples/gallery/src/generated/interactive/popover-demo.client.js:4` and ~31 others. Then
   document/type ui's owned exports to clear the api-surface ratchet.
2. **`@kovojs/runtime/client` facade.** Keep `installKovoLoader`/`KovoLoader`/`KovoLoaderOptions`/
   `createQueryStore` + add `createBrowserKovoRoot()`. Move the morph/submit/optimistic/broadcast/refetch/
   event-bus/handler-context families behind `./internal/{delegation,inline-loader,mutation,output}`
   (already declared). Promote or inline the unexported option types (`QueryApplyInterposition`,
   `OnDeltaMiss`, `RuntimeErrorReporter`, `FragmentChunk`). Migration: the starter switches its ~70-line
   root wiring to `createBrowserKovoRoot()`.
3. **`@kovojs/server` internal relocation.** Move the document-assembly, deferred-stream,
   query-endpoint-wire, route-page-result, and diagnostic-document type families to `./internal/{html,
wire,route}` next to their (already-internal) render functions. Keep `DocumentTemplate`/
   `DocumentTemplateContext` (named by `AppDocumentOptions.template`). Drop/narrow
   `CreateAppOptions.{mutationReplayStore,clientModules}` so the option surface stops naming the now-
   internal registries.
4. **`generated` tier.** Add generated subpaths for server `jsx-runtime`/`jsx-dev-runtime`, core
   registry seeds, runtime deferred-stream apply, and the headless `@kovoPrimitiveHandler` handlers;
   tag `@generated`; exclude from the human API reference. Mirror `@kovojs/runtime/generated`.
5. **`@kovojs/test` collapse.** Keep `test-case`/`harness`/`assertions`/`pglite` + documented
   `html-fragment`/`headers` subsets + `PageAssertion`/`DbVerificationDiagnostic` types; move the
   verifier/instrumentation subpaths internal. Net public test surface ≈ half its current 13 subpaths.
6. **Dead-surface & duplicate removal.** Delete empty `@kovojs/server/app-shell/{core,node,
client-modules}` and the empty `@kovojs/test` root from `exports` + manifest. Keep `DiagnosticCode`
   only on `@kovojs/core`.
7. **Docs/tests reconciliation for `@kovojs/ui`.** Update `STABILITY.md` (the "not a versioned
   dependency / copy-in only" paragraph), `packages/ui/registry.json` ("private package"), and
   `packages/ui/src/copy-in.test.ts` (asserts `private:true`, which is false) to the versioned/dual
   model.

---

## Coverage Ledger

Every manifest subpath at `f8351a0f` was reviewed; per-subpath export counts below (public unless
noted). Generated/internal rows were reviewed only for leaks/misclassification.

| Package                                                        | Subpath(s)                               |    Exports | Note                                                                          |
| -------------------------------------------------------------- | ---------------------------------------- | ---------: | ----------------------------------------------------------------------------- |
| `@kovojs/core`                                                 | `.`                                      |         91 | 91/91 documented; explicit barrel; 3 generated seeds flagged.                 |
| `@kovojs/style`                                                | `.`                                      |         51 | docs drift: `site/gen/api/style.md` documents a non-existent `CreateOptions`. |
| `@kovojs/server`                                               | `.`                                      |        226 | ~115 undocumented; `export *` from curated `api/*` sub-barrels (soft).        |
| `@kovojs/server`                                               | `./build`                                |         18 | presets + neutral-build.                                                      |
| `@kovojs/server`                                               | `./app-shell/static-export`              |         10 | manifest types internal-bound.                                                |
| `@kovojs/server`                                               | `./app-shell/{core,node,client-modules}` |          0 | **empty public subpaths — remove.**                                           |
| `@kovojs/server`                                               | `./jsx-runtime`, `./jsx-dev-runtime`     |      8 + 8 | JSX ABI → generated.                                                          |
| `@kovojs/server`                                               | `./vite`                                 |          8 | unclassified at `f8351a0f` (since added to manifest).                         |
| `@kovojs/runtime`                                              | `.`                                      |         18 | narrow authoring API — keep.                                                  |
| `@kovojs/runtime`                                              | `./client`                               |        115 | ~7 keep + helper; ~95 internal; 4 generated.                                  |
| `@kovojs/runtime`                                              | `./generated`                            |         38 | correct compiler ABI tier (leak-reviewed).                                    |
| `@kovojs/test`                                                 | 13 subpaths + empty `.`                  |         89 | 61/83 undocumented; collapse to ~half.                                        |
| `@kovojs/drizzle`                                              | `.`, `./derive`                          |          6 | `./derive` recursive-publicness → internal.                                   |
| `@kovojs/better-auth`                                          | `.` (+ `./internal`)                     |         13 | gate-clean; structural types nameable only via `./internal` (curation note).  |
| `@kovojs/headless-ui`                                          | `.` + 34 primitive subpaths              |        934 | versioned dep; **no API-ref page** (gap); ~930/934 undocumented.              |
| `@kovojs/style`/`@kovojs/cli`/`@kovojs/compiler`/`create-kovo` | (above / none)                           | 13 / 0 / 0 | compiler+create-kovo export nothing app-facing.                               |
| `@kovojs/ui`                                                   | 44 component subpaths + empty `.`        |      1,479 | 845 headless re-exports (drop); 634 owned (document/type/un-export).          |

---

## Cross-Cutting Recommendations

1. **Tighten the api-surface gate to catch recursive-publicness.** It currently passes when public
   signatures name unexported/internal types, because boilerplate JSDoc satisfies the "documented" check.
   The gate should fail with the exact symbol path when a public signature references a non-public type
   (this audit found it in `@kovojs/runtime/client`, `@kovojs/cli`, `@kovojs/drizzle/derive`,
   `@kovojs/test`, and `@kovojs/server`).
2. **Use a `generated` tier consistently** for compiler-emitted ABI; stop parking it on human-public
   barrels (`@kovojs/runtime/generated` is the model).
3. **Ban `export *` on every public barrel, not just roots** — `@kovojs/ui` (hard) and `@kovojs/server`
   `index.ts` (soft, via curated sub-barrels) both rely on it.
4. **Resolve "two of everything" before v1:** style `defineTheme/tokens` vs `defineVars/createTheme`,
   `attrs` vs `props`; server `kovo()` vs `createKovoViteIntegration()`; `DiagnosticCode` on four entries.
5. **Document the versioned dependencies.** `@kovojs/headless-ui` has no generated API-ref page at all,
   and `@kovojs/ui`/`@kovojs/test` are largely undocumented — a v1 blocker for packages under SemVer.

---

## Gaps & Follow-Up

- **`pnpm run check:api-surface` fails** (872 undocumented `@kovojs/ui` exports). Top-Leverage #1 is the
  fix; it cannot pass until the `export *` is dropped and the retained surface documented.
- **Docs/source drift:** `site/gen/api/style.md` documents a `CreateOptions` type + call shape absent
  from source; regenerate or export `StyleIdentityOptions` as `CreateOptions`.
- **No API-ref page for `@kovojs/headless-ui`** (the flagship versioned primitive dep).
- **Open product question (assumed resolved):** `@kovojs/ui` dual distribution (versioned + copy-in). If
  versioned-_only_, also remove `registry.json` and the `kovo add` copy-in path; this report assumes
  dual and keeps both.
- **Method:** audit-only — no source edits; coverage counts are reviewed-export tallies. `@kovojs/better-
auth`'s public types are nameable only via the explicitly-unstable `./internal` subpath — a deliberate
  curation choice to confirm, not a violation.
