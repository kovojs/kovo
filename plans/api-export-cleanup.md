# API Export Cleanup

Created 2026-06-17. Behavioral source of truth is `SPEC.md`; API-boundary mechanics
are governed by `rules/api-surface.md`. This ledger scopes the `@kovojs/server`
app-shell Vite export cleanup: choose the public build/dev/export contract, keep
raw host internals behind internal subpaths, and make the manifest/docs/gates agree.
It also tracks package-shape cleanup needed before the public API surface is
stable: `@kovojs/ui` is public, and the CLI package must be named `@kovojs/cli`
while continuing to install a `kovo` binary.

## Goal

`@kovojs/server/app-shell/vite` should be an intentional app-author build-time API,
not an accidental public-looking path classified as internal. The curated subpath
should expose only the Vite dev plugin and static-export/build helpers that starter
templates, examples, and app-owned scripts need. Lower-level raw plugin wiring,
output planning, manifest parsing, staging, and dev diagnostic internals should stay
behind `@kovojs/server/internal/app-shell-vite`.

This follows `SPEC.md` §9.5: app-shell dev/build/export replay starts from the
framework request shell and `createApp()` aggregate; the public API should name that
contract directly instead of forcing app authors through an `internal` import.

The same cleanup pass should remove app-author imports of `@kovojs/compiler`.
Compiler APIs may remain framework-internal build machinery, but generated starter
apps and app-owned scripts should not import them directly. `kovo` should be the
public facade for app checks/verification, and any remaining direct compiler imports
should be limited to framework packages, repo examples/tests, or internal tooling
until a replacement CLI command exists.

`@kovojs/headless-ui` should also match the `@kovojs/ui` import shape: every
component/primitive family gets a direct package subpath such as
`@kovojs/headless-ui/button`, instead of requiring consumers to remember the
`./primitives/*` namespace. `@kovojs/ui` copy-in code should be able to import its
headless behavior dependency through the same family-oriented subpath pattern.

Across all public packages, an exported symbol should have one public home: either
the package root or one subpath, never both. Duplicate root+subpath exports make
the API harder to document, weaken deprecation/migration guidance, and let app
authors depend on accidental aliases. If a compatibility alias is temporarily
needed, it must be explicit, documented, bounded by this plan, and mechanically
reported until removed.

For `@kovojs/server`, use the root for symbols most apps reasonably need. Do not
keep compatibility re-export paths for the same symbols on app-shell subpaths:
move them, update imports/tests/docs in the same slice, and let the old subpath
import fail. Subpaths should own narrow subsystem/tooling APIs only.

When uncertain, keep a symbol internal. Kovo can always promote a proven app-facing
API later, but public symbols are expensive to remove. Public server exports should
be declarations, configuration, and narrowly useful app helpers; request-shell
execution/rendering machinery should stay internal unless a real app-authored use
case is documented.

Any public symbol must have a fully public signature. If a public function, class,
type, or constant exposes an internal type through parameters, return values,
properties, callbacks, generic constraints/defaults, or overloads, either promote
that supporting type too or make the original symbol internal. This rule is now
part of `rules/api-surface.md` and should be enforced as this plan shrinks public
surfaces.

`@kovojs/ui` is a public package, not a private starter-only package. It should be
versioned, published, documented, and governed by the same root/subpath export
rules as the other public packages. The copy-in story can still exist, but it is
not a reason to mark the package private.

The CLI package name must be `@kovojs/cli`. The executable can and should remain
`kovo`, but package imports, dependencies, manifest entries, publish metadata, and
docs should stop referring to the package as plain `kovo`.

Framework packages should not export vendor-specific webhook helpers such as
Stripe. Those recipes are too app-specific for Kovo's package surface; examples can
inline Stripe signature verification locally when they need to demonstrate an
integration. Framework packages should expose only generic webhook primitives.

## Current Baseline

- [x] **The symbol CLI exposes the mismatch.**
  - Evidence: `pnpm symbols --json > /tmp/kovo-symbols.json` shows
    `@kovojs/server/app-shell/vite` exports 39 symbols, while
    `public-packages.json` currently lists `./app-shell/vite` under
    `apiBoundary.internal`.
- [x] **The API gate has no new boundary failures, so this is a shape cleanup rather than a failing regression.**
  - Evidence: `node scripts/api-surface-gate.mjs` reports
    `api-surface/v1 public-exports-needing-attention=2904 (baseline=2904,
    fixed-this-run=0)`.
- [x] **Templates and examples already depend on the public-looking app-shell Vite path.**
  - Evidence: `site/vite.config.ts`, `examples/*/vite.config.ts`,
    `examples/*/scripts/export-static.mjs`, and
    `packages/create-kovo/templates/scripts/export-static.mjs` load
    `@kovojs/server/app-shell/vite`.
- [x] **A broader internal app-shell Vite barrel already exists.**
  - Evidence: `packages/server/src/internal/app-shell-vite.ts` exports raw plugin,
    output, client-module, manifest, static-asset, and dev diagnostic internals.
- [x] **The create-kovo starter currently exposes compiler APIs to app authors.**
  - Evidence: `packages/create-kovo/templates/src/app.fixpoint.test.ts` imports
    `assertFixpoint`, `assertRenderEquivalence`, and `compileComponentModule`
    from `@kovojs/compiler`; `packages/create-kovo/templates/scripts/emit-graph.mjs`
    imports `deriveAppGraph` from `@kovojs/compiler`; the starter template
    `package.json` lists `@kovojs/compiler` in `devDependencies`.
- [x] **Examples also use compiler APIs in app-owned maintenance scripts.**
  - Evidence: `examples/*/scripts/emit-components.mjs`,
    `examples/*/scripts/emit-graph.mjs`, and `examples/*/scripts/emit-ui-css.mjs`
    import `@kovojs/compiler`, `@kovojs/compiler/graph`, or
    `@kovojs/compiler/package-styles`.
- [x] **Headless UI currently uses a nested primitive namespace unlike `@kovojs/ui`.**
  - Evidence: `packages/headless-ui/package.json` exports `./primitives` and
    `./primitives/<family>` subpaths, while `packages/ui/package.json` exports
    direct family subpaths like `./accordion`, `./button`, `./select`, and
    `./tooltip`.
- [x] **The symbol CLI can expose duplicate public homes.**
  - Evidence: `pnpm symbols --json` groups every exported symbol by package and
    export path, which is enough to detect names exported by both a package root
    and one or more public subpaths.
- [x] **`@kovojs/ui` is currently marked private.**
  - Evidence: `packages/ui/package.json` has `"private": true`, while its export
    map already exposes the same direct component-family subpath shape this plan
    wants for headless-ui.
- [x] **The CLI package currently uses the unscoped package name `kovo`.**
  - Evidence: `packages/cli/package.json` has `"name": "kovo"` and `bin.kovo`;
    workspace dependencies and template devDependencies refer to `kovo`.
- [x] **`@kovojs/core` currently exposes Stripe-specific webhook symbols.**
  - Evidence: `packages/core/src/index.ts` exports `stripeSignature` and
    `StripeSignatureOptions`; `pnpm symbols --json` reports both from
    `@kovojs/core`.

## Decisions

- [x] **Use option 2: make `@kovojs/server/app-shell/vite` public, but curated.**
  - Rationale: starter apps and app Vite configs are app-author code. Moving their
    imports to `@kovojs/server/internal/app-shell-vite` would make generated apps
    depend on an explicitly internal contract.
- [x] **Keep low-level host/build machinery internal.**
  - Rationale: `rules/api-surface.md` says internal subpaths expose repo-internal
    contracts and should use the narrowest subsystem path. Raw Vite plugin hooks,
    manifest parsers, output planners, and staging helpers are implementation
    machinery for the curated app-shell Vite API.
- [x] **Remove compiler APIs from generated starter apps.**
  - Rationale: the starter should teach app authors to use `kovo check`, generated
    artifacts, and app-shell tests, not direct compiler imports. The fixpoint test
    is framework conformance work, not starter-app responsibility.
- [x] **Make headless-ui family imports consistent with ui family imports.**
  - Rationale: `@kovojs/ui` is a copy-in starter package whose copied source
    depends on public `@kovojs/headless-ui`. Matching direct family subpaths keeps
    the copy-in import contract predictable and avoids a special `primitives/`
    namespace only for behavior helpers.
- [x] **One symbol, one public home.**
  - Rationale: public root barrels should curate broadly useful package APIs;
    family/subsystem subpaths should own their local symbols. Re-exporting the
    same symbol from both makes the boundary ambiguous and doubles API debt.
- [x] **Root is canonical for common `@kovojs/server` app APIs; no compatibility aliases.**
  - Rationale: if most apps need a server symbol, its import path should be
    `@kovojs/server`. The app-shell subpaths should not keep duplicate aliases
    after the move.
- [x] **Move server support helpers to internal paths, not public subpaths.**
  - Rationale: client-module response rendering, client-module href construction,
    static-export manifest/assertion helpers, and diagnostic formatting helpers
    are framework support/tooling details. App scripts should use higher-level
    public APIs or local formatting, not import those helpers from public
    `app-shell/*` subpaths.
- [x] **Prefer internal-only for uncertain server helpers.**
  - Rationale: app code should primarily declare routes, queries, mutations,
    webhooks, guards, and renderers. The framework owns dispatch, endpoint
    execution, route-page rendering, mutation/query wire response generation, and
    diagnostic/static-export plumbing unless a specific app use case proves
    otherwise.
- [x] **Make `@kovojs/ui` public.**
  - Rationale: app authors should be able to depend on the UI package directly as
    a versioned Kovo package. Copy-in can remain a supported workflow, but it
    should not make the package private.
- [x] **Rename the CLI package to `@kovojs/cli`; keep the `kovo` bin.**
  - Rationale: package names should stay under the `@kovojs/*` namespace. The
    command contract remains `kovo`, but the importable package/dependency is
    `@kovojs/cli`.
- [x] **Remove vendor-specific symbols from framework package exports.**
  - Rationale: Stripe is an example integration, not a Kovo framework primitive.
    The framework should provide generic HMAC/webhook verification building
    blocks; app examples can inline provider-specific recipes.
- [x] **Public signatures require transitive public types.**
  - Rationale: a public symbol is not usable or documentable if its parameter or
    return graph requires internal/generated names. Public promotion must include
    the full type closure, or the original symbol should stay internal.

## Implementation Plan

- [x] **Classify `./app-shell/vite` as public in `public-packages.json`.**
  - Move `@kovojs/server` `apiBoundary` entry `./app-shell/vite` from `internal`
    to `public`.
  - Keep `./internal/app-shell-vite` classified as internal.
  - Evidence: `public-packages.json` lists `./app-shell/vite` under
    `@kovojs/server.apiBoundary.public` and `./internal/app-shell-vite` under
    `apiBoundary.internal`; `pnpm exec vitest --run scripts/public-packages.test.mjs`
    passes and asserts this split.
- [x] **Define the curated `@kovojs/server/app-shell/vite` symbol set.**
  - Keep the app-author dev/export helpers used by starters and examples:
    `kovoAppShellViteDevPlugin`,
    `exportKovoAppShellViteBuildWithManifestFromManifestFile`,
    `kovoAppShellViteManifestStylesheetHrefFromFile`, and the direct build/export
    helpers needed by app-owned build scripts.
  - Decide whether `createKovoAppShellViteBuild*`,
    `exportKovoAppShellViteBuild*`, and `staticExport*ForKovoAppShellViteBuild*`
    are first-class public build helpers now, or deferred until
    `plans/easy-deployment.md` promotes a full `kovo build` surface.
  - Evidence: `packages/server/src/api/app-shell/vite.ts` exports the curated
    public values `kovoAppShellViteDevPlugin`,
    `exportKovoAppShellViteBuildWithManifestFromManifestFile`, and
    `kovoAppShellViteManifestStylesheetHrefFromFile`, plus their public type
    closures. `pnpm exec vitest --run packages/server/src/api/app.test.ts`
    passes and pins the runtime value export names.
- [x] **Move non-curated symbols off the public Vite subpath.**
  - Remove raw/low-level symbols from `packages/server/src/api/app-shell/vite.ts`
    when they are not part of the app-author contract.
  - Ensure removed symbols remain reachable, if needed, from
    `packages/server/src/internal/app-shell-vite.ts`.
  - Evidence: `packages/server/src/internal/app-shell-vite.ts` owns the raw Vite
    plugin, build-output, client-module, manifest, static-asset, and dev
    diagnostic internals. `pnpm exec vitest --run packages/server/src/api/app.test.ts
    packages/server/src/vite-plugin-boundary.test.ts` passes, including negative
    assertions that raw build/plugin/manifest helpers are not exported from
    `@kovojs/server/app-shell/vite`.
- [x] **Update docs/API reference for the public app-shell Vite API.**
  - Ensure `site/scripts/api-ref.mjs` includes the newly public server subpath or
    otherwise records why this build-time API is documented outside generated API
    pages.
  - Add or update docs that show starter Vite config/static export imports from
    `@kovojs/server/app-shell/vite`.
  - Evidence: `public-packages.json` declares the `server-app-shell-vite` API ref
    entry; `site/scripts/api-ref.test.mjs` now expects
    `server-app-shell-vite.md` and the generated entry reports 8 documented
    exports. Starter docs and scripts reference
    `@kovojs/server/app-shell/vite`. Verification:
    `pnpm exec vitest --run site/scripts/api-ref.test.mjs packages/create-kovo/src/index.test.ts`.
- [x] **Add boundary tests for the curated split.**
  - Add a test that pins the public `@kovojs/server/app-shell/vite` export names.
  - Add a test that pins representative internal-only names behind
    `@kovojs/server/internal/app-shell-vite`.
  - Evidence: `packages/server/src/api/app.test.ts` pins the public
    `@kovojs/server/app-shell/vite` value exports and asserts raw Vite helpers are
    absent; `packages/server/src/vite-plugin-boundary.test.ts` proves the raw
    plugin remains available from `./internal/app-shell-vite`.
- [x] **Regenerate/check publish metadata after export-map changes.**
  - If package exports or entry files change, run
    `node scripts/build-publish.mjs --write` before verification.
  - Evidence: no export-map rewrite was needed in this slice; `node
    scripts/build-publish.mjs` passes and confirms every `publishConfig` target
    exists for the current export maps.
- [ ] **Run focused verification, then broad gates.**
  - Focused: `pnpm --filter @kovojs/server exec vitest run` plus tests for
    `packages/create-kovo` template expectations.
  - Broad: `pnpm run check:api-surface`, `pnpm run check:publish`, and
    `pnpm run check`.
  - Evidence:

## Server Root Canonicalization

- [x] **Move common app-shell types to `@kovojs/server` root.**
  - Add root exports for `RequestHandler`, `AppDocumentOptions`,
    `AppErrorShellOptions`, `ErrorShellRenderer`, `AppRouteRenderContext`,
    `AppMutationResponseContext`, `AppMutationResponseOptions`, and
    `AppMutationResponseResolver`.
  - Remove those symbols from `@kovojs/server/app-shell/core`; do not keep
    compatibility re-exports.
  - Evidence: `packages/server/src/index.ts` exports the common app-shell types
    from the root and `packages/server/src/api/app-shell/core.ts` no longer
    re-exports them. `packages/server/src/api/app.test.ts` has compile-time root
    assertions and `@ts-expect-error` old-subpath assertions for the full moved
    set. Verification: `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
    `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`; `git diff --check`.
- [x] **Move Node adapter companion types to `@kovojs/server` root.**
  - Add root exports for `NodeHandlerOptions` and `NodeRequestHandler`.
  - Remove those symbols from `@kovojs/server/app-shell/node`; do not keep
    compatibility re-exports.
  - Evidence: `packages/server/src/index.ts` exports `NodeHandlerOptions` and
    `NodeRequestHandler` from the root, while
    `packages/server/src/api/app-shell/node.ts` exports only `toNodeHandler`.
    `packages/server/src/api/app.test.ts` asserts root availability and old
    subpath removal at compile time. Verification:
    `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
    `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`; `git diff --check`.
- [x] **Move common client-module registry types to `@kovojs/server` root.**
  - Add root exports for `MemoryVersionedClientModuleRegistryOptions`,
    `VersionedClientModuleRegistry`, and `VersionedClientModuleInput`.
  - Remove those symbols from `@kovojs/server/app-shell/client-modules`; do not
    keep compatibility re-exports.
  - Evidence: `packages/server/src/index.ts` exports the registry companion
    types from the root, while
    `packages/server/src/api/app-shell/client-modules.ts` keeps only the support
    request/response types. `packages/server/src/api/app.test.ts` asserts root
    availability and old subpath removal at compile time. Verification:
    `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
    `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`; `git diff --check`.
- [x] **Move static-export core types to `@kovojs/server` root.**
  - Add root exports for `StaticExportOptions`, `StaticExportResult`,
    `StaticExportDiagnostic`, `StaticExportDiagnosticSeverity`, and
    `StaticExportError`.
  - Remove those symbols from `@kovojs/server/app-shell/static-export`; do not
    keep compatibility re-exports.
  - Evidence: `packages/server/src/index.ts` exports `StaticExportError` and the
    static-export core types from the root, while
    `packages/server/src/api/app-shell/static-export.ts` no longer re-exports
    those names. `packages/server/src/api/app.test.ts` asserts root type/value
    availability and old subpath removal. Verification:
    `pnpm exec vitest --run packages/server/src/api/app.test.ts`;
    `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
    `git diff --check`.
- [x] **Move Vite dev-plugin app setup API to `@kovojs/server` root.**
  - Add root exports for `kovoAppShellViteDevPlugin`, `KovoAppShellViteDevPlugin`,
    and `KovoAppShellViteDevPluginOptions`.
  - Remove those symbols from `@kovojs/server/app-shell/vite`; do not keep
    compatibility re-exports.
  - Evidence: `packages/server/src/index.ts` exports the dev-plugin value/types;
    `packages/server/src/api/app-shell/vite.ts` no longer exports them. Verification:
    `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts`;
    `corepack pnpm exec vitest --run packages/create-kovo/src/index.test.ts packages/server/src/vite-dev-middleware.test.ts`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`;
    `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs`;
    `node scripts/build-publish.mjs`;
    `git diff --check`.
- [ ] **Remove existing root/subpath duplicates from app-shell subpaths.**
  - Remove duplicate subpath exports for root-owned symbols such as `createApp`,
    `createRequestHandler`, `route`, `layout`, `respond`, `toNodeHandler`,
    `exportStaticApp`, and `createMemoryVersionedClientModuleRegistry`.
  - Update all repo imports to use `@kovojs/server` for those symbols.
  - Evidence:
- [ ] **Keep tooling/support helpers subpath-only.**
  - Keep Vite build/export replay helpers, manifest/output bundle types,
    `internal/*`, and JSX runtime exports off the root.
  - Move client-module response/href helpers and static-export manifest/assertion
    helpers to internal subpaths instead of keeping them public subpath APIs.
  - [x] Client-module response/href helper portion is internal-only.
    - Evidence: `packages/server/src/api/app-shell/client-modules.ts` exports only
      `createMemoryVersionedClientModuleRegistry`; `packages/server/src/internal/client-modules.ts`
      exports `renderVersionedClientModuleResponse`, `versionedClientModuleHref`,
      `VersionedClientModuleRequest`, and `VersionedClientModuleResponse`.
      Verification: `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts`;
      `node scripts/api-surface-gate.mjs`.
  - [x] Static-export support helper portion is internal-only.
    - Evidence: `packages/server/src/api/app-shell/static-export.ts` exports only
      `exportStaticApp`; `packages/server/src/internal/static-export.ts` exports
      the manifest/assertion/output-plan and diagnostic formatter/guard helpers.
      Verification: `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts packages/create-kovo/src/index.test.ts`;
      `node scripts/api-surface-gate.mjs`.
- [x] **Move client-module support helpers behind an internal server subpath.**
  - Remove `renderVersionedClientModuleResponse`, `versionedClientModuleHref`,
    `VersionedClientModuleRequest`, and `VersionedClientModuleResponse` from
    `@kovojs/server/app-shell/client-modules`.
  - Keep them available only to server internals/tests, for example via a new or
    existing internal client-module subpath.
  - Evidence: `@kovojs/server/internal/client-modules` is declared in
    `packages/server/package.json` and `public-packages.json`; `packages/server/src/api/app.test.ts`
    asserts the public subpath lacks the moved value/type exports and the internal
    subpath exposes the helper values/types. Verification:
    `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts`;
    `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
    `git diff --check`.
- [x] **Move static-export manifest/assertion helpers behind an internal server subpath.**
  - Remove `staticExportManifest`, `staticExportInventory`,
    `staticExportOutputPlan`, `assertStaticExportManifestMatchesResult`, and
    `assertStaticExportManifestUsesDirectoryIndexDocuments` from
    `@kovojs/server/app-shell/static-export`.
  - Keep them available only to framework build/export internals and tests.
  - Evidence: `packages/server/src/api/app-shell/static-export.ts` exports only
    `exportStaticApp` as a runtime value, while
    `packages/server/src/internal/static-export.ts` re-exports the manifest,
    assertion, and output-plan helpers with `@internal` source declarations.
    Verification: `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts
    packages/create-kovo/src/index.test.ts`; `corepack pnpm exec tsc -p
    tsconfig.json --noEmit --pretty false`; `node scripts/api-surface-gate.mjs`;
    `git diff --check`.
- [x] **Move static-export diagnostic formatting helpers behind an internal server subpath.**
  - Remove `formatStaticExportDiagnostic`, `formatStaticExportDiagnostics`,
    `isStaticExportDiagnostic`, and `isStaticExportDiagnosticError` from
    `@kovojs/server/app-shell/static-export`.
  - Keep public static-export types/errors needed by `exportStaticApp`, but make
    formatting/type-guard helpers local to framework tooling or internal imports.
  - Evidence: `packages/server/src/api/app-shell/static-export.ts` no longer
    re-exports diagnostic formatter/guard helpers; the helpers are available from
    `packages/server/src/internal/static-export.ts` with `@internal` source
    declarations. Verification: `corepack pnpm exec vitest --run
    packages/server/src/api/app.test.ts packages/create-kovo/src/index.test.ts`;
    `node scripts/api-surface-gate.mjs`.
- [x] **Update starter/example export scripts not to import internal static-export helpers.**
  - Inline small formatting/type-guard logic in app-owned export scripts, or route
    those scripts through a higher-level `kovo` command when one exists.
  - Update `packages/create-kovo/templates/scripts/export-static.mjs`,
    `examples/*/scripts/export-static.mjs`, and `site/scripts/export-static.mjs`
    as needed before removing public helper exports.
  - Evidence: `packages/create-kovo/templates/scripts/export-static.mjs`,
    `examples/reference/scripts/export-static.mjs`, and
    `site/scripts/export-static.mjs` format/check static-export diagnostics with
    local helper functions instead of loading public or internal helper exports.
    Verification: `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts
    packages/create-kovo/src/index.test.ts`.
- [x] **Add negative export tests for support helpers.**
  - Assert the moved client-module and static-export support helpers are not
    exported from public app-shell subpaths.
  - Assert any internal replacement subpath exports them only when framework tests
    require direct access.
  - [x] Client-module helper negative assertions are covered in
    `packages/server/src/api/app.test.ts`.
    - Evidence: the test asserts `@kovojs/server/app-shell/client-modules` lacks
      `renderVersionedClientModuleResponse` and `versionedClientModuleHref`, uses
      `@ts-expect-error` for `VersionedClientModuleRequest` and
      `VersionedClientModuleResponse`, and asserts the internal client-module
      subpath exposes the helper values/types. Verification:
      `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
  - [x] Static-export support helper negative assertions are covered in
    `packages/server/src/api/app.test.ts`.
    - Evidence: the test asserts the manifest/assertion/output-plan and
      diagnostic formatter/guard helpers are absent from
      `@kovojs/server/app-shell/static-export` and present from
      `@kovojs/server/internal/static-export`. Verification:
      `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts packages/create-kovo/src/index.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
- [ ] **Move request-shell execution helpers internal-only.**
  - Remove these from public `@kovojs/server` exports unless a concrete app-authored
    use case is documented: `runEndpoint`, `runMutation`, `runQuery`,
    `runRoutePage`, `runWebhook`, `parseRouteRequest`, and `endpointMatches`.
  - Keep them reachable through internal modules for framework dispatch and tests.
  - Evidence:
- [ ] **Move mutation/query/route response renderers internal-only.**
  - Remove these from public `@kovojs/server` exports unless a concrete app-authored
    use case is documented: `renderMutationEndpointResponse`,
    `renderMutationResponse`, `renderNoJsMutationResponse`,
    `renderQueryEndpointResponse`, `renderQueryRegistryEndpointResponse`,
    `renderRouteDocumentResponse`, and `renderRoutePageResponse`.
  - Keep public declaration APIs (`mutation`, `query`, `route`, `webhook`,
    `createRequestHandler`) as the app-facing surface.
  - Evidence:
- [ ] **Move document/deferred/page-hint rendering internals off the public root.**
  - Review and likely internalize `renderDocument`, `renderDeferredDocument`,
    `renderDeferredStream`, `renderDocumentQueryScript`, `renderQueryScript`,
    `renderPageHints`, `renderContentSecurityPolicy`, `renderErrorDocument`, and
    `renderDiagnosticDocument`.
  - Keep public only if docs identify a normal app-authored customization path that
    cannot be expressed through `createApp`, layouts, route options, or documented
    shell hooks.
  - Evidence:
- [ ] **Review low-level helpers before keeping them public.**
  - Deliberately decide whether `renderComponent`,
    `renderMutationFormAttributes`, `mutationFormAttributes`, `csrfField`,
    `csrfToken`, and `readHeader` are common enough app helpers to remain public.
  - If kept public, document their intended app-authored use cases and canonical
    import path. If not, internalize them in the same no-compatibility style.
  - Evidence:
- [ ] **Make Vite build/export replay helpers internal once a higher-level command exists.**
  - Keep `kovoAppShellViteDevPlugin` as the likely public/root dev setup API.
  - Move Vite build/export replay helpers internal-only when `kovo build` or
    another public facade owns app export/build workflows.
  - Evidence:
- [ ] **Add server export canonical-home tests.**
  - Assert moved symbols are exported from `@kovojs/server`.
  - Assert moved symbols are not exported from their former public subpaths.
  - Evidence:

## Compiler App-Author Import Cleanup

- [ ] **Remove `@kovojs/compiler` from the create-kovo starter template.**
  - Delete `packages/create-kovo/templates/src/app.fixpoint.test.ts` from the
    template and generated file list.
  - Remove `@kovojs/compiler` from
    `packages/create-kovo/templates/package.json` devDependencies.
  - Update `packages/create-kovo/src/index.test.ts` expectations for file count,
    generated file list, dependency assertions, and the starter proof test.
  - Evidence:
- [ ] **Replace the starter `emit-graph.mjs` compiler import.**
  - The current starter graph is a literal static graph. Write that graph directly
    instead of importing `deriveAppGraph` from `@kovojs/compiler`.
  - Keep `kovo check graph.json` and `scripts/graph-assertions.mjs` as the starter
    verification path.
  - Evidence:
- [ ] **Adjust starter docs away from compiler API ownership.**
  - Update `docs/framework-rules.md` and any README/project-structure text that
    implies app authors should keep a compiler fixpoint test.
  - State that compiler fixpoint/render-equivalence is framework CI coverage;
    starter apps should rely on `kovo check` plus app-shell/export tests.
  - Evidence:
- [ ] **Audit remaining app-owned compiler imports and classify them.**
  - Separate framework-owned tests/examples from app-template code.
  - For examples, decide whether direct compiler scripts remain acceptable as
    repo demonstration tooling or should be replaced by `kovo` commands before
    declaring "no app-author imports" complete.
  - Evidence:
- [ ] **Define the future public facade for compiler-backed app tasks.**
  - Track the required `kovo` command surface for component emit, graph emit, UI
    CSS extraction, and optional fixpoint checks so app authors do not import
    `@kovojs/compiler` directly.
  - Evidence:
- [ ] **Reclassify `@kovojs/compiler` only after app-facing imports are gone.**
  - Once starters and app-owned scripts use `kovo` or static artifacts instead,
    update `public-packages.json`, API docs, and publish/build assumptions so
    compiler APIs are treated as framework-internal build machinery.
  - Evidence:

## Package-Wide Internalization Candidates

- [ ] **Make `@kovojs/compiler` non-app-facing.**
  - Internalize the root build/codegen symbols once `@kovojs/cli` owns the public
    facade: `compileComponentModule`, `compileRouteModule`, `assertFixpoint`,
    `assertRenderEquivalence`, `composePageComponentArtifacts`,
    `emitQueryPlanBootstrapModule`, `mergePrimitiveAndAuthorAttributes`, and
    their fact/result/input types.
  - Remove or replace public `@kovojs/compiler/graph` and
    `@kovojs/compiler/package-styles` app-facing imports with `@kovojs/cli`
    commands or internal framework imports.
  - Evidence:
- [ ] **Shrink `@kovojs/runtime` root to hand-authored app APIs.**
  - Move generated/runtime machinery behind `@kovojs/runtime/generated` or an
    internal subpath: deferred stream apply, compiled query update plan apply,
    query/state binding apply, fragment/morph apply, inline query hydration,
    loader installation/source generation, mutation broadcast/pagehide cleanup,
    security-output helpers prefixed `kovo*`, compiled query/stamp/template
    types, binding/root types, morph/loader/inline-query/broadcast/queue/submit
    context/pending/structural observer types.
  - Keep only deliberately app-authored APIs such as `derive`, `handler`,
    `tempId`, optimistic authoring helpers/types, and `trustedHtml`/`TrustedHtml`
    if their public use case is documented.
  - Evidence:
- [ ] **Shrink `@kovojs/core` to app declaration primitives.**
  - Review and likely internalize diagnostics metadata, registry types, query
    delta helpers/types, and fragment-target helpers if they are compiler/server
    implementation details rather than normal app-authored APIs.
  - Keep app declaration primitives (`component`, `route`, `query`, `form`,
    `event`, `href`, `redirect`), storage APIs, and generic webhook/HMAC
    primitives whose full signature type closure is public.
  - Evidence:
- [x] **Cull vendor-specific `@kovojs/core` symbols.**
  - Remove `stripeSignature` and `StripeSignatureOptions`; inline Stripe logic in
    examples that need it.
  - Add a package-surface guard against new provider-specific framework exports.
  - Evidence: `packages/core/src/index.ts` no longer exports
    `stripeSignature` or `StripeSignatureOptions`; `SPEC.md` §9.1 and
    `packages/server/src/webhook.ts` describe provider-specific HMAC recipes as
    app-owned code layered on `hmacSignature`. `packages/core/src/verifier.test.ts`
    keeps timestamped multi-signature provider coverage via a local helper built
    from `hmacSignature`, and `scripts/exported-symbols.test.mjs` fails if public
    package symbols contain `stripe`. Verification:
    `pnpm exec vitest --run packages/core/src/verifier.test.ts scripts/exported-symbols.test.mjs`;
    `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
    `node scripts/exported-symbols.mjs --json` plus a no-`stripe` symbol scan;
    `git diff --check`.
- [ ] **Shrink `@kovojs/drizzle/derive` and `@kovojs/drizzle/static`.**
  - Keep only app-facing runtime/build APIs with documented use cases, such as
    `deriveOptimistic` if apps directly author optimistic transforms.
  - Internalize low-level extraction/serialization/fact helpers when graph
    emission moves behind `@kovojs/cli`: `lowerTransform`,
    `serializeDerivedOptimistic`, `DerivedTransformEntry`,
    `SerializeDerivedOptimisticOptions`, `extractAlgebraicShapesFromProject`,
    `extractSymbolicEffectsFromProject`, `extractQueryFactsFromProject`,
    diagnostics helpers, serializers, `createTouchGraphEntry`, and fact/input
    wrapper types.
  - Evidence:
- [ ] **Shrink `@kovojs/headless-ui` root.**
  - After direct family subpaths exist, remove primitive-family exports from the
    root so family symbols have one canonical home.
  - Review and likely internalize platform audit exports, floating/typeahead/
    navigation collection helpers, change-detail/data-attribute helpers, and
    other root utilities unless they have a documented app-authored use case.
  - Keep only package-wide helpers/tokens that are intended public API, such as
    `cn` and token CSS exports if confirmed.
  - Evidence:
- [ ] **Make `@kovojs/test` root curated or subpath-only.**
  - Move duplicated root symbols to their canonical subpaths:
    assertions/property helpers to `@kovojs/test/assertions`, harness helpers to
    `@kovojs/test/harness`, PGlite helpers to `@kovojs/test/pglite`, DB verifier
    helpers to `@kovojs/test/verifier`, test-case helpers to
    `@kovojs/test/test-case`, and page helpers to `@kovojs/test/page`.
  - Review `html-fragment`, verifier diagnostics, SQL observer, and diagnostic
    message helpers for internal-only status if they mainly support conformance
    or verifier internals.
  - Evidence:
- [ ] **Shrink `@kovojs/better-auth` to app-facing adapter APIs.**
  - Keep app-facing helpers such as `mount`, `betterAuthSession`, `authed`, and
    `role`/role types when their public use cases are documented and their type
    closures are public.
  - Internalize vendor mirror/shape types such as `BetterAuthApi`,
    `BetterAuthLike`, `BetterAuthRequestLike`, `BetterAuthResponseLike`,
    `BetterAuthMountHandler`, `BetterAuthMountLike`, `BetterAuthSignInEmailApi`,
    `BetterAuthSignUpEmailApi`, `BetterAuthSignOutApi`, and `*Like` credential
    API shapes unless apps must author them directly.
  - Evidence:
- [ ] **Review `@kovojs/style` compiler-level result types.**
  - Confirm whether `CompiledStyle`, `AtomicRule`, and `AtomicCssResult` are
    necessary public type closures for public functions such as `style.create`
    and `emitAtomicCss`.
  - Keep them public only if required by public signatures; otherwise internalize
    compiler-level CSS output types.
  - Evidence:

## Headless UI Subpath Cleanup

- [ ] **Add direct family subpaths to `@kovojs/headless-ui`.**
  - Add package exports such as `./accordion`, `./alert-dialog`,
    `./autocomplete`, `./avatar`, `./button`, `./checkbox`, `./checkbox-group`,
    `./combobox`, `./command`, `./collapsible`, `./context-menu`, `./dialog`,
    `./disclosure`, `./dropdown-menu`, `./field`, `./hover-card`, `./menubar`,
    `./meter`, `./navigation-menu`, `./number-field`, `./otp-field`, `./popover`,
    `./progress`, `./radio-group`, `./scroll-area`, `./select`, `./separator`,
    `./slider`, `./switch`, `./tabs`, `./toast`, `./toggle`, `./toggle-group`,
    `./toolbar`, and `./tooltip`.
  - Map each direct subpath to the existing `src/primitives/<family>.ts` file, or
    create thin source barrels only when a family needs a more app-facing name.
  - Evidence:
- [ ] **Decide whether `./primitives/*` remains as compatibility or becomes internal/deprecated.**
  - If kept, document it as a compatibility namespace and keep both export maps in
    sync.
  - If deprecated, add migration docs and update all repo imports before removing
    it from public docs.
  - Evidence:
- [ ] **Update `public-packages.json` for the new headless-ui public subpaths.**
  - Add the direct family subpaths to `@kovojs/headless-ui.apiBoundary.public`.
  - Remove or reclassify `./primitives/*` only after the compatibility decision is
    implemented and verified.
  - Evidence:
- [ ] **Update `@kovojs/ui` and generated/copy-in examples to import direct headless-ui subpaths.**
  - Replace imports from `@kovojs/headless-ui/primitives` or
    `@kovojs/headless-ui/primitives/<family>` with direct family subpaths where
    applicable.
  - Ensure copied `@kovojs/ui` source remains buildable against public packages
    only.
  - Evidence:
- [ ] **Regenerate/check publish metadata and API docs for headless-ui.**
  - Run `node scripts/build-publish.mjs --write` after export-map changes.
  - Update generated API reference coverage if headless-ui direct family subpaths
    are documented.
  - Evidence:
- [ ] **Verify headless-ui subpath parity.**
  - Add or update a package-exports test asserting each `@kovojs/ui/<family>` that
    depends on headless behavior has a matching `@kovojs/headless-ui/<family>`
    public subpath.
  - Evidence:

## UI Public Package Cleanup

- [ ] **Classify `@kovojs/ui` as public in `public-packages.json`.**
  - Change visibility from private/starter to public.
  - Add `apiBoundary.public` entries for the root and every direct component
    subpath.
  - Decide whether `apiRef` pages are generated immediately or staged behind a
    baseline due to the large component surface.
  - Evidence:
- [ ] **Remove `private: true` from `packages/ui/package.json`.**
  - Set a publishable version line consistent with other public packages.
  - Add/verify `files`, `publishConfig.exports`, and `build:dist` metadata through
    `scripts/build-publish.mjs`.
  - Evidence:
- [ ] **Document the two supported UI consumption modes.**
  - Direct dependency: `@kovojs/ui/<component>` as public versioned API.
  - Copy-in: optional starter workflow for apps that want to own component source.
  - Avoid describing copy-in as the only or primary reason the package exists.
  - Evidence:
- [ ] **Apply one-symbol-one-home to `@kovojs/ui`.**
  - Component/family symbols should live on component subpaths.
  - The root should expose only curated aggregate/package-wide symbols, not every
    component symbol also exported by subpaths.
  - Evidence:
- [ ] **Verify public UI package install/build behavior.**
  - Run package export checks, publish metadata checks, and a small app/import
    smoke test that imports from `@kovojs/ui/button` and the matching
    `@kovojs/headless-ui/button`.
  - Evidence:

## CLI Package Rename

- [ ] **Rename package `kovo` to `@kovojs/cli`.**
  - Update `packages/cli/package.json` `"name"` while preserving
    `"bin": { "kovo": "./src/index.ts" }`.
  - Update `publishConfig.bin` and `publishConfig.exports` as needed after the
    name change.
  - Evidence:
- [ ] **Update workspace dependencies and generated templates.**
  - Replace package dependencies/devDependencies on `kovo` with `@kovojs/cli`
    wherever the package is installed.
  - Keep scripts and docs invoking the executable as `kovo`.
  - Evidence:
- [ ] **Update imports from the CLI package.**
  - Replace import specifiers that refer to package `kovo` or `kovo/internal` with
    `@kovojs/cli` or `@kovojs/cli/internal`.
  - Preserve command examples as `kovo check`, `kovo explain`, etc.
  - Evidence:
- [ ] **Update manifest/API docs for the CLI package rename.**
  - Change the `public-packages.json` entry from `kovo` to `@kovojs/cli`.
  - Update generated API reference, stability docs, and package export tests.
  - Evidence:
- [ ] **Verify the renamed package still provides the `kovo` command.**
  - Add or update tests that install/link `@kovojs/cli` and execute the `kovo`
    binary.
  - Evidence:

## Vendor-Specific Export Cleanup

- [x] **Remove Stripe-specific exports from `@kovojs/core`.**
  - Remove `stripeSignature` and `StripeSignatureOptions` from public exports.
  - Keep generic webhook/HMAC primitives such as `hmacSignature`,
    `standardWebhooks`, and shared webhook request/header types where they remain
    provider-agnostic.
  - Evidence: `packages/core/src/index.ts` exports `customVerifier`,
    `hmacSignature`, and `standardWebhooks`, but not `stripeSignature` or
    `StripeSignatureOptions`. Verification:
    `pnpm exec vitest --run packages/core/src/verifier.test.ts scripts/exported-symbols.test.mjs`;
    `node scripts/exported-symbols.mjs --json` plus a no-`stripe` symbol scan.
- [x] **Inline Stripe verification in examples that need it.**
  - Move Stripe-specific signing/verification logic into example app code or
    example-local helpers.
  - Ensure examples import only generic Kovo webhook primitives from framework
    packages.
  - Evidence: no example currently needs a Stripe webhook recipe. Verification:
    `rg -n "stripeSignature|StripeSignatureOptions|stripeSignature\\(|Stripe preset|blessed presets" SPEC.md packages docs site examples scripts --glob '!**/node_modules/**' --glob '!**/dist/**'`
    exits 1 after the public export removal.
- [x] **Update docs away from Stripe framework API.**
  - Remove or rewrite references that present Stripe as a first-class Kovo export.
  - If Stripe remains in docs, show it as app-owned code built from generic
    webhook primitives.
  - Evidence: `SPEC.md` §9.1 now states provider-specific HMAC recipes live in
    app/example code on top of `hmacSignature`, and
    `packages/server/src/webhook.ts` points readers to generic helpers instead
    of a provider-named preset. The `rg` command above finds no remaining public
    Stripe API references outside this plan.
- [x] **Add a package-surface guard against vendor-specific exports.**
  - Extend API/export checks to flag framework package symbols with provider names
    that should live in examples, starting with `Stripe`.
  - Evidence: `scripts/exported-symbols.test.mjs` now checks public package
    symbols for `/stripe/i` and expects no leaks. Verification:
    `pnpm exec vitest --run scripts/exported-symbols.test.mjs`.
- [x] **Verify no public package exports Stripe-specific symbols.**
  - Run `pnpm symbols --json` and assert no public package symbol name contains
    `Stripe` or `stripe` unless a future plan explicitly whitelists it.
  - Evidence: `node scripts/exported-symbols.mjs --json > /tmp/kovo-symbols.json`
    followed by a no-`stripe` symbol scan prints `no stripe public symbols`.

## Export Uniqueness Enforcement

- [ ] **Add a duplicate public-symbol detector.**
  - Build a script or extend `scripts/exported-symbols.mjs` to compute, per
    package, symbols exported from more than one public import path.
  - Treat root+subpath duplication as a violation by default.
  - Evidence:
- [ ] **Wire duplicate detection into a check script.**
  - Add a root script such as `check:exports` or fold the check into
    `check:api-surface`.
  - The check should print package, symbol, and every public import path that
    exposes it.
  - Evidence:
- [ ] **Classify compatibility exceptions before enforcing.**
  - If existing packages need temporary aliases, record each exception in a small
    baseline file with a reason and removal target.
  - Do not allow new duplicate root+subpath exports without editing the baseline
    and plan evidence.
  - Evidence:
- [ ] **Prefer subpath ownership for family/component symbols.**
  - For `@kovojs/headless-ui` and `@kovojs/ui`, component/family symbols should
    live on their direct family subpath. The root can export package-wide tokens,
    metadata, or explicitly curated aggregate helpers, but should not duplicate
    every family member.
  - Evidence:
- [ ] **Update API docs to reflect canonical import paths.**
  - Generated or hand-authored docs should show the canonical home for each symbol
    and avoid listing duplicate aliases as equal public entry points.
  - Evidence:

## Open Risks

- [ ] **The public Vite surface may overlap with the future deployment API.**
  - `plans/easy-deployment.md` tracks `kovo build` and presets. Do not freeze
    low-level build helpers prematurely if a future higher-level command will
    replace them.
- [ ] **Starter templates use SSR dynamic loading.**
  - Existing starter code calls `server.ssrLoadModule('@kovojs/server/app-shell/vite')`.
    Any rename or removal must update templates, example configs, and tests in the
    same slice.
- [ ] **Published `publishConfig.exports` must not drift.**
  - `package.json` top-level source exports and `publishConfig.exports` must stay
    in sync through `scripts/build-publish.mjs`.
- [ ] **The `kovo` CLI currently imports `@kovojs/compiler`.**
  - Making `@kovojs/compiler` fully private/unpublished may require bundling the
    compiler into `@kovojs/cli` or moving compiler internals behind a package that
    only framework packages consume.
- [ ] **Headless-ui subpath migration can duplicate API reference debt.**
  - Adding direct subpaths before deciding `./primitives/*` compatibility may
    temporarily double the documented/exported headless-ui surface. Keep the
    compatibility window explicit and bounded.
- [ ] **Compatibility aliases may be needed during migration.**
  - If root barrels currently re-export symbols app code imports directly, enforce
    the rule with a ratchet/baseline first, then remove duplicates in scoped
    package slices.
- [ ] **Renaming the CLI package can confuse command-vs-package docs.**
  - Docs must consistently distinguish package name `@kovojs/cli` from executable
    name `kovo`.
- [ ] **Making `@kovojs/ui` public will expand API-surface debt.**
  - The package has many component exports. Use the duplicate-symbol detector,
    API-surface baseline, and focused documentation slices so publicizing it does
    not silently bless accidental root exports.
- [ ] **Internalizing server helpers may require app-owned script rewrites.**
  - Prefer local example/starter helper code or `kovo` commands over keeping
    framework support helpers public just because current examples import them.
- [ ] **Examples may still need realistic webhook integrations.**
  - Keep provider-specific code local to examples so recipes stay useful without
    promoting vendor names into framework package APIs.
