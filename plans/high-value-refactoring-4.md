# High-value refactoring plan 4

Date: 2026-07-01

This is a fourth-wave read-only audit after `plans/high-value-refactoring.md`,
`plans/high-value-refactoring-2.md`, `plans/high-value-refactoring-3.md`, and most of
`plans/fundamental-fixes.md` were implemented. It incorporates parallel sub-agent review across
compiler/build, server/runtime/security, Drizzle/static analysis/test harness, browser/UI/examples,
and CLI/site/release tooling.

The emphasis is residual structural debt exposed by `plans/fundamental-fixes.md`: spelling-sensitive
recognition, duplicated runtime paths, facts synthesized outside their producer, and framework-owned
provenance represented as forgeable process-global state. Exact bug fixes already tracked in active
bug/papercut ledgers are intentionally not repeated here unless the item names a distinct refactor
that removes the broader source of drift.

## P0 - Correctness and Security Invariants

- [ ] **P0.1 - Remove regex-only data-plane relevance gates and unify app source discovery.**
  - Current signals: `packages/server/src/internal/data-plane-static-analysis.ts` filters Vite data-plane
    sources differently from CLI build/check, and `isBuildSecurityAnalysisSourceFile()` still decides
    whether aggregate Drizzle analysis runs by source regexes over imports, `db`/`tx`, and `sql`
    spellings. If no file passes that prefilter, static facts are empty before the fail-closed analyzer
    can see the project.
  - Refactor shape: create one shared data-plane source discovery helper for extensions, ignored files,
    generated folders, and setup/test exclusions. Make Drizzle relevance analyzer-owned or advisory only:
    either run aggregate analysis over all app source files or return explicit analyzed-file counts and
    unresolved states instead of treating a regex miss as "no data-plane code".
  - Risk reduced: SQL safety, mass assignment, TOCTOU, query-write reachability, touch graph, and output
    schema facts cannot disappear because aliases, wrappers, JS/JSX files, or barrel modules avoided a
    text prefilter.
  - Verification: add JS/JSX and alias/wrapper fixtures; run `pnpm exec vitest --run packages/server/src/internal/data-plane-static-analysis.test.ts packages/server/src/vite-data-plane-gate.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-build.test.ts` and `node scripts/fundamental-fixes-inventory.mjs`.

- [ ] **P0.2 - Move non-Drizzle output schema extraction to one identity-aware producer.**
  - Current signals: `packages/server/src/internal/data-plane-static-analysis.ts` still has its own
    compiler output-schema walker and accepts schema calls only when the receiver is the literal
    identifier `s`, while `packages/compiler/src/scan/query-shape-source.ts` already resolves the
    `@kovojs/server` schema receiver through framework identity.
  - Refactor shape: extract one schema/query-shape parser shared by compiler and server data-plane
    analysis, or route server output-schema extraction through the compiler scanner. It must handle
    import aliases, namespace imports, local re-export barrels, and local shadows consistently.
  - Risk reduced: Vite/build query-shape facts cannot silently miss output schemas that the compiler
    understands, avoiding false KV302/KV410 behavior and stale client binding validation.
  - Verification: add fixtures for `import { s as schema }`, namespace imports, and barrel re-exports;
    run `pnpm exec vitest --run packages/compiler/src/scan/query-shape-source.test.ts packages/compiler/src/scan/mutation-inputs.test.ts packages/server/src/internal/data-plane-static-analysis.test.ts packages/server/src/vite-data-plane-gate.test.ts packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`.

- [ ] **P0.3 - Generate one framework-identity export catalog for compiler, server, and Drizzle.**
  - Current signals: `packages/core/src/internal/framework-identity.ts` and
    `packages/drizzle/src/static/framework-identity.ts` maintain separate canonical module/export
    catalogs and subpath rules for the same framework identities.
  - Refactor shape: introduce a manifest-backed identity catalog with scope tags such as authoring,
    data-plane, rendering, routing, and Drizzle SQL. Generate or consume that catalog from both the
    TypeScript and ts-morph identity adapters.
  - Risk reduced: future public/internal subpath moves cannot create alias/re-export recognition gaps
    between compiler, server, and Drizzle static analysis.
  - Verification: `pnpm exec vitest --run packages/drizzle/src/index.identity-resolver.test.ts packages/compiler/src/scan/query-shape-source.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/server/src/vite-data-plane-gate.test.ts` plus `node scripts/fundamental-fixes-inventory.mjs`.

- [ ] **P0.4 - Make CLI auth/session audits consume producer-owned graph facts.**
  - Current signals: `packages/cli/src/graph-output.ts` has producer-owned access facts, but security
    checks such as unguarded/KV418-style audits still parse guard strings locally through helpers such
    as `unguardedAccesses()`, `hasAuthGuard()`, and session/ownership string classifiers.
  - Refactor shape: move auth/session-authority, unguarded posture, ownership posture, and missing-proof
    facts into core graph/producer facts. The CLI should render and check those facts, not infer policy
    from guard labels or naming conventions.
  - Risk reduced: guard spelling changes cannot make `kovo check`/`kovo explain` fail open or produce
    false positives outside the compiler/server graph producers.
  - Verification: `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts packages/core/src/graph.test.ts packages/compiler/src/registry.test.ts packages/server/src/access-graph.test.ts`.

- [ ] **P0.5 - Make scope audits consume canonical read provenance only.**
  - Current signals: `packages/drizzle/src/static.ts` still lets `QueryFact` carry parallel legacy scope
    fields such as `argScopedReads`, `hasClientArgPredicate`, `sessionAnchoredReads`, and
    `ownerScopedPrivateReadKeys`; `scopeAuditReadProvenance()` falls back to synthesizing provenance
    when `readProvenance` is absent.
  - Refactor shape: require canonical `readProvenance` for every query read fact, explicitly representing
    unknown/unscoped provenance. Delete the legacy synthesizer or quarantine it as a test adapter that
    cannot feed production `kovo check`.
  - Risk reduced: KV414 owner-scope audits become a simple fact-store consumer and cannot be influenced by
    stale shadow fields after the producer model evolves.
  - Verification: add a missing-provenance regression that fails closed; run `pnpm exec vitest --run packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/index.columns-keys-predicates-provenance.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/cli/src/index.kovo-check.test.ts`.

- [x] **P0.6 - Apply SQL side-effect observation to prepared statement execution.**
  - Current signals: `packages/test/src/verifier-observation.ts` gives direct SQL execution unconditional
    side-effect snapshots, while prepared handle execution in `packages/test/src/verifier.ts` observes the
    statement argument but calls `.run()`/`.all()`/`.get()`/`.iterate()` through a separate path.
  - Refactor shape: extract one `observeSqlExecution` path shared by direct and prepared execution, with
    snapshots taken at prepared statement execution time, not only at prepare-time classification.
  - Risk reduced: parser-rejected prepared destructive writes, triggers, and fingerprint-changing effects
    cannot bypass the verifier row-count/fingerprint backstop that direct SQL gets.
  - Verification: add prepared unparseable write and trigger tests; run `pnpm exec vitest --run packages/test/src/verifier.test.ts packages/test/src/sqlite-harness.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sql-observer.test.ts`.
  - Evidence: `pnpm exec vitest --run packages/test/src/verifier.test.ts packages/test/src/sqlite-harness.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sql-observer.test.ts` passed with 4 files/37 tests after building the local `better-sqlite3` native binding; `pnpm run check:vp` and `git diff --check` passed.

- [x] **P0.7 - Centralize trusted request scheme provenance.**
  - Current signals: `packages/server/src/app-document.ts` treats `x-forwarded-proto: https` as enough to
    attach HSTS, while `packages/server/src/node.ts` only trusts forwarded proto when `trustedProxy` is
    configured.
  - Refactor shape: add one internal `trustedRequestScheme()` or transport-provenance helper and thread it
    into document HSTS, configured error shells, adapter request URL construction, CSRF origin checks, and
    secure-cookie decisions.
  - Risk reduced: spoofed proxy headers cannot affect security posture on direct Node deployments, and
    trusted proxy behavior is reviewed in one place.
  - Verification: `pnpm exec vitest --run packages/server/src/app-document.test.ts packages/server/src/document.test.ts packages/server/src/node.test.ts packages/server/src/csrf.test.ts`.
  - Evidence: `pnpm exec vitest --run packages/server/src/app-document.test.ts packages/server/src/document.test.ts packages/server/src/node.test.ts packages/server/src/csrf.test.ts` passed with 4 files/132 tests after merging `agent/hvr4-server-security-20260630-235550`; `git diff --check HEAD^..HEAD` passed.

- [x] **P0.8 - Make stylesheet source provenance unforgeable and root-confined.**
  - Current signals: `packages/server/src/hints.ts` stores stylesheet source metadata with
    `Symbol.for('kovo.stylesheet.source')` and `Symbol.for('kovo.stylesheet.sourcePath')`; neutral build
    materialization consumes that metadata to read local stylesheet files.
  - Refactor shape: replace global-symbol metadata with module-private provenance, such as a `WeakMap` or
    `WeakSet` owned by `stylesheet()`, and root-confine every fallback local source resolution before file
    reads.
  - Risk reduced: app-authored objects cannot forge framework stylesheet metadata to influence neutral
    build file reads or static export asset materialization.
  - Verification: add forged-symbol negative tests; run `pnpm exec vitest --run packages/server/src/hints.test.ts packages/server/src/build.test.ts packages/server/src/static-export-assets.test.ts packages/server/src/neutral-build.test.ts`.
  - Evidence: `pnpm exec vitest --run packages/server/src/hints.test.ts packages/server/src/build.test.ts packages/server/src/static-export-assets.test.ts packages/server/src/neutral-build.test.ts` passed with the 3 existing files/54 tests after merging `agent/hvr4-server-security-20260630-235550`; `packages/server/src/neutral-build.test.ts` does not exist in this checkout, and `git diff --check HEAD^..HEAD` passed.

- [x] **P0.9 - Preserve production render-plan gates in every compile-cache projection.**
  - Current signals: exact compiler cache keys include `productionRenderPlanGate`, but
    `narrowCompileCacheKeyInput()` drops that option when replaying learned dependency footprints;
    persistent cache reuse follows the narrowed path.
  - Refactor shape: add one typed compile-cache projection builder that always preserves compile-affecting
    options such as production render-plan gating while narrowing only fact inputs by prior read sets.
  - Risk reduced: a no-gate compile cannot be reused when KV416/KV435 production render-plan gates are
    enabled, including across persistent cache restarts.
  - Verification: add learned-footprint and persistent-cache regressions; run `pnpm exec vitest --run packages/compiler/src/compile-cache.test.ts packages/compiler/src/persistent-compile-cache.test.ts packages/compiler/src/render-plan-token-contract.test.ts`.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/compile-cache.test.ts packages/compiler/src/persistent-compile-cache.test.ts packages/compiler/src/render-plan-token-contract.test.ts` passed with 3 files/22 tests after merging `agent/hvr4-compiler-20260630-235527`; `git diff --check HEAD^..HEAD` passed.

## P1 - Cross-Package Drift and Runtime Chokepoints

- [ ] **P1.1 - Make source-derived registry assignment table-driven, including tasks.**
  - Current signals: `packages/compiler/src/source-derived-lowering.ts` handles component, domain,
    mutation, query, and webhook assignment helpers, while `assignDerivedTaskKey()` exists in server task
    code but is not exported through `packages/server/src/internal/wire.ts` for the same lowering path.
  - Refactor shape: define one primitive registry-assignment table for identity, call shape, helper import,
    key derivation, and runtime assignment. Either support object-form `task({ ... })` end to end or
    reject it with a clear compiler diagnostic.
  - Risk reduced: the compiler graph cannot prove a task key that runtime app registration later rejects.
  - Verification: `pnpm exec vitest --run packages/compiler/src/registry.test.ts packages/compiler/src/scan/parse.test.ts packages/server/src/app.test.ts packages/server/src/task-runtime.test.ts`.

- [ ] **P1.2 - Centralize runtime registry virtual-module derivation and serialization.**
  - Current signals: server dev derives runtime registry facts and serializes a virtual module in
    `packages/server/src/vite.ts`; CLI production build keeps separate runtime registry types and
    emitter logic in `packages/cli/src/commands/build-export.ts`, even though
    `packages/server/src/registry-facts.ts` now normalizes facts at runtime.
  - Refactor shape: move runtime registry wire schema, fact projection, and module serializer into one
    server-owned internal module consumed by both Vite dev and CLI build/export.
  - Risk reduced: dev and production cannot register different query-read, mutation-touch, or live-target
    facts from the same source project.
  - Verification: `pnpm exec vitest --run packages/server/src/registry-facts.test.ts packages/server/src/vite-data-plane-gate.test.ts packages/cli/src/index.kovo-build.test.ts packages/cli/src/index.kovo-export.test.ts`.

- [ ] **P1.3 - Share untrusted request-body parsing for endpoint CSRF and mutations.**
  - Current signals: `packages/server/src/app-dispatch.ts` says endpoint CSRF parsing mirrors mutation
    parsing, but implements a local JSON/form/urlencoded carrier reader separate from the typed parser in
    `packages/server/src/app-mutation-request.ts`.
  - Refactor shape: extract `readCsrfCarrierFromRequest()` or `readUntrustedRequestBodyForSurface()` with
    typed parse outcomes, then let endpoint CSRF and mutation CSRF map those outcomes to local diagnostics
    and response shapes.
  - Risk reduced: JSON/form/urlencoded/invalid-body handling cannot drift between CSRF-protected endpoint
    and mutation surfaces.
  - Verification: `pnpm exec vitest --run packages/server/src/app-dispatch.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/csrf.test.ts`.

- [ ] **P1.4 - Promote query cache posture to a compiler-owned graph fact.**
  - Current signals: `packages/server/src/query.ts` intentionally keeps declared public query cache posture
    private until compiler session-independence metadata exists, and tests pin the fail-closed behavior.
  - Refactor shape: add a `QueryCachePostureFact` carrying `sessionIndependent: true | false | unresolved`
    through compiler registry facts, core graph, and runtime registry. Allow declared public cache headers
    only when the producer proves session independence.
  - Risk reduced: future cache relaxations cannot trust `publicAccess` or `read.cacheControl` alone for
    shared-cache safety.
  - Verification: `pnpm exec vitest --run packages/compiler/src/registry.test.ts packages/core/src/graph.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/app.test.ts`.

- [ ] **P1.5 - Unify document, query, mutation, system, and webhook header floors.**
  - Current signals: response finalization is centralized, but header floors still live in branch-local
    modules such as `document-core.ts`, `app-system-response.ts`, `query.ts`, mutation wire handling, and
    webhook/capability routes.
  - Refactor shape: introduce a typed `framework-response-floor` module for document success, guard
    failure, per-principal route outcomes, query wire, mutation wire, system/error, capability, and webhook
    responses. Surface-specific code supplies posture facts; the shared module owns cache, `Vary`, HSTS,
    CSP/reporting, `nosniff`, and related floors.
  - Risk reduced: security-header and cache-posture fixes cannot land on one branch while equivalent
    response branches remain stale.
  - Verification: `pnpm exec vitest --run packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/response-posture.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/capability-route.test.ts packages/server/src/webhook.test.ts`.

- [ ] **P1.6 - Collapse browser document recovery into the canonical query refetch runtime.**
  - Current signals: `packages/browser/src/document-lifecycle.ts` owns its own `/_q` fetch, build-skew
    reload, raw string wire detection, live-target fragment synthesis, and global listener path instead
    of consuming the modular query refetch/runtime helpers.
  - Refactor shape: extract one document recovery runtime used by both inline and modular loaders,
    including query URL construction, build-token handling, live-target parsing, wire-protocol detection,
    and disposal.
  - Risk reduced: stale-query and build-skew recovery cannot diverge between inline loader and modular
    runtime paths.
  - Verification: `pnpm exec vitest --run packages/browser/src/query-refetch.test.ts packages/browser/src/query-visible-return-refetch.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/inline-loader-parser-parity.test.ts packages/browser/src/inline-loader-build.test.ts`.

- [x] **P1.7 - Scope clock tick scheduling per loader or owner document.**
  - Current signals: `packages/browser/src/clock-tick-bus.ts` stores subscriptions, interval state,
    animation-frame state, and visibility/page listeners as package-level singletons consumed by
    `loader-query.ts`.
  - Refactor shape: introduce a `ClockScheduler` created per loader root or owner document. Preserve
    coalescing within a scheduler, but avoid cross-app mutable singleton state.
  - Risk reduced: multiple Kovo apps in one JS realm, embedded documents, and test environments cannot
    leak timers/listeners or visibility behavior into each other.
  - Verification: `pnpm exec vitest --run packages/browser/src/clock-tick-bus.test.ts packages/browser/src/loader-query.test.ts packages/compiler/src/query-coverage.test.ts examples/gallery/src/interactive-gallery.compile.test.ts`.
  - Evidence: `pnpm exec vitest --run packages/browser/src/clock-tick-bus.test.ts packages/browser/src/loader-query.test.ts packages/compiler/src/query-coverage.test.ts examples/gallery/src/interactive-gallery.compile.test.ts` passed with 4 files/52 tests after merging `agent/hvr4-browser-runtime-20260630-235736`; `git diff --check HEAD^..HEAD` passed.

- [x] **P1.8 - Share core, UI, and headless safe-URL policy.**
  - Current signals: `packages/ui/src/safe-url.ts` and `packages/headless-ui/src/lib/safe-url.ts` maintain
    local scheme allowlists that already differ from core security URL expectations.
  - Refactor shape: route UI and headless safe URL handling through one core/internal URL sink helper, with
    package adapters only for rendering shape and diagnostics.
  - Risk reduced: anchor-like primitives cannot drift from framework URL sink policy when allowed schemes
    or sanitization rules change.
  - Verification: `pnpm exec vitest --run packages/core/src/security-url.test.ts packages/headless-ui/src/lib/safe-url.test.ts packages/ui/src/breadcrumb.test.tsx packages/ui/src/navigation-menu.test.tsx` plus `pnpm run check:api-surface`.
  - Evidence: `pnpm exec vitest --run packages/core/src/security-url.test.ts packages/headless-ui/src/lib/safe-url.test.ts packages/ui/src/breadcrumb.test.tsx packages/ui/src/navigation-menu.test.tsx` passed with 4 files/19 tests; `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check` passed in `/Users/mini/kovo-high-value-refactoring-4-20260630-235424`.

## P2 - Gate Quality and Artifact Ownership

- [ ] **P2.1 - Compile authored docs snippets against real workspace exports by default.**
  - Current signals: `site/scripts/code-snippets-check.mjs` builds a scratch project with broad `any` stubs
    for framework packages, while generated API examples already use real workspace package declarations.
  - Refactor shape: compile normal authored snippets against real workspace exports. Require explicit
    per-snippet metadata for intentionally partial examples that need stubs.
  - Risk reduced: docs examples cannot pass after public exports, types, or package subpaths drift.
  - Verification: add negative tests for stale public API examples; run `pnpm --filter @kovojs/site run content` and `pnpm --filter @kovojs/site exec vitest --run scripts/code-snippets-check.test.mjs`.

- [ ] **P2.2 - Share one confined static-site request resolver across link and smoke gates.**
  - Current signals: `site/scripts/check-links.mjs`, `site/scripts/smoke.mjs`, and
    `site/scripts/navigation-smoke.mjs` resolve static paths locally, while `site/scripts/serve-static.mjs`
    already has safer root confinement and request handling.
  - Refactor shape: add a shared `resolveSiteStaticRequest()` and test server used by link checks, smoke
    scripts, navigation smoke, and local static serving.
  - Risk reduced: static export gates cannot disagree with the server that serves the same `dist`, and
    path traversal/MIME/cache behavior is tested once.
  - Verification: `pnpm --filter @kovojs/site exec vitest --run scripts/serve-static.test.mjs scripts/export-static.test.mjs`; then `pnpm --filter @kovojs/site run build`, `pnpm --filter @kovojs/site run check:links`, and `pnpm --filter @kovojs/site run smoke:navigation`.

- [ ] **P2.3 - Let site export consume structured export results instead of CLI text.**
  - Current signals: `site/scripts/export-static.mjs` calls `runKovoCommand()`, monkey-patches stdout/stderr,
    and reconstructs counts from printed line prefixes, while CLI build/export has structured result data
    before formatting it for the terminal.
  - Refactor shape: expose an internal structured command result or direct `runExportCommand` data path for
    site export. Keep human text formatting at the CLI/bin edge.
  - Risk reduced: site export diagnostics and counts do not break when CLI output text changes, and async
    stream capture cannot cross-contaminate concurrent script work.
  - Verification: `pnpm exec vitest --run site/scripts/export-static.test.mjs packages/cli/src/index.kovo-export.test.ts packages/cli/src/index.kovo-build.test.ts`; `pnpm --filter @kovojs/site run build`.

- [x] **P2.4 - Make release published-state checks fail closed on registry errors.**
  - Current signals: `scripts/verify-release-input.mjs` and `scripts/publish-packed-packages.mjs` both
    collapse `npm view` failures into "not published", making 404, auth, network, and registry failures
    indistinguishable.
  - Refactor shape: add one npm registry helper returning `published | missing | error`. Only E404 is
    "missing"; other errors block publish unless an explicit dry-run or emergency override is used.
  - Risk reduced: partial-release and retry behavior cannot proceed on ambiguous registry state.
  - Verification: add helper tests plus focused verify/publish tests; run `pnpm run check:publish`, `pnpm run check:supply-chain`, and release dry-run commands.
  - Evidence: `pnpm exec vitest --run scripts/npm-registry-state.test.mjs scripts/verify-release-input.test.mjs scripts/publish-packed-packages.test.mjs` passed with 3 files/10 tests after merging `agent/hvr4-release-registry-20260630-235800`; `pnpm run check:publish`, `pnpm run check:supply-chain`, and `git diff --check HEAD^..HEAD` passed.

- [ ] **P2.5 - Retire or generate devtool example data snapshots.**
  - Current signals: `examples/devtool/src/app-shell.ts` and `examples/devtool/scripts/conformance.mjs`
    derive bundles from sibling examples' generated graphs, while committed `examples/devtool/data/*.json`
    snapshots appear unowned and the conformance script is not wired into package scripts.
  - Refactor shape: delete the static snapshots if they are unused, or make them generated artifacts with
    a `--check` mode wired into `examples/devtool/package.json`.
  - Risk reduced: devtool demos and debugging fixtures cannot drift from current generated graph/source
    facts.
  - Verification: `pnpm --filter @kovojs/example-devtool run test`, `node examples/devtool/scripts/conformance.mjs`, and a generated-data check if the snapshots remain.
