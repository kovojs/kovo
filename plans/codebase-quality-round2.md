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
      Round91 evidence 2026-06-13: `packages/server/src/static-export-request.ts` owns
      synthetic app-shell replay request construction, and
      `packages/server/src/static-export-client-modules.ts` owns `/c/` module replay/dedupe
      diagnostics, subtracting both from `packages/server/src/static-replay.ts`. Same-session
      evidence: `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`.
      Round92 evidence 2026-06-13: `packages/server/src/static-export-output.ts` owns
      static export asset normalization, output target/path validation, conflict diagnostics,
      source readability checks, and write execution, subtracting output mechanics from
      `packages/server/src/static-export.ts`. Same-session evidence:
      `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`.
      Round93 evidence 2026-06-13: `packages/server/src/vite-build-assets.ts` owns Vite
      static-export asset planning/path validation and `packages/server/src/vite-static-export.ts`
      owns Vite build export/inventory/manifest wrappers, subtracting SPEC §9.5 static export
      task wiring from `packages/server/src/vite-build.ts`. Same-session evidence:
      `pnpm exec vitest --run packages/server/src` and
      `pnpm exec tsc --noEmit --pretty false`.
      Round95 evidence 2026-06-13: `packages/server/src/vite-build-output.ts` owns optional
      plugin-time SPEC §9.5 static export execution/reporting for Vite app-shell builds,
      subtracting static-export result mutation from `packages/server/src/vite.ts`. Same-session
      evidence:
      `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
      and `pnpm exec tsc --noEmit --pretty false`; targeted evidence:
      `pnpm exec vp check packages/server/src/vite-build-output.ts packages/server/src/vite.ts packages/server/src/api/app-shell/vite.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`
      and `git diff --check`.
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
- `tests/fw-check.node.mjs` no longer owns local HTML document-region or element-shape adapters;
  server document, generated render, Vite, deferred-stream, and template checks consume
  `@jiso/test/html-fragment` document-region and element facts directly.
- `examples/commerce/src/source-truth.test.ts` now verifies page hints and enhanced mutation wire
  output with `htmlDocumentFacts`, `fwQueryFacts`, `fwFragmentFacts`, and `htmlKeyFacts` instead
  of local `<fw-query>` regex parsing or raw fragment/key substring membership.
- The inline loader enhanced-form evidence now uses an internally consistent enhanced-form fixture
  (`closest()` selector match plus `getAttribute('enhance')`), so the assertion proves submit
  behavior against the loader's public form-detection contract instead of a stale test double.
- `tests/fw-check.node.mjs` no longer executes the generated commerce `touch-graph.ts` source in
  the P4 gate; the test delegates freshness to `examples/commerce/scripts/emit-graph.mjs --check`
  and then proves the committed graph through `fw-check`, `fw explain query cart`, and registry
  invalidation facts.
- `tests/fw-check.node.mjs` no longer owns local package-script, Vite task, workflow step, or
  command-sequence parsers for the starter/conformance/browser/perf gates; those checks consume
  `@jiso/test/command-fixtures` argv/task/workflow facts, with command execution preserved through
  `execFileSync` argv calls.
- `tests/fw-check.node.mjs` no longer owns local markdown table/section/field/list, Tailwind
  `@source`, or generated source-site parsers; docs/readiness, starter template, and commerce graph
  checks consume `@jiso/test/markdown-fixtures` and `@jiso/test/source-fixtures` seams.
- `tests/fw-check.node.mjs` no longer owns the TypeScript AST scanner for forbidden browser
  architecture facts; the SPEC.md §2 constitution gate consumes structured
  `@jiso/test/source-fixtures` facts pinned by `packages/test/src/source-fixtures.test.ts`.
- `tests/fw-check.node.mjs` no longer owns its local HTTP wire fixture/request-response parser;
  Phase 0 wire gates consume structured `@jiso/test/wire-fixtures` facts while preserving
  byte-for-byte response body pins.
- `tests/fw-check.node.mjs` no longer owns its local `fw-export/v1` CLI-output parser; the D10
  static export gate consumes `@jiso/test/fw-export-fixtures` facts pinned by focused package and
  package-export tests.
- `tests/fw-check.node.mjs` no longer owns local generated server/client/bootstrap module
  executors or DOM fixture shims for compiler-output behavior checks; those checks consume
  `@jiso/test/generated-module-fixtures`, keeping SPEC.md §5.2 emitted artifacts as verification
  inputs rather than app-authored source.
- `tests/fw-check.node.mjs` no longer owns local `fw-explain/v1` prefix/summary/update-target
  parsers or TypeScript virtual-program helpers; commerce/starter graph-answerability and
  registry/type gates consume `@jiso/test/fw-explain-fixtures` and
  `@jiso/test/typescript-fixtures` seams pinned by focused package tests and package exports.
- `tests/fw-check.node.mjs` no longer owns its local Vite+ config evaluator, workflow `vp run`
  task extraction, or acceptance task-order helper; starter, conformance, browser, and perf gates
  consume `@jiso/test/command-fixtures` facts pinned by focused package tests and package exports.

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
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P3 server renders initial query scripts|P2 compiler merges view transition stamps|P3 typed routes validate navigation targets|D1 commerce enhanced fragments carry Tailwind stylesheet hints|P10 starter wires graph assertions into CI|S1 production build proves the compiler 1:1 emit contract|D10 seeded diagnostics gate Vite|D3 deferred stream responses are consumed by the runtime|P1 typed data param coercion|P1 render-equivalence gate" tests/fw-check.node.mjs`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/test-fixtures.ts packages/test/src/harness-operations.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P10 starter wires graph assertions into CI|Conformance suites are an explicit gate|framework-owned browser suite is wired into acceptance|P10 perf acceptance is wired through Playwright and CDP" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/package.json packages/test/src/command-fixtures.ts packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P10 normative docs cover the constitution and compiler hard rules|P10 legibility study packet is ready but not claimed complete|P10 v1 acceptance ledger tracks every freeze criterion|pre-launch checklist is tracked explicitly|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P10 constitution rejects forbidden browser architecture in framework code" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "Phase 0 wire fixtures are present and explicit|Phase 0 wire fixture response bodies match generated contracts byte-for-byte|Phase 0 wire fixture responses keep stable protocol metadata|SSE remains a v2 backlog fixture|D3 deferred stream responses are consumed by the runtime" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/package.json packages/test/src/wire-fixtures.ts packages/test/src/wire-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "D10 seeded diagnostics gate Vite" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "S1 production build proves the compiler 1:1 emit contract|D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces|D3 deferred stream responses are consumed by the runtime|P1 minifier name preservation evidence remains represented|P1 typed data param coercion remains represented|P1 render-equivalence gate remains represented|P2 compiler merges view transition stamps|P3 typed routes validate navigation targets" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/package.json packages/test/src/generated-module-fixtures.ts packages/test/src/generated-module-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact|P1 fragment targets emit typed registry facts|S1 production build proves the compiler 1:1 emit contract" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/package.json packages/test/src/fw-explain-fixtures.ts packages/test/src/fw-explain-fixtures.test.ts packages/test/src/typescript-fixtures.ts packages/test/src/typescript-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
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
- The parse-requiring view/platform/navigation lowering chain now runs through
  `lowerComponentPipelineSequence`, so `compile.ts` no longer hand-chains each source patch/reparse
  step and `model-pipeline.test.ts` proves ordered passes see the latest parsed model.
- Ordered source-patch lowerings now compose their `SourceOffsetMap`s back to the original TSX
  source, so diagnostics after multiple parse-requiring passes are not limited to the final-pass
  offset map.
- Compiler validation now composes navigation/platform/view offset maps with inline-derive prefix
  maps and reports FW311 against the original author source after both lowering phases.

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
- `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts packages/compiler/src/view-transitions.test.ts`
- `pnpm exec vp check packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `git diff --check`
- `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts packages/compiler/src/view-transitions.test.ts`
- `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts`
- `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/navigation-lowering.test.ts`
- `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/query-coverage.test.ts`

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
- Project-mode executable body-local receiver aliases now come from ts-morph Drizzle binding types
  for functions and query loaders, while source-mode body-local destructuring no longer fabricates
  receiver aliases from `{ db }`/`{ tx }` names. Fake context lookalikes stay invisible. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Closure-local helper summaries now fold into callers only when helper receiver parameters are
  supplied by proven Drizzle receiver arguments; calls that pass fake/lookalike receivers no longer
  fabricate parent touch facts while the helper's isolated summary remains visible. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Opaque member helper handoffs that receive proven Drizzle receiver arguments now degrade to
  FW406 in touch/query extraction instead of disappearing, while fake/lookalike receiver arguments
  remain invisible. Evidence: `packages/drizzle/src/static.ts`,
  `packages/drizzle/src/index.test.ts`, `conformance/drizzle-pin/src/index.test.ts`,
  `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Opaque helper calls that receive proven Drizzle receivers through container arguments such as
  `{ db }` now degrade to FW406 in source/project touch extraction and project query-loader
  extraction instead of disappearing, while fake/lookalike container arguments remain invisible.
  Evidence: `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Opaque local helper calls that receive proven Drizzle receivers directly or through body-local
  carrier aliases now degrade to FW406 when the helper's receiver parameters cannot be folded
  under the typed receiver proof rules; fake project-mode carrier aliases remain invisible.
  Evidence: `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Write-chain `insert(...).select(...)` and `update(...).from(...)` read sources now remain
  visible even when the write target is opaque and degrades to FW406. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Detached Drizzle receiver method aliases such as destructured `execute`/`update` and
  `db["$count"]` assignments now degrade to FW406 in source/project touch extraction and project
  query-loader diagnostics, while fake/lookalike method aliases stay invisible. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Unbound ambient source-mode `db`/`tx` receivers no longer fabricate table reads/writes from
  compatibility names; visible direct calls, relational/select reads, detached aliases, and helper
  handoffs degrade to FW406 instead. Computed receiver methods such as `db[method]()` also degrade
  to FW406 for proven Drizzle receivers while fake/lookalike receivers stay invisible. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`,
  and `pnpm exec vitest --run conformance/drizzle-pin`.
- Source query-loader destructured receiver compatibility no longer treats arbitrary object binding
  names as Drizzle receivers; only explicit `{ db }`/`{ tx }` slots keep source-mode compatibility,
  so destructured fake loaders stay invisible instead of fabricating query facts. Evidence:
  `packages/drizzle/src/static.ts`, `packages/drizzle/src/index.test.ts`,
  `conformance/drizzle-pin/src/index.test.ts`, `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.
- Detached receiver method alias calls now stay bound to the resolved ts-morph alias symbol when
  available; same-name shadow bindings no longer fall back to source-name compatibility and
  fabricate FW406 diagnostics. Evidence: `packages/drizzle/src/static.ts`,
  `packages/drizzle/src/index.test.ts`, `conformance/drizzle-pin/src/index.test.ts`,
  `pnpm exec vitest --run packages/drizzle/src`, and
  `pnpm exec vitest --run conformance/drizzle-pin`.

Open:

- Delete remaining bespoke lexer/compat extraction paths once covered by ts-morph facts.
- Continue expanding real `drizzle-orm` coverage for invisible surfaces and callback/helper
  boundaries.
- Keep unsupported surfaces explicit with FW406 and stable source locations.

Recent gates:

- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm exec vitest --run conformance/drizzle-pin`
- `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
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
- Inline-loader generation and `--check` now enforce the SPEC.md §4.4 4KB gzip budget at build
  time, and `inline-loader.test.ts` proves an oversized generated bootstrap is rejected before a
  checked-in artifact can ship. Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run
check:inline-loader`, and `pnpm exec vp check packages/runtime/src/inline-loader-build.ts
packages/runtime/src/inline-loader.test.ts`.
- Inline-loader response parsing now embeds helper declarations extracted from the canonical
  `wire-parser.ts` implementation at build/check time instead of maintaining a standalone
  `readChunks` scanner; the generated artifact calls `readElementChunks` for query and fragment
  response chunks while preserving the SPEC.md §4.4 gzip budget. Same-session evidence:
  `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts
packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`,
  `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm --filter @jiso/runtime run
check:inline-loader`.
- Inline-loader minifier parity is closed beyond artifact and budget checks: the minifier now
  rejects TypeScript-only syntax that the TypeScript parser accepts in JS mode before it can ship
  as inline browser script text, and regex-literal/division boundaries are spaced explicitly so
  minified token hazards stay readable and deterministic (SPEC.md §4.4). Same-session evidence:
  `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
  `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check
packages/runtime/src/inline-js-minifier.ts packages/runtime/src/inline-js-minifier.test.ts
IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
- Runtime apply path split no longer keeps the `apply-path.ts` compatibility facade: the runtime
  barrel exports `apply-mutation-response.ts` and `apply-deferred-stream.ts` directly, and
  `mutation-response.test.ts` proves public barrel exports still share the canonical split-module
  apply functions, malformed-query handling, hooks, and aggregation behavior (SPEC.md §9.1).
  Same-session evidence: `pnpm exec vitest --run packages/runtime/src` and `pnpm exec vitest
--config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`.
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
- Typed submit context implementation is split out of the enhanced/optimistic mutation submitter:
  `submit-context.ts` now owns `ctx.submit` form serialization, action selection, validation
  failure parsing, and public submit-context types, while `mutation-submit.ts` stays focused on
  enhanced form dispatch, fetch/apply, optimistic reconciliation, broadcast, and pending state
  (SPEC.md §9.1/§9.2). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/submit-context.test.ts packages/runtime/src/index.test.ts` and `pnpm exec
vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`.
- Enhanced mutation request fetching is split out of the submitter: `mutation-fetch.ts` now owns
  `FW-Idem`/`FW-Targets` request assembly, keepalive/method/progress fetch options, response body
  reading, sanitized `FW-Changes` parsing, and HTTP failure classification, while
  `mutation-submit.ts` keeps submit/optimism/apply orchestration (SPEC.md §9.1/§10.4).
  Same-session evidence: `pnpm exec vitest --run packages/runtime/src/mutation-fetch.test.ts
packages/runtime/src/index.test.ts packages/runtime/src/mutation-response.test.ts`, `pnpm exec
vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and
  `pnpm exec vp check packages/runtime/src/mutation-fetch.ts
packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/mutation-submit.ts`.
- Mutation response parsing now has one decoded body seam in `wire-parser.ts`:
  `readMutationResponseBodyChunks` owns the `fw-query` plus `fw-fragment` response shape, while
  `apply-mutation-response.ts` consumes decoded chunks for store-only, DOM, and deferred-stream
  runtime paths (SPEC.md §9.1). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts`,
  `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp
check packages/runtime/src/wire-parser.ts packages/runtime/src/apply-mutation-response.ts
packages/runtime/src/wire-parser.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
- Enhanced mutation apply orchestration is split out of the submitter: `mutation-apply.ts` now owns
  fetched response body application, validation-failure local fragment application, successful
  broadcast publication, and optimistic query-truth interposition before morphing; `mutation-submit.ts`
  stays focused on form dispatch, fetch kickoff, pending state, and optimistic lifecycle decisions
  (SPEC.md §9.1/§9.2/§10.4). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/mutation-apply.ts packages/runtime/src/mutation-apply.test.ts
packages/runtime/src/mutation-submit.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
- Enhanced mutation form DOM mechanics are split out of the submitter: `mutation-form.ts` owns
  enhanced-form selector resolution, no-JS fallback/error stamping, and upload-progress element
  updates, while `mutation-submit.ts` keeps submit/optimism orchestration and re-exports the
  public form type (SPEC.md §9.1/§9.2). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/mutation-form.ts packages/runtime/src/mutation-form.test.ts
packages/runtime/src/mutation-submit.ts packages/runtime/src/index.ts
packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
- Visible-return query lifecycle is split from typed-read HTTP refetch: `query-visible-return.ts`
  now owns the hydration/refetch ledger, initial and later `fw-query` script hydration, disposal,
  and the `visibilitychange` listener; `query-refetch.ts` is narrowed to typed-read fetch and
  decoded response application (SPEC.md §4.4/§9.4). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/query-visible-return.ts packages/runtime/src/query-refetch.ts
packages/runtime/src/loader.ts packages/runtime/src/query-refetch.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
- Delegated loader event lifecycle is split out of the root loader: `loader-lifecycle.ts` now owns
  capture listener setup, enhanced-submit interception, delegated fallback dispatch, event-phase
  error reporting, and listener teardown, while `loader.ts` only composes lifecycle helpers and the
  visible-return query ledger (SPEC.md §4.4/§9.1). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, and `pnpm exec vp check
packages/runtime/src/loader.ts packages/runtime/src/loader-lifecycle.ts
packages/runtime/src/loader-lifecycle.test.ts IMPLEMENT_v1.md
plans/codebase-quality-round2.md`.
- Inline query-event hydration now has a runtime-owned seam in `query-events.ts`: inline
  `jiso:query` events parse into canonical query chunks and delegate to the shared
  `query-apply.ts` runtime apply helper, while mutation responses also use that helper for store
  writes and compiled query update plans (SPEC.md §9.1/§9.4). Browser coverage proves global
  inline query events hydrate the store, update DOM bindings, and stop after loader disposal.
  Same-session evidence: `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest
--config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and `pnpm
exec vp check packages/runtime/src/query-events.ts packages/runtime/src/query-apply.ts
packages/runtime/src/apply-mutation-response.ts packages/runtime/src/loader.ts
packages/runtime/src/query.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts
packages/runtime/src/index.browser.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
- Inline query events now carry pre-split `fw-query` wire chunks (`attrs`/`content`) from the
  generated bootstrap into `query-events.ts`, and `wire-parser.ts` owns the reusable
  `readQueryElementChunk` decoder used by both full response bodies and inline hydration. This
  removes the inline-only `JSON.parse` preflight and the empty-query `null` fallback while keeping
  old `body`/`name`/`key` event details normalized through the same parser for deploy skew
  (SPEC.md §6.6/§9.1/§9.4). Same-session evidence: `pnpm exec vitest --run
packages/runtime/src`, `pnpm exec vitest --config vitest.browser.config.ts --run
packages/runtime/src/index.browser.test.ts`, `pnpm --filter @jiso/runtime run
check:inline-loader`, and `pnpm exec vp check packages/runtime/src/wire-parser.ts
packages/runtime/src/query-events.ts packages/runtime/src/inline-loader-build.ts
packages/runtime/src/inline-loader.ts packages/runtime/src/query-store.test.ts
packages/runtime/src/wire-parser.test.ts packages/runtime/src/inline-loader.test.ts
packages/runtime/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
- Visible-return hydration no longer accepts a caller-provided `queryScripts` callback: the
  visible-return installer scans the root through `queryScriptsFromRoot`, and inline
  `jiso:query` hydration reports applied query keys back into the same visible-return ledger used
  by mutation responses and typed reads (SPEC.md §4.4/§9.1/§9.4). Same-session evidence:
  `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest --config
vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
  `pnpm --filter @jiso/runtime run check:inline-loader`, and `pnpm exec vp check
packages/runtime/src/query-visible-return.ts packages/runtime/src/query-events.ts
packages/runtime/src/loader.ts packages/runtime/src/query-refetch.test.ts
packages/runtime/src/query-store.test.ts packages/runtime/src/index.browser.test.ts
IMPLEMENT_v1.md plans/codebase-quality-round2.md`.
- Delegated handler context construction is split out of the dispatcher: `handler-context.ts` now
  owns `data-p-*` parameter coercion, `fw-state` host discovery/read/write, ctx.signal island
  scope allocation/abort, and removed-island signal cleanup, while `handlers.ts` only queues
  state-host dispatches and imports/invokes handler references (SPEC.md §4.7/§9.1). Focused tests
  moved param/state assertions out of `index.test.ts` into `handler-context.test.ts`.
  Same-session evidence: `pnpm exec vitest --run packages/runtime/src`, `pnpm exec vitest
--config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`, and `pnpm
exec vp check packages/runtime/src/handler-context.ts packages/runtime/src/handlers.ts
packages/runtime/src/handler-context.test.ts packages/runtime/src/loader-api.ts
packages/runtime/src/loader.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/morph.ts
packages/runtime/src/mutation-submit.ts packages/runtime/src/mutation-apply.ts
packages/runtime/src/apply-mutation-response.ts packages/runtime/src/index.test.ts
packages/runtime/src/loader-lifecycle.test.ts`.

Open:

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
- `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts packages/runtime/src/apply-deferred-stream.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-refetch.ts packages/runtime/src/broadcast.ts packages/runtime/src/mutation-submit.ts`
- `pnpm exec vitest --run packages/runtime/src/query-store.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/query-apply.ts packages/runtime/src/query-store.ts packages/runtime/src/query.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/loader.ts packages/runtime/src/query-refetch.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/broadcast.ts packages/runtime/src/query-store.test.ts`
- `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/fragment-targets.ts packages/runtime/src/morph.ts packages/runtime/src/index.browser.test.ts plans/codebase-quality-round2.md IMPLEMENT_v1.md`
- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec vitest --run packages/runtime/src/submit-context.test.ts packages/runtime/src/index.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vitest --run packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/index.test.ts packages/runtime/src/mutation-response.test.ts`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/mutation-fetch.ts packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/mutation-submit.ts`
- `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/wire-parser.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/wire-parser.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/mutation-apply.ts packages/runtime/src/mutation-apply.test.ts packages/runtime/src/mutation-submit.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/loader-lifecycle.test.ts`
- `pnpm exec vp check packages/runtime/src/query-visible-return.ts packages/runtime/src/query-refetch.ts packages/runtime/src/loader.ts packages/runtime/src/query-refetch.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/query-visible-return.ts packages/runtime/src/query-refetch.ts packages/runtime/src/loader.ts packages/runtime/src/query-refetch.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/loader.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/loader-lifecycle.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/query-events.ts packages/runtime/src/query-apply.ts packages/runtime/src/apply-mutation-response.ts packages/runtime/src/loader.ts packages/runtime/src/query.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts packages/runtime/src/index.browser.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm exec vp check packages/runtime/src/mutation-form.ts packages/runtime/src/mutation-form.test.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/index.ts packages/runtime/src/mutation-response.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
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
- Server static export now exposes the public `staticExportOutputPlan()` target planner, and
  write export reuses the same planned-write object that dry-run validation builds for route
  documents, `/c/` modules, and static assets.
- Node adapter Early Hints control is now a server-owned option shared by `toNodeHandler()` and
  SSR Vite dev middleware, so create-jiso dev/serve no longer needs a starter-specific Node
  handler to adapt the SPEC §9.5 request shell.
- Static replay now treats same-origin full-URL `/c/` refs in route HTML attributes and `Link`
  headers as the same app-shell client module files as root-relative refs, preserving
  SPEC §4.3 full module URL output while keeping external `/c/` URLs outside static export.
  Evidence: `packages/server/src/static-replay.ts`, `packages/server/src/static-replay.test.ts`,
  `packages/server/src/static-export.test.ts`, and
  `pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`.
- App request dispatch now lives in `packages/server/src/app-request.ts`, so the public
  `packages/server/src/app.ts` aggregate no longer owns the SPEC §9.5 dispatch loop, route
  document assembly, mutation request body/session resolution, or configured error-shell
  rendering. Evidence: `packages/server/src/app-request.ts`, `packages/server/src/app.ts`,
  `packages/server/src/app.test.ts`, `pnpm exec vitest --run packages/server/src`, and
  `pnpm exec tsc --noEmit --pretty false`.
- Static-export document reference discovery now lives in
  `packages/server/src/static-export-document.ts`, leaving `static-replay.ts` to own replay
  execution rather than HTML ref scanning, same-origin `/c/` selection, and SPEC §9.5 L0/L1
  endpoint classification. Evidence: `packages/server/src/static-export-document.ts`,
  `packages/server/src/static-replay.ts`, `packages/server/src/static-replay.test.ts`, and
  `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`;
  `pnpm exec tsc --noEmit --pretty false`.
- Static-export route planning and replayed response validation now live in
  `packages/server/src/static-export-route-plan.ts` and
  `packages/server/src/static-export-response.ts`, leaving `static-export.ts` and
  `static-replay.ts` to orchestrate export/replay without owning route FW229 diagnostics or
  response-shape checks. Evidence:
  `packages/server/src/static-export-route-plan.test.ts`,
  `packages/server/src/static-export-response.test.ts`,
  `pnpm exec vitest --run packages/server/src packages/create-jiso/src/index.test.ts`, and
  `pnpm exec tsc --noEmit --pretty false`.
- Vite build output path selection and compiled `/c/` module writes now live in
  `packages/server/src/vite-build-output.ts`, leaving `vite-build.ts` focused on
  manifest-backed app-shell build construction while the public Vite app-shell barrel remains
  stable. Evidence: `packages/server/src/vite-build-output.ts`,
  `packages/server/src/vite-build.test.ts`, `pnpm exec vitest --run packages/server/src`, and
  `pnpm exec tsc --noEmit --pretty false`.

Open:

- Continue subtractive `packages/server` splits: document/app/static-export boundaries should own
  behavior rather than duplicating root code.
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
- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/api/app-shell/static-export.ts packages/server/src/api/app.test.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/server/src/node.test.ts packages/server/src/vite-dev.test.ts packages/server/src/api/app.test.ts`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts -t "scaffolds real template files|typechecks the generated auth recipe|runs the generated starter app-shell request and export proof|serves the generated starter app-shell through|runs .* with the built stylesheet href|formats generated export task diagnostics"`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check IMPLEMENT_v1.md packages/create-jiso/src/index.test.ts packages/create-jiso/templates/README.md packages/create-jiso/templates/docs/deployment.md packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/templates/src/app-shell.ts packages/create-jiso/templates/vite.config.ts packages/server/src/api/app-shell/node.ts packages/server/src/api/app.test.ts packages/server/src/node.test.ts packages/server/src/node.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-dev.ts plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

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
- `@jiso/test/html-fragment` exposes `htmlDocumentRegions`, `htmlLinkHrefs`, `htmlFormActions`,
  and `htmlFormFields`; package export tests pin the subpath seam, `fw-check` uses document-region
  facts instead of local parsers, and commerce app-shell static/export assertions share link/form
  extraction instead of local wrapper functions.
- Commerce app-shell dev plugin delegation is exercised through exported Vite config seams with a
  fake server module, keeping the local app-shell workflow out of source-text assertions.
- `@jiso/test` verifier tests share `createVerifiedFakeHarness()` and `deferred()` fixtures, and
  query verification now proves AsyncLocalStorage capture isolation while an overlapping mutation
  observes unrelated reads/writes.
- `packages/test/src/test-fixtures.ts` now shares `createRecordingOperationVerifier()` so harness
  operation tests assert captured write/read observations, request override merging, and query
  loader request context through the public operation seam.
- The commerce P4 fw-check gate now treats `emit-graph.mjs --check` as the generated-artifact
  freshness proof and verifies the resulting graph behavior with `fw-check`, `fw explain`, and
  registry facts instead of executing generated TS source.
- `@jiso/test/source-fixtures` exposes structured Tailwind `@source` directive and generated
  source-site facts; package export tests pin the subpath seam, `fw-check` uses it for starter CSS
  and commerce graph line facts, and the P4 graph gate still proves SPEC.md §11.1 graph behavior.
- `@jiso/test/source-fixtures` also exposes structured forbidden-browser-architecture facts;
  package export tests pin the subpath seam, and the P10 constitution gate now consumes those facts
  instead of a local `fw-check` TypeScript parser.
- `@jiso/test/wire-fixtures` exposes structured titled HTTP transcript, request, response, and
  response-only facts; package export tests pin the subpath seam, and Phase 0 `fw-check` wire gates
  consume it instead of a local parser.
- `@jiso/test/fw-export-fixtures` exposes structured `fw-export/v1` HTML artifact, error, and
  summary facts; package export tests pin the subpath seam, and the D10 `fw-check` export gate
  consumes it instead of a local CLI-output parser.
- `@jiso/test/fw-explain-fixtures` exposes structured `fw-explain/v1` field, record, summary,
  and update-target facts for SPEC §5.3 CLI-output gates, while
  `@jiso/test/typescript-fixtures` exposes virtual TypeScript diagnostic and interface-member
  facts for SPEC §5.2 registry/type assertions; `fw-check` consumes both seams instead of owning
  local parsers/helpers.
- `@jiso/test/command-fixtures` exposes reusable Vite+ config loading, workflow `vp run` task
  extraction, and ordered-task assertions for SPEC §16 acceptance gates; `fw-check` consumes those
  facts instead of owning local config-evaluation and ordering helpers.

Open:

- Remove any remaining example deep-import workflow or document it as a deliberate local test
  fixture, not a user-facing dependency story.
- Keep root `@jiso/test` compatibility but prefer subpath imports in tests and examples.

Recent gates:

- `pnpm exec vitest --run packages/test/src/sql-observer.test.ts packages/test/src/query-verifier.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp check packages/test/package.json packages/test/src/fw-explain-fixtures.ts packages/test/src/fw-explain-fixtures.test.ts packages/test/src/typescript-fixtures.ts packages/test/src/typescript-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
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
- `pnpm exec vitest --run packages/test/src/command-fixtures.test.ts packages/test/src/package-exports.test.ts`
- `node --test --test-name-pattern "S2 loader budget and inline enhanced form behavior" tests/fw-check.node.mjs`
- `pnpm exec vitest --run examples/commerce/src/app.test.ts`
- `pnpm exec tsc -p examples/commerce/tsconfig.json --noEmit --pretty false`
- `pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts -t "dispatches shell login and logout mutations before guarded admin routes|exports the public commerce shell while the dynamic session shell stays non-exportable|wires vp run export to the public commerce shell static output|wires npm run static to the public commerce shell static output"`
- `node --test --test-name-pattern "P3 server renders initial query scripts|P2 compiler merges view transition stamps|P3 typed routes validate navigation targets|D1 commerce enhanced fragments carry Tailwind stylesheet hints|P10 starter wires graph assertions into CI|S1 production build proves the compiler 1:1 emit contract|D10 seeded diagnostics gate Vite|D3 deferred stream responses are consumed by the runtime|P1 typed data param coercion|P1 render-equivalence gate" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src/harness-operations.test.ts`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp check tests/fw-check.node.mjs packages/test/src/test-fixtures.ts packages/test/src/harness-operations.test.ts plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P10 normative docs cover the constitution and compiler hard rules|P10 legibility study packet is ready but not claimed complete|P10 v1 acceptance ledger tracks every freeze criterion|pre-launch checklist is tracked explicitly|P10 starter wires graph assertions into CI|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P10 constitution rejects forbidden browser architecture in framework code" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`
- `git diff --check`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "D10 seeded diagnostics gate Vite" tests/fw-check.node.mjs`

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
- Shared `htmlDocumentRegions`/`htmlLinkHrefs`/`htmlFormActions`/`htmlFormFields` coverage in
  `packages/test/src/html-fragment.test.ts` replaces fw-check document-region parsing and commerce
  app-shell local wrapper functions for static-export links, preload links, form actions, and CSRF
  fields.
- `packages/test/src/test-fixtures.ts` now owns shared verified-harness and promise-control helpers
  used by verifier integration/query tests instead of each test file growing local harness setup.
- `packages/test/src/test-fixtures.ts` also owns the recording operation verifier used by
  `harness-operations.test.ts`, replacing that file's local recorder and adding request/context
  seam assertions for mutation and query operation helpers.
- `packages/test/src/command-fixtures.ts` now owns reusable command/workflow fixture facts for
  package scripts, Vite+ task commands, pnpm filter test commands, and shell-free command
  sequences; `packages/test/src/command-fixtures.test.ts` and `package-exports.test.ts` pin the
  public subpath seam consumed by `fw-check`.
- `packages/test/src/markdown-fixtures.ts` and `packages/test/src/source-fixtures.ts` now own
  reusable markdown ledger, Tailwind `@source`, and generated source-site fixture facts; focused
  package tests and package export tests pin the seams consumed by `fw-check`.
- `packages/test/src/source-fixtures.ts` now owns the reusable forbidden-browser-architecture
  scanner fixture; `packages/test/src/source-fixtures.test.ts`,
  `packages/test/src/package-exports.test.ts`, and the targeted P10 `fw-check` node test pin the
  seam.
- `packages/test/src/wire-fixtures.ts` now owns reusable wire fixture parsing; focused
  `wire-fixtures.test.ts`, package export tests, and targeted Phase 0 `fw-check` node tests pin the
  seam.
- `packages/test/src/fw-export-fixtures.ts` now owns reusable `fw-export/v1` output parsing;
  focused `fw-export-fixtures.test.ts`, package export tests, and the targeted D10 `fw-check` node
  test pin the seam.
- `packages/test/src/fw-explain-fixtures.ts` and `packages/test/src/typescript-fixtures.ts` now
  own reusable CLI-output and virtual TypeScript fixture facts; focused package tests, package
  export tests, and targeted `fw-check` node tests pin the seams.
- `packages/test/src/command-fixtures.ts` now also owns reusable Vite+ config loading,
  workflow `vp run` task extraction, and ordered-gate assertions for SPEC §16 acceptance wiring;
  `command-fixtures.test.ts`, package export tests, and targeted `fw-check` node tests pin the
  seam.
- D7 UI H1 wrapper closure evidence: `packages/ui/src/index.test.tsx` now pins vendorable TSX
  wrappers for the styled H1 primitive surface, and `examples/gallery/src/demo-fixtures.test.ts`
  plus `examples/gallery/src/behavior-contracts.test.ts` pin the added static gallery route and
  behavior-contract coverage for collapsible, disclosure, hover-card, and popover.

Open:

- Continue splitting monolith package tests when changing the relevant module.
- Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- Keep `plans/*` evidence terse: command list plus current status, not repeated history.

## Current Broad Gates

Latest known broad results from 2026-06-12:

- `pnpm run check` passed after the integrated compiler/app-shell/UI/Drizzle/runtime/harness wave.
- `pnpm run test` passed from the current file tree: 193 files, 1942 tests.
- `pnpm run test:browser` passed: Chromium runtime browser suite, 11 tests.
- `pnpm run test:conformance` passed, including Drizzle pinned conformance at 70 tests.
