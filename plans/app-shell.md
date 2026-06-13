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
- `document.ts` assembles route documents, query hydration, loader placement, deferred stream
  shells, templates, and stable error documents.
- `app.ts` provides the closed app aggregate and web-standard handler for routes, endpoints,
  queries, mutations, static modules, and error responses.
- `node.ts` adapts web requests/responses to `node:http` and emits Early Hints from `Link`.
- `vite.ts` exposes app-shell Vite plugin/build helpers, route-entry mapping, manifest
  validation, manifest-derived hints/assets, compiled `/c/` module emission, manifest-file
  export helpers, build static-export asset planning, and plugin `writeBundle` static export
  wiring over the same Vite build helper. `vite-dev.ts` now defaults SSR dev middleware to the
  loaded app's SPEC §9.5 `Request -> Response` handler while keeping explicit node-handler
  exports available for apps that add request context at the adapter edge.
- `static-export.ts` performs static export with output target validation for write and dry-run
  plans; duplicate asset paths fail with FW229. Param routes export only through explicit
  `staticPaths` concrete URL enumeration.
- `static-replay.ts` rejects exported route documents that still reference same-origin `/_m/` or
  `/_q/` server endpoints, so SPEC §9.5 L0/L1-only constraints are enforced on the synthetic
  replayed no-JS artifact before client modules or files are written. It also discovers
  same-origin full-URL `/c/` module refs from route HTML and `Link` headers, preserving
  SPEC §4.3's full module URL contract while publishing static-host `/c/` files.
- `static-export-types.ts` now owns stable export-task diagnostic type guards/formatting and a
  public export manifest for directory-index documents, copied assets, and `/c/` modules. The
  create-jiso starter and commerce export tasks load the diagnostic helpers from `@jiso/server`
  instead of duplicating local FW229 formatting.

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
