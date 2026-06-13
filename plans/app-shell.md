# App shell - request dispatch, document assembly, dev/build/export

Status: active. Last compacted on 2026-06-12.

Scope: `@jiso/server` request shell, node adapter, Vite+ plugin, static export, starter adoption,
commerce/docs adoption, and SPEC §9.5 conformance. Keep this file short: current status, open
work, and proving commands.

## Progress Checklist

- [x] S8 spike: pinned wire fixtures served through real HTTP.
- [x] SPEC PR: §9.5 request shell, `createApp()` surface, error shells, export semantics, FW228,
      FW229.
- [x] R1 route matcher and dispatch table.
- [x] R2 document assembly, deferred-stream variant, error shells.
- [x] R3 `createApp()` aggregate and `createRequestHandler(app)` over `Request -> Response`.
- [x] R4 node:http adapter including Early Hints; perf proof migrated to the adapter.
- [x] R5 Vite+ plugin: dev middleware over the same handler plus build wiring.
- [ ] R6 static export: synthetic-request replay to directory-index HTML with L0/L1 constraints
      and teaching errors for non-exportable routes.
- [ ] R7 adoption: starter served by `vp dev`, commerce over HTTP, docs site exported as an
      outside consumer.

## Current Evidence Rollup

Implemented areas:

- `packages/server/src/match.ts` and `shell.ts` own static-first matching, trailing-slash 308
  metadata, ambiguity detection, and printable dispatch order.
- `document-core.ts` assembles route documents, query hydration, loader placement, deferred stream
  shells, templates, and stable error documents; `app-document.ts` owns app-configured route and
  error-shell response assembly.
- `app.ts` provides the closed app aggregate and web-standard handler for routes, endpoints,
  queries, mutations, static modules, and error responses.
- `node.ts` adapts web requests/responses to `node:http` and emits Early Hints from `Link`.
- `api/app-shell/vite.ts` is the public app-shell Vite subpath over the split Vite owners.
  `vite-plugin.ts` owns R5 dev middleware and plugin `writeBundle` build/export bridging, while
  the manifest, build, output, static-export, and dev modules own their extracted surfaces.
  `vite-dev.ts` now defaults SSR dev middleware to the loaded app's SPEC §9.5
  `Request -> Response` handler while keeping explicit node-handler exports available for apps
  that add request context at the adapter edge.
- `static-export.ts` performs static export with output target validation for write and dry-run
  plans; duplicate asset paths fail with FW229. Param routes export only through explicit
  `staticPaths` concrete URL enumeration.
- `static-export-document.ts` owns synthetic route-document replay, artifact path selection, and
  SPEC §9.5 L0/L1 endpoint rejection for exported no-JS documents; it also discovers same-origin
  full-URL `/c/` module refs from route HTML and `Link` headers, preserving SPEC §4.3's full
  module URL contract while publishing static-host `/c/` files.
- `static-export-types.ts` now owns stable export-task diagnostic type guards/formatting,
  SPEC §11.3 compile-diagnostic blocking for SPEC §9.5 static export, and a public export
  manifest for directory-index documents, copied assets, and `/c/` modules. The create-jiso
  starter and commerce export tasks load the diagnostic helpers from `@jiso/server` instead of
  duplicating local FW229 formatting.
- `vite-plugin-build.ts` owns the Vite plugin `writeBundle` build/static-export choreography and
  exposes a public app-shell helper, leaving `vite-plugin.ts` focused on dev middleware and hook
  delegation while preserving plugin `onBuild` output evidence.

Recent gates:

- `pnpm exec vitest --run packages/server/src/vite.test.ts packages/server/src/vite-dev.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-dev.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/vite.test.ts packages/server/src/vite-build.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite.ts packages/server/src/vite-build.ts packages/server/src/vite.test.ts packages/server/src/api/app-shell/vite.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts plans/app-shell.md`
- `git diff --check`

Round79 slice evidence:

- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/route.ts packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts plans/app-shell.md`
- `git diff --check`

Round83 app-shell export-task evidence:

- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "runs the generated starter app-shell request and export proof|serves the generated starter app-shell through the vp dev task|runs .*built stylesheet|formats generated export task diagnostics|scaffolds real template files"`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-types.ts packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/scripts/export-static.mjs examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round84 docs outside-consumer export evidence:

- Docs-site export now uses the public `@jiso/server` app-shell helpers for FW229 diagnostic
  formatting/type guards and the singular Vite stylesheet manifest assertion. Starter and
  commerce export tasks use the same singular stylesheet helper before manifest-backed static
  replay.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|formats generated export task diagnostics"`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export"`
- `pnpm exec vitest --run site/scripts/app-shell.test.mjs`
- `pnpm exec vp check packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/scripts/export-static.mjs examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts site/scripts/export-static.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round85 app-shell static replay evidence:

- `pnpm exec vitest --run packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-replay.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- Commerce public static export now renders home/cart/login as L0/L1-safe read-only documents with
  no same-origin `/_m/` form actions, while the dynamic commerce shell keeps mutation forms.
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`
- `pnpm exec vp check examples/commerce/src/components/product-grid.tsx examples/commerce/src/generated/product-grid.tsx examples/commerce/src/app.ts examples/commerce/src/app-shell.ts examples/commerce/src/app-shell.test.ts`
- `git diff --check`

Round86 server public export manifest evidence:

- `staticExportManifest()` exposes the directory-index route documents, copied static assets, and
  referenced `/c/` modules as a stable public export-task object.
- `staticExportManifestForJisoAppShellViteBuild()` and
  `staticExportManifestForJisoAppShellViteBuildFromManifestFile()` prove the manifest-backed dry
  run path through the same SPEC §9.5 replay/copy planning as write export, and public/root barrel
  tests pin those exports.
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round86b app-shell consumer manifest evidence:

- Starter and docs-site export tasks now call
  `staticExportManifestForJisoAppShellViteBuildFromManifestFile()` before write export, so their
  task output proves the same public manifest-backed route document, `/c/` module, and Vite asset
  counts that SPEC §9.5 static replay would publish.
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`
- `pnpm exec vitest --run site/scripts/app-shell.test.mjs`

Round86c app-shell static export output-plan evidence:

- `staticExportOutputPlan()` exposes the route document, `/c/` module, and static asset target
  files that a write export would publish, and `exportStaticApp()` now validates dry-run and write
  exports through the same planned-write object before any bytes are written.
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round86d app-shell dev/serve boundary evidence:

- `@jiso/server` node/http adapters now expose an Early Hints suppression option that preserves
  final `Link` headers for middleware stacks that cannot safely relay 103 responses, and
  `jisoAppShellViteSsrDevPlugin()` threads that option through the default loaded-app
  `Request -> Response` adapter.
- The create-jiso starter no longer exports a starter-specific Node handler for dev/serve.
  Generated `vp dev`, `vp run serve`, `npm run serve`, and `npm start` load the default exported
  Jiso app through the public app-shell dev plugin, while static export keeps the manifest-backed
  replay path.
- `pnpm exec vitest --run packages/server/src/node.test.ts packages/server/src/vite-dev.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|typechecks the generated auth recipe|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check IMPLEMENT_v1.md packages/create-jiso/src/index.test.ts packages/create-jiso/templates/README.md packages/create-jiso/templates/docs/deployment.md packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/templates/src/app-shell.ts packages/create-jiso/templates/vite.config.ts packages/server/src/api/app-shell/node.ts packages/server/src/api/app.test.ts packages/server/src/node.test.ts packages/server/src/node.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-dev.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round87 app-shell static replay evidence:

- Static replay now normalizes same-origin absolute `/c/` module refs discovered in route HTML
  attributes or `Link` headers, ignores external `/c/` refs, and copies the normalized client
  module files through the same `Request -> Response` handler used for root-relative refs.
- `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`

Round88 app request extraction evidence:

- `packages/server/src/app-request.ts` now owns the SPEC §9.5 request dispatch choreography for
  client modules, query endpoints, mutation POSTs, endpoints, route document assembly, and
  configured error shells; `app.ts` remains the closed app aggregate/public type surface.
- `packages/server/src/app.test.ts` pins configured error-shell rendering through the extracted
  request boundary.
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`

Round89 app-shell static document boundary evidence:

- `packages/server/src/static-export-document.ts` now owns static-export document reference
  discovery for same-origin `/c/` modules and SPEC §9.5 L0/L1 server endpoint rejection, so
  `static-replay.ts` only choreographs synthetic requests, replay validation, and artifact
  assembly.
- `packages/server/src/static-replay.test.ts` pins the extracted boundary separately from replay
  execution.
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round90 app-shell static export boundary evidence:

- `packages/server/src/static-export-route-plan.ts` now owns exportable route target planning and
  FW229 route/staticPaths diagnostics, leaving `static-export.ts` to orchestrate the export.
- `packages/server/src/static-export-response.ts` now owns replayed route-document and `/c/`
  client-module response validation/body extraction, leaving `static-replay.ts` to choreograph
  synthetic requests, L0/L1 validation, and artifact assembly.
- `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-export-route-plan.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round91 app-shell static replay request/client-module evidence:

- `packages/server/src/static-export-request.ts` now owns SPEC §9.5 synthetic GET request
  construction for route documents and versioned `/c/` module hrefs.
- `packages/server/src/static-export-client-modules.ts` now owns discovered `/c/` module replay,
  same-output-path deduplication, and FW229 query-version drift diagnostics, leaving
  `static-replay.ts` focused on route-document replay and L0/L1 validation.
- `pnpm exec vitest --run packages/server/src/static-export-request.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round92 app-shell static export output boundary evidence:

- `packages/server/src/static-export-output.ts` now owns static export asset normalization,
  directory target planning, output path safety, conflict diagnostics, source readability checks,
  and write execution, leaving `static-export.ts` to orchestrate SPEC §9.5 route replay,
  `/c/` module replay, asset planning, and optional writes.
- `packages/server/src/static-export-output.test.ts` pins dry-run planning, unsafe target
  rejection, duplicate output diagnostics, and all-or-nothing source validation before writes.
- `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round93 app-shell Vite static-export boundary evidence:

- `packages/server/src/vite-build-assets.ts` now owns Vite manifest asset-to-static-export
  planning, manifest file lookup, output path containment, and asset content-type inference.
- `packages/server/src/vite-static-export.ts` now owns SPEC §9.5 Vite build static export,
  dry-run inventory, public manifest, and manifest-file wrappers, leaving `vite-build.ts` focused
  on app/build construction and `/c/` module output.
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-build.ts packages/server/src/vite-build-assets.ts packages/server/src/vite-static-export.ts packages/server/src/vite.ts packages/server/src/vite-build.test.ts packages/server/src/api/app-shell/vite.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round94 app-shell Vite build output boundary evidence:

- `packages/server/src/vite-build-output.ts` now owns Vite output directory selection, compiled
  `/c/` client-module writes, static-export asset publication planning, and output path safety,
  leaving `vite-build.ts` to construct manifest-backed app-shell builds.
- `packages/server/src/vite-build.test.ts` pins the extracted output seam, including
  `output.dir`/`output.file` resolution and rejection of writes outside the Vite output tree.
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`

Round95 app-shell Vite output/static-export evidence:

- `writeJisoAppShellViteBuildOutput()` now owns optional SPEC §9.5 static export execution for
  Vite app-shell builds and returns one output object containing compiled `/c/` modules, Vite
  static-export asset inputs, and the static export result.
- `jisoAppShellVitePlugin().writeBundle()` now delegates plugin-time static export to that output
  boundary, leaving `vite.ts` to assemble the manifest-backed build and call `onBuild`.
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round96 app-shell Vite static-export options evidence:

- `packages/server/src/vite-static-export-options.ts` now owns Vite static-export build/option
  normalization: manifest-file build projection, write-vs-dry-run output stripping, and SPEC §9.5
  manifest asset injection for export, inventory, and manifest callers.
- `packages/server/src/vite-static-export.ts` is now a thinner public facade over the shared
  option/result boundary, so export, inventory, and manifest paths no longer duplicate static
  export option assembly.
- `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-static-export.ts packages/server/src/vite-static-export-options.ts packages/server/src/vite-static-export-options.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round97 app-shell Vite output atomicity evidence:

- `writeJisoAppShellViteBuildOutput()` now preplans compiled `/c/` module writes and runs the
  optional SPEC §9.5 static export gate before writing helper-owned Vite output files, so FW229
  plugin-time export rejection does not leave partial app-shell client modules behind.
- `packages/server/src/vite-build.test.ts` pins guarded-route FW229 rejection with no emitted
  Vite `/c/` file and no static export document.
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round98 app-shell static export output atomicity evidence:

- `writeStaticExportOutput()` now stages route documents, immutable `/c/` modules, and copied
  static assets before committing them into the configured output directory, and validates final
  output targets before staging so a late FW229 target conflict leaves no partial route/module
  files behind (SPEC §9.5).
- `packages/server/src/static-export-output.test.ts` pins a directory-at-file-target rejection
  with no committed route document or `/c/` module.
- `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round99 app-shell Vite client-module output atomicity evidence:

- `writeJisoAppShellViteBuildOutput()` now stages helper-owned compiled `/c/` module writes under
  the Vite output root and validates duplicate/directory targets before committing, so a rejected
  Vite client-module target does not leave earlier module files behind (SPEC §9.5).
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round100 app-shell error diagnostic seam evidence:

- App-configured error shells now report renderer failures through the `error-shell` `onError`
  context and fall back to the stable 404/500 document instead of letting shell internals escape
  the public `Request -> Response` handler (SPEC §9.2/§9.5).
- `pnpm exec vitest --run packages/server/src/app.test.ts`
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/static-replay.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`

Round101 app-shell static replay response evidence:

- `packages/server/src/static-export-response.ts` now owns one SPEC §9.5 replay response reader
  for route documents and immutable `/c/` modules, preserving the separate FW229 teaching
  diagnostics while sharing status/content-type/body/header extraction.
- `packages/server/src/static-export-types.ts` now exposes one body/header/status snapshot shape
  shared by replay validation and the route/client-module public export artifacts.
- `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-response.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-types.ts packages/server/src/static-replay.ts packages/server/src/static-export-client-modules.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round102 app-shell app/document boundary evidence:

- `packages/server/src/app-document.ts` now owns app route document assembly, app-configured
  error-shell rendering, stable no-internals fallback documents, and the shared request URL
  snapshot used by app request diagnostics (SPEC §9.2/§9.5).
- `packages/server/src/app-mutation-request.ts` now owns app mutation request body/session
  preparation and mutation response option setup, leaving `app-request.ts` focused on the
  normative SPEC §9.5 dispatch order.
- `pnpm exec vitest --run packages/server/src/app-document.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/app.test.ts packages/server/src/static-export.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/app-request.ts packages/server/src/app-document.ts packages/server/src/app-document.test.ts packages/server/src/app-mutation-request.ts packages/server/src/app-mutation-request.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round103 app-shell static export replay boundary evidence:

- `packages/server/src/static-export-replay.ts` now owns SPEC §9.5 app static-export replay
  choreography: route-plan diagnostics, replay-time skip/error policy, route document replay,
  client-module replay, and HTML path style validation before output planning.
- `packages/server/src/static-export-replay.test.ts` pins replay-time skip behavior, continued
  `/c/` module replay from retained documents, route-plan diagnostic ordering, and pre-replay
  invalid `htmlPathStyle` rejection.
- `pnpm exec vitest --run packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-replay.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`

Round104 app-shell static document inspection evidence:

- `packages/server/src/static-export-document.ts` now owns SPEC §9.5 static-export document
  inspection with a server-side scanner for quoted, unquoted, uppercase, and entity-decoded
  attributes, plus route document artifact path selection.
- `packages/server/src/static-replay.ts` delegates artifact path selection to that document
  boundary and stays focused on synthetic request replay plus L0/L1 validation.
- `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-replay.ts packages/server/src/static-replay.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round105 app-shell static replay compatibility deletion evidence:

- `packages/server/src/static-export-document.ts` now also owns SPEC §9.5 synthetic
  route-document replay and L0/L1 validation, so the leftover `static-replay.ts` compatibility
  module was deleted and `static-export-replay.ts` calls the document boundary directly.
- `packages/server/src/static-replay.test.ts` now pins route-document replay and document
  reference discovery against the `static-export-document.ts` owner.
- `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-replay.ts packages/server/src/static-replay.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round106 app-shell static document/client replay evidence:

- `packages/server/src/static-export-document.ts` now also owns discovered `/c/` client-module
  artifact replay, same-output-path dedupe, and FW229 query-version drift diagnostics for
  SPEC §9.5 static export, deleting the standalone `static-export-client-modules.ts` seam.
- `packages/server/src/static-export-response.ts` now exposes only the policy-discriminated
  replay response reader; route-document and client-module wrapper readers were removed so both
  artifact paths use the same response snapshot boundary directly.
- `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-response.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-response.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round107 app-shell mutation lifecycle/wire ownership evidence:

- App mutation dispatch now delegates session resolution to the shared `resolveLifecycleRequest`
  boundary used by route/query paths, so the SPEC §9.5 app shell gives mutation response options
  and guarded handlers the same resolved session without mutating the original web `Request`.
- Public `renderQueryScript` now exports directly from `wire-html.ts`, deleting the mutation-local
  compatibility wrapper, and the unused static-export response body alias was removed.
- `pnpm exec vitest --run packages/server/src/app-mutation-request.test.ts packages/server/src/api/app.test.ts packages/server/src/wire-html.test.ts packages/server/src/mutation-response.test.ts packages/server/src/static-export-response.test.ts packages/server/src/guards.test.ts`
- `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/app-mutation-request.ts packages/server/src/app-mutation-request.test.ts packages/server/src/guards.ts packages/server/src/mutation.ts packages/server/src/api/data.ts packages/server/src/api/app.test.ts packages/server/src/static-export-response.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round154 app-shell Vite output plan evidence:

- `packages/server/src/vite-client-module-output.ts` now owns an inspectable SPEC §9.5
  compiled `/c/` module output plan and the staged commit that writes that exact plan.
- `writeJisoAppShellViteBuildOutput()` returns that client-module output plan alongside the
  built module list, Vite static-export asset inputs, and optional static export result, so Vite
  plugin `onBuild` consumers observe the same targets the output commit publishes.
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-client-module-output.ts packages/server/src/vite-build-output.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

## Open Work

R6:

- Keep the checklist open until a same-session sweep proves replay, L0/L1 constraints, and
  manifest consumer adoption together; Round86b covers starter/docs manifest consumers, while
  commerce L0/L1 public output is already covered by the Round85 evidence above.

R7:

- Move commerce over HTTP rather than package-internal shortcuts where user-facing examples are
  concerned.
- Keep docs-site export as the first outside consumer; remaining work is broader launch/readiness
  evidence outside the critical implementation path.
- Starter routed app-shell `vp dev`, serve, and export adoption is covered by Round86d; keep R7
  open for the remaining commerce/docs launch-readiness sweep.

Quality constraints:

- Server extraction must be subtractive: split modules should own behavior, not copy root logic.
- Public API additions require package/root export assertions.
- Checklist boxes require direct same-session evidence; partial slices add only bounded evidence.

Round108 app-shell Vite plugin/root barrel deletion evidence:

- `packages/server/src/vite-plugin.ts` now owns the R5 Vite app-shell middleware and plugin
  `writeBundle` bridge for manifest-backed builds plus optional SPEC §9.5 static export,
  leaving `packages/server/src/vite.ts` as the public Vite aggregate.
- `packages/server/src/index.ts` now exports the canonical `api/app-shell/index.ts` split
  directly, and the unused internal `packages/server/src/api/app.ts` compatibility barrel was
  deleted; `packages/server/src/api/app.test.ts` pins root and subpath exports to the split
  owners for R5/R6/R7 consumers.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/static-export.test.ts packages/server/src/static-export-replay.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-plugin.ts packages/server/src/vite.ts packages/server/src/index.ts packages/server/src/api/app.test.ts packages/server/src/vite.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round109 app-shell static export diagnostic boundary evidence:

- `packages/server/src/static-export-types.ts` now owns SPEC §11.3 compile-diagnostic blocking
  for SPEC §9.5 static export beside the stable static export diagnostic formatting/type surface;
  `static-export.ts` stays focused on replay, output planning, and optional writes.
- `packages/server/src/static-export-diagnostics.test.ts` proves error diagnostics stop before
  route replay/output writes while lint diagnostics continue through synthetic document replay.
- `pnpm exec vitest --run packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-static-export-options.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export-types.ts packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round117 app-shell dispatch/Vite subpath evidence:

- `packages/server/src/app-dispatch.ts` now owns matched SPEC §9.5 request dispatch for
  client modules, query endpoints, mutation POSTs, raw endpoints, route documents, 405s, and 404
  error shells; `app-request.ts` keeps URL normalization plus the outer error fallback.
- `packages/server/src/api/app-shell/vite.ts` exports directly from the split Vite owners instead
  of routing the app-shell Vite subpath through the aggregate `vite.ts`.
- `pnpm exec vitest --run packages/server/src/app-dispatch.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`

Round120 app-shell static document/client replay evidence:

- `packages/server/src/static-export-document.ts` now owns only SPEC §9.5 route-document replay,
  output path selection, and L0/L1 endpoint rejection; document reference discovery lives in
  `static-export-document-refs.ts`, and `/c/` artifact replay/dedupe lives in
  `static-export-client-module-artifacts.ts`.
- `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-static-export-options.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-document-refs.ts packages/server/src/static-export-client-module-artifacts.ts packages/server/src/static-export-replay.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round124 app-shell Vite client-module output evidence:

- `packages/server/src/vite-client-module-output.ts` now owns validated, staged compiled `/c/`
  module writes for SPEC §9.5 Vite app-shell builds; `vite-build-output.ts` keeps only static
  export/output orchestration.
- `packages/server/src/index.ts` exports app-shell owner subpaths directly instead of routing the
  root package through the app-shell aggregate barrel.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-client-module-output.ts packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts packages/server/src/index.ts packages/server/src/api/app.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round128 app-shell aggregate deletion evidence:

- The unused internal `packages/server/src/document.ts` aggregate was deleted; app/document/dev
  imports now target `document-core.ts` or `document-diagnostics.ts`, and the public rendering
  barrel exports those owners directly.
- The unused internal `packages/server/src/vite.ts` aggregate was deleted; Vite tests now exercise
  the `api/app-shell/vite.ts` public subpath over the split Vite manifest/build/export/dev/plugin
  owners.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts packages/server/src/vite-diagnostics.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/api/rendering.ts packages/server/src/app.ts packages/server/src/app-document.ts packages/server/src/vite-dev.ts packages/server/src/api/app.test.ts packages/server/src/vite.test.ts packages/server/src/vite-diagnostics.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round131 starter app-shell subpath adoption evidence:

- `packages/server/src/index.ts` now delegates the root package app-shell surface through
  `api/app-shell/index.ts`, and `packages/server/src/api/app.test.ts` pins the Vite dev/export
  helpers used by R5/R6/R7 consumers through root, `@jiso/server/app-shell`, and
  `@jiso/server/app-shell/vite`.
- The create-jiso starter now imports app-shell core/client/static-export helpers and loads Vite
  dev/export helpers from `@jiso/server/app-shell/*` subpaths, leaving the root package for
  JSX/routing APIs.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts -t "server app-shell public API barrels|scaffolds real template files|typechecks the generated auth recipe|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through the vp dev task|runs .* with the built stylesheet href|formats generated export task diagnostics"`
- `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/index.ts packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/src/app-shell.ts packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/templates/vite.config.ts packages/create-jiso/templates/scripts/export-static.mjs IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round137 starter static-host export evidence:

- The create-jiso starter now ships `scripts/preview-static.mjs` plus a Vite+ `preview-static`
  task that serves only the exported `dist` tree, so local static-host checks cannot fall back to
  Vite source assets after SPEC §9.5 app-shell replay/export.
- Generated starter export tests now run `vp run export` and `npm run static`, then spawn
  `vp run preview-static` against the output and prove `/`, the built stylesheet, and the
  versioned `/c/` module are served from `dist` while `/src/styles.css` returns 404.
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs .* with the built stylesheet href"`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/create-jiso/src/index.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/package.json packages/create-jiso/templates/vite.config.ts packages/create-jiso/templates/scripts/preview-static.mjs packages/create-jiso/templates/README.md packages/create-jiso/templates/docs/deployment.md plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`

Round142 app-shell wire-html emitter evidence:

- `packages/server/src/wire-html.ts` now owns stylesheet-link prepending for
  `<fw-fragment>` payloads, so mutation responses and deferred stream fragments share one
  SPEC §9.5 fragment wire-html emitter instead of composing stylesheet HTML at each producer.
- `packages/server/src/wire-html.test.ts` pins fragment stylesheet dedupe and href escaping at
  the emitter boundary while existing mutation/deferred tests prove byte-compatible output.
- `pnpm exec vitest --run packages/server/src/wire-html.test.ts packages/server/src/mutation-response.test.ts packages/server/src/deferred-stream.test.ts`

Round145 app-shell static document/client replay evidence:

- `packages/server/src/static-export-document.ts` now owns both SPEC §9.5 route-document replay
  and the discovered same-origin `/c/` client-module replay, including same-output-path
  query-version drift diagnostics; `static-export-document-refs.ts` remains the shared HTML/Link
  reference scanner.
- The redundant `static-export-client-module-artifacts.ts` module was deleted, and the stale
  `static-replay.test.ts` document-boundary test was renamed to
  `static-export-document.test.ts`.
- `pnpm exec vitest --run packages/server/src/static-export-document.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-document-refs.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-client-modules.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

Round149 app-shell static export diagnostic seam evidence:

- `packages/server/src/static-export-types.ts` now owns both export-task diagnostic
  formatting/type guards and SPEC §11.3 compile-diagnostic blocking for SPEC §9.5 static export,
  deleting the standalone `static-export-diagnostics.ts` module.
- `packages/server/src/static-export.ts` imports that single diagnostic seam before replay/output
  orchestration, and `static-export-diagnostics.test.ts` proves error diagnostics stop before
  route replay or output writes while lint diagnostics continue through synthetic replay.
- `pnpm exec vitest --run packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "formats generated export task diagnostics|scaffolds real template files|runs .* with the built stylesheet href"`
- `pnpm exec tsc --noEmit --pretty false`

Round160 app-shell Vite plugin build boundary evidence:

- `packages/server/src/vite-plugin-build.ts` now owns SPEC §9.5 Vite plugin `writeBundle`
  build/output/static-export execution, so `packages/server/src/vite-plugin.ts` only wires dev
  middleware and delegates the build hook.
- `@jiso/server/app-shell/vite` now exports `writeJisoAppShellVitePluginBuild()`, and
  `packages/server/src/api/app.test.ts` pins that helper through root, app-shell, and package
  subpath barrels.
- `pnpm exec vitest --run packages/server/src/vite-plugin-build.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
