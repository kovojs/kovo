# Codebase Quality Remediation Plan - Round 2

Status: active. Last compacted on 2026-06-12.

This is the current codebase-quality ledger. It supersedes `plans/codebase-quality.md` and the
remaining compiler cleanup from archived `plans/improve-compiler.md`.

Use this file to track what still needs to be done. Keep evidence terse: list the current proof
commands and a short note about what changed. Do not append long historical narratives. Check a
box only when the full item is closed with same-session file and test evidence.

## Checklist

- [x] Phase 0 ledger honesty: false checked items corrected; checklist evidence rule added to
      AGENTS.md; round-1 open work merged here.
- [ ] Phase 1 gate de-tautologization: `tests/fw-check.node.mjs` should verify behavior and
      structured artifacts, not source text or its own test names.
- [ ] Phase 2 compiler IR: one parsed model, explicit source patches and offset maps, validators
      consuming model facts, no compatibility reparses where parser facts are sufficient.
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

## Active Rules

- Keep implementation slices large enough to close a coherent phase surface.
- Evidence must ride with implementation; no evidence-only branches unless fixing this ledger.
- Prefer deleting compatibility wrappers, source-string lowerers, bespoke parsers, and duplicate
  public paths over adding adapters.
- Keep P10 external/non-code evidence separate from implementation progress.
- Preserve dirty main-thread changes, currently `SPEC.md`.

## Phase 1 - Gate De-tautologization

Current state:

- `tests/fw-check.node.mjs` now consumes many shared `@jiso/test` fixtures: HTML fragments,
  generated modules, command/Vite facts, markdown/source facts, MCP, static export, starter
  template, fw-explain, TypeScript, wire, and touch-graph provenance.
- Recent harness work added `@jiso/test/touch-graph-fixtures`, source-site line resolution, and
  commerce touch-graph provenance checks that resolve generated sites back to real source lines.
- Integration fix: `fw-check` now uses the canonical
  `applyDeferredStreamResponseToRuntime` API after runtime compatibility export deletion.

Open:

- Search for remaining custom parsers, raw source membership checks, and generated-artifact
  projections in `tests/fw-check.node.mjs`.
- Replace each with public behavior or structured `@jiso/test` fixture assertions.
- Keep intentional byte-for-byte wire pins.
- Keep create-jiso scaffold checks executable against real generated files, Vite+ tasks, graph
  assertions, and typechecking.

Latest focused evidence:

- `pnpm exec vitest --run packages/test/src/source-fixtures.test.ts packages/test/src/touch-graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts`
- `pnpm run check:build`
- `node --test --test-name-pattern "P4 commerce touch graph|P10 commerce graph assertions" tests/fw-check.node.mjs`
- `pnpm exec vp check packages/test/package.json packages/test/src/source-fixtures.ts packages/test/src/source-fixtures.test.ts packages/test/src/touch-graph-fixtures.ts packages/test/src/touch-graph-fixtures.test.ts packages/test/src/package-exports.test.ts examples/commerce/src/source-truth.test.ts tests/fw-check.node.mjs IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 2 - Compiler IR

Current state:

- The compiler pipeline threads `ComponentPipelineState` through ordered lowerings and composes
  `SourceOffsetMap`s back to the original TSX source.
- View-transition, platform, navigation, inline-derive, and server-render lowering use explicit
  `SourceReplacement` lists through shared pipeline patch helpers.
- Many validators consume parser/model facts: hrefs, bindings, event triggers, markup, component
  contracts, authoring surface, CSS host selector, package prefixes, render-host stamping, query
  shapes, and list-stamp traversal.
- Handler lowering/client emission no longer reparse handler expressions for arrow bodies or
  parameter type inference.
- Shared opening-tag helpers now own parser-span attribute replacement/insertion; server emit,
  view-transition lowering, and static `<Link>` lowering use those helpers.
- Obsolete `removeJsxAttribute(s)` compatibility helpers were deleted.

Open:

- Remove remaining compatibility fallback reparses where parser facts are sufficient.
- Audit production `createSourceFile`, `getText`, `indexOf`, `slice`, and regex usage; keep
  parser/scanner internals and diagnostics, retire source-string lowerers/validators.
- Keep Phase 2 open until source-returning lowering is gone from the compile path or each
  remaining case is explicitly justified.

Latest focused evidence:

- `pnpm exec vitest --run packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/view-transitions.test.ts`
- `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/lower/view-transitions.ts`
- `git diff --check`

## Phase 3 - Drizzle Extraction

Current state:

- Direct Drizzle/project extraction is backed by ts-morph where proven.
- Indirect receiver surfaces now degrade to FW406 instead of fabricating exact facts across:
  destructured receivers, body-local aliases, carrier member aliases, carrier destructuring,
  detached method assignments, property-specific carrier members, direct carrier calls,
  object-spread carrier copies, array-destructured detached methods, and assigned carrier helper
  handoffs.
- Fake/lookalike receivers and overwritten carrier members remain invisible.
- Real `drizzle-orm` conformance covers the latest degradation surfaces.

Open:

- Delete remaining bespoke lexer/compat extraction paths where ts-morph facts can replace them.
- Cover or degrade any remaining invisible source/project query-loader and mutation surfaces.
- Keep SQLite conformance deferred to late hardening; focus v1 on Postgres behavior.

Latest focused evidence:

- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm exec vitest --run conformance/drizzle-pin`
- `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 4 - Runtime

Current state:

- Public compatibility exports for store-only mutation/query/deferred apply paths have been
  removed or narrowed.
- Visible-return hydration, typed-read refetch, mutation responses, deferred streams, and inline
  query events increasingly share canonical runtime apply paths.
- Runtime root exports are explicit rather than wildcarding internal parser/apply helpers.
- Inline-loader generation validates helper closure and minifier/parser parity against modular
  runtime helpers.
- The remaining internal `applyFragmentQueryBody` wrapper was removed; canonical mutation runtime
  apply decodes and applies body chunks directly.
- Readable and minified inline loader builds now have parser parity checks against the canonical
  `wire-parser.ts` helper closure.

Open:

- Audit for any remaining internal compatibility-style apply wrappers after `applyFragmentQueryBody`
  deletion.
- Keep inline-loader readable/minified output mechanically tied to canonical parser helpers.
- Continue splitting large runtime tests along apply/query/loader/minifier seams.
- Re-run browser runtime tests after each apply/loader surface change.

Latest focused evidence:

- `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/inline-js-minifier.test.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/index-exports.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/runtime/src/apply-mutation-response.ts packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 5 - Server And App Shell

Current state:

- Static export output, asset planning, Vite build output, request construction, document replay,
  client-module replay, and compile-diagnostic blocking have been split into focused modules.
- App request document assembly and mutation request handling have been subtracted from the main
  dispatcher.
- Vite app-shell plugin code lives in `vite-plugin.ts`; `vite.ts` is closer to an aggregate.
- Root exports now point at the app-shell owner directly instead of an internal compatibility
  barrel.

Open:

- Continue subtractive extraction until `packages/server/src/index.ts`, Vite, static export,
  replay, document, and app boundaries are small and obvious.
- Finish R5/R6/R7 closure: Vite build/static export/adoption should be proven through server,
  commerce, and starter surfaces.
- Keep one wire-html emitter and one compile/static-export diagnostic seam.
- Delete dead compatibility modules and aliases as soon as tests pin the public replacement.

Latest focused evidence:

- `pnpm exec vitest --run packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts`
- `pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-static-export-options.test.ts`
- `pnpm exec vitest --run packages/server/src`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export-diagnostics.ts packages/server/src/static-export-diagnostics.test.ts packages/server/src/static-export.test.ts IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 6 - Verification Harness And Commerce

Current state:

- Commerce source-truth tests use shared structured facts for graph, HTML/query/fragment/key
  output, source-site provenance, and app-shell command/export behavior.
- `@jiso/test` includes reusable fixture seams for generated modules, fw-explain, TypeScript,
  source/project facts, commands, starter templates, wire, static export, and touch graphs.
- Verifier proxy SQL coverage handles string SQL and structured `{ text }`/`{ sql }` statement
  objects for current gates.

Open:

- Remove remaining commerce-local fixture parsing that belongs in `@jiso/test`.
- Make opaque adapter objects either observable or explicitly documented as unobserved.
- Keep commerce generated artifacts honest: checked in, freshness-gated, and tied to source
  provenance rather than synthetic projections.

Latest focused evidence:

- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `node --test --test-name-pattern "P4 commerce touch graph|P10 commerce graph assertions" tests/fw-check.node.mjs`
- `pnpm run check:build`

## Phase 7 - Test Restructuring

Current state:

- Several package tests have been split out of monoliths along module seams, especially runtime,
  server static export, compiler shared/model-pipeline, and `@jiso/test` fixtures.
- `tests/fw-check.node.mjs` is still large but increasingly delegates mechanics to focused
  package fixtures.

Open:

- When touching a monolith test, move reusable mechanics into package fixtures or focused tests.
- Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- Keep `plans/*` evidence terse: command list plus current status, not repeated history.

## Current Gates

Latest broad gate:

- `pnpm run check` passed after the mini-wave through `37cc7e3` (`e6aca91`, `3df0672`,
  `37cc7e3`): 768 formatted files, 670 lint/typechecked files, and
  7 typechecked example/conformance projects.

Focused gates since that broad run:

- Compiler: shared/navigation/view-transition tests plus exact `vp check` passed through
  `26aa664`.
- Harness: package fixture tests, `pnpm run check:build`, targeted `fw-check`, exact `vp check`,
  and `git diff --check` passed through `4ff2168` plus integration fix `e88a45d`.
- Server/app-shell: static-export diagnostics, Vite/static export tests, full server suite,
  `tsc`, exact `vp check`, and `git diff --check` passed through `b980a06`.
- UI/gallery: toolbar primitive/UI tests, headless primitive lint, gallery generated-artifact
  check, gallery unit/browser suites, exact `vp check`, and `git diff --check` passed through
  `2a1917d`.

Stale but useful broad references:

- `pnpm run test` previously passed from the then-current file tree: 193 files, 1942 tests.
- `pnpm run test:browser` previously passed: Chromium runtime browser suite, 11 tests.
- `pnpm run test:conformance` previously passed, including Drizzle pinned conformance.

## Integration Queue

- Keep five active worker lanes by refilling integrated lanes from the latest main `HEAD`.
