# High-value refactoring plan 3

Date: 2026-06-30

This is a third-wave read-only audit after `plans/high-value-refactoring.md` and
`plans/high-value-refactoring-2.md` were implemented. It incorporates parallel sub-agent review
across compiler/browser, server/runtime, CLI/tooling, Drizzle/static analysis, and
UI/site/examples. Do not re-open prior completed items unless this plan names a distinct remaining
invariant.

## P0 - Correctness and Security Invariants

- [x] **P0.1 - Make rendered/trusted HTML capabilities unforgeable across framework and examples.**
  - Current signals: `packages/server/src/html.ts` and `packages/core/src/index.ts` still mint
    rendered HTML with `Symbol.for('kovo.renderedHtml')`; `packages/ui/src/table.tsx` locally
    recreates and trusts that same global symbol; `examples/gallery/src/app-shell.ts`,
    `examples/commerce/src/app.tsx`, and `examples/reference/src/app-shell.ts` hand-roll
    `isKovoTrustedHtml()` from the structural `__kovoTrustedHtml` property and trust
    `Symbol.for('kovo.renderedHtml')`.
  - Refactor shape: move rendered HTML and trusted HTML recognition behind framework-owned
    validating helpers with module-private witnesses or an explicit bridge for Vite SSR graph
    boundaries. Remove direct `Symbol.for('kovo.renderedHtml')` checks from UI/example code and
    forbid structural `__kovoTrustedHtml` trust outside the browser security module.
  - Risk reduced: userland cannot forge `{ [Symbol.for('kovo.renderedHtml')]: true, html: ... }`
    or `{ __kovoTrustedHtml: true, value: ... }` to bypass escaping in table composition or example
    app shells.
  - Evidence: `pnpm exec vitest --run packages/server/src/html.test.ts packages/browser/src/security-output.test.ts packages/ui/src/xss-escaping.test.tsx examples/gallery/src/interactive-gallery.artifacts.test.ts examples/commerce/src/app.test.ts examples/reference/src/app-shell.test.ts`, `pnpm run check:imports`, `pnpm run check:api-surface`, and `git diff --check` passed on 2026-06-30; `rg "Symbol\\.for\\('kovo\\.renderedHtml'\\)|__kovoTrustedHtml" packages examples --glob '!**/*.test.*'` reports only the browser security owner module.

- [x] **P0.2 - Make data-plane static analysis fail closed on missing aggregate ABI or analyzer crashes.**
  - Current signals: `packages/server/src/internal/data-plane-static-analysis.ts` still treats
    `extractStaticBuildAnalysisFactsFromProject` as optional and falls back to recomposing older
    analyzer entrypoints. `staticDataPlaneBuildFacts()` catches analyzer failures and returns empty
    facts/touch graphs.
  - Refactor shape: require the aggregate Drizzle analyzer ABI, delete the fallback recomposition
    path, and distinguish "no relevant Drizzle sources" from "analyzer failed". Analyzer import,
    parse, or ts-morph failures should become blocking diagnostics or thrown build/check errors with
    KV context.
  - Risk reduced: `kovo check`, Vite dev teaching diagnostics, and build/export cannot silently skip
    owner audits, mass-assignment, SQL safety, TOCTOU, query-write reachability, or newer data-plane
    diagnostics because the analyzer was old or crashed.
  - Evidence: `pnpm exec vitest --run packages/server/src/vite-data-plane-gate.test.ts packages/server/src/internal/data-plane-static-analysis.test.ts packages/drizzle/src/static-analysis-context.test.ts` passed on 2026-06-30, covering failing analyzer diagnostics, missing aggregate ABI, invalid aggregate output, and no-source empty facts.

- [x] **P0.3 - Replace build/export process-global side channels with scoped build context.**
  - Current signals: `packages/cli/src/commands/build-export.ts` toggles
    `KOVO_BUILD_GRAPH_DERIVATION`, writes `--stylesheet-env` values into `process.env`, and server
    Vite/data-plane code reads those process globals during build/export.
  - Refactor shape: thread a typed `KovoBuildContext` through CLI build/export, Vite plugin
    options, stylesheet loading, and data-plane analysis. If an environment overlay is still needed,
    scope it with restoration around the exact module load/build call.
  - Risk reduced: repeated builds in one process cannot leak stylesheet env, accidentally disable or
    enable graph derivation, or couple CLI/server internals through hidden process state.
  - Evidence: `pnpm exec vitest --run packages/cli/src/commands/build-export.context.test.ts packages/server/src/internal/data-plane-static-analysis.test.ts packages/server/src/vite-data-plane-gate.test.ts`, `pnpm run check:vp`, and `git diff --check` passed on 2026-06-30.

- [x] **P0.4 - Share one Node adapter runtime between dev and generated production builds.**
  - Current signals: `packages/server/src/node.ts` owns tested request/response conversion, while
    `packages/server/src/build.ts` embeds duplicated Node adapter functions as source strings for
    generated builds.
  - Refactor shape: factor a tiny internal Node adapter runtime that built presets import, or generate
    the adapter source from one tested template. Keep `Set-Cookie`, HTTP/2 pseudo-header filtering,
    abort handling, HEAD/body suppression, and stream error behavior in one implementation.
  - Risk reduced: production build presets cannot drift from dev/server behavior for headers,
    streaming, abort cleanup, or response finalization.
  - Evidence: `pnpm exec vitest --run packages/server/src/node.test.ts packages/server/src/build.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-plugin-build.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export-headers.test.ts packages/server/src/vite-static-export-result.test.ts` passed on 2026-06-30, covering generated adapter parity for headers/cookies/HEAD/stream errors/abort cleanup.

- [x] **P0.5 - Replace global mutation form-helper placeholder registries with render-scoped state.**
  - Current signals: `packages/core/src/index.ts` and `packages/server/src/jsx-runtime.ts` both use
    `Symbol.for('kovo.mutationFormHelperRegistry')` and incrementing process-global placeholder IDs
    to defer `FormError`/form helper rendering until form context is known.
  - Refactor shape: thread a render-local form-helper registry through JSX/render context, or attach
    placeholders to a per-render object that cannot collide across concurrent requests. Keep a bridge
    only for compiler-emitted helper ABI if necessary, but make global state a compatibility shim with
    tests proving isolation.
  - Risk reduced: concurrent SSR requests, nested form rendering, or Vite module graph reuse cannot
    cross-resolve mutation failure placeholders from another render.
  - Evidence: `pnpm exec vitest --run packages/server/src/jsx-runtime.test.ts packages/server/src/mutation-response.test.ts packages/server/src/app-mutation-request.test.ts packages/core/src/index.test.ts`, `pnpm run check:vp`, and `git diff --check` passed on 2026-06-30.

- [x] **P0.6 - Unify route pattern parsing, normalization, and typed href contracts.**
  - Current signals: `packages/core/src/index.ts` type-level `PathParamNames`/`buildHref()`
    comments require mirroring server parsing, while `packages/server/src/match.ts` separately
    normalizes route patterns, slash runs, dot segments, and parameter matching.
  - Refactor shape: move route pattern parsing and normalization into one shared internal core
    contract with runtime metadata and type-test fixtures. Server matching, typed hrefs, redirects,
    static export route planning, and ambiguity checks consume the same parser.
  - Risk reduced: typed navigation, server matching, redirects, and static export cannot disagree on
    param names, encoding, dot segments, or canonical path identity.
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/route-pattern.test.ts packages/core/src/index.test.ts packages/server/src/match.test.ts packages/server/src/route.test.ts packages/server/src/static-export-route-plan.test.ts packages/compiler/src/navigation-lowering.test.ts scripts/public-packages.test.mjs`, `pnpm exec vitest --run packages/compiler/src/registry.test.ts packages/compiler/src/app-graph.test.ts`, `pnpm --filter @kovojs/core run build:dist`, `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check` passed on 2026-06-30.

## P1 - Cross-Package Drift and Large Runtime Extraction

- [x] **P1.1 - Replace browser wire regex parsers with one typed wire-element tokenizer.**
  - Current signals: `packages/browser/src/wire-response-scanner.ts` parses wire chunks with tag/close
    regexes, while `packages/browser/src/wire-parser.ts` carries separate attribute logic because
    existing `readAttribute()` cannot distinguish valueless from absent attributes.
  - Refactor shape: create one tiny tokenizer for Kovo wire elements that returns tag name, content,
    source ranges, and typed attributes with presence/value distinction. Use it from modular browser
    code and inline-loader extraction while preserving bundle-size budgets.
  - Risk reduced: streamed/deferred chunks, nested fragments, malformed tags, boolean attributes such
    as `delta`, and quoted/entity variants parse consistently in inline and modular runtimes.
  - Evidence: `pnpm exec vitest --run packages/browser/src/wire-response-scanner.test.ts packages/browser/src/wire-parser.test.ts packages/browser/src/inline-loader-parser-parity.test.ts packages/browser/src/apply-deferred-stream.test.ts packages/browser/src/inline-loader-response-apply.browser.test.ts packages/browser/src/inline-loader-navigation.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/query-visible-return-ledger.test.ts packages/browser/src/query-visible-return-refetch.test.ts packages/browser/src/clock-tick-bus.test.ts packages/browser/src/optimism-apply.test.ts packages/browser/src/optimism-derived.test.ts packages/browser/src/optimism-rebase.test.ts packages/browser/src/optimism-typing.test.ts packages/browser/src/inline-loader-build.test.ts`, `pnpm --filter @kovojs/browser run check:inline-loader`, and `git diff --check` passed on 2026-06-30.

- [x] **P1.2 - Extract enhanced navigation and page-lifecycle recovery from the inline-loader string.**
  - Current signals: `packages/browser/src/inline-loader-build.ts` still contains large readable
    implementations for enhanced navigation, `visibilitychange`/`pageshow` recovery, bfcache
    session reload, view transitions, scroll/focus restoration, and live query refresh. Modular
    files such as `query-visible-return.ts`, `clock-tick-bus.ts`, and `optimism.ts` implement
    overlapping page-lifecycle wiring.
  - Refactor shape: move enhanced navigation to typed modules such as `enhanced-navigation.ts` and
    `document-lifecycle.ts`, then extract/minify those helpers for inline use the same way response
    application and wire parsing are extracted.
  - Risk reduced: navigation and stale-data recovery fixes land in typed, reviewable code and cannot
    drift between inline and modular loader paths.
  - Evidence: `pnpm exec vitest --run packages/browser/src/wire-response-scanner.test.ts packages/browser/src/wire-parser.test.ts packages/browser/src/inline-loader-parser-parity.test.ts packages/browser/src/apply-deferred-stream.test.ts packages/browser/src/inline-loader-response-apply.browser.test.ts packages/browser/src/inline-loader-navigation.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/query-visible-return-ledger.test.ts packages/browser/src/query-visible-return-refetch.test.ts packages/browser/src/clock-tick-bus.test.ts packages/browser/src/optimism-apply.test.ts packages/browser/src/optimism-derived.test.ts packages/browser/src/optimism-rebase.test.ts packages/browser/src/optimism-typing.test.ts packages/browser/src/inline-loader-build.test.ts`, `pnpm --filter @kovojs/browser run check:inline-loader`, and `git diff --check` passed on 2026-06-30.

- [ ] **P1.3 - Move CLI build graph extraction off source string probes.**
  - Current signals: `packages/cli/src/commands/build-export.ts` still guards graph extraction with
    `source.includes('component(')` / `source.includes('queries')`, guesses import extensions, and
    scans route file/stream facts from route source bodies with regexes.
  - Refactor shape: have compiler/internal graph facts expose component-query, route-outcome,
    file/stream, and dependency facts from the AST/model pipeline. CLI build/export should consume
    those facts rather than re-reading source.
  - Risk reduced: build graph, explain output, and static export stop missing facts because of
    formatting, aliases, wrapper helpers, comments, or import-extension variants.
  - Verification: add aliases/wrapper fixtures for components, route file/stream returns, and route
    queries. Run `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts packages/cli/src/index.kovo-route-outcomes.test.ts packages/compiler/src/registry.test.ts packages/compiler/src/app-graph.test.ts`.

- [x] **P1.4 - Require Drizzle diagnostic construction through a source-site builder.**
  - Current signals: `packages/drizzle/src/static.ts`, `packages/drizzle/src/static/query-shapes.ts`,
    and `packages/drizzle/src/static/summaries.ts` still create diagnostics with `site: ''` and later
    patch or contextualize locations; other paths format source sites inline.
  - Refactor shape: introduce a Drizzle diagnostic builder that requires either a source node or an
    explicit site, owns diagnostic code/severity/message lookup, and disallows placeholder empty
    sites except for a named no-site diagnostic variant.
  - Risk reduced: SQL/query-shape diagnostics cannot silently lose location, severity, or KV message
    consistency as analyzers are split.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.query-loader-config.test.ts packages/drizzle/src/sql-safety-static.test.ts packages/drizzle/src/static-analysis-context.test.ts`, `rg "site: ''" packages/drizzle/src`, and `git diff --check` passed on 2026-06-30.

- [x] **P1.5 - Share static host header policy across build and export emitters.**
  - Current signals: `packages/server/src/static-export-output.ts` notes immutable asset headers are
    kept in lockstep with `packages/server/src/build.ts`, while platform sidecar policies for Vercel,
    Netlify, Cloudflare, and filesystem output are encoded separately.
  - Refactor shape: add a `static-host-header-policy` manifest for document, immutable asset,
    revalidating asset, client module, and error-document headers. Platform emitters only format from
    that manifest.
  - Risk reduced: one hosting target cannot silently miss cache posture, `nosniff`, CORP, isolation,
    or future security headers.
  - Evidence: `pnpm exec vitest --run packages/server/src/node.test.ts packages/server/src/build.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-plugin-build.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export-headers.test.ts packages/server/src/vite-static-export-result.test.ts` passed on 2026-06-30, covering the shared static host header policy manifest across build and static export emitters.

- [x] **P1.6 - Make JSON clone/assert/size semantics canonical.**
  - Current signals: `packages/core/src/json-clone.ts` has proxy-safe clone logic, while
    `packages/server/src/task-queue.ts` still clones via `JSON.parse(JSON.stringify(...))` and
    `packages/core/src/query-delta.ts` measures size with raw `JSON.stringify`.
  - Refactor shape: add one core JSON utility family for proxy-safe clone, strict JSON-serializable
    assertion with pathful errors, and canonical encoded-size measurement. Task queue, query deltas,
    optimistic values, and test harnesses use the shared utility.
  - Risk reduced: durable task args, query deltas, and optimistic state stop disagreeing on Date,
    bigint, `undefined`, proxies, and serialization failures.
  - Evidence: `pnpm exec vitest --run packages/core/src/json-clone.test.ts packages/core/src/internal/wire-json.test.ts packages/core/src/query-delta.test.ts packages/server/src/task-queue.test.ts`, `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check` passed on 2026-06-30.

## P2 - Maintainability and Gate Quality

- [x] **P2.1 - Generate headless public facades, package exports, and pack inputs from the primitive manifest.**
  - Current signals: `packages/headless-ui/src/public/*.ts` files look generated but are checked in
    manually; `packages/headless-ui/package.json` and `build:dist` manually list the same public
    subpaths; `packages/ui/scripts/build-registry.mjs` currently checks mostly subpath presence.
  - Refactor shape: extend the primitive manifest generator to emit public facade files, package
    exports, public API boundary entries, and `vp pack` inputs for headless UI.
  - Risk reduced: primitive additions/removals cannot leave stale public facades, missed exports, or
    pack metadata drift.
  - Evidence: `node packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/headless-ui run lint:primitives`, `pnpm --filter @kovojs/headless-ui run build:dist`, `pnpm run check:api-surface`, and `git diff --check` passed on 2026-06-30 after generating the headless facades/package exports/API boundary/pack inputs from `packages/ui/scripts/primitive-component-manifest.mjs`.

- [ ] **P2.2 - Centralize CLI argv parsing from command manifests.**
  - Current signals: `packages/cli/src/commands/build-export.ts` hand-rolls separate build/export arg
    parsers, `packages/cli/src/commands/compile.ts` still has stale build/export declarations, and
    `packages/cli/src/commands-manifest.ts` separately owns usage examples and option docs.
  - Refactor shape: add a small typed option parser driven by command specs and migrate add, build,
    export, and compile commands. Delete stale build/export option declarations from compile.
  - Risk reduced: parser behavior, help text, docs, and tests stop drifting on missing values,
    `--flag=value` handling, aliases, and default options.
  - Verification: `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts packages/cli/src/index.kovo-export.test.ts packages/cli/src/index.kovo-compile.test.ts packages/cli/src/commands-manifest.test.ts` plus `pnpm run check:api-surface`.

- [x] **P2.3 - Replace site search `innerHTML` rendering with DOM construction and URL validation.**
  - Current signals: `site/src/client/search.js` fetches `search-index.json`, escapes text with a local
    helper, interpolates result rows as strings, and assigns `innerHTML`.
  - Refactor shape: build rows with `document.createElement`, `textContent`, `setAttribute`, and a
    same-origin/docs-path URL validator before assigning `href`. Keep string HTML only in build-time
    serializers that have contextual escaping tests.
  - Risk reduced: docs search cannot become an XSS or unsafe-navigation sink if generated index
    content or escaping context changes.
  - Evidence: `pnpm --filter @kovojs/site exec vitest --run src/client/search.test.ts` passed on 2026-06-30 with malicious title/section/url fixtures covering text, attribute, and href contexts.

- [x] **P2.4 - Make SQL side-effect observation dialect-aware in the test harness.**
  - Current signals: `packages/test/src/sql-observer.ts` receives `sqlDialect`, but table discovery
    probes Postgres `information_schema.tables`; SQLite harness tests pass `sqlDialect: 'sqlite'`.
  - Refactor shape: make table discovery and identifier quoting dialect-aware for PGlite/Postgres and
    SQLite, and replace `constructor.name === 'AsyncFunction'` capability checks with explicit
    promise detection or adapter methods.
  - Risk reduced: SQLite/raw-handle tests cannot silently lose verifier count/fingerprint coverage for
    side effects.
  - Evidence: `pnpm exec vitest --run packages/test/src/sql-observer.test.ts packages/test/src/sqlite-harness.test.ts packages/test/src/pglite-harness.test.ts` passed on 2026-06-30 with SQLite count/fingerprint side-effect coverage and existing PGlite observer coverage.

- [x] **P2.5 - Make compiler diagnostic coverage producer-owned.**
  - Current signals: `packages/compiler/src/diagnostic-coverage-matrix.data.ts` is a large
    hand-maintained matrix separate from validator modules, `diagnosticDefinitions`, and
    `spec-coverage-map.ts`.
  - Refactor shape: let validators/lowering modules register their diagnostic coverage fixtures and
    generate the matrix from those registrations. Assert every compiler-owned KV code has an owner,
    SPEC citation, positive fixture, and negative fixture.
  - Risk reduced: new compiler diagnostics cannot ship without teaching coverage or clear module
    ownership.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/diagnostic-coverage-matrix.test.ts packages/compiler/src/spec-coverage-map.test.ts packages/compiler/src/compiler-conformance.test.ts`, `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check` passed on 2026-06-30.
