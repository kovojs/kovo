# High-value refactoring plan 2

Date: 2026-06-30

This is a second-wave scan after `plans/high-value-refactoring.md` was implemented. Do not
re-open completed items from that plan unless the new work below exposes a missed invariant.
Priority is based on correctness/security impact first, then maintainability and reviewability.

## P0 - Correctness and Security Invariants

- [ ] **P0.1 - Finish the integration fixture public-boundary migration.**
  - Current signals: `tests/integration-import-boundary.meta.test.ts` still carries
    `EXPECTED_ALLOWED_INTERNAL_IMPORTS = 51`, `LEGACY_FIXTURE_IMPORT_RULES`, and only four
    migrated fixture files. Many integration fixtures still import `@kovojs/*/internal` or
    `@kovojs/browser/generated` directly.
  - Refactor shape: migrate fixture app/client code to public APIs or a narrow
    `@kovojs/test` harness facade, remove the fixture-wide legacy rules, and leave only
    explicitly justified spec-level allowlist rows for tests that intentionally exercise an
    internal server ABI. Reuse the repo's import-boundary parser instead of keeping a separate
    regex scanner in this meta-test.
  - Risk reduced: integration tests can stop normalizing app-authored imports of framework
    internals, which is currently the largest remaining source of false confidence around public
    API conformance.
  - Verification: `pnpm exec vitest --run tests/integration-import-boundary.meta.test.ts` passes
    with zero legacy fixture imports, the migrated fixture list removed, and only explicit
    spec-level allowlist entries counted. Run the focused integration fixtures touched by the
    migration, then the integration shard or `vp run integration` if the touched set is broad.

- [ ] **P0.2 - Make access explain facts producer-owned instead of graph-output-derived.**
  - Current signals: `packages/cli/src/graph-output.ts` still documents `--access` as mixing
    explicit facts with "legacy guard/auth facts", and `accessDecisions()` calls
    `legacyAccessDecisions()` to fabricate endpoint/page/query/mutation access posture.
  - Refactor shape: require static/runtime graph producers to emit explicit `access` facts for
    every page, query, mutation, endpoint, and webhook. Make `kovo explain --access` render only
    those facts and fail or report a graph-production error when a subject has no explicit fact.
    Remove `legacyAccessDecisions`, `legacy-guard`, and guard/auth inference from the renderer.
  - Risk reduced: access posture becomes an audited fact from the owner of the surface rather than
    a best-effort CLI interpretation of adjacent fields.
  - Verification: an access-legacy `rg` check across CLI/core/drizzle/server returns no matches;
    targeted `kovo explain --access` tests cover pages, queries, mutations, endpoints, webhooks,
    public surfaces, guarded surfaces, and missing-fact failures.

- [ ] **P0.3 - Turn lifecycle surface into an enforced policy discriminant.**
  - Current signals: `packages/server/src/response-posture.ts` accepts
    `surface: 'document' | 'endpoint' | 'mutation' | 'query' | 'system'`, then immediately drops it
    before calling `resolveLifecycleRequest()`.
  - Refactor shape: replace the pass-through options type with a discriminated surface policy:
    query/document get read handles, mutation gets write handles and CSRF/idempotency context,
    raw endpoints receive the ambient-authority-stripped request posture, and system paths cannot
    accidentally inherit app session/cookie/db authority. Keep the shared implementation, but make
    each surface's allowed lifecycle capabilities explicit in types and runtime assertions.
  - Risk reduced: request enrichment cannot silently drift between documents, loaders, mutations,
    and raw endpoints.
  - Verification: focused tests for `app-dispatch`, `query`, `app-mutation-request`, endpoint
    posture, and response finalization prove the per-surface capability set; add a regression test
    that a future unused `surface` field fails.

- [ ] **P0.4 - Replace structured-document global brands with module-private sentinels.**
  - Current signals: `packages/server/src/document-structured.ts` defines
    `documentConfigBrand` and `documentNodeBrand` with `Symbol.for(...) as any`, which makes the
    brand globally forgeable and bypasses the type-level security guidance in `AGENTS.md`.
  - Refactor shape: use module-private `unique symbol` sentinels and validating constructors, or a
    module-private `WeakSet` proof for `DocumentConfig`/`DocumentNode`, so only framework-owned
    structured document primitives can pass `isDocumentConfig()` and `isDocumentNode()`.
  - Risk reduced: userland cannot forge document shell facts by guessing a global symbol key.
  - Verification: document tests show legitimate `Document`, `Head`, `BodyStart`, `BodyEnd`,
    `HtmlAttrs`, and `BodyAttrs` still compose, while objects branded with
    `Symbol.for('kovo.document.config')` or `Symbol.for('kovo.document.node')` are rejected. A
    document-brand `rg` check under `packages/server/src` returns no matches.

- [ ] **P0.5 - Centralize generated semantic attributes and close the `data-bind-list` drift.**
  - Current signals: `packages/test/src/integration/semantic-snapshot.ts` keeps
    `KOVO_SEMANTIC_ATTRS`, `packages/compiler/src/emit/render-equivalence.ts` keeps a private
    `isGeneratedOnlyRenderAttribute()` predicate, and `tests/snapshot-allowlist.meta.test.ts`
    carries a known exception for `data-bind-list`.
  - Refactor shape: create one internal semantic-attribute manifest with categories such as
    generated-only, semantic-snapshot, behavioral, and accessible. Import it from the compiler
    render-equivalence gate and the integration snapshot serializer; remove source-scraping from
    the meta-test and add `data-bind-list` to the generated-only classification when appropriate.
  - Risk reduced: compiler equivalence, semantic snapshots, and meta-tests stop drifting when new
    generated stamps are introduced.
  - Verification: focused snapshot-allowlist and render-equivalence tests pass with no
    known-exception list for `data-bind-list`, and targeted semantic snapshot tests still keep
    intended app-visible attributes.

- [ ] **P0.6 - Type mutation replay and response mapping by delivery mode.**
  - Current signals: `packages/server/src/mutation.ts` now has a lifecycle runner, but
    `noJsReplayStoreFromMutationStore()` still bridges enhanced and no-JS replay stores with
    `as unknown as`, and response rendering still has mode-specific mapping spread around the file.
  - Refactor shape: introduce a typed mutation response-mode model for `enhanced-fragment` and
    `no-js-prg`, with mode-specific replay scopes and a shared outcome-to-response mapper. The
    replay store adapter should preserve the atomic reservation contract without cross-casting
    `BufferedMutationWireResponse` and `NoJsMutationResponse`.
  - Risk reduced: enhanced and no-JS idempotency records cannot be replayed across incompatible
    response shapes by type accident.
  - Verification: mutation replay/idempotency tests cover enhanced success, enhanced conflict,
    no-JS success redirect, no-JS validation failure, duplicate submit, and render-error paths;
    `rg "as unknown as.*Mutation|noJsReplayStoreFromMutationStore" packages/server/src/mutation.ts`
    confirms the unsafe adapter is gone.

## P1 - Shared Maintainability and Drift Removal

- [ ] **P1.1 - Replace gallery demo string rewriting with a module-resolution manifest.**
  - Current signals: `site/src/gallery.ts` rewrites emitted client imports with string
    `replaceAll()` calls for `@kovojs/browser`, `@kovojs/browser/generated`, and
    `@kovojs/headless-ui/internal/primitive`; `examples/gallery/src/interactive-gallery-harness.ts`
    strips imports with regexes and keeps `legacyGeneratedBindingAliases`.
  - Refactor shape: have the compiler or gallery build step emit a client-module import manifest
    describing each generated dependency, then register/resolve those modules through that manifest
    for the site export and test harness. Replace VM string surgery with explicit stubs keyed by
    manifest entries.
  - Risk reduced: gallery/site behavior stops depending on exact emitted import text and old
    handler-name aliases.
  - Verification: gallery compile/artifact/browser tests and site static export tests pass; a
    gallery rewrite `rg` check returns no `legacyGeneratedBindingAliases`,
    `@kovojs/browser/generated`, or `headless-ui/internal/primitive` rewrite dependencies.

- [ ] **P1.2 - Centralize TypeScript compiler API compatibility shims.**
  - Current signals: `packages/compiler/src` repeats `const mutableTs = ts as unknown as
Record<string, unknown>` in `compile.ts`, `style.ts`, `emit/live-target-renderers.ts`, and
    several scanner modules.
  - Refactor shape: add one `ts-api` adapter that owns feature detection and typed wrappers for
    compiler APIs that vary across TypeScript versions. Callers should ask the adapter for
    `getModifiers`, `canHaveModifiers`, `getEffectiveConstraintOfTypeParameter`, or related helpers
    instead of probing `ts` locally.
  - Risk reduced: TypeScript-version compatibility logic becomes testable once instead of being
    copied into every scanner/emitter.
  - Verification: compiler scanner/lowering/style tests pass; a compiler `mutableTs` `rg` check
    returns no matches outside the adapter.

- [ ] **P1.3 - Move `@kovojs/icons` export and pack-input metadata behind generator-owned commands.**
  - Current signals: `packages/icons/package.json` is 8,723 lines, with thousands of generated
    `exports` entries and an enormous literal `build:dist` command listing every icon source.
    `scripts/build-icons.mjs` already derives icon names from `lucide-static`, but the pack command
    remains encoded in package metadata.
  - Refactor shape: keep package exports deterministic, but make `build:dist` delegate to a small
    script or `vp pack` manifest mode that reads the same icon plan as `build-icons`. Ensure the
    generator owns every derived icon list: source files, package exports, publish exports, public
    package API boundary, and pack input paths.
  - Risk reduced: adding/removing a Lucide icon no longer requires reviewing or maintaining a
    multi-thousand-token command line in `package.json`.
  - Verification: `pnpm --filter @kovojs/icons run build:icons -- --check`, the icon generation
    test, `pnpm --filter @kovojs/icons run build:dist`, `pnpm run check:api-surface`, and pack
    security checks pass with a compact `packages/icons/package.json`.

- [ ] **P1.4 - Share data-plane static-analysis resolution between Vite dev and CLI build/export.**
  - Current signals: `packages/server/src/vite.ts` and `packages/cli/src/commands/build-export.ts`
    both resolve `@kovojs/drizzle/internal/static`, both handle query-shape facts, and both use a
    `Symbol.for('kovo.build.queryShapeFacts')` global handoff.
  - Refactor shape: create one internal data-plane static-analysis adapter that owns resolving the
    Drizzle analyzer, deriving query-shape facts, mapping diagnostics into dev/build ledgers, and
    threading facts into compiler invocations. Prefer explicit build context over global symbol
    handoff; if a process-global bridge remains necessary, expose it from one typed module.
  - Risk reduced: dev diagnostics, `kovo check`, `kovo build`, and static export cannot diverge in
    which analyzer or query-shape facts they use.
  - Verification: focused Vite data-plane diagnostic tests, `kovo check` tests, and build/export
    tests pass; a data-plane resolver `rg` check shows Vite and build/export call sites routed
    through the shared adapter.

- [ ] **P1.5 - Create a manifest-backed generated-attribute and generated-artifact policy layer.**
  - Current signals: `scripts/generated-artifacts.mjs` only models app-local generated artifacts
    that must not be committed, while intentionally committed generated sources such as
    `packages/icons/src/*.tsx`, `packages/headless-ui/src/generated.ts`, and registry JSON are
    governed by separate scripts and comments.
  - Refactor shape: extend the generated-artifact inventory to distinguish app-local generated
    output, framework-generated source that must match its generator, and generated package
    metadata. Route `no-committed-generated`, generator drift tests, and import-boundary checks
    through that inventory instead of scattered path rules.
  - Risk reduced: "generated" stops meaning different things in different gates, which lowers the
    chance of accidentally committing app artifacts or missing drift in committed framework output.
  - Verification: `pnpm run check:no-committed-generated`, generator drift tests, and import-boundary
    tests pass with the unified inventory as the source of truth.

## P2 - Cleanup After the Core Slices

- [ ] **P2.1 - Collapse stale UI registry distribution copy into the manifest generator.**
  - Current signals: `packages/ui/registry.json` and `packages/ui/scripts/build-registry.mjs`
    still describe `@kovojs/ui` as a "private package" in generated comments, while the registry
    now declares `distributionMode: "package-and-copy-in"` and docs describe both modes.
  - Refactor shape: move all UI distribution prose into a small generated copy template fed by
    `public-packages.json` and the primitive/component manifest, then regenerate registry comments
    and docs snippets from the same distribution mode.
  - Risk reduced: docs, package metadata, and generated registry copy stop disagreeing about the
    supported UI consumption model.
  - Verification: `node packages/ui/scripts/build-registry.mjs`, `packages/ui/src/copy-in.test.ts`,
    and component guide/API surface checks pass with no "private package" wording in generated UI
    registry metadata.

- [ ] **P2.2 - Extract reusable output-staging primitives for CLI and site builds.**
  - Current signals: static export, build/export, package publishing, site export, and client-module
    registration code each manage paths, versions, cleanup, and partial writes locally.
  - Refactor shape: introduce a small manifest-backed artifact writer with stable path validation,
    content hashing, atomic write/cleanup semantics, and dry-run/check modes. Adopt it first in
    the highest-risk build/export paths, then move site and package generation scripts onto it.
  - Risk reduced: fewer bespoke file-output paths means less risk of stale generated files,
    half-written artifacts, and path traversal mistakes in build tooling.
  - Verification: build/export tests, site static export tests, generator check modes, and
    `git diff --check` pass after each adoption step.
