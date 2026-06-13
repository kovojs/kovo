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
  replayed no-JS artifact before client modules or files are written.
- `static-export-types.ts` now owns stable export-task diagnostic type guards and formatting.
  The create-jiso starter and commerce export tasks load those helpers from `@jiso/server`
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

## Open Work

R6:

- Prove remaining directory-index HTML output and manifest asset copying acceptance across public
  export-task consumers.
- Keep dry-run and write export validation equivalent.

R7:

- Move starter to routed app-shell dev/export tasks.
- Move commerce over HTTP rather than package-internal shortcuts where user-facing examples are
  concerned.
- Keep docs-site export as the first outside consumer; remaining work is broader launch/readiness
  evidence outside the critical implementation path.

Quality constraints:

- Server extraction must be subtractive: split modules should own behavior, not copy root logic.
- Public API additions require package/root export assertions.
- Checklist boxes require direct same-session evidence; partial slices add only bounded evidence.
