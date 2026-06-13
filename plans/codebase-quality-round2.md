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
fragments, generated modules, command/Vite facts, markdown/source facts, MCP, static export,
starter templates, `fw-explain`, TypeScript, wire, touch-graph provenance, graph facts, and
structured `fw-check/v1` result facts.

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
- `git diff --check`

## Phase 2 - Compiler IR

Current state: the compiler threads `ComponentPipelineState` and `SourceOffsetMap`s through ordered
lowerings. View-transition, platform, navigation, inline-derive, server-render, opening-tag, static
`href()`, and static `<Link>` lowering use explicit patch helpers in several paths. Many validators
now consume parser/model facts instead of regex or source-string facts.

- [ ] Remove remaining compatibility fallback reparses where parser facts are sufficient.
- [ ] Audit production `createSourceFile`, `getText`, `indexOf`, `slice`, and regex usage; keep
      parser/scanner internals and diagnostics, retire source-string lowerers/validators.
- [ ] Keep Phase 2 open until source-returning lowering is gone from the compile path or each
      remaining case is explicitly justified.

Latest evidence:

- `pnpm exec vitest --run packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/view-transitions.test.ts`
- `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/compile-component.test.ts`
- `pnpm exec vitest --run packages/compiler/src/execution-triggers.test.ts packages/compiler/src/compile-component.test.ts`
- exact `pnpm exec vp check ... packages/compiler/src/... plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 3 - Drizzle Extraction

Current state: direct Drizzle/project extraction is backed by ts-morph where proven. A broad set of
indirect receiver, carrier, destructuring, nested destructuring, detached method, helper handoff, and
quoted property surfaces now degrade to FW406 instead of fabricating exact facts. V1 proof is
Postgres-only; SQLite/MySQL conformance is deferred to late hardening.

- [ ] Delete remaining bespoke lexer/compat extraction paths where ts-morph facts can replace them.
- [ ] Cover or degrade remaining invisible source/project query-loader and mutation surfaces.
- [x] Keep SQLite conformance deferred to late hardening; focus v1 on Postgres behavior.
      Evidence: `packages/drizzle/src/drizzle-surface.ts`, `packages/drizzle/src/static.ts`,
      `packages/drizzle/src/index.test.ts`, and `conformance/drizzle-pin/src/index.test.ts` pin the
      Postgres-only v1 surface and deferred SQLite/MySQL degradation.

Latest evidence:

- `pnpm exec vitest --run packages/drizzle/src`
- `pnpm exec vitest --run conformance/drizzle-pin`
- exact `pnpm exec vp check packages/drizzle/src/drizzle-surface.ts packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 4 - Runtime

Current state: store-only mutation/query/deferred compatibility exports have been removed or
narrowed. Visible-return hydration, typed-read refetch, mutation responses, deferred streams, inline
query events, enhanced submit, broadcast, and hydrated query scripts increasingly share canonical
parser/apply helpers. Runtime test coverage has started moving out of `index.test.ts` into focused
query/apply/loader/optimism/morph/delegated-handler integration tests; the broad barrel test is now
focused on loader installation, inline parity, query hydration, enhanced mutation bridge, and
disposal smoke coverage.

- [x] Audit for any remaining internal compatibility-style apply wrappers after `applyFragmentQueryBody`
      deletion.
- [ ] Keep inline-loader readable/minified output mechanically tied to canonical parser helpers.
- [ ] Continue splitting large runtime tests along apply/query/loader/minifier seams.
- [ ] Re-run browser runtime tests after each apply/loader surface change.

Latest evidence:

- `pnpm exec vitest --run packages/runtime/src/index.test.ts packages/runtime/src/delegated-runtime-integration.test.ts`
- `pnpm exec vitest --run packages/runtime/src`
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
- `pnpm --filter @jiso/runtime run check:inline-loader`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vp check packages/runtime/src/index.test.ts packages/runtime/src/delegated-runtime-integration.test.ts IMPLEMENT_v1.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 5 - Server And App Shell

Current state: static export output, asset planning, Vite build output, request construction,
document/client-module replay, app request document assembly, mutation request handling, and SPEC
§9.5 dispatch branches have been split into focused modules. The create-jiso starter imports
app-shell dev/export/static-export helpers from public subpaths and includes a static preview task
that serves exported `dist` output without Vite source fallback.

- [ ] Continue subtractive extraction until `packages/server/src/index.ts`, Vite, static export,
      replay, document, and app boundaries are small and obvious.
- [ ] Finish R5/R6/R7 closure: Vite build/static export/adoption should be proven through server,
      commerce, and starter surfaces.
- [ ] Keep one wire-html emitter and one compile/static-export diagnostic seam.
- [ ] Delete dead compatibility modules and aliases as soon as tests pin the public replacement.

Latest evidence:

- `pnpm exec vitest --run packages/server/src`
- `pnpm exec vitest --run packages/create-jiso/src/index.test.ts`
- focused server/static-export/create-jiso tests for diagnostic seam, starter export, and static
  preview behavior
- `pnpm exec tsc --noEmit --pretty false`
- exact `pnpm exec vp check ... packages/server/src/... packages/create-jiso/... IMPLEMENT_v1.md plans/app-shell.md plans/codebase-quality-round2.md`
- `git diff --check`

## Phase 6 - Verification Harness And Commerce

Current state: commerce source-truth tests use shared structured facts for graph, HTML,
query/fragment/key output, source-site provenance, app-shell command/export behavior, and
`fw-explain` query/mutation/page assertions. `@jiso/test` owns reusable fixture seams for generated
modules, fw-explain, TypeScript, fw-check output, source/project facts, commands, starter templates,
wire, static export, touch graphs, and graph invalidation/consumer facts.

- [ ] Remove remaining commerce-local fixture parsing that belongs in `@jiso/test`.
- [ ] Make opaque adapter objects either observable or explicitly documented as unobserved.
- [ ] Keep commerce generated artifacts honest: checked in, freshness-gated, and tied to source
      provenance rather than synthetic projections.

Latest evidence:

- `pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`
- `pnpm exec vitest --run packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts`
- targeted `node --test --test-name-pattern ... tests/fw-check.node.mjs`
- `pnpm run check:build`

## Phase 7 - Test Restructuring

Current state: runtime, server static export, compiler shared/model-pipeline, and `@jiso/test`
fixture tests have been split out of monoliths along module seams. Runtime query/apply/broadcast,
enhanced-submit, and delegated handler integration coverage now lives in focused runtime tests.
`tests/fw-check.node.mjs` is still large but increasingly delegates mechanics to package fixtures
and structured facts.

- [ ] When touching a monolith test, move reusable mechanics into package fixtures or focused tests.
- [ ] Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- [ ] Keep `plans/*` evidence terse: current status plus command list, not repeated history.

## Current Gates

Latest broad gate:

- `pnpm run check` passed after the Round143/145/146/144/147 integration wave through `6a05b77`:
  inline loader check, 782 formatted files, 682 lint/typechecked files, and 7 typechecked
  example/conformance projects.

Focused gates since that broad run:

- Compiler: source-patch/navigation/view-transition/event-trigger lowerings, focused compiler
  tests, exact `vp check`, and `git diff --check`.
- Harness: shared fixture extraction, commerce source-truth tests, `check:build`, targeted
  `fw-check`, exact `vp check`, and `git diff --check`.
- Server/app-shell: dispatch/static-export/Vite/starter/static-preview slices, full server suite,
  create-jiso focused tests, `tsc`, exact `vp check`, and `git diff --check`.
- Runtime: apply-path cleanup, inline-loader hardening, optimism/morph/query integration test
  splits, full runtime suite, browser runtime, inline-loader check, `tsc`, exact `vp check`, and
  `git diff --check`.
- Drizzle: Postgres-only v1 proof, destructuring/nested/quoted receiver degradation, package
  suite, pinned conformance, exact `vp check`, and `git diff --check`.
- UI/gallery: native-state fixes for number-field, checkbox-group, OTP, scroll-area, and
  field/fieldset, with headless/UI/gallery tests, primitive lint, exact `vp check`, and
  `git diff --check`.

Stale but useful broad references:

- `pnpm run test` previously passed from the then-current file tree: 193 files, 1942 tests.
- `pnpm run test:browser` previously passed: Chromium runtime browser suite, 11 tests.
- `pnpm run test:conformance` previously passed, including Drizzle pinned conformance.

## Integration Queue

- [ ] Integrate completed runtime Round150 branch and run focused runtime gates.
- [ ] Integrate completed harness Round151 branch and run focused harness/commerce gates.
- [ ] Keep five active worker lanes by refilling integrated lanes from the latest main `HEAD`.
