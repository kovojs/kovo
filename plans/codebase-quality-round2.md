# Codebase Quality Remediation Plan — Round 2

Status: not started; findings audited against the repository on 2026-06-11
Companions: `plans/codebase-quality.md` (round 1, largely executed), the archived
`plans/improve-compiler.md` entry in `plans/archive.md` (compiler plan — Phase 2 here
supersedes its remaining cleanup items with an architecture change).
Source: whole-repo quality review (2026-06-11), five parallel package audits: server, runtime,
compiler/core, drizzle/test/better-auth, cli/create-jiso/examples/conformance/repo-hygiene.

Scope difference from round 1: round 1 excluded "toolchain/gate/packaging hygiene" by decision.
Round 2 brings the **fw-check gate and create-jiso template architecture in scope** (Phase 1),
because the gate's restatement assertions tax every other phase in this plan. Publishability
(types/exports/build for npm) remains out of scope.

The diagnosis in one line: the repo repeatedly builds a rigorous mechanism and then routes around
it — an AST parser feeding a string-rewriting pipeline, a verification gate that string-matches
its own source, plan ledgers whose checkboxes outran the code. Round 2 points the existing
discipline at the right layer.

## Progress checklist

- [x] Phase 0 ledger honesty: false `[x]` items corrected in `plans/codebase-quality.md` and
      `IMPLEMENT_v1.md`; checkbox-accuracy rule added to CLAUDE.md/AGENTS.md; checked-item
      re-audit recorded with dated current-state evidence.
- [ ] Phase 1 gate de-tautologization: `tests/fw-check.node.mjs` source-text assertions replaced
      with behavioral checks; create-jiso templates are real files, scaffold is typechecked.
- [ ] Phase 2 compiler IR: single parse, span-patch lowering with offset map, validators consume
      the model; regex rewriting of handler bodies/derives/CSS hosts retired.
- [ ] Phase 3 drizzle extraction on ts-morph end-to-end: bespoke lexers deleted, fact-fabricating
      heuristics removed or degraded to FW406, relational/execute coverage, real drizzle-orm
      integration test.
- [ ] Phase 4 runtime: build-time inline-loader minification with drift-pinning parity tests; DOM
      morph promoted out of the test file; apply-path unification; `index.ts` split subtractively.
- [ ] Phase 5 server: document/app extraction finished subtractively; one wire-html emitter; one
      `onError` diagnostic seam; replay choreography extracted; response types unified;
      `index.ts`/`index.test.ts` split.
- [ ] Phase 6 verification-harness soundness (`@jiso/test`) + commerce example honesty.
- [ ] Phase 7 test-suite restructuring: monolith test files split along module seams, shared
      fixtures, message assertions keyed to `diagnosticDefinitions`.

## Cross-cutting themes (round 2)

1. **String pipelines under the proof surface.** The compiler re-parses source ~15× per compile
   and patches by regex; drizzle regex-parses TypeScript and rewrites AST results back into text;
   both produce **silently wrong output on legal input** (string-literal corruption, dropped
   derives, truncated extraction). These sit directly under the SPEC §1.1 claim.
2. **Self-referential verification.** `tests/fw-check.node.mjs` pins literal substrings of the
   repo's own source/tests; create-jiso's test string-matches its own templates; fw-check
   string-matches the create-jiso test. Refactors break the gate; string-preserving regressions
   pass it.
3. **Additive "extractions."** New modules (`server/src/document.ts`) copy code and leave the
   original exported; each split so far grew the public surface. Extractions must be subtractive.
4. **Drift in duplicated logic, round 2 edition.** The inline loader has measurably diverged from
   the modular runtime (separator, nullish-vs-falsy, dropped `fw-query` key); compiler fact types
   are re-declared in three modules and already differ; the graph schema has three homes.
5. **Ledger integrity.** At least two `[x]` items in round-1/IMPLEMENT ledgers are false. The
   agent workflow treats these files as authoritative; a false checkbox is worse than an open item.

---

## Phase 0 — Ledger honesty (do first; one sitting)

- [x] **Correct the false round-1 checkboxes.**
  - `plans/codebase-quality.md:237` (Phase 5 commerce item) claims the CLI deep import was
    replaced with an `fw` dependency. Reality: `examples/commerce/src/app.ts:24` and
    `app.test.ts:8` still deep-import `../../../packages/cli/src/index.js`; no `fw` dependency
    exists in `examples/commerce/package.json`. Re-open the item (it is executed by Phase 1.4
    and Phase 6 here).
  - `plans/codebase-quality.md` Phase 5 "inline minified loader" claims build-time generation
    from real source (esbuild). Reality: `runtime/src/index.ts:309-316` regex-minifies
    `Function.prototype.toString()` output at module load. Re-open; executed by Phase 4.1.
  - Evidence 2026-06-11: `plans/codebase-quality.md` reopens the Phase 5 aggregate,
    `Inline minified loader`, and commerce-generated-artifacts/deep-import items with dated
    current-state evidence from `packages/runtime/src/index.ts`,
    `examples/commerce/src/app.ts`, `examples/commerce/src/app.test.ts`, and
    `examples/commerce/package.json`.
- [x] **Re-audit every remaining `[x]`** in `plans/codebase-quality.md` and the IMPLEMENT_v1.md
      progress checklist against code, spot-checking the cited evidence. Record corrections in
      the ledger itself with date.
      Evidence 2026-06-11: read-only sub-agent audits checked `IMPLEMENT_v1.md` and
      `plans/codebase-quality.md`; this commit reopens or caveats the overclaimed P1 compiler
      cleanup, P4 drizzle extraction, P7 Redis-negative-test, Phase 5 inline-loader, commerce
      generated-artifact/deep-import, and verifier-proxy items with current file evidence.
- [x] **Add a rule to CLAUDE.md**: a checkbox may be checked only with cited file/test evidence
      verified in the same session; evidence lines name the verifying test or command.
      Evidence 2026-06-11: `CLAUDE.md` and `AGENTS.md` now require same-session evidence for
      plan/roadmap checkbox completion and require leaving weaker or missing evidence open.

Verification: none beyond review — this phase only edits markdown. Checkpoint commit.

## Phase 1 — De-tautologize the gates (unblocks every later phase)

Every later phase renames/moves code that `tests/fw-check.node.mjs` pins as literal substrings.
Do this first or pay it on every commit.

- [ ] **Replace the regex ledger with behavioral assertions** (tests/fw-check.node.mjs:1042-1184
      and siblings). Keep: the byte-for-byte wire-fixture replay (lines ~115-154), the generated
      touch-graph byte pin, the loader size budget. Replace: every
      `assert.match(<source text>, /<substring>/)` over package sources, test names, dependency
      version strings, and literals like `cases: 18` / `wrote 15 files`. Behavioral form: run
      `fwCheck`/`fwExplain` against fixture graphs and assert structured output; run the suite
      the assertion cares about instead of grepping for its name.
      Partial evidence 2026-06-11: the commerce graph intent tranche in
      `tests/fw-check.node.mjs` now parses `examples/commerce/src/generated/graph.json` and
      asserts `fwCheck`/`fwExplain` behavior directly instead of grepping commerce test names,
      touch-graph literals, or property-case counts. The wider source-text ledger remains open.
      Partial evidence 2026-06-11: the P10 commerce graph assertion tranche now exercises
      `fwCheck`/`fwExplain` commerce behavior, FW310/FW311 warning rows, compiler-derived graph
      and registry facts, and generated invalidation facts directly instead of grepping CLI,
      compiler, core, runtime, Vite task, or wrapper source/test names.
      Partial evidence 2026-06-12: the P10 commerce declarative invalidation tranche now reads
      the committed commerce graph artifact and asserts `cart/add` mutation invalidation facts,
      `fwExplain` `manual-invalidates: -`, and consumer update output instead of grepping
      `examples/commerce/src/app.ts` for `invalidate(`.
      Partial evidence 2026-06-12: the P4 commerce touch graph committed-artifact tranche no
      longer scans `examples/commerce/src/app.ts` for write-call line numbers; it asserts the
      parsed `examples/commerce/src/generated/graph.json` touch facts and keeps the allowed
      generated `touch-graph.ts` byte pin tied to those parsed artifact facts.
      Partial evidence 2026-06-11: the `P10 starter wires graph assertions into CI` tranche now
      parses `packages/create-jiso/templates/package.json` and `graph.json`, asserts starter
      graph structure, exercises the real template graph through `fwCheck`/`fwExplain`, evaluates
      the starter Vite task graph, parses CI run steps, CSS `@source` directives, HTML entrypoint
      tags, executable generated client bootstrap wiring, and executes
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts` for scaffold file count,
      Vite bin resolution, generated CSS output coverage, and executable client bootstrap wiring.
      Partial evidence 2026-06-12: the P10 starter client bootstrap tranche now transpiles and
      executes `packages/create-jiso/templates/src/client.ts` with runtime/browser shims, then
      asserts `installJisoLoader`, enhanced mutation fetch, fragment target collection, and
      deferred stream wiring behavior directly instead of parsing runtime import names or object
      keys from template source.
      Verification: `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Partial evidence 2026-06-12: the P10 starter emit-graph tranche now runs
      `packages/create-jiso/templates/scripts/emit-graph.mjs` in an isolated temp template and
      asserts `emit-graph/v1` plus parsed graph equality instead of grepping the emitter import
      or `graphDeclarations` object-key source. The starter template package now proves
      `fw-check` and `graph-assertions` are Vite+ tasks only, avoiding package-script/task-name
      conflicts while CI invokes them through `vp run`.
      Same-session evidence:
      `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`,
      `pnpm run check:build`, and `git diff --check`.
      Partial evidence 2026-06-12: the P10 forbidden browser architecture tranche now parses
      framework package sources with the TypeScript AST and asserts forbidden call/JSX constructs
      from structured nodes instead of grepping source text with regular expressions.
      Verification: `node --test --test-name-pattern "P10 constitution rejects forbidden browser architecture in framework code" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Partial evidence 2026-06-11: the P8 component/endpoints/unguarded/unscoped tranche now uses
      a synthetic graph and direct `fwExplain` assertions for handler captures, derives,
      execution triggers, attribute merges, endpoint listing, unguarded access, and owner-domain
      scope audits instead of grepping CLI implementation symbols or CLI test names.
      Partial evidence 2026-06-11: the P9 static/runtime diagnostic tranche now calls `fwCheck`
      with structured `diagnostics` and `verificationDiagnostics` facts for FW302/FW402/FW403/
      FW404/FW405/FW407/FW408/FW410/FW411 instead of grepping CLI implementation symbols or CLI
      test names.
      Partial evidence 2026-06-12: the D10 Vite diagnostic transform tranche now executes the
      built transformed server modules and asserts parsed rendered button attributes plus handler
      URL facts instead of grepping transformed module source for `diagnostic-card`. Verification:
      `pnpm run check:build`, `node --test --test-name-pattern "D10 seeded diagnostics gate Vite,
      static export, and MCP red-green surfaces" tests/fw-check.node.mjs`, and `git diff --check`.
      Partial evidence 2026-06-11: the P9 `@jiso/test` harness tranche now imports the built
      harness APIs and exercises mutation execution/CSRF, write/read verification, PGlite raw
      handle and transaction proxying, exempt table behavior, nested SQL read/write extraction,
      row-key predicate checks, FW402/FW404/FW407/FW408/FW410/FW411 messages, and query output
      schema validation instead of grepping `packages/test` source or test names. Verification:
      `node --test tests/fw-check.node.mjs` and `pnpm run check` passed.
      Partial evidence 2026-06-11: the P9 runtime change-record/optimism tranche now exercises
      built runtime APIs for `FW-Changes` parsing/sanitization, malformed header reporting,
      BroadcastChannel publication, keyed optimistic transforms from unified change records, and
      server-truth reconciliation instead of grepping runtime source or test names.
      Partial evidence 2026-06-11: the P4 Drizzle extraction/conformance tranche now keeps the
      `ts-morph` and pinned `drizzle-orm` versions as structured `package.json` assertions, then
      executes `pnpm exec vitest --run packages/drizzle/src/index.test.ts` and
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts` from
      `tests/fw-check.node.mjs` instead of grepping Drizzle implementation symbols,
      package-test names, or conformance-test source.
      Partial evidence 2026-06-11: the conformance wiring tranche now parses package scripts, CI
      run steps, and Vite task definitions structurally while keeping the Drizzle package and
      conformance suites executable, instead of grepping Vite/CI source text for conformance task
      names.
      Partial evidence 2026-06-12: the conformance gate tranche now discovers
      `conformance/*/package.json` manifests, keeps only the explicit Drizzle/better-auth version
      pins, runs the Drizzle package test, and executes the real `pnpm run test:conformance` gate
      from `tests/fw-check.node.mjs` instead of asserting Vite task command literals, CI step
      strings, or individual conformance package names. Verification: `pnpm run check:build` and
      focused `node --test --test-name-pattern "Conformance suites are an explicit gate"
      tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the conformance gate Vite assertion now parses
      `vite.config.ts` into task records, derives the `conformance` command's package filters,
      and asserts them plus task inputs against discovered `conformance/*/package.json`
      manifests instead of grepping Vite source with `includes`. Verification:
      `pnpm run check:build`, `node --test --test-name-pattern "Conformance suites are an
      explicit gate" tests/fw-check.node.mjs`, `pnpm exec vp check tests/fw-check.node.mjs
      plans/codebase-quality-round2.md`, and `git diff --check`.
      Partial evidence 2026-06-11: the P1 render-equivalence tranche now imports the built
      compiler API, asserts `compileComponentModule` render-equivalence checks and
      `assertRenderEquivalence` failure behavior, then asserts the `ERROR RENDER_EQUIV` CLI
      contract by calling `fwCheck` with structured `renderEquivalenceChecks` instead of
      grepping compiler/CLI implementation symbols or test names.
      Partial evidence 2026-06-12: the same P1 render-equivalence tranche now executes the
      generated cart-total server render module and parses rendered HTML attributes instead of
      regex-matching emitted render text. Verification: focused `node --test --test-name-pattern
      "P1 render-equivalence gate remains represented" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-11: the P1 minifier-name tranche now imports the built compiler
      API and asserts `compileComponentModule` handler exports, emitted handler bodies, and
      `collectMinifierReservedNames` output instead of grepping compiler source or compiler test
      names.
      Partial evidence 2026-06-11: the P1 typed-param tranche now asserts compiler-emitted
      `fw-param-types` for number/boolean params and runtime `readElementParams` coercion through
      built compiler/runtime APIs instead of grepping compiler/runtime source or test names.
      Partial evidence 2026-06-11: the P3 initial-query-script tranche now imports the built
      server API and asserts `renderQueryScript`, `renderDocumentQueryScript`, and
      `renderDocument` output directly, including keyed query hydration and escaped
      `</script>` payloads, instead of grepping server source or server test names.
      Partial evidence 2026-06-11: the P2 page-hints tranche now imports the built server API
      and asserts `renderPageHints` suppresses empty speculation rules and de-dupes prerender
      URLs instead of grepping server source or server test names.
      Partial evidence 2026-06-11: the P2 view-transition tranche now imports the built
      compiler API and asserts `compileComponentModule` records view-transition facts, merges the
      CSS declaration into an existing style attribute once, removes `viewTransitionName`, and
      emits the registry type instead of grepping compiler source or compiler test names.
      Partial evidence 2026-06-11: the S1 production-build tranche now executes
      `scripts/prod-emit-check.mjs` and exercises the built `jisoVitePlugin` transform plus dev
      middleware roundtrip for SPEC §5 source-derived handler URLs and 1:1 client/server output
      instead of grepping compiler, Vite plugin, Vite task, or test-name source.
      Partial evidence 2026-06-12: the same S1 production-build tranche now parses the rendered
      server output, fetches the emitted client module through the Vite middleware, executes the
      generated module, and invokes the exported handler instead of regex-matching the transformed
      or served module source. Verification: `node --test --test-name-pattern
      "S1 production build" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-11: the P1 IDREF tranche now imports built core/compiler APIs and
      asserts `diagnosticDefinitions.FW221` plus `compileComponentModule` accept/fail diagnostics
      for literal `for`, `aria-describedby`, and `popovertarget` IDREFs instead of grepping core
      or compiler source/test names.
      Partial evidence 2026-06-11: the P1 static-id tranche now imports built core/compiler APIs
      and asserts `diagnosticDefinitions.FW224` plus `compileComponentModule` diagnostics for
      duplicate literal IDs and static IDs inside repeatable list stamps instead of grepping core
      or compiler source/test names.
      Partial evidence 2026-06-11: the P1 HTML content-model tranche now imports built
      core/compiler APIs and asserts `diagnosticDefinitions.FW225` plus `compileComponentModule`
      accept/fail diagnostics for valid table rows, paragraph block reparenting, and detached
      table rows instead of grepping core or compiler source/test names.
      Partial evidence 2026-06-11: the P1 execution-trigger tranche now imports built
      core/compiler APIs and asserts `diagnosticDefinitions.FW211`/`FW212` plus
      `compileComponentModule` accept/fail diagnostics for delegated events, declared execution
      triggers, justified `on:load`, unjustified eager load, and unknown triggers instead of
      grepping core or compiler source/test names.
      Partial evidence 2026-06-11: the P1 residual-stamp tranche now imports built core/compiler
      APIs and asserts `diagnosticDefinitions.FW226` plus `compileComponentModule` accept/fail
      diagnostics for residual `fw-c` and `fw-deps` stamps against component/query facts instead
      of grepping core or compiler source/test names.
      Partial evidence 2026-06-11: the P1 binding-stamp tranche now imports built core/compiler
      APIs and asserts `diagnosticDefinitions.FW222`/`FW223` plus `compileComponentModule`
      diagnostics for redundant and disagreeing hand-written `data-bind` stamps instead of
      grepping core or compiler source/test names.
      Partial evidence 2026-06-11: the P1 attribute-merge tranche now imports built
      core/compiler APIs and asserts `diagnosticDefinitions.FW231`/`FW232`/`FW233` plus
      `compileComponentModule` diagnostics for duplicate unmergeable attributes,
      primitive-owned ARIA/state overrides, and duplicate binding slots instead of grepping core
      or compiler source/test names.
      Partial evidence 2026-06-11: the P1 fragment-target child tranche now imports built
      core/compiler APIs and asserts `diagnosticDefinitions.FW230` plus `compileComponentModule`
      accept/fail diagnostics for serializable fragment-target children and browser-value child
      captures, including the hoist help text, instead of grepping core or compiler source/test
      names.
      Partial evidence 2026-06-11: the P1 update-coverage tranche now imports built
      core/compiler APIs and asserts `diagnosticDefinitions.FW311`,
      `compileComponentModule.updateCoverage`, compiler FW311 diagnostics, and the `fwCheck`
      coverage warning output instead of grepping core, compiler, or CLI source/test names.
      Partial evidence 2026-06-11: the P3 typed-routes tranche now imports built
      core/server/compiler APIs and asserts `href`/`Link`/`redirect`/`route`, static
      `Link`/`href` lowering, FW220 diagnostics, and route registry emission instead of grepping
      core, compiler, server, or test source names.
      Partial evidence 2026-06-11: the P3 mutation-lifecycle tranche now imports built server
      APIs and asserts guarded transaction ordering, typed-failure rollback, post-commit query
      rerendering with the original request context, and mutation change headers instead of
      grepping server or test source names.
      Partial evidence 2026-06-11: the P3 server data-plane tranche now imports built server
      APIs and asserts query args/guards/context, query endpoint rendering, registry dispatch
      misses, route guard/notFound rendering, CSRF field/token validation, and CSRF-before-guard
      ordering instead of grepping server or test source names.
      Partial evidence 2026-06-11: the P5 morph tranche now imports built runtime APIs and
      asserts `morphStructuralTree` keyed reorder identity, browser-state preservation, keyed
      query updates, append fragment application, and missing-target suppression instead of
      grepping runtime or browser test source names.
      Partial evidence 2026-06-11: the P6 navigation/bfcache tranche now imports built runtime
      APIs and asserts pagehide-only optimism cleanup registration/disposal, pending-stamp
      clearing, keepalive enhanced submit headers, optimistic rollback on pagehide, and later
      server-truth reconciliation instead of grepping runtime source or test names.
      Partial evidence 2026-06-11: the S2 loader-budget tranche now imports the built runtime
      `jisoLoaderSource` artifact and asserts the 4KB gzip budget, dynamic import wrapper,
      declared trigger support, enhanced mutation wire features, fragment parsing, and no-upgrade/
      no-unload constraints instead of grepping runtime source or test names.
      Partial evidence 2026-06-11: the P2 loader-smoke tranche now imports built runtime APIs
      and asserts delegated listener registration without eager imports, load/idle/visible
      trigger dispatch, typed refetch request/application, compiled template stamps, and
      listener disposal instead of grepping runtime/browser source or test names.
      Partial evidence 2026-06-11: the D3 deferred-stream tranche now imports built
      compiler/server/runtime APIs and asserts compiled query update plan facts, generated client
      plan execution, generated bootstrap loader/deferred-apply behavior, ordered
      bindings/derives/stamps application, server deferred stream append/replace ordering,
      bootstrap script hints, and pinned `fixtures/wire/defer-stream.http` application through
      the runtime instead of grepping compiler/server/runtime source or test names. Verification:
      `node --test --test-name-pattern "D3 deferred stream responses are consumed by the runtime"
tests/fw-check.node.mjs` passed.
      Partial evidence 2026-06-11: the browser/perf acceptance wiring tranche now parses package
      scripts, CI run-step order, and Vite task definitions structurally, and imports shared
      browser/perf acceptance contracts consumed by the browser config and P10 perf runner instead
      of grepping config or perf-script source names. Verification: focused
      `node --test --test-name-pattern "framework-owned browser suite|P10 perf acceptance"
      tests/fw-check.node.mjs` passed.
      Partial evidence 2026-06-12: the browser/perf acceptance wiring tranche now derives Vite+
      task names from `package.json`, parses CI task order, parses Vitest/Node task commands into
      config/module facts, and imports the configured acceptance metadata/perf runner entrypoint
      instead of asserting whole command literals. Verification:
      `node --test --test-name-pattern "framework-owned browser suite|P10 perf acceptance"
      tests/fw-check.node.mjs`, `pnpm exec vp check tests/fw-check.node.mjs
      plans/codebase-quality-round2.md`, and `git diff --check`.
      Partial evidence 2026-06-11: the D2 keyed-commerce tranche now parses the committed
      commerce graph and asserts product/order fragment and optimism facts, then exercises built
      runtime/server APIs for keyed morph identity, keyed query-instance reruns, keyed enhanced
      mutation responses, and keyed optimistic rebase instead of grepping commerce, server, or
      runtime test names.
      Partial evidence 2026-06-11: the P3 commerce transaction-lifecycle tranche now exercises a
      commerce-shaped mutation through the built server APIs, proving the request-scoped
      `transaction` hook commits successful draft writes and rolls back `context.fail()` paths
      instead of grepping commerce source or test names.
      Partial evidence 2026-06-11: the S2 loader-budget tranche still preserves the 4KB gzip
      budget, but now executes the built inline loader in a VM-style DOM/fetch harness and asserts
      enhanced mutation behavior, multi-target refetch headers, query/fragments application, and
      event detail instead of grepping inline loader implementation strings. Verification:
      `node --test --test-name-pattern "S2 loader budget" tests/fw-check.node.mjs`,
      `pnpm run check:build`, `node --test tests/fw-check.node.mjs`, and `pnpm run check`.
      Partial evidence 2026-06-11: the D1 stylesheet-delivery tranche now imports built server
      APIs and asserts page critical-CSS/style hint rendering, target-filtered stylesheet
      manifests, deferred fragment stylesheet links, and enhanced mutation failure-fragment
      stylesheet links instead of grepping commerce, compiler, or server source/test names.
      Partial evidence 2026-06-11: the D4 commerce adopt-dont-invent tranche now parses the
      committed commerce graph for page/mutation metadata and exercises built server/runtime APIs
      for query-derived meta, i18n hints, session parsing, auth/rate-limit guards, storage-backed
      file uploads, enhanced mutation progress/pending stamps, and fragment error boundaries
      instead of grepping commerce, server, or runtime source/test names.
      Partial evidence 2026-06-11: the P5 data-bind query-shape tranche now imports built
      compiler/core APIs and asserts `queryShapesFromFacts`,
      `compileComponentModule` data-bind success/failure diagnostics, ejected list
      `templateStamps`, generated nullable left-join/project shapes, optional nullable paths, and
      FW227 help text instead of grepping compiler or conformance source/test names.
      Partial evidence 2026-06-11: the P3 Drizzle query-facts tranche now uses the built Drizzle
      APIs when importable to assert QueryFact shapes/diagnostics, `diagnosticsForQueryFacts`,
      source/project extraction, instance-key derivation, opaque-projection FW410 diagnostics,
      exempt-table FW411 query diagnostics, write-side exempt omission, non-key predicates, and
      imported table symbol resolution. Current built-bundle import hits the known `__filename`
      ESM issue, so the gate documents that failure and falls back to executable Vitest coverage
      for the same source tests rather than grepping package source or test text. Verification:
      `node --test --test-name-pattern "P3 Drizzle query facts" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-11: the P4 commerce touch-graph tranche now asserts the
      app-facing generated `graph.json` touch facts directly and keeps the generated
      `touch-graph.ts` byte pin, instead of grepping commerce source for generated-artifact import
      strings or extractor absence.
      Partial evidence 2026-06-11: the P1 fragment-target registry tranche now imports built
      core/compiler APIs and asserts `fragmentTarget()` descriptor behavior plus compiler-emitted
      component graph fragments and `FragmentTargets` registry prop types instead of grepping
      core/compiler source or test names.
      Partial evidence 2026-06-11: the P10 doc/ledger/prelaunch tranche now parses markdown
      headings, numbered rules, status fields, and evidence tables for the constitution,
      compiler hard rules, legibility study, v1 acceptance ledger, and pre-launch checklist
      instead of grepping broad doc prose. Verification: focused `node --test
      --test-name-pattern "P10 normative docs|P10 legibility|P10 v1 acceptance|pre-launch
      checklist" tests/fw-check.node.mjs` passed.
- [x] **Make create-jiso templates real files** (`create-jiso/src/index.ts:63-473`, ~470 lines of
      escaped template literals including a CI workflow and double-escaped regexes inside
      `.mjs`-in-string). Move to a `templates/` directory copied at scaffold time with `{{name}}`
      substitution; templates are linted/typechecked as code. Replace the template-substring test
      with: scaffold into a temp dir, run `tsc --noEmit` (and the scaffold's own test script)
      on the result.
      Evidence: `packages/create-jiso/templates/**` contains the scaffold sources and
      `packages/create-jiso/src/index.ts` renders them with `{{name}}` substitution;
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts` scaffolds to temp and passed
      6 tests; `pnpm run check` formatted/linted/typechecked 144/93 files; a temp scaffold generated
      by `node packages/create-jiso/src/index.ts` passed `tsc --noEmit` over generated TS files
      and `vitest --run --root <temp> src/app.fixpoint.test.ts`.
- [x] **Document the test topology** (root README or CONTRIBUTING): the five mechanisms (package
      vitest, browser config, `tests/*.node.mjs`, conformance workspaces, acceptance chain), and
      make `scripts/fw-check.mjs` fail with a "run `vp run build` first" message instead of a raw
      import error when `dist/` is missing (tests/fw-check.node.mjs:5 hidden ordering dep).
      Evidence 2026-06-11: `README.md` documents the five gate mechanisms and acceptance order;
      `scripts/fw-check.mjs` preflights `dist/cli/src/index.mjs` and
      `tests/fw-check.node.mjs` pins the friendly missing-build message.
- [x] **Give the graph schema one home.** Move `FwExplainInput` and friends from
      `cli/src/index.ts:14-241` to `@jiso/core`, with element-level validation (an unknown
      diagnostic code currently crashes `fw` with a raw TypeError —
      `diagnosticDefinitions[lint.code].message` at cli/src/index.ts:1309, :855, :878, :891).
      Compiler `RegistryGraphInput` (compiler/src/graph.ts:33-47) and the CLI consume it; the
      commerce deep imports die here. While in the CLI: collapse the four copy-pasted
      read/write/return dispatch blocks (cli/src/index.ts:300-345), reject unknown flags instead
      of treating them as file paths, fix `fw <unknown>` claiming "not implemented yet" (:347),
      and stop deriving the exit code by scraping formatted output lines (:799-803 — findings
      should be structured first, rendered second).
      Evidence 2026-06-11 for schema sub-slice: `packages/core/src/graph.ts` is the canonical
      home for `FwExplainInput`/graph fact types and `validateFwExplainInput`;
      `packages/cli/src/index.ts` and `packages/compiler/src/graph.ts` consume the core types;
      `examples/commerce/src/app.ts` imports `FwExplainInput` from `@jiso/core`. Unknown
      diagnostic-code validation is covered by `packages/core/src/graph.test.ts` and
      `packages/cli/src/index.test.ts`. Verified with `pnpm run check`,
      `pnpm exec vitest --run packages/core/src/graph.test.ts packages/core/src/diagnostics.test.ts packages/cli/src/index.test.ts packages/compiler/src/index.test.ts examples/commerce/src/app.test.ts`
      (all but the commerce Tailwind build subtest passed; that subtest failed because
      `corepack pnpm --filter @jiso/example-commerce exec which vite` cannot resolve `vite` in
      the side worktree), and
      `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "ships graph facts for fw check and explain acceptance"`.
      Evidence 2026-06-11 for CLI cleanup sub-slice: `packages/cli/src/index.ts` now routes
      check/audit/explain through one `runGraphCommand`/`writeCommandResult` path, parses
      audit/explain flags before reading graph paths, reports unknown commands without implying
      missing implementation, and computes `fwCheck` failure status from structured findings
      before rendering output. `packages/cli/src/index.test.ts` covers unknown diagnostic codes,
      unknown flags, unknown commands, and the existing CLI check families. Verified with
      `pnpm exec vitest --run packages/cli/src/index.test.ts`.

Verification: full `pnpm run acceptance` (the gate is the thing changing — its replacement must
catch a seeded regression: mutate a fixture graph and confirm red). Commit per item.

## Phase 2 — Compiler: make the model the IR

Supersedes the remaining cleanup items from the archived `plans/improve-compiler.md`. The parser migration was
real (`scan/parse.ts` is a clean TS-AST front-end); the architecture migration was not — the
pipeline throws the tree away and communicates via mutated source text.

- [ ] **HIGH — Single parse, span-patch lowering.** `compileComponentModule`
      (compiler/src/index.ts:246-282) chains string→string passes, re-parsing ~15× per compile
      (24 `parseComponentModule` call sites outside scan/, most with fake filename
      `'component.tsx'`; `lowerNavigationSugar` parses 3×, `emitServerModule` 3×,
      `findFragmentTargetFacts` 2×, plus a doubled `serverRenderSource` call at index.ts:282).
      Convert lower passes to produce patch lists (span + replacement) applied once, with an
      offset map back to author source; validators consume the parsed model + offset map.
      This fixes the diagnostic line-drift: `lowerInlineAttributeDerives` prepends synthesized
      exports (lower/inline-derives.ts:109), so FW302/FW227/FW311 positions are computed in
      shifted coordinates; `validateIdrefs`/`validateStampExpressionDrift` are already
      special-cased onto the original source (index.ts:216-220) — make that the rule, not the
      exception.
      Partial evidence 2026-06-11: `compileComponentModule` now passes its already-parsed
      `ComponentModuleModel` into `lowerEventHandlers`, and `lower/handlers.ts` walks that model
      instead of reparsing the lowered source with a fake filename for event-attribute discovery;
      the fallback parser path was removed, so handler lowering now requires its caller-owned
      model explicitly. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/index.ts`.
      Partial evidence 2026-06-11: `findFragmentTargetFacts` now consumes the existing
      `ComponentModuleModel` from `compileComponentModule`, including props-type extraction, so
      fragment-target graph facts no longer reparse lowered source with fake `component.tsx`
      coordinates. Same-session evidence: `pnpm exec vitest --run packages/compiler/src/index.test.ts`
      and `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/graph.ts`.
      Partial evidence 2026-06-11: `lowerNavigationSugar` now consumes the current
      `ComponentModuleModel` from `compileComponentModule` for the `<Link>` lowering pass instead
      of hiding its own initial parse, then parses the post-link source with the author file name
      and applies both static `href()` calls and JSX `href={...}` normalizations through one
      descending replacement pass. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/lower/navigation.ts`.
      Additional evidence 2026-06-12: `lowerNavigationSugar` now returns the
      post-navigation `ComponentModuleModel` with its lowered source, so
      `compileComponentModule` reuses the caller-owned model instead of reparsing after navigation
      lowering. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "navigation|Link|href"`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/lower/navigation.ts plans/codebase-quality-round2.md`.
      Partial evidence 2026-06-11: `validateLiteralHrefs` now consumes the current
      `ComponentModuleModel` from the validator context instead of reparsing source with fake
      `component.tsx` coordinates. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/validate/navigation.ts`.
      Partial evidence 2026-06-11: `lowerInlineAttributeDerives` now consumes the current
      post-navigation `ComponentModuleModel` from `compileComponentModule` instead of hiding its
      own parse, and the pipeline only reparses after navigation when navigation lowering
      actually changed source. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/lower/inline-derives.ts`.
      Additional evidence 2026-06-12: `compileComponentModule` now also reuses the navigation
      model when inline derive lowering is a no-op, removing the last unconditional post-derive
      reparse on files without synthesized derive exports. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "derive|data-bind|query update"`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/lower/inline-derives.ts plans/codebase-quality-round2.md`.
      Partial evidence 2026-06-11: `serverRenderSource` now parses once after handler lowering
      with the author file name and stamps component identity, declared query deps, and initial
      state onto the render host through one in-memory tag update instead of reparsing for each
      stamp; `compileComponentModule` computes that rendered source once and passes it to
      `emitServerModule` instead of calling `serverRenderSource` twice. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/emit/server.ts`.
      Partial evidence 2026-06-11: `lowerViewTransitions` and `lowerPlatformBehaviors` now
      require explicit `ComponentModuleModel` inputs from `compileComponentModule`, removing
      their hidden fake-filename parses and making the post-view-transition parse use the real
      file name. Same-session evidence: `pnpm exec vitest --run packages/compiler/src/index.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/lower/view-transitions.ts packages/compiler/src/lower/platform.ts`.
      Partial evidence 2026-06-11: `serverRenderSource` now consumes the caller-owned
      `ComponentModuleModel` and applies handler attribute rewrites plus render-host stamping in
      one descending patch pass, removing its hidden post-handler parse while preserving native
      host stamps and versioned handler attributes. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/emit/server.ts`.
      Additional evidence 2026-06-12: `packages/compiler/src/shared.ts` now exposes a canonical
      `SourceReplacement`/`applySourceReplacements` helper with ordering and overlap guards, and
      navigation, inline-derive, view-transition, platform-behavior, and server-render lowering
      consume it instead of carrying local string-splice loops. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/shared.test.ts packages/compiler/src/index.test.ts -t "navigation|derive|view transition|platform|server file|Link|data-bind"` and
      `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/shared.test.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/lower/view-transitions.ts packages/compiler/src/lower/platform.ts packages/compiler/src/emit/server.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: static `<Link>` lowering in
      `packages/compiler/src/lower/navigation.ts` now emits source-span replacements and applies
      them through the shared overlap-checked patch helper instead of mutating an output string
      inside the traversal.
      Additional evidence 2026-06-12: client handler expression lowering in
      `packages/compiler/src/emit/client.ts` now emits canonical `SourceReplacement` patches and
      applies them through the shared overlap/out-of-range checked helper instead of a local
      silent source-splice loop.
      Additional evidence 2026-06-12: render-host handler attribute rewriting in
      `packages/compiler/src/emit/server.ts` now applies relative `SourceReplacement` patches
      through the shared checked helper instead of carrying a private descending splice reducer.
      Additional evidence 2026-06-12: inline-derive lowering now returns a generated-to-author
      `SourceOffsetMap`; FW311 diagnostics translate unhandled query-expression spans back to
      author coordinates when synthesized derive exports are prepended. `index.test.ts` pins an
      inline-derive component whose later unhandled expression still reports the authored JSX
      line. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "FW311 positions|inline derive|query-dependent render positions"`
      and
      `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/validate/pipeline.ts packages/compiler/src/validate/component-contracts.ts packages/compiler/src/index.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: inline-derive lowering now builds a replacement-aware
      offset map, not just a prefix offset, so FW311 spans after length-changing inline attribute
      replacements still resolve to the pre-lowering JSX coordinates. `shared.test.ts` pins the
      generated-to-original unchanged-span mapping and `index.test.ts` pins a multi-line drift
      case after a long inline derive replacement.
      Additional evidence 2026-06-12: `generatedOffsetToOriginal` now treats mapped segments as
      half-open ranges while preserving the explicit generated-EOF to original-EOF mapping, so
      offsets inside replacement text stay unmapped and the first offset after replacement text
      maps to the following author span. `shared.test.ts` pins replacement-boundary and EOF
      behavior. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/shared.test.ts`,
      `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/shared.test.ts`,
      and `git diff --check`.
- [x] **HIGH — Retire regex rewriting of handler bodies.** emit/client.ts:89
      (`/\bstate\b/g → ctx.state` corrupts `log('state changed')`), :96 (member-expression
      substitution inside string literals), lower/handlers.ts:262 (harvests params from string
      contents), :277-294 (`splitArguments` is quote-blind). All become AST-node operations on
      the model. Add the adversarial tests first: `'state'` in strings, quoted commas in args,
      member expressions in template literals.
      Evidence 2026-06-11: `emit/client.ts` now rewrites anonymous handler bodies by applying
      TypeScript AST source-span replacements for `state` and serializable element params, so
      string/template literal text is not rewritten. `lower/handlers.ts` now skips quoted and
      template strings while splitting wrapper-call arguments. `packages/compiler/src/index.test.ts`
      covers literal `state`/member-looking text and quoted commas in handler arguments.
      Additional evidence 2026-06-11: `lower/handlers.ts` now discovers serializable element
      member params with a TypeScript AST walk over the handler expression body instead of
      regex-scanning text, so string-literal text such as `"item.id"` no longer fabricates
      `data-p-*` params. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "element params|handler captures|quoted commas|string literal text"`,
      `pnpm exec vitest --run packages/compiler/src/index.test.ts`, and
      `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-11: element-param boolean/number type inference now uses AST
      parent-context checks instead of regexes over the whole handler expression, so numeric- or
      boolean-looking text inside strings cannot change `fw-param-types`; real comparison and
      boolean contexts still infer typed params. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "element param types|element params|handler captures|quoted commas|string literal"`,
      `pnpm exec vitest --run packages/compiler/src/index.test.ts`, and
      `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-12: wrapper-call element param discovery now reads zero-arg
      arrow call arguments from the TypeScript AST instead of using a custom argument splitter.
      The old `splitArguments`/quoted-string/template skipping parser is removed from
      `lower/handlers.ts`; the existing handler tests cover quoted commas, nested arguments, and
      string/template literal text. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "handler captures|quoted commas|element params|element param types|string literal"` and
      `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-12: client handler emission now reads zero-arg arrow bodies
      from the TypeScript AST instead of the `() => ...` regex in `emit/client.ts`, so typed
      arrow handlers such as `(): void => track(item.id)` lower to the same client handler path.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "typed zero-argument|handler captures|quoted commas|element params"` and
      `pnpm exec vp check packages/compiler/src/emit/client.ts packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-11: template-stamp client emission no longer regex-parses
      rendered template HTML to find `data-bind` placeholder text. `collectQueryUpdatePlans`
      records item-binding placeholder text from JSX element spans in `QueryTemplateStampFact`,
      and `emit/client.ts` consumes that model fact directly. `packages/compiler/src/index.test.ts`
      covers a bound element whose text contains another `data-bind` host-looking string. Same-session
      evidence: `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "template stamp|data-bind update plans"`,
      `pnpm exec vitest --run packages/compiler/src/index.test.ts`, and
      `pnpm exec vp check packages/compiler/src/analyze/query-updates.ts packages/compiler/src/emit/client.ts packages/compiler/src/index.test.ts packages/compiler/src/types.ts`.
      Completion audit 2026-06-12: `emit/client.ts` now uses `arrowFunctionBody` and
      `lowerHandlerExpression` TypeScript AST spans for handler-body lowering, while
      `lower/handlers.ts` uses `zeroArgArrowCallArguments` and `serializableMemberExpressions`
      AST walks for element-param discovery. The old `splitArguments` helper and the original
      whole-source body regexes are absent; remaining regexes in these modules are identifier
      validation or attribute-name normalization, not handler-body rewriting. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "handler captures|quoted commas|element params|element param types|string literal|typed zero-argument"` and
      `pnpm exec vp check packages/compiler/src/emit/client.ts packages/compiler/src/lower/handlers.ts plans/codebase-quality-round2.md`.
- [x] **HIGH — Kill the derive mega-regex.** validate/bindings.ts:215-216 silently drops any
      `derive()` export whose expression contains `;` in a string or unusual formatting — its
      stamps vanish from `collectQueryUpdatePlans` with no diagnostic. scan/parse.ts already
      walks every CallExpression; use it.
      Evidence 2026-06-11: `scan/parse.ts` now records exported const call initializers and
      `collectQueryUpdatePlans` builds named `derive(...)` facts from the parsed call model
      instead of a whole-source regex. `packages/compiler/src/index.test.ts` covers a multiline
      named derive whose expression contains a semicolon inside a string literal.
      Additional evidence 2026-06-12: `derive([query], param => expression)` argument parsing now
      uses TypeScript parser helpers in `scan/parse.ts` (`stringLiteralArrayValues` and
      `arrowFunctionParts`) instead of local text regexes in `analyze/query-updates.ts`, including
      typed concise arrow parameters and string-literal semicolon expressions. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/analyze/query-updates.ts`,
      and `git diff --check`.
- [ ] **MED — Extract `src/types.ts`; break the layering inversion.** Canonical fact types live
      in index.ts, which imports every phase; phases import back (bindings.ts:15-25, emit/server.ts:10,
      lower/handlers.ts:7), and three modules dodge the cycle with diverging private structural
      copies (emit/client.ts:4-32, emit/registry.ts:7-32, component-contracts.ts:21-55 — the
      last already lacks `source` on `QueryShapeFact`). One types module, delete the copies,
      make index.ts a true barrel + thin orchestrator. Deduplicate `queryShapesFromFacts` (3
      copies), the shape-wrapper quartet (2), `removeJsxAttribute` (2).
      Evidence 2026-06-11: `packages/compiler/src/types.ts` is now the canonical home for
      `CompileComponentOptions`, query/update/shape facts, and `RenderEquivalenceCheck`; the
      client emitter plus binding/navigation/component-contract validators import those types
      directly instead of depending on the index barrel or carrying private structural copies.
      Additional evidence 2026-06-12: query-shape fact conversion and wrapper/object/array
      helpers are now centralized in `packages/compiler/src/types.ts`; the binding and
      component-contract validators import the shared helpers instead of carrying duplicate
      implementations. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "data-bind|FW227|FW311|query update"` and
      `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: query-shape path/name analysis now lives in
      `packages/compiler/src/analyze/query-shapes.ts`; query-update analysis plus the binding and
      component-contract validators import `knownQueryNames`, path validation, path enumeration,
      and nullable traversal helpers from that shared model layer instead of carrying private
      local copies. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/analyze/query-shapes.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: inline-derive lowering now imports the same
      `knownQueryNames` model helper instead of locally rebuilding the component/registry/query
      shape name set, keeping lowering and validation on one query-name analysis path.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/analyze/query-shapes.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: single query-path expression recognition now lives in the
      TypeScript parser front-end as `solePropertyAccessPath`, including optional-chain receiver
      segment mapping (`cart.items?.name`). Inline text/mixed binding lowering, update coverage,
      and binding drift validation consume that parser helper instead of carrying local
      query-path regexes. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/validate/bindings.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `removeJsxAttribute(s)` now live in
      `packages/compiler/src/shared.ts`; navigation and view-transition lowering import the
      shared helper instead of carrying duplicate local copies. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "navigation|view transition|Link"` and
      `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/lower/view-transitions.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: `PackageComponentPrefixFact` now lives in
      `packages/compiler/src/types.ts`; graph facts, markup validation, and the package-prefix
      validator import the canonical type instead of making the core types module depend on a
      validator module. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "package prefix|FW234|IDREF"` and
      `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/graph.ts packages/compiler/src/validate/markup.ts packages/compiler/src/validate/package-prefixes.ts packages/compiler/src/index.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: the compiler validation registry now lives in
      `packages/compiler/src/validate/pipeline.ts`; `packages/compiler/src/index.ts` delegates
      diagnostic collection through that module instead of importing every validator seam
      directly. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/package-prefixes.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/validate/pipeline.ts`.
      Additional evidence 2026-06-12: public compile-result shapes (`CompileResult`,
      `EmittedFile`, `ViewTransitionStamp`) and `createEmptyCompileResult` now live in
      `packages/compiler/src/types.ts`; `index.ts` imports and re-exports them instead of owning
      the fact definitions directly, and view-transition lowering consumes the canonical stamp
      type. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "view transition|registry metadata|server file"`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/types.ts packages/compiler/src/lower/view-transitions.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: compiler-emitted file-kind classification now lives with
      the canonical emitted-file type in `packages/compiler/src/types.ts`, and component-name
      inference now lives with the parsed component model in `packages/compiler/src/scan/parse.ts`;
      `index.ts` imports both instead of carrying local helpers. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "server file|registry metadata|component facts"`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/types.ts packages/compiler/src/scan/parse.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: compiler artifact filename derivation now lives with the
      emitted-file types as `compileArtifactFileNames`; `index.ts` consumes the canonical
      client/css/server/registry file-name record instead of repeating filename construction in
      the orchestration path. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "server file|registry metadata|CSS"`
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/types.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: compiler IR sentinels now live in
      `packages/compiler/src/ir.ts`; client/server/registry/bootstrap/CSS emitters and
      authoring-surface validation import the canonical JS/CSS header constants instead of
      duplicating `@jiso-ir` strings or passing them through `index.ts`. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "ir|FW235|server file|registry metadata|CSS"`
      Additional evidence 2026-06-12: compile orchestration and proof helpers now live in
      `packages/compiler/src/compile.ts`; `packages/compiler/src/index.ts` imports the compiler
      only to wire `jisoVitePlugin` and otherwise acts as a public export surface. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/package-prefixes.test.ts packages/compiler/src/vite.test.ts`,
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/index.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/compiler/src/compile.ts` now centralizes the
      lowering-pipeline model reuse rule in `modelForSourceChange`, so each lowering pass either
      carries forward the caller-owned parsed model or reparses once with the author file name
      only when that pass changed source. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/compile.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/ir.ts packages/compiler/src/css.ts packages/compiler/src/emit/client.ts packages/compiler/src/emit/server.ts packages/compiler/src/emit/registry.ts packages/compiler/src/emit/bootstrap.ts packages/compiler/src/validate/authoring-surface.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: `packages/compiler/src/emit/registry.ts` now consumes
      canonical `FragmentTargetFact`, `PlatformSubstitution`, `QueryUpdatePlanFact`,
      `ViewTransitionStamp`, and handler-lowering export-name types instead of private registry
      structural copies. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "registry metadata|query update|view transition|platform"`
      and
      `pnpm exec vp check packages/compiler/src/emit/registry.ts packages/compiler/src/index.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: registry graph fact shapes (`ComponentGraphFact`,
      `FragmentTargetFact`, `RegistryFacts`, `RegistryGraphInput`, and registry type options)
      now live in `packages/compiler/src/types.ts`; graph derivation, markup validation, and
      registry emission import them from the canonical type module instead of from the graph
      phase. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/package-prefixes.test.ts -t "registry metadata|component facts|package prefix|IDREF"`
      and
      `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/graph.ts packages/compiler/src/emit/registry.ts packages/compiler/src/validate/markup.ts packages/compiler/src/index.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: handler-lowering fact shapes (`HandlerLowering`,
      `ElementParam`, and `ElementParamType`) now live in `packages/compiler/src/types.ts`;
      handler lowering imports the canonical shapes, and client/server/registry emitters no
      longer type-import handler facts from the lowering phase. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "handler captures|element params|registry metadata|server file"`
      and
      `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/emit/client.ts packages/compiler/src/emit/server.ts packages/compiler/src/emit/registry.ts plans/codebase-quality-round2.md`.
- [x] **MED — Move analysis out of validate/.** `collectQueryUpdatePlans` and coverage
      classification feed emit, not validation; positions travel through a module-global
      `WeakMap` (`updateCoverageSpans`, bindings.ts:45-48) read back in component-contracts.ts:271.
      An `analyze/` phase with explicit spans in its output kills the side channel.
      Evidence 2026-06-11: `packages/compiler/src/analyze/query-updates.ts` now owns
      `collectQueryUpdatePlans` and `collectQueryUpdateCoverage`; `packages/compiler/src/index.ts`
      imports analysis from `analyze/` instead of `validate/`; `QueryUpdateCoverageFact` carries
      optional `sourceSpan` data directly; `validate/component-contracts.ts` reads that explicit
      fact span for FW311, and `validate/bindings.ts` no longer has `updateCoverageSpans` or
      update-plan collection. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/analyze/query-updates.ts packages/compiler/src/index.test.ts packages/compiler/src/index.ts packages/compiler/src/types.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts`.
      Additional evidence 2026-06-12: the last duplicated query-shape fact conversion helper
      is centralized in `packages/compiler/src/types.ts`, and the analyzer plus validators
      import it instead of carrying local copies. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "data-bind|FW311|query update"` and
      `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts packages/compiler/src/index.ts plans/codebase-quality-round2.md`.
- [x] **MED — CSS host detection onto the model.** css.ts:211/:220/:238 grep the whole module
      with bare regexes (match inside comments/strings). The component option entries are already
      in the parsed model; `scan/text.ts:39`'s `findStringEnd` has no template-interpolation
      handling — retire it where the model suffices, fix it where it must stay (CSS literal
      balancing).
      Evidence 2026-06-11: `emitCssModule` now consumes the already parsed `ComponentModuleModel`
      for component CSS options, explicit component names, and returned render hosts; the source
      scanner remains only as a fallback. `packages/compiler/src/index.test.ts` covers an
      adversarial render body with tag text in a string/comment and proves CSS scopes to the
      returned JSX host instead.
      Additional evidence 2026-06-12: the model-less source scanner fallback is removed from
      `emitCssModule`; CSS options, explicit component names, and render hosts now come from
      `ComponentModuleModel` on the compile path. `packages/compiler/src/index.test.ts` covers
      `css:`/`styles:` text inside render strings/comments and proves it does not emit a CSS
      artifact. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "CSS|css-looking"` and
      `pnpm exec vp check packages/compiler/src/css.ts packages/compiler/src/index.test.ts`.
- [x] **MED — Make the render-equivalence gate real.** emit/server.ts:28-41 compares
      `serverRenderSource(...)` against itself round-tripped through its own escaper — it can
      only fail if the escape pair disagrees. Execute the emitted server module's render against
      the authored render over the test corpus (SPEC §5.2.3's semantic gate, currently
      tautological).
      Evidence 2026-06-11: `packages/compiler/src/emit/server.ts` now executes the emitted
      `renderSource()` body for the artifact side of the check, with `packages/compiler/src/index.test.ts`
      covering an adversarial emitted template escape (`\u0032`) that the old raw extractor would
      have treated as equivalent while actual execution renders different HTML. Verified with
      `pnpm exec vitest --run packages/compiler/src/index.test.ts`, `pnpm run check`,
      `pnpm run check:build`, and `pnpm run check:fw`.
- [x] **LOW** — `validateDirectDbAccess` early-returns after the first offending handler per file
      (component-contracts.ts:174-191); FW201 silently replaces FW210 for handlers that are both
      anonymous and unserializable (lower/handlers.ts:44-62); `graph.ts:1` imports `'./shared.ts'`
      while everything else uses `.js`; `inferComponentName` hides a re-parse in a default
      parameter (index.ts:376).
      Evidence 2026-06-11: compiler diagnostics now preserve both FW210 and FW201 for anonymous
      browser-capturing handlers, and `validateDirectDbAccess` reports FW330 for every mutation
      handler in a file instead of returning after the first offender. Focused adversarial tests
      live in `packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-11: `packages/compiler/src/graph.ts` now uses the same `.js`
      local import convention as the rest of the compiler package, and `inferComponentName`
      requires the caller's already parsed `ComponentModuleModel` instead of hiding a default
      `parseComponentModule` call. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/graph.ts`.

Verification: compiler vitest + fixpoint + the new adversarial corpus; `fw explain` snapshots
re-pinned only where positions legitimately improve (drift fixes change line numbers — explain
the diff in the commit). Phase 7 splits the test monolith; until then new tests may live in
per-module files started here.

## Phase 3 — Drizzle: AST end-to-end, no fabricated facts

The touch graph is the framework's verification ground truth (SPEC §10-§11); its failure mode
must be "FW406 unresolved," never "silently wrong."

- [ ] **HIGH — Collapse extraction onto ts-morph.** Project mode resolves symbols with the AST,
      then rewrites identifiers into the source string (`__jisoProjectTable0`,
      drizzle/src/index.ts:559-592) and re-feeds the regex pipeline — every regex bug applies to
      both modes. Extract write calls, predicates, projections, and function bodies from AST
      nodes; make source-mode a thin single-file-project wrapper; delete ~700 lines of bespoke
      lexing (`findMatchingBrace` :2097 and `findMatchingParen` :2110 don't skip strings/comments
      while `statementEnd` :1886 and `nextTopLevelEntry` :2056 do; `extractFunctions` regex
      :1571-1595 breaks on parenthesized params; `splitTopLevelArgs` :2010-2027 splits inside
      strings; `tableExpression: [^)]+?` :1774-1776 mangles `alias(products, "p")`).
      Partial evidence 2026-06-11: project-mode domain write callbacks now use ts-morph AST
      extraction for `domain(...).write(...)` callback bodies and typed receiver origins instead
      of feeding callback text through the source-mode callback parser. `packages/drizzle/src`
      covers callback-body extraction and typed receiver origins; `conformance/drizzle-pin`
      covers the real Drizzle receiver/callback authoring surface. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-11: insert-select/update-from read-source extraction now walks
      ts-morph call nodes for `.from(...)`/join calls instead of regex scanning statement text,
      so `.from(products)` inside strings/templates no longer fabricates read facts; opaque
      read-source expressions remain visible as FW406. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "computed table expressions|insert-select read tables from string contents|insert-select source tables|insert-select and update-from"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, and
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts`.
      Additional evidence 2026-06-12: source-mode write extraction now walks ts-morph
      `CallExpression` nodes for `insert`/`update`/`delete` calls instead of regex-scanning
      function body text, so write-like text inside comments and strings no longer fabricates
      touch facts. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "comments and strings|direct Drizzle write calls|expression-bodied arrow write handlers|insert-select and update-from"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, and
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: query read-domain extraction, exempt-table diagnostics,
      relational query diagnostics, and join nullability now walk ts-morph `CallExpression` nodes
      instead of regex-scanning query body text, so `.from(...)` and
      `db.query.<table>.findMany(...)` text in comments/strings no longer fabricates query read
      facts or FW406/FW411 diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "right-joined|full-joined|query reads or relational diagnostics"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "right and full joins|AST query-read extraction"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, and
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: touch-graph FW406 marking for receiver-bound
      `db.execute(...)` and `db.query.<table>.findMany/findFirst(...)` calls now walks
      ts-morph `CallExpression` nodes instead of regex-scanning function body text, so comments,
      strings, and templates containing those call spellings no longer fabricate unresolved
      touch-graph sites. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`.
      Additional evidence 2026-06-12: source-mode external-helper FW406 marking now walks
      ts-morph `CallExpression` nodes and AST arguments instead of regex-scanning helper-call
      text, so comments, strings, and templates containing `writeAudit(db)` no longer fabricate
      unresolved touch-graph sites. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "external helper"`.
      Additional evidence 2026-06-12: write predicate extraction now walks ts-morph
      `CallExpression` nodes for real `.where(...)` calls instead of regex-scanning write
      statement text, so `.where(eq(...))` text inside comments and strings no longer fabricates
      row-key touch facts. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "predicate text inside comments and strings|direct parameterized keys|borrow predicates"` and
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`.
      Additional evidence 2026-06-12: source-mode destructured Drizzle receiver aliases now walk
      ts-morph `VariableDeclaration` binding patterns instead of regex-scanning function body text,
      so commented/stringified `const { db: alias } = ...` snippets no longer fabricate FW406
      receiver-call surfaces while real destructured aliases still resolve. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "destructured Drizzle receiver aliases"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`,
      and `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: source-mode function discovery now walks ts-morph
      `FunctionDeclaration`, `FunctionExpression`, and `ArrowFunction` nodes instead of
      regex-scanning declarations and hand-matching function braces/statement ends, so function
      parameters containing nested parentheses no longer hide real Drizzle write surfaces.
      Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "direct Drizzle write calls|expression-bodied arrow write handlers|comments and strings"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      and `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: project-mode Drizzle extraction now disposes each fresh
      ts-morph project after public extraction APIs finish, and source-mode helper parses keep
      source files inside callback-owned lifetimes instead of returning live ts-morph nodes from
      throwaway projects. `packages/drizzle/src/index.test.ts` covers repeated project touch-graph
      extraction with identical file names and changed table domains, preserving SPEC §10-§11's
      requirement that extraction state not fabricate stale touch facts. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "project extraction state|source extraction state"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode local-helper folding now walks ts-morph
      `CallExpression` nodes instead of regex-scanning function body text, so helper names in
      comments, strings, and templates no longer fold unrelated write/read summaries into a
      caller. `packages/drizzle/src/index.test.ts` covers the degradation against SPEC §10-§11's
      "unknown is explicit, never fabricated" touch-graph contract. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "local helper summaries"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: query instance-key extraction now walks ts-morph
      `.where(eq(...))` call nodes instead of regex-scanning the entire query object body, so
      comment/string text containing `where(eq(table.key, input.key))` no longer fabricates
      per-instance invalidation facts. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "instance keys"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode schema import alias extraction now walks
      ts-morph `ImportDeclaration`/`ExportDeclaration` nodes instead of regex-scanning whole
      files, so `import * as schema` and `import { table as alias }` text inside comments,
      strings, or templates no longer fabricates resolved write facts; unresolved table
      expressions degrade loudly to FW406 under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "schema aliases|namespace-imported|named import"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [ ] **HIGH — Remove fact-fabricating heuristics; degrade to FW406.**
      Column type from projection-key name (`/(count|qty|...)$/i` → number, index.ts:993);
      receiver detection by parameter name (`/^(db|tx|...|client|...)$/`, :1856-1858);
      `nullableJoinTables` only matching `.leftJoin` (:1010-1020 — right/full join nullability
      silently dropped). Real column types via the checker (project mode) or Drizzle column
      objects (pinned-runtime mode); unknown → FW406, never a guess.
      Partial evidence 2026-06-11: `packages/drizzle/src/index.ts` no longer infers scalar
      projection shapes from selected alias names such as `count`, `qty`, or `stock`; unresolved
      non-opaque scalar projections are omitted from inferred `shape` and surfaced as FW406
      diagnostics via `unresolvedProjectionDiagnostics`. `packages/drizzle/src/index.test.ts`
      covers computed projection aliases that previously fabricated `string`/`number` facts,
      while updated package and `conformance/drizzle-pin` fixtures use declared Drizzle columns
      when real shape inference is expected. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src` and
      `pnpm exec vitest --run conformance/drizzle-pin`.
      Partial evidence 2026-06-11: `nullableJoinTables` now treats `.rightJoin(...)` as making
      prior left-side relation tables nullable and `.fullJoin(...)` as making both prior relation
      tables and the joined table nullable. `packages/drizzle/src/index.test.ts` covers
      source-mode right joins and project-mode full joins; `conformance/drizzle-pin/src/index.test.ts`
      pins the same behavior against real `drizzle-orm` imports. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "right-joined|full-joined|left-joined"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "right and full joins|left joins"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`, and
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-11: project-mode write targets now resolve only direct table
      identifiers, so computed expressions like `db.update(tableFor(products))` degrade to FW406
      instead of resolving descendant symbols and fabricating touches. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "computed table expressions|insert-select read tables from string contents|insert-select source tables|insert-select and update-from"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, and
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts`.
      Additional evidence 2026-06-12: shorthand select projections such as `db.select({ id })`
      now surface as FW406 unresolved projection diagnostics instead of disappearing from the
      inferred query fact. `packages/drizzle/src/index.test.ts` covers the degradation case.
      Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "shorthand projections"`;
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`;
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: source-mode receiver-name detection now treats only the
      canonical `db`/`tx` surface as proof, so broad parameter names such as `client`, `database`,
      and `writer` no longer fabricate write facts. Project mode carries checker-proven
      `PgDatabase` receiver names into unresolved-surface extraction, preserving typed raw
      `execute` calls as FW406 while ignoring same-shaped fake receivers. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "renamed Drizzle receiver|project raw execute"`;
      `pnpm exec vitest --run packages/drizzle/src`;
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode typed SQL projection shape extraction now
      walks a parsed projection expression instead of regex-matching `sql<T>` text, so string
      contents containing `sql<number>` degrade to FW406 unresolved projections rather than
      fabricating numeric query-shape facts or FW410 opaque-SQL diagnostics. Same-session
      evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "typed sql projections|opaque query projections"`;
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`;
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
- [ ] **HIGH — Cover the invisible read/write surfaces or mark them.** Relational query API
      (`db.query.users.findMany()`) matches neither read (:1138) nor write (:598) extraction;
      `db.execute(sql``)` is skipped by `extractExternalDbArgumentCalls` (:1820). Either
      extract them or emit FW406 for any db-receiving expression the extractor cannot classify —
      the static set must not under-approximate silently.
      Partial evidence 2026-06-11: `packages/drizzle/src/index.ts` now marks receiver-bound
      `db.execute(...)` and relational `db.query.<table>.findMany/findFirst(...)` calls as
      unresolved FW406 touch-graph sites instead of dropping them; relational query facts also
      remain visible with read domains and an FW406 static-projection diagnostic, preserving the
      SPEC §10-§11 "unknown is explicit" contract. `packages/drizzle/src/index.test.ts` covers
      these surfaces. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm run check`, `pnpm run check:build`, and `pnpm run check:fw`.
      Additional evidence 2026-06-12: static element-access raw/relational surfaces now share
      the ts-morph static-member walker, so `db['execute'](...)` and
      `db.query['users']['findMany'](...)` / `db.query['users']['findFirst'](...)` become explicit FW406 touch/query facts
      instead of disappearing; project-mode source rewriting also maps bracket string table keys
      that name real Drizzle table identifiers to synthetic project table facts. Same-session
      evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "element-access|project raw execute"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "element-access relational"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [x] **MED — Make the drizzle-orm coupling real and tested.** The `>=0.45.2 <1` pin is
      decorative: drizzle-orm is never imported, absent from devDeps, and every project test
      fabricates a `declare module "drizzle-orm/pg-core"` shim (index.test.ts:1742, 1791, 1846).
      Add drizzle-orm to devDeps; one integration test using real `pgTable`/`select`/`update`
      against the pinned range; centralize every surface assumption (DB-class-name regex :605,
      table-factory names :763, `jiso()` extraConfig contract :95-97) in one `drizzle-surface.ts`
      so a version bump breaks one file and one test.
      Evidence 2026-06-11: `packages/drizzle/package.json` now declares `drizzle-orm@0.45.2` as
      a package dev dependency while retaining the `>=0.45.2 <1` peer range,
      `packages/drizzle/src/drizzle-surface.ts` centralizes table factory names, DB type
      detection, and the `jiso()` extra-config annotation contract, and
      `packages/drizzle/src/index.test.ts` imports real `drizzle-orm` / `drizzle-orm/pg-core`
      `pgTable`, `eq`, `sql`, `select`, and `update` surfaces to cover extraction assumptions.
      Same-session evidence: `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm --filter @jiso/conformance-drizzle-pin test`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts packages/drizzle/src/drizzle-surface.ts packages/drizzle/package.json pnpm-lock.yaml`,
      and `pnpm run check`.
- [ ] **MED — Split the build-time/runtime seam.** ts-morph is a runtime dependency of the
      package exporting the `jiso()` table annotation (drizzle/package.json:10) — apps importing
      the annotation drag the TS compiler into their production graph. Separate entrypoints:
      runtime (`jiso()`, types) and static (extraction, graph, invalidation). Delete the phantom
      `@jiso/drizzle` dep in test/package.json:11.
      Partial evidence 2026-06-12: `packages/drizzle/package.json` now exposes
      `@jiso/drizzle` as `src/runtime.ts` for the annotation/types entrypoint and
      `@jiso/drizzle/static` as `src/index.ts` for SPEC §10-§11 extraction helpers.
      `packages/drizzle/src/runtime.ts` exports `jiso()` plus type-only graph/annotation types
      without importing `ts-morph`; `packages/drizzle/src/index.test.ts` asserts the root runtime
      module lacks extractor values while the static subpath still exposes them, and
      `conformance/drizzle-pin/src/index.test.ts` imports extraction through the static subpath.
      The dependency-classification cleanup and `packages/test` phantom dependency remain open.
      Same-session evidence: `pnpm exec vitest --run packages/drizzle/src/index.test.ts` and
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: `packages/drizzle/package.json` moved `ts-morph` from
      production `dependencies` to `devDependencies`, and `packages/drizzle/src/index.test.ts`
      asserts the root runtime export remains extractor-free while package metadata keeps
      `ts-morph` out of runtime dependencies. `packages/test/package.json` no longer declares the
      phantom `@jiso/drizzle` dependency after `rg '@jiso/drizzle' packages/test/src` found no
      imports. Same-session evidence: `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`, and
      `pnpm exec vp check packages/drizzle/package.json packages/drizzle/src/index.test.ts packages/test/package.json pnpm-lock.yaml plans/codebase-quality-round2.md`.
- [ ] **LOW** — module-global mutable `sourceExtractionFileId` (:53); fresh ts-morph `Project`
      per `parseSourceFile` call with files re-parsed 3+× per pass (:1457); `IGNORED_LOCAL_CALL_NAMES`
      mixing JS keywords with domain names (:57-71 — a user helper named `insert` is silently
      never folded); shorthand properties dropped by `queryShapeFromObjectLiteral` (:930);
      rename one of the two unrelated `graph.ts` files (compiler vs drizzle).
      Partial evidence 2026-06-12: removed the module-global mutable `sourceExtractionFileId`
      from `packages/drizzle/src/index.ts`; `parseSourceFile` now uses an isolated ts-morph
      `Project` with a deterministic synthetic source file name, and
      `packages/drizzle/src/index.test.ts` covers repeated source-mode and project-mode
      extractions with conflicting same-name tables/shapes to prove no stale AST or file-id state
      leaks between calls. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "does not leak source extraction state"`.

Verification: drizzle vitest + conformance (`drizzle-pin` now exercising the real ORM); commerce
touch-graph byte pin re-checked; adversarial corpus: braces/semicolons in strings, parenthesized
params, relational API, `execute(sql)`, right/full joins, a string column named `discount`.

## Phase 4 — Runtime: one runtime, not two

- [ ] **HIGH — Kill the regex minifier; pin loader/runtime parity.**
      `minifyInlineLoaderSource` (runtime/src/index.ts:309-316) corrupts string literals in
      `Function.prototype.toString()` output — verified: `join('; ')` → `join(';')`, so the
      shipped bootstrap sends a different `FW-Targets` separator than the modular runtime
      (index.ts:1834), masked only by lenient server splitting (server/src/index.ts:1150); the
      comment-stripping pass would truncate any future string containing `//`. Minify with a real
      tool at build time (esbuild transform). Then pin the known inline/modular divergences with
      parity tests: falsy-vs-nullish fragment-target fallback (:185 vs :1934), param-type entry
      requirements (:241 vs handlers.ts:142), dropped `fw-query` `key` attribute (:206), island
      signal scoping (:263), multi-target `FW-Targets`, thrown error messages — through both the
      minified and source loaders. 2026-06-11 bounded slice: runtime now exports the shipped inline
      bootstrap from a pinned JavaScript source literal instead of `Function.prototype.toString()`
      plus regex minify.
      `packages/runtime/src/index.test.ts` executes both the bootstrap source and
      `installInlineJisoLoader`, pinning multi-target `FW-Targets` separator parity,
      nullish-only fragment-target fallback, and keyed `fw-query` event detail. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/index.test.ts`.
      Additional evidence 2026-06-11: `packages/runtime/src/index.ts` now ships a trimmed,
      single-line pre-minified inline bootstrap literal under the `SPEC.md` section 4.4 loader
      budget, and `packages/runtime/src/index.test.ts` pins the shipped source as trimmed,
      single-line, minified, and wrapped as the generated bootstrap installer while still
      executing both `jisoLoaderSource` and `installInlineJisoLoader` through the parity harness.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts packages/runtime/src/wire-parser.test.ts`
      and
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/index.ts` now routes
      `jisoLoaderSource` through exported `createInlineJisoLoaderSource`, giving build tooling and
      tests a single helper for bootstrap source wrapping while the broader esbuild-time
      minification work remains open. `packages/runtime/src/index.test.ts` pins default and custom
      generated bootstrap sources, and compares the minified inline loader's query/fragment
      response effects against exported `applyMutationResponseToDom` for keyed `fw-query`, replace
      fragments, and append fragments. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts` and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index.test.ts`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/index.test.ts` now runs
      generated bootstrap source and `installInlineJisoLoader` through the same delegated-handler
      parity harness as the modular dispatcher, pinning param coercion, malformed param-type
      entries that must remain strings, chained handler state persistence, and invalid/missing
      handler error messages under the `SPEC.md` section 4.4 loader contract. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/index.test.ts`,
      `pnpm exec vp check packages/runtime/src/index.test.ts`, and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted the shipped inline bootstrap literal,
      installer, and source wrapper into `packages/runtime/src/inline-loader.ts`, while
      `packages/runtime/src/index.ts` keeps the public re-export. `packages/runtime/src/inline-loader.test.ts`
      pins the extracted installer source, public generated bootstrap source, 4KB gzip budget,
      custom import expression install path, and wire-contract tokens for multi-target
      separators, keyed queries, fragment-target fallback, and param types. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader.test.ts`
      now executes both the generated bootstrap source and extracted installer source through
      the same fake DOM trigger harness, pinning load, idle, and visible trigger initialization
      parity for the minified inline loader under the `SPEC.md` section 4.4 contract.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
      and
      `pnpm exec vp check packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/index.test.ts`
      now runs the inline response-application parity harness through both generated bootstrap
      source and the extracted installer source, comparing keyed query events plus replace/append
      fragment effects against `applyMutationResponseToDom` under the `SPEC.md` section 4.4
      loader contract. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "inline response application|inline delegated"`
      and
      `pnpm exec vp check packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader.ts`
      now dedupes live `FW-Targets` in the shipped inline collector, matching the modular
      `submitEnhancedMutation` target collection semantics while preserving order and the
      nullish-only `fw-fragment-target` fallback. `packages/runtime/src/index.test.ts` compares
      the actual fetch request tuple from modular submit against both generated bootstrap source
      and the extracted inline installer for duplicate targets, alias targets, empty target
      attributes, id fallback, `FW-Idem`, method, body, and headers. `packages/runtime/src/inline-loader.test.ts`
      pins the minified Set-based collector token alongside the gzip budget. Same-session
      evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
      and
      `pnpm exec vp check packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now holds a readable `SPEC.md` section 4.4 inline-loader source plus deterministic
      string/regex-aware minification helper, and `packages/runtime/src/inline-loader.test.ts`
      fails if that helper no longer reproduces the checked-in shipped minified installer
      byte-for-byte. This reduces drift while the package-level build emission step remains
      open. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
      and
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts`.
- [x] **HIGH — Ship the DOM morph.** The only real keyed DOM morph (focus/selection/scroll
      capture-restore) lives in index.browser.test.ts:12-182; every consumer must rewrite it, and
      the flagship browser test substantially tests its own test code. Promote to a
      `dom-morph.ts` export; the browser test consumes the export. Evidence 2026-06-11:
      `packages/runtime/src/morph.ts` now exports `DomMorphRoot`, `DomMorphTarget`,
      `keyedDomMorph`, and `morphDomElement` with keyed DOM reuse plus focus, selection, and
      scroll capture/restore. `packages/runtime/src/index.browser.test.ts` imports those
      production exports instead of carrying local test-only morph code. Same-session evidence:
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`
      and `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "morph"`.
- [ ] **MED — Unify the apply path.** `submitOptimisticEnhancedMutationDirect`
      (index.ts:1584-1675) re-rolls `applyMutationResponseToDom` inline because the rebaser needs
      an interposition seam the shared function lacks. Add the query-interposition hook; delete
      the parallel path. Also: `parseMutationFailure` (index.ts:1256-1301) rolls its own
      `<fw-error>`/`<output>` regexes — route through wire-parser; delete dead
      `QueryStore.hydrate` (query-store.ts:31-39, never called, divergent error policy vs
      `hydrateQueryScripts`). Evidence 2026-06-11: `applyMutationResponseToDom` now exposes
      query pre-apply and per-query interposition hooks, `submitOptimisticEnhancedMutationDirect`
      routes successful optimistic responses through that shared DOM apply path, compiled query
      plans receive rebased values from the hook, and the dead `QueryStore.hydrate` method was
      removed. Same-session evidence: focused runtime apply/rebase tests and the full
      `packages/runtime/src/index.test.ts` suite.
      Additional evidence 2026-06-11: `packages/runtime/src/index.ts` now routes direct enhanced
      mutation responses, failed optimistic responses, and successful optimistic responses
      through the internal `applyEnhancedMutationResponseBodyToDom` helper. The optimistic
      success test in `packages/runtime/src/index.test.ts` proves server truth is rebased through
      the shared apply path, compiled query derives observe the rebased value, and fragment morph
      runs after that rebased DOM state is visible. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "optimistic|mutation query chunks|enhanced mutations"`,
      `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts packages/runtime/src/index.test.ts`,
      and `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`.
      Additional evidence 2026-06-11: `parseMutationFailure` now uses shared quote-aware
      `tagClose`/`readAttribute` element scanning for `<fw-error>` and `<output>` mutation
      failures instead of local `[^>]*` regexes. `packages/runtime/src/index.test.ts` covers
      enhanced mutation failure payloads where quoted attributes contain `>`, including
      `fw-error`, declared `data-error-code`, and validation `data-error-path` outputs.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "mutation failures|validation output paths"`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index.test.ts`, and
      `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now owns the
      shared mutation/deferred query+fragment body application helper and store-only apply path;
      `packages/runtime/src/index.ts` routes public store and DOM mutation apply APIs through that
      helper while preserving the existing optimistic interposition hook. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "optimistic|mutation query chunks|enhanced mutations|deferred|apply"`
      and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/apply-path.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now owns
      the exported DOM mutation/deferred apply path, including the query interposition hook,
      compiled query plan bridge, and fragment morph application; `packages/runtime/src/index.ts`
      imports and re-exports those apply APIs while retaining only enhanced mutation orchestration.
      `packages/runtime/src/mutation-response.test.ts` covers interposed query values flowing
      through compiled plans before fragment morphing. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/apply-path.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now routes
      store-only and DOM mutation/deferred query chunks through one `applyQueryChunkToStore`
      helper before compiled query plan application, preserving the optimistic interposition
      hook while removing the duplicated default store write path. `packages/runtime/src/mutation-response.test.ts`
      pins keyed query parity between `applyMutationResponse` and `applyMutationResponseToDom`.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "optimistic|mutation query chunks|enhanced mutations|deferred|apply"`,
      `pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [x] **MED — Fix ambient-scope argument override in handlers.ts.**
      `abortRemovedIslandSignals(currentHtml, nextHtml, scope)` ignores its explicit `scope`
      whenever the module-level `activeIslandSignalScope` is set
      (handlers.ts:217: `islandSignalControllersFor(activeIslandSignalScope ?? scope)`).
      Explicit argument wins; audit the other module-level registries (:28-32) for the same
      pattern, and add per-test scope isolation (the 4,435-line suite has zero
      beforeEach/afterEach). Evidence 2026-06-11: `handlers.ts` no longer carries the ambient
      `activeIslandSignalScope`; delegated handler signal creation receives the explicit loader
      scope directly, and `abortRemovedIslandSignals` keys controllers only by its explicit
      `scope` argument. The remaining module registries are WeakMaps keyed by explicit
      scope/element objects. `index.test.ts` now proves that a handler running under one scope can
      explicitly abort a different scope without aborting its own signal. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "scope|signal|handler"`.
- [ ] **MED — One error policy per layer.** `dispatchEnhancedFormSubmit` swallows when `onError`
      exists (index.ts:610-613, including a doubled `if (!options.onError)`) while
      `submitEnhancedMutation` calls `onError` and rethrows (:1556-1558); `readFragmentChunks`
      silently truncates on unbalanced markup (wire-parser.ts:82) while the query path reports.
      Decide, document on the option type, align.
      Partial evidence 2026-06-11: runtime form/mutation layer policy is documented on
      `EnhancedMutationLoaderOptions.onError` and `EnhancedMutationSubmitOptions.onError`; the
      doubled `if (!options.onError)` branch in `dispatchEnhancedFormSubmit` was collapsed into the
      explicit form-layer handled/unhandled branch. `index.test.ts` now verifies that a form-layer
      `onError` prevents loader-level `onError` and native-submit fallback. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src`.
      Additional evidence 2026-06-11: `readFragmentChunks` now reports malformed
      `<fw-fragment>` chunks through the same runtime `onError` path used by query parsing instead
      of silently truncating on missing tag closes or missing closing tags. `wire-parser.test.ts`
      pins malformed fragment reporting, and `index.test.ts` proves mutation DOM application keeps
      valid preceding query/fragment chunks while reporting the malformed fragment. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/wire-parser.ts packages/runtime/src/index.test.ts packages/runtime/src/wire-parser.test.ts`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/mutation-response.ts`
      now owns `FW-Changes` parsing and malformed-header reporting; `mutation-response.test.ts`
      pins the `onError` diagnostic and sanitized broadcast record acceptance. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "FW-Changes|rebroadcast|BroadcastChannel|syncs mutation responses"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/mutation-response.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [ ] **MED — Split `index.ts` subtractively** along its existing seams: `inline-loader.ts`,
      `loader.ts`, `enhanced-mutation.ts`, `optimism.ts`, `query-bindings.ts`, `broadcast.ts`;
      index.ts a pure barrel. Remove the test-shaped production branch in `bindingAttributes`
      (index.ts:1885-1910 — the `Object.entries` arm exists only for `FakeQueryPlanElement`;
      give the fake a real ArrayLike `attributes` instead). Collapse the alias export pairs
      (`applyDeferredChunk`/`applyDeferredChunkToDom`).
      Partial evidence 2026-06-12: extracted `packages/runtime/src/apply-path.ts` as a first
      subtractive runtime seam for mutation/deferred apply body parsing and store application;
      `index.ts` still owns DOM apply, enhanced mutation orchestration, query bindings, aliases,
      and public barrel exports, so the broad split remains open. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "optimistic|mutation query chunks|enhanced mutations|deferred|apply"`
      and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/apply-path.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: extracted `packages/runtime/src/mutation-response.ts`
      for mutation change-header parsing, broadcast message validation, and change-record
      sanitization; `index.ts` now imports those helpers while retaining the public orchestration
      surface. Same-session evidence: `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "FW-Changes|rebroadcast|BroadcastChannel|syncs mutation responses"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/mutation-response.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `bindingAttributes` no longer accepts plain object
      attribute maps for test fakes; `FakeQueryPlanElement` now exposes ArrayLike DOM-shaped
      attributes, removing the test-only production branch while preserving data-bind attribute
      updates. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "data-bind|compiled query update plans"` and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`.
      Partial evidence 2026-06-12: extracted `packages/runtime/src/inline-loader.ts` as the
      subtractive inline-loader seam for the shipped bootstrap literal, installer, and generated
      source helper; `packages/runtime/src/index.ts` now re-exports that surface. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
      and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`.
      Partial evidence 2026-06-12: extracted `packages/runtime/src/mutation-queue.ts` as a
      subtractive seam for named enhanced mutation queue serialization, with the standalone queue
      behavior moved from `packages/runtime/src/index.test.ts` to
      `packages/runtime/src/mutation-queue.test.ts`; `index.ts` keeps the public re-export and
      the monolith keeps only the enhanced-submit integration coverage. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/mutation-queue.test.ts packages/runtime/src/index.test.ts -t "mutation queue|optimistic enhanced submits with the same named queue|unqueued optimistic"`
      and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index.test.ts packages/runtime/src/mutation-queue.ts packages/runtime/src/mutation-queue.test.ts`.
      Partial evidence 2026-06-12: extracted `packages/runtime/src/query-bindings.ts` as the
      subtractive query-binding seam for DOM-light `data-bind`, compiled derives, attribute
      stamps, template stamps, and the query-binding root capability guard; `index.ts` keeps the
      public re-export and only imports the helper needed by mutation/deferred DOM apply.
      `packages/runtime/src/query-bindings.test.ts` pins the extracted seam with DOM-shaped
      ArrayLike attributes, compiled-plan ordering, template-stamp reconciliation, and root
      detection. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-bindings.test.ts packages/runtime/src/index.test.ts -t "query binding|data-bind|compiled query update plans|template stamps|mutation query chunks|deferred|apply"`
      and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/query-bindings.ts packages/runtime/src/query-bindings.test.ts`.
      Partial evidence 2026-06-12: extracted `packages/runtime/src/optimism.ts` as the
      subtractive seam for optimistic transform/rebase state and pagehide cleanup; `index.ts`
      keeps public re-exports and enhanced-mutation integration wiring. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "optimistic|pagehide|enhanced mutations"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/optimism.ts`, and
      `git diff --check`.
- [ ] **LOW** — `hydratedQueries` frozen at install (index.ts:330-342): queries introduced by
      later mutations never become refetch-eligible — fix or document as SPEC-intended;
      `unescapeHtml` missing `&#39;`/`&apos;` (wire-parser.ts:162-168) — pin the server↔runtime
      escaping contract with a shared fixture; `applyQueryBindings` full-document `*` scan per
      chunk (index.ts:1384); consolidate the six near-identical `*Like` element interfaces.
      Partial evidence 2026-06-11: runtime `unescapeHtml` now decodes both apostrophe entity
      spellings used by text/html-compatible wire chunks, and `wire-parser.test.ts` pins the
      SPEC §2 Constitution #4 readable-wire contract for attribute parsing, `<fw-query>` JSON
      bodies, and malformed-JSON reporting. `index.test.ts` also exercises the public mutation
      apply path with `&#39;`/`&apos;` escaped query JSON. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src`.
      Partial evidence 2026-06-11: loader-owned enhanced mutation and typed refetch responses
      now add newly introduced `fw-query` names to the loader refetch ledger, so later visible
      returns can refetch queries that were not present at install time. `index.test.ts` covers
      mutation-added and refetch-added query names. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "refetch|visible-return"`,
      `pnpm exec vitest --run packages/runtime/src`, and `pnpm run check`.
      Additional bounded evidence 2026-06-12: `hydrateQueryScripts` now returns only successfully
      parsed initial query names, so malformed `fw-query` JSON reports `query-hydration` without
      making that query eligible for later visible-return refetch. `index.test.ts` pins the helper
      return value and the loader focus-refetch ledger under the SPEC §4.4 query hydration
      contract. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "hydrate|visible-return|refetch"`.
      Additional bounded evidence 2026-06-12: extracted `packages/runtime/src/query-refetch.ts`
      as the visible-return query ledger and typed read refetch seam; `packages/runtime/src/index.ts`
      now delegates hydrated/applied query tracking and `refetchQueries` through that helper while
      preserving the public export. `packages/runtime/src/query-refetch.test.ts` pins dedupe,
      opt-out filtering, typed read application, and disabled/failed refetch handling for the
      SPEC §4.4 hydration/refetch contract. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts -t "hydrate|visible-return|refetch"` and
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/query-refetch.ts packages/runtime/src/query-refetch.test.ts`.

Verification: runtime node + browser suites; gzip budget; the new parity suite is the gate for
any future inline-loader edit. Partial evidence 2026-06-12: `packages/runtime/src/index.ts` now
uses an internal `definedProps()` helper for optional runtime wiring across default broadcast
installation, enhanced submit, submit context, deferred chunks, broadcast replay, and the shared
mutation DOM-apply bridge. The remaining optional-spread sites are lower-risk serialization/test
objects or await later module splits. Same-session evidence:
`pnpm exec vitest --run packages/runtime/src/index.test.ts -t "enhanced|deferred|broadcast|submit context"` and
`pnpm exec vp check packages/runtime/src/index.ts plans/codebase-quality-round2.md`.

## Phase 5 — Server: finish the extraction subtractively

Coordinate with the in-flight uncommitted work (document.ts, app.ts, app.test.ts) — integrate or
land it first; don't fork it.

- [x] **HIGH — One wire-html emitter.** The `fw-query` markup is hand-built in four places:
      `renderQueryScript` (index.ts:2870-2874), its byte-identical copy
      `renderDocumentQueryScript` (document.ts:162-166), deferred-stream.ts:71-76, and
      `renderQueryWireChunk` (index.ts:2851-2862). Create `wire-html.ts`; delete the document.ts
      copy and the duplicated `QueryScriptRenderOptions` interface (declared twice, aliased in
      index.ts to dodge its own collision); every extraction from here on removes the original.
      Evidence 2026-06-11: `packages/server/src/wire-html.ts` now owns `<fw-query>` and
      query-script serialization; `index.ts`, `document.ts`, and `deferred-stream.ts` route
      through it while preserving existing public exports. Verified with
      `pnpm exec vitest --run packages/server/src`, `pnpm run check`, and `pnpm run check:fw`.
      Additional evidence 2026-06-12: `wire-html.ts` now also owns the shared
      `<fw-fragment>` wrapper emitter; `deferred-stream.ts` and mutation fragment rendering in
      `index.ts` delegate target/mode/priority/error-boundary attributes through it instead of
      hand-building wrappers. `packages/server/src/wire-html.test.ts` covers attribute escaping
      and default replace-mode omission. Same-session evidence:
      `pnpm exec vitest --run packages/server/src` and
      `pnpm exec vp check packages/server/src/wire-html.ts packages/server/src/wire-html.test.ts packages/server/src/deferred-stream.ts packages/server/src/index.ts plans/codebase-quality-round2.md`.
- [x] **HIGH — One `onError` diagnostic seam.** Seven bare `catch {}` sites on 500 paths
      (index.ts:903, :1583, :1619, :1862, :2002; client-modules.ts:82; app.ts:203) give operators
      zero signal. Thread `onError(error, context)` through all of them; add `{ cause }` to the
      rerun-query throw (index.ts:2802). Also stop leaking raw `error.message` in
      `renderMutationRenderErrorFragment` (index.ts:2935-2943) — every sibling path emits the
      constant body.
      Evidence 2026-06-11: `packages/server/src/diagnostics.ts` defines the single
      `onError(error, context)` seam; `packages/server/src/index.ts`,
      `packages/server/src/app.ts`, and `packages/server/src/client-modules.ts` thread it through
      query, route, mutation, app catch-all, and client-module 500/404 diagnostic paths. Mutation
      render-error fragments now emit a constant body, and rerun-query failures preserve the
      structured failure on `error.cause`. Verified with
      `pnpm exec vitest --run packages/server/src`, `pnpm run check`, and `pnpm run check:fw`
      after `pnpm run check:build` produced the required `dist/` artifacts.
- [x] **MED — Extract the replay choreography.** The reserve/commit logic threaded through
      `renderMutationResponse`'s three exit paths (index.ts:1817-1924, :2993) is the subtlest
      concurrency code in the package, interleaved with rendering. Wrap as
      `withReplay(scope, idem, fn)`; `runMutation` (100 lines) and the response renderer shrink
      around it.
      Evidence 2026-06-11: `packages/server/src/index.ts` now builds one replay context after
      CSRF validation, reads replay records before parsing/handler execution per `SPEC.md` §8.1
      and §9.1, and commits replayable success, typed failure, and post-commit render-error
      responses through `withMutationReplay`; pure schema `VALIDATION` failures remain unstored.
      `packages/server/src/index.test.ts` adds pending duplicate typed-failure replay coverage,
      alongside the existing pending query, pending fragment, validation carveout, CSRF ordering,
      scoped replay, and render-failure replay tests. Verified with
      `pnpm exec vitest --run packages/server/src`, `pnpm run check`, and `pnpm run check:fw`
      after `pnpm run check:build` produced the required `dist/` artifacts.
      Additional evidence 2026-06-11: replay store/context/read/reserve/commit choreography now
      lives in `packages/server/src/replay.ts`; `index.ts` imports the helpers and preserves the
      public `createMemoryMutationReplayStore`/type exports while removing the inlined replay
      implementation block. The TTL/entry-count replay store test moved from `index.test.ts` to
      `replay.test.ts`. Same-session evidence:
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/index.test.ts packages/server/src/replay.ts packages/server/src/replay.test.ts`,
      `pnpm exec vitest --run packages/server/src/replay.test.ts packages/server/src/index.test.ts`,
      and `pnpm exec vitest --run packages/server/src/*.test.ts`.
- [x] **MED — Unify the eight `{body, headers, status}` response types** behind one base; one
      case-insensitive header utility (today: `readHeader` index.ts:3091 fully case-insensitive
      vs document.ts:137 two-casings vs `findResponseHeaderName` index.ts:2397).
      Evidence 2026-06-11: `packages/server/src/response.ts` defines the shared
      `ServerResponseBase` plus the single `readHeader`/`appendResponseHeader` case-insensitive
      header utility; `client-modules.ts`, `deferred-stream.ts`, `document.ts`, `index.ts`, and
      `webhook.ts` now extend that base for the server response shapes and reuse the shared
      header helpers. `packages/server/src/shell.test.ts` covers uppercase `CONTENT-TYPE`
      document wrapping. Verified with `pnpm exec vitest --run packages/server/src`,
      `pnpm run check`, `pnpm run check:build`, and `pnpm run check:fw`.
      Additional evidence 2026-06-11: route response body/status types and route-to-Web /
      route-to-document response adapters now live in `packages/server/src/response.ts`; `app.ts`
      consumes those shared adapters instead of carrying local conversion helpers, and `index.ts`
      keeps the public type exports stable. `packages/server/src/response.test.ts` covers HEAD
      body suppression, typed-array body slicing, and ArrayBuffer normalization for document
      wrapping. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/response.test.ts packages/server/src/app.test.ts packages/server/src/index.test.ts`
      and `pnpm exec vitest --run packages/server/src`.
- [ ] **MED — Split `index.ts`** along the round-1 seam list (schema, guards/session,
      csrf/cookies, query, mutation+replay, route, header utils), index.ts a pure barrel. The
      absence of module-level mutable state makes this mechanical today. Name the stringly
      conventions while passing through: the `'arg:path'` micro-DSL (index.ts:2715-2734), the
      `${domain}:${key}` instance-key convention (:2784), the duck-probed session scope
      (:3020-3052 → reuse `SessionRequestLike`), the duplicated `'https://jiso.local'` origin.
      Partial evidence 2026-06-12: schema primitives, validation errors, file schemas, async
      schema parsing, and form/query entry normalization moved from `packages/server/src/index.ts`
      into `packages/server/src/schema.ts`; `index.ts` now imports those helpers and re-exports
      the public schema API to preserve package exports. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/index.test.ts packages/server/src/app.test.ts packages/server/src/webhook.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/schema.ts`, and
      `git diff --check`.
      Partial evidence 2026-06-12: guard/session primitives, rate-limit guard state, lifecycle
      session resolution, and HTTP guard-failure rendering moved from
      `packages/server/src/index.ts` into `packages/server/src/guards.ts`; `index.ts` imports the
      internal helpers and re-exports the public guard/session API to preserve package exports.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/index.test.ts packages/server/src/app.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/guards.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: SPEC §9.1 CSRF token rendering, token validation, and mutation CSRF
      option fallback helpers moved from `packages/server/src/index.ts` into
      `packages/server/src/csrf.ts`; `index.ts` imports those internals and re-exports
      `csrfField`, `csrfToken`, `CsrfOptions`, and `CsrfValidationOptions` to preserve public
      server exports. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/csrf.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/csrf.ts packages/server/src/csrf.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: query endpoint contracts, `query()`/`runQuery`, query
      registry endpoint rendering, and query instance/version helpers moved from
      `packages/server/src/index.ts` into `packages/server/src/query.ts`; `domain()`/`tag()` moved
      into `packages/server/src/domain.ts`, and `app.ts` dispatches query endpoints through the
      extracted module while `index.ts` preserves the public exports. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/query-endpoint.test.ts packages/server/src/app.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/query.ts packages/server/src/domain.ts packages/server/src/app.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: enhanced mutation wire request types, header parsing, and
      request construction moved from `packages/server/src/index.ts` into
      `packages/server/src/mutation-wire.ts`; `index.ts` preserves the public re-exports, and
      mutation response header aliases now live behind the shared response type module. Same-session
      evidence:
      `pnpm exec vitest --run packages/server/src/mutation-wire.test.ts packages/server/src/response.test.ts packages/server/src/index.test.ts`
      and
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/mutation-wire.ts packages/server/src/mutation-wire.test.ts packages/server/src/response.ts plans/codebase-quality-round2.md`.
- [ ] **LOW** — dead code (`matchShellDispatch` post-loop return shell.ts:161-166; rate-limit
      tail `return options.max > 0` index.ts:576); `matchRoute` recompiling all routes per call
      (match.ts:75-81 — cache `compileRoute`); `Transfer-Encoding: chunked` on a buffered string
      body (deferred-stream.ts:54); double `<title>` in `renderErrorDocument` (document.ts:175);
      `isHeaderSource` false-positives on any non-empty object (index.ts:2322-2328); early-hints
      spread clobbering `Link` (document.ts:153-156); untested cookie-rejection branches
      (index.ts:2405-2461), `t()` throw (:1681), `metaFromQuery` error branches, session Proxy
      traps (:2076-2095).
      Partial evidence 2026-06-11: server LOW cleanup sub-slice removed the unreachable
      `matchShellDispatch` post-loop fallback, cached route table compilation in
      `packages/server/src/match.ts` with mutation invalidation coverage, removed buffered
      deferred-stream `Transfer-Encoding`, stripped duplicate static error-document titles while
      preserving other meta, and tightened `isHeaderSource` to reject arbitrary non-header
      objects. Verified with `pnpm exec vitest --run packages/server/src`, `pnpm run check`, and
      `pnpm run check:build`. `pnpm run check:fw` was run after the build and failed only because
      out-of-scope `tests/fw-check.node.mjs` still hardcodes `defer-stream.http` metadata with
      `transfer-encoding: chunked`; the fixture now reflects the buffered response contract.
      Partial evidence 2026-06-11: `packages/server/src/document.ts` now merges generated early
      hint `Link` values into existing response headers instead of clobbering existing `Link` /
      `link` entries in route and deferred document assembly. `packages/server/src/shell.test.ts`
      covers route document wrapping with a pre-existing lowercase `link` header. Same-session
      evidence: `pnpm exec vitest --run packages/server/src/shell.test.ts` and
      `pnpm exec vitest --run packages/server/src`.
      Additional evidence 2026-06-11: `packages/server/src/shell.ts` now keeps the not-found
      dispatch fallback outside the matching table loop, removing the unreachable post-loop
      exhaustion throw while preserving the exported table, and `packages/server/src/index.ts`
      simplifies the rate-limit tail after the `max <= 0` branch has already returned.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/shell.test.ts packages/server/src/index.test.ts`
      and `pnpm exec vp check packages/server/src/index.ts packages/server/src/shell.ts`.
      Additional evidence 2026-06-12: cookie validation/serialization moved from
      `packages/server/src/index.ts` into `packages/server/src/cookies.ts`, preserving the
      `CookieOptions` public type export through `index.ts`; `packages/server/src/cookies.test.ts`
      covers structured `Set-Cookie` serialization plus raw/structured rejection branches for
      empty raw values, control characters, bad names, semicolon values, non-integer `Max-Age`,
      and invalid paths. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/cookies.test.ts packages/server/src/index.test.ts`
      and
      `pnpm exec vp check --fix packages/server/src/index.ts packages/server/src/cookies.ts packages/server/src/cookies.test.ts`.
      Additional evidence 2026-06-12: `packages/server/src/index.test.ts` now covers
      `metaFromQuery` declaration failures for deferred query meta without a stable query key and
      eager query meta without a derive function, closing the previously untested meta error
      branches. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/index.test.ts -t "query-derived meta"` and
      `pnpm exec vp check packages/server/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: the server wire-fixture helpers now compare exact
      `SPEC.md` §9.1 wire bodies without appending synthetic trailing newlines to live HTTP or
      direct renderer responses. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/index.test.ts -t "byte-for-byte|P0 wire fixtures|POST redirect"`
      and `pnpm exec vitest --run packages/server/src/index.test.ts`.

Verification: server vitest + wire fixtures byte-for-byte (remove the newline fudge at
index.test.ts:4227 while here — it weakens the byte-for-byte claim) + acceptance.

## Phase 6 — Verification harness soundness + example honesty

- [x] **HIGH — `@jiso/test` Proxy interception hazards.** Name-based duck typing intercepts any
      property named `read/write/sql/query/exec/pglite` (test/src/index.ts:299-344); each
      `db.pglite` access mints a new Proxy (`db.pglite !== db.pglite`, :307-309); per-get binding
      policy differs between `wrap` and `wrapSqlHandle` (:373); handles captured before `wrap()`
      bypass observation silently; concurrent `exec` calls cross-attribute writes via the shared
      `observed` array index window (:115-127). Fix: cache proxies per-target, intercept on the
      adapter seam rather than property names where possible, serialize or scope observation per
      call, and detect/throw on the captured-handle bypass if detectable — otherwise document it
      as a hard usage rule with a lint-style runtime warning.
      Evidence: `packages/test/src/index.ts` now caches root/pglite proxies and method wrappers,
      scopes harness observations with `AsyncLocalStorage`, narrows root SQL interception to DB
      adapter/SQL-handle seams where feasible, and documents the pre-wrap captured-handle bypass
      at the SPEC §11.4 harness seam. `packages/test/src/index.test.ts` covers stable `pglite`
      proxy/method identity, root `query` non-interception without a DB seam, and two interleaved
      `exec` calls with domain-specific attribution. Verified with `pnpm exec vitest --run packages/test/src`,
      `pnpm run check`, `pnpm run check:build`, and `pnpm run check:fw`.
      Additional evidence 2026-06-12: `DbVerifier.capture()` now returns a frozen scoped
      observation snapshot, so async work scheduled inside a completed capture cannot mutate the
      evidence later used by harness assertions while still appearing in the verifier-wide
      observation log. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier.test.ts` and
      `corepack pnpm exec vp check packages/test/src/verifier.ts packages/test/src/verifier.test.ts`.
- [ ] **MED — Split `test/src/index.ts`** (harness / verifier / sql-observer / html-fragment
      modules); unify the two diagnostic channels (FW402/404/407/408 throw strings,
      FW403/405 return structured records); delete the dead FW411 special case
      (:1176-1179 — identical to the general path) and the third FW411 message copy; move
      `diagnosticsForTouchGraph` to one home and delete the verbatim CLI copy
      (drizzle/graph.ts:136-161 vs cli/src/index.ts:850-874).
      Partial evidence 2026-06-11: `packages/test/src/index.ts` no longer carries the dead
      FW411 formatter special case or local FW411 message copy; `index.test.ts` derives FW411
      assertion text from `diagnosticDefinitions`. Same-session evidence:
      `pnpm exec vitest --run packages/test/src` and `pnpm run check`.
      Partial evidence 2026-06-11: page/fragment assertion logic moved from
      `packages/test/src/index.ts` into `packages/test/src/page.ts`, and fragment-focused tests
      moved from `index.test.ts` into `page.test.ts`. The new page tests include adversarial
      quoted-attribute coverage so same-name tag text inside attributes does not create false
      nesting while SPEC §9.1 `id` / `fw-fragment-target` resolution still works. Same-session
      evidence: `pnpm exec vitest --run packages/test/src/page.test.ts packages/test/src/index.test.ts`
      and `pnpm exec vitest --run examples/commerce/src/app.test.ts`.
      Additional evidence 2026-06-11: harness execution/context APIs now live in
      `packages/test/src/harness.ts`, `propertyTest` and `assertMutationError` live in
      `packages/test/src/assertions.ts`, and assertion/property tests moved from
      `index.test.ts` to `assertions.test.ts`. The new assertion coverage proves lazy property
      case iteration stops at the first counterexample. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/assertions.test.ts packages/test/src/index.test.ts packages/test/src/page.test.ts`,
      `pnpm exec vitest --run packages/test/src`,
      `pnpm exec vp check packages/test/src/index.ts packages/test/src/harness.ts packages/test/src/assertions.ts packages/test/src/assertions.test.ts packages/test/src/index.test.ts`,
      and `git diff --check`.
      Partial evidence 2026-06-11: `packages/test/src/pglite.ts` now owns the PGlite test DB
      adapter, `packages/test/src/verifier.ts` owns DB verification/proxy/SQL observation, and
      `packages/test/src/index.ts` re-exports those public APIs while keeping the harness surface
      intact. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/index.test.ts packages/test/src/page.test.ts`
      and
      `pnpm exec vp check packages/test/src/index.ts packages/test/src/pglite.ts packages/test/src/verifier.ts`.
      Partial evidence 2026-06-12: verifier diagnostic checks and structured FW403/FW405
      records moved from `packages/test/src/verifier.ts` into
      `packages/test/src/verifier-diagnostics.ts`; `verifier.ts` now keeps DB proxying,
      observation, and SQL parsing while preserving existing exports. Same-session evidence:
      `pnpm exec vitest --run packages/test/src` and
      `pnpm exec vp check packages/test/src/index.ts packages/test/src/verifier.ts packages/test/src/verifier-diagnostics.ts packages/test/src/verifier-diagnostics.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: raw SQL AST operation extraction moved from
      `packages/test/src/verifier.ts` into `packages/test/src/verifier-sql.ts`, keeping
      `verifier.ts` focused on DB proxying/recording while delegating SPEC §11.2 SQL
      observation parsing. `packages/test/src/verifier-sql.test.ts` exercises insert-select
      write/read observation through the public package entrypoint instead of importing the
      helper directly. Same-session evidence: `pnpm exec vitest --run packages/test/src`,
      `pnpm exec vp check packages/test/src/verifier.ts packages/test/src/verifier-sql.ts packages/test/src/verifier-sql.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: query loader execution, query output schema FW410
      diagnostics, read-side FW407/FW408/FW411 checks, raw SQL query reads, row keys, CTE
      source reads, and non-string SQL pass-through coverage moved from
      `packages/test/src/index.test.ts` into `packages/test/src/query-verifier.test.ts`.
      Same-session evidence:
      `pnpm exec vitest --run packages/test/src/query-verifier.test.ts packages/test/src/index.test.ts`,
      `pnpm exec vitest --run packages/test/src`,
      `pnpm exec vp check packages/test/src/index.test.ts packages/test/src/query-verifier.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: mutation write-domain verification, executed graph-entry
      scoping, explicit harness touch graph keys, scoped FW406 coverage, current-exec write
      observation scoping, and unmapped table failures moved from
      `packages/test/src/index.test.ts` into `packages/test/src/mutation-verifier.test.ts`.
      Same-session evidence:
      `pnpm exec vitest --run packages/test/src/mutation-verifier.test.ts packages/test/src/index.test.ts`,
      `pnpm exec vitest --run packages/test/src`,
      `pnpm exec vp check packages/test/src/index.test.ts packages/test/src/mutation-verifier.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: verifier observation types, scoped recorder,
      method-wrapper cache, table observation, and SQL statement observation moved from
      `packages/test/src/verifier.ts` into `packages/test/src/verifier-observation.ts`.
      `verifier.ts` preserves the existing public type re-exports while focusing on verifier
      orchestration and DB/SQL-handle proxy seams. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier.test.ts packages/test/src/verifier-sql.test.ts packages/test/src/query-verifier.test.ts packages/test/src/mutation-verifier.test.ts packages/test/src/index.test.ts`
      and
      `corepack pnpm exec vp check packages/test/src/index.ts packages/test/src/verifier.ts packages/test/src/verifier-observation.ts packages/test/src/verifier-diagnostics.ts packages/test/src/verifier-sql.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: the HTML fragment scanner moved from
      `packages/test/src/page.ts` into `packages/test/src/html-fragment.ts`, leaving
      `page.ts` as the page assertion wrapper while preserving the public package barrel.
      `packages/test/src/page.test.ts` now imports the fragment helper directly for SPEC §9.1
      id / `fw-fragment-target` resolution coverage and still exercises the harness page path.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/page.test.ts packages/test/src/index.test.ts`,
      `corepack pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/page.ts packages/test/src/page.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [ ] **MED — Commerce example: one source of truth.** `cartQuery.load` returns a constant while
      `loadCartQuery(db)` does the real read (app.ts:123-126 vs :280-284);
      `productGridQuery.load` conjures a fresh `createCommerceDb()` (:161); the committed
      graph.json bakes the fake in (`"Jiso Commerce (1)"`). Make declared queries the real
      loaders — the showcase must demonstrate the pattern the framework sells. Remove the
      unexplained test-hook accommodation (app.ts:111-114 — inject the fault through a seam
      instead); deduplicate `renderProductGrid`/`renderProductGridWithFailure` (:286 vs :436)
      and the two hand-rolled escapers (:548-554 → server html.ts); replace the inline CSRF
      secret (:54) with an obvious `EXAMPLE_ONLY_` name.
      Partial evidence 2026-06-11: commerce `cart`, `productGrid`, and `orderHistory` declared
      query loaders now read from `context.request.db` instead of fixture/default data, and throw
      when invoked without request DB context. Static page hints explicitly use
      `loadCartQuery(createCommerceDb())`, so loaders are not silently called without a request.
      `examples/commerce/src/generated/graph.json` and graph emission now record the starter DB
      count as `Jiso Commerce (0)`, matching the real source of truth. `app.test.ts` proves query
      loaders observe mutation effects from the request DB and the generated graph stays
      consistent. Same-session evidence:
      `corepack pnpm --filter @jiso/example-commerce run emit-graph`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts`, and
      `corepack pnpm run check`.
      Additional evidence 2026-06-12: `app.test.ts` now proves `productGridQuery.load` reads a
      request DB with a custom product set instead of falling back to the starter
      `createCommerceDb()` fixture, and `app.ts` uses the shared server HTML escapers instead of
      local copies for commerce form/error rendering. Same-session evidence:
      `pnpm exec vitest --run examples/commerce/src/app.test.ts` and
      `pnpm exec vp check examples/commerce/src/app.ts examples/commerce/src/app.test.ts examples/commerce/src/generated/graph.json examples/commerce/src/generated/touch-graph.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: commerce CSRF secrets now flow through exported
      `EXAMPLE_ONLY_COMMERCE_CSRF_SECRET` / `EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET` constants
      rather than inline production-looking literals, and `app.test.ts` asserts the exported CSRF
      configs keep the `EXAMPLE_ONLY_` marker. Same-session evidence:
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts -t "marks demo-only CSRF secrets as example-only source"`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts`,
      `corepack pnpm --filter @jiso/example-commerce run emit-graph`, and `git diff --check`.
      Additional evidence 2026-06-12: `app.test.ts` now covers all declared commerce query
      loaders against one custom request DB with non-starter cart, product, and order data, so
      fixture fallback in any source-of-truth query fails directly. Same-session evidence:
      `pnpm exec vitest --run examples/commerce/src/app.test.ts -t "loads every declared query from a custom request database"`,
      `pnpm exec vitest --run examples/commerce/src/app.test.ts`,
      `pnpm exec vp check examples/commerce/src/app.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [x] **MED — Typecheck the example and spikes.** `examples/commerce` and three of four
      conformance spikes sit outside every tsconfig (root includes only `packages/**`), so the
      registry-augmentation showcase (generated/touch-graph.ts:43-50) may never be
      project-typechecked. Add tsconfigs (or extend the root include) and wire them into
      `vp check`. Share one wire-transcript fixture parser between fw-check and app-shell-spike
      (currently two implementations of the `>>> REQUEST` format).
      Partial evidence 2026-06-11: `examples/commerce/tsconfig.json` and per-spike
      conformance tsconfigs now typecheck commerce plus all four conformance spikes through
      `vp run typecheck-examples`, and root `pnpm run check` runs that task after `vp check`.
      Hidden commerce strictness holes fixed in `examples/commerce/src/app.ts` and
      `examples/commerce/src/app.test.ts`; `@jiso/example-commerce` now declares the `vite`
      binary used by its build test. Verified with `pnpm vp run typecheck-examples`,
      `pnpm exec vitest --run examples/commerce/src/app.test.ts`, `pnpm run check`,
      `pnpm run check:build`, and `pnpm run check:fw`.
      Evidence 2026-06-11: `tests/wire-transcript.mjs` now owns the shared `>>> REQUEST` /
      `<<< RESPONSE` fixture parser, with `tests/wire-transcript.d.mts` typing the shared
      exchange shape for the app-shell spike. `tests/fw-check.node.mjs` consumes
      `parseWireResponses` for byte-for-byte response body checks and lower-case header metadata;
      `conformance/app-shell-spike/src/index.test.ts` consumes `parseWireTranscript` for the real
      HTTP fixture replay. Verified with `node --test tests/fw-check.node.mjs`,
      `pnpm exec vitest --run conformance/app-shell-spike/src/index.test.ts`, and `pnpm run check`.
- [x] **LOW** — better-auth guard-failure literals restate server shapes
      (better-auth/src/index.ts:126-142) — import the constants or keep the cross-package
      agreement test and note it; create-jiso error-path output to stdout while exiting 1;
      auth-spike dead narrowing guard (auth-spike/src/index.test.ts:260-263).
      Evidence 2026-06-11: `@jiso/server` guard-failure constructors remain private, so
      `packages/better-auth/src/index.test.ts` now records that API-boundary choice and compares
      adapter unauthenticated/unauthorized failures against canonical server guard results;
      `packages/create-jiso/src/index.test.ts` covers caught CLI errors returning 1 with no
      stdout and the error on stderr; `conformance/auth-spike/src/index.test.ts` replaces the
      post-expect unreachable narrowing branch with an assertion helper. Verified with
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts`,
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts`,
      `pnpm exec vitest --run conformance/auth-spike/src/index.test.ts`, `pnpm run check`,
      `pnpm run check:build`, and `pnpm run check:fw`.

Verification: test/drizzle/commerce vitest + conformance + acceptance; a new adversarial
concurrency test for the harness (two interleaved `exec` calls attribute correctly or fail
loudly).

## Phase 7 — Test-suite restructuring (folds into Phases 2-6; tracked here)

The monolith test files are a symptom: all unit testing routes through package barrels.
As each phase splits a source module, split its tests in the same commit.

- [ ] server/index.test.ts (4,323 lines, one misnamed describe) → per-module files; shared
      fixture factory for the 22 re-declared `domain('cart')` setups; `match.ts` gets its own
      test file; document tests move out of shell.test.ts.
      Partial evidence 2026-06-11: replay store behavior moved from `packages/server/src/index.test.ts`
      to `packages/server/src/replay.test.ts` alongside the new `replay.ts` extraction, reducing
      the server monolith while preserving public exports through `index.ts`. Same-session
      evidence:
      `pnpm exec vitest --run packages/server/src/replay.test.ts packages/server/src/index.test.ts`
      Additional evidence 2026-06-12: route meta and i18n page-hint coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/meta.test.ts`, including
      query-derived meta happy paths, declaration failure branches, and i18n catalog rendering.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/meta.test.ts packages/server/src/index.test.ts -t "route meta|query-derived meta|i18n|document-load hydration"` and
      `pnpm exec vp check packages/server/src/index.test.ts packages/server/src/meta.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: pure page-hint coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/hints.test.ts`, including
      modulepreloads, generated bootstrap scripts, versioned module hrefs, stylesheet hints,
      manifest stylesheet selection, Early Hints target encoding, and speculation rules.
      Additional evidence 2026-06-12: versioned client-module registry and immutable response
      coverage moved from `packages/server/src/index.test.ts` into
      `packages/server/src/client-modules.test.ts`, aligned with `client-modules.ts`.
      Additional evidence 2026-06-12: enhanced mutation wire header parsing and iterable
      request-building coverage moved from `packages/server/src/index.test.ts` into
      `packages/server/src/mutation-wire.test.ts`.
      Additional evidence 2026-06-12: route file/stream outcome coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/route-response.test.ts`.
      Additional evidence 2026-06-12: raw endpoint declaration/execution, ambient-session
      stripping, and exact/prefix mount matching coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/endpoint.test.ts`.
      Additional evidence 2026-06-12: schema immutability coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/schema.test.ts`, importing
      the schema module directly.
      Additional evidence 2026-06-12: FormData coercion, repeated-field array normalization,
      indexed array validation paths, and multipart `s.file()` storage/failure coverage moved
      from `packages/server/src/index.test.ts` into `packages/server/src/schema.test.ts`,
      keeping mutation execution behavior unchanged while grouping schema input tests together.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/schema.test.ts packages/server/src/index.test.ts`
      and
      `pnpm exec vp check packages/server/src/index.test.ts packages/server/src/schema.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: pure deferred-stream rendering coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/deferred-stream.test.ts`,
      while the wire-fixture/live-server deferred checks remain in the monolith until their
      shared fixture helpers are extracted.
      Additional evidence 2026-06-12: query endpoint/registry behavior moved from
      `packages/server/src/index.test.ts` into `packages/server/src/query-endpoint.test.ts`;
      the typed-read byte fixture remains in the monolith until shared wire helpers are extracted.
      Additional evidence 2026-06-12: route schema/redirect and route page guard/notFound
      behavior moved from `packages/server/src/index.test.ts` into
      `packages/server/src/route.test.ts`.
      Additional evidence 2026-06-12: mutation guard/session/rate-limit behavior moved from
      `packages/server/src/index.test.ts` into `packages/server/src/guards.test.ts`, including
      authed and role guards, typed session parsing/refinement, rate-limit buckets, and retry-after
      propagation for enhanced and no-JS mutation responses.
      Additional evidence 2026-06-12: mutation CSRF enforcement coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/csrf.test.ts`, keeping
      token-before-guard ordering, default fail-closed behavior, explicit legacy opt-out, and
      replay-before-CSRF rejection coverage with the CSRF helper tests.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/csrf.test.ts packages/server/src/index.test.ts -t "CSRF|csrf"`,
      `pnpm exec vitest --run packages/server/src/csrf.test.ts packages/server/src/index.test.ts`,
      and `pnpm exec vp check packages/server/src/csrf.test.ts packages/server/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: byte-for-byte wire fixture contract coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/wire-fixtures.test.ts`,
      including typed-read, deferred stream, enhanced mutation, validation failure, no-JS PRG,
      and live HTTP fixture replay checks plus the local transcript/live-server helpers.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/wire-fixtures.test.ts`,
      `pnpm exec vitest --run packages/server/src/index.test.ts -t "document-load hydration|typed validation failures|enhanced mutation responses by FW-Idem|POST-redirect-GET|schema validation failures"`,
      `pnpm exec vp check packages/server/src/index.test.ts packages/server/src/wire-fixtures.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`. Full server test-suite sweep remains open here:
      `pnpm exec vitest --run packages/server/src/*.test.ts`.
      Additional evidence 2026-06-12: manual invalidation/change-record typing and
      `FW-Changes` header privacy/ASCII safety coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/change-record.test.ts`.
      Same-session evidence:
      `pnpm exec vitest --run packages/server/src/change-record.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/change-record.test.ts packages/server/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: mutation response replay coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/replay.test.ts`, keeping
      FW-Idem success replay, pending query/fragment/failure replay, typed-failure replay,
      schema-validation carveout, CSRF-before-replay ordering, scoped replay keys, and
      post-commit render-failure replay with the replay-store tests.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/replay.test.ts packages/server/src/index.test.ts`,
      `corepack pnpm exec vp check packages/server/src/index.test.ts packages/server/src/replay.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [ ] runtime/index.test.ts (4,435 lines, mutation tests under "query store") → per-module
      files; `Fake*` classes to a shared `test-fixtures.ts`; direct unit tests for wire-parser,
      handlers, morph; replace counted-microtask flushing with a single `flush()` helper.
      Partial evidence 2026-06-12: typed event bus coverage moved from
      `packages/runtime/src/index.test.ts` to `packages/runtime/src/events.test.ts`, importing
      `createEventBus` directly from `events.ts` while keeping the same behavioral assertions.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/events.test.ts packages/runtime/src/index.test.ts`,
      `pnpm exec vp check packages/runtime/src/events.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: query hydration and visible-return/refetch coverage moved
      from `packages/runtime/src/index.test.ts` to `packages/runtime/src/query-store.test.ts`
      with a focused local `FakeRoot`, leaving mutation DOM/query integration in the monolith.
      Additional evidence 2026-06-12: mutation response wire-chunk coverage moved from
      `packages/runtime/src/index.test.ts` to `packages/runtime/src/mutation-response.test.ts`,
      preserving the query/fragment chunk, malformed chunk, nested fragment, and deferred-helper
      assertions with local DOM fakes.
      Additional evidence 2026-06-12: inline-loader bootstrap source-shape, gzip budget,
      custom import expression, and `Math.random` exclusion checks moved from
      `packages/runtime/src/index.test.ts` to `packages/runtime/src/inline-loader.test.ts`,
      while the monolith keeps generated-source integration parity for form/query/fragment flows.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`
      and `git diff --check`.
      Additional evidence 2026-06-12: typed submit-context coverage moved from
      `packages/runtime/src/index.test.ts` to `packages/runtime/src/submit-context.test.ts`,
      preserving typed form submit, mutation/route rename type proofs, and 422 failure parsing
      coverage for `<fw-error>` and server-shaped validation fragments.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/submit-context.test.ts packages/runtime/src/index.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/submit-context.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [ ] compiler/index.test.ts (3,580 lines, zero per-module tests) → per-phase files; a
      `compileFixture()` helper returning files by kind; diagnostic assertions reference
      `diagnosticDefinitions[code].message` instead of pasted strings (today a one-word rewording
      breaks dozens of tests).
      Partial evidence 2026-06-12: package-prefix diagnostics and graph coverage moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/package-prefixes.test.ts`,
      with FW234 message/severity assertions keyed to `diagnosticDefinitions.FW234` while retaining
      a compile-path alias acceptance check. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/package-prefixes.test.ts packages/compiler/src/index.test.ts`,
      `pnpm exec vp check packages/compiler/src/package-prefixes.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: the remaining compiler test assertions for FW201/FW210/FW330
      diagnostic messages now key to `diagnosticDefinitions` instead of pasted message strings.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/package-prefixes.test.ts`
      and `pnpm exec vp check packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-12: Vite plugin transform and dev-middleware coverage moved from
      `packages/compiler/src/index.test.ts` to `packages/compiler/src/vite.test.ts`, leaving the
      broad compiler monolith split item open for further per-phase extraction. Same-session
      evidence: `pnpm exec vitest --run packages/compiler/src/vite.test.ts packages/compiler/src/index.test.ts`,
      `pnpm exec vp check packages/compiler/src/vite.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`,
      Additional evidence 2026-06-12: handler URL versioning, executable body emission,
      captured param coercion, AST-safe handler rewriting, and string/comment non-matches moved
      from `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/handler-lowering.test.ts`.
      and `git diff --check`.
      Additional evidence 2026-06-12: literal route validation, static `<Link>` lowering, static
      `href()` lowering, and navigation string/comment non-match coverage moved from
      `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/navigation-lowering.test.ts`, preserving the broad compiler split as
      open. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/index.test.ts -t "navigation|Link|href"`,
      `pnpm exec vp check packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: dialog, popover, details-toggle, platform string/comment
      non-match, and unsupported details fallback coverage moved from
      `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/platform-lowering.test.ts`, preserving the broad compiler split as
      open. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/platform-lowering.test.ts packages/compiler/src/index.test.ts -t "platform|dialog|popover|details"`,
      `pnpm exec vp check packages/compiler/src/platform-lowering.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [ ] drizzle (one describe, 57 its, 68 inline pgTable fixtures, 3 module-shim copies) and
      test-package suites: same treatment; CLI tests get the temp-dir + stream-spy ritual
      (16 hand-copies) as one helper.
      Partial evidence 2026-06-11: the `@jiso/test` page/fragment assertion tranche now has
      `packages/test/src/page.ts` plus `page.test.ts`, reducing the `index.ts` / `index.test.ts`
      monolith while preserving the public `PageAssertion` export through the package barrel.
      Same-session evidence: `pnpm exec vitest --run packages/test/src/page.test.ts packages/test/src/index.test.ts`.
      Additional evidence 2026-06-11: `packages/test/src/harness.ts` and
      `packages/test/src/assertions.ts` now own the former package-barrel harness/assertion
      helpers, and `assertions.test.ts` owns the property-test and mutation-error assertion
      coverage formerly embedded in `index.test.ts`. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/assertions.test.ts packages/test/src/index.test.ts packages/test/src/page.test.ts`,
      `pnpm exec vitest --run packages/test/src`, and
      `pnpm exec vp check packages/test/src/index.ts packages/test/src/harness.ts packages/test/src/assertions.ts packages/test/src/assertions.test.ts packages/test/src/index.test.ts`.
      Additional evidence 2026-06-12: direct DB verifier coverage for FW406 fallback,
      FW403/FW405 diagnostics, exempt tables, read-domain checks, and stable proxy identity moved
      from `packages/test/src/index.test.ts` to `packages/test/src/verifier.test.ts`, with the
      shared fake DB fixture factored into `packages/test/src/test-fixtures.ts`. Same-session
      evidence: `pnpm exec vitest --run packages/test/src`.
      Additional evidence 2026-06-12: harness context and `jisoTest` runner coverage moved from
      `packages/test/src/index.test.ts` to `packages/test/src/harness.test.ts`, leaving
      `index.test.ts` focused on verifier integration while preserving public imports through
      `packages/test/src/index.ts`. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/harness.test.ts packages/test/src/index.test.ts`.
      Additional evidence 2026-06-12: real PGlite harness integration coverage moved from
      `packages/test/src/index.test.ts` into `packages/test/src/pglite-harness.test.ts`,
      including `createPgliteTestDb`, direct `query`/`exec`, raw `pglite.query`, and raw
      `pglite.transaction` paths while preserving public imports through the package barrel.
      Same-session evidence:
      `pnpm exec vitest --run packages/test/src/pglite-harness.test.ts packages/test/src/index.test.ts`,
      `pnpm exec vitest --run packages/test/src`,
      `pnpm exec vp check packages/test/src/index.test.ts packages/test/src/pglite-harness.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: HTML fragment parsing moved from
      `packages/test/src/page.ts` into `packages/test/src/html-fragment.ts`, with
      `page.test.ts` adding direct seam coverage while retaining harness-driven page assertion
      tests through the package barrel. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/page.test.ts packages/test/src/index.test.ts`,
      `corepack pnpm exec vp check packages/test/src/html-fragment.ts packages/test/src/page.ts packages/test/src/page.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: Drizzle runtime/static package-surface coverage moved from
      `packages/drizzle/src/index.test.ts` into `packages/drizzle/src/runtime-surface.test.ts`,
      leaving static extraction coverage in the Drizzle monolith. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vp check packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.

Verification: identical test counts ± intentional additions before/after each split; full
acceptance at the end.

## Sequencing summary

| Phase | Theme                                  | Depends on                             | Parallelizable                       |
| ----- | -------------------------------------- | -------------------------------------- | ------------------------------------ |
| 0     | Ledger honesty                         | —                                      | trivial, do inline                   |
| 1     | Gate de-tautologization + graph schema | 0                                      | gate vs create-jiso vs CLI: 3 slices |
| 2     | Compiler IR                            | 1                                      | one track (architecture change)      |
| 3     | Drizzle AST                            | 1                                      | parallel with 2 (separate packages)  |
| 4     | Runtime                                | 1                                      | parallel with 2/3                    |
| 5     | Server                                 | 1 + in-flight document/app work landed | parallel with 2/3/4                  |
| 6     | Harness + example                      | 3 (shapes), 5 (escapers)               | partial overlap                      |
| 7     | Test restructuring                     | folds into 2-6                         | per-package with its phase           |

Phases 2-5 are independent packages and run as parallel sub-agent worktree tracks per CLAUDE.md
(explicit file ownership; integration, gate runs, and checkpoint commits centralized in the main
worktree). Within every phase: adversarial regression test first, narrowest verification after
each fix, checkpoint commit per finding or coherent pair, and **every extraction deletes its
original in the same commit**.
