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

Open:

- Search for remaining custom source parsers or raw source membership checks in
  `tests/fw-check.node.mjs` and replace each with behavior/structured artifact assertions.
- Keep byte-for-byte fixture pins where they intentionally prove wire compatibility.
- Keep create-jiso template tests executable: generated files, Vite+ tasks, graph assertions, and
  scaffold typechecking.

Recent gates:

- `node --test --test-name-pattern "P10 starter wires graph assertions into CI|Conformance suites are an explicit gate" tests/fw-check.node.mjs`
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
- `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/emit/client.ts packages/compiler/src/types.ts plans/codebase-quality-round2.md`
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

Open:

- Finish inline-loader build-time minification and checked artifact parity.
- Complete subtractive runtime split of the remaining high-churn root module areas.
- Expand browser/runtime gates where shared wire parsing can affect hydrated query behavior.

Recent gates:

- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`

## Phase 5 - Server

Goal: server extraction is subtractive, with one request/document/static-export path and stable
diagnostic seams.

Closed evidence so far:

- App-shell request handler, document assembly, node adapter, Vite plugin/build helpers, static
  export inventory, and dry-run export target validation have landed.
- Server static export now validates dry-run target plans the same way as write exports; duplicate
  asset paths produce FW229 even without `outDir`.

Open:

- Continue subtractive `packages/server` splits: document/app/replay/static-export boundaries
  should own behavior rather than duplicating root code.
- Unify response types and `onError` diagnostic seam.
- Keep app-shell R5/R6/R7 work tracked in `plans/app-shell.md`; mirror only quality risks here.

Recent gates:

- `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts plans/app-shell.md`

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

Open:

- Remove any remaining example deep-import workflow or document it as a deliberate local test
  fixture, not a user-facing dependency story.
- Keep root `@jiso/test` compatibility but prefer subpath imports in tests and examples.

Recent gates:

- `pnpm exec vitest --run packages/test/src/sql-observer.test.ts packages/test/src/query-verifier.test.ts packages/test/src/package-exports.test.ts`
- `pnpm exec vitest --run packages/test/src`
- `pnpm exec tsc -p examples/commerce/tsconfig.json --noEmit --pretty false`
- `pnpm exec vp run build`
- `node --test --test-name-pattern "P9 verification layer evidence remains represented" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/src/sql-observer.ts packages/test/src/verifier-observation.ts packages/test/src/sql-observer.test.ts packages/test/src/query-verifier.test.ts packages/test/src/package-exports.test.ts tests/fw-check.node.mjs plans/codebase-quality-round2.md`

## Phase 7 - Test Restructuring

Goal: test files should follow module seams, share fixtures deliberately, and assert diagnostics
by code/definition rather than brittle prose.

Open:

- Continue splitting monolith package tests when changing the relevant module.
- Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- Keep `plans/*` evidence terse: command list plus current status, not repeated history.

## Current Broad Gates

Latest known broad results from 2026-06-12:

- `pnpm run check` passed after the integrated compiler/server/runtime/drizzle/harness/UI wave.
- `pnpm run test:browser` passed.
- `pnpm run test:conformance` passed.
- `pnpm run test` failed only because CLI add-catalog expectations had not yet been updated for
  newly added `@jiso/ui` `checkbox`, `switch`, and `toggle` exports; the test was updated in the
  cleanup commit and must be rerun.
