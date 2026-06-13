# Codebase Quality Remediation Plan - Round 2

Status: active. Last compacted on 2026-06-13.

This is the current codebase-quality ledger. It supersedes `plans/codebase-quality.md` and the
remaining compiler cleanup from archived `plans/improve-compiler.md`.

Keep this file compact: track open work, current state, latest proving commands, and integration
risks. Check a box only when the exact item is closed with same-session file and test evidence.

## Checklist

- [x] Phase 0 ledger honesty: false checked items corrected; checklist evidence rule added to
      `AGENTS.md`; round-1 open work merged here.
- [ ] Phase 1 gate de-tautologization: `tests/fw-check.node.mjs` verifies behavior and structured
      artifacts, not source text or its own test names.
- [ ] Phase 2 compiler IR: one parsed model, explicit source patches and offset maps, validators
      consume model facts, no compatibility reparses where parser facts are sufficient.
- [ ] Phase 3 Drizzle extraction: ts-morph/project facts end-to-end; bespoke lexers deleted;
      impossible or indirect surfaces degrade to FW406 instead of fabricated facts.
- [ ] Phase 4 runtime: one runtime apply path, checked inline-loader parser/minifier parity, no
      duplicated wire/apply parsers or compatibility exports.
- [ ] Phase 5 server/app-shell: subtractive server extraction, one request/document/static-export
      path, stable public export boundaries, static export and Vite adoption closed.
- [ ] Phase 6 verification harness and commerce honesty: `@jiso/test` seams prove behavior through
      public fixtures; commerce source/dependency/generated-artifact story is honest.
- [ ] Phase 7 test restructuring: monolith tests split along module seams, shared fixtures used
      deliberately, diagnostics asserted through `diagnosticDefinitions`.

## Operating Rules

- Keep implementation slices large enough to close a coherent phase surface.
- Keep evidence with implementation; avoid evidence-only branches unless fixing this ledger.
- Prefer deleting compatibility wrappers, source-string lowerers, bespoke parsers, and duplicate
  public paths over adding adapters.
- Keep P10 external/non-code evidence separate from implementation progress.
- Preserve dirty main-thread changes while integrating worker branches.

## Phase 1 - Gate De-tautologization

Current state: `tests/fw-check.node.mjs` now consumes shared `@jiso/test` fixtures for HTML
fragments, generated modules/source facts, command output/Vite facts, markdown/source facts, MCP,
static export, starter templates, `fw-explain`, TypeScript, wire, touch-graph provenance, graph
facts, and structured `fw-check/v1` result facts. Shared `@jiso/test/html-fragment` now owns
form-field maps and keyed-element projections for commerce app/source-truth tests.

- [ ] Search for remaining custom parsers, raw source membership checks, and generated-artifact
      projections in `tests/fw-check.node.mjs`.
- [ ] Replace each remaining case with public behavior or structured `@jiso/test` fixture
      assertions.
- [ ] Keep intentional byte-for-byte wire pins explicitly scoped.
- [ ] Keep create-jiso scaffold checks executable against real generated files, Vite+ tasks, graph
      assertions, and typechecking.

Latest evidence:

- `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- targeted `node --test --test-name-pattern ... tests/fw-check.node.mjs`
- exact `pnpm exec vp check ... tests/fw-check.node.mjs examples/commerce/src/source-truth.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts`
- targeted `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "S1 production build proves the compiler 1:1 emit contract|Conformance suites are an explicit gate" tests/fw-check.node.mjs`
- exact `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 2 - Compiler IR

Current state: the compiler threads `ComponentPipelineState` and `SourceOffsetMap`s through ordered
lowerings. Platform, navigation, inline-derive, server-render, opening-tag, static `href()`,
static `<Link>`, and view-transition lowering use explicit patch helpers in several paths. Parsed
JSX spans now drive static `<Link>` tag/`href` patching and view-transition style insertion without
reconstructing child or opening-tag source. Server render host stamping emits parsed attribute
replacement/insertion patches for handlers, `fw-c`, `fw-deps`, and `fw-state`. Many validators now
consume parser/model facts instead of regex or source-string facts.

- [ ] Remove remaining compatibility fallback reparses where parser facts are sufficient.
- [ ] Audit production `createSourceFile`, `getText`, `indexOf`, `slice`, and regex usage; keep
      parser/scanner internals and diagnostics, retire source-string lowerers/validators.
- [ ] Keep Phase 2 open until source-returning lowering is gone from the compile path or each
      remaining case is explicitly justified.

Latest evidence:

- `pnpm exec vitest --run packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/view-transitions.test.ts`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vitest --run packages/compiler/src/execution-triggers.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/navigation-lowering.test.ts`
- exact `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/stamps.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `pnpm exec vitest --run packages/compiler/src/view-transitions.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/model-pipeline.test.ts`
- exact `pnpm exec vp check packages/compiler/src/lower/view-transitions.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/shared.ts`
- `git diff --check`

## Phase 3 - Drizzle Extraction

Current state: direct Drizzle/project extraction is backed by ts-morph where proven. A broad set of
indirect receiver, carrier, destructuring, nested destructuring, detached method, helper handoff, and
quoted property surfaces now degrade to FW406 instead of fabricating exact facts. Project tuple
receiver aliases now use ts-morph tuple/array element type facts for exact Postgres receiver proof,
while source-mode array receiver carriers degrade destructured and assigned aliases to FW406.
Shorthand query loaders now resolve through ts-morph symbols instead of disappearing. V1 proof
remains Postgres-only; SQLite/MySQL conformance is deferred to late hardening.

- [ ] Delete remaining bespoke lexer/compat extraction paths where ts-morph facts can replace them.
- [ ] Cover or degrade remaining invisible source/project query-loader and mutation surfaces.
      Evidence: `packages/drizzle/src/static.ts` resolves `query(..., { load })` through
      referenced function symbols; `packages/drizzle/src/index.test.ts` covers source shorthand,
      typed project shorthand, and untyped project shorthand; `conformance/drizzle-pin/src/index.test.ts`
      pins real `drizzle-orm` typed shorthand loaders.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now resolves local referenced
      `write(..., handler)` domain callbacks through ts-morph symbols; `packages/drizzle/src/index.test.ts`
      covers source referenced write callbacks, typed project callbacks, and untyped project
      non-fabrication; `conformance/drizzle-pin/src/index.test.ts` pins real `drizzle-orm`
      referenced domain write callbacks.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` resolves static member-referenced
      callbacks such as `load: loaders.product` and `write(callbacks.addItem)` through parsed
      callback declarations; `packages/drizzle/src/index.test.ts` covers project query loaders plus
      source/project domain write callbacks; `conformance/drizzle-pin/src/index.test.ts` pins the
      same surfaces against real `drizzle-orm` Postgres receiver types.
      Evidence 2026-06-13: `packages/drizzle/src/static.ts` now treats project member receiver
      expressions such as `carrier.db` as exact only when ts-morph proves their Postgres Drizzle
      database type, removing the carrier-member FW406 fallback for proven reads/writes while
      retaining FW406 for raw SQL, relational query APIs without static projection, helper handoff,
      detached methods, and overwritten fake members; package and real `drizzle-orm` tests pin the
      split.
- [x] Keep SQLite conformance deferred to late hardening; focus v1 on Postgres behavior.
      Evidence: `packages/drizzle/src/drizzle-surface.ts`, `packages/drizzle/src/static.ts`,
      `packages/drizzle/src/index.test.ts`, and `conformance/drizzle-pin/src/index.test.ts` pin the
      Postgres-only v1 surface and deferred SQLite/MySQL degradation.

Latest evidence:

- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm exec vitest --run conformance/drizzle-pin`
- exact `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 4 - Runtime

Current state: store-only mutation/query/deferred compatibility exports have been removed or
narrowed. Visible-return hydration, typed-read refetch, mutation responses, deferred streams, inline
query events, enhanced submit, broadcast, and hydrated query scripts increasingly share canonical
parser/apply helpers. Runtime test coverage has started moving out of `index.test.ts` into focused
query/apply/loader/optimism/morph/delegated-handler integration tests; the broad barrel test is now
focused on loader installation, query hydration, enhanced mutation bridge, and disposal smoke
coverage. Inline readable/minified/generated/extracted loader parity coverage now owns inline
enhanced-form, delegated handler, and handler-error behavior in `inline-loader.test.ts`.
Enhanced submit, broadcast replay, deferred stream chunks, DOM apply, and store-only apply now parse
transport mutation bodies first and call `applyMutationResponseChunksToRuntime` as the single
decoded query/fragment apply primitive; the internal `applyMutationResponseBodyToRuntime`
body/apply wrapper has been deleted. Browser query hydration coverage now lives in
`packages/runtime/src/query-hydration.browser.test.ts`, including inserted hydrated scripts updating
DOM bindings through `queryPlans` on the shared runtime apply path.

- [x] Audit for any remaining internal compatibility-style apply wrappers after `applyFragmentQueryBody`
      deletion.
- [ ] Keep inline-loader readable/minified output mechanically tied to canonical parser helpers.
- [ ] Continue splitting large runtime tests along apply/query/loader/minifier seams.
- [x] Split browser query hydration and inline query-event coverage out of
      `packages/runtime/src/index.browser.test.ts`.
      Evidence: `packages/runtime/src/query-hydration.browser.test.ts` covers inserted
      hydrated scripts, malformed script recovery, inline `jiso:query` events, store writes,
      visible-return refetch keys, and DOM binding updates.
- [ ] Re-run browser runtime tests after each apply/loader surface change.

Latest evidence:

- `pnpm exec vitest --run packages/runtime/src/index.test.ts packages/runtime/src/delegated-runtime-integration.test.ts`
- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/mutation-apply.test.ts packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/index-exports.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec tsc --noEmit --pretty false`
- exact `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/broadcast.ts packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- exact `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts packages/runtime/src/mutation-apply.ts packages/runtime/src/broadcast.ts packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vp check packages/runtime/src/index.test.ts packages/runtime/src/delegated-runtime-integration.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src/query-events.test.ts packages/runtime/src/query-apply.test.ts packages/runtime/src/query-runtime-integration.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/query-hydration.browser.test.ts packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `git diff --check`

## Phase 5 - Server And App Shell

Current state: static export output target planning, output staging, asset planning, Vite build
output, request construction, document/client-module replay, app request document assembly,
mutation request handling, and SPEC §9.5 dispatch branches have been split into focused modules.
Static export diagnostics have a focused owner for compile-diagnostic blocking, FW229 formatting,
type guards, and `StaticExportError`, leaving static-export types for artifact/manifest shapes.
The create-jiso starter imports app-shell dev/export/static-export helpers from public subpaths and
includes a static preview task that serves exported `dist` output without Vite source fallback;
the preview serves exported files for `GET`/`HEAD` only and rejects unsupported methods before any
dynamic app route fallback.
Vite app-shell build output now returns the same compiled `/c/` module output plan that its staged
writer commits, giving plugin `onBuild` consumers one observable target plan for build/static-export
adoption. Vite plugin `writeBundle` build/static-export execution now lives in a focused helper
exported from the public app-shell Vite subpath, leaving the plugin module focused on middleware
and hook delegation. Vite static export inventory/manifest option helpers now reject `outDir`
with FW229 instead of silently dropping write targets, so R6 dry-run preview/export introspection
cannot be mistaken for an output write path.

- [ ] Continue subtractive extraction until `packages/server/src/index.ts`, Vite, static export,
      replay, document, and app boundaries are small and obvious.
- [ ] Finish R5/R6/R7 closure: Vite build/static export/adoption should be proven through server,
      commerce, and starter surfaces.
- [ ] Keep one wire-html emitter and one compile/static-export diagnostic seam.
- [ ] Delete dead compatibility modules and aliases as soon as tests pin the public replacement.

Latest evidence:

- `pnpm exec vitest --run packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-plugin-build.test.ts`
- `pnpm exec vp check packages/server/src/vite-static-export-options.ts packages/server/src/vite-static-export-options.test.ts packages/server/src/vite-build.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/vite-plugin-build.test.ts packages/server/src/vite.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/vite-client-module-output.ts packages/server/src/vite-build-output.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.test.ts`
- `pnpm exec vitest --run packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-output-targets.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-output.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts`
- focused server/static-export/create-jiso tests for diagnostic seam, starter export, and static
  preview behavior
- `pnpm exec tsc --noEmit --pretty false`
- exact `pnpm exec vp check ... packages/server/src/... packages/create-jiso/... IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-diagnostics.ts packages/server/src/static-export-types.ts packages/server/src/static-export.ts packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "runs .* with the built stylesheet href|scaffolds real template files"`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts`

## Phase 6 - Verification Harness And Commerce

Current state: commerce source-truth tests use shared structured facts for graph, HTML,
query/fragment/key output, source-site provenance, app-shell command/export behavior, and
`fw-explain` query/mutation/page assertions. `@jiso/test` owns reusable fixture seams for generated
modules/source facts, fw-explain, TypeScript, fw-check output, source/project facts, commands,
starter templates, wire, static export, touch graphs, graph invalidation/consumer facts, and
reusable HTML fragment field/key projections. Commerce app/source-truth tests no longer own local
form-field, keyed-element, or generated-IR source-stamp projection helpers for currently covered
no-JS form, list identity, enhanced fragment, and committed-IR assertions. Shared header fixtures
now own response header value and Set-Cookie pair projection for commerce app/app-shell tests.
Shared `fw-explain` fixtures now own the commerce mutation/query optimistic matrix projection and
static-invalidation mismatch facts.
Shared graph fixtures now own checked-in graph artifact loading so commerce source-truth and
`fw-check` graph gates no longer parse commerce generated graph JSON locally.

- [ ] Remove remaining commerce-local fixture parsing that belongs in `@jiso/test`.
- [ ] Make opaque adapter objects either observable or explicitly documented as unobserved.
- [ ] Keep commerce generated artifacts honest: checked in, freshness-gated, and tied to source
      provenance rather than synthetic projections.

Latest evidence:

- `pnpm exec vitest --run packages/test/src/fw-explain-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`
- targeted `node --test --test-name-pattern ... tests/fw-check.node.mjs`
- `pnpm run check:build`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts`
- `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- exact `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/headers.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts -t "session|sign|cookie|auth|commerce app shell HTTP entry|renders SPEC 6.3 no-JS add-to-cart forms|renders a multipart receipt upload form"`
- exact `pnpm exec vp check packages/test/package.json packages/test/src/headers.ts packages/test/src/headers.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts`
- `git diff --check`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`
- exact `pnpm exec vp check examples/commerce/src/app.test.ts packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/graph-fixtures.test.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 commerce invalidation is expressed through graph facts|P4 commerce touch graph is a committed generated artifact|D2 commerce validates keyed append and optimistic reorder|D4 commerce adopt-dont-invent features stay represented" tests/fw-check.node.mjs`

## Phase 7 - Test Restructuring

Current state: runtime, server static export, compiler shared/model-pipeline, and `@jiso/test`
fixture tests have been split out of monoliths along module seams. Runtime query/apply/broadcast,
enhanced-submit, and delegated handler integration coverage now lives in focused runtime tests.
`tests/fw-check.node.mjs` is still large but increasingly delegates mechanics to package fixtures
and structured facts. Commerce app tests now consume shared `@jiso/test/html-fragment` form and
keyed-element projections and shared `@jiso/test/headers` response/cookie projections instead of
local helpers; commerce source-truth matrix projection now lives in
`@jiso/test/fw-explain-fixtures`; checked-in graph artifact loading now lives in
`@jiso/test/graph-fixtures`.

- [ ] When touching a monolith test, move reusable mechanics into package fixtures or focused tests.
- [ ] Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- [ ] Keep `plans/*` evidence terse: current status plus command list, not repeated history.

## Current Gates

Latest broad gate:

- `pnpm run check` passed after checkpoint `ebb1520`: inline loader check, 788
  formatted files, 688 lint/typechecked files, and 7 typechecked example/conformance projects.

Focused gates since that broad run:

- UI/gallery H3 menubar keyboard slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/menubar.test.ts`;
  `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t menubar`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/menubar.ts packages/headless-ui/src/primitives/menubar.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
  `git diff --check`.
- UI/gallery H3 menu-keyboard slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.test.ts`;
  `pnpm exec vitest --run examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/dropdown-menu.ts packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.tsx examples/gallery/src/interactive/dropdown-menu-demo.tsx examples/gallery/src/interactive/context-menu-demo.tsx examples/gallery/src/generated/interactive/dropdown-menu-demo.tsx examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js examples/gallery/src/generated/interactive/context-menu-demo.tsx examples/gallery/src/generated/interactive/context-menu-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
  `git diff --check`.
- UI/gallery H3 select native boolean slice:
  `pnpm exec vitest --run packages/headless-ui/src/primitives/select.test.ts`;
  `pnpm exec vitest --run packages/ui/src/index.test.tsx -t select`;
  `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
  `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t select)`;
  exact `pnpm exec vp check packages/headless-ui/src/primitives/select.ts packages/headless-ui/src/primitives/select.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
  `git diff --check`.
- Runtime body apply closure:
  `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/mutation-apply.test.ts packages/runtime/src/apply-deferred-stream.test.ts packages/runtime/src/broadcast.test.ts`;
  `pnpm exec vitest --run packages/runtime/src`;
  `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`;
  `pnpm --filter @jiso/runtime run check:inline-loader`;
  `pnpm exec tsc --noEmit --pretty false`.
- Harness fixture parser-seam slice:
  `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts`;
  `pnpm run check:build`;
  `node --test --test-name-pattern "S1 production build proves the compiler 1:1 emit contract|Conformance suites are an explicit gate" tests/fw-check.node.mjs`;
  `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "compiles TSX-authored components to committed IR through the fixpoint gate"`;
  exact `pnpm exec vp check tests/fw-check.node.mjs examples/commerce/src/app.test.ts packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/diagnostic-output-fixtures.ts packages/test/src/diagnostic-output-fixtures.test.ts packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`;
  `git diff --check`.

Stale but useful broad references:

- `pnpm run test` previously passed from the then-current file tree: 193 files, 1942 tests.
- `pnpm run test:browser` previously passed: Chromium runtime browser suite, 11 tests.
- `pnpm run test:conformance` previously passed, including Drizzle pinned conformance.

## Integration Queue

- [ ] Integrate active worker branches one at a time with focused gates before each checkpoint.
- [ ] Refill toward five large-slice worker lanes when disjoint ownership and capacity allow.
