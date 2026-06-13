# Codebase Quality Remediation Plan - Round 2

Status: active. Last compacted on 2026-06-12.

This file is the active codebase-quality ledger. It supersedes `plans/codebase-quality.md`
and the remaining compiler cleanup from archived `plans/improve-compiler.md`.

Keep this file short: record current status, open work, and the most recent proving commands.
Do not append every partial evidence paragraph. Check a box only when the item is fully closed
with same-session file/test evidence.

## Progress Checklist

- [x] Phase 0 ledger honesty: false checked items corrected; checklist evidence rule added to
      AGENTS.md; round-1 open work merged below.
- [ ] Phase 1 gate de-tautologization: `tests/fw-check.node.mjs` source-text assertions replaced
      with behavioral checks; create-jiso templates are real files and scaffold is typechecked.
- [ ] Phase 2 compiler IR: single parse, span-patch lowering with offset map, validators consume
      the model; regex/source-string lowerers and validator reparses retired.
- [ ] Phase 3 Drizzle extraction: ts-morph/project facts end-to-end; bespoke lexers deleted;
      fabricated facts removed or degraded to FW406; relational/execute coverage pinned.
- [ ] Phase 4 runtime: inline-loader minification/parity closed; duplicate wire/apply parsers
      removed; runtime split completed subtractively.
- [ ] Phase 5 server: document/app extraction finished subtractively; one wire-html emitter;
      one `onError` diagnostic seam; replay choreography and response types unified.
- [ ] Phase 6 verification harness and commerce honesty: `@jiso/test` seams sound; verifier proxy
      SQL assumptions removed; commerce source/dependency story honest.
- [ ] Phase 7 test-suite restructuring: monolith tests split along module seams; shared fixtures;
      diagnostic assertions keyed to `diagnosticDefinitions`.

## Open Items Merged From Round 1

These were the remaining open items in `plans/codebase-quality.md`; that plan is archived.

- Inline loader de-drift: finish Phase 4 runtime inline-loader build/minifier parity work.
- Commerce generated-artifact/deep-import cleanup: close under Phase 1/6 by making generated
  artifacts honest and removing any local deep import dependency from the example workflow.
- Verifier proxy SQL shape assumptions: closed under Phase 6 for string SQL plus structured
  `{ text }`/`{ sql }` statement objects; opaque adapter objects still pass through unobserved.
- Module splits: keep compiler/server/drizzle/runtime splits subtractive inside the phase that
  touches each package; do not grow root barrels except for intentional public API.

## Phase 0 - Ledger Honesty

Closed.

Evidence:

- 2026-06-11: round-1 and IMPLEMENT checked items re-audited; false items reopened or caveated.
- 2026-06-11: AGENTS.md/CLAUDE.md rule added: checkboxes require same-session file/test evidence.
- 2026-06-12: round-1 open items merged into this plan; `plans/codebase-quality.md` archived.

## Phase 1 - Gate De-tautologization

Goal: `tests/fw-check.node.mjs` should verify behavior and structured artifacts, not grep source
text or its own test names.

Closed evidence so far:

- Commerce graph, starter template, generated/wire artifact, diagnostics, docs/readiness, and
  conformance-gate tranches have been converted from source-text checks to structured behavior.
- Remaining `assert.match` / `assert.doesNotMatch` sites in `tests/fw-check.node.mjs` were
  removed.
- Vite task checks now evaluate real config objects through a loader instead of parsing config
  source, and verified commands execute through `execFile` argv calls rather than shell strings.
- Commerce source-truth graph tests no longer inspect `emit-graph.mjs` or `app.ts` text for
  membership; `examples/commerce/src/source-truth.test.ts` verifies generated graph behavior,
  inferred touch facts, and structured line-numbered sites.
- Commerce app-shell config and i18n catalog checks now use exported config/catalog seams plus
  `@jiso/test/html-fragment` element facts instead of parsing `vite.config.ts`/`app.ts` source.
- `tests/fw-check.node.mjs` no longer owns its local regex/index-based HTML element/block parser;
  its compatibility helpers delegate to the shared `@jiso/test/html-fragment` element-fact seam.
- `examples/commerce/src/source-truth.test.ts` now verifies page hints and enhanced mutation wire
  output with `htmlDocumentFacts`, `fwQueryFacts`, `fwFragmentFacts`, and `htmlKeyFacts` instead
  of local `<fw-query>` regex parsing or raw fragment/key substring membership.
- The inline loader enhanced-form evidence now uses an internally consistent enhanced-form fixture
  (`closest()` selector match plus `getAttribute('enhance')`), so the assertion proves submit
  behavior against the loader's public form-detection contract instead of a stale test double.

Open:

- Search for remaining custom source parsers or raw source membership checks in
  `tests/fw-check.node.mjs` and replace each with behavior/structured artifact assertions.
- Keep byte-for-byte fixture pins where they intentionally prove wire compatibility.
- Keep create-jiso template tests executable: generated files, Vite+ tasks, graph assertions, and
  scaffold typechecking.

Recent gates:

- `node --test --test-name-pattern "P10 starter wires graph assertions into CI|Conformance suites are an explicit gate" tests/fw-check.node.mjs`
- `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts`
- `node --test --test-name-pattern "P3 server renders initial query scripts|D3 deferred stream responses are consumed by the runtime|P4 commerce touch graph is a committed generated artifact|P10 commerce graph assertions answer behavior mechanically|D1 commerce enhanced fragments carry Tailwind stylesheet hints" tests/fw-check.node.mjs`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact|P10 commerce graph assertions answer behavior mechanically" tests/fw-check.node.mjs`
- `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 2 - Compiler IR

Goal: the compiler should operate from a single parsed model plus explicit patch lists and offset
maps. Source strings remain diagnostic surfaces, parser snippets, or emitted artifacts only.

Closed evidence so far:

- `compile.ts` threads `ComponentPipelineState` through shared transition helpers.
- View-transition, platform, navigation, inline-derive, and server-render lowerings expose
  explicit `SourceReplacement` lists and are applied through `lowerComponentPipelinePatches`.
- Many validators now consume parser-owned model facts: hrefs, bindings, event triggers, markup,
  component contracts, authoring surface, CSS host selector, and render-host stamping.
- Handler parameter type inference now relies on parser-owned `PropertyAccessPathModel`
  classifications only; `lower/handlers.ts` no longer imports TypeScript or reparses handler
  expressions.
- Client emission no longer reparses `handler.expression` to rediscover zero-arg arrow bodies;
  emitted handler bodies come from the parser-owned `HandlerArrowBody` payload.
- Client handler body rewrites now use required parser-owned `HandlerArrowBody` spans only;
  `emit/client.ts` no longer imports TypeScript or exposes a standalone expression-reparse
  lowerer.
- Handler lowering uses parser-owned zero-arg arrow body facts for parameter and `state` rewrites;
  the legacy handler-expression reparse path has been removed.
- IR authoring-surface diagnostics use header detection only; tag-specific FW235 help comes from
  parser-owned string-render facts.
- Server-render replacements now flow through the shared pipeline patch seam instead of directly
  applying source replacements in `compile.ts`.
- Terminal server-render patching now uses an emit-only pipeline patch helper, so `compile.ts`
  no longer reparses the server-rendered source after the final source patch when no later model
  analysis consumes it.
- Package-prefix discovery now consumes module specifier facts from the primary
  `ComponentModuleModel`; `package-prefixes.ts` no longer reparses TSX source.
- Client handler rewrites and server param-type emission now share one element-param attribute
  name normalizer instead of duplicating `data-p-*` lowering logic.
- List-stamp query-shape traversal now lives in `analyze/query-shapes.ts`; binding validators
  consume shared analyzer helpers instead of carrying duplicate path-validation types and
  array-item lookup logic.

Open:

- Remove remaining compatibility fallback reparses where parser facts are sufficient.
- Audit remaining production `createSourceFile`, `getText`, `indexOf`, `slice`, and regex uses:
  keep parser/scanner internals and diagnostics; retire source-string lowerers/validators.
- Decide whether server-render diagnostics ever need the returned offset map; currently
  server-render patching is emit-only.
- Keep the broader Phase 2 checkbox open until source-returning lowering is gone from the compile
  path or explicitly justified.

Recent gates:

- `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/vite.test.ts`
- `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/package-prefixes.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/vite.test.ts`
- `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/package-prefixes.ts packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/compiler/src/handler-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vp check packages/compiler/src/emit/client.ts packages/compiler/src/types.ts`
- `pnpm run check`
- `git diff --check`
- `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/handler-lowering.test.ts`
- `pnpm exec vp check packages/compiler/src/model-pipeline.ts packages/compiler/src/compile.ts packages/compiler/src/model-pipeline.test.ts`
- `git diff --check`
- `pnpm exec vitest --run packages/compiler/src/query-bindings.test.ts packages/compiler/src/query-update-plans.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vp check packages/compiler/src/analyze/query-shapes.ts packages/compiler/src/validate/bindings.ts`
- `git diff --check`

## Phase 3 - Drizzle Extraction

Goal: Drizzle facts come from ts-morph/project analysis or explicit FW406 degradation, not from
serialized-source heuristics.

Closed evidence so far:

- Project-mode extraction uses symbol/fallback keys for helper summaries.
- Local helper reads can contribute query domains; helper writes, unresolved receivers, and
  ambient/external helper handoffs degrade to FW406.
- Bodyless `declare function` declarations are skipped during function extraction.
- Real Drizzle conformance covers receiver types, namespace imports, relational query API calls,
  standalone direct selects, closure-local helper summaries, materialized view refresh, count
  helper, unknown receiver methods, and query-loader helper handoffs.
- Project touch/query helper summaries build function facts from ts-morph project nodes directly;
  `pnpm exec vitest --run packages/drizzle/src` and
  `pnpm exec vitest --run conformance/drizzle-pin` pass.
- Project query-loader receiver extraction excludes explicitly typed non-Drizzle receiver
  lookalikes and carries transaction callback aliases into FW406 diagnostics.
- Query-loader read/projection/instance-key extraction scans executable callback bodies only;
  uncalled nested helper declarations no longer fabricate Drizzle reads, while called local helper
  summaries still fold into query facts. Evidence: `packages/drizzle/src/index.test.ts` nested
  helper regression coverage, `conformance/drizzle-pin/src/index.test.ts` real `drizzle-orm`
  pin, `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Project-mode `drizzle-orm` `alias()` declarations resolve through ts-morph import/declaration
  symbols to the original table identity for writes, reads, query shapes, and instance keys; local
  helper functions named `alias` degrade to FW406. Evidence: `packages/drizzle/src/static.ts`,
  `packages/drizzle/src/index.test.ts`, `conformance/drizzle-pin/src/index.test.ts`,
  `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Static no-substitution-template element access now uses the same project/source access helper as
  string-literal element access, so template-form execute degrades to FW406 and template-form
  relational `findFirst` remains a relational read/FW406 query surface. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Project query-loader receiver matching now uses ts-morph receiver/transaction-alias symbols, so
  shadowed lookalike `db` bindings no longer fabricate read, exempt-read, or raw-execute FW406
  facts while the real loader receiver still contributes query facts. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Query fact extraction scans only the `load` callback on query declarations, so callback-shaped
  config/helper properties no longer fabricate reads, FW411 exempt reads, raw-execute FW406
  diagnostics, shapes, or instance keys. Evidence: `packages/drizzle/src/static.ts`,
  `packages/drizzle/src/index.test.ts`, `conformance/drizzle-pin/src/index.test.ts`,
  `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Project-mode typed destructured Drizzle receiver bindings now contribute write and query facts
  from the resolved binding symbol while explicitly typed fake contexts stay invisible. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Project query-loader receiver extraction no longer falls back to untyped source-mode `db`/`tx`
  compatibility names; project fixtures now annotate positive query-loader receivers as
  `PgDatabase`, and untyped lookalike loaders stay invisible instead of fabricating read/write
  facts. Evidence: `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.

Open:

- Delete remaining bespoke lexer/compat extraction paths once covered by ts-morph facts.
- Continue expanding real `drizzle-orm` coverage for invisible surfaces and callback/helper
  boundaries.
- Keep unsupported surfaces explicit with FW406 and stable source locations.

Recent gates:

- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm exec vitest --run conformance/drizzle-pin`
- `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`
- `pnpm run test:conformance`

## Phase 4 - Runtime

Goal: one runtime implementation path, checked inline-loader parity, and no duplicated wire/apply
parsers.

Closed evidence so far:

- Mutation and deferred-stream apply paths now share runtime helpers for DOM-root and store-only
  application.
- Shared quote-aware `readElementChunks` in `wire-parser.ts` powers query chunks, fragment chunks,
  and mutation failure parsing; duplicate mutation-failure scanner removed.
- Inline-loader build/minifier has substantially more parity coverage and fails closed for
  unsupported template interpolation.
- Inline enhanced-form response application now uses a quote-aware inline scanner instead of
  `DOMParser`; parity tests cover escaped query JSON/keys and nested fragments across readable,
  freshly minified, generated, and extracted installer sources.
- Hydrated `script[fw-query]` parsing now shares `wire-parser.ts` query chunk construction, and the
  runtime barrel exports the canonical apply path directly after deleting the `apply.ts` shim.
- Hydrated query script replay tracking now lives in `query-store.ts` as a reusable hydration
  ledger; visible-return refetch uses that shared helper, with node and browser tests proving new
  scripts are discovered without replaying already observed server script nodes.
- Hydrated query script discovery now uses the shared `queryScriptsFromRoot` runtime helper, and
  the hydration ledger only suppresses successfully applied script nodes so transient malformed
  script JSON can recover on later visible-return scans.
- Inline-loader `--check` now parses the checked-in generated module and fails when the exported
  source literal drifts from the executable installer artifact, with tests mutating only one
  embedded artifact to prove the check.
- Inline-loader response parsing now embeds helper declarations extracted from the canonical
  `wire-parser.ts` implementation at build/check time instead of maintaining a standalone
  `readChunks` scanner; the generated artifact calls `readElementChunks` for query and fragment
  response chunks while preserving the SPEC.md §4.4 gzip budget. Same-session evidence:
  `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`,
  `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm --filter @jiso/runtime run
check:inline-loader`.
- Runtime apply path split now keeps `apply-path.ts` as the stable facade while moving mutation
  response and deferred-stream application into `apply-mutation-response.ts` and
  `apply-deferred-stream.ts`; `mutation-response.test.ts` proves direct split-module exports still
  share malformed-query handling, hooks, and aggregation behavior.
- Query store/apply responsibilities are split: `query-store.ts` now owns only store identity,
  snapshots, and subscriptions, while `query-apply.ts` owns chunk application, hydrated script
  discovery, and the hydration replay ledger shared by mutation responses, typed-read refetch, and
  browser hydration (SPEC.md §9.1/§9.4). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/query-store.test.ts packages/runtime/src/query-refetch.test.ts
packages/runtime/src/mutation-response.test.ts packages/runtime/src/broadcast.test.ts
packages/runtime/src/index.test.ts`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/query-apply.ts packages/runtime/src/query-store.ts
packages/runtime/src/query.ts packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/loader-lifecycle.ts packages/runtime/src/loader.ts
packages/runtime/src/query-refetch.ts packages/runtime/src/mutation-submit.ts
packages/runtime/src/broadcast.ts packages/runtime/src/query-store.test.ts`.
- Browser DOM fragment target resolution now shares the live target vocabulary used by
  `FW-Targets` collection and inline response application: `DomMorphRoot` resolves `fw-c`, `id`,
  and `fw-fragment-target` through `fragment-targets.ts` (SPEC.md §9.1), including selector-special
  query-instance-style ids. Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts` and
  `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`.

Open:

- Decide whether any inline-loader budget/minifier gaps remain after artifact-parity checking.
- Complete subtractive runtime split of the remaining high-churn root module areas.
- Expand browser/runtime gates where shared wire parsing can affect hydrated query behavior.

Recent gates:

- `pnpm exec vitest --run packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts packages/runtime/src/query-refetch.test.ts`
- `pnpm exec vp check packages/runtime/src/query-store.ts packages/runtime/src/loader.ts packages/runtime/src/query.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts packages/runtime/src/index.browser.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/inline-js-minifier.test.ts`
- `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-refetch.ts packages/runtime/src/broadcast.ts packages/runtime/src/mutation-submit.ts`
- `pnpm exec vitest --run packages/runtime/src/query-store.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/query-apply.ts packages/runtime/src/query-store.ts packages/runtime/src/query.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/loader.ts packages/runtime/src/query-refetch.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/broadcast.ts packages/runtime/src/query-store.test.ts`
- `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/fragment-targets.ts packages/runtime/src/morph.ts packages/runtime/src/index.browser.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `git diff --check`

## Phase 5 - Server

Goal: server extraction is subtractive, with one request/document/static-export path and stable
diagnostic seams.

Closed evidence so far:

- App-shell request handler, document assembly, node adapter, Vite plugin/build helpers, static
  export inventory, and dry-run export target validation have landed.
- Server static export now validates dry-run target plans the same way as write exports; duplicate
  asset paths produce FW229 even without `outDir`.
- Server static export now owns the stable FW229 export-task diagnostic type guards/formatting
  consumed by the create-jiso starter and commerce export scripts.
- Docs-site export now consumes the same server-owned FW229 formatting/type guards, and starter,
  commerce, and docs export tasks share the singular Vite stylesheet manifest assertion before
  manifest-backed app-shell static replay.
- Vite plugin `writeBundle` can now run static export from the built app shell while reusing the
  same manifest asset planner and synthetic request replay path.
- SSR Vite dev middleware now defaults to deriving its node adapter from the loaded app's
  SPEC §9.5 `Request -> Response` handler; explicit node-handler exports remain strict for apps
  that add adapter-edge request context.
- Static export replay now enforces SPEC §9.5 L0/L1-only route documents by rejecting same-origin
  `/_m/` and `/_q/` server endpoint references before generated HTML, `/c/` modules, or assets are
  written.
- Commerce static export now proves that stricter L0/L1 guard end to end by rendering read-only
  public home/cart/login documents while the dynamic commerce shell keeps mutation forms.
- Server static export now exposes a public manifest object for directory-index route documents,
  `/c/` modules, and copied static assets, with Vite manifest-file dry-run helpers proving the
  same manifest-backed asset set as write export.
- Starter and docs-site export tasks now consume the public Vite manifest-file static export
  manifest helper before write export, so generated task output proves the public manifest counts
  for route documents, `/c/` modules, and copied Vite assets.

Open:

- Continue subtractive `packages/server` splits: document/app/replay/static-export boundaries
  should own behavior rather than duplicating root code.
- Unify response types and `onError` diagnostic seam.
- Keep app-shell R5/R6/R7 work tracked in `plans/app-shell.md`; mirror only quality risks here.

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
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts plans/app-shell.md`
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "runs the generated starter app-shell request and export proof|serves the generated starter app-shell through the vp dev task|runs .*built stylesheet|formats generated export task diagnostics|scaffolds real template files"`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export|npm run static"`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export-types.ts packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/scripts/export-static.mjs examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs the generated starter app-shell request and export proof|formats generated export task diagnostics"`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell|public commerce shell static output|vp run export"`
- `pnpm exec vitest --run site/scripts/app-shell.test.mjs`
- `pnpm exec vp check packages/server/src/api/app.test.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/scripts/export-static.mjs examples/commerce/scripts/export-static.mjs examples/commerce/src/app-shell.test.ts site/scripts/export-static.mjs site/scripts/app-shell.test.mjs plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-replay.ts packages/server/src/static-export.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`
- `pnpm exec vp check examples/commerce/src/components/product-grid.tsx examples/commerce/src/generated/product-grid.tsx examples/commerce/src/app.ts examples/commerce/src/app-shell.ts examples/commerce/src/app-shell.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|runs vp run export with the built stylesheet href|runs npm run static with the built stylesheet href|formats generated export task diagnostics"`
- `pnpm exec vitest --run site/scripts/app-shell.test.mjs`

## Phase 6 - Verification Harness And Commerce

Goal: `@jiso/test` and commerce examples prove behavior through public seams and honest source
ownership.

Closed evidence so far:

- `@jiso/test` split/subpath seams exist for harness operations, verifier diagnostics, SQL
  helpers, and package export compatibility.
- Harness internals import diagnostics/observations from owning seams rather than through root
  verifier barrels.
- Commerce source-truth and generated graph checks are increasingly behavior/artifact based.
- Verifier SQL observation now extracts supported statement text from strings and structured
  statement objects while preserving the original adapter argument.
- `examples/commerce/scripts/emit-graph.mjs` derives commerce memory-DB write sites from
  TypeScript call-expression structure instead of raw source substring membership, preserving
  committed generated touch-graph artifacts from SPEC.md §11.1.
- `@jiso/test/html-fragment` exposes structured `htmlElementFacts` so commerce tests can assert
  rendered page/link/script/body facts through a shared harness seam.
- `@jiso/test/html-fragment` also exposes structured `fwQueryFacts` and `fwFragmentFacts`; package
  export tests pin the subpath seam, and commerce HTTP/mutation tests now assert query payloads,
  fragment targets, and fragment stylesheet hints through those facts.
- `@jiso/test/html-fragment` exposes structured `htmlFormFacts`; package export tests pin the
  subpath seam, commerce form/error tests assert action, method, controls, and error output through
  form/element facts, and `fw-check` delegates HTML element parsing to the same seam.
- `@jiso/test/html-fragment` exposes structured `htmlKeyFacts` and `htmlTextContent`; package
  export tests pin the subpath seam, and commerce list/fragment tests assert framework keys,
  selected text, and route meta through shared facts instead of raw HTML membership.
- `@jiso/test/html-fragment` exposes structured `htmlDocumentFacts` and `htmlJsonScriptFacts`;
  package export tests pin the subpath seam, commerce source-truth/page-hints tests assert title,
  meta, stylesheet, JSON script, body, and static-login text facts through shared helpers, and
  app-shell tests no longer read `scripts/export-static.mjs` source for helper membership.
- Commerce app-shell dev plugin delegation is exercised through exported Vite config seams with a
  fake server module, keeping the local app-shell workflow out of source-text assertions.
- `@jiso/test` verifier tests share `createVerifiedFakeHarness()` and `deferred()` fixtures, and
  query verification now proves AsyncLocalStorage capture isolation while an overlapping mutation
  observes unrelated reads/writes.

Open:

- Remove any remaining example deep-import workflow or document it as a deliberate local test
  fixture, not a user-facing dependency story.
- Keep root `@jiso/test` compatibility but prefer subpath imports in tests and examples.

Recent gates:

- `pnpm exec vitest --run packages/test/src/sql-observer.test.ts packages/test/src/query-verifier.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "renders Tailwind-first stylesheet hints and static utility classes|resolves commerce route meta from loaded cart query data"`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "documents the commerce app-shell dev, serve, and export command matrix|dispatches shell login and logout mutations before guarded admin routes|exports the public commerce shell while the dynamic session shell stays non-exportable|wires vp run export to the public commerce shell static output|wires npm run static to the public commerce shell static output"`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts`
- `pnpm exec tsc -p examples/commerce/tsconfig.json --noEmit --pretty false`
- `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `node --test --test-name-pattern "P3 server renders initial query scripts|D3 deferred stream responses are consumed by the runtime|P4 commerce touch graph is a committed generated artifact|P10 commerce graph assertions answer behavior mechanically|D1 commerce enhanced fragments carry Tailwind stylesheet hints" tests/fw-check.node.mjs`
- `node examples/commerce/scripts/emit-graph.mjs --check`
- `node examples/commerce/scripts/emit-components.mjs --check`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact|P10 commerce graph assertions answer behavior mechanically" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/src/sql-observer.ts packages/test/src/verifier-observation.ts packages/test/src/sql-observer.test.ts packages/test/src/query-verifier.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/test/src/harness-verifier.test.ts packages/test/src/query-verifier.test.ts`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "S2 loader budget and inline enhanced form behavior" tests/fw-check.node.mjs`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts`
- `pnpm exec tsc -p examples/commerce/tsconfig.json --noEmit --pretty false`
- `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 7 - Test Restructuring

Goal: test files should follow module seams, share fixtures deliberately, and assert diagnostics
by code/definition rather than brittle prose.

Closed evidence so far:

- Shared `htmlElementFacts` coverage in `packages/test/src/html-fragment.test.ts` replaces local
  commerce HTML/source probes for i18n script, stylesheet link, body class, and app-shell config
  behavior.
- Shared `fwQueryFacts`/`fwFragmentFacts` coverage in `packages/test/src/html-fragment.test.ts`
  replaces repeated commerce response substring probes for query names, fragment targets, and
  fragment stylesheet hints.
- Shared `htmlFormFacts` coverage in `packages/test/src/html-fragment.test.ts` replaces commerce
  substring probes for mutation form actions, methods, named controls, upload progress markers, and
  rerendered validation output.
- Shared `htmlKeyFacts`/`htmlTextContent` coverage in `packages/test/src/html-fragment.test.ts`
  replaces commerce raw HTML probes for list keys, order rows, deferred fragments, auth forms,
  route meta, and mutation error text.
- `packages/test/src/test-fixtures.ts` now owns shared verified-harness and promise-control helpers
  used by verifier integration/query tests instead of each test file growing local harness setup.

Open:

- Continue splitting monolith package tests when changing the relevant module.
- Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- Keep `plans/*` evidence terse: command list plus current status, not repeated history.

## Current Broad Gates

Latest known broad results from 2026-06-12:

- `pnpm run check` passed after the integrated round86 compiler/Drizzle/app-shell/UI/harness wave.
- `pnpm run test` passed: 178 files, 1835 tests.
- `pnpm run test:browser` passed: Chromium runtime browser suite, 10 tests.
- `pnpm run test:conformance` passed, including Drizzle pinned conformance at 59 tests.
