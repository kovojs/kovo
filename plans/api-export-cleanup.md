# API Export Cleanup

Created 2026-06-17. Behavioral source of truth is `SPEC.md`; API-boundary mechanics
are governed by `rules/api-surface.md`. This ledger scopes the `@kovojs/server`
app-shell Vite export cleanup: choose the public build/dev/export contract, keep
raw host internals behind internal subpaths, and make the manifest/docs/gates agree.
It also tracks package-shape cleanup needed before the public API surface is
stable: `@kovojs/ui` is public, and the CLI package must be named `@kovojs/cli`
while continuing to install a `kovo` binary.

## Goal

Vite build/export replay should be hidden behind app-author command facades, not
hand-authored imports from `@kovojs/server/app-shell/vite`. The former public-looking
subpath is removed; generated app maintenance scripts and site export scripts use
`kovo export --vite` through the public `@kovojs/cli` facade, while lower-level raw
plugin wiring, output planning, manifest parsing, staging, and dev diagnostic
internals stay behind `@kovojs/server/internal/app-shell-vite`.

This follows `SPEC.md` §9.5: app-shell dev/build/export replay starts from the
framework request shell and `createApp()` aggregate. App authors should name that
workflow as a command-level operation, not import framework replay helpers directly.

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
- [x] **`@kovojs/core` no longer exposes Stripe-specific webhook symbols.**
  - Evidence: `packages/core/src/index.ts` exports generic webhook helpers only;
    `corepack pnpm run check:api-surface` reports
    `public-exports-needing-attention=1713 (baseline=1737, fixed-this-run=24)`,
    and `rg "stripeSignature|StripeSignatureOptions" SPEC.md packages docs site
examples scripts conformance tests --glob '!**/node_modules/**' --glob
'!**/dist/**'` exits 1.

## Decisions

- [x] **Use the CLI facade for Vite static-export replay; remove the public Vite replay subpath.**
  - Rationale: starter apps and app-owned export scripts should not import
    generated-target or framework replay helpers by hand. `kovo export --vite`
    gives them a durable app-author operation while keeping Vite manifest/build
    machinery internal.
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

- [x] **Remove `./app-shell/vite` from the public server export map.**
  - Keep `./internal/app-shell-vite` classified as internal for framework-owned
    Vite plugin/replay machinery.
  - Evidence: `packages/server/package.json` no longer exports
    `./app-shell/vite`, `public-packages.json` no longer lists the subpath or
    `server-app-shell-vite` API reference entry, and
    `packages/server/src/api/app-shell/vite.ts` is deleted. Verification:
    `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts
scripts/public-packages.test.mjs site/scripts/api-ref.test.mjs`;
    `corepack pnpm run check:publish`.
- [x] **Route Vite static-export replay through `kovo export --vite`.**
  - Add CLI manifest loading, asset copying, stylesheet environment resolution,
    Vite SSR module loading, and an in-process `runKovoCommand` facade for
    generated maintenance scripts.
  - Evidence: `packages/cli/src/index.ts` supports `--vite`, `--root`,
    `--manifest`, `--dist`, `--asset-base`, and `--stylesheet-env`, and
    `packages/cli/src/api.ts` exports public `runKovoCommand`. Verification:
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-export.test.ts
packages/cli/src/commands-manifest.test.ts`; `corepack pnpm run check:api-surface`.
- [x] **Update generated starter and docs-site export scripts to use the command facade.**
  - Remove app-authored imports of Vite replay helpers from the starter and docs
    site; those scripts now load `@kovojs/cli` through Vite SSR and call
    `runKovoCommand(['export', ..., '--vite', ...])`.
  - Evidence: `packages/create-kovo/templates/scripts/export-static.mjs` and
    `site/scripts/export-static.mjs` no longer import
    `@kovojs/server/app-shell/vite`; starter docs describe `kovo export --vite`.
    Verification: `corepack pnpm exec vitest --run
packages/create-kovo/src/index.test.ts`; `corepack pnpm --filter @kovojs/site
run build`.
- [x] **Add boundary tests for the removed public subpath and internal Vite home.**
  - Assert the removed public subpath is absent from server package exports and
    package manifests, while framework tests use internal/local Vite helpers.
  - Evidence: `packages/server/src/api/app.test.ts` has a compile-time
    `@ts-expect-error` import assertion for `@kovojs/server/app-shell/vite` and
    checks `serverPackage.exports` does not contain `./app-shell/vite`;
    `packages/server/src/vite-plugin-boundary.test.ts` imports manifest helpers
    from local/internal modules. Verification: `corepack pnpm exec vitest --run
packages/server/src/api/app.test.ts packages/server/src/vite-plugin-boundary.test.ts`.
- [x] **Regenerate/check publish metadata after export-map changes.**
  - If package exports or entry files change, run
    `node scripts/build-publish.mjs --write` before verification.
  - Evidence: no export-map rewrite was needed in this slice;
    `node scripts/build-publish.mjs` passes and confirms every `publishConfig`
    target exists for the current export maps.
- [x] **Run focused verification, then broad gates.**
  - Focused: `pnpm --filter @kovojs/server exec vitest run` plus tests for
    `packages/create-kovo` template expectations.
  - Broad: `pnpm run check:api-surface`, `pnpm run check:publish`, and
    `pnpm run check`.
  - Evidence: `corepack pnpm exec vitest --run packages/core/src/index.test.ts
packages/core/src/verifier.test.ts`,
    `corepack pnpm exec vitest --run packages/runtime/src/optimism-typing.test.ts
packages/runtime/src/submit-context-apply.test.ts
packages/runtime/src/inline-loader-navigation.test.ts
packages/runtime/src/inline-loader-navigation.browser.test.ts`,
    `corepack pnpm exec vitest --run packages/server/src/app.test.ts
packages/server/src/mutation-response.test.ts
packages/server/src/app-document.test.ts`,
    `corepack pnpm --filter @kovojs/example-stackoverflow test -- --run`, and
    `corepack pnpm --filter @kovojs/conformance-webhook-spike test` pass.
    Broad gates pass: `corepack pnpm run check`, `corepack pnpm run
check:api-surface`, `corepack pnpm run check:exports`, and `corepack pnpm
run check:publish`.

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
- [x] **Remove existing root/subpath duplicates from app-shell subpaths.**
  - Remove duplicate subpath exports for root-owned symbols such as `createApp`,
    `createRequestHandler`, `route`, `layout`, `respond`, `toNodeHandler`,
    `exportStaticApp`, and `createMemoryVersionedClientModuleRegistry`.
  - Update all repo imports to use `@kovojs/server` for those symbols.
  - Evidence: `packages/server/src/api/app-shell/core.ts`,
    `client-modules.ts`, and `node.ts` are empty public compatibility modules,
    while `static-export.ts` keeps only static-export artifact types. Repo imports
    and starter expectations now use root `@kovojs/server` for root-owned
    app-shell helpers. `packages/server/src/api/app.test.ts` asserts the root
    exports and old-subpath removals; `node scripts/exported-symbols.mjs
--duplicates` reports only the JSX runtime/dev-runtime aliases remaining for
    `@kovojs/server`.
- [x] **Keep tooling/support helpers subpath-only.**
  - Keep Vite build/export replay helpers, manifest/output bundle types,
    `internal/*`, and JSX runtime exports off the root.
  - Move client-module response/href helpers and static-export manifest/assertion
    helpers to internal subpaths instead of keeping them public subpath APIs.
  - [x] Client-module response/href helper portion is internal-only. - Evidence: `packages/server/src/api/app-shell/client-modules.ts` exports no
        public values; `packages/server/src/internal/client-modules.ts` exports
        `renderVersionedClientModuleResponse`, `versionedClientModuleHref`,
        `VersionedClientModuleRequest`, and `VersionedClientModuleResponse`.
        Verification: `corepack pnpm exec vitest --run
packages/server/src/api/app.test.ts`; `node scripts/api-surface-gate.mjs`.
  - [x] Static-export support helper portion is internal-only. - Evidence: `packages/server/src/api/app-shell/static-export.ts` exports no
        public values; `packages/server/src/internal/static-export.ts` exports the
        manifest/assertion/output-plan and diagnostic formatter/guard helpers.
        Verification: `corepack pnpm exec vitest --run
packages/server/src/api/app.test.ts packages/create-kovo/src/index.test.ts`;
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
- [x] **Move request-shell execution helpers internal-only.**
  - Remove these from public `@kovojs/server` exports unless a concrete app-authored
    use case is documented: `runEndpoint`, `runMutation`, `runQuery`,
    `runRoutePage`, `runWebhook`, `parseRouteRequest`, and `endpointMatches`.
  - Keep them reachable through internal modules for framework dispatch and tests.
  - [x] Remove the no-public-use `parseRouteRequest`, `runWebhook`, and
        `WebhookRunResult` exports from the public routing barrel.
    - Evidence: `packages/server/src/api/routing.ts` no longer re-exports those
      symbols; `packages/server/src/api/app.test.ts` asserts `@kovojs/server`
      and the public routing barrel do not expose `parseRouteRequest` or
      `runWebhook`. Verification:
      `rg -n "parseRouteRequest|runWebhook" packages/conformance-fixtures/src/package-exports.test.ts packages/server/src/api/app.test.ts site/content site/tutorial examples conformance packages/better-auth packages/test --glob '!**/dist/**' --glob '!**/generated/**'`;
      `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts site/scripts/api-ref.test.mjs scripts/exported-symbols.test.mjs`;
      `corepack pnpm run check:exports`; `node scripts/api-surface-gate.mjs`;
      `node site/scripts/api-ref.mjs`; `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
  - [x] Move `runEndpoint`, `endpointMatches`, `runMutation`, `runQuery`, and
        `runRoutePage` behind `@kovojs/server/internal/execution`.
    - Evidence: `packages/server/src/api/data.ts` no longer exports
      `runMutation` or `runQuery`; `packages/server/src/api/routing.ts` no
      longer exports `runEndpoint`, `endpointMatches`, or `runRoutePage`;
      `packages/server/src/internal/execution.ts` exports the moved helpers with
      `@internal` source declarations. App-authored `examples/reference/src/app.ts`
      no longer exports direct no-JS submit helpers that call `runMutation`.
      Repo test/conformance fixtures import the runners from
      `@kovojs/server/internal/execution`. Verification:
      `rg -n "from ['\\\"]@kovojs/server['\\\"][^;]*(runEndpoint|endpointMatches|runMutation|runQuery|runRoutePage)|import \\{[^}]*\\b(runEndpoint|endpointMatches|runMutation|runQuery|runRoutePage)\\b[^}]*\\} from ['\\\"]@kovojs/server['\\\"]" . --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/generated/**'`
      exits 1; `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts packages/better-auth/src/index.session.test.ts packages/better-auth/src/index.credential-mutations.test.ts conformance/better-auth-pin/src/index.verifier.test.ts conformance/better-auth-pin/src/index.session-credentials.test.ts packages/conformance-fixtures/src/server-fixtures.test.ts packages/test/src/harness-operations.test.ts examples/commerce/src/app.auth.test.ts examples/commerce/src/app-shell.test.ts examples/reference/src/app.test.ts`;
      `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`.
- [x] **Move mutation/query/route response renderers internal-only.**
  - Remove these from public `@kovojs/server` exports unless a concrete app-authored
    use case is documented: `renderMutationEndpointResponse`,
    `renderMutationResponse`, `renderNoJsMutationResponse`,
    `renderQueryEndpointResponse`, `renderQueryRegistryEndpointResponse`,
    `renderRouteDocumentResponse`, and `renderRoutePageResponse`.
  - Keep public declaration APIs (`mutation`, `query`, `route`, `webhook`,
    `createRequestHandler`) as the app-facing surface.
  - Evidence:
    - `packages/server/src/api/data.ts`, `packages/server/src/api/routing.ts`,
      and `packages/server/src/api/rendering.ts` no longer public-export the
      listed response renderers; `packages/server/src/internal/wire.ts`,
      `packages/server/src/internal/route.ts`, and
      `packages/server/src/internal/html.ts` provide their internal homes.
    - App-authored tutorial/docs/reference sources no longer import or call the
      listed renderers; test/conformance harnesses import them from internal
      subpaths where direct execution is still needed.
    - Verification: public-root scan
      `rg -n "from ['\\\"]@kovojs/server['\\\"][^;]*(renderMutationEndpointResponse|renderMutationResponse|renderNoJsMutationResponse|renderQueryEndpointResponse|renderQueryRegistryEndpointResponse|renderRouteDocumentResponse|renderRoutePageResponse)|import \\{[^}]*\\b(renderMutationEndpointResponse|renderMutationResponse|renderNoJsMutationResponse|renderQueryEndpointResponse|renderQueryRegistryEndpointResponse|renderRouteDocumentResponse|renderRoutePageResponse)\\b[^}]*\\} from ['\\\"]@kovojs/server['\\\"]" . --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/generated/**'`
      exits 1; `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts packages/conformance-fixtures/src/server-fixtures.test.ts conformance/better-auth-pin/src/index.session-credentials.test.ts examples/reference/src/app.test.ts site/tutorial/steps/01-first-page/src/app.test.ts site/tutorial/steps/02-islands/src/app.test.ts site/tutorial/steps/03-queries/src/app.test.ts site/tutorial/steps/04-mutations/src/app.test.ts site/tutorial/steps/05-optimistic/src/app.test.ts site/tutorial/steps/06-streaming/src/app.test.ts site/tutorial/steps/07-verification/src/app.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
      `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`;
      `git diff --check`.
    - Remaining smoke gap: `node tests/kovo-check.node.mjs` is still blocked
      before assertions by missing repo-level publish-layout artifact
      `dist/compiler/src/internal.mjs` (same known blocker recorded in
      `plans/example-readability.md`).
- [x] **Move document/deferred/page-hint rendering internals off the public root.**
  - Review and likely internalize `renderDocument`, `renderDeferredDocument`,
    `renderDeferredStream`, `renderDocumentQueryScript`, `renderQueryScript`,
    `renderPageHints`, `renderContentSecurityPolicy`, `renderErrorDocument`, and
    `renderDiagnosticDocument`.
  - Keep public only if docs identify a normal app-authored customization path that
    cannot be expressed through `createApp`, layouts, route options, or documented
    shell hooks.
  - Evidence:
    - `packages/server/src/api/data.ts` no longer public-exports
      `renderQueryScript`; `packages/server/src/api/rendering.ts` no longer
      public-exports the listed document/deferred/page-hint renderer values.
      `packages/server/src/internal/html.ts` is the internal home for those
      framework/test harness renderers.
    - App-authored commerce/tutorial/docs examples no longer present these
      helpers as public app APIs; direct fixture/harness execution imports them
      from `@kovojs/server/internal/html`.
    - Verification: public-root scan
      `rg -n "from ['\\\"]@kovojs/server['\\\"][^;]*(renderDocument|renderDeferredDocument|renderDeferredStream|renderDocumentQueryScript|renderQueryScript|renderPageHints|renderContentSecurityPolicy|renderErrorDocument|renderDiagnosticDocument)|import \\{[^}]*\\b(renderDocument|renderDeferredDocument|renderDeferredStream|renderDocumentQueryScript|renderQueryScript|renderPageHints|renderContentSecurityPolicy|renderErrorDocument|renderDiagnosticDocument)\\b[^}]*\\} from ['\\\"]@kovojs/server['\\\"]" . --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/generated/**'`
      exits 1; `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts packages/conformance-fixtures/src/server-fixtures.test.ts examples/commerce/src/app.rendering.test.ts examples/commerce/src/source-truth.test.ts site/tutorial/steps/03-queries/src/app.test.ts site/tutorial/steps/04-mutations/src/app.test.ts site/tutorial/steps/05-optimistic/src/app.test.ts site/tutorial/steps/06-streaming/src/app.test.ts site/tutorial/steps/07-verification/src/app.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
      `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`;
      `git diff --check`.
    - Remaining smoke gap: `node tests/kovo-check.node.mjs` is still blocked
      before assertions by missing repo-level publish-layout artifact
      `dist/compiler/src/internal.mjs` (same known blocker recorded in
      `plans/example-readability.md`).
- [x] **Review low-level helpers before keeping them public.**
  - Deliberately decide whether `renderComponent`,
    `renderMutationFormAttributes`, `mutationFormAttributes`, `csrfField`,
    `csrfToken`, and `readHeader` are common enough app helpers to remain public.
  - If kept public, document their intended app-authored use cases and canonical
    import path. If not, internalize them in the same no-compatibility style.
  - Evidence:
    - Kept public app-form helpers at `@kovojs/server`: `csrfField`,
      `csrfToken`, `mutationFormAttributes`, and `renderMutationFormAttributes`.
      Current app-authored examples/templates use them for explicit CSRF fields,
      no-JS form submissions, JSX form spreads, and string-template form
      attributes.
    - Moved non-app-facing helpers internal-only:
      `packages/server/src/api/rendering.ts` no longer exports
      `renderComponent`, and `packages/server/src/api/routing.ts` no longer
      exports `readHeader`; `packages/server/src/internal/html.ts` exports both
      for framework/test harness use.
    - Verification: `rg -n "from ['\\\"]@kovojs/server['\\\"][^;]*(renderComponent|readHeader)|import \\{[^}]*\\b(renderComponent|readHeader)\\b[^}]*\\} from ['\\\"]@kovojs/server['\\\"]" . --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/generated/**'`
      exits 1; `corepack pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/component-render.test.tsx packages/server/src/response.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
- [x] **Make Vite build/export replay helpers internal once a higher-level command exists.**
  - Keep `kovoAppShellViteDevPlugin` as the likely public/root dev setup API.
  - Move Vite build/export replay helpers internal-only when `kovo build` or
    another public facade owns app export/build workflows.
  - Evidence: `packages/create-kovo/templates/scripts/export-static.mjs` and
    `site/scripts/export-static.mjs` now load `@kovojs/cli` through Vite SSR
    and call `runKovoCommand(['export', ..., '--vite', ...])` instead of
    importing `@kovojs/server/app-shell/vite`; `packages/server/package.json`,
    `public-packages.json`, and `site/scripts/api-ref.test.mjs` remove the
    public `@kovojs/server/app-shell/vite` subpath/API reference; framework-only
    Vite replay helpers remain behind internal/local modules. Verification:
    `rg -n "@kovojs/server/app-shell/vite|server-app-shell-vite|./app-shell/vite|src/api/app-shell/vite" packages site scripts public-packages.json --glob '!**/dist/**' --glob '!**/node_modules/**'`
    returns only negative assertions; `corepack pnpm exec vitest --run
packages/cli/src/index.kovo-export.test.ts packages/cli/src/commands-manifest.test.ts
packages/create-kovo/src/index.test.ts packages/server/src/api/app.test.ts
packages/server/src/vite-plugin-boundary.test.ts scripts/public-packages.test.mjs
site/scripts/api-ref.test.mjs`; `corepack pnpm --filter @kovojs/site run build`;
    `corepack pnpm run check:api-surface`; `corepack pnpm run check:publish`;
    `corepack pnpm run check:exports`; `corepack pnpm run check:imports`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `git diff --check`.
- [x] **Add server export canonical-home tests.**
  - Assert moved symbols are exported from `@kovojs/server`.
  - Assert moved symbols are not exported from their former public subpaths.
  - Evidence: `packages/server/src/api/app.test.ts` asserts root availability for
    `createApp`, `createRequestHandler`, `isKovoApp`, `route`, `layout`,
    `respond`, `toNodeHandler`, `exportStaticApp`, and
    `createMemoryVersionedClientModuleRegistry`, and uses compile-time
    `@ts-expect-error` assertions plus runtime value-key checks for the old
    app-shell subpaths. Verification: `corepack pnpm exec vitest --run
packages/server/src/api/app.test.ts`; `corepack pnpm exec tsc -p
tsconfig.json --noEmit --pretty false`.

## Compiler App-Author Import Cleanup

- [x] **Remove `@kovojs/compiler` from the create-kovo starter template.**
  - Delete `packages/create-kovo/templates/src/app.fixpoint.test.ts` from the
    template and generated file list.
  - Remove `@kovojs/compiler` from
    `packages/create-kovo/templates/package.json` devDependencies.
  - Update `packages/create-kovo/src/index.test.ts` expectations for file count,
    generated file list, dependency assertions, and the starter proof test.
  - Evidence: `packages/create-kovo/templates/package.json` has no
    `@kovojs/compiler` devDependency, `packages/create-kovo/src/index.ts` no
    longer lists `src/app.fixpoint.test.ts`, and
    `packages/create-kovo/src/index.test.ts` passes with file-count and
    dependency assertions.
- [x] **Replace the starter `emit-graph.mjs` compiler import.**
  - The current starter graph is a literal static graph. Write that graph directly
    instead of importing `deriveAppGraph` from `@kovojs/compiler`.
  - Keep `kovo check graph.json` and `scripts/graph-assertions.mjs` as the starter
    verification path.
  - Evidence: `packages/create-kovo/templates/scripts/emit-graph.mjs` writes the
    literal starter graph without importing `deriveAppGraph`;
    `packages/create-kovo/src/index.test.ts` passes and validates the emitted
    `graph.json` with `kovoCheck`/`kovoExplain`.
- [x] **Adjust starter docs away from compiler API ownership.**
  - Update `docs/framework-rules.md` and any README/project-structure text that
    implies app authors should keep a compiler fixpoint test.
  - State that compiler fixpoint/render-equivalence is framework CI coverage;
    starter apps should rely on `kovo check` plus app-shell/export tests.
  - Evidence: `packages/create-kovo/templates/README.md` and
    `packages/create-kovo/templates/docs/framework-rules.md` state that compiler
    fixpoint/render-equivalence belongs to framework CI;
    `corepack pnpm exec vitest --run packages/create-kovo/src/index.test.ts`
    passes and asserts the generated docs text.
- [x] **Audit remaining app-owned compiler imports and classify them.**
  - Separate framework-owned tests/examples from app-template code.
  - For examples, decide whether direct compiler scripts remain acceptable as
    repo demonstration tooling or should be replaced by `kovo` commands before
    declaring "no app-author imports" complete.
  - Evidence: `rg -n "@kovojs/compiler" examples packages/create-kovo/templates site/tutorial site/content site/src --glob '!**/generated/**' --glob '!**/dist/**' --glob '!**/node_modules/**'`
    finds no compiler imports in the create-kovo starter template; remaining
    imports are repo-owned example, gallery, and tutorial artifact
    generators/tests/docs plus example devDependencies.
    `scripts/import-boundary.mjs` now explicitly classifies the internal
    compiler/server imports in those artifact generators so app-authored runtime
    source stays covered by `pnpm run check:imports`.
- [x] **Define the future public facade for compiler-backed app tasks.**
  - Track the required `kovo` command surface for component emit, graph emit, UI
    CSS extraction, and optional fixpoint checks so app authors do not import
    `@kovojs/compiler` directly.
  - Evidence: `packages/cli/src/commands-manifest.ts` now defines the
    app-facing `kovo compile` command family:
    `kovo compile component`, `kovo compile route`, `kovo compile graph`, and
    `kovo compile package-css`, with `--check`, component `--fixpoint`, and
    component `--render-equivalence` flags where applicable. Follow-up evidence:
    commit `34604d42` extended the facade with component `--facts-out`,
    `--emit-client-files`, `--allow-diagnostic <code>`, route `--facts-out`,
    and `kovo compile mutation-inputs`, covering the client artifact, lint
    policy, and mutation-input fact gaps found in gallery/tutorial tooling. The
    dispatcher in `packages/cli/src/index.ts` implements those commands by importing
    `@kovojs/compiler`, `@kovojs/compiler/graph`, and
    `@kovojs/compiler/package-styles` internally, so app scripts can call the
    `kovo` bin instead of importing compiler APIs. Verified with
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts`
    and `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
- [x] **Reclassify `@kovojs/compiler` only after app-facing imports are gone.**
  - Once starters and app-owned scripts use `kovo` or static artifacts instead,
    update `public-packages.json`, API docs, and publish/build assumptions so
    compiler APIs are treated as framework-internal build machinery.
  - Progress evidence: `examples/commerce/scripts/emit-components.mjs` now calls
    `kovo compile component` and `kovo compile route` instead of importing
    `@kovojs/compiler`; `examples/commerce/scripts/emit-ui-css.mjs` now calls
    `kovo compile package-css` instead of importing
    `@kovojs/compiler/package-styles`. `packages/cli/src/bin.ts` is the
    workspace/published bin bootstrap, so app scripts can call the command
    facade in source worktrees without manually authoring TS resolver hooks.
    Verified with
    `corepack pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
    `corepack pnpm --filter @kovojs/example-commerce exec node scripts/emit-ui-css.mjs`,
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts`,
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
    `node scripts/build-publish.mjs`, `corepack pnpm run check:imports`, and
    `corepack pnpm run check:exports`.
  - Progress evidence: `examples/crm/scripts/emit-components.mjs` and
    `examples/stackoverflow/scripts/emit-components.mjs` now call
    `kovo compile component` / `kovo compile route` with explicit registry
    facts instead of importing `@kovojs/compiler` or
    `@kovojs/compiler/internal`. Their `emit-ui-css.mjs` scripts now call
    `kovo compile package-css` instead of importing
    `@kovojs/compiler/package-styles`, and
    `examples/stackoverflow/package.json` no longer depends directly on
    `@kovojs/compiler`. Verified with
    `corepack pnpm --filter @kovojs/example-crm run emit-components -- --check`,
    `corepack pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`,
    `corepack pnpm --filter @kovojs/example-crm exec node scripts/emit-ui-css.mjs`,
    and
    `corepack pnpm --filter @kovojs/example-stackoverflow exec node scripts/emit-ui-css.mjs`.
  - Progress evidence: `examples/commerce/scripts/emit-graph.mjs` now calls
    `kovo compile component`, `kovo compile route`, `kovo compile graph`, and
    `kovo compile mutation-inputs` for compiler-backed facts/derivation instead
    of importing `@kovojs/compiler`, `@kovojs/compiler/graph`, or
    `@kovojs/compiler/internal`. `examples/crm/scripts/emit-graph.mjs` now calls
    `kovo compile graph` instead of importing `@kovojs/compiler/graph`.
    `examples/commerce/package.json` and `examples/crm/package.json` no longer
    depend directly on `@kovojs/compiler`. Verified with
    `corepack pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
    `corepack pnpm --filter @kovojs/example-commerce run emit-graph -- --check`,
    `corepack pnpm --filter @kovojs/example-crm run emit-components -- --check`,
    `corepack pnpm --filter @kovojs/example-crm run emit-graph -- --check`,
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts`,
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
    `node scripts/api-surface-gate.mjs`, `corepack pnpm run check:imports`,
    `corepack pnpm run check:exports`, and
    `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`.
  - Progress evidence: `examples/gallery/scripts/emit-interactive-gallery.mjs`
    now calls `kovo compile component --emit-client-files --allow-diagnostic KV210`
    instead of importing `@kovojs/compiler`; `site/tutorial/run-steps.mjs` now
    calls `kovo compile mutation-inputs` and `kovo compile component` instead
    of importing `@kovojs/compiler` or `@kovojs/compiler/internal`. Verified
    with
    `corepack pnpm --filter @kovojs/example-gallery run emit:interactive-gallery -- --check`,
    `node site/tutorial/run-steps.mjs`,
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts`,
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
    `node scripts/api-surface-gate.mjs`, `corepack pnpm run check:imports`,
    `corepack pnpm run check:exports`, and
    `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`.
  - Progress evidence: gallery merge fixture oracle coverage moved from the
    app-owned example package into compiler-owned tests at
    `packages/compiler/src/gallery-merge-fixtures*.test.tsx` and
    `packages/compiler/src/gallery-merge-fixtures-oracle.tsx`, so
    `examples/gallery/package.json` no longer depends directly on
    `@kovojs/compiler`. The gallery runtime harness now reads generated server
    and client artifacts through the example's emitted files instead of using
    compiler APIs directly. Verified with
    `corepack pnpm exec vitest --run packages/compiler/src/gallery-merge-fixtures*.test.tsx`,
    `corepack pnpm --filter @kovojs/example-gallery test`,
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
    `node scripts/api-surface-gate.mjs`, `corepack pnpm run check:imports`,
    `corepack pnpm run check:exports`, and
    `corepack pnpm exec vitest --run scripts/public-packages.test.mjs`.
  - Evidence: `site/tutorial/steps/02-islands/src/app.test.ts` now checks the
    tutorial component through the public `kovo compile component` command
    instead of importing `@kovojs/compiler`. `public-packages.json` classifies
    all `@kovojs/compiler` export subpaths as internal boundary entries with no
    human-public API reference entries, `site/content/docs/stability.md` points
    app projects at the `kovo` command facade, and
    `site/src/generated/app.routes.tsx` / `site/src/generated/app.kovo-route.tsx`
    no longer route `/api/compiler`. Verified with
    `node site/tutorial/run-steps.mjs`,
    `rg -n "from ['\"]@kovojs/compiler|import\\([^)]*['\"]@kovojs/compiler|import .*@kovojs/compiler" examples packages/create-kovo/templates site/tutorial site/content site/src --glob '!**/generated/**' --glob '!**/dist/**' --glob '!**/node_modules/**'`
    returning no matches, `node site/scripts/api-ref.mjs`,
    `node site/scripts/emit-routes.mjs`,
    `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs`,
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs`,
    `node scripts/api-surface-gate.mjs`, `node scripts/build-publish.mjs`,
    `node scripts/exported-symbols.mjs --duplicates --check`,
    `corepack pnpm run check:imports`, `corepack pnpm run check:exports`,
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
    `git diff --check`.
  - Known unrelated gap: `node site/scripts/api-examples-check.mjs` still fails
    on pre-existing server API examples for internalized render helpers
    (`renderQueryScript`, `renderMutationEndpointResponse`, and
    `renderRoutePageResponse`); this slice did not claim that gate.

## Package-Wide Internalization Candidates

- [x] **Make `@kovojs/compiler` non-app-facing.**
  - Internalize the root build/codegen symbols once `@kovojs/cli` owns the public
    facade: `compileComponentModule`, `compileRouteModule`, `assertFixpoint`,
    `assertRenderEquivalence`, `composePageComponentArtifacts`,
    `emitQueryPlanBootstrapModule`, `mergePrimitiveAndAuthorAttributes`, and
    their fact/result/input types.
  - Remove or replace public `@kovojs/compiler/graph` and
    `@kovojs/compiler/package-styles` app-facing imports with `@kovojs/cli`
    commands or internal framework imports.
  - Progress evidence: `public-packages.json` now gives `@kovojs/compiler` no
    app-facing public subpaths, but the package remains publish-built because
    `packages/cli/src/index.ts` still imports compiler internals. The remaining
    work is to bundle or otherwise internalize the CLI/compiler relationship
    before the package itself can become fully private.
  - Evidence: `site/scripts/emit-routes.mjs` now shells through
    `kovo compile route --facts-out` instead of importing
    `@kovojs/compiler`; `site/scripts/capture.mjs` now shells through
    `kovo compile component` for docs lowering/diagnostic captures, and
    `site/package.json` no longer depends on `@kovojs/compiler`.
    `packages/cli/src/index.ts` added `kovo compile component
--query-shape-facts <json>` so query-shape-backed diagnostics are reachable
    through the CLI facade instead of the compiler API. `scripts/import-boundary.mjs`
    now treats `@kovojs/compiler`, `@kovojs/compiler/graph`, and
    `@kovojs/compiler/package-styles` as non-public for app-facing roots and
    scans `site/scripts`.
  - Verified with `corepack pnpm --filter @kovojs/site run emit-routes -- --check`,
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts
packages/cli/src/commands-manifest.test.ts scripts/import-boundary.test.mjs
scripts/public-packages.test.mjs`, `node scripts/import-boundary.mjs`, and
    `rg -n "from ['\"]@kovojs/compiler|import\([^)]*['\"]@kovojs/compiler|import .*@kovojs/compiler" examples packages/create-kovo/templates site/tutorial site/content site/src site/scripts --glob '!**/generated/**' --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/*.test.*'`
    returning no matches.
- [x] **Shrink `@kovojs/runtime` root to hand-authored app APIs.**
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
  - Evidence: - Slice 2026-06-18: `packages/runtime/src/index.ts` root-exports only
    value primitives `derive`, `handler`, `tempId`, and `trustedHtml`, plus
    their public type closure (`DeriveDefinition`, `ClientHandler`,
    `ImportHandlerModule`, `HandlerContext`, `ElementParamValue`,
    `TrustedHtml`, `BrowserTrustedHTML`, and optimistic authoring types).
    `packages/runtime/src/index-exports.test.ts` pins the root value key set
    and negative checks for `installKovoLoader`, `createQueryStore`,
    `applyCompiledQueryUpdatePlan`, `applyDeferredStreamResponseToRuntime`,
    inline-loader helpers, and generated `kovo*` output helpers. - Long-term subpath decision: app-owned browser entry files import loader,
    query-store, morph, mutation-submit, query-binding, pending, and client
    lifecycle machinery from the public `@kovojs/runtime/client` subpath.
    Generated modules continue to import the emitted ABI from
    `@kovojs/runtime/generated`, while server/framework-only support imports
    use narrow internal subpaths:
    `@kovojs/runtime/internal/inline-loader`,
    `@kovojs/runtime/internal/output`,
    `@kovojs/runtime/internal/mutation`, and
    `@kovojs/runtime/internal/delegation`. This avoids making app-authored
    starter clients depend on generated/internal subpaths, which
    `scripts/import-boundary.mjs` correctly treats as non-public. - Proposed root allow-list: `derive`, `DeriveDefinition`, `handler`,
    `ClientHandler`, `HandlerContext`, `ElementParamValue`, `trustedHtml`,
    `TrustedHtml`, `BrowserTrustedHTML`, `tempId`, `OptimisticFor`,
    `OptimisticPlan`, `OptimisticEntry`, `OptimisticTransform`,
    `OptimisticQueryKey`, `OptimisticChange`, and `MutationChangeRecord`.
    `OptimisticPlan` needs the listed optimistic helper types to keep the
    transitive public type closure valid under `rules/api-surface.md`. - Consumer migration evidence: `packages/create-kovo/templates/src/client.ts`,
    `tests/integration/fixtures/*/client.ts`,
    `packages/conformance-fixtures` generated/starter fixtures,
    `examples/gallery/src/interactive-gallery-browser-fixtures.ts`,
    `examples/commerce/src/app-test-helpers.ts`,
    `packages/server/src/document-core.ts`,
    `packages/server/src/jsx-runtime.ts`, `site/content/guides/streaming.md`,
    `site/content/guides/optimistic.md`, and `docs/integration-testing.md`
    no longer import loader/query/morph/mutation machinery from the root.
    `rg -n "from ['\"]@kovojs/runtime['\"]" packages examples site docs tests`
    now reports only authoring primitives (`trustedHtml`, `tempId`) and
    optimistic authoring types/import strings. - Verification: `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `corepack pnpm exec vitest --run packages/runtime/src` (76 files,
    421 tests); `corepack pnpm exec vitest --config vitest.browser.config.ts
--run packages/runtime/src --api 63383` (24 files, 108 browser tests);
    `corepack pnpm exec vitest --run
packages/conformance-fixtures/src/generated-module-fixtures.test.ts
packages/conformance-fixtures/src/starter-template-fixtures.test.ts
packages/conformance-fixtures/src/server-fixtures.test.ts`;
    `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs
site/scripts/api-examples-check.test.mjs scripts/public-packages.test.mjs
scripts/exported-symbols.test.mjs`; `corepack pnpm run check:imports`;
    `node scripts/api-surface-gate.mjs`; `corepack pnpm run check:exports`;
    `node site/scripts/api-ref.mjs && node site/scripts/api-examples-check.mjs`
    (`api-ref/v1 packages=8 exports=644 documented=445`,
    `api-examples/v1 examples=42 OK`); `node scripts/build-publish.mjs`.
- [x] **Shrink `@kovojs/core` to app declaration primitives.**
  - Review and likely internalize diagnostics metadata, registry types, query
    delta helpers/types, and fragment-target helpers if they are compiler/server
    implementation details rather than normal app-authored APIs.
  - Keep app declaration primitives (`component`, `route`, `query`, `form`,
    `event`, `href`, `redirect`), storage APIs, and generic webhook/HMAC
    primitives whose full signature type closure is public.
  - [x] Move query-delta wire helpers off the root.
    - Evidence: `@kovojs/core` no longer root-exports `applyQueryDelta`,
      `buildQueryDelta`, `QueryDeltaApplyError`, `queryDeltaIsSmaller`, or the
      `QueryDelta*` types; framework consumers import them from
      `@kovojs/core/internal/query-delta`. Verification:
      `corepack pnpm exec vitest --run packages/core/src/index.test.ts packages/core/src/query-delta.test.ts`;
      `corepack pnpm exec vitest --run packages/runtime/src/query-apply.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation-no-js.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
      `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`.
  - [x] Move endpoint descriptor/auth/CSRF types to `@kovojs/server`.
    - Evidence: `@kovojs/core` no longer root-exports `EndpointRegistry`,
      `Endpoint`, `EndpointMethod`, `EndpointMount`, `EndpointCsrfExemption`, or
      `EndpointAuthDeclaration`; `packages/server/src/endpoint.ts` now owns those
      descriptors and `@kovojs/server` re-exports them through
      `packages/server/src/api/routing.ts`. `site/gen/api/core.md` has no
      endpoint descriptor entries while `site/gen/api/server.md` documents
      `Endpoint`, `EndpointAuthDeclaration`, `EndpointCsrfExemption`,
      `EndpointMethod`, and `EndpointMount`. Verification:
      `corepack pnpm exec vitest --run packages/core/src/index.test.ts packages/server/src/endpoint.test.ts packages/server/src/webhook.test.ts packages/server/src/api/app.test.ts packages/better-auth/src/index.session.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
      `node scripts/api-surface-gate.mjs`; `node site/scripts/api-ref.mjs`;
      `node site/scripts/api-examples-check.mjs`; `node scripts/build-publish.mjs`;
      `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs site/scripts/api-examples-check.test.mjs scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs`;
      `rg -n 'EndpointRegistry|EndpointMethod|EndpointMount|EndpointCsrfExemption|EndpointAuthDeclaration|#### \`Endpoint\`' site/gen/api/core.md site/gen/api/server.md -S`.
  - [x] Move diagnostics registry values/helpers off the root.
    - Evidence: `@kovojs/core` keeps `DiagnosticCode` and
      `DiagnosticSeverity`, but no longer root-exports `DiagnosticDefinition`,
      `DiagnosticTextOptions`, `diagnosticDefinitions`,
      `diagnosticDefinitionText`, or `isDiagnosticCode`. Framework/tooling
      consumers now import those registry values from
      `@kovojs/core/internal/diagnostics`, and `public-packages.json` classifies
      that subpath as internal. `site/gen/api/core.md` no longer documents the
      removed root helpers. Verification:
      `corepack pnpm exec vitest --run packages/core/src/index.test.ts packages/core/src/diagnostics.test.ts packages/compiler/src/diagnostics.test.ts packages/server/src/app-diagnostics.test.ts packages/runtime/src/events.test.ts packages/test/src/verifier-diagnostics.test.ts`;
      `corepack pnpm exec vitest --run scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs packages/conformance-fixtures/src/package-exports.test.ts packages/cli/src/index.compile-mcp.test.ts`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
      `node scripts/api-surface-gate.mjs`; `node site/scripts/diagnostics-ref.mjs`;
      `node site/scripts/api-ref.mjs`; `node site/scripts/api-examples-check.mjs`;
      `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs site/scripts/api-examples-check.test.mjs`;
      `node scripts/build-publish.mjs`;
      `rg -n "diagnosticDefinitions|diagnosticDefinitionText|isDiagnosticCode|DiagnosticDefinition|DiagnosticTextOptions" packages/core/src/index.ts site/gen/api/core.md`;
      `rg -n "@kovojs/core.*(diagnosticDefinitions|diagnosticDefinitionText|isDiagnosticCode)|import \{[^}]*\b(diagnosticDefinitions|diagnosticDefinitionText|isDiagnosticCode)\b[^}]*\} from '@kovojs/core'|import \{[^}]*\b(diagnosticDefinitions|diagnosticDefinitionText|isDiagnosticCode)\b[^}]*\} from \"@kovojs/core\"" packages site examples docs --glob '!**/dist/**' --glob '!**/node_modules/**'`;
      `git diff --check`.
  - [x] Move manual fragment-target wire helpers off the root.
    - Evidence: `@kovojs/core` no longer root-exports `fragmentTarget` or
      `FragmentTargetPatch`; `@kovojs/core/internal/fragment-target` owns the
      legacy helper for framework conformance checks. The root still declares
      the generated `FragmentTargets` registry interface so compiler-emitted
      registries can declaration-merge into `@kovojs/core`, matching
      `SPEC.md` §9.1's rule that app authors never construct live-target
      headers or route mutations to fragments by hand. Verification:
      `corepack pnpm exec vitest --run packages/core/src/index.test.ts packages/conformance-fixtures/src/package-exports.test.ts scripts/public-packages.test.mjs`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `node site/scripts/api-ref.mjs`; `node site/scripts/api-examples-check.mjs`;
      `node scripts/api-surface-gate.mjs`; `corepack pnpm run check:imports`;
      `corepack pnpm run check:exports`; `node scripts/build-publish.mjs`;
      `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs site/scripts/api-examples-check.test.mjs scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs packages/conformance-fixtures/src/package-exports.test.ts packages/core/src/index.test.ts`;
      `rg -n "import \{[^}]*\bfragmentTarget\b[^}]*\} from ['\"]@kovojs/core['\"]|\bFragmentTargetPatch\b" packages examples site docs tests --glob '!**/dist/**' --glob '!**/node_modules/**' --glob '!**/generated/**'`;
      `rg -n "fragmentTarget|FragmentTargetPatch" packages/core/src/index.ts site/gen/api/core.md`.
  - Evidence: the root `@kovojs/core` symbol list now contains app declaration
    primitives, generated declaration-merge registries, storage helpers, generic
    webhook/HMAC primitives, and public diagnostic code/severity types only.
    Previously-public wire/build/framework helpers now live on internal subpaths:
    query delta helpers under `@kovojs/core/internal/query-delta`, diagnostics
    registry values under `@kovojs/core/internal/diagnostics`, fragment target
    patch helpers under `@kovojs/core/internal/fragment-target`, derivation under
    `@kovojs/core/internal/derivation`, graph explain types under
    `@kovojs/core/internal/graph`, and package-prefix helpers under
    `@kovojs/core/internal/package-prefix`. Verification:
    `node -e "import { execFileSync } from 'node:child_process'; const data = JSON.parse(execFileSync('node', ['scripts/exported-symbols.mjs','--json'], { encoding: 'utf8' })); const core = data.packages.find(p => p.name === '@kovojs/core'); for (const exp of core.exports) { console.log(exp.importPath); console.log(exp.symbols.map(s => s.name).join('\\n')); }"`;
    `rg -n "applyQueryDelta|buildQueryDelta|QueryDelta|EndpointRegistry|EndpointMethod|EndpointMount|EndpointCsrfExemption|EndpointAuthDeclaration|diagnosticDefinitions|diagnosticDefinitionText|isDiagnosticCode|DiagnosticDefinition|DiagnosticTextOptions|fragmentTarget|FragmentTargetPatch|stripeSignature|StripeSignatureOptions" site/gen/api/core.md packages/core/src/index.ts`.
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
- [x] **Shrink `@kovojs/drizzle/derive` and `@kovojs/drizzle/static`.**
  - Keep only app-facing runtime/build APIs with documented use cases, such as
    `deriveOptimistic` if apps directly author optimistic transforms.
  - Internalize low-level extraction/serialization/fact helpers when graph
    emission moves behind `@kovojs/cli`: `lowerTransform`,
    `serializeDerivedOptimistic`, `DerivedTransformEntry`,
    `SerializeDerivedOptimisticOptions`, `extractAlgebraicShapesFromProject`,
    `extractSymbolicEffectsFromProject`, `extractQueryFactsFromProject`,
    diagnostics helpers, serializers, `createTouchGraphEntry`, and fact/input
    wrapper types.
  - Progress evidence 2026-06-18: removed the duplicate runtime annotation aliases
    from `@kovojs/drizzle/static`; `DiagnosticCode`, `kovo`,
    `KovoDomainTableAnnotation`, `KovoTableAnnotation`, and
    `KovoTableExtraConfig` now have `@kovojs/drizzle` as their only public
    drizzle home. Verification:
    `pnpm --filter @kovojs/drizzle exec vitest run src/index src/runtime-surface.test.ts`,
    `pnpm run check:exports`, and `node scripts/api-surface-gate.mjs`.
  - [x] Move optimistic transform codegen off `@kovojs/drizzle/derive`.
    - Evidence: `@kovojs/drizzle/derive` now exports only the source-agnostic
      `deriveOptimistic` API; `lowerTransform`, `serializeDerivedOptimistic`,
      `DerivedTransformEntry`, and `SerializeDerivedOptimisticOptions` are
      available only from the manifest-declared internal
      `@kovojs/drizzle/internal/derive-codegen` subpath. Example graph scripts
      call `kovo compile drizzle-optimistic` for derived optimistic modules and
      derivation facts instead of importing the codegen helpers. Verification:
      `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts packages/conformance-fixtures/src/derivation-fixtures.test.ts`;
      `corepack pnpm --filter @kovojs/example-commerce run emit-graph -- --check`;
      `corepack pnpm --filter @kovojs/example-crm run emit-graph -- --check`;
      `corepack pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`;
      `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
      `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
      `node scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`;
      `node site/scripts/api-ref.mjs`; `node site/scripts/api-examples-check.mjs`;
      `corepack pnpm exec vitest --run scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs packages/conformance-fixtures/src/package-exports.test.ts`;
      `rg -n "@kovojs/drizzle/derive|serializeDerivedOptimistic|lowerTransform" examples packages/create-kovo/templates site/tutorial site/content site/src --glob '!**/generated/**' --glob '!**/dist/**' --glob '!**/node_modules/**'`
      returned no matches.
  - [x] Move static extraction and serialization off `@kovojs/drizzle/static`. - Evidence: `@kovojs/drizzle` now exposes only `.` and `./derive` as public
        Drizzle subpaths; `@kovojs/drizzle/static` was removed from the package
        export map and `@kovojs/drizzle/internal/static` is the manifest-declared
        internal home for extraction, query/effect/shape facts, diagnostics,
        touch-graph serializers, and invalidation serializers. Example graph
        scripts in commerce, CRM, and Stack Overflow call `kovo compile
drizzle-static` instead of importing low-level static helpers, and
        `rg -n "@kovojs/drizzle/static" packages examples site docs
public-packages.json --glob '!**/dist/**' --glob '!**/node_modules/**'`
        returned no matches. Verification:
        `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/index.serialization.test.ts packages/conformance-fixtures/src/package-exports.test.ts`;
        `corepack pnpm --filter @kovojs/example-commerce run emit-graph -- --check`;
        `corepack pnpm --filter @kovojs/example-crm run emit-graph -- --check`;
        `corepack pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`;
        `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
        `corepack pnpm run check:imports`; `corepack pnpm run check:exports`;
        `node scripts/api-surface-gate.mjs`;
        `node site/scripts/api-ref.mjs`; `node site/scripts/api-examples-check.mjs`;
        `corepack pnpm exec vitest --run site/scripts/api-ref.test.mjs site/scripts/api-examples-check.test.mjs`;
        `node scripts/build-publish.mjs`.
- [x] **Shrink `@kovojs/headless-ui` root.**
  - After direct family subpaths exist, remove primitive-family exports from the
    root so family symbols have one canonical home.
  - Review and likely internalize platform audit exports, floating/typeahead/
    navigation collection helpers, change-detail/data-attribute helpers, and
    other root utilities unless they have a documented app-authored use case.
  - Keep only package-wide helpers/tokens that are intended public API, such as
    `cn` and token CSS exports if confirmed.
  - Evidence: `packages/headless-ui/src/index.ts` now exports only foundation
    helpers/types from `src/lib/index.ts` plus `kovoHeadlessUiPrefix`; it no
    longer re-exports `src/primitives/index.ts` or platform-audit tooling.
    Compiler merge fixtures, gallery harness import aggregation, and docs now
    use direct family subpaths for primitive APIs. Current `node
scripts/exported-symbols.mjs --duplicates --json` reports 8 total
    duplicate public symbols and 0 for `@kovojs/headless-ui`; `node
scripts/api-surface-gate.mjs` reports
    `public-exports-needing-attention=1737` after removing the headless root
    baseline entries. `corepack pnpm exec vitest --run packages/headless-ui/src
packages/compiler/src/gallery-merge-fixtures*.test.tsx
packages/ui/src/index.markup.test.tsx` passed; `corepack pnpm exec tsc -p
tsconfig.json --noEmit --pretty false` passed.
- [x] **Make `@kovojs/test` root curated or subpath-only.**
  - Move duplicated root symbols to their canonical subpaths:
    assertions/property helpers to `@kovojs/test/assertions`, harness helpers to
    `@kovojs/test/harness`, PGlite helpers to `@kovojs/test/pglite`, DB verifier
    helpers to `@kovojs/test/verifier`, test-case helpers to
    `@kovojs/test/test-case`, and page helpers to `@kovojs/test/page`.
  - Review `html-fragment`, verifier diagnostics, SQL observer, and diagnostic
    message helpers for internal-only status if they mainly support conformance
    or verifier internals.
  - Evidence: `packages/test/src/index.ts` is an empty root entry, while
    docs/tutorials import canonical subpaths such as
    `@kovojs/test/assertions`, `@kovojs/test/harness`,
    `@kovojs/test/pglite`, and `@kovojs/test/test-case`. Verification:
    `rg -n "@kovojs/test'|@kovojs/test\"" SPEC.md site/content site/tutorial packages/conformance-fixtures packages/test/src/assertions.ts`
    finds no root import sites outside `package.json`, and
    `corepack pnpm exec vitest run packages/conformance-fixtures/src/package-exports.test.ts packages/test/src/headers.test.ts packages/test/src/assertions.test.ts packages/test/src/harness.test.ts packages/test/src/test-case.test.ts packages/test/src/pglite.test.ts packages/test/src/verifier.test.ts`
    passes. Follow-up evidence: `packages/test/src/verifier.ts` no longer
    re-exports `DbVerificationDiagnostic` or `diagnosticMessage`; their only
    public home is `@kovojs/test/verifier-diagnostics`. Verification:
    `corepack pnpm exec vitest --run packages/conformance-fixtures/src/package-exports.test.ts
packages/test/src/verifier.test.ts packages/test/src/verifier-diagnostics.test.ts`;
    `corepack pnpm run check:exports`; `node scripts/api-surface-gate.mjs`.
- [x] **Shrink `@kovojs/better-auth` to app-facing adapter APIs.**
  - Keep app-facing helpers such as `mount`, `betterAuthSession`, `authed`, and
    `role`/role types when their public use cases are documented and their type
    closures are public.
  - Internalize vendor mirror/shape types such as `BetterAuthApi`,
    `BetterAuthLike`, `BetterAuthRequestLike`, `BetterAuthResponseLike`,
    `BetterAuthMountHandler`, `BetterAuthMountLike`, `BetterAuthSignInEmailApi`,
    `BetterAuthSignUpEmailApi`, `BetterAuthSignOutApi`, and `*Like` credential
    API shapes unless apps must author them directly.
  - Evidence: `packages/better-auth/src/index.ts` now exports the app-facing
    adapter helpers (`mount`, `betterAuthSession`, credential mutations,
    `authed`, and `role`) plus the public type closures kept for those helpers;
    vendor mirror types such as `BetterAuthLike`, `BetterAuthResponseLike`,
    `BetterAuthSignInEmailLike`, `BetterAuthSignOutLike`, and
    `BetterAuthSignUpEmailLike` remain available only through
    `@kovojs/better-auth/internal`. App-authored files in
    `packages/create-kovo/templates/src/auth.tsx`, `examples/commerce/src/app.ts`,
    and `examples/reference/src/app.ts` define local structural fake-auth types
    instead of importing those mirrors. Verification:
    `node scripts/exported-symbols.mjs --json` reports 13 public
    `@kovojs/better-auth` root symbols; `corepack pnpm exec vitest --run
packages/better-auth/src/index.session.test.ts packages/better-auth/src/index.credential-mutations.test.ts conformance/better-auth-pin/src/index.api-table.test.ts conformance/better-auth-pin/src/index.session-credentials.test.ts packages/create-kovo/src/index.test.ts examples/commerce/src/app.auth.test.ts examples/reference/src/app-shell.test.ts`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `node site/scripts/api-ref.mjs`; `node scripts/build-publish.mjs`.
- [x] **Review `@kovojs/style` compiler-level result types.**
  - Confirm whether `CompiledStyle`, `AtomicRule`, and `AtomicCssResult` are
    necessary public type closures for public functions such as `style.create`
    and `emitAtomicCss`.
  - Keep them public only if required by public signatures; otherwise internalize
    compiler-level CSS output types.
  - Evidence: `packages/style/src/index.ts` still exposes public
    `createAtomicStyles(...): AtomicCssResult<Styles>` and
    `emitAtomicCss(rules: readonly AtomicRule[], ...)`, while app/starter code in
    `packages/create-kovo/templates/src/app.tsx` and
    `packages/create-kovo/templates/src/auth.tsx` uses `style.emitAtomicCss(...)`
    for critical CSS emission. `packages/compiler/src/style.ts` also consumes
    `createAtomicStyles`, `emitAtomicCss`, `AtomicRule`, and `CompiledStyle` as
    public type closures. Verification:
    `rg -n "createAtomicStyles|emitAtomicCss|AtomicRule|AtomicCssResult|CssEmitOptions|CompiledStyle" packages examples site docs tests conformance scripts --glob '!**/dist/**' --glob '!**/generated/**'`.

## Headless UI Subpath Cleanup

- [x] **Add direct family subpaths to existing `@kovojs/headless-ui` primitive families.**
  - Add package exports such as `./accordion`, `./alert-dialog`,
    `./autocomplete`, `./avatar`, `./checkbox`, `./checkbox-group`,
    `./combobox`, `./command`, `./collapsible`, `./context-menu`, `./dialog`,
    `./disclosure`, `./dropdown-menu`, `./field`, `./hover-card`, `./menubar`,
    `./meter`, `./navigation-menu`, `./number-field`, `./otp-field`, `./popover`,
    `./progress`, `./radio-group`, `./scroll-area`, `./select`, `./separator`,
    `./slider`, `./switch`, `./tabs`, `./toast`, `./toggle`, `./toggle-group`,
    `./toolbar`, and `./tooltip`.
  - Map each direct subpath to the existing `src/primitives/<family>.ts` file, or
    create thin source barrels only when a family needs a more app-facing name.
  - Evidence: `packages/headless-ui/package.json` exports root plus the 34
    existing primitive family subpaths directly to `src/primitives/<family>.ts`.
    There is no `src/primitives/button.ts`; `@kovojs/ui/button` is currently
    pure markup, so no empty or misleading `@kovojs/headless-ui/button` subpath
    was added.
- [x] **Remove `./primitives/*` instead of keeping compatibility aliases.**
  - Pre-release policy: direct family subpaths are canonical; `./primitives` and
    `./primitives/<family>` are removed from the package export map and from
    `public-packages.json` instead of being kept as duplicate public aliases.
  - Evidence: `rg '@kovojs/headless-ui/primitives' packages examples site docs
public-packages.json packages/headless-ui/package.json packages/ui/package.json`
    finds no stale import/export sites outside the parity test string.
- [x] **Update `public-packages.json` for the new headless-ui public subpaths.**
  - Add the direct family subpaths to `@kovojs/headless-ui.apiBoundary.public`.
  - Remove or reclassify `./primitives/*` only after the compatibility decision is
    implemented and verified.
  - Evidence: `public-packages.json` lists `.` and the direct headless-ui family
    subpaths under `@kovojs/headless-ui.apiBoundary.public`; `corepack pnpm exec
vitest --run scripts/public-packages.test.mjs packages/ui/src/headless-subpath-parity.test.ts
packages/ui/src/copy-in.test.ts` passes.
- [x] **Update `@kovojs/ui` and generated/copy-in examples to import direct headless-ui subpaths.**
  - Replace imports from `@kovojs/headless-ui/primitives` or
    `@kovojs/headless-ui/primitives/<family>` with direct family subpaths where
    applicable.
  - Ensure copied `@kovojs/ui` source remains buildable against public packages
    only.
  - Evidence: `packages/ui/src/*.tsx`, `examples/gallery/src/interactive/*`, and
    `examples/gallery/src/generated/interactive/*` import direct headless-ui
    family subpaths; `packages/ui/scripts/build-registry.mjs` accepts those
    subpaths as public `@kovojs/headless-ui` dependencies and `node
packages/ui/scripts/build-registry.mjs` reports the registry is up to date.
- [x] **Regenerate/check publish metadata and API docs for headless-ui.**
  - Run `node scripts/build-publish.mjs --write` after export-map changes.
  - Update generated API reference coverage if headless-ui direct family subpaths
    are documented.
  - Evidence: `node scripts/build-publish.mjs --write` regenerated
    `packages/headless-ui/package.json` publish metadata with 35 entries; `node
scripts/build-publish.mjs` passes. `node scripts/api-surface-gate.mjs
--write` refreshed the API ratchet for the new public subpaths and `node
scripts/api-surface-gate.mjs` passes with
    `public-exports-needing-attention=2007`.
- [x] **Verify headless-ui subpath parity.**
  - Add or update a package-exports test asserting each `@kovojs/ui/<family>` that
    depends on headless behavior has a matching `@kovojs/headless-ui/<family>`
    public subpath.
  - Evidence: `packages/ui/src/headless-subpath-parity.test.ts` asserts every
    direct headless subpath imported by `@kovojs/ui` exists in
    `packages/headless-ui/package.json` and is public in `public-packages.json`;
    `corepack pnpm exec vitest --run packages/ui/src/headless-subpath-parity.test.ts`
    passes. Broader verification: `corepack pnpm exec tsc -p tsconfig.json
--noEmit --pretty false` and `git diff --check` pass.

## UI Public Package Cleanup

- [x] **Classify `@kovojs/ui` as public in `public-packages.json`.**
  - Change visibility from private/starter to public.
  - Add `apiBoundary.public` entries for the root and every direct component
    subpath.
  - Decide whether `apiRef` pages are generated immediately or staged behind a
    baseline due to the large component surface.
  - Evidence: `public-packages.json` marks `@kovojs/ui` public/library and lists
    root plus all 44 component subpaths in `apiBoundary.public`; `corepack pnpm
exec vitest --run scripts/public-packages.test.mjs scripts/exported-symbols.test.mjs`
    passed. API reference pages are staged; `node scripts/api-surface-gate.mjs
--write` regenerated the ratchet baseline and `node scripts/api-surface-gate.mjs`
    passes with `public-exports-needing-attention=2591`.
- [x] **Remove `private: true` from `packages/ui/package.json`.**
  - Set a publishable version line consistent with other public packages.
  - Add/verify `files`, `publishConfig.exports`, and `build:dist` metadata through
    `scripts/build-publish.mjs`.
  - Evidence: `packages/ui/package.json` is version `0.1.0`, has no
    `private:true`, includes `files: ["dist"]`, `build:dist`, `prepack`, and 45
    `publishConfig.exports` entries; `node scripts/build-publish.mjs` builds
    all public packages and verifies 90 `@kovojs/ui` publish targets.
- [x] **Document the two supported UI consumption modes.**
  - Direct dependency: `@kovojs/ui/<component>` as public versioned API.
  - Copy-in: optional starter workflow for apps that want to own component source.
  - Avoid describing copy-in as the only or primary reason the package exists.
  - Evidence: `site/content/guides/components.md` documents direct
    `@kovojs/ui/<component>` imports and `kovo add` copy-in as separate supported
    modes; `git diff --check` passes.
- [x] **Apply one-symbol-one-home to `@kovojs/ui`.**
  - Component/family symbols should live on component subpaths.
  - The root should expose only curated aggregate/package-wide symbols, not every
    component symbol also exported by subpaths.
  - Evidence: `packages/ui/src/index.tsx` no longer re-exports component
    symbols; `scripts/exported-symbols.test.mjs` proves the root has no symbols
    while `@kovojs/ui/button` and behavior-backed `@kovojs/ui/select` own their
    component symbols. The duplicate detector initially caught `Drawer` aliases
    through `@kovojs/ui/sheet`; `packages/ui/src/sheet.tsx` now exports only
    sheet symbols and `corepack pnpm run check:exports` passes.
- [x] **Verify public UI package install/build behavior.**
  - Run package export checks, publish metadata checks, and a small app/import
    smoke test that imports from `@kovojs/ui/button` plus a behavior-backed
    matching pair such as `@kovojs/ui/select` / `@kovojs/headless-ui/select`.
  - Evidence: `corepack pnpm exec vitest --run scripts/public-packages.test.mjs
scripts/exported-symbols.test.mjs scripts/api-surface-gate.test.mjs
packages/ui/src/sheet.stylex.test.tsx packages/ui/src/xss-escaping.test.tsx`
    passed; `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`
    passed; `corepack pnpm run check:imports` passed; `corepack pnpm run
check:exports` passed; `node scripts/build-publish.mjs` passed.

## CLI Package Rename

- [x] **Rename package `kovo` to `@kovojs/cli`.**
  - Update `packages/cli/package.json` `"name"` while preserving
    `"bin": { "kovo": "./src/bin.ts" }`.
  - Update `publishConfig.bin` and `publishConfig.exports` as needed after the
    name change.
  - Evidence: `packages/cli/package.json` is named `@kovojs/cli` and keeps
    `bin.kovo` / `publishConfig.bin.kovo`; `node scripts/build-publish.mjs`
    builds `@kovojs/cli` and verifies `dist/bin.mjs`, `dist/api.*`, and
    `dist/index.*` publish targets.
- [x] **Update workspace dependencies and generated templates.**
  - Replace package dependencies/devDependencies on `kovo` with `@kovojs/cli`
    wherever the package is installed.
  - Keep scripts and docs invoking the executable as `kovo`.
  - Evidence: `corepack pnpm install` updated `pnpm-lock.yaml`; package manifests
    and the create-kovo starter template use `@kovojs/cli: workspace:*`.
    `corepack pnpm exec vitest --run packages/create-kovo/src/index.test.ts`
    passes and asserts the generated starter devDependency.
- [x] **Update imports from the CLI package.**
  - Replace import specifiers that refer to package `kovo` or `kovo/internal` with
    `@kovojs/cli` or `@kovojs/cli/internal`.
  - Preserve command examples as `kovo check`, `kovo explain`, etc.
  - Evidence: app/example/integration tests import `@kovojs/cli` and internal
    fixtures import `@kovojs/cli/internal`; `corepack pnpm run check:imports`
    passes. A package/import scan finds no remaining `kovo` package
    dependencies/imports outside package-prefix metadata.
- [x] **Update manifest/API docs for the CLI package rename.**
  - Change the `public-packages.json` entry from `kovo` to `@kovojs/cli`.
  - Update generated API reference, stability docs, and package export tests.
  - Evidence: `public-packages.json` lists `@kovojs/cli`; stability docs and the
    CLI API reference generator distinguish `@kovojs/cli` package identity from
    the `kovo` executable. Verification:
    `corepack pnpm exec vitest --run scripts/public-packages.test.mjs site/scripts/api-ref.test.mjs site/scripts/api-examples-check.test.mjs scripts/import-boundary.test.mjs scripts/exported-symbols.test.mjs packages/conformance-fixtures/src/package-exports.test.ts`;
    `node scripts/api-surface-gate.mjs`; `corepack pnpm run check:exports`.
- [x] **Verify the renamed package still provides the `kovo` command.**
  - Add or update tests that install/link `@kovojs/cli` and execute the `kovo`
    binary.
  - Evidence: `packages/cli/src/index.kovo-check.test.ts` asserts
    `@kovojs/cli` package metadata preserves `bin.kovo` and
    `publishConfig.bin.kovo`, and its linked-bin smoke test executes the `kovo`
    entrypoint. Verification:
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-add.test.ts`.
  - Remaining risk: `packages/cli/package.json` still depends on private
    `@kovojs/ui` for `kovo add` vendored source discovery.
    `node scripts/build-publish.mjs` proves the package can be built, but
    install-time publish correctness still requires either making `@kovojs/ui`
    public in its own open slice or bundling/moving the add catalog so
    `@kovojs/cli` no longer depends on a private workspace package.

## Vendor-Specific Export Cleanup

- [x] **Remove Stripe-specific exports from `@kovojs/core`.**
  - Remove `stripeSignature` and `StripeSignatureOptions` from public exports.
  - Keep generic webhook/HMAC primitives such as `hmacSignature`,
    `standardWebhooks`, and shared webhook request/header types where they remain
    provider-agnostic.
  - Evidence: `packages/core/src/index.ts` exports `customVerifier`,
    `hmacSignature`, and `standardWebhooks`, but not `stripeSignature` or
    `StripeSignatureOptions`. Verification:
    `corepack pnpm exec vitest --run packages/core/src/index.test.ts
packages/core/src/verifier.test.ts`; `corepack pnpm run check:api-surface`;
    `corepack pnpm run check:exports`; `corepack pnpm run check:publish`.
- [x] **Inline Stripe verification in conformance/examples that need it.**
  - Move Stripe-specific signing/verification logic into example app code or
    example-local helpers.
  - Ensure examples import only generic Kovo webhook primitives from framework
    packages.
  - Evidence: `conformance/webhook-spike/src/index.test.ts` now implements its
    Stripe-format verifier locally on top of `hmacSignature`; no app/example code
    imports provider-specific framework helpers. Verification:
    `corepack pnpm --filter @kovojs/conformance-webhook-spike test`; `rg
"stripeSignature|StripeSignatureOptions" SPEC.md packages docs site examples
scripts conformance tests --glob '!**/node_modules/**' --glob '!**/dist/**'`
    exits 1.
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

- [x] **Add a duplicate public-symbol detector.**
  - Build a script or extend `scripts/exported-symbols.mjs` to compute, per
    package, symbols exported from more than one public import path.
  - Treat root+subpath duplication as a violation by default.
  - Evidence: `scripts/exported-symbols.mjs` now supports `--duplicates` and
    reports every symbol with more than one public home per package; `corepack
pnpm exec vitest --run scripts/exported-symbols.test.mjs` passes with unit
    coverage for duplicate detection and formatting.
- [x] **Wire duplicate detection into a check script.**
  - Add a root script such as `check:exports` or fold the check into
    `check:api-surface`.
  - The check should print package, symbol, and every public import path that
    exposes it.
  - Evidence: root `package.json` defines `check:exports` as
    `node scripts/exported-symbols.mjs --duplicates --check`; `node
scripts/exported-symbols.mjs --duplicates --check` passes against the
    committed baseline.
- [x] **Classify compatibility exceptions before enforcing.**
  - If existing packages need temporary aliases, record each exception in a small
    baseline file with a reason and removal target.
  - Do not allow new duplicate root+subpath exports without editing the baseline
    and plan evidence.
  - Evidence: `scripts/exported-symbol-duplicates.baseline.json` records the
    current 8 duplicate public symbols with a migration reason and removal
    target; all are the `@kovojs/server/jsx-runtime` /
    `@kovojs/server/jsx-dev-runtime` TypeScript JSX runtime mirrors. `node
scripts/exported-symbols.mjs --duplicates --check` fails on added/removed
    duplicate homes unless the baseline is updated deliberately.
- [x] **Prefer subpath ownership for family/component symbols.**
  - For `@kovojs/headless-ui` and `@kovojs/ui`, component/family symbols should
    live on their direct family subpath. The root can export package-wide tokens,
    metadata, or explicitly curated aggregate helpers, but should not duplicate
    every family member.
  - Evidence: `@kovojs/ui` root has no component exports and
    `@kovojs/headless-ui` root has no primitive-family exports. `scripts/exported-symbols.test.mjs`
    proves `@kovojs/ui/button` and `@kovojs/ui/select` own component symbols,
    and `node scripts/exported-symbols.mjs --duplicates --json` reports zero
    duplicates for both `@kovojs/ui` and `@kovojs/headless-ui`.
- [x] **Update API docs to reflect canonical import paths.**
  - Generated or hand-authored docs should show the canonical home for each symbol
    and avoid listing duplicate aliases as equal public entry points.
  - Evidence: generated API examples no longer include internal
    `applyQueryDelta` / `buildQueryDelta` examples after query-delta helpers
    moved to `@kovojs/core/internal/query-delta`, and gallery fixture sources use
    direct `@kovojs/ui/<component>` imports instead of the empty root. Verification:
    `node site/scripts/api-ref.mjs`; `node site/scripts/api-examples-check.mjs`;
    `rg -n "from '@kovojs/ui'|from \"@kovojs/ui\"|@kovojs/headless-ui/primitives|applyQueryDelta|buildQueryDelta" examples packages/create-kovo/templates site/content docs site/gen/api --glob '!**/dist/**' --glob '!**/generated/**'`
    exits 1; `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `corepack pnpm exec vitest --run packages/core/src/index.test.ts packages/core/src/query-delta.test.ts site/scripts/api-examples-check.test.mjs`.
    Residual unrelated gap: `corepack pnpm --filter @kovojs/example-gallery test`
    currently fails in `src/kovo-explain-contracts.test.ts` because
    `@kovojs/cli/internal` is not resolvable from the example package.

## Open Risks

- [x] **The public Vite surface may overlap with the future deployment API.**
  - `plans/easy-deployment.md` tracks `kovo build` and presets. Do not freeze
    low-level build helpers prematurely if a future higher-level command will
    replace them.
  - Evidence: the former public `@kovojs/server/app-shell/vite` subpath is gone,
    Vite replay helpers stay internal, and app-authored export scripts call the
    `@kovojs/cli` command facade instead. Current deployment build work is
    isolated behind `@kovojs/server/build` and remains tracked by
    `plans/easy-deployment.md`. Verification: `corepack pnpm run
    check:imports`; `corepack pnpm run check:exports`; `node
    scripts/api-surface-gate.mjs`; `node scripts/build-publish.mjs`.
- [x] **Starter templates use SSR dynamic loading.**
  - Existing starter code calls `server.ssrLoadModule('@kovojs/server/app-shell/vite')`.
    Any rename or removal must update templates, example configs, and tests in the
    same slice.
  - Evidence: `packages/create-kovo/templates/scripts/export-static.mjs` and
    `site/scripts/export-static.mjs` SSR-load `@kovojs/cli` and call
    `runKovoCommand(['export', ..., '--vite', ...])`; starter tests assert the
    removed app-shell Vite import is absent. Verification: `corepack pnpm run
    check:imports`; `node scripts/build-publish.mjs`.
- [x] **Published `publishConfig.exports` must not drift.**
  - `package.json` top-level source exports and `publishConfig.exports` must stay
    in sync through `scripts/build-publish.mjs`.
  - Evidence: `node scripts/build-publish.mjs` built all public packages and
    verified every `publishConfig` target file for the current export maps.
- [ ] **The `kovo` CLI currently imports `@kovojs/compiler`.**
  - Making `@kovojs/compiler` fully private/unpublished may require bundling the
    compiler into `@kovojs/cli` or moving compiler internals behind a package that
    only framework packages consume.
- [x] **Headless-ui subpath migration can duplicate API reference debt.**
  - Adding direct subpaths before deciding `./primitives/*` compatibility may
    temporarily double the documented/exported headless-ui surface. Keep the
    compatibility window explicit and bounded.
  - Evidence: `./primitives` and `./primitives/*` were removed rather than kept
    as compatibility aliases; `public-packages.json` documents only root plus
    direct family subpaths. Verification: `corepack pnpm run check:exports`;
    `node scripts/build-publish.mjs`.
- [x] **Compatibility aliases may be needed during migration.**
  - If root barrels currently re-export symbols app code imports directly, enforce
    the rule with a ratchet/baseline first, then remove duplicates in scoped
    package slices.
  - Evidence: `scripts/exported-symbol-duplicates.baseline.json` now ratchets the
    remaining JSX runtime mirrors, and `node scripts/exported-symbols.mjs
    --duplicates --check` passes through `corepack pnpm run check:exports`.
- [x] **Renaming the CLI package can confuse command-vs-package docs.**
  - Docs must consistently distinguish package name `@kovojs/cli` from executable
    name `kovo`.
  - Evidence: package manifests, starter dependencies, stability docs, and API
    docs use package name `@kovojs/cli` while command examples keep the `kovo`
    executable. Verification: `corepack pnpm run check:imports`; `corepack pnpm
    run check:exports`; `node scripts/api-surface-gate.mjs`.
- [x] **Making `@kovojs/ui` public will expand API-surface debt.**
  - The package has many component exports. Use the duplicate-symbol detector,
    API-surface baseline, and focused documentation slices so publicizing it does
    not silently bless accidental root exports.
  - Evidence: `@kovojs/ui` is public, root component duplicates are removed, API
    surface and duplicate-export ratchets are in place, and `node
    scripts/api-surface-gate.mjs` plus `corepack pnpm run check:exports` pass.
- [x] **Internalizing server helpers may require app-owned script rewrites.**
  - Prefer local example/starter helper code or `kovo` commands over keeping
    framework support helpers public just because current examples import them.
  - Evidence: starter/site export scripts use the CLI facade, static-export
    formatting helpers are local where needed, and app/example imports no longer
    require public server support-helper aliases. Verification: `corepack pnpm
    run check:imports`; `node scripts/api-surface-gate.mjs`.
- [x] **Examples may still need realistic webhook integrations.**
  - Keep provider-specific code local to examples so recipes stay useful without
    promoting vendor names into framework package APIs.
  - Evidence: Stripe-specific framework exports were removed, example/conformance
    provider verification is local code over generic webhook primitives, and
    public symbol checks reject provider-specific leaks. Verification: `node
    scripts/api-surface-gate.mjs`; `corepack pnpm run check:exports`.
