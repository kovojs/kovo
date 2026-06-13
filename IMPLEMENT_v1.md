# Jiso v1 — Implementation Plan

**Companion to:** `SPEC.md` v0.2
**Scope:** §14 roadmap rows **v1**, **v1 (blessed)**, and **v1.5** (runtime verification layer), plus the §13 open design areas as explicit workstreams.
**Shape:** dependency-ordered phases with deliverables and exit criteria. No timelines or headcount assumptions.

## Progress checklist

Audited against the repository on 2026-06-11. Checkmarks mean the behavior, API, tests, or gate wiring exists in the codebase; unchecked items are still roadmap work or only partially represented.

- [x] Vite+ baseline is wired at the root (`vite-plus`, `vp check`, `vp run` tasks, Oxlint/Oxfmt config in `vite.config.ts`, `@typescript/native-preview`, and CI via `voidzero-dev/setup-vp`).
- [x] Workspace packages exist for `core`, `compiler`, `runtime`, `server`, `drizzle`, `cli`, `test`, and `create-jiso`.
- [x] P0 wire fixtures exist for enhanced mutation, no-JS PRG, 422 fragment, typed read, and `<fw-defer>` stream.
- [x] Core diagnostics registry exists and is consumed by compiler/drizzle/cli/test surfaces.
- [x] P1 compiler has component lowering, handler export facts, registry emit, typed routes/link validation, IDREF/id diagnostics, render-equivalence facts, update coverage, derived query stamps, and a TS parser-backed intermediate model feeding validators. Round-2 audit caveat 2026-06-11: lowering still chains source-string transforms and the render-equivalence proof is structural, not an executed authored-render-vs-emitted-render comparison.
- [ ] P1 compiler module split and parser migration/dead scanner cleanup are partial; `plans/archive.md` carries the archived `plans/improve-compiler.md` summary for completed slices, while `plans/codebase-quality-round2.md` Phase 2 tracks the remaining architecture work.
      Evidence 2026-06-11: FW201's conservative free-identifier denylist and the static
      FW201/FW230 detail labels now live in shared `diagnosticDefinitions`; remaining
      compiler-local help is dynamic lowering evidence required by SPEC §4.3 and §4.5.
      Additional evidence 2026-06-11: SPEC §6.4 literal navigation validation for
      FW220 (`href`/`action` route-table checks) now lives in
      `packages/compiler/src/validate/navigation.ts`, further shrinking
      `packages/compiler/src/index.ts` without changing emitted IR or diagnostics.
      Additional evidence 2026-06-11: SPEC §6.4 static navigation sugar lowering
      (`<Link>`, `href()`, and literal `href={...}` normalization) now lives in
      `packages/compiler/src/lower/navigation.ts`, continuing the Phase 2 module split
      without changing emitted IR.
      Additional evidence 2026-06-11: handler lowering/FW201-FW210 event attribute analysis
      now lives in `packages/compiler/src/lower/handlers.ts`, server IR emission and
      render-equivalence stamping now live in `packages/compiler/src/emit/server.ts`, and
      duplicate top-level object scanner helpers were consolidated into
      `packages/compiler/src/scan/object.ts`.
- [ ] P1 final compiler cleanup evidence is partial: component graph facts live in the parser
      model and the dead `findMatchingClosingTag` path is absent, but `packages/compiler/src/index.ts`
      still owns core fact types, the compile pipeline, and helpers. Round-2 Phase 2 tracks the
      remaining compiler IR split.
      Additional evidence 2026-06-12: list-stamp query-shape traversal now lives in
      `packages/compiler/src/analyze/query-shapes.ts`; `validate/bindings.ts` consumes shared
      analyzer helpers instead of carrying duplicate path-validation types and array item lookup.
      Additional evidence 2026-06-12: parse-requiring view/platform/navigation lowering now runs
      through `packages/compiler/src/model-pipeline.ts` `lowerComponentPipelineSequence`, so
      `compile.ts` no longer hand-chains each source patch/reparse step and the pipeline tests pin
      latest-model handoff between ordered passes.
- [x] P2 runtime has delegated event loading, execution triggers, `ctx.signal`, query hydration/update plans, visible-return typed-read refetch, BroadcastChannel plumbing, bfcache-safe pagehide handling, immutable no-`customElements` loader constraints, and a 4KB inline loader budget.
      Additional evidence 2026-06-12: delegated loader event lifecycle now lives in
      `packages/runtime/src/loader-lifecycle.ts`, covering capture listener setup,
      enhanced-submit interception, delegated fallback dispatch, event-phase diagnostics,
      and listener teardown while `loader.ts` stays composition-only for that path
      (SPEC §4.4/§9.1). Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and
      `pnpm exec vp check packages/runtime/src/loader.ts
packages/runtime/src/loader-lifecycle.ts
packages/runtime/src/loader-lifecycle.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: inline `jiso:query` events now hydrate through
      `packages/runtime/src/query-events.ts`, which delegates to the shared
      `packages/runtime/src/query-apply.ts` runtime apply helper used by mutation
      responses for store writes and compiled query update plans (SPEC §9.1/§9.4).
      Same-session evidence: `pnpm exec vitest --run packages/runtime/src` and
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`.
      Additional evidence 2026-06-13: visible-return hydration and typed-read refetch now use
      `packages/runtime/src/query-apply.ts` `applyQueryChunksToRuntime`, so loader
      `queryPlans` update DOM bindings for initial `script[fw-query]`, later discovered query
      scripts, and `/_q/` responses instead of drifting from store-only writes (SPEC §4.4/§9.4).
      Same-session evidence: `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and
      `pnpm --filter @jiso/runtime run check:inline-loader`.
      Additional evidence 2026-06-13: the public runtime barrel now omits the
      compatibility `applyDeferredStreamResponseToDom` and
      `applyEnhancedMutationResponseBodyToDom` wrappers; enhanced mutation apply
      routes directly through `applyMutationResponseToDom`, and deferred streams
      use `applyDeferredStreamResponseToRuntime` for both rootless and DOM apply
      overloads while dropping store-only compatibility type aliases. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/runtime/src/apply-deferred-stream.ts
packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/mutation-apply.ts
packages/runtime/src/index.ts packages/runtime/src/index-exports.test.ts
packages/runtime/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: `packages/runtime/src/apply-mutation-response.ts` now
      applies decoded mutation response bodies directly in the canonical runtime apply function
      after deleting the internal `applyFragmentQueryBody` wrapper, and
      `packages/runtime/src/inline-loader-build.ts` checks readable plus minified inline
      wire-parser embeds against the canonical `packages/runtime/src/wire-parser.ts` helper
      closure during `build:inline-loader`/`check:inline-loader` (SPEC §4.4/§9.1). Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts
packages/runtime/src/mutation-response.test.ts packages/runtime/src/index-exports.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm exec tsc --noEmit --pretty
      false`, `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts
IMPLEMENT_v1.md plans/codebase-quality-round2.md`, and `git diff --check`.
      Additional evidence 2026-06-13: `packages/runtime/src/apply-mutation-response.ts` deleted
      the store-first `applyMutationResponse` compatibility wrapper, `packages/runtime/src/index.ts`
      no longer exports `applyMutationResponse`/`applyMutationResponseToRuntime` values or their
      compatibility option/result types, and `packages/runtime/src/inline-js-minifier.ts` now
      checks readable-to-printed parse parity before compaction (SPEC §4.4/§9.1). Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/inline-js-minifier.test.ts
packages/runtime/src/inline-loader.test.ts packages/runtime/src/mutation-response.test.ts
packages/runtime/src/index-exports.test.ts`, `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run
check:inline-loader`, `pnpm exec tsc --noEmit --pretty false`, `pnpm exec vp check
packages/runtime/src/apply-mutation-response.ts packages/runtime/src/index.ts
packages/runtime/src/index-exports.test.ts packages/runtime/src/index.test.ts
packages/runtime/src/inline-js-minifier.ts packages/runtime/src/inline-js-minifier.test.ts
packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`, and `git diff --check`.
      Additional evidence 2026-06-13: `packages/runtime/src/wire-parser.ts` now parses hydrated
      query scripts and wire `<fw-query>` chunks through one query payload helper, while
      `packages/runtime/src/query-apply.test.ts` owns the focused hydration/apply coverage split
      from `packages/runtime/src/query-store.test.ts` (SPEC §9.1/§9.4). Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-apply.test.ts
packages/runtime/src/query-store.test.ts packages/runtime/src/wire-parser.test.ts
packages/runtime/src/query-events.test.ts`, `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run
check:inline-loader`, `pnpm exec tsc --noEmit --pretty false`, `pnpm exec vp check
packages/runtime/src/wire-parser.ts packages/runtime/src/wire-parser.test.ts
packages/runtime/src/query-apply.test.ts packages/runtime/src/query-store.test.ts
IMPLEMENT_v1.md plans/codebase-quality-round2.md`, and `git diff --check`.
      Additional evidence 2026-06-13: `packages/runtime/src/apply-mutation-response.ts` now owns
      decoded chunk application through `applyMutationResponseChunksToRuntime`; mutation bodies,
      deferred stream parts, and typed-read responses parse through their transport-specific wire
      readers before converging on that apply primitive, with typed reads limited to `<fw-query>`
      chunks per SPEC §9.4. Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/mutation-response.test.ts packages/runtime/src/apply-deferred-stream.test.ts
packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-apply.test.ts
packages/runtime/src/index-exports.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm exec tsc --noEmit --pretty
      false`, `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/query-refetch.ts
packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-refetch.test.ts
packages/runtime/src/index-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Additional evidence 2026-06-13: the internal body-based
      `applyMutationResponseToRuntime` wrapper and its compatibility result/options types were
      deleted; public DOM apply, enhanced mutation submit, same-user broadcast, deferred streams,
      and typed-read refetch now parse transport bodies first and converge on
      `applyMutationResponseChunksToRuntime` as the single mutation apply primitive (SPEC §9.1/§9.2).
      Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/mutation-response.test.ts packages/runtime/src/mutation-apply.test.ts
packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: inline wire-parser extraction now rejects helper closures
      that reference imported or top-level runtime bindings outside self-contained function
      declarations, so SPEC §4.4 readable/minified inline-loader parity cannot ship an unresolved
      parser dependency; build-only loader checks were split into
      `packages/runtime/src/inline-loader-build.test.ts`, leaving
      `packages/runtime/src/inline-loader.test.ts` focused on inline execution behavior.
      Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`, and
      `pnpm exec tsc --noEmit --pretty false`.
- [x] P2 exit demo/smoke is proven by a standalone browser L0+L1 smoke covering tabs, dialog, filter island, declared visible trigger, and zero handler imports before interaction/trigger.
- [x] P3 server/core have `domain`, `query`, `mutation`, `route`, typed `href`/`Link`/`redirect`, typed sessions, CSRF issuance/validation, FormData coercion, guards/rate limits, mutation replay, query endpoints, rerun query fragments, and commerce app usage.
      Additional evidence 2026-06-13: SPEC §9.5 static replay request construction now lives in
      `packages/server/src/static-export-request.ts`, and `/c/` client-module replay plus
      same-output-path FW229 drift diagnostics now live in
      `packages/server/src/static-export-client-modules.ts`, leaving
      `packages/server/src/static-replay.ts` to orchestrate route document replay and L0/L1
      validation. Same-session evidence: `pnpm exec vitest --run packages/server/src
packages/create-jiso/src/index.test.ts` and `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: Vite static-export asset planning now lives in
      `packages/server/src/vite-build-assets.ts`, and Vite build export/inventory/manifest
      wrappers now live in `packages/server/src/vite-static-export.ts`, leaving
      `packages/server/src/vite-build.ts` focused on build construction and `/c/` module output
      while preserving the public app-shell Vite barrel. Same-session evidence:
      `pnpm exec vitest --run packages/server/src` and
      `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: Vite build output path resolution and compiled `/c/`
      module writes now live in `packages/server/src/vite-build-output.ts`, leaving
      `packages/server/src/vite-build.ts` focused on manifest-backed app-shell build
      construction while preserving the public Vite app-shell barrel. Same-session evidence:
      `pnpm exec vitest --run packages/server/src` and
      `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: `packages/server/src/vite-build-output.ts` now also owns
      plugin-time SPEC §9.5 static export execution/reporting for Vite app-shell builds, so
      `packages/server/src/vite.ts` only assembles the manifest-backed build and forwards the
      unified output object to `onBuild`. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: Vite static-export build/option normalization now lives in
      `packages/server/src/vite-static-export-options.ts`, including manifest-file projection,
      write-vs-dry-run output selection, and SPEC §9.5 manifest asset injection, leaving
      `packages/server/src/vite-static-export.ts` as the public export/inventory/manifest facade.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/vite-static-export.ts packages/server/src/vite-static-export-options.ts packages/server/src/vite-static-export-options.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: `packages/server/src/vite-build-output.ts` now preplans
      compiled `/c/` module output and runs optional SPEC §9.5 static export before writing those
      helper-owned Vite files, so FW229 plugin-time export rejection leaves no partial app-shell
      client module output. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: static export output writes now stage route documents,
      immutable `/c/` modules, and copied static assets before committing them into the
      configured output directory, with final target validation before staging so FW229 output
      target conflicts do not leave partial route/module files behind (SPEC §9.5).
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: Vite app-shell build output now stages helper-owned
      compiled `/c/` module writes under the Vite output root and validates duplicate/directory
      targets before committing, so rejected client-module output does not leave earlier module
      files behind (SPEC §9.5). Same-session evidence:
      `pnpm exec vitest --run packages/server/src` and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: app-configured 404/500 error shells now report through a
      distinct `error-shell` `onError` diagnostic context and fall back to the stable no-internals
      document when the shell renderer itself fails (SPEC §9.2/§9.5). Same-session evidence:
      `pnpm exec vitest --run packages/server/src/app.test.ts`,
      `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/static-replay.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: static export route-document and `/c/` client-module replay
      now read web-standard `Response`s through one policy-discriminated response boundary, and
      the public export artifact types share the same body/header/status snapshot used by replay
      validation (SPEC §9.5). Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/static-export-response.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-types.ts packages/server/src/static-replay.ts packages/server/src/static-export-client-modules.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: app route document assembly, configured error-shell
      rendering/fallback, and request URL snapshots now live in
      `packages/server/src/app-document.ts`, while app mutation request body/session preparation
      and mutation response option setup now live in `packages/server/src/app-mutation-request.ts`,
      leaving `packages/server/src/app-request.ts` focused on SPEC §9.5 dispatch order. Same-session
      evidence:
      `pnpm exec vitest --run packages/server/src/app-document.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/app.test.ts packages/server/src/static-export.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/app-request.ts packages/server/src/app-document.ts packages/server/src/app-document.test.ts packages/server/src/app-mutation-request.ts packages/server/src/app-mutation-request.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: SPEC §9.5 app static-export replay choreography now lives in
      `packages/server/src/static-export-replay.ts`, including route-plan diagnostics,
      replay-time skip/error policy, route document replay, `/c/` client-module replay, and HTML
      path style validation before output planning, leaving `packages/server/src/static-export.ts`
      focused on compile diagnostics, assets, and output writes. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-replay.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: SPEC §9.5 static-export document inspection now uses the
      server-owned `packages/server/src/static-export-document.ts` scanner for quoted, unquoted,
      uppercase, and entity-decoded attributes, and that boundary now owns route document artifact
      path selection; `packages/server/src/static-replay.ts` remains focused on synthetic replay
      and L0/L1 validation. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-replay.ts packages/server/src/static-replay.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: SPEC §9.5 route-document synthetic replay and L0/L1
      validation now also live in `packages/server/src/static-export-document.ts`, so the
      leftover `packages/server/src/static-replay.ts` compatibility module was deleted and
      `packages/server/src/static-export-replay.ts` calls the document owner directly. Same-session
      evidence:
      `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-replay.ts packages/server/src/static-replay.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: SPEC §9.5 discovered `/c/` client-module artifact replay,
      same-output-path dedupe, and FW229 query-version drift diagnostics now also live in
      `packages/server/src/static-export-document.ts`, so
      `packages/server/src/static-export-client-modules.ts` was deleted; the static export
      response seam now exposes only the unified policy-discriminated replay reader instead of
      route/client wrapper readers. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src`, and
      `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-replay.ts packages/server/src/static-export-response.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-response.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
      and `git diff --check`.
      Additional evidence 2026-06-13: app mutation dispatch now uses the shared
      `resolveLifecycleRequest` session boundary used by route/query request paths, preserving
      SPEC §9.5 same-request session resolution without mutating the original web `Request`, and
      the public `renderQueryScript` export now points directly at the canonical
      `packages/server/src/wire-html.ts` emitter while the internal static-export response alias
      was removed. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/app-mutation-request.test.ts packages/server/src/api/app.test.ts packages/server/src/wire-html.test.ts packages/server/src/mutation-response.test.ts packages/server/src/static-export-response.test.ts packages/server/src/guards.test.ts`,
      `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src`, `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check packages/server/src/app-mutation-request.ts packages/server/src/app-mutation-request.test.ts packages/server/src/guards.ts packages/server/src/mutation.ts packages/server/src/api/data.ts packages/server/src/api/app.test.ts packages/server/src/static-export-response.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: the Vite app-shell plugin now lives in
      `packages/server/src/vite-plugin.ts`, leaving `packages/server/src/vite.ts` as a public
      aggregate over Vite manifest/build/export/dev/plugin owners; the root `@jiso/server`
      barrel now exports the canonical app-shell split directly and the internal `api/app.ts`
      compatibility barrel was deleted. This keeps SPEC §9.5 R5/R6/R7 adoption on the public
      root and app-shell subpaths while making the server extraction subtractive. Same-session
      evidence: `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/static-export.test.ts packages/server/src/static-export-replay.test.ts`,
      `pnpm exec vitest --run packages/server/src`, `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check packages/server/src/vite-plugin.ts packages/server/src/vite.ts packages/server/src/index.ts packages/server/src/api/app.test.ts packages/server/src/vite.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: the unused internal `packages/server/src/vite.ts` and
      `packages/server/src/document.ts` aggregates were deleted; tests and public barrels now
      target `api/app-shell/vite.ts`, `document-core.ts`, and `document-diagnostics.ts` directly
      while preserving root and subpath exports for SPEC §9.5 consumers. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts packages/server/src/vite-diagnostics.test.ts`.
      Additional evidence 2026-06-13: the root server barrel now delegates app-shell exports
      through `packages/server/src/api/app-shell/index.ts`, and the create-jiso starter consumes
      SPEC §9.5 R5/R6/R7 dev/export/static-export helpers through
      `@jiso/server/app-shell/*` subpaths instead of the root aggregate while keeping JSX/routing
      on the root package. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts -t "server app-shell public API barrels|scaffolds real template files|typechecks the generated auth recipe|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through the vp dev task|runs .* with the built stylesheet href|formats generated export task diagnostics"`,
      `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`,
      `pnpm exec vitest --run packages/server/src`,
      `pnpm exec tsc --noEmit --pretty false`, `pnpm exec vp check packages/server/src/index.ts packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/src/app-shell.ts packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/templates/vite.config.ts packages/create-jiso/templates/scripts/export-static.mjs IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: static export compile-diagnostic blocking now lives in
      `packages/server/src/static-export-diagnostics.ts`, leaving `static-export.ts` to
      orchestrate SPEC §9.5 replay/output while the boundary rejects error diagnostics before
      route replay or output writes and lets non-blocking diagnostics continue. Same-session
      evidence:
      `pnpm exec vitest --run packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-static-export-options.test.ts`,
      `pnpm exec vitest --run packages/server/src`, `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export-diagnostics.ts packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: static export document replay was split again so
      `packages/server/src/static-export-document.ts` owns only SPEC §9.5 route-document replay,
      output path selection, and L0/L1 endpoint rejection; `static-export-document-refs.ts` owns
      HTML/Link reference discovery, and `static-export-client-module-artifacts.ts` owns `/c/`
      artifact replay plus same-output-path drift diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-static-export-options.test.ts`,
      `pnpm exec vitest --run packages/server/src`, `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check packages/server/src/static-export-document.ts packages/server/src/static-export-document-refs.ts packages/server/src/static-export-client-module-artifacts.ts packages/server/src/static-export-replay.ts packages/server/src/static-replay.test.ts packages/server/src/static-export-client-modules.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: Vite compiled `/c/` output writes now live in
      `packages/server/src/vite-client-module-output.ts`, leaving
      `packages/server/src/vite-build-output.ts` to orchestrate static export plus output
      reporting; the root package barrel now exports app-shell owner subpaths directly instead
      of routing through the app-shell aggregate. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src`, `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check packages/server/src/vite-client-module-output.ts packages/server/src/vite-build-output.ts packages/server/src/vite-build.test.ts packages/server/src/index.ts packages/server/src/api/app.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [x] P3 planned audits and static route/query guard guarantees are represented at v1 scale.
      Evidence 2026-06-11: `tests/fw-check.node.mjs` now executes `fwCheck()`
      against a graph with removed mutation, route, and query guards and pins the
      stable `fw-check/v1` unguarded warnings required by SPEC §6.4 and the P3 exit.
- [x] P4 Drizzle extraction has ts-morph-backed project/table/write coverage, arrow-handler coverage, FW406/FW409 diagnostics, query shape derivation with nullable wrappers, projection-less select diagnostics, and conformance coverage. Round-2 audit caveat 2026-06-11: source-mode/query extraction still includes string/regex parsing and AST discoveries are rewritten back into source text, so end-to-end ts-morph extraction remains open in `plans/codebase-quality-round2.md` Phase 3.
      Additional evidence 2026-06-12: project-mode typed destructured Drizzle receiver
      bindings now resolve through ts-morph binding symbols for write and query facts while
      explicitly typed fake contexts remain invisible; package and real `drizzle-orm`
      conformance tests pin the behavior. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: project query-loader receiver extraction no longer falls
      back to untyped source-mode `db`/`tx` compatibility names; positive project query fixtures
      now use explicit `PgDatabase` receiver annotations, and untyped lookalike loaders stay
      invisible instead of fabricating facts. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: executable body-local receiver aliases in project-mode
      function and query-loader extraction are accepted only from ts-morph Drizzle binding types,
      and the source-mode body-local destructuring compatibility path was deleted so local
      `{ db }`/`{ tx }` lookalikes no longer fabricate receiver aliases. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: closure-local helper summaries now require proven
      Drizzle receiver arguments before folding receiver-parameter helper facts into callers, so
      fake/lookalike helper calls no longer fabricate parent touch facts while isolated helper
      summaries remain visible. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: opaque member helper handoffs that receive proven
      Drizzle receivers now degrade to FW406 instead of disappearing from touch/query extraction,
      while fake/lookalike receiver arguments remain invisible; package and real `drizzle-orm`
      conformance tests pin the behavior. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: helper calls that receive proven Drizzle receivers through
      container arguments such as `{ db }` now degrade to FW406 in source/project touch extraction
      and project query-loader extraction, while fake/lookalike container arguments remain
      invisible; package and real `drizzle-orm` conformance tests pin the behavior. Same-session
      evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: opaque local helper calls that receive proven Drizzle
      receivers directly or through body-local carrier aliases now degrade to FW406 when their
      helper receiver parameters cannot be folded under the typed receiver proof rules; fake
      project-mode carrier aliases stay invisible. Package and real `drizzle-orm` conformance
      tests pin source touch extraction, project touch extraction, and project query-loader
      diagnostics. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: `insert(...).select(...)` and `update(...).from(...)`
      read sources are summarized independently from the write target, so an opaque write target
      still degrades to FW406 without hiding resolved read domains. Package and real `drizzle-orm`
      conformance tests pin source/project touch extraction. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: detached Drizzle receiver method aliases such as
      destructured `execute`/`update` and `db["$count"]` assignments now degrade to FW406 in
      source/project touch extraction and project query-loader diagnostics, while fake/lookalike
      method aliases stay invisible. Package and real `drizzle-orm` conformance tests pin the
      behavior. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: unbound ambient source-mode `db`/`tx` receivers no longer
      fabricate table reads/writes from compatibility names; visible direct calls, relational/select
      reads, detached aliases, and helper handoffs degrade to FW406 instead. Computed receiver
      methods such as `db[method]()` also degrade to FW406 for proven Drizzle receivers while
      fake/lookalike receivers remain invisible. Package and real `drizzle-orm` conformance tests
      pin the behavior. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: source query-loader destructured receiver compatibility no
      longer treats arbitrary object binding names as Drizzle receivers; only explicit `{ db }`/`{ tx }`
      slots keep source-mode compatibility, so destructured fake loaders stay invisible instead of
      fabricating query facts. Package and conformance tests pin the behavior. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: detached receiver method aliases now remain symbol-bound
      when ts-morph can resolve the call identifier, so same-name shadow bindings no longer fall
      back to source-name compatibility and fabricate FW406 diagnostics. Package source-mode tests
      and real `drizzle-orm` query-loader conformance pin the behavior. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: source-mode destructured `db`/`tx` receiver slots no longer
      fabricate exact touch/query facts; visible destructured source write and query-loader
      surfaces degrade to FW406, fake destructuring stays invisible, and same-name local shadows
      are filtered through ts-morph symbol identity. Package and real `drizzle-orm` conformance
      tests pin the behavior. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: project-mode body-local assignment aliases such as
      `let writer; writer = db` now carry typed Drizzle receiver proof by ts-morph symbol identity
      into touch and query extraction, while assignments from fake/lookalike receivers stay
      invisible. Package and real `drizzle-orm` conformance tests pin write and query-loader
      behavior. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: bound detached receiver methods such as
      `db.execute.bind(db)` and `db[method].bind(db)` now form FW406 receiver-method aliases
      instead of being misclassified as helper handoffs, while fake/lookalike bound methods stay
      invisible. Package and real `drizzle-orm` conformance tests pin source/project touch
      extraction and project query-loader diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: helper handoffs through assigned receiver carrier variables
      such as `let context; context = { db }` now degrade to FW406 in source/project touch
      extraction and query-loader diagnostics, while assigned fake/lookalike carriers remain
      invisible. Package and real `drizzle-orm` conformance tests pin the behavior. Same-session
      evidence: `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: source-mode body-local receiver aliases such as
      `const writer = db`, assignment aliases, and first-level carrier member aliases now degrade
      visible touch/query-loader surfaces to FW406 instead of fabricating reads/writes, while fake
      carrier members stay invisible. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: source-mode destructuring from receiver carrier objects such
      as `const { writer } = context` now degrades visible touch/query-loader surfaces to FW406
      instead of disappearing or producing exact facts, while fake carrier destructuring remains
      invisible. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: detached receiver methods assigned after declaration, such
      as `execute = db.execute`, `computed = db[method]`, and `({ execute } = db)`, now degrade
      to FW406 by ts-morph symbol identity instead of disappearing, while fake/lookalike assigned
      methods stay invisible. Package and real `drizzle-orm` conformance tests pin source/project
      touch extraction and project query-loader diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: project-mode detached receiver method aliases reached
      through property-specific carrier members such as `carrier.db.execute` now degrade to FW406
      in touch extraction and query-loader diagnostics, while sibling fake carrier members stay
      invisible. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: project-mode direct receiver carrier-member calls such as
      `carrier.db.execute()`, `carrier.db.update(...)`, and `carrier.db.query.users.findMany()`
      now degrade to FW406 instead of producing exact touch/query facts through the carrier
      boundary, while sibling fake carrier members remain invisible. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: v1 Drizzle receiver/table proof is now Postgres-focused:
      `packages/drizzle/src/drizzle-surface.ts` blesses `pgTable` plus Postgres database type
      names only, `packages/drizzle/src/static.ts` deleted the broad `drizzle-orm`
      package-declaration receiver fallback, deferred SQLite/MySQL project receivers stay
      invisible, and deferred SQLite source table factories degrade to FW406 instead of exact
      touch facts. Package and real `drizzle-orm` conformance tests pin the behavior.
      Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: source/project object-spread copies of proven Drizzle
      receiver carriers now preserve only non-overridden receiver properties, so spread-copied
      carrier member calls and helper handoffs degrade to FW406 while later `db: fake` overrides
      remain invisible. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: nested source/project Drizzle receiver carriers such as
      `const nested = { inner: carrier }` now preserve property-specific receiver paths, so
      `nested.inner.db.execute()`, `nested.inner.db.update(...)`, relational query calls,
      detached methods, and helper handoffs degrade to FW406 while nested fake overrides remain
      invisible. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`, `pnpm exec vp check
packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: helper handoffs that pass a property-specific carrier
      member such as `nested.inner.db` now degrade to FW406 in source/project touch extraction
      and query-loader diagnostics, while nested fake overrides remain invisible. Same-session
      evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: source/project array-destructured detached receiver
      methods such as `const [execute] = [db.execute]` and `[execute] = [db.execute]` now
      degrade touch and query-loader surfaces to FW406 by ts-morph symbol identity, while fake
      tuple elements remain invisible. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts
conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: project destructuring assignment receiver aliases such as
      `({ db: writer } = context)` now use ts-morph object-property type facts for exact
      Postgres Drizzle receiver proof in touch and query extraction, while source-mode
      destructuring assignment from receiver carriers degrades later writes and query-loader
      surfaces to FW406 instead of disappearing; fake assigned properties remain invisible.
      Same-session evidence: `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-13: project nested destructuring assignment receiver aliases
      such as `({ nested: { db: writer } } = context)` now use recursive ts-morph object-property
      type facts for exact Postgres Drizzle receiver proof in touch and query extraction, while
      source-mode nested carrier destructuring declarations and assignments degrade later writes
      and query-loader surfaces to FW406 instead of disappearing; fake nested properties remain
      invisible. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`, `pnpm exec vp check
packages/drizzle/src/drizzle-surface.ts packages/drizzle/src/static.ts
packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`, and `git diff --check`.
- [x] P4 generated touch-graph workflow is frozen: `@jiso/drizzle` derives/serializes v1 invalidation registries, the commerce generator emits `commerceInvalidationSets` plus `@jiso/core` registry augmentation, and `fw-check` pins the generated artifact byte-for-byte.
- [x] P5 has enhanced mutation/deferred fragments, DOM morphing, query patch application, typed read refetch, template stamps, isomorphic/update-coverage statuses, Tailwind stylesheet hints, and runtime/browser tests for morph survival and fragment parsing.
      Evidence 2026-06-12: `packages/runtime/src/query-store.ts` was narrowed to query
      value identity/snapshot/subscription storage, while `packages/runtime/src/query-apply.ts`
      owns shared query chunk application, hydrated script discovery, and hydration replay
      ledgers for mutation responses, typed-read refetch, and browser hydration (SPEC §9.1/§9.4).
      Same-session evidence: `pnpm exec vitest --run packages/runtime/src/query-store.test.ts
packages/runtime/src/query-refetch.test.ts packages/runtime/src/mutation-response.test.ts
packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/query-apply.ts packages/runtime/src/query-store.ts
packages/runtime/src/query.ts packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/loader-lifecycle.ts packages/runtime/src/loader.ts
packages/runtime/src/query-refetch.ts packages/runtime/src/mutation-submit.ts
packages/runtime/src/broadcast.ts packages/runtime/src/query-store.test.ts`.
      Evidence 2026-06-12: `packages/runtime/src/fragment-targets.ts` now makes the
      browser `DomMorphRoot` resolve mutation fragment targets through the same
      `fw-c`, `id`, and `fw-fragment-target` live-DOM vocabulary used by `FW-Targets`
      and inline response application (SPEC §9.1), with selector-special query
      instance ids covered in `packages/runtime/src/index.browser.test.ts`.
      Evidence 2026-06-12: inline enhanced-form response parsing now embeds helper declarations
      extracted from `packages/runtime/src/wire-parser.ts` during `build:inline-loader` and
      `check:inline-loader`, so the checked-in bootstrap uses the canonical `readElementChunks`
      scanner instead of a separate `readChunks` parser while keeping the SPEC §4.4 gzip budget.
      Same-session evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm --filter @jiso/runtime run
check:inline-loader`.
      Evidence 2026-06-12: typed `ctx.submit` implementation now lives in
      `packages/runtime/src/submit-context.ts`, leaving
      `packages/runtime/src/mutation-submit.ts` focused on enhanced form dispatch,
      fetch/apply, optimistic reconciliation, broadcast, and pending state while keeping
      public `@jiso/runtime` exports stable (SPEC §9.1/§9.2). Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/submit-context.test.ts
packages/runtime/src/index.test.ts` and `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`.
      Evidence 2026-06-12: enhanced mutation request fetching now lives in
      `packages/runtime/src/mutation-fetch.ts`, leaving
      `packages/runtime/src/mutation-submit.ts` focused on submit/optimism/apply
      orchestration while the fetch module owns `FW-Idem`/`FW-Targets`, keepalive
      method/progress options, sanitized `FW-Changes` parsing, and HTTP failure
      classification (SPEC §9.1/§10.4). Same-session evidence: `pnpm exec vitest
      --run packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/index.test.ts
packages/runtime/src/mutation-response.test.ts`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp
check packages/runtime/src/mutation-fetch.ts packages/runtime/src/mutation-fetch.test.ts
packages/runtime/src/mutation-submit.ts`.
      Evidence 2026-06-13: mutation response body parsing now has a canonical
      decoded wire seam in `packages/runtime/src/wire-parser.ts` via
      `readMutationResponseBodyChunks`, leaving `packages/runtime/src/apply-mutation-response.ts`
      to apply already-decoded `fw-query` and `fw-fragment` chunks for store-only,
      DOM, and deferred-stream runtime paths (SPEC §9.1). Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts
packages/runtime/src/mutation-response.test.ts`, `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/wire-parser.ts packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/wire-parser.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: fetched enhanced mutation response application now lives in
      `packages/runtime/src/mutation-apply.ts`, so `packages/runtime/src/mutation-submit.ts`
      no longer owns the decoded-body apply plus successful-broadcast publication seam while
      optimistic reconciliation still interposes query truth before morphing (SPEC §9.1/§9.2).
      Same-session evidence: `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/mutation-apply.ts packages/runtime/src/mutation-apply.test.ts
packages/runtime/src/mutation-submit.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: `packages/runtime/src/apply-path.ts` was deleted as a
      compatibility facade; `packages/runtime/src/index.ts` now exports
      `apply-mutation-response.ts` and `apply-deferred-stream.ts` directly while
      `packages/runtime/src/mutation-response.test.ts` pins the public barrel to the
      canonical split-module apply functions (SPEC §9.1). `packages/runtime/src/mutation-form.ts`
      now owns enhanced-form selector resolution, fallback/error stamping, and upload-progress
      element updates, leaving `packages/runtime/src/mutation-submit.ts` focused on submit/form
      orchestration while preserving public form types (SPEC §9.1/§9.2). Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
      vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and `pnpm exec
      vp check packages/runtime/src/mutation-form.ts packages/runtime/src/mutation-form.test.ts
      packages/runtime/src/mutation-submit.ts packages/runtime/src/index.ts
      packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md
      plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: optimistic enhanced mutation submission now lives in
      `packages/runtime/src/mutation-optimistic.ts`, so queueing, prediction, failed-response
      discard, server-truth rebase, uncovered-query diagnostics, and pending cleanup are no longer
      embedded in the basic submitter; `packages/runtime/src/mutation-optimistic.test.ts` carries
      the focused SPEC §8/§10.4 coverage formerly in `packages/runtime/src/index.test.ts` while
      `packages/runtime/src/index-exports.test.ts` pins the public barrel to the split module.
      Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/mutation-optimistic.test.ts packages/runtime/src/index-exports.test.ts`
      and `pnpm exec vp check packages/runtime/src/mutation-optimistic.ts
packages/runtime/src/mutation-optimistic.test.ts packages/runtime/src/mutation-submit.ts
packages/runtime/src/index.ts packages/runtime/src/index-exports.test.ts
packages/runtime/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: visible-return query hydration/refetch lifecycle now lives in
      `packages/runtime/src/query-visible-return.ts`, leaving
      `packages/runtime/src/query-refetch.ts` focused on typed-read HTTP response application
      while loader install still hydrates query scripts without requiring visible-return refetch
      configuration (SPEC §4.4/§9.4). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/query-visible-return.ts packages/runtime/src/query-refetch.ts
packages/runtime/src/loader.ts packages/runtime/src/query-refetch.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
      Evidence 2026-06-13: inline `jiso:query` hydration no longer accepts the legacy
      `{ name, key, body }` compatibility payload; `packages/runtime/src/query-events.ts` now
      accepts only the `{ attrs, content }` fw-query wire chunk emitted by
      `packages/runtime/src/inline-loader-build.ts`, and the focused coverage moved from the
      query-store monolith into `packages/runtime/src/query-events.test.ts` (SPEC §9.1/§9.4).
      Same-session evidence: `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm --filter @jiso/runtime run
check:inline-loader`.
      Evidence 2026-06-13: inline enhanced mutation response handling no longer
      pre-validates `<fw-query>` names in the inline bootstrap; generated
      `packages/runtime/src/inline-loader.ts` dispatches every scanned `{ attrs, content }`
      chunk and leaves missing-name/malformed-JSON handling to `query-events.ts` and the
      shared `wire-parser.ts` decoder (SPEC §4.4/§9.1/§9.4). Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and
      `pnpm --filter @jiso/runtime run check:inline-loader`.
- [x] P5 byte-for-byte live-server fixture exit is covered; runtime acceptance now proves form field and navigation route renames fail under `vp check` (`packages/runtime/src/index.test.ts`, SPEC §6.2/§6.3/§6.4/§16.6).
- [x] FW227 nullable binding paths (SPEC §4.8, §6.2): optional-segment (`?.`) path grammar lowered by the compiler (P1), shared empty-rendering semantics in server renderer and loader/stamps (P2/P5), null-aware path typing against inferred query shapes with the leftJoin-nullability proof under `vp check` (P5), and a golden teaching error.
      Evidence 2026-06-11: `packages/compiler/src/query-bindings.test.ts` covers optional
      `?.` data-bind lowering, query-shape FW227 diagnostics for nullable traversal
      without `?.`, and FW302 precedence for missing fields under nullable wrappers.
      `packages/runtime/src/index.test.ts` covers loader empty semantics for optional
      paths: text bindings render `""`, direct `data-bind:*` attributes are removed,
      and compiled attribute stamps remove attributes on nullish derive output.
      `tests/fw-check.node.mjs` now pins the cross-package proof: the Drizzle pinned
      conformance suite emits nullable query-shape wrappers for a real `leftJoin`, and
      the compiler consumes nullable query-shape facts to accept `?.` paths while
      reporting FW227 for the same traversal without `?.`.
- [x] P6 optimism has typed `OptimisticFor`, generated `InvalidationSets`, `await-fragment` statuses, pending stamps, named queues, rebase/restore behavior, unified change-record consumption, and property/runtime tests.
- [x] P6 final acceptance has full commerce-level coverage for every mutation/query pair. Evidence added: `examples/commerce/src/app.test.ts` now derives the complete `cart/add` and `order/receipt` x `cart`/`productGrid`/`orderHistory` matrix from `fw explain`, requires explicit optimistic statuses for every invalidated query, proves `order/receipt` has no invalidation for every commerce query, and checks the enhanced `cart/add` response carries every authoritative `<fw-query>`/fragment chunk (SPEC §10.4, §16.5). Navigation/bfcache edge evidence proves a mid-flight optimistic mutation is submitted with `keepalive`, `pagehide` discards the pending log and clears `fw-pending` back to server truth, and the later keepalive response reconciles authoritative query truth without stale optimism (`packages/runtime/src/index.test.ts`, SPEC §8/§10.4).
- [x] P7 stateless liveness has BroadcastChannel mutation sync and visible-return/refetch behavior.
- [x] P7 deployment/starter docs state the stateless-server guarantee; starter tests pin BroadcastChannel/refetch liveness and no SSE/live-bus in the generated deployment doc. Redis is mentioned only in generated framework rules and is not currently pinned by starter tests.
- [x] P8 CLI has stable `fw check`, `fw explain`, optimistic/update coverage, unguarded/unscoped audits, and diffable output tests.
- [x] P8 output format/versioning and agent-answerability acceptance are represented by `fw-explain/v1`/`fw-check/v1` snapshots and commerce graph-answerability tests.
      Additional evidence 2026-06-13: `@jiso/test/fw-explain-fixtures`
      now owns structured `fw-explain/v1` field, record, summary, and update-target parsing
      for SPEC §5.3 output assertions, and `tests/fw-check.node.mjs` consumes that seam for
      commerce/starter graph-answerability gates instead of local prefix slicing. Same-session
      evidence: `pnpm exec vitest --run packages/test/src`, `pnpm exec vp run build`, and
      `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact|P1 fragment targets emit typed registry facts|S1 production build proves the compiler 1:1 emit contract" tests/fw-check.node.mjs`.
      Additional evidence 2026-06-13: `@jiso/test/fw-explain-fixtures`
      now owns list fields, optimistic status maps, update-consumer facts, endpoint facts, and
      unscoped/unguarded audit facts for SPEC §5.3 output assertions. Commerce source-truth and
      `fw-check` gates consume those facts instead of raw sentinels, local `fw-explain` parsers,
      and generated-output string snapshots. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts`,
      `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`, `pnpm run check:build`,
      and `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`.
      Additional evidence 2026-06-13: `@jiso/test/graph-fixtures`
      now owns page lookup, query fragment-target lookup, graph-derived invalidations,
      update-consumer facts, and optimistic status matrices. Commerce source-truth and
      `fw-check` compare SPEC §10.4/§16.5 CLI output against those structured graph facts
      instead of local graph parsers or handpicked update strings. Same-session evidence:
      `pnpm exec vitest --run packages/test/src`, `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`,
      `pnpm run check:build`, and
      `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`.
- [x] P9 `@jiso/test` has pglite-backed harnessing, static-vs-observed write/read verification, FW402/FW403/FW404/FW405/FW407/FW408/FW410 diagnostics, raw pglite interception, and structural optimistic property checks.
      Additional evidence 2026-06-13: `@jiso/test/typescript-fixtures`
      now owns reusable virtual TypeScript program diagnostics and interface-member type facts
      used by `fw-check` registry/type assertions for SPEC §5.2 emitted artifacts, pinned by
      `packages/test/src/typescript-fixtures.test.ts` and `packages/test/src/package-exports.test.ts`.
      Same-session evidence: `pnpm exec vitest --run packages/test/src` and
      `pnpm exec vp check packages/test/package.json packages/test/src/fw-explain-fixtures.ts packages/test/src/fw-explain-fixtures.test.ts packages/test/src/typescript-fixtures.ts packages/test/src/typescript-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs`.
      Additional evidence 2026-06-13: `@jiso/test/command-fixtures`
      now owns reusable Vite+ config loading, workflow `vp run` task extraction, and ordered-task
      assertions used by the SPEC §16 acceptance gates in `fw-check`; package tests and package
      export tests pin the seam before targeted `fw-check` node coverage.
      Additional evidence 2026-06-13: `@jiso/test/starter-template-fixtures`
      now owns reusable create-jiso starter package/CI/Vite task, Tailwind `@source`, index HTML,
      graph, and browser client-template facts for the SPEC §13.1/§16 starter gate, replacing
      local `fw-check` starter parsing and fake DOM execution. Same-session evidence:
      `pnpm exec vitest --run packages/test/src`, `pnpm exec vp run build`, and
      `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/test/starter-template-fixtures`
      now also owns copied starter graph-task execution with compiler shims, fake `fw`
      output maps, and conformance fake-pnpm command verification for the SPEC §16
      starter/conformance gates, replacing local `fw-check` temp command runners. Same-session
      evidence: `pnpm exec vitest --run packages/test/src`, `pnpm exec vp run build`, and
      `node --test --test-name-pattern "P10 starter wires graph assertions into CI|Conformance suites are an explicit gate" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/test/source-fixtures`
      now owns reusable project file-tree, source, JSON manifest, and package-directory facts
      for the SPEC §2 browser-architecture and SPEC §16 conformance gates, replacing local
      `fw-check` directory recursion and manifest reads. Same-session evidence:
      `pnpm exec vitest --run packages/test/src`, `pnpm exec vp run build`, and
      `node --test --test-name-pattern "P10 constitution rejects forbidden browser architecture in framework code|Conformance suites are an explicit gate" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/test/touch-graph-fixtures`
      now owns reusable generated touch-graph source-provenance facts that resolve source
      sites and check the cited line names the `via` table/source. Commerce source-truth and
      `fw-check` P4/P10 graph gates consume the seam instead of local site parsing or
      generated-artifact projections, preserving the SPEC §11.1 static graph source-of-truth.
      Same-session evidence:
      `pnpm exec vitest --run packages/test/src/source-fixtures.test.ts packages/test/src/touch-graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`,
      `pnpm run check:build`, and
      `node --test --test-name-pattern "P4 commerce touch graph|P10 commerce graph assertions" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/test/fw-check-fixtures`
      now owns structured `fw-check/v1` OK, diagnostic, and coverage output facts, and
      `@jiso/test/touch-graph-fixtures` now returns provenance facts with source-site summaries,
      source-line mismatches, unresolved mutations, and domain-touch entries separated. Commerce
      source-truth and `fw-check` P4/P10/starter gates consume those seams instead of raw OK
      strings or inline generated-site projections, preserving SPEC §5.3 CLI output stability and
      SPEC §11.1 static graph source provenance. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/touch-graph-fixtures.test.ts packages/test/src/package-exports.test.ts`,
      `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`, `pnpm run check:build`,
      and
      `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/test/fw-check-fixtures`
      now exposes rawless diagnostic/coverage/result assertion facts and parses quoted
      `fw-check/v1` key/value fields, so update coverage, unguarded audit, verification
      diagnostics, FW235, and render-equivalence gates in `tests/fw-check.node.mjs` assert
      structured public facts instead of serialized output strings while keeping intentional raw
      wire pins separate (SPEC §5.3/§11.3). Same-session evidence:
      `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`,
      `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`, `pnpm run check:build`,
      and
      `node --test --test-name-pattern "P1 compiler emits FW311 update coverage facts|P3 route and query guard removal is mechanically audited by fw check|P9 verification layer evidence remains represented|D9 FW235 fails fw-check for app-authored lowered IR component modules|P1 render-equivalence gate remains represented" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/test/fw-check-fixtures`
      now exposes a rawless OK assertion fact for SPEC §5.3 `fw-check/v1` success, so commerce
      source-truth and `fw-check` P4/P10/starter graph gates consume parsed success facts instead
      of duplicating the empty diagnostics/coverage result object. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`,
      `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`, `pnpm run check:build`,
      and
      `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`,
      plus targeted `pnpm exec vp check ...` and `git diff --check`.
- [x] FW411 write-side-only exemption (SPEC §10.1, §11.2): static exempt-table read-set check in the extraction pass (P4) and the runtime observed-read check in the db verification wrapper (P9), with golden diagnostics. Evidence added: FW411 is in the shared core diagnostic registry/type; `@jiso/drizzle` recognizes `jiso({ exempt: true })`, omits exempt writes from the touch graph, and emits a query-fact FW411 diagnostic when a query reads an exempt table; `@jiso/test` accepts `verification.exemptTables`, allows writes to those tables, and fails observed direct/raw-SQL reads with FW411.
- [x] P9 v1.5 has full FW402/FW403/FW404/FW405/FW407/FW408/FW410 diagnostic table evidence plus commerce mutation-suite runtime/static verification-loop acceptance. Evidence added: the commerce matrix acceptance path runs `cart/add` through `@jiso/test` with `touchGraphKey: 'cart.addItem'`, runs `order/receipt` through a no-write verifier with `touchGraphKey: 'order/receipt'`, and asserts both verifier paths report no static/runtime drift before checking the enhanced wire output (SPEC §11.2).
- [x] D1 Tailwind-first path is implemented in commerce and starter scaffolds with stylesheet delivery tests.
- [x] D2 keyed append/reorder behavior has commerce/runtime tests.
- [x] D3 deferred streaming has fixtures, stylesheet hints, and priority/query ordering coverage.
- [x] D4 has initial adopted features: route meta, file uploads, i18n catalogs, rate-limit guard, and typed sessions.
- [x] D5 auth (agnostic core seams + blessed `@jiso/better-auth` adapter) is archived in `plans/archive.md` under deleted `plans/auth.md`; the A-track core seams, S6 spike, typed session mapper, guard bindings, credential mutations, browser-redirect `mount()` helper, B6 pinned Better Auth conformance, and B7 starter/reference adoption behind real Better Auth `authed`/`role()` flows with clean graph/audit evidence are implemented. B1's v1 contract is the blessed schema bridge rather than universal Better Auth plugin coverage: core tables plus the pinned organization/admin/two-factor/OIDC-provider/MCP/SIWE/JWT/device-authorization surface are mapped, explicit app-provided plugin-table bridge extensions flow through schema annotation, declared touch-graph generation, P9 verifier config, and Better Auth `modelName` physical aliases, and unsupported or unavailable plugin metadata degrades to FW406 until real metadata plus declared touches are supplied. Evidence includes collision validation for ambiguous physical aliases, duplicate app `schema.ts` table-declaration reporting, alias-aware unsupported-plugin FW406 diagnostics, built-in bridge collision hardening so extensions cannot downgrade blessed table mappings such as `user`, bounded annotation of recognized Drizzle table declarations with FW406-style facts for unrecognized/local schema factories, source-level FW406 facts for unsupported/future plugin table declarations, null table-metadata/schema-bridge fields for unavailable OAuth-provider successor metadata, and reusable FW406 unavailable-plugin metadata degradations pinned against absent SSO/passkey exports in `better-auth@1.6.17`.
- [x] D6 machine endpoints (`webhook()` primitive, route file/stream outcomes, storage capability, `--endpoints` audit) is archived in `plans/archive.md` under deleted `plans/machine-endpoints.md`; the SPEC PR, `endpoint()` floor, route file/stream outcomes, verifier kit, core storage capability/adapters, storage-backed `s.file()` uploads, bounded `webhook()` primitive, `fw explain --endpoints` audit, and commerce reference-app webhook/export/download adoption are implemented.
- [ ] D7 UI libraries (`@jiso/headless-ui` + vendored `@jiso/ui` + `examples/gallery`) is planned in `plans/ui.md`; design agreed 2026-06-11 (package prefix registration with FW234, `jiso-` prefix, behavior attributes on the package prefix, shadcn-style vendoring via `fw add`); F1 SPEC text, F2 explicit prefix enforcement plus `fw explain component <prefixed>` provenance, F3 package behavior-attribute IDREF validation, F4 primitive-author lint gate, F5 platform audit, H0 shared lib, H1 disclosure/collapsible/accordion/dialog/alert-dialog/popover/tooltip/hover-card/separator/progress/meter/avatar/toggle/checkbox/switch primitives, U2 `fw add` package-sourced TSX vendoring, U4 styled H2 wrappers for tabs/radio/toggle/checkbox groups, toolbar, number-field, otp-field, scroll-area, and field/fieldset, partial browser-backed G6 compiled interactive gallery coverage for toggle/checkbox/disclosure, switch/collapsible/popover, tabs/number-field/otp-field/toolbar, dialog/alert-dialog, tooltip/hover-card, select/combobox/autocomplete, progress/meter/scroll-area, and dropdown-menu/context-menu/menubar/navigation-menu/command/toast, partial G2 generated-client DOM contract coverage for radio/checkbox groups, menu/navigation, command, toolbar/toggle-group, scroll-area, and toast, plus full G5 exported attrs inventory/rendered merge goldens are landed; remaining `@jiso/ui` H1/H3 styling, docs deployment wiring, compiler/runtime merge diagnostic parity, and full gallery/conformance gates keep D7 open.
      Additional evidence 2026-06-13: `examples/gallery/src/fw-explain-contracts.test.ts`
      runs representative H1/H2/H3 primitive package-component graph facts through
      `fw explain component` and parses `fw-explain/v1` output, proving SPEC §6.1.1
      package-prefix provenance plus handler, substitution, and merge-diagnostic records for
      dialog, tabs, and dropdown-menu.
      Additional D7 evidence: `packages/ui/src/field.tsx`,
      `packages/ui/src/number-field.tsx`, `packages/ui/src/otp-field.tsx`, and
      `packages/ui/src/scroll-area.tsx` add vendorable H2 styled TSX wrappers over
      headless primitive attrs; `examples/gallery/src/demo-fixtures.tsx` renders those
      routes through `@jiso/ui`; `packages/cli/src/index.test.ts` syncs the `fw add`
      catalog. Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`,
      and `pnpm exec vp check packages/ui/src/field.tsx packages/ui/src/number-field.tsx packages/ui/src/otp-field.tsx packages/ui/src/scroll-area.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts`.
      Additional evidence 2026-06-13: H2 otp-field delete and paste handlers now restore the
      live slot input after canceled value changes per SPEC §4.6, and the aggregate named input
      exposes native `minLength`/`maxLength` constraints for SPEC §6.3 form-control semantics
      through the headless primitive, vendorable `@jiso/ui` wrapper, and gallery merge/behavior
      evidence. Same-session evidence: `pnpm exec vitest --run
packages/headless-ui/src/primitives/otp-field.test.ts`, `pnpm --filter @jiso/headless-ui
exec vitest --run`, `pnpm --filter @jiso/headless-ui run lint:primitives`, `pnpm --filter
@jiso/ui exec vitest --run`, `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts
examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/merge-fixtures.test.tsx`,
      and `pnpm exec vp check packages/headless-ui/src/primitives/otp-field.ts
packages/headless-ui/src/primitives/otp-field.test.ts packages/ui/src/otp-field.tsx
packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts
examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/merge-fixtures.test.tsx
IMPLEMENT_v1.md plans/ui.md`.
      Additional evidence 2026-06-13: H2 scroll-area now derives native viewport scroll edge and
      scrollbar/corner visibility facts from real viewport metrics, exposes `data-scroll-x`,
      `data-scroll-y`, and `data-scroll-position` through headless attrs plus vendorable
      `@jiso/ui` wrappers, and keeps the primitive scroll handler guarded per SPEC §4.6 without
      blocking native scrolling. Same-session evidence: `pnpm exec vitest --run
packages/headless-ui/src/primitives/scroll-area.test.ts`, `pnpm --filter @jiso/headless-ui exec
vitest --run`, `pnpm --filter @jiso/headless-ui run lint:primitives`, `pnpm --filter @jiso/ui
exec vitest --run`, `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts
examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/merge-fixtures.test.tsx`, and
      `pnpm exec vp check packages/headless-ui/src/primitives/scroll-area.ts
packages/headless-ui/src/primitives/scroll-area.test.ts packages/headless-ui/src/primitives/index.ts
packages/headless-ui/src/index.ts packages/ui/src/scroll-area.tsx packages/ui/src/index.test.tsx
examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts
examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/merge-fixtures.test.tsx
IMPLEMENT_v1.md plans/ui.md`.
      Evidence 2026-06-12: `examples/gallery/src/interactive/` adds app-authored
      switch, collapsible, and popover demos; `examples/gallery/scripts/emit-interactive-gallery.mjs`
      compiles all six interactive demos through `@jiso/compiler`; generated artifacts under
      `examples/gallery/src/generated/interactive/` include versioned `on:*` refs and client
      handlers; `examples/gallery/src/interactive-gallery.browser.test.ts` installs the real
      `@jiso/runtime` loader in Chromium and proves generated handlers mutate `fw-state` while
      native browser state moves for switch `checked`, `<details open>`, and `:popover-open`.
      Same-session evidence: `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      and `pnpm --filter @jiso/example-gallery run test:browser`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds
      app-authored tabs and number-field demos to the compiled interactive gallery;
      the emitter now keeps eight generated demo server/client artifact pairs in sync,
      static tests inspect versioned generated `on:*` refs and execute the tabs
      keyboard/click plus number-field stepper client handlers, and the Chromium
      browser test verifies the real runtime loader imports the generated modules and
      mutates stamped `fw-state` for tabs click and number-field stepper interactions
      while pinning initial tabs ARIA/hidden/roving-tabindex and native number input
      attributes. Same-session evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/tabs.test.ts src/primitives/number-field.test.ts src/tooling/lint-primitives.test.ts src/tooling/primitive-handler-lint.test.ts`,
      and `pnpm --filter @jiso/headless-ui run lint:primitives`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds an
      app-authored dialog demo to the compiled interactive gallery, bringing the checked-in
      generated server/client artifact set to nine demos. Static tests inspect the generated
      versioned dialog `on:*` refs and execute both generated open/close handlers; the Chromium
      browser test installs the real `@jiso/runtime` loader and proves generated `fw-state`
      movement alongside native `commandfor`/`command` dialog open, focus-inside, and close
      behavior. Same-session evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/dialog.test.ts src/tooling/lint-primitives.test.ts src/tooling/primitive-handler-lint.test.ts`,
      and `pnpm --filter @jiso/headless-ui run lint:primitives`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds an
      app-authored tooltip demo to the compiled interactive gallery, bringing the checked-in
      generated server/client artifact set to ten demos. Static tests inspect the generated
      versioned tooltip `on:focus`/`on:blur`/`on:keydown`/pointer refs and execute generated
      focus plus Escape handlers; the Chromium browser test installs the real `@jiso/runtime`
      loader for those delegated events and proves generated `fw-state` movement alongside
      browser-visible tooltip `aria-describedby`, `hidden`, `data-state`, output text, and
      native `:popover-open` show/hide behavior. Same-session evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      and `pnpm --filter @jiso/example-gallery run test:browser`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds an
      app-authored alert-dialog demo to the compiled interactive gallery, bringing the
      checked-in generated server/client artifact set to eleven demos. Static tests inspect
      the generated versioned trigger/cancel/action `on:click` refs and execute all three
      generated handlers; the Chromium browser test installs the real `@jiso/runtime` loader
      and proves generated `fw-state` movement alongside native `role="alertdialog"`,
      `aria-modal`, IDREF label/description wiring, focus-inside, cancel close, and
      destructive action close behavior. Same-session evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check examples/gallery/scripts/emit-interactive-gallery.mjs examples/gallery/src/interactive/alert-dialog-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/generated/interactive/alert-dialog-demo.tsx examples/gallery/src/generated/interactive/alert-dialog-demo.client.js plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds
      app-authored accordion, checkbox-group, radio-group, slider, and toggle-group
      demos to the compiled interactive gallery; checked-in generated server/client
      artifacts under `examples/gallery/src/generated/interactive/` include versioned
      `on:*` refs and handlers; `examples/gallery/src/interactive-gallery.test.ts`
      statically asserts generated `fw-state` and client artifacts; and
      `examples/gallery/src/interactive-gallery.browser.test.ts` uses the real runtime
      loader to prove click/keyboard `fw-state` movement plus visible ARIA, roving
      tabindex, native checked/range behavior, and output synchronization. Same-session
      evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check examples/gallery/package.json examples/gallery/scripts/emit-interactive-gallery.mjs examples/gallery/src/interactive/accordion-demo.tsx examples/gallery/src/interactive/checkbox-group-demo.tsx examples/gallery/src/interactive/radio-group-demo.tsx examples/gallery/src/interactive/slider-demo.tsx examples/gallery/src/interactive/toggle-group-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/generated/interactive/accordion-demo.tsx examples/gallery/src/generated/interactive/accordion-demo.client.js examples/gallery/src/generated/interactive/checkbox-group-demo.tsx examples/gallery/src/generated/interactive/checkbox-group-demo.client.js examples/gallery/src/generated/interactive/radio-group-demo.tsx examples/gallery/src/generated/interactive/radio-group-demo.client.js examples/gallery/src/generated/interactive/slider-demo.tsx examples/gallery/src/generated/interactive/slider-demo.client.js examples/gallery/src/generated/interactive/toggle-group-demo.tsx examples/gallery/src/generated/interactive/toggle-group-demo.client.js plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds
      app-authored otp-field and toolbar demos to the compiled interactive gallery.
      Checked-in generated server/client artifacts under
      `examples/gallery/src/generated/interactive/` include versioned `on:input`,
      `on:keydown`, and `on:click` refs. Static tests inspect generated OTP/toolbar
      artifacts and execute the generated client handlers; the Chromium browser test
      installs the real runtime loader and proves OTP aggregate/slot/focus updates plus
      toolbar roving-tabindex/pressed-state updates through generated modules. Same-session
      evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/otp-field.test.ts src/primitives/toolbar.test.ts src/tooling/lint-primitives.test.ts src/tooling/primitive-handler-lint.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check examples/gallery/package.json examples/gallery/scripts/emit-interactive-gallery.mjs examples/gallery/src/interactive/otp-field-demo.tsx examples/gallery/src/interactive/toolbar-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/generated/interactive/otp-field-demo.tsx examples/gallery/src/generated/interactive/otp-field-demo.client.js examples/gallery/src/generated/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/toolbar-demo.client.js plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds
      app-authored select, combobox, and autocomplete demos to the compiled interactive
      gallery. Checked-in generated server/client artifacts under
      `examples/gallery/src/generated/interactive/` include versioned `on:change`,
      `on:input`, and `on:click` refs. Static tests inspect those artifacts and execute
      generated handlers; the Chromium browser test installs the real runtime loader and
      proves native select value/text, combobox listbox ARIA/selected-option state, and
      autocomplete datalist/input/value synchronization through generated modules.
      Same-session evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/select.test.ts src/primitives/combobox.test.ts src/primitives/autocomplete.test.ts src/tooling/lint-primitives.test.ts src/tooling/primitive-handler-lint.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check examples/gallery/package.json examples/gallery/scripts/emit-interactive-gallery.mjs examples/gallery/src/interactive/select-demo.tsx examples/gallery/src/interactive/combobox-demo.tsx examples/gallery/src/interactive/autocomplete-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/generated/interactive/select-demo.tsx examples/gallery/src/generated/interactive/select-demo.client.js examples/gallery/src/generated/interactive/combobox-demo.tsx examples/gallery/src/generated/interactive/combobox-demo.client.js examples/gallery/src/generated/interactive/autocomplete-demo.tsx examples/gallery/src/generated/interactive/autocomplete-demo.client.js plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` extends the
      existing app-authored dialog, alert-dialog, and popover demos with native-dismiss/
      top-layer generated refs. Dialog and alert-dialog now compile root `on:keydown`
      refs plus dialog `on:cancel` refs, and popover compiles a root `on:keydown` ref;
      static tests inspect and execute those generated client handlers. The Chromium
      browser test mounts the generated demos through the real runtime loader and verifies
      browser-visible native `<dialog>`/popover top-layer open and close state. Same-session
      evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/dialog.test.ts src/primitives/alert-dialog.test.ts src/primitives/popover.test.ts src/tooling/lint-primitives.test.ts src/tooling/primitive-handler-lint.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check examples/gallery/src/interactive/dialog-demo.tsx examples/gallery/src/interactive/alert-dialog-demo.tsx examples/gallery/src/interactive/popover-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/generated/interactive/dialog-demo.tsx examples/gallery/src/generated/interactive/dialog-demo.client.js examples/gallery/src/generated/interactive/alert-dialog-demo.tsx examples/gallery/src/generated/interactive/alert-dialog-demo.client.js examples/gallery/src/generated/interactive/popover-demo.tsx examples/gallery/src/generated/interactive/popover-demo.client.js plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/merge-fixtures.test.tsx`
      adds richer rendered G5 family goldens for scroll-area, select, command, dialog,
      fieldset, and toast attrs that were previously covered only by the exported-builder
      inventory. The fixtures exercise SPEC §4.6 class/scalar/logical-OR merges,
      primitive-owned `data-state`, IDREF conflicts, and ARIA/role diagnostics.
      Same-session evidence:
      `pnpm exec vitest --run examples/gallery/src/merge-fixtures.test.tsx`.
      Additional evidence 2026-06-13: `examples/gallery/src/merge-fixtures.test.tsx`
      closes G5 exported attrs inventory/rendered goldens by rendering every one of the
      134 exported primitive `*Attributes` builders through the SPEC §4.6 merge oracle
      with author stress attrs, merged HTML inline snapshots, and diagnostic checks.
      Same-session evidence:
      `pnpm --filter @jiso/example-gallery exec vitest --run src/merge-fixtures.test.tsx`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive/` adds an
      app-authored hover-card demo to the compiled interactive gallery. Checked-in
      generated artifacts under `examples/gallery/src/generated/interactive/` include
      versioned focus, pointer, and Escape handler refs; static tests inspect and execute
      those generated client handlers; and the Chromium browser test mounts the demo through
      the real runtime loader and proves browser-visible `jiso-hover-card`, `aria-expanded`,
      hidden/data-state/output synchronization, and native manual-popover show/hide behavior.
      Same-session evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/hover-card.test.ts src/tooling/lint-primitives.test.ts src/tooling/primitive-handler-lint.test.ts`.
      Additional evidence 2026-06-12: `packages/ui/src/dropdown-menu.tsx`,
      `packages/ui/src/context-menu.tsx`, `packages/ui/src/menubar.tsx`,
      `packages/ui/src/navigation-menu.tsx`, and `packages/ui/src/command.tsx` add the remaining
      H3 styled TSX wrappers over headless primitive attrs; `examples/gallery/src/demo-fixtures.tsx`
      adds static routes and behavior-contract snippets for those styled H3 surfaces; and
      `packages/cli/src/index.test.ts` syncs the `fw add` catalog. Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check packages/ui/src/command.tsx packages/ui/src/context-menu.tsx packages/ui/src/dropdown-menu.tsx packages/ui/src/menubar.tsx packages/ui/src/navigation-menu.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive-docs.tsx`
      exports a docs/gallery `/interactive` route that renders every checked-in compiled
      interactive demo, and `examples/gallery/package.json` now records the complete
      generated demo manifest including the hover-card/menu/command/toast families.
      `examples/gallery/src/interactive-gallery.test.ts` fails if the manifest, generated
      artifact set, or docs route drift apart, and inspects the rendered docs route for each
      `data-gallery-interactive` section plus generated client-module refs. Same-session
      evidence:
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery -- --check`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check examples/gallery/package.json examples/gallery/src/index.ts examples/gallery/src/interactive-docs.tsx examples/gallery/src/interactive-gallery.test.ts plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `examples/gallery/src/interactive-gallery.test.ts`
      now derives the generated-client DOM contract for every checked-in compiled interactive
      demo from rendered `on:*` refs and generated `.client.js` exports. The inventory verifies
      SPEC §4.4/§4.6 load-bearing handler refs, versioned module paths, event-name suffixes, and
      SPEC §5.2 lowered TSX/rendered route parity so stale, missing, or extra generated client
      refs fail the gallery conformance suite. Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check examples/gallery/src/interactive-gallery.test.ts plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: `examples/gallery/src/interactive/` adds
      app-authored progress and meter demos to the compiled interactive gallery.
      Checked-in generated server/client artifacts under
      `examples/gallery/src/generated/interactive/` include versioned click handler refs;
      `examples/gallery/src/interactive-gallery.test.ts` inspects those artifacts and
      executes the generated handlers; and `examples/gallery/src/interactive-gallery.browser.test.ts`
      mounts the generated demos through the real runtime loader and verifies native
      `<progress>` and `<meter>` value/qualitative state, `aria-valuetext`, and output
      synchronization. Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check examples/gallery/package.json examples/gallery/scripts/emit-interactive-gallery.mjs examples/gallery/src/interactive-docs.tsx examples/gallery/src/interactive/progress-demo.tsx examples/gallery/src/interactive/meter-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/generated/interactive/progress-demo.tsx examples/gallery/src/generated/interactive/progress-demo.client.js examples/gallery/src/generated/interactive/meter-demo.tsx examples/gallery/src/generated/interactive/meter-demo.client.js plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: `examples/gallery/src/interactive/scroll-area-demo.tsx`
      adds an app-authored scroll-area primitive demo compiled by
      `examples/gallery/scripts/emit-interactive-gallery.mjs`; checked-in generated artifacts
      under `examples/gallery/src/generated/interactive/scroll-area-demo.*` include a versioned
      click handler, and `examples/gallery/src/interactive-gallery.browser.test.ts` verifies
      Chromium `scrollTop`, viewport labelling/focusability, scrollbar/thumb attrs, `fw-state`,
      and output sync through the real runtime loader. `examples/gallery/vite.config.ts` now
      includes generated `.js` client modules in the `vp run export` task inputs so static docs
      export invalidates when versioned generated client refs change. Same-session evidence:
      `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`,
      `pnpm --filter @jiso/ui exec vitest --run`, `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`, and `pnpm exec vp check` over the
      touched gallery scroll-area source/generated artifacts, `examples/gallery/vite.config.ts`,
      `plans/ui.md`, and `IMPLEMENT_v1.md`.
      Additional evidence 2026-06-13: `examples/gallery/src/app-shell.ts` exposes a
      Jiso docs shell for `/interactive`, registers every checked-in generated interactive
      client module under its compiled versioned `/c/` ref, and
      `examples/gallery/vite.config.ts` wires `vp run export` through
      `examples/gallery/scripts/export-static.mjs` so static docs output includes the
      route document plus generated client modules. `examples/gallery/src/interactive-gallery.test.ts`
      runs the export and inspects `dist/interactive/index.html` plus the emitted
      `/c/examples/gallery/src/generated/interactive/` module files. Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      `pnpm exec vp check examples/gallery/scripts/export-static.mjs examples/gallery/src/app-shell.ts examples/gallery/src/index.ts examples/gallery/src/interactive-gallery.test.ts examples/gallery/vite.config.ts plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `@jiso/ui` adds a vendorable styled
      checkbox-group wrapper over the headless native checkbox-group attrs, and the
      static gallery adds `/components/checkbox-group` behavior-contract coverage plus
      `fw add` catalog sync. Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`,
      `pnpm exec vp check packages/ui/src/checkbox-group.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `@jiso/ui` adds a vendorable styled toolbar
      wrapper over the headless toolbar attrs, and the static gallery adds
      `/components/toolbar` behavior-contract coverage plus `fw add` catalog sync.
      Same-session evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `@jiso/ui` adds vendorable styled H3
      wrappers for select, combobox, autocomplete, slider, and toast over the
      headless primitive attrs. The static gallery adds `/components/select`,
      `/components/combobox`, `/components/autocomplete`, `/components/slider`,
      and `/components/toast` routes with behavior-contract coverage, and
      `fw add` catalog tests synchronize the new package exports. Same-session
      evidence:
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`,
      `pnpm exec vp check packages/ui/src/autocomplete.tsx packages/ui/src/combobox.tsx packages/ui/src/select.tsx packages/ui/src/slider.tsx packages/ui/src/toast.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts plans/ui.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/ui` closes the styled H1/pure-markup gap with
      vendorable TSX wrappers for accordion, alert-dialog, avatar, collapsible, dialog,
      disclosure, hover-card, meter, popover, progress, separator, and tooltip over the
      headless primitive attrs. The static gallery adds `/components/collapsible`,
      `/components/disclosure`, `/components/hover-card`, and `/components/popover` route and
      behavior-contract coverage, while existing H1 static routes remain stable. Same-session
      evidence: `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      targeted `pnpm exec vp check` over the touched UI/gallery/plan files, and
      `git diff --check`.
      Additional evidence 2026-06-13: `@jiso/ui` expands the styled field/fieldset
      family with vendorable `FieldTextarea` and `FieldSelect` wrappers over the shared
      native field IDREF contract, while `/components/field` now proves input,
      textarea, select, alert error, and fieldset wiring in the static gallery. Same-session
      evidence: `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm exec vitest --run packages/cli/src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`,
      and targeted `pnpm exec vp check` over the touched UI/gallery files.
      Additional evidence 2026-06-13: `@jiso/headless-ui` closes a shared
      H3 menu/navigation typeahead edge case by treating repeated printable
      keys as one-key cycling search instead of accumulating an impossible
      multi-key buffer. Focused primitive tests now prove disabled-item
      skipping plus same-prefix cycling for dropdown-menu, context-menu,
      menubar, and navigation-menu. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run`,
      targeted `pnpm exec vitest --run` over the shared typeahead and four
      affected primitive tests, `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`,
      targeted `pnpm exec vp check` over the touched headless-ui/plan files,
      and `git diff --check`.
      Additional D7 evidence 2026-06-13: `packages/headless-ui/src/primitives/toolbar.ts`
      now emits `data-pressed` alongside `aria-pressed`, and `packages/ui/src/toolbar.tsx`
      consumes that primitive-owned state instead of deriving it in the wrapper. The compiled
      interactive gallery extends radio-group, tabs, and toggle-group with disabled items,
      updates tabs/toolbar/toggle-group generated handlers to keep ARIA, `data-state`,
      `data-pressed`, visibility, and roving tabindex synchronized, and keeps toast generated
      handlers aligned on hidden plus `data-state="closed"` after action, close, or Escape.
      Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/toolbar.test.ts packages/ui/src/index.test.tsx`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm --filter @jiso/ui exec vitest --run`,
      `pnpm --filter @jiso/example-gallery test`,
      `pnpm --filter @jiso/example-gallery run test:browser`, targeted `pnpm exec vp check`
      over the touched UI/gallery/plan files, and `git diff --check`.
      Additional D7 evidence 2026-06-13: `@jiso/headless-ui` now restores rejected native
      input values for autocomplete, combobox, command, and otp-field when SPEC §4.6
      cancelable/blocked primitive changes keep state unchanged. Focused tests cover disabled
      and canceled input paths so visible DOM values cannot drift past primitive state.
      Same-session evidence: targeted `pnpm exec vitest --run` over the four affected
      primitive suites, `pnpm --filter @jiso/headless-ui exec vitest --run`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm --filter @jiso/ui exec vitest --run`, focused gallery vitest over
      `src/interactive-gallery.test.ts` and `src/behavior-contracts.test.ts`, targeted
      `pnpm exec vp check`, and `git diff --check`.
      Additional D7 evidence 2026-06-13: `packages/headless-ui/src/primitives/number-field.ts`
      now aligns off-step primitive step-button changes to the explicit native `min`/`step` grid
      before clamping, keeping the SPEC §6.3 real number input contract coherent when app state
      contains an off-grid value. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/number-field.test.ts`,
      `pnpm --filter @jiso/headless-ui exec vitest --run`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/src/primitives/number-field.ts packages/headless-ui/src/primitives/number-field.test.ts IMPLEMENT_v1.md plans/ui.md`,
      and `git diff --check`.
      Additional D7 evidence 2026-06-13: `packages/headless-ui/src/primitives/checkbox-group.ts`
      now restores the live native checkbox `checked` property when disabled or SPEC §4.6
      cancelable item-click changes keep the checkbox-group value unchanged, matching the native
      state-restoration behavior already covered for input-like primitives while preserving the
      SPEC §6.3 real checkbox control contract. `examples/gallery/src/merge-fixtures.test.tsx`
      also aligns its checkbox-group G5 golden on `role="group"` instead of the radio-group role.
      Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/checkbox-group.test.ts`,
      `pnpm --filter @jiso/headless-ui exec vitest --run`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vitest --run examples/gallery/src/merge-fixtures.test.tsx`,
      `pnpm exec vp check packages/headless-ui/src/primitives/checkbox-group.ts packages/headless-ui/src/primitives/checkbox-group.test.ts examples/gallery/src/merge-fixtures.test.tsx IMPLEMENT_v1.md plans/ui.md`,
      and `git diff --check`.
- [ ] D8 app shell (request dispatch, document assembly, node adapter, Vite+ plugin, static export) is planned in `plans/app-shell.md`; design agreed 2026-06-11 (lives in `@jiso/server`, web-standard `Request → Response`, closed dispatch table with no middleware, L0/L1-only static export); SPEC §9.5 and S8/R1/R2/R3/R4 are implemented, R5 has dev middleware and manifest/build planning helpers, R6 static export writes HTML, `/c/` modules, and configured static assets, R7 starter adoption is partially proven, commerce now has a shell-backed HTTP document/query/module serve entry including `/`, shared-shell `/_m/` mutation dispatch is proven by commerce enhanced/no-JS HTTP tests, and the docs site ships through `vp run export`; the flat-HTML compatibility layer is no longer the default export path, while R7 remains open for any remaining starter/serve adoption gaps.
      Evidence 2026-06-12: the create-jiso starter template and commerce Vite configs now
      late-load the shared `jisoAppShellViteSsrDevPlugin()` through Vite SSR, replacing
      duplicated local dispatch predicates while keeping config-load/build paths independent
      of unbuilt workspace server sources. Focused tests prove generated starter build/dev/
      serve/export flows and commerce dev/serve shell ownership plus Vite asset pass-through.
      Evidence 2026-06-12: `@jiso/server` now owns file-based Vite manifest parsing for
      app-shell export tasks through `jisoAppShellViteManifestFromFile()` and
      `jisoAppShellViteManifestAssetsFromFile()`, preserving shared validation before SPEC §9.5
      static asset copying and removing consumer-local `.vite/manifest.json` parsing.
      Evidence 2026-06-12: `@jiso/server` now also exposes
      `createJisoAppShellViteBuildFromManifestFile()` and
      `exportJisoAppShellViteBuildFromManifestFile()`, so Vite package export tasks can feed a
      built manifest file into route hint wiring, compiled `/c/` module registration, Vite asset
      copying, and SPEC §9.5 static replay through one server-owned path. Focused verification:
      `pnpm exec vitest --run packages/server/src/vite.test.ts`.
      Evidence 2026-06-12: the create-jiso starter, commerce, and docs-site export scripts now
      use `exportJisoAppShellViteBuildFromManifestFile()` for manifest-backed static replay and
      asset copying instead of composing manifest asset helpers and `exportStaticApp()` in each
      consumer. `jisoAppShellViteManifestStylesheetHrefsFromFile()` supplies the starter's built
      stylesheet href before Vite SSR loads `src/app-shell.ts`. Focused verification:
      `pnpm exec vitest --run packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "runs the generated starter app-shell request and export proof|scaffolds real template files"`,
      `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "public commerce shell static output|vp run export|documents the commerce app-shell"`,
      and `pnpm exec vitest --run site/scripts/app-shell.test.mjs`.
      Evidence 2026-06-12: the create-jiso starter and docs-site export scripts now also call
      `staticExportManifestForJisoAppShellViteBuildFromManifestFile()` before write export, so
      their task output proves public manifest route-document, `/c/` module, and Vite asset
      counts through the same SPEC §9.5 dry-run helper used by server tests.
      Evidence 2026-06-12: the commerce app shell now serves `/` through the same
      SPEC §9.5 `createApp()` request shell as `/cart`, includes `/index.html` in
      public static replay, and keeps `/c/commerce.client.js` plus the Vite CSS asset
      in the export output. Focused verification:
      `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`,
      `pnpm exec vitest --run examples/commerce`,
      `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/static-export.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "generated starter app-shell|generated starter app-shell through|runs vp run export|runs vp dev|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through the vp dev task|runs .*built stylesheet"`,
      and `pnpm exec vitest --run site/scripts/app-shell.test.mjs`.
      Evidence 2026-06-12: `jisoAppShellVitePlugin(app)` now uses the same
      dispatch-table request ownership predicate as the SSR dev helper, preserving
      SPEC §9.5 app-shell handling for matched routes/reserved paths while passing
      source assets such as `/src/styles.css` to Vite middleware. Focused verification:
      `pnpm exec vitest --run packages/server/src/vite.test.ts -t "serves shell requests and passes source assets onward"`.
      Evidence 2026-06-12: Vite manifest parsing and app-shell asset/hint planning now live in
      `packages/server/src/vite-manifest.ts`, leaving `packages/server/src/vite.ts` focused on
      dev middleware, build/export coordination, and public API re-exports. Focused verification:
      `corepack pnpm exec vitest --run packages/server/src/vite-manifest.test.ts packages/server/src/vite.test.ts`
      and
      `corepack pnpm exec vp check packages/server/src/vite.ts packages/server/src/vite-manifest.ts packages/server/src/vite-manifest.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`.
      Evidence 2026-06-12: Vite dev request ownership, SSR dev loading, and dev diagnostic
      interception now live in `packages/server/src/vite-dev.ts`, leaving `vite.ts` as the
      public Vite API/re-export and plugin hook coordinator. Focused verification:
      `corepack pnpm exec vitest --run packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts packages/server/src/vite-diagnostics.test.ts`
      and
      `corepack pnpm exec vp check packages/server/src/vite.ts packages/server/src/vite-dev.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-diagnostics.test.ts packages/server/src/vite.test.ts`.
      Evidence 2026-06-12: static export now validates configured asset source files before
      writing replayed HTML, `/c/` modules, or copied assets, so missing static assets fail
      through FW229 teaching errors without partial generated output. Focused verification:
      `corepack pnpm exec vitest --run packages/server/src/static-export.test.ts`.
      Evidence 2026-06-12: static export now validates replayed `/c/` client-module responses
      are JavaScript before writing output, so a referenced HTML/error response fails through
      FW229 and leaves `outDir` unwritten. Focused verification:
      `corepack pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`.
      Evidence 2026-06-12: static export replay now discovers same-origin full-URL `/c/`
      client module refs from route HTML attributes and `Link` headers, normalizes them to
      static-host `/c/` files, ignores external `/c/` refs, and copies those modules through the
      same app-shell request handler as root-relative refs (SPEC §4.3, §9.5). Focused
      verification:
      `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`.
      Evidence 2026-06-12: `@jiso/server` now owns the starter/docs export-task contract for
      resolving exactly one built stylesheet from a validated Vite manifest through
      `jisoAppShellViteManifestStylesheetHref()` and
      `jisoAppShellViteManifestStylesheetHrefFromFile()`, while preserving the public Vite API
      re-export. Focused verification:
      `corepack pnpm exec vitest --run packages/server/src/vite-manifest.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`.
      Evidence 2026-06-12: `@jiso/server` now exposes `staticExportManifest()` plus
      `staticExportManifestForJisoAppShellViteBuild()` and
      `staticExportManifestForJisoAppShellViteBuildFromManifestFile()`, so export tasks can inspect
      the exact directory-index HTML files, copied Vite manifest assets, and referenced `/c/`
      modules through the same SPEC §9.5 dry-run path that write export uses. Focused
      verification:
      `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`.
      Evidence 2026-06-12: the server node adapter now has a shared `earlyHints: false`
      option for middleware stacks that need to keep final `Link` headers without relaying
      103 responses, and the SSR Vite dev plugin threads that option through its default
      loaded-app `Request -> Response` adapter. The create-jiso starter no longer exports a
      starter-specific Node handler; generated `vp dev`, `vp run serve`, `npm run serve`,
      and `npm start` load the default exported Jiso app through the public app-shell dev
      plugin, while static export keeps the manifest-backed replay path. Focused
      verification:
      `pnpm exec vitest --run packages/server/src/node.test.ts packages/server/src/vite-dev.test.ts packages/server/src/api/app.test.ts`
      and
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|typechecks the generated auth recipe|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`;
      final gates:
      `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check IMPLEMENT_v1.md packages/create-jiso/src/index.test.ts packages/create-jiso/templates/README.md packages/create-jiso/templates/docs/deployment.md packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/templates/src/app-shell.ts packages/create-jiso/templates/vite.config.ts packages/server/src/api/app-shell/node.ts packages/server/src/api/app.test.ts packages/server/src/node.test.ts packages/server/src/node.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-dev.ts plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13: app-shell request dispatch moved subtractively into
      `packages/server/src/app-request.ts`, leaving `packages/server/src/app.ts` as the closed
      app aggregate/public type surface while the new module owns SPEC §9.5 client-module,
      query, mutation, endpoint, route-document, and configured error-shell dispatch. Focused
      verification: `pnpm exec vitest --run packages/server/src` and
      `pnpm exec tsc --noEmit --pretty false`.
      Additional evidence 2026-06-13: matched request dispatch moved further into
      `packages/server/src/app-dispatch.ts`, so `app-request.ts` now owns URL normalization and
      the outer error fallback while the matched dispatcher owns SPEC §9.5 client-module, query,
      mutation, raw endpoint, route-document, 405, and 404 branches. The app-shell Vite subpath
      barrel also re-exports directly from split Vite owner modules. Focused verification:
      `pnpm exec vitest --run packages/server/src/app-dispatch.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/api/app.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`.
      Evidence 2026-06-13: static-export document reference discovery moved subtractively into
      `packages/server/src/static-export-document.ts`, leaving
      `packages/server/src/static-replay.ts` to own synthetic request replay and artifact assembly
      while the new boundary owns same-origin `/c/` discovery and SPEC §9.5 L0/L1 server endpoint
      classification. Focused verification:
      `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`.
      Evidence 2026-06-13: `packages/server/src/vite-plugin.ts` now owns the R5 Vite middleware
      and plugin `writeBundle` bridge, while `packages/server/src/vite.ts` is a public aggregate
      over the split Vite app-shell owners. The root package barrel exports
      `api/app-shell/index.ts` directly and deletes the unused internal `api/app.ts`
      compatibility layer, so root and `@jiso/server/app-shell` adoption are pinned to the same
      SPEC §9.5 public modules. Focused verification:
      `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/static-export.test.ts packages/server/src/static-export-replay.test.ts`,
      `pnpm exec vitest --run packages/server/src`, `pnpm exec tsc --noEmit --pretty false`,
      `pnpm exec vp check packages/server/src/vite-plugin.ts packages/server/src/vite.ts packages/server/src/index.ts packages/server/src/api/app.test.ts packages/server/src/vite.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Evidence 2026-06-13: the leftover internal `packages/server/src/vite.ts` and
      `packages/server/src/document.ts` aggregates were deleted. Vite tests now import the
      public `api/app-shell/vite.ts` subpath, and rendering/app/dev imports go directly to
      `document-core.ts` or `document-diagnostics.ts`, keeping the R5/R6/R7 package boundaries
      subtractive. Focused verification:
      `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts packages/server/src/vite-diagnostics.test.ts`.
      Evidence 2026-06-13: static-export route planning and replayed response validation moved
      subtractively into `packages/server/src/static-export-route-plan.ts` and
      `packages/server/src/static-export-response.ts`, leaving `static-export.ts` to orchestrate
      export writes and `static-replay.ts` to choreograph synthetic SPEC §9.5 route/module
      requests plus L0/L1 document validation. Focused verification:
      `pnpm exec vitest --run packages/server/src/static-export-response.test.ts packages/server/src/static-export-route-plan.test.ts packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`,
      `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`,
      and `pnpm exec tsc --noEmit --pretty false`.
      Evidence 2026-06-13: static-export output planning and write mechanics moved
      subtractively into `packages/server/src/static-export-output.ts`, leaving
      `packages/server/src/static-export.ts` to orchestrate SPEC §9.5 route replay, `/c/`
      module replay, asset planning, and optional writes. The new boundary owns static asset
      normalization, target path safety, conflict diagnostics, source readability checks, and
      all-or-nothing write execution. Focused verification:
      `pnpm exec vitest --run packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`,
      `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`,
      and `pnpm exec tsc --noEmit --pretty false`.
      Evidence 2026-06-13: `packages/server/src/wire-html.ts` now owns stylesheet-link
      prepending for SPEC §9.5 `<fw-fragment>` payloads, so mutation responses and deferred
      stream fragments share one wire-html emitter instead of composing fragment stylesheet HTML
      in each producer. Focused verification:
      `pnpm exec vitest --run packages/server/src/wire-html.test.ts packages/server/src/mutation-response.test.ts packages/server/src/deferred-stream.test.ts`.
- [x] D9 TSX-only authoring (commerce TSX migration, FW235 error diagnostic, Constitution #3 payoff rewording, FW226 demotion) is archived in `plans/archive.md` under deleted `plans/block-ir.md`; commerce is TSX-authored, SPEC §5.2/FW235 text is landed, FW235 is implemented at error severity with compiler-emitted provenance exemption, and starter/docs/agent TSX-only constraints are recorded and tested.
- [x] D10 diagnostics surfacing (blocking Vite dev transform, dev teaching-error documents, `fw mcp` agent surface) is planned in `plans/diagnostics.md`; design agreed 2026-06-11 (severity decided once on shared `diagnosticDefinitions`, surfaces only render; `error` blocks transform/build with no last-good serving; server-rendered dev error documents over the D8 R5 middleware; MCP wraps existing compile/check/explain APIs, stdio-first); SPEC §11.3 surfacing text, V1/V2 Vite transform diagnostics, V3 static-export refusal, E1 dev diagnostic document renderer, E2 page/enhanced-mutation/no-JS middleware failed-module integration, M1a stdio `fw mcp`, M1b SDK-backed MCP lifecycle, M2 `compile/v1` contract, and seeded red/green gate wiring are implemented. Evidence 2026-06-12: `node --test --test-name-pattern "D10 seeded diagnostics gate" tests/fw-check.node.mjs` covers Vite transform/lint callback, `vp build`, static export API, `fw export`, MCP object dispatch, and fallback MCP stdio; `pnpm exec vitest --run packages/server/src/vite-diagnostics.test.ts` covers dev page/enhanced-mutation/no-JS teaching documents.
- [ ] P10 v1 acceptance ledger is wired with concrete dated doc ledgers for the outside legibility study and prelaunch checks; docs freeze, actual outside study results, external launch evidence, and final clean-checkout acceptance run remain open.
      Evidence 2026-06-12: `docs/v1-acceptance.md` maps every SPEC §16 criterion
      to either a runnable local command set or an external evidence ledger,
      `docs/legibility-study.md` has a dated readiness ledger plus a per-session
      checklist while all five outside participant rows remain pending, and
      `docs/prelaunch-checklist.md` has dated audit/local checklist rows while
      trademark, `jiso.dev`, `@jiso`, and linguistic evidence remain pending.
      Evidence 2026-06-12: local round9 integration acceptance passed at
      `5e693a7` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round25 integration acceptance passed at
      `036e494` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is also not the final freeze run because
      the outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round28 integration acceptance passed at
      `ec876f5` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round57 integration acceptance passed at
      `6a06fde` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round58 integration acceptance passed at
      `216ca2d` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round58 + UI integration acceptance passed at
      `c3a73e7` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round59 integration acceptance passed at
      `3db82b2` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round61 integration acceptance passed at
      `11bdcca` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round62 integration acceptance passed at
      `9268cd2` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round63 integration acceptance passed at
      `e377126` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
      Evidence 2026-06-12: local round64 integration acceptance passed at
      `fe81037` via `pnpm run acceptance` (check, test, browser, build, perf,
      conformance, and fw-check). This is not the final freeze run because the
      outside legibility study and external prelaunch evidence remain pending.
- [x] §16 commerce reference app is TSX-authored: `CartBadge`, `OrderHistory`, and `ProductGrid` (cards, no-JS add-to-cart forms, failure output) live in per-component `examples/commerce/src/components/*.tsx` (SPEC §5.2 1:1 mapping); `examples/commerce/scripts/emit-components.mjs` compiles them through `@jiso/compiler` and commits the lowered IR to `src/generated/*.tsx` behind the §5.2.3 fixpoint and render-equivalence gates (Constitution #3), so served stamps (`fw-c`, `fw-deps`, `data-bind`) are compiler-derived (§4.2/§4.8) and zero string-template components remain. Enablers: server-side JSX runtime at `@jiso/server/jsx-runtime` (§3/§4.2) and compiler-derived `fw-c` identity stamps on native render hosts (§4.2). Evidence 2026-06-11: `npx vitest --run examples/commerce` (25/25 — includes the "compiles TSX-authored components to committed IR through the fixpoint gate" test running `emit-components.mjs --check`, and the graph-facts test proving `generated/touch-graph.ts` stayed byte-identical); `pnpm run check`; `pnpm run check:build`; `pnpm run check:fw`; `pnpm run test:conformance`.
      Open questions from this slice (SPEC silent/ambiguous — not coded through):
      (1) SPEC §4 does not define JSX text-child escaping. `@jiso/server/jsx-runtime`
      composes child strings raw so pre-rendered component HTML and helpers
      (`csrfField`) compose without a wrapper type, which also means query data
      interpolated as a text child is not HTML-escaped; needs a SPEC ruling
      (escape-by-default plus an explicit raw marker would match §6.6 soundness).
      (2) SPEC Appendix A assigns mutation-form rendering to `<f.Form>`, which
      `@jiso/server` does not provide; commerce passes per-request CSRF/failure
      facts as an explicit second render argument outside the declared queries
      (§4.1 render-inputs rule covers the first argument only).
      (3) §4.8 attribute-expression lowering replaces the authored attribute with
      `data-derive`/`data-derive-attr`, dropping the server-rendered initial
      attribute value; commerce authors against destructured locals so `href` and
      `data-page-cursor` stay in the served HTML (the no-JS contract needs them).

## Decisions adopted by this plan

| Decision                                   | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Derived optimism (§10.5)                   | **Out — v2.** v1 ships hand-written transforms over the same IR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Per spec phasing; v1 must keep the transform IR derivation-compatible                                                                                                                                                                                                                                                                                                                                                                                              |
| Verification layer (§11.2, FW402–409)      | **In** (the spec's v1.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The test harness needs the db wrapper anyway; verification is core to the pitch                                                                                                                                                                                                                                                                                                                                                                                    |
| §13 design areas                           | 13.1 CSS, 13.2 lists, 13.3 streaming, 13.5 adopt-don't-invent all **in**; 13.4 stays a non-goal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 13.1 explicitly blocks v1 freeze, but v1 recommends Tailwind for app-authored styling so Jiso's own CSS work narrows to delivery/scoping correctness                                                                                                                                                                                                                                                                                                               |
| Toolchain                                  | **Vite+ (`vite-plus`) + Node server**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `vp` is the single project entrypoint for dev/build/test/check; it gives us Vite, Vitest, Oxlint, Oxfmt, Rolldown, tsdown, Vite Task, and the TypeScript Go toolchain in one place; see Spike S1 for the known tension                                                                                                                                                                                                                                             |
| Styling                                    | **Tailwind is the recommended app-author styling path.** Jiso still owns a minimal CSS delivery/scoping pipeline for non-Tailwind CSS and late fragments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Utility classes avoid most bespoke component CSS, but the framework must still guarantee that SSR pages, mutation fragments, and `<fw-defer>` streams have the CSS they need                                                                                                                                                                                                                                                                                       |
| Shadow DOM                                 | **Dropped entirely.** All rendering is light DOM; non-Tailwind CSS may be scoped by the compiler via `@scope`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Shadow boundaries break IDREF wiring, form participation, and ARIA — fatal to L0 and the no-JS contract (SPEC §3.1); Tailwind plus a narrow delivery pipeline keeps this smaller                                                                                                                                                                                                                                                                                   |
| Custom elements                            | **Dropped — nothing is ever registered.** Identity = `fw-c` stamp; dashed tags are inert sugar; native hosts (`<tr fw-c="…">`) allowed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Resumability comes from delegation + `import()`, not `customElements.define`; kills upgrade/FACE machinery and the `<table>`-nesting papercut                                                                                                                                                                                                                                                                                                                      |
| Client reactivity                          | **No TC39 Signals, no runtime signal graph.** Compiler emits a per-query update plan (bindings → derives → stamps); Signals interop is a v2 adapter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The client dependency graph is compile-time-known; polyfill bytes don't belong in the always-loaded path, and the proposal hasn't shipped                                                                                                                                                                                                                                                                                                                          |
| Import maps                                | **Demoted to optional deployment detail.** `on:*` refs carry full URLs + `#export`; cache-busting via query strings/ETags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Removes the blocking importmap script and the not-yet-mapped-spec problem for streamed/patched islands; typed `'#cart'` aliases survive at compile time                                                                                                                                                                                                                                                                                                            |
| Live/SSE (L4)                              | **Cut from v1 → v2.** v1 liveness = BroadcastChannel tab sync + refetch-on-focus; the server is fully stateless                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The only stateful infra in the design served features CRUD apps defer for years; the wire vocabulary is transport-agnostic, so SSE is additive later                                                                                                                                                                                                                                                                                                               |
| Speculation Rules                          | **Opt-in per route, default off** (`prefetch: 'conservative' \| 'moderate' \| false`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Auto-emission owns the prerender footgun matrix (analytics in prerendered pages, non-idempotent renders, discard cost); it's one script tag — seasoning, not spine                                                                                                                                                                                                                                                                                                 |
| Database story                             | Postgres-first via Drizzle; `pglite` for tests; MySQL/SQLite conformance deferred to late hardening                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | One engine while the IR is in flux                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Typed routes & links                       | **In — TanStack-Router-style type layer over the MPA spine (SPEC §6.4).** `route()` declarations with param/search schemas; `RouteRegistry` emit; `<Link>`/`href()`/`redirect()` lower to plain anchors/Location headers; `form.get` typed against `search`; FW220 literal-href check                                                                                                                                                                                                                                                                                                                                                                                                                                   | Navigation was the last untyped wiring surface in an MPA whose spine is navigation; the type layer is separable from TanStack's runtime — no client router enters                                                                                                                                                                                                                                                                                                  |
| Type-level exhaustiveness & IDREFs         | **In.** Touch-graph invalidation sets emitted into registries so `OptimisticFor` enforces FW310 in `tsc`; compiler id registry types L0 IDREF wiring (FW221)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Every `fw check` finding knowable at registry-emit time should also be an editor-visible type error; L0 was the one untyped in-page wiring layer                                                                                                                                                                                                                                                                                                                   |
| Soundness hardening                        | **In.** Strict tsconfig + lint bans (`any`, non-null assertions, `as`) in starter app code; typed session schema in core; `data-p-*` coercion declared once; registry emit atomic in `vp dev`/`vp check` (SPEC §5.2.6, §6.5–6.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The §1.2 proof claim is conditional on strictness; registry staleness (the typegen failure mode) is designed out, not mitigated                                                                                                                                                                                                                                                                                                                                    |
| Composition (children/slots/layouts)       | **In (SPEC §4.5–4.6).** Children/slots are render-time `Html` args; no context API — lexical scope + the DOM (`closest('[fw-c]')`), framework never reparents (normative); fragment-target children hoisted to component references (FW230) — morph-preserved slot holes **rejected**; primitive composition = attrs-function IR + `asChild` sugar + behavior attributes over the normative merge-rule table (FW231–FW233); `on:*` chaining in the loader                                                                                                                                                                                                                                                               | The last undefined §4 surface; every spelling lowers to plain calls/attributes, so the fixpoint and Constitution #5 survive; polymorphic `as` rejected (type-perf, intrinsic-only)                                                                                                                                                                                                                                                                                 |
| Update plan (bindings/derives/stamps)      | **In (SPEC §4.8).** The DOM is the plan — no separate plan artifact; derives are named exported pure fns with declared inputs; template stamps with `fw-key` as the single keyed-identity contract shared with morph; island-local state shares the machinery; `isomorphic: true` self-render escape ships in v1 (FW302). Stamps move from D2 into P5                                                                                                                                                                                                                                                                                                                                                                   | The spec's central client mechanism was specified by name only; P2/P5 execute it, so it freezes before they exit                                                                                                                                                                                                                                                                                                                                                   |
| Execution triggers                         | **In (SPEC §4.7).** Closed set: `on:visible` / `on:idle` / `on:load` (FW211-gated, justification required); `ctx.signal` is the entire lifecycle API (aborted when morph removes the island)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Charts/maps/autoplay had no entry point; "execute nothing until interaction" becomes "execute nothing undeclared," with every trigger legible in markup                                                                                                                                                                                                                                                                                                            |
| Parameterized queries & typed reads        | **In (SPEC §9.4, §10.2).** `args` schemas on `query()`; components bind args from their own props (`.args()`); canonical instance keys (`product:p1`) as the one currency across store/wire/optimism/live; `/_q/` GET endpoint; `guard` on queries **and** routes; `notFound()` on routes; CSRF named as a runtime-validated boundary (SPEC §6.6)                                                                                                                                                                                                                                                                                                                                                                       | Route params → queries had no path; the read side and pages join the proof surface and the unguarded audit                                                                                                                                                                                                                                                                                                                                                         |
| Update coverage (FW311)                    | **In (SPEC §4.9).** The compiler classifies every query-dependent render position: `plan` / `isomorphic` / `fragment` / `renderOnce` / UNHANDLED (FW311); `fw check coverage` mirrors §10.6's report; editor-visible during lowering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The client-side dual of FW310 — a static update plan replacing runtime dependency tracking needs a static completeness proof, or partial DOM updates ship silently                                                                                                                                                                                                                                                                                                 |
| Stamp derivation & residual-string closure | **In (SPEC §4.8, §6, §4.2, §4.5).** `data-bind` stamps derived from typed expressions — never required in sugar (FW222 drift error, FW223 redundancy lint); id uniqueness by construction (FW224); HTML content-model check (FW225); `fw-deps`/`fw-c` and event/trigger-name validation in ejected IR (FW226, FW212); render-equivalence gate `render(src) ≡ render(compile(src))`                                                                                                                                                                                                                                                                                                                                      | One fact, one spelling — the IR's load-bearing strings are all derived or validated, and the fixpoint becomes semantic (behavior-preserving), not merely syntactic                                                                                                                                                                                                                                                                                                 |
| Auth                                       | **In as archived workstream D5 — see `plans/archive.md` under deleted `plans/auth.md`.** Agnostic capability floor in core (session-resolution seam, guard-failure contract, mutation response-header channel, raw `endpoint()` primitive); `@jiso/better-auth` as the blessed adapter wrapping `auth.api` in ordinary mutations — §14's floor+blessed pattern applied to auth                                                                                                                                                                                                                                                                                                                                          | SPEC ships authorization (guards, typed sessions §6.5, audits) with no way to create a session; CRM segment needs SSO/orgs day one; an unowned integration pushes adopters outside the proof surface at its most security-critical point                                                                                                                                                                                                                           |
| Machine endpoints                          | **In as workstream D6 — archived in `plans/archive.md` under deleted `plans/machine-endpoints.md`.** One new shaped primitive (`webhook()`: verifier presets, loose schemas, FW-Idem idempotency, domain writes feeding touch graph + change record) over the landed `endpoint()` floor (SPEC §9.1); exports/downloads are ordinary guarded routes via `respond.file()`/`respond.stream()` outcomes + a storage capability interface; `fw explain --endpoints` audit; no sanctioned JSON API in v1                                                                                                                                                                                                                      | Webhooks, CSV export, and file downloads had no sanctioned home, forcing adopters outside the typed surface at security-sensitive boundaries; webhook writes through `domain()` shrink the `invalidate()` escape hatch and pre-wire the v2 live bus                                                                                                                                                                                                                |
| UI libraries                               | **In as workstream D7 — see `plans/ui.md`.** `@jiso/headless-ui` (behavior layer: compound primitives over §4.5–4.6 composition/merging, L0-first, prefix `jiso-`) + `@jiso/ui` (shadcn-quality Tailwind layer, **vendored** via `fw add` so its components are bare-named app source) + `examples/gallery` as docs/conformance surface. Naming: package-declared prefixes, compiler-enforced uniqueness, FW234 collision teaching error with alias escape; behavior attributes ride the package prefix; `fw-*` stays framework-reserved                                                                                                                                                                                | ~40 real consumers pressure-test §4.5–4.8 beyond the commerce app; bare names make the first ecosystem collision a rename scramble, and app-side naming breaks knowledge portability — prefixes write the convention down while the namespace is empty                                                                                                                                                                                                             |
| Read-shape & scoping honesty               | **In (SPEC §10.1–10.3, §11.2, §6.6).** Opaque projections (`sql<T>`, raw) require declared `s.*` output schemas, runtime shape-verified (FW410); `owner:` schema annotation + `fw explain --unscoped` IDOR audit; immutable versioned module serving (old documents' `on:*` refs resolve across deploys)                                                                                                                                                                                                                                                                                                                                                                                                                | `sql<T>` is a cast wearing a type's clothes — the read-side FW406; row ownership and handler-module skew were the last unaudited runtime seams                                                                                                                                                                                                                                                                                                                     |
| IR authoring posture                       | **In as workstream D9 — archived in `plans/archive.md` under deleted `plans/block-ir.md`.** TSX is the sole app-authoring surface; the lowered IR is an output format. Hand-authoring IR in app source is **FW235** (error, no suppression mechanism, no ejection workflow); FW226 demotes to internal fixpoint-path validation; `fw add` vendors TSX only; agents emit TSX and read IR. Constitution #3's property (every compiler feature emits valid Jiso source; compiling output is a no-op) is unchanged — only its "any component can be ejected" payoff is dropped and reworded. The commerce TSX migration gates the lint: front-end gaps it surfaces are fixed in the compiler before FW235 exists            | Authorable-IR-as-input created a gravity well: the reference app was written at the IR altitude and the TSX front-end went unexercised by any real app. One authoring surface keeps knowledge portable, keeps lowering diagnostics (FW201/FW225/FW230) in every author's path — including generated apps — and forces front-end gaps to be fixed at the right layer instead of accumulating IR islands; strict→loose is the non-breaking ratchet direction pre-1.0 |
| Diagnostics surfacing                      | **In as workstream D10 — see `plans/diagnostics.md`.** Severity is decided once on shared `diagnosticDefinitions` (`error`/`warn`/`lint`/`notice`); every surface renders the same structured diagnostic. `error` blocks the Vite dev transform (overlay + terminal via thrown teaching errors), `vp build`, and static export — no suppression flags, no last-good serving; `warn`/`lint`/`notice` never block dev. Dev-mode requests against a failed module get a server-rendered teaching-error document (covers no-JS form posts and fragment requests the client overlay can't see). `fw mcp` exposes compile/check/explain as structured MCP tools, including in-memory `compile_component` for generation loops | The dev transform currently discards compiler diagnostics — errors the SPEC promises at compile time reach no one; teaching errors are the product (Constitution #5), and the fix-menu format is a repair prompt for agent generation (the Dyad loop); Next.js 16's default-on dev MCP validates the agent surface                                                                                                                                                 |
| Nullable bindings & exempt-read closure    | **In (SPEC §4.8, §6.2, §10.1, §11.2).** Binding-path grammar gains optional segments (`?.`) with empty-rendering semantics shared by the server renderer and the loader; a path traversing a nullable segment without `?.` or a null-handling derive is FW227; `exempt` is write-side only — a query whose read set includes an exempt table is FW411, statically checked (P4) and runtime-verified (P9)                                                                                                                                                                                                                                                                                                                | leftJoin-sparse data made "paths type-check" quietly unsound, and exempt-but-read tables reintroduced the silent-staleness bug §10.6 kills — both holes sat directly under the §1.1 proof claim                                                                                                                                                                                                                                                                    |

## Out of scope (do not build, do not stub)

Derived optimism & derivation algebra (§10.5 — but every v1 interface it will consume is a compatibility constraint, noted per phase) · `<fw-live>`/SSE + the live bus and Redis (v2 — v1 liveness is BroadcastChannel + refetch-on-focus, §9.3) · CDC adapter (v2) · TC39 Signals interop adapter (v2) · custom-element registration (never — identity is `fw-c`) · import-map emission (optional deployment config, not core) · runtime read/write tracking (v3) · client router, hydration, offline, persistent cross-navigation media (§1.3, §13.4 — typed `<Link>`/`href()` is a compile-time layer lowering to plain anchors, SPEC §6.4, not a router) · Speculation Rules / invoker polyfills · polymorphic `as` prop (rejected, SPEC §4.6) · triggers beyond visible/idle/load (closed set, SPEC §4.7) · portals & runtime context APIs (never — composition is lexical scope + the DOM tree, SPEC §4.5).

---

## Tooling baseline

Use [Vite+](https://viteplus.dev/) as the repository toolchain from P0 onward.

- Install the global `vp` command for contributors and CI; keep `vite-plus` as the local project package.
- Keep package-manager choice deterministic through Vite+ (`vp install`, `vp add`, `vp remove`), with pnpm workspace layout still acceptable because Vite+ detects and manages it.
- Add `@typescript/native-preview` and use the TypeScript Go path for fast type checking. Replace standalone `tsc --noEmit` gates with `vp check` wherever the check is purely static; keep explicit TypeScript invocation only for tests that intentionally compare classic `tsc` behavior.
- Put lint and format config in the root `vite.config.ts`, not separate `.oxlintrc`, `oxlint.config.ts`, `.prettierrc`, or Biome config files. Enable `lint.options.typeAware: true` and `lint.options.typeCheck: true`.
- Use Oxlint for linting and Oxfmt for formatting through `vp lint`, `vp fmt`, and `vp check`. `vp check` is the standing static gate: format check + lint + type check.
- Use Vite Task through `vp run` for repo tasks and cacheable CI commands; avoid bespoke task runners unless Vite+ cannot express a required dependency edge.
- Use `voidzero-dev/setup-vp` in GitHub Actions with Node 24 for tooling. The Jiso server runtime target remains Node ≥22 unless a later phase explicitly tightens it.
- Editor setup should point Oxc format/lint tooling at `./vite.config.ts` so format-on-save and CI share one configuration.
- Configure Tailwind as the recommended starter/app styling integration. Tailwind class names in templates must be statically discoverable or safelisted; generated/dynamic class strings are a documented footgun because mutation fragments and deferred streams depend on the built stylesheet containing every class they can emit.

## Repository layout

Vite+ workspace monorepo:

```
packages/
  core/        @jiso/core      component(), query()/form() types, route()/Link/href type layer (PathParams), JsonValue, registry type machinery
  runtime/     @jiso/runtime   4KB loader, handler(), query-data store + update plans, morph, enhanced forms, <fw-defer>
  server/      @jiso/server    mutation(), route() handlers + redirect(), domain()/write(), guards, s.* schema, typed sessions, request lifecycle, page/fragment render, wire
  compiler/    @jiso/compiler  parse→analyze→lower, registry emit, Vite+/Vite plugin, fixpoint checker
  drizzle/     @jiso/drizzle   jiso() schema annotations, touch-set extraction (ts-morph), query shape/key inference
  test/        @jiso/test      jisoTest, exec/page/db harness, pglite, propertyTest, db verification wrapper
  cli/         fw              explain, check, audit subcommands
  create-jiso/                 starter template (ships the fixpoint CI test, per Constitution #3)
examples/
  commerce/                    reference app (§16 yardstick) — grows with every phase from P3 on
conformance/
  drizzle-pin/                 pinned-subset conformance suite (§14 "fails loudly on API drift")
vite.config.ts                 Vite+ root config: dev/build/test plus lint/fmt/staged/task config
```

**Standing CI gates, added as soon as each exists:** `vp check` (Oxfmt + Oxlint + TypeScript Go type checks), `vp test`, `vp build`/`vp pack` as applicable, fixpoint (`compile(compile(src)) ≡ compile(src)`), render-equivalence (`render(src) ≡ render(compile(src))` — the semantic fixpoint, browser-free differential suite, SPEC §5.2.3), minifier name-preservation (Constitution #1), Drizzle conformance pin, `observed ⊆ static ∪ FW406` (from P9), diagnostic-snapshot tests (every FW code's message text is a golden file — teaching errors are a feature, §5.2.5).

---

## Risk spikes (run first or alongside P1 — each has a decision-gate writeup)

- **S1 — Vite+ vs. the 1:1 file mapping.** Vite+/Vite/Rolldown want to chunk and hash; Jiso forbids both (§5.2.1–2). Prove: `vp dev` serves compiler-emitted modules with HMR, `vp build`/Rolldown can be configured for per-file `x.server.js`/`x.client.js` output, stable export names through prod minification (manifest-driven reserved names), and hashes confined to cache-busting query strings on emitted module URLs. **Failure pivot:** use Vite+ for dev/test/check/task orchestration, but own the production emit pass behind a `vp run` task.
- **S2 — Loader budget.** Skeleton of all loader responsibilities (§4.4 — delegation including chained `on:*` refs (§4.6), the three execution triggers + `ctx.signal` (§4.7), `url#export` `import()`, form interception, query-data hydration + update-plan execution by self-describing attribute walk (§4.8 — no plan artifact to parse), refetch-on-focus, morph hook) inside 4KB gzipped, with morph **excluded** (lazy-loaded on first mutation/fragment). Decide what else is lazy. Gate: a perf budget test in CI.
- **S3 — Morph engine.** Evaluate idiomorph/morphdom vs. writing our own against the §9.1 survival contract (focus, scroll, selection, CSS transitions, nested island state, `data-bind` stamps). Output: the keyed-node (`fw-key`) contract shared verbatim by template stamps (§4.8) and 13.2 list reordering, island-teardown accounting (aborting removed islands' `ctx.signal`s, §4.7), and the two-tier test harness — a jsdom-class structural property suite (`morph(a, b) ≡ b`, keyed identity preserved) plus a real-browser suite for the survival contract; the latter is first-class framework testing, not an exception (§11.4).
- **S4 — ts-morph extraction robustness.** Prototype §11.1 resolution cases A–E against a corpus of real-world Drizzle code (scraped OSS repos). Measure what % lands in A/B (must be ≳90% to honor the spec's claim) and how often FW406 fires. Informs how loud the v1 messaging on raw-SQL ergonomics must be.
- **S5 — Tailwind-first CSS delivery pipeline** (feeds D1): prove Tailwind works as the default app styling path in SSR, mutation fragments, and `<fw-defer>` streams; define static class discovery/safelist constraints; keep `@scope (<tag>)` wrapping, per-page dedupe, critical-CSS inlining, late-fragment style delivery, and fallback selector rewriting only for non-Tailwind component CSS or framework-owned styles.

---

## Phase 0 — Foundations

Vite+ monorepo + CI skeleton: root `vite.config.ts`, local `vite-plus`, `@typescript/native-preview`, Oxlint/Oxfmt config under `lint`/`fmt`, staged-file config, cacheable Vite Task entries, and GitHub Actions using `voidzero-dev/setup-vp` followed by `vp install`, `vp check`, `vp test`, and the initially empty build/pack tasks. Wire-format **golden fixtures** authored by hand from §9 (request/response transcripts for: enhanced mutation, no-JS POST-redirect-GET, 422 validation fragment, typed read (`GET /_q/product?id=p1` → `<fw-query name="product:p1">`, SPEC §9.4), `<fw-defer>` stream — the SSE chunk fixture moves to the v2 backlog with L4). These fixtures are the contract every later phase tests against — the wire is the documentation (Constitution #4), so the fixtures come before any implementation. Diagnostic registry module (FW codes, severities, message templates) that all packages import.

**Exit:** `vp check`/`vp test` run on empty packages in CI; fixtures reviewed and frozen; spikes S1–S5 scheduled.

## Phase 1 — Compiler core & client IR

`@jiso/compiler` parse→analyze→lower for components (§4, §5): closure extraction with the three capture channels, `Component$fnName` / `Component$element_event` naming, `data-p-*` param emission, FW201 (with the show-the-lowering message) and FW210; 1:1 file emit; fixpoint checker (the IR must round-trip — this forces the IR to be genuinely authorable Jiso source from day one); registry `.d.ts` emit (HandlerModules, FragmentTargets initially) — emission is an atomic part of every compile so `vp check` never sees a stale registry (SPEC §5.2.6); `<Link>`/`href()` lowering to plain anchors as a sugar→IR rule (SPEC §6.4 — validation against the route table activates in P3 when `RouteRegistry` exists); element-id collection for the IDREF registry, FW221 for component-scoped IDREFs (`commandfor`, `popovertarget`, `for`, `aria-*`); `JsonValue` state constraint; `data-p-*` declared coercion for non-string params; **composition lowering** (SPEC §4.5–4.6): children/slots → `Html` args, fragment-target child hoisting into named components (FW230), `asChild` → attrs-function lowering, deterministic attribute merging with FW231/FW232/FW233 golden diagnostics; **derive extraction & stamp derivation** (SPEC §4.8): inline bound expressions → named `derive()` exports with declared inputs; `data-bind` stamps derived from typed expressions per the §4.8 classification (sole-text-child → stamp the element; mixed content → synthesized span, reported; attribute position → derive), with FW222 (stamp/expression drift), FW223 (redundant stamp in sugar), and the null-aware path grammar — optional `?.` segments lowered from sugar; a nullable traversal without `?.` or a null-handling derive is FW227 (SPEC §4.8; the typed proof against inferred query shapes completes in P5 when shapes exist); **update-coverage classification** (SPEC §4.9): every query-dependent render position gets a status — `plan` and `renderOnce` live here, `fragment`/`isomorphic` statuses complete in P5 — UNHANDLED is FW311; FW224 id uniqueness (component scope; page-composition check finalizes in P3), FW225 HTML content-model validation, FW212 event/trigger-name lint, FW226 `fw-deps`/`fw-c` validation for ejected IR; **render-equivalence differential suite** joins the fixpoint gate (`render(src) ≡ render(compile(src))`, SPEC §5.2.3); execution-trigger attributes (`on:visible`/`on:idle`/`on:load`, FW211 lint) pass through as ordinary `on:*` refs (SPEC §4.7); platform-behavior emission (§5.2.4) for the dialog/popover/details/`:has()` set, each substitution recorded for `fw explain`.

**Exit:** cart-badge example from §4 compiles to byte-stable IR — including merged attributes (merge determinism is part of the fixpoint) and derived `data-bind` stamps (the §4.1 sugar contains no stamp; the §4.2 output does); fixpoint **and render-equivalence** gates green; FW201/FW210/FW222/FW227/FW230/FW231/FW311 golden diagnostics; Vite+ plugin serves the client modules through `vp dev` (S1 outcome applied).

## Phase 2 — Loader & MPA spine

`@jiso/runtime` loader per S2: capture-phase global delegation including chained `on:*` refs (SPEC §4.6), `url#export` handler resolution + `import()`, the three execution triggers + `ctx.signal` plumbing (SPEC §4.7), island identity via `fw-c`/dashed-tag stamps (nothing registered — no `customElements.define`; the morph layer accounts for islands it patches in), query-data hydration from `fw-query` scripts + update-plan execution — bindings and named derives by self-describing attribute walk, including the defined empty semantics for optional (`?.`) path segments: text bindings render the empty string, attribute bindings remove the attribute, byte-identical to the server renderer (SPEC §4.8; stamps land in P5 with morph), refetch-on-focus/visibility behavior. **The SPEC §4.5–4.8 sections are a P2 entry gate — the loader implements them, so they freeze first.** MPA spine (§8): opt-in per-route Speculation Rules config (`prefetch: 'conservative' | 'moderate' | false`, default off; the config key moves onto the `route()` declaration when it lands in P3), cross-document View Transition name stamping, bfcache hygiene as enforced rules (no `unload` anywhere in framework code; `keepalive` plumbing landed now, used in P6), `modulepreload` emission from rendered attributes + 103 Early Hints hook, **immutable versioned module serving** (old documents' `on:*` refs resolve across deploys — SPEC §6.6, normative; prior versions retained by the serving layer).

**Exit:** an L0+L1 demo app (tabs, dialog via invoker commands, filter island, an `on:visible` chart island that boots without interaction) is interactive at first paint with zero JS executed before a declared trigger; Playwright smoke for L0 behaviors (framework-owned browser suite, §11.4).

## Phase 3 — Server data plane: queries, mutations, domains

`@jiso/server` + `@jiso/drizzle` authoring surfaces: `jiso()` schema annotations → domain registry + `DomainKey` emit (§10.1); `query()` with result-type inference from the select shape, **`args` schemas + `.args()` prop binding + canonical instance-key encoding + optional query `guard`** (SPEC §10.2), instance-key extraction from WHERE eq-predicates, and **FW410: opaque projections (`sql<T>`, raw SQL) require a declared `s.*` output schema** (SPEC §10.2 — the runtime shape check lands in P9); `owner:` schema annotation (SPEC §10.1 — consumed by the P8 `--unscoped` audit); page-level FW224 id-uniqueness finalizes here (page composition is now known); `domain()`/`write()` with the Tx-typed db (escaping the tx is a type error); `mutation()` with `s.*` schema (FormData coercion declared once), guards + combinators (`all`, `authed`, `role`, `rateLimit`), typed `fail()` errors; **`route()` declarations** (SPEC §6.4): path captured as a literal type, `params`/`search` schemas with coercion declared once, per-route `prefetch`/`meta` config, **route `guard` + `notFound()`** (SPEC §6.4), `RouteRegistry` emit, typed `redirect()` in the PRG path, FW220 literal-href validation goes live; **CSRF token issuance/validation in the request lifecycle** (SPEC §6.6); **typed session schema** (SPEC §6.5 — `req.session` from a declared `s.object`; instance keys §10.2 depend on it); the **normative request lifecycle** (§10.3) including post-commit query re-run; `invalidate()` escape hatch (linted) and flat-tags on-ramp (§14 v1 row); FW330 lint. Page rendering: components render server-side to light-DOM HTML with `fw-deps` stamps and `fw-query` JSON ships once per page.

For this phase invalidation runs off **declared `touches` only** — static extraction lands in P4, so nothing here blocks on ts-morph.

**Exit:** commerce app boots: product page renders from real queries; `addToCart` works **no-JS** (POST-redirect-GET, errors re-rendered) — the fallback is validated before the enhanced path exists, because it _is_ the output (§6.3); renaming a route path turns every `<Link>` and `redirect()` red under `vp check` (SPEC §16.6); removing a guard from a route or query surfaces in the unguarded audit.

## Phase 4 — Touch-set extraction & invalidation graph

The §11.1 static pass over `write()` bodies (S4 hardened): resolution cases A–E, interprocedural bottom-up summaries with memoized fixpoint, `update…from`/`insert…select` read-set handling, parameterized key extraction, FW406/FW409; the derived query read sets are checked against the domain registry, where **an `exempt` table in a read set is FW411** — exemption is write-side only (SPEC §10.1; the runtime observed-read half lands in P9). Committed `generated/touch-graph.ts`. Invalidation = touch graph ∩ declared query read sets, keyed where row-level keys exist. The per-mutation invalidated-query key sets are also emitted into the registries (`InvalidationSets`, SPEC §6.1) — this is what lets `OptimisticFor` enforce exhaustiveness in `tsc` from P6 on. Drizzle conformance pin goes live in CI.

Drizzle closure evidence (2026-06-13): project local helper summary matching now treats typed receiver carriers as proven receiver arguments, so local write summaries and query read summaries fold through `{ db }` carrier handoffs instead of degrading as opaque helper calls, while unknown/external carrier handoffs still remain FW406 surfaces (SPEC §11.1). Proved by `pnpm exec vitest --run packages/drizzle/src`, `pnpm exec vitest --run conformance/drizzle-pin`, `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`, and `git diff --check`.

**Compatibility constraint (v2):** the symbolic effect forms in §10.5 Stage 1 are _not_ built, but the extraction layer's internal representation should keep eq-predicate match structure rather than flattening to table names, so the v2 deriver can extend it instead of re-parsing.

**Exit:** removing a `touches` declaration from `cart.addItem` changes nothing (it's inferred); the §11.3 example touch-graph diff appears in code review; FW404/FW406/FW409 golden diagnostics plus the FW411 static-half golden (a query reading an exempt table).

## Phase 5 — Enhanced wire: fragments, forms, morph, client data plane

The full §9.1 round-trip: `FW-Targets` read off the live DOM, `FW-Idem` replay, fragment rendering through the **same render functions** as full pages; `<fw-query>` patch → query-value update → the compiled per-query update plan re-runs `data-bind`/derives/stamps across islands (no runtime dependency tracking); morph application per S3 contract; `form('cart/add')` typed forms with field completeness checking (§6.3) and `ctx.submit` with the exhaustive error union — `form(addToCart)` value-based spelling preferred where the mutation is importable (§6.3); `form.get('/products')` GET forms typed against the route's `search` schema (SPEC §6.4); FW220 sweep over residual literal `href`s in emitted IR; 422 validation fragments; **template stamps** (SPEC §4.8 — keyed insert/remove/reorder, `fw-key` shared with morph; moved here from D2); the **`/_q/` typed read endpoint** (SPEC §9.4) validated against its P0 fixture, with refetch-on-focus retargeted onto it; **isomorphic islands** (`isomorphic: true` self-render + self-morph, FW302 justification lint); **FW311 status set completes** (`fragment` and `isomorphic` join `plan`/`renderOnce`, SPEC §4.9) and `fw check coverage` data is emitted; FW301/FW320 lints; cross-island coordination ladder (URL > typed events > lint-gated shared client state, §7).

Runtime closure evidence (2026-06-13): inline enhanced responses now publish pre-split `fw-query` wire chunks (`attrs`/`content`) and `query-events.ts` parses them through `wire-parser.ts`'s shared `readQueryElementChunk`, matching mutation-response parsing, removing the inline-only empty-query `null` fallback, and rejecting old `body`/`name`/`key` compatibility event details (SPEC §6.6, §9.1, §9.4). Proved by `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check packages/runtime/src/wire-parser.ts packages/runtime/src/query-events.ts packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts packages/runtime/src/query-store.test.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.

Runtime closure evidence (2026-06-13): visible-return query hydration discovers `script[fw-query]` nodes through the private scanner in `query-visible-return.ts`, and inline `jiso:query` hydration records applied query keys into the same visible-return ledger as mutation responses and typed reads (SPEC §4.4, §9.1, §9.4). Proved by `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check packages/runtime/src/query-visible-return.ts packages/runtime/src/query-events.ts packages/runtime/src/loader.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.browser.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.

Runtime closure evidence (2026-06-13): inline-loader generation and `--check` now enforce the SPEC §4.4 4KB gzip budget before a generated bootstrap can ship; `inline-loader.test.ts` uses the exported build-time budget and an oversized deterministic fixture to prove the failure path. Proved by `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.

Runtime closure evidence (2026-06-13): inline-loader minifier parity now rejects TypeScript-only syntax that TypeScript accepts in JS mode before it can ship as inline browser script text, and regex-literal/division boundaries are spaced explicitly so the SPEC §4.4 always-loaded bootstrap remains deterministic under minification. Proved by `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check packages/runtime/src/inline-js-minifier.ts packages/runtime/src/inline-js-minifier.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.

Runtime closure evidence (2026-06-13): delegated handler context construction now lives in `handler-context.ts`, which owns SPEC §4.7 `data-p-*` params, `fw-state` read/write, ctx.signal island scope, and removed-island abort cleanup, while `handlers.ts` is narrowed to state-host queueing plus handler-reference import/invocation for the SPEC §9.1 runtime path. Focused handler context assertions moved out of the broad runtime barrel test into `handler-context.test.ts`. Proved by `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check packages/runtime/src/handler-context.ts packages/runtime/src/handlers.ts packages/runtime/src/handler-context.test.ts packages/runtime/src/loader-api.ts packages/runtime/src/loader.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/morph.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/index.test.ts packages/runtime/src/loader-lifecycle.test.ts`.

Runtime closure evidence (2026-06-13): the runtime root no longer composes through private compatibility barrels; `index.ts` exports the canonical inline loader, loader/handler, morph, mutation, and query split modules directly after deleting `inline.ts`, `loader-api.ts`, `morphing.ts`, `mutation.ts`, and `query.ts`, and `index-exports.test.ts` pins those root exports to the split implementations (SPEC §4.4, §4.7, §4.8, §9.1, §9.4). Proved by `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index-exports.test.ts packages/runtime/src/submit-context.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.

Runtime closure evidence (2026-06-13): core optimism/rebase coverage moved from the broad runtime barrel test into `optimism.test.ts`, and fragment plus structural morph coverage moved into `morph.test.ts`; `index.test.ts` now keeps the remaining barrel/integration assertions while module-owner tests carry SPEC §4.8 keyed identity, §9.1 fragment apply, and §10.4 optimism behavior. Proved by `pnpm exec vitest --run packages/runtime/src/optimism.test.ts packages/runtime/src/morph.test.ts packages/runtime/src/index.test.ts`, `pnpm exec vitest --run packages/runtime/src`, `pnpm exec tsc --noEmit --pretty false`, and `pnpm exec vp check packages/runtime/src/optimism.test.ts packages/runtime/src/morph.test.ts packages/runtime/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.

**Exit:** wire fixtures from P0 pass byte-for-byte against the live server; morph survival contract green (focus/scroll/selection/island-state tests); column rename in `schema.ts` breaks `data-bind` consumers under `vp check` with TypeScript Go type checks enabled (§6.2 row 4 proven); a projection going nullable (an inner join relaxed to leftJoin) breaks every binding path traversing it without `?.` the same way — FW227, the nullability mirror of the rename proof (SPEC §4.8); renaming a route path breaks `<Link>`/GET-form consumers the same way — the navigation mirror of the column-rename proof (SPEC §16.6); the `/_q/` fixture passes byte-for-byte; stamp reconciliation (insert/remove/reorder) property tests green; the §4.9 conditional-dot case fails FW311 and is cleared by each of the four statuses (golden teaching error).

## Phase 6 — Optimism (hand-written) & rebase runtime

The L3 layer per §10.4 v1 scope: `OptimisticFor<typeof mutation>` transform IR authored in mutation files (keyed by query, including parameterized keys); runtime snapshot (`structuredClone`) → transform application → `fw-pending`/`aria-busy` stamping → reconcile-by-morph → error restore; per-query pending-transform log with rebase over arriving server truth; `queue: 'cart'` named FIFO; `keepalive` + log-dies-with-document navigation semantics (§8); `'await-fragment'` declaration; **FW310 exhaustiveness check** with v1 statuses (`hand-written` / `await-fragment` / `UNHANDLED`) — enforced at two altitudes off the same derived set (§10.6): `OptimisticFor<typeof mutation>` consumes the P4-emitted `InvalidationSets` so a missing entry is an editor-visible type error, and `fw check` remains the CI/agent surface; prediction ⊆ eventual-truth property tests over hand-written transforms (§11.4.4).

**Compatibility constraint (v2):** transform signature, key parameterization, and the FW310 status enum are exactly what derivation will emit into — no v1-only shortcuts in the IR.

**Exit:** badge ticks instantly; wrong prediction silently corrected by morph; two rapid mutations rebase correctly; mid-flight navigation leaves no stale optimism (bfcache test); deleting a transform turns the mutation file red in-editor before `fw check` runs.

## Phase 7 — Liveness without a bus

The stateless liveness pair (§9.3): **BroadcastChannel rebroadcast** of mutation responses for same-user multi-tab sync (zero server cost), and **refetch-on-focus/visibility** as a loader behavior (per-query opt-out). `<fw-live>`, the SSE transport, guard-recheck-per-push, and the in-process/Redis bus are **deferred to v2** with CDC — the wire vocabulary is transport-agnostic by construction, so SSE arrives later as an additive transport. Deployment docs state plainly: the v1 server is stateless.

**Exit:** a mutation in one tab updates a second tab via BroadcastChannel; a backgrounded stale tab refetches on focus; nothing in the v1 deployment story names Redis.

## Phase 8 — `fw` CLI: explain & check

All §5.3 subcommands with **stable, diffable output** (snapshot-tested — agents and CI assertions consume this format, so it freezes here): `explain component|mutation|query|page` (component output includes derives, triggers, and attribute-merge decisions, SPEC §4.6–4.8), `--optimistic` (v1 statuses), `--unguarded` audit covering mutations, routes, and queries, **`--unscoped` IDOR audit** (owner-annotated tables × the P4 predicate extractor, SPEC §10.3); `fw check` = Jiso semantic checks only (touch-graph consistency + FW310 exhaustiveness + **FW311 update coverage** + fixpoint/render-equivalence + unguarded/unscoped audits), and it is wired into Vite+ as a `vp run fw-check` task so `vp check` remains the formatter/linter/type-checker gate. Graph-query examples for §11.4.3 intent assertions ship as documented recipes in the starter template.

**Exit:** §16.3's agent test is runnable: given only `fw explain` output for the commerce app, "what updates when X is clicked" is answerable mechanically; output format versioned and snapshot-locked.

## Phase 9 — Testing API & verification layer (v1.5)

`@jiso/test`: `jisoTest` with `exec`/`page`/`db` against pglite; typed error-path assertions; fragment HTML assertions without a browser. The **db verification wrapper** (§11.2): every executed statement parsed (`pgsql-ast-parser`), checked against the static graph — `observed ⊆ static ∪ FW406-annotated` as a CI failure; touch-checking automatic on every `exec`; read-side equivalent for query loaders **including observed-result-shape checks against declared/inferred types — the FW410 runtime half (SPEC §11.2)** and observed reads of `exempt` tables — the FW411 runtime half, catching exempt reads smuggled through raw SQL (SPEC §10.1, §11.2); FW402/403/405/407/408 land here (FW404/406/409 and FW411's static half landed in P4, FW410's static half in P3). Unified typed change record `{domain, keys, input}` emitted from the commit path, feeding the optimism runtime (P6) and the BroadcastChannel rebroadcast (P7) — retrofit those to consume it; the same record becomes the v2 live-bus payload.

**Exit:** full diagnostic table §11.3 implemented with golden messages; deliberately smuggled raw SQL in a test app fails CI two ways (static FW406 demand + runtime observation); commerce app's mutation suite runs in-memory, no container.

## Design workstreams (parallel tracks, not phases)

- **D1 — CSS (§13.1).** _Blocks v1 freeze._ Tailwind is the recommended app-author path. Design pass starts with S5 during P1–P2; implementation must land by end of P5 since fragments/morph interact with stylesheet identity. Must resolve: Tailwind integration in the starter and commerce app; static class discovery/safelist rules for SSR, mutation fragments, and `<fw-defer>` streams; CSS asset delivery so late fragments never reference missing classes; theming/token guidance using Tailwind/custom properties; and a smaller non-Tailwind escape hatch for co-located CSS (`@scope` wrapping, per-page dedupe, critical-CSS inlining, late-fragment style delivery, fallback selector rewrite). Deliverable: a spec section PR replacing §13.1's "needs a design pass" with normative Tailwind-first text, then implementation.
- **D2 — Lists at scale (§13.2).** After S3 + P6 (depends on morph keying and optimism). Template stamps themselves are normative (SPEC §4.8) and land in P5; D2 covers cursor pagination through URL params, infinite scroll as fragment appends, and `fw-key` reordering under simultaneous optimistic updates + morph. Validated in the commerce app's product grid + order history.
- **D3 — Streaming details (§13.3).** With P5. `<fw-defer>` priority hints, query-JSON arrives-before-consumers guarantee under HTTP/1.1; extend the P0 streaming fixture.
- **D4 — Adopt-don't-invent (§13.5).** After P5, each item small and independent: typed per-route `meta()` (rides the `route()` declaration from P3), `s.file()` uploads riding the pending mechanism, per-island error boundaries, server-rendered i18n catalogs, rate-limit guard middleware. (Typed sessions graduated to core and land in P3, SPEC §6.5.) Each ships only with a commerce-app usage.
- **D5 — Auth (archived in `plans/archive.md` under deleted `plans/auth.md`).** After P3. Agnostic core seams first (session-resolution seam, guard-failure contract, mutation response-header channel, `endpoint()` raw-endpoint primitive), then `@jiso/better-auth` as the blessed adapter: schema bridge with declared touches, typed session mapper, guard bindings, ejectable credential mutations wrapping `auth.api`, `mount()` for OAuth/SAML callbacks, pinned conformance suite (joins CI next to the Drizzle pin). The reference app adopts it so the unguarded/unscoped audits run behind a real authenticated flow.
- **D6 — Machine endpoints (archived in `plans/archive.md` under deleted `plans/machine-endpoints.md`).** After P3; shares the `endpoint()` floor deliverable with D5 A4 (its SPEC §9.1 text is landed). `webhook()` shaped primitive (verifier kit with ejectable provider presets + test vectors, loose input schemas, FW-Idem idempotency on provider event ids, Tx lifecycle with domain writes feeding the touch graph and the P9 change record); `respond.file()`/`respond.stream()` route outcomes so exports and downloads are ordinary guarded routes under the existing audits; storage capability interface (fs + S3 adapters) that D4's `s.file()` uploads retrofit onto; `fw explain --endpoints` audit (joins P8 snapshot-locked output). Gated by spike S7 (raw-body capture + webhook lifecycle) defined in the plan. Dropped by decision: `csvExport(query)` sugar and any sanctioned JSON API (stated v1 non-goal).
- **D7 — UI libraries (`plans/ui.md`).** After P5 (all framework prerequisites — composition lowering, merge rules FW231–233, triggers, stamps, isomorphic FW302, `/_q/` — exist; waves verify rather than wait). F-track framework seams first (package prefix registration + FW234 SPEC PR, behavior-attribute namespace, primitive-author `defaultPrevented` lint, platform-coverage audit for anchor positioning/`@starting-style`); then `@jiso/headless-ui` in three waves (L0-heavy → stateful L1 islands → list-driven/isomorphic) with behavior contracts ported from Base UI/APG references. H0 shared state-attribute, keyboard/menu navigation, typeahead, change-detail, and positioning fallback helpers have landed in `@jiso/headless-ui`; H1 is complete with disclosure, collapsible, accordion, dialog, alert-dialog, popover, tooltip, hover-card, separator, progress, meter, avatar, toggle, checkbox, and switch primitives. `@jiso/ui` vendored shadcn-style via `fw add` now has package-sourced TSX catalog output with clean FW235/FW225 compile coverage (**TSX-only vendoring — D9 constraint: vendored components are app source and FW235 applies**); `examples/gallery` is the docs + conformance surface (keyboard/ARIA parity gates, axe, self-baselined visual regression, §4.6 merge goldens) and has a browser-backed compiled interactive seed for toggle/checkbox/disclosure. Deferred by decision: carousel/calendar/resizable (W4, post-v1), Chart (out entirely).
- **D9 — TSX-only authoring (archived in `plans/archive.md` under deleted `plans/block-ir.md`).** After P1 (the TSX front-end exists); B1 gates B3. B-track: **B1** migrate commerce to per-component `.tsx` with JSX renders and compiler-derived stamps — the completeness proof of the front-end; gaps it surfaces are compiler fixes with SPEC citations, never IR workarounds or weakened tests; touch-graph stays byte-identical. **B2** SPEC PR: Constitution #3 payoff reworded (property text verbatim-unchanged — emitted output stays valid, fixpoint-checked source), normative "TSX is the sole authoring surface; the IR is an output format" in §5.2, FW235 in §11.3, FW226 demoted to internal fixpoint-path validation. **B3** FW235 implementation: error severity, golden teaching message showing the TSX equivalent (the reverse of FW201's show-the-lowering), provenance exemption so the fixpoint/render-equivalence gates keep compiling emitted IR — exemption proven by the gates themselves; lands only after B1 leaves commerce FW235-clean by construction. **B4** ecosystem constraints: `fw add` vendors TSX only (D7), starter/docs TSX-authored, agents emit TSX and read IR. No suppression mechanism — rejected, not deferred.
- **D10 — Diagnostics surfacing (`plans/diagnostics.md`).** V-track has its SPEC §11.3 severity-to-surface policy and the implemented blocking Vite transform, non-blocking channel for `warn`/`lint`/`notice`, and build/static-export refusal. E-track now has the E1 server-rendered diagnostic document renderer and E2 page/enhanced-mutation/no-JS failed-module middleware integration over the D8 R5 dev middleware. M-track has the stdio-compatible `fw mcp` fallback, SDK-backed stdio lifecycle, and `compile/v1` contract for `compile_component`/`fw_check`/`fw_explain`/`list_diagnostics`. Severity decided once on `diagnosticDefinitions`; surfaces only render — no surface gets its own blocking policy.

## Phase 10 — Reference app completion, starter, docs, v1 acceptance

Commerce app reaches the full Appendix A surface plus D2/D4 features; `create-jiso` starter (Vite+ scaffold, root `vite.config.ts` with Oxlint/Oxfmt/type-aware lint defaults, fixpoint CI test, graph-assertion recipes, deployment doc stating the stateless-server guarantee, static preview for exported `dist` output, §9.3); docs with the §2 constitution and §5.2 hard rules as normative pages. Then run §16 acceptance explicitly:

1. **Perf:** TTI ≡ FCP; <50ms perceived prerendered nav on routes that opt in; zero memory growth across 100 navigations (automated).
2. **Legibility:** the devtools usability study (§16.2) run with ≥5 outside developers — scheduled, not aspirational.
3. **Verifiability:** commerce app's behavior surface passes `vp check` + `vp run fw-check` + graph assertions with no app-level browser tests; the framework-owned L0 and morph-survival browser suites are green.
4. **Constitution:** fixpoint green; every feature has an authorable lowering (audited); `grep -r "invalidate(" app/` returns only documented sites.
5. **Coverage:** every (mutation × query) pair has an explicit optimistic status (hand-written or `'await-fragment'`), zero unhandled FW310s.
6. **Navigation typed:** every literal href/redirect in the commerce app resolves against the route registry (zero FW220/FW221); a route-path rename propagates to every link, GET form, and redirect under `vp check` (SPEC §16.6).
7. **Declared execution only:** `grep -r "on:load" app/` returns only FW211-justified sites; isomorphic islands only FW302-justified ones (SPEC §16.7).
8. **Update coverage:** every query-dependent DOM position in the commerce app has an explicit status (`plan` / `isomorphic` / `fragment` / `renderOnce`); zero unhandled FW311s (SPEC §16.8).

**Exit = v1 freeze.** The pre-launch checklist in `docs/prelaunch-checklist.md` (trademark, jiso.dev, `@jiso` npm scope, linguistic screen) runs alongside.

---

## Dependency graph (summary)

```
P0 ──▶ P1 ──▶ P2 ─────────────▶ P5 ──▶ P6 ──▶ P7
        │                      ▲  ▲
        └──▶ P3 ──▶ P4 ────────┘  │
S1─S5 ──┘ (gates P1/P2/P4/P5/D1)  │
D1 (Tailwind-first CSS) ── starts P1, lands by end P5
D3 ──────── with P5        D2 ── after P6
P8 (CLI) ── after P4+P6    D4 ── after P5
D5 (auth) ── after P3; adapter gated by S6 (archived in plans/archive.md)
D6 (machine endpoints) ── after P3; shares endpoint() with D5 A4; webhooks gated by S7 (archived in plans/archive.md)
D7 (UI libraries) ── after P5; F-track (prefix registration) gates H-track waves (plans/ui.md)
D9 (TSX-only authoring) ── after P1; B1 commerce migration gates the FW235 error (archived in plans/archive.md)
D10 (diagnostics surfacing) ── V-track after P1 (SPEC PR first); E-track after D8 R5; M-track after V1 (plans/diagnostics.md)
P9 ──────── after P4+P6 (retrofits P6/P7 onto change record)
P10 ─────── after everything
```

Two long poles: the **compiler→data-plane spine** (P1→P3→P4) and **Tailwind-first CSS delivery (D1)** — both start immediately. A third gate rides the spine: the SPEC §4.5–§4.8 component-model sections freeze before P2 exits (the loader implements them), and the `/_q/` typed-read fixture freezes in P0 with the rest of the wire. Tailwind should carry ordinary app styling; Jiso's remaining CSS responsibility is the framework contract that built CSS is present for SSR, mutation fragments, deferred streams, and non-Tailwind scoped escape hatches. The commerce app is the standing integration test from P3 onward; if a phase can't demonstrate its exit criteria in the commerce app, the phase isn't done.
