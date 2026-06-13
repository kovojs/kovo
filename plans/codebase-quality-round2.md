# Codebase Quality Remediation Plan - Round 2

Status: active. Last compacted on 2026-06-13.

This is the current implementation ledger for codebase quality work. It supersedes
`plans/codebase-quality.md` and archived `plans/improve-compiler.md` open work.

Keep this file compact: track open work, current risks, latest proving commands, and integration
queue. Do not restore long historical transcripts; preserve durable evidence as concise rollups.

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
- [x] Phase 5 server/app-shell: subtractive server extraction, one request/document/static-export
      path, stable public export boundaries, static export and Vite adoption closed.
- [ ] Phase 6 verification harness and commerce honesty: `@jiso/test` seams prove behavior through
      public fixtures; commerce source/dependency/generated-artifact story is honest.
- [ ] Phase 7 test restructuring: monolith tests split along module seams, shared fixtures used
      deliberately, diagnostics asserted through `diagnosticDefinitions`.

## Operating Rules

- [ ] Prefer large closure-oriented slices that include implementation, tests, and evidence.
- [ ] Keep evidence with implementation; avoid evidence-only branches unless fixing this ledger.
- [ ] Prefer deleting compatibility wrappers, source-string lowerers, bespoke parsers, and duplicate
      public paths over adding adapters.
- [ ] Keep P10 external/non-code launch evidence separate from implementation progress.
- [ ] Preserve dirty main-thread changes while integrating worker branches.

## Phase 1 - Gate De-Tautologization

Current state: `tests/fw-check.node.mjs` now consumes many shared `@jiso/test` fixtures for HTML,
generated modules, command output, Vite, markdown/source facts, MCP, static export, starter
templates, `fw-explain`, TypeScript, wire, touch-graph provenance, compiler diagnostics,
registry/query/deferred-stream behavior, runtime loader smoke, commerce behavior, CLI capture, and
page hints.

- [ ] Search the remaining fw-check monolith for local parsers, raw source membership checks,
      generated-artifact projections, and output-substring ledgers.
- [ ] Replace remaining reusable mechanics with public `@jiso/test` behavior fixtures.
- [ ] Keep intentional byte-for-byte wire pins explicitly scoped.
- [ ] Keep create-jiso scaffold checks executable against real generated files, Vite+ tasks, graph
      assertions, and typechecking.

Latest evidence:

- [x] `serverPageHintsBehaviorFact()` extracted to `@jiso/test/server-fixtures`, with package export
      coverage and `fw-check` consuming the fixture. Verified with server-fixture/package-export
      tests, `pnpm run check:build`, targeted fw-check page-hint gate, commerce source-truth,
      `tsc`, exact `vp check`, and `git diff --check`.
- [x] CLI capture behavior extracted to `@jiso/test/command-fixtures`, replacing local stream patching
      in the D10 fw-check static-export gate. Verified with fixture/export tests, build, targeted
      fw-check, commerce source-truth, `tsc`, exact `vp check`, and `git diff --check`.

## Phase 2 - Compiler IR

Current state: parser-owned model facts now cover component option static values, prop constructor
types, fragment target booleans, server-state query keys, and static CSS template literals. Lowering
uses explicit source patches and offset maps for several high-risk paths. Phase 2 remains open until
remaining source-returning lowerers are retired or justified.

- [ ] Remove remaining compatibility fallback reparses where parser facts are sufficient.
- [ ] Audit production `createSourceFile`, `getText`, `indexOf`, `slice`, and regex usage; keep
      parser/scanner internals and diagnostics, retire source-string lowerers/validators.
- [ ] Keep Phase 2 open until source-returning lowering is gone from the compile path or each
      remaining case is explicitly justified.

Latest evidence:

- [x] Parser facts now drive fragment target prop types: `ObjectLiteralEntry.staticConstructorType`
      covers `String`/`Number`/`Boolean`, and `graph.ts` no longer trims raw prop initializer source.
      Verified with parser, fragment-target, compile-component, registry tests, `tsc`, exact
      `vp check`, and `git diff --check`.
- [x] Parser facts now drive static component CSS: component options expose `staticTemplateValue`
      for no-substitution templates, and `css.ts` no longer reparses `css`/`styles` option source.
      Verified with parser, CSS, compile-component tests, `tsc`, exact `vp check`, and
      `git diff --check`.
- [x] Component option static values replaced raw option source checks for `isomorphic`,
      `fragmentTarget`, and server-state query validation. Verified with focused compiler suites,
      `tsc`, exact `vp check`, and `git diff --check`.

## Phase 3 - Drizzle Extraction

Current state: v1 focuses on Postgres. SQLite/MySQL conformance is deferred to late hardening.
Project-mode and static extraction now cover local aliases, factory/project facts, pg-core barrels,
rest receiver containers, static class callbacks, and several invisible surfaces that degrade with
FW406 instead of fabricated facts.

- [ ] Delete remaining bespoke lexer/compat extraction paths where ts-morph/project facts can
      replace them.
- [ ] Cover or FW406-degrade remaining invisible source/project query-loader and mutation surfaces.
- [ ] Keep conformance tied to real `drizzle-orm` Postgres surfaces, not synthetic facts.

Latest evidence:

- [x] Static class member callbacks now run the same project local-helper and unresolved-surface pass
      as other callback forms. Package and pinned Drizzle conformance tests cover exact helper facts
      and FW406 degradation for unresolved helpers/receiver execution.
- [x] Project-mode receiver containers and rest destructuring degrade unsafe typed containers to
      FW406 while exact receiver member/index access still contributes real facts.

## Phase 4 - Runtime

Current state: runtime mutation body apply, deferred stream chunks, broadcast replay, and mutation
response apply now share canonical apply seams. Inline loader build checks exist and are being
tightened around parser/minifier parity. Runtime test files are partially split by apply/query/loader
boundaries.

- [ ] Continue splitting large runtime tests along apply/query/loader/minifier seams.
- [ ] Finish inline-loader parser/minifier parity so readable and minified output are mechanically
      tied to canonical helpers.
- [ ] Re-run browser runtime tests after each apply/loader surface change.
- [ ] Delete remaining compatibility exports or duplicate wire/apply parsers once replacements are
      proven.

Latest evidence:

- [x] Broadcast replay now threads `onError` into the canonical mutation response apply path and
      loader default BroadcastChannel errors report `mutation-broadcast` phase context. Verified with
      focused and full runtime tests, `tsc`, exact `vp check`, and `git diff --check`.
- [x] Mutation response body application is consolidated through
      `applyMutationResponseBodyToRuntime()` for apply, broadcast replay, and deferred chunks.
      Verified with focused/full runtime suites plus browser mutation-response DOM coverage.
- [x] Runtime scanner/export, root apply, inline HTML adapter, CRLF deferred stream, hydrated query
      retry, typed-read response apply, and query hook failure slices have focused evidence in the
      relevant commits.

## Phase 5 - Server And App Shell

Current state: checked complete. Server/app-shell uses focused public subpaths, a closed
`createApp()` aggregate, one request/document/static-export replay path, directory-index static
export, Vite+ dev/build/export adoption, and guarded SPEC §9.5 boundaries.

- [x] Keep public root/app-shell exports focused around `createApp()`, `createRequestHandler(app)`,
      static export, Vite build/export helpers, client modules, core constructors, and node adapter.
- [x] Keep stale aggregate, SSR alias, flat-output, `distDir`, raw request handler, and partial shell
      compatibility paths deleted or guarded.
- [x] Keep R5/R6/R7 adoption proven through server, starter, commerce, docs/static export, and
      create-jiso tests.

Latest evidence:

- [x] `isJisoApp()` and `createRequestHandler()` reject malformed app aggregates and JS raw-handler
      compatibility shells. Verified with server/API/static-export/Vite/commerce/create-jiso tests,
      `tsc`, exact `vp check`, and `git diff --check`.
- [x] App-shell node helper pruning removed public helper forwards while preserving `toNodeHandler()`.
      Verified with focused server/app-shell/starter tests, `tsc`, exact `vp check`, and
      `git diff --check`.

## Phase 6 - Verification Harness And Commerce

Current state: commerce source-truth and harness tests now consume shared fixtures for source graphs,
stylesheet hints, adoption, mutation/query behavior, verifier diagnostics, receipt upload,
update intent, query harnesses, file fixtures, CLI capture, and page hints.

- [ ] Remove remaining commerce-local fixture parsing that belongs in `@jiso/test`.
- [ ] Make opaque adapter objects either observable or explicitly documented as unobserved.
- [ ] Keep commerce generated artifacts checked in, freshness-gated, and tied to source-truth tests.

Latest evidence:

- [x] Commerce and fw-check behavior fixtures listed in Phase 1 evidence now cover page hints, CLI
      capture, source-truth projections, and reusable server/HTML mechanics through public seams.

## Phase 7 - Test Restructuring

Current state: several monolith mechanics have moved into package fixtures and focused tests.
Remaining work is opportunistic: when touching a broad test, split reusable behavior into a package
fixture or focused test and keep diagnostics tied to `diagnosticDefinitions`.

- [ ] When touching a monolith test, move reusable mechanics into package fixtures or focused tests.
- [ ] Prefer structured assertions and shared fixtures over source-text or output-substring ledgers.
- [ ] Keep `plans/*` evidence terse: current status plus command list, not repeated history.

## Current Gates

- [x] Broad gate after first integration wave through `ea06b9c7`: `pnpm run check` passed on
      844 formatted files, 744 lint/typechecked files, and 7 example/conformance typecheck projects.
- [ ] After the next mini-wave, run at least `pnpm run check`; add `pnpm run test`,
      `pnpm run test:browser`, `pnpm run test:conformance`, and `pnpm run check:build` when touched
      surfaces justify broader gates.

## Integration Queue

- [ ] Integrate `agent/round365-runtime-closure` (`14d052d6`) inline-loader parser parity branch with
      focused runtime gates, then clean its worktree/branch/agent.
- [ ] Continue polling active workers:
      `agent/round364-ui-closure`, `agent/round366-drizzle-closure`,
      `agent/round367-harness-closure`, `agent/round368-appshell-closure`.
- [ ] Refill toward five large-slice worker lanes when disjoint ownership and capacity allow.
