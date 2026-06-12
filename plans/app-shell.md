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
- [ ] R5 Vite+ plugin: dev middleware over the same handler plus build wiring.
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
  export helpers, and build static-export asset planning.
- `static-export.ts` performs static export with output target validation for write and dry-run
  plans; duplicate asset paths fail with FW229.

Recent gates:

- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts plans/app-shell.md`
- `git diff --check`

## Open Work

R5:

- Finish Vite+ dev/build closure against the same request handler.
- Keep manifest-derived stylesheet/modulepreload hints and compiled client module registry in one
  helper path.
- Avoid app-shell plugin code that re-derives static export assets outside the public planner.

R6:

- Wire Vite build outputs into static export tasks used by starter/docs.
- Prove directory-index HTML output, manifest asset copying, duplicate target rejection, and
  L0/L1-only constraints through focused tests.
- Keep dry-run and write export validation equivalent.

R7:

- Move starter to routed app-shell dev/export tasks.
- Move commerce over HTTP rather than package-internal shortcuts where user-facing examples are
  concerned.
- Treat docs-site export as the first outside consumer, but keep P10 external launch/readiness
  evidence outside the critical implementation path.

Quality constraints:

- Server extraction must be subtractive: split modules should own behavior, not copy root logic.
- Public API additions require package/root export assertions.
- Checklist boxes require direct same-session evidence; partial slices add only bounded evidence.
