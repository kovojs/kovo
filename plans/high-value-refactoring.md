# High-Value Refactoring Opportunities

**Date:** 2026-06-30
**Scope:** read-only multi-agent audit across core/runtime, compiler/browser, data/auth,
UI/style/icons, and tooling/test/docs infrastructure.

This is an implementation ledger for refactors that remove duplicated invariants, turn advisory
"source of truth" files into executable source of truth, and reduce correctness/security drift across
package boundaries. `SPEC.md` remains normative; `rules/` still governs package, compiler, workflow,
docs, and API-surface changes. This file records opportunities, not completed work.

Mark an item `[x]` only after the same session implements the refactor and records concise verification
evidence under that item. For cross-package items, do not rely on a package-local unit suite alone; add
or run a contract test that crosses the boundary being de-duplicated.

## Ranking

P0 items remove security-sensitive or stale-UI-sensitive duplicated behavior. P1 items make package
contracts and generated artifacts materially harder to drift. P2 items reduce public-surface sprawl,
test brittleness, and distribution confusion.

## P0 - Security And Freshness Source Of Truth

- [ ] **P0.1 - Unify mutation execution into a single lifecycle state machine.**
  - Affected: `packages/server/src/mutation.ts`,
    `packages/server/src/app-mutation-request.ts`, `packages/server/src/mutation/*`.
  - Why high value: CSRF validation, body parsing, arg-aware guards, replay reservation,
    stale-version handling, handler execution, failure rendering, enhanced responses, and no-JS
    document/redirect outcomes are currently spread across multiple paths. Any future fix can land in
    one path and miss another.
  - Refactor shape: introduce an internal `executeMutationLifecycle()` that returns typed phase
    outcomes such as `csrfFailure`, `parseFailure`, `guardFailure`, `replayed`, `reserved`,
    `handlerResult`, and `renderResult`. Enhanced, direct, and no-JS paths should only map lifecycle
    outcomes into their wire/document formats.
  - Risk reduced: inconsistent CSRF/parse/guard/replay ordering, double-running stateful guards,
    replaying non-replayable failures, divergent stale-version handling, and JS/no-JS behavior drift.
  - Verification: table-driven parity tests for enhanced/no-JS/direct mutation paths covering invalid
    CSRF, invalid body, guard revocation after replay, stale token, rate limit, handler throw, render
    throw, streaming success/error; run `packages/server/src/mutation*.test.ts`,
    `packages/server/src/app-mutation-request.test.ts`, and replay tests.
  - SPEC: sections 6.3, 6.6, 9.1, 10.3, 11.1.

- [ ] **P0.2 - Centralize request lifecycle and response posture finalization.**
  - Affected: `packages/server/src/app-dispatch.ts`, `app-document.ts`,
    `app-mutation-request.ts`, `query.ts`, `endpoint.ts`, `response.ts`, `app-request.ts`.
  - Why high value: route, query, mutation, endpoint, document, and system responses each set cache,
    `Vary`, build-token, CSP, redirect, HEAD/304, and ambient-authority posture in local code. Raw
    endpoint posture verification is partly audit-mode, while request context construction differs by
    surface.
  - Refactor shape: add `response-posture.ts` with explicit posture variants for `document`, `query`,
    `mutation`, `endpoint`, `system`, and route outcomes. Add
    `resolveSurfaceLifecycleRequest(surface, ...)` with variants for route, query,
    CSRF-protected mutation, CSRF-exempt mutation, endpoint, and client-module requests. Endpoint and
    CSRF-exempt ambient-authority stripping should live in one policy module. Endpoint declared posture
    should be enforced by a finalizer in production, not only verified in dev/audit modes.
  - Risk reduced: missing `Cache-Control: private, no-store`, missing build tokens, unblessed
    redirects, endpoint success/error posture mismatch, HEAD/304 body divergence, wrong DB/session/IP
    context, and accidental cookie authority on exempt surfaces.
  - Verification: response matrix tests across route HTML, file/stream, query success/error/redirect,
    mutation success/failure, endpoint success/error, normalization redirect, and HEAD; lifecycle
    tests asserting exact `session`, `db`, `clientIp`, `args`, and cookie visibility per surface.
  - SPEC: sections 5.2.1, 6.6, 9.1, 9.4, 9.5, 10.3.

- [ ] **P0.3 - Make contextual output safety one cross-package policy plus branded fragment sinks.**
  - Affected: `packages/core/src/internal/sink-policy.ts`,
    `packages/compiler/src/output-context-facts.ts`,
    `packages/compiler/src/security/output-context.ts`,
    `packages/compiler/src/emit/client.ts`, `packages/browser/src/security-output.ts`,
    `packages/browser/src/response-fragment-apply.ts`, `packages/server/src/wire-html.ts`,
    `packages/server/src/html.ts`, `packages/server/src/mutation/streaming.ts`,
    `packages/server/src/mutation/targets.ts`.
  - Why high value: compiler KV236 validation, server rendering, browser query updates, morph
    adoption, inline loader snippets, and fragment wire sinks all encode overlapping URL/raw HTML/event
    and style policy. Some paths use richer classification than others. Separately,
    `renderFragmentWireHtml({ html: string })` accepts raw strings at a privileged patch sink.
  - Refactor shape: promote a compact canonical sink-policy classification API from `@kovojs/core`
    that distinguishes static and runtime families; generate inline-loader and emitted-client guard
    snippets from those facts. Introduce `FragmentHtml`/`RenderedFragmentHtml` as an internal
    capability minted by JSX renderers, trusted HTML sanitizers, or compiler-owned render functions;
    fragment wire sinks should accept only that capability plus narrow audited test/generated escapes.
  - Risk reduced: XSS policy drift between compiler and runtime, unsafe URL/event/style adoption in one
    surface, raw-string fragment insertion, and inconsistent escaping between full documents, fragments,
    streamed text, and error boundaries.
  - Verification: sink drift tests plus `packages/compiler/src/output-context-security.test.ts`,
    `packages/compiler/src/server-emit-security.test.ts`,
    `packages/browser/src/security-output.test.ts`,
    `packages/browser/src/inline-loader-security.test.ts`,
    `packages/browser/src/inline-loader-trusted-types-routing.test.ts`; type tests that raw strings
    cannot reach fragment sinks; runtime tests for trusted HTML, generated component HTML, streaming
    fragments, and malicious fragment content.
  - SPEC: sections 2, 4.8, 5.2 rule 10, 6.6, 9.1.

- [ ] **P0.4 - Replace generated query-update helper duplication with one runtime VM and one keyed reconciler core.**
  - Affected: `packages/compiler/src/emit/client.ts`,
    `packages/compiler/src/analyze/query-updates.ts`,
    `packages/browser/src/query-bindings.ts`, `query-apply.ts`, `morph.ts`,
    `response-fragment-apply.ts`.
  - Why high value: compiler-emitted client modules currently embed a simplified update-plan helper that
    overlaps with browser runtime behavior. Keyed reconciliation also exists in structural morph, DOM
    morph, template stamps, fragment application, and inline-loader helpers with small differences.
  - Refactor shape: define a generated-safe query-update-plan VM ABI in `@kovojs/browser/generated`.
    The compiler emits plan data and selectors, not a second hand-maintained runtime. Extract a keyed
    reconciliation kernel with adapters for DOM children, structural trees, template-stamp rows, and
    inline/minified output; keep focus/selection/scroll preservation in DOM adapters.
  - Risk reduced: stale UI from update-plan drift, missing boolean/property/dialog/template behaviors in
    emitted helpers, row identity bugs, state loss, focus/caret regressions, duplicate-key drift, and prod
    delta mismatch.
  - Verification: compiler/browser contract tests that compile TSX and execute emitted plans through both
    modular runtime and inline-loader runtime; `packages/compiler/src/query-coverage.test.ts`,
    `packages/compiler/src/compile-component.test.ts`,
    `packages/browser/src/query-bindings.browser.test.ts`,
    `packages/browser/src/mutation-response-dom.test.ts`,
    `packages/browser/src/morph.test.ts`,
    `packages/browser/src/response-fragment-apply.browser.test.ts`, plus keyed reorder/insert/remove
    property tests.
  - SPEC: sections 4.4, 4.7, 4.8, 4.9, 5.2, 9.1, 9.1.1, 13.2.

- [ ] **P0.5 - Consolidate Drizzle static analysis into one fact pipeline and reuse symbol provenance for SQL safety.**
  - Affected: `packages/drizzle/src/static.ts`,
    `packages/drizzle/src/static/project-setup.ts`,
    `packages/drizzle/src/static/summaries.ts`,
    `packages/drizzle/src/static/query-shapes.ts`,
    `packages/drizzle/src/static/derivation.ts`,
    `packages/drizzle/src/static/symbol-provenance.ts`,
    `packages/drizzle/src/sql-safety-static.test.ts`.
  - Why high value: SPEC section 11.1 depends on consistent read/write/touch extraction. The package has
    a shared project extraction path, but individual pass entrypoints still encode overlapping table,
    receiver, session, query, write, SQL, and provenance facts. SQL text safety also has a separate
    lattice from the newer symbol-provenance machinery.
  - Refactor shape: introduce a `DrizzleAnalysisContext`/`FactStore` that materializes table facts,
    receivers, query facts, write calls, provenance, relation metadata, and session facts once. Per-pass
    APIs become projections over the store. Model SQL text safety as a consumer of shared
    `SymbolProvenance`, with SQL-specific sinks and allowlisted constructors layered on top.
  - Risk reduced: alias/provenance gaps where one pass recognizes a construct and another silently punts
    or accepts it; request-derived SQL text slipping through helper aliases, destructuring, namespace
    imports, or partially summarized values.
  - Verification: parity tests proving `extractStaticBuildAnalysisFactsFromProject()` equals the
    composition of individual projections; KV422 tests for helper returns, destructured request values,
    namespace imports, `sql.join`, and allowlist laundering; run `packages/drizzle/src`,
    `conformance/drizzle-pin`, and `packages/conformance-fixtures/src`.
  - SPEC: sections 2, 6.6, 10.1, 10.2, 10.3, 10.5, 11.1, 11.2, 11.3.

- [x] **P0.6 - Move wire JSON and module-reference parsing to structured core contracts.**
  - Affected: `packages/server/src/wire-html.ts`, `packages/server/src/query.ts`,
    `packages/server/src/document-core.ts`, `packages/browser/src/wire-parser.ts`,
    `packages/browser/src/query-bindings.ts`, `packages/browser/src/dynamic-import-url.ts`,
    `packages/compiler/src/emit/server-render.ts`, `packages/compiler/src/emit/client.ts`,
    `packages/compiler/src/lower/handlers.ts`.
  - Why high value: server-side wire JSON tags manually mirror browser revivers, and handler/derive refs
    rely on repeated `url#export` parsing/formatting plus `/c/__v/...` dynamic-import checks. These are
    central to the "wire is the documentation" contract and to safe lazy handler loading.
  - Refactor shape: move wire JSON tag constants, encoder, decoder types, and round-trip corpus into
    `@kovojs/core/internal/wire-json`. Add a `KovoModuleRef` parser/formatter with structured
    `{ url, exportName, kind }` facts, consumed by compiler emit and browser loaders; format refs only at
    the final wire edge.
  - Risk reduced: server/browser JSON tag drift, Date/bigint degradation, malformed ref handling, unsafe
    dynamic imports, and mismatch between emitted handler refs and loader resolution.
  - Verification: shared codec corpus for primitives, Date, invalid Date, bigint, arrays, nested records,
    query deltas, document query scripts, and `/_q/`; `packages/browser/src/dynamic-import-url.test.ts`,
    `packages/browser/src/inline-loader-delegated.test.ts`,
    `packages/compiler/src/handler-lowering.test.ts`, and compiler conformance diagnostics.
  - Evidence: `pnpm exec vitest run packages/core/src/internal/wire-json.test.ts packages/core/src/internal/module-ref.test.ts packages/browser/src/json.test.ts packages/browser/src/dynamic-import-url.test.ts packages/browser/src/query-bindings.test.ts packages/browser/src/inline-loader-delegated.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/query-bindings.test.ts packages/server/src/wire-html.test.ts packages/server/src/static-export-client-module-refs.test.ts`, `pnpm run check:api-surface`, and `pnpm run check:imports` pass after moving wire JSON and module refs into core contracts.
  - SPEC: sections 4.3, 4.4, 4.7, 6.1, 9.1.1, 9.4, 9.5.

## P1 - Cross-Package Contract Drift And Generation

- [ ] **P1.1 - Add a typed compiler fact ledger and finish post-parse typed-fact cleanup.**
  - Affected: `packages/compiler/src/lowering-pipeline.ts`,
    `packages/compiler/src/model-pipeline.ts`, `packages/compiler/src/compile-result.ts`,
    `packages/compiler/src/app-graph.ts`, `packages/compiler/src/style.ts`,
    `rules/compiler-hard-rules.md`.
  - Why high value: the compiler pass list is now declarative, but pass outputs are still partly
    threaded as named side products and app graph assembly manually merges fact classes. Active compiler
    refactoring notes also call out remaining decision-shaped source/text use in `app-graph.ts` and
    `style.ts`.
  - Refactor shape: introduce a `CompileFactLedger` with typed append/merge rules per fact family, pass
    ownership metadata, and snapshot hashing. Extend scanner/model facts for clock summaries, style
    dynamic condition structure, and expression summaries; then widen the hard-rule guard to include
    `app-graph.ts` and `style.ts`.
  - Risk reduced: missing fact propagation, stale HMR/cache keys, graph/check drift, and string/regex
    decisions in provenance-sensitive phases.
  - Verification: `packages/compiler/src/lowering-pipeline.test.ts`,
    `packages/compiler/src/hmr-impact.test.ts`, `packages/compiler/src/cache-identity.test.ts`,
    style tests, app graph/registry tests, compiler conformance, golden output, and fact-hash snapshots.
  - SPEC: sections 1.3, 5.2 rule 10, 9.1, 11.3.

- [ ] **P1.2 - Normalize runtime generated registry facts once.**
  - Affected: `packages/server/src/app.ts`, `packages/server/src/mutation.ts`,
    `packages/server/src/app-mutation-request.ts`,
    `packages/server/src/mutation/targets.ts`, generated query/mutation registries.
  - Why high value: generated reads, touches, live-target renderer queries, and app-level query
    definitions are merged in multiple layers. This is stale-UI-sensitive because one dispatch path can
    rerun the right query while another misses it.
  - Refactor shape: create `RuntimeRegistryFacts`/`registry-facts.ts` owning generated mutation touches,
    generated query reads, app query registry, live-target renderer queries, and dedupe rules.
    `createApp`, mutation dispatch, query endpoint, and target selection consume the normalized value.
  - Risk reduced: under-invalidating queries, duplicate query keys with different reads, live target
    renderers missing query definitions, and registry behavior depending on dispatch path.
  - Verification: tests where facts arrive through live targets, app queries, generated mutation
    registries, and duplicate keys; assert identical rerun/fragment selection for enhanced mutation,
    no-JS failure rerender, and query endpoint paths.
  - SPEC: sections 1.2, 4.1, 6.1, 9.1, 10.2, 10.3.

- [x] **P1.3 - Replace static-export string scans with parsed protocol extraction.**
  - Affected: `packages/server/src/static-export-document.ts`,
    `packages/server/src/static-export-response.ts`,
    `packages/server/src/static-export-route-plan.ts`, related static export diagnostics.
  - Why high value: static export correctness depends on detecting server-only endpoints, client-module
    refs, deferred markers, redirects, unsafe paths, and cookie-like artifacts. Some checks operate on
    raw body strings or simple marker searches.
  - Refactor shape: add an HTML/protocol scanner that parses elements and attributes, then emits a typed
    artifact containing endpoint refs, client-module refs, deferred markers, query scripts, mutation
    forms, and server-only protocol markers. Static export checks consume that artifact.
  - Risk reduced: false negatives from quoting/case/entity variations, false positives in code/pre
    examples, static export of non-L0/L1 interactions, and duplicated export diagnostics.
  - Verification: fixture corpus for quoted/unquoted attrs, entities, uppercase tags, `<template>`,
    `<pre>`, mutation forms, client modules, deferred fragments, endpoint refs, and malicious encoded
    paths; rerun static export test suites.
  - Evidence: `pnpm exec vitest --run packages/server/src/static-export-protocol.test.ts packages/server/src/static-export-document.test.ts packages/server/src/static-export-response.test.ts packages/server/src/static-export-client-module-refs.test.ts packages/server/src/static-export-endpoints.test.ts packages/server/src/static-export-route-plan.test.ts packages/server/src/static-export-assets.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export-replay.test.ts` passes with parsed static-export protocol facts.
  - SPEC: sections 9.1, 9.5, KV229.

- [x] **P1.4 - Replace Better Auth schema string surgery with structured codegen.**
  - Affected: `packages/better-auth/src/internal.ts`,
    `packages/better-auth/src/index.schema-materialize.test.ts`,
    `conformance/better-auth-pin/src/index.plugin-tables.test.ts`.
  - Why high value: Better Auth schema annotation/materialization manipulates TypeScript source as
    strings, which is fragile around imports, existing config, aliases, dialect differences, and plugin
    schemas.
  - Refactor shape: parse schema files structurally, identify Drizzle table declarations, materialize a
    small schema declaration IR, and generate Postgres/SQLite variants from one field-mapping table.
  - Risk reduced: malformed schema output, missed annotations, duplicate imports, physical table alias
    drift, and hidden plugin schema changes.
  - Verification: existing materialization tests plus idempotence, alias/import collision, plugin-table,
    and SQLite generation cases.
  - Evidence: `pnpm exec vitest --run packages/better-auth/src/index.schema-materialize.test.ts packages/better-auth/src/index.schema-bridge.test.ts` and `pnpm --filter @kovojs/conformance-better-auth-pin test -- src/index.plugin-tables.test.ts` pass after the structured schema IR/codegen refactor.
  - SPEC: sections 1.3, 4.8, 10.1, 11.2.

- [ ] **P1.5 - Make Better Auth operation contracts, graph facts, and cookie forwarding single-source.**
  - Affected: `packages/better-auth/src/internal.ts`,
    `packages/better-auth/src/mutations.ts`, `packages/better-auth/src/mount.ts`,
    `packages/better-auth/src/credential-options.ts`,
    `packages/better-auth/src/internal/credential.ts`, `packages/better-auth/src/session.ts`,
    `packages/server/src/cookies.ts`.
  - Why high value: Better Auth credential operations keep declared table touches and domain touches
    separately, then validate they match. Cookie forwarding is security-sensitive and adapter-local,
    while auth helpers are also where `csrf:false`, ambient sessions, provider redirects, and credential
    mutations meet.
  - Refactor shape: define one `BetterAuthOperationContract` per API and derive mutation registry
    domains, touch graph entries, verifier config, and explain facts from schema bridge resolution. Have
    auth mutation/endpoint helpers emit explicit graph facts for `csrf`, `access`, auth scheme, and
    touches. Add a server-owned `forwardSetCookie(raw, posture)` internal API that preserves upstream
    cookie names and attributes while enforcing Kovo's credential-cookie floor.
  - Risk reduced: stale UI from under-declared auth writes, over-broad invalidation, KV406/KV418/KV436
    gaps, misleading `kovo explain --endpoints`, cookie corruption, dropped CHIPS attributes, and
    insecure downgrades.
  - Verification: observed-write tests proving tables are covered by contract tables and generated
    domains match bridge domains; conformance tests for `csrf:false`, guarded mutations, and `mount()`
    explain output; cookie tests for folded cookies, `Expires`, `Partitioned`, `Priority`,
    `SameSite=None`, deletion cookies, session refresh, and sign-out clearing.
  - SPEC: sections 6.5, 6.6, 9.1, 9.1.1, 10.1, 10.3, 11.2, 11.3.

- [x] **P1.6 - Make CLI and API tooling manifests executable sources of truth.**
  - Affected: `packages/cli/src/index.ts`,
    `packages/cli/src/commands-manifest.ts`, `site/scripts/cli-ref.mjs`,
    `scripts/api-surface-gate.mjs`, `scripts/exported-symbols.mjs`,
    `scripts/build-publish.mjs`, `site/scripts/api-ref.mjs`,
    `scripts/import-boundary.mjs`.
  - Why high value: command dispatch, command docs, package export resolution, API gates, duplicate
    symbol checks, publish verification, API reference generation, and import-boundary enforcement each
    have local interpretations of public contracts. Some "single source of truth" metadata currently
    informs docs but does not drive dispatch/enforcement.
  - Refactor shape: define one command registry with parser, handler, sync/async mode, usage/help, and
    list-label metadata; use it from `main`, `mainAsync`, docs, no-args, and unknown-command output.
    Create one package-export resolver for conditional exports/bins/source/type entries and TS-program
    construction. Replace regex import-boundary scanning with syntax-aware JS/TS collectors and markdown
    code-fence parsing.
  - Risk reduced: command/docs drift, missing async routing, false API-gate greens/failures, docs
    showing non-enforced exports, forbidden imports slipping through multiline/type-only/dynamic import
    forms, and noisy false positives from prose.
  - Verification: drift tests asserting all dispatched commands are registry-defined; CLI docs/sidebar
    snapshots; package-export table fixtures for string/conditional exports and precedence; existing
    API-surface, api-ref, exported-symbols, and build-publish tests; import-boundary fixtures for
    `export type`, multiline imports, dynamic imports, comments, string literals, markdown fences, and
    stale exceptions.
  - Evidence: `pnpm exec vitest --run packages/cli/src/commands-manifest.test.ts site/scripts/cli-ref.test.mjs scripts/package-exports.test.mjs scripts/import-boundary.test.mjs scripts/api-surface-gate.test.mjs scripts/exported-symbols.test.mjs site/scripts/api-ref.test.mjs --reporter=verbose`, `pnpm run check:api-surface`, and `pnpm run check:imports` pass with command and package-export registries driving dispatch/docs/tooling.
  - SPEC/rules: `SPEC.md` sections 5.2 rules 8 and 10, 11.4; `rules/api-surface.md`.

- [ ] **P1.7 - Extract shared headless UI collection and openable-state cores.**
  - Affected: `packages/headless-ui/src/primitives/select.ts`,
    `autocomplete.ts`, `dropdown-menu.ts`, `navigation-menu.ts`, `combobox.ts`,
    `context-menu.ts`, `menubar.ts`, `command.ts`, `accordion.ts`, `tabs.ts`,
    `toolbar.ts`, `radio-group.ts`, `toggle-group.ts`, `checkbox-group.ts`,
    `dialog.ts`, `alert-dialog.ts`, `popover.ts`, `hover-card.ts`, `tooltip.ts`,
    `collapsible.ts`, `disclosure.ts`.
  - Why high value: roving focus, typeahead, disabled item handling, orientation/dir/loop movement, and
    cancelable open/close state transitions are reimplemented across the most correctness-sensitive UI
    primitives.
  - Refactor shape: add internal `collection-controller` utilities that project items and compute
    normalized move/typeahead results. Add `setOpenState`/`toggleOpenState` utilities with strategy hooks
    for dialog invoker, pointer/focus triggers, `beforetoggle`, modal/non-modal behavior, and
    `onOpenChange` cancellation.
  - Risk reduced: inconsistent Arrow/Home/End/typeahead behavior, disabled item drift, ARIA divergence,
    and one primitive honoring `defaultPrevented` or open-change callbacks differently than another.
  - Verification: shared unit matrices across primitive families; rerun headless primitive tests and
    gallery browser suites for dialog, popover, hover-card, tooltip, menu, select, tabs, toolbar, and
    command surfaces.
  - SPEC: section 4.6.

- [ ] **P1.8 - Replace UI/headless/gallery/copy-in registries with one generated manifest.**
  - Affected: `packages/headless-ui/src/generated.ts`,
    `packages/ui/scripts/build-registry.mjs`, `packages/ui/registry.json`,
    `examples/gallery/src/primitive-actions.ts`, `examples/gallery/src/demo-fixtures.tsx`,
    `examples/gallery/src/component-catalog.ts`,
    `examples/gallery/src/interactive-gallery.browser-fixtures.ts`.
  - Why high value: adding or renaming a primitive/component currently requires hand-syncing handler ABI
    exports, gallery routes, browser fixtures, copy-in metadata, and public/demo catalogs.
  - Refactor shape: create one primitive/component manifest that emits headless handler ABI exports,
    gallery route/catalog data, browser fixture imports, and UI copy-in metadata. Generator output should
    be round-trip checked.
  - Risk reduced: drift between public API, generated handlers, demos, browser fixtures, and CLI copy-in
    behavior.
  - Verification: generator round-trip tests, existing parity tests, fixture-count assertions, gallery
    artifact tests, and `packages/ui/src/copy-in.test.ts`.
  - Rules: `rules/api-surface.md`.

- [ ] **P1.9 - Build cross-package oracle fixtures for compiler/browser/runtime/data contracts.**
  - Affected: `packages/compiler/src/test-support.ts`,
    `packages/compiler/src/diagnostic-coverage-matrix.data.ts`,
    `packages/browser/src/inline-loader-response-apply-fixture.ts`,
    `packages/browser/src/wire-response-scanner.ts`,
    `packages/conformance-fixtures/src/*`,
    `conformance/drizzle-pin`, `conformance/better-auth-pin`.
  - Why high value: many tests assert compiler output, generated client helpers, browser runtime,
    inline loader, data graph extraction, and auth fixtures separately. The highest-risk regressions live
    at the boundaries.
  - Refactor shape: add oracle fixtures that compile small TSX inputs, extract emitted query plans,
    refs, fragments, and graph facts, then execute them through modular browser runtime, inline-loader
    runtime, and runtime verifier paths. Add fixture builders for schema tables, domains, queries,
    mutations, Better Auth metadata, and expected graph facts.
  - Risk reduced: false confidence from isolated snapshots that do not execute emitted runtime
    contracts, brittle duplicated source-string conformance fixtures, and missing dialect/auth coverage.
  - Verification: new `compiler-browser-contract.test.ts`-style suite; fixture package tests; Drizzle and
    Better Auth pin suites; existing compiler conformance, render-equivalence, inline-loader parity, and
    browser DOM tests.
  - SPEC: sections 1.3, 4.4, 4.8, 5.2, 9.1, 10, 11.1, 11.2.

## P2 - Public Surface, Distribution, And Test Harness Hygiene

- [ ] **P2.1 - Make `create-kovo` starter tests prove published package shape.**
  - Affected: `packages/create-kovo/src/index.test-support.ts`,
    `packages/create-kovo/src/index.build.test.ts`, `scripts/link-local-kovo.mjs`,
    publish/package scripts.
  - Why high value: starter integration tests mostly use symlinked workspace packages, which is fast but
    can miss publish config, bin wiring, dist layout, and dependency issues that real users hit.
  - Refactor shape: create one temp-app harness that can install from packed tarballs or `link-local-kovo`
    and reuse it for typecheck, build, run, and `vp check` lanes. Keep symlink mode only for cheap
    content checks if needed.
  - Risk reduced: false-green scaffold coverage that bypasses actual distribution shape.
  - Verification: packed-install smoke per supported dialect, production build/run smoke, and one
    `vp check` lane through the shared harness.
  - SPEC/rules: `SPEC.md` sections 1.3 and 5.2 rules 8-9; `rules/api-surface.md`.

- [ ] **P2.2 - Generate CLI and `create-kovo` reference docs from structured schemas.**
  - Affected: `packages/create-kovo/src/index.ts`,
    `site/scripts/create-kovo-ref.mjs`, `site/scripts/cli-ref.mjs`.
  - Why high value: reference docs currently duplicate option/command behavior and rewrite markdown by
    heading surgery. This is easy to drift when commands or starter options change.
  - Refactor shape: export structured reference metadata from `create-kovo` and `@kovojs/cli`, then
    render pages and sidebars directly from that data instead of post-processing markdown.
  - Risk reduced: stale command docs, stale option tables, and fragile generated-doc transforms.
  - Verification: docs/sidebar snapshots and drift tests asserting `--help` output and rendered docs are
    derived from the same schema.
  - SPEC/rules: `SPEC.md` section 11.4; `rules/api-surface.md`; `rules/docs-style.md`.

- [x] **P2.3 - Centralize generated-artifact policy into one manifest-backed gate.**
  - Affected: `scripts/no-committed-generated.mjs`, `scripts/prod-emit-check.mjs`,
    compiler/build artifact checks.
  - Why high value: generated-output policy is split across hardcoded globs/regexes and narrow compiler
    smokes. New generated directories or artifact invariants require unrelated script updates.
  - Refactor shape: define one generated-artifact inventory/policy module with categories such as
    `must_not_commit`, `must_be_readable`, and `must_match_emit_contract`; reuse it from no-commit,
    prod-emit, and future artifact gates.
  - Risk reduced: missing coverage for new generated outputs and drift in the machine-auditable
    generation contract.
  - Verification: table-driven path classification tests and a broader emit corpus reusing shared
    filename/source assertions.
  - Evidence: `pnpm exec vitest --run scripts/generated-artifacts.test.mjs scripts/no-committed-generated.test.mjs scripts/prod-emit-check.test.mjs scripts/import-boundary.test.mjs`, `pnpm run check:no-committed-generated`, and `vp run build` pass with the shared generated-artifact policy manifest.
  - SPEC/rules: `SPEC.md` sections 1.3 and 5.2 rules 3, 7, 8; `rules/compiler-hard-rules.md`.

- [x] **P2.4 - Narrow devtool and headless public seams.**
  - Affected: `packages/devtool/src/index.mjs`, `packages/devtool/package.json`,
    `packages/headless-ui/src/types.ts`, `packages/headless-ui/package.json`,
    `public-packages.json`, `site/content/guides/components.md`.
  - Why high value: the devtool root subpath should remain plain-Node/MCP safe, while `./app` and
    `./vite` own integration-heavy edges. Separately, `@kovojs/headless-ui/types` appears to expose
    generic plumbing types even though docs teach family subpaths and in-repo usage does not require the
    barrel.
  - Refactor shape: add dependency-boundary tests proving the devtool root does not import server/Vite
    code; keep integration code behind `./app` and `./vite`. Remove or narrow `@kovojs/headless-ui/types`
    after confirming no app-facing use; keep public types on family subpaths.
  - Risk reduced: dependency leakage into MCP/CLI consumers, recursive-publicness sprawl, and long-term
    support cost for low-signal generic types.
  - Verification: plain-Node import smoke for devtool subpaths, dependency-boundary assertion, repo
    import search, `pnpm run check:api-surface`, and API ref diffs.
  - Evidence: `pnpm exec vitest --run packages/devtool/src/dependency-boundary.test.mjs packages/headless-ui/src/types-boundary.test.ts packages/devtool/src/render.test.mjs --reporter=verbose`, `pnpm run check:api-surface`, and exact `rg "@kovojs/headless-ui/types"` import search pass after narrowing the public seams.
  - Rules: `rules/api-surface.md`.

- [ ] **P2.5 - Make `@kovojs/ui` family metadata and distribution mode explicit.**
  - Affected: `packages/ui/src/*.tsx`, `packages/ui/src/theme.ts`,
    `packages/style/src/theme.ts`, `packages/ui/scripts/build-registry.mjs`,
    `packages/ui/registry.json`, `public-packages.json`, docs for component install/copy-in.
  - Why high value: UI families hand-define `StyleOverrides`, `StateProps`, slots, part props, and
    `style.attrs` plumbing. Tooling and comments also disagree on whether `@kovojs/ui` is a public
    installable library, copy-in source, or both. `ThemeTokens.component(name: string)` exposes
    component tokens stringly even though UI extraction depends on static-literal discipline.
  - Refactor shape: add per-family metadata (`slots`, `state`, `ids`, `parts`) that generates repetitive
    wrapper prop types/plumbing while preserving authored TSX. Add one explicit distribution-mode field
    consumed by docs, registry generation, CLI copy-in flows, and API audits. Move component-token access
    behind internal/generated typed maps while keeping `sys` and `customColor()` public.
  - Risk reduced: prop drift between sibling parts, missing slot exposure, wrong install/copy guidance,
    token-name typos, accidental exposure of copy-in-only token names, and non-static token references.
  - Verification: API ref diffs, `packages/ui/src/copy-in.test.ts`, representative style snapshots,
    `packages/style/src/index.test.ts`, `packages/ui/src/theme-contract.test.tsx`, and negative tests for
    non-static token references.
  - SPEC/rules: `SPEC.md` sections 6.1.1 and 13.1; `rules/api-surface.md`.
