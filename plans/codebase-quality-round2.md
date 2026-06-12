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
      Partial evidence 2026-06-12: the commerce/starter optimistic-output tranche now parses
      `fwExplain` optimistic lines and summary key/value fields through shared helpers instead
      of regex-matching `OPTIMISTIC` and `OPTIMISTIC-SUMMARY` text. Same-session evidence:
      `node --test --test-name-pattern "P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the commerce/starter update-output tranche now parses the
      `fwExplain` updates field into query-target entries instead of regex-matching substrings
      of the rendered updates line. Same-session evidence:
      `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|P10 commerce graph assertions answer behavior mechanically|P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the Phase 0 wire-fixture inventory tranche now parses each
      `.http` transcript into title/request/response/header structures before asserting enhanced
      fragment headers, replacing regex line matches while preserving the byte-for-byte fixture
      body pins. Same-session evidence:
      `node --test --test-name-pattern "Phase 0 wire fixtures are present and explicit|Phase 0 wire fixture response bodies match generated contracts byte-for-byte|Phase 0 wire fixture responses keep stable protocol metadata" tests/fw-check.node.mjs`.
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
      Partial evidence 2026-06-12: the P4 commerce touch graph site tranche parses generated
      `touch.site` values into `{ path, line }` facts and asserts source-path/positive-line
      structure instead of regex-matching the rendered `examples/commerce/src/app.ts:<line>`
      string. Same-session evidence:
      `node --test --test-name-pattern "P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the fragment-target registry tranche now compiles the
      generated registry module plus a virtual `fragmentTarget` consumer through TypeScript,
      asserting valid `rowId` props and `@ts-expect-error` failures for missing, mistyped, and
      extra props instead of parsing the generated `FragmentTargets` interface source. Same-session
      evidence:
      `node --test --test-name-pattern "P1 fragment targets emit typed registry facts" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the view-transition and typed-route registry tranche now
      checks generated `ViewTransitions` through the TypeScript compiler symbol table and
      compiles a virtual `href`/`Link`/`redirect`/`route` consumer with positive calls plus
      `@ts-expect-error` negative cases, deleting the remaining ad hoc generated-interface
      source parser from `tests/fw-check.node.mjs`. Same-session evidence:
      `node --test --test-name-pattern "P2 compiler merges view transition stamps into existing styles|P3 typed routes validate navigation targets" tests/fw-check.node.mjs`.
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
      Partial evidence 2026-06-12: the P10 starter HTML/fixpoint tranche now parses
      `packages/create-jiso/templates/index.html` element structure and compiles
      `packages/create-jiso/templates/src/app.tsx` through `assertFixpoint` and
      `assertRenderEquivalence` for SPEC §5.2 instead of matching the HTML comment/client-source
      substring or parsing `app.fixpoint.test.ts` import names. Same-session evidence:
      `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the P10 starter emit-graph tranche now runs
      `packages/create-jiso/templates/scripts/emit-graph.mjs` in an isolated temp template and
      asserts `emit-graph/v1` plus parsed graph equality instead of grepping the emitter import
      or `graphDeclarations` object-key source. The starter template package now proves
      `fw-check` and `graph-assertions` are Vite+ tasks only, avoiding package-script/task-name
      conflicts while CI invokes them through `vp run`.
      Same-session evidence:
      `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`,
      `pnpm run check:build`, and `git diff --check`.
      Partial evidence 2026-06-12: the P10 starter Vite task tranche now executes the parsed
      `fw-check` and `graph-assertions` task commands inside an isolated copied template with a
      compiler shim and validating `fw` binary, and the package dependency checks assert required
      package roles instead of pinning dependency version strings in `tests/fw-check.node.mjs`.
      Same-session evidence:
      `pnpm run check:build`,
      `node --test --test-name-pattern "P10 starter wires graph assertions into CI" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Partial evidence 2026-06-12: the P10 forbidden browser architecture tranche now parses
      framework package sources with the TypeScript AST and asserts forbidden call/JSX constructs
      from structured nodes instead of grepping source text with regular expressions.
      Verification: `node --test --test-name-pattern "P10 constitution rejects forbidden browser architecture in framework code" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Partial evidence 2026-06-12: the external-readiness documentation tranche now parses
      `docs/legibility-study.md`, `docs/v1-acceptance.md`, and
      `docs/prelaunch-checklist.md` tables/fields for pending study rows, acceptance audit
      statuses, runnable checklist rows, and final clean-checkout gates instead of checking
      completion-rule or section-intro prose substrings in `tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the v1 acceptance/pre-launch documentation tranche now
      asserts parsed command rows, dated audit statuses, external-check evidence ledger ownership,
      placeholder reviewers, and pending statuses instead of matching final-freeze or missing
      evidence prose in `tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: the wire-SSE/docs-normative tranche now asserts fixture
      inventory/body structure, SPEC constitution table rows, SPEC §5.2 hard-rule alignment,
      compiler handler naming, render-equivalence behavior, and compiler CSS asset/scoping
      artifacts instead of regex-matching README, docs, or SPEC prose snippets. Verification:
      `node --test --test-name-pattern "SSE remains a v2 backlog fixture|P10 normative docs cover
      the constitution and compiler hard rules" tests/fw-check.node.mjs`.
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
      Partial evidence 2026-06-12: the D10 static-export tranche now parses generated HTML
      element attributes and checks API artifact/file body agreement for `exportStaticApp` and
      `fw export`, instead of regex-matching generated HTML text.
      Same-session evidence:
      `corepack pnpm run check:build`,
      `node --test --test-name-pattern "D10 seeded diagnostics gate Vite, static export, and MCP
      red-green surfaces" tests/fw-check.node.mjs`,
      `corepack pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: remaining `assert.match` / `assert.doesNotMatch` sites in
      `tests/fw-check.node.mjs` were removed. The document-load, commerce graph, runtime
      malformed-header, production-build handler URL, D10 Vite/static-export/CLI, and Drizzle
      fallback checks now assert parsed HTML elements, exact graph facts, string-prefix error
      records, lower-hex URL fields, generated build artifacts, parsed `fw-export/v1` output, and
      command behavior instead of regex assertions.
      Same-session evidence:
      `node --test --test-name-pattern "P3 server renders initial query scripts|D4 commerce
      adopt-dont-invent features|P9 verification layer evidence remains represented|S1 production
      build|D10 seeded diagnostics gate Vite, static export, and MCP red-green surfaces|P3 Drizzle
      query facts" tests/fw-check.node.mjs`.
      Partial evidence 2026-06-12: generated/wire artifact closure now parses document
      head/body regions, query script payloads, deferred fragment target blocks, wire response
      content-type facts, commerce update targets, and derived registry facts instead of using
      raw `.includes()` membership checks or SSE body/name regex filters in
      `tests/fw-check.node.mjs`.
      Same-session evidence:
      `node --test --test-name-pattern "SSE remains a v2 backlog fixture|P10 commerce invalidation is expressed through graph facts|P10 commerce graph assertions answer behavior mechanically|P3 server renders initial query scripts" tests/fw-check.node.mjs`,
      `node --test --test-name-pattern "D3 deferred stream responses are consumed by the runtime" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional partial evidence 2026-06-12: the same conformance gate now pins the finite
      directory-to-package-name mapping directly instead of accepting conformance package names
      through a regex shape check. Same-session evidence:
      `node --test --test-name-pattern "Conformance suites are an explicit gate" tests/fw-check.node.mjs`
      and `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`.
      Additional partial evidence 2026-06-12: the conformance Vite command assertion now parses
      `pnpm --filter <package> test` entries into command records and asserts the package/script
      semantics against discovered manifests instead of extracting package names with a command
      regex. Same-session evidence:
      `node --test --test-name-pattern "Conformance suites are an explicit gate" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`, and
      `git diff --check`.
      Additional partial evidence 2026-06-12: the conformance acceptance wiring now follows the
      `test:conformance` package script through the Vite+ task graph and parses the root
      `acceptance` script into `pnpm run <script>` command records instead of comparing literal
      package-script fragments. Same-session evidence:
      `node --test --test-name-pattern "Conformance suites are an explicit gate" tests/fw-check.node.mjs`,
      `pnpm exec vp check tests/fw-check.node.mjs plans/codebase-quality-round2.md`, and
      `git diff --check`.
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
      Partial evidence 2026-06-12: the D1 deferred-fragment stylesheet tranche now parses
      `renderDeferredStream` output into element/attribute facts for the `<fw-fragment>`,
      stylesheet `<link>`, and Tailwind class-bearing fragment body, preserving the SPEC §13.1
      stylesheet-hint contract without regex-matching the rendered HTML string.
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
      task names from `package.json`, executes `vite.config.ts` through a `defineConfig` shim to
      inspect the real Vite+ task graph, parses CI task order, parses Vitest/Node task commands
      into config/module facts, and imports the configured acceptance metadata/perf runner
      entrypoint instead of regex-parsing root Vite task source. Verification:
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
      Partial evidence 2026-06-12: the same P4 commerce touch-graph tranche now transpiles and
      executes the generated `examples/commerce/src/generated/touch-graph.ts` artifact, then
      compares its exported `commerceTouchGraph` and invalidation-set data to structured graph
      expectations instead of substring-scanning or whole-source comparing the generated module.
      Same-session evidence: `node --test --test-name-pattern "P4 commerce touch graph is a
      committed generated artifact" tests/fw-check.node.mjs` and `pnpm exec vp check
      tests/fw-check.node.mjs plans/codebase-quality-round2.md`.
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
      Partial evidence 2026-06-12: the P10 pre-launch ledger-honesty tranche records a dated
      local audit row for the required pre-launch evidence sections and keeps the external
      trademark/domain/npm-scope/linguistic rows pending; `tests/fw-check.node.mjs` now asserts
      that distinction instead of accepting only the presence of the checklist headings.
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
      Partial evidence 2026-06-12: `shared.ts` now exposes
      `applySourceReplacementsWithOffsetMap`, returning patched source and its offset map from
      the same original span list; `lower/inline-derives.ts` uses that helper for the synthesized
      derive-prefix lowering instead of separately applying replacements and reconstructing the
      map. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/shared.test.ts packages/compiler/src/index.test.ts -t "inline attribute expressions|source replacements"`
      and
      `pnpm exec vp check packages/compiler/src/shared.ts packages/compiler/src/shared.test.ts packages/compiler/src/lower/inline-derives.ts plans/codebase-quality-round2.md`.
      Partial evidence 2026-06-11: `compileComponentModule` now passes its already-parsed
      `ComponentModuleModel` into `lowerEventHandlers`, and `lower/handlers.ts` walks that model
      instead of reparsing the lowered source with a fake filename for event-attribute discovery;
      the fallback parser path was removed, so handler lowering now requires its caller-owned
      model explicitly. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts` and
      `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/index.ts`.
      Partial evidence 2026-06-12: `scan/parse.ts` now records zero-argument JSX arrow
      attribute body facts, body property accesses, call arguments, and references on the
      `JsxAttributeModel`; `lower/handlers.ts` consumes those parsed facts for handler capture
      diagnostics and element-param discovery, and `emit/client.ts` consumes the parsed arrow
      body instead of reparsing handler attribute text. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/emit/client.ts packages/compiler/src/types.ts`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: zero-argument JSX arrow body
      `PropertyAccessPathModel` facts now carry parser-derived boolean/number usage
      classifications, and `lower/handlers.ts` consumes those facts for `fw-param-types`
      before falling back to the legacy expression reparse path. `scan/parse.test.ts` pins
      numeric, boolean, and string/default contexts, and `handler-lowering.test.ts` keeps the
      emitted coercion behavior stable. A current `rg` audit shows no production
      `parseComponentModule()` call sites outside `compile.ts` and the parser module; the
      remaining open work is the broader string-to-string lowering pipeline and offset-map
      consolidation. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts`,
      and `git diff --check`.
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
      Partial evidence 2026-06-12: `model-pipeline.ts` now owns the
      `ComponentPipelineState` transition helper, and `compile.ts` threads source/model ownership
      through that shared seam instead of open-coding each post-lowering `modelForSourceChange`
      handoff. The lowering passes are still source-returning, so the broad span-patch pipeline
      item remains open, but the critical path now has one tested transition API for replacing
      per-pass string rewrites. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: `model-pipeline.ts` now applies explicit
      `SourceReplacement` patch lists through `lowerComponentPipelinePatches`, returning both
      the next source/model state and a generated-to-author offset map. `compile.ts` consumes
      view-transition and platform-behavior lowering as patch lists instead of asking those
      passes to rewrite source internally, while the legacy source-returning wrappers remain for
      direct lower-module callers. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/platform-lowering.test.ts packages/compiler/src/compile-component.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile.ts packages/compiler/src/lower/view-transitions.ts packages/compiler/src/lower/platform.ts`.
      Additional evidence 2026-06-12: static `<Link>` and `href(...)` navigation lowering now
      expose explicit `SourceReplacement` patch lists through `navigationLinkLowering()` and
      `navigationHrefLowering()`, and `compile.ts` applies both through
      `lowerComponentPipelinePatches` instead of passing rewritten navigation source through the
      generic source handoff. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: inline query derive lowering now returns its synthesized
      export prefix and `SourceReplacement` list as patch data, and `compile.ts` applies it
      through `lowerComponentPipelinePatches` with a prefix-aware generated-to-author offset map.
      `lower/inline-derives.ts` no longer applies its own source rewrite or offset-map helper,
      so synthesized derive exports, `data-derive`, and `data-bind` sugar now pass through the
      same source/model transition seam as view-transition, platform, and navigation lowering.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/query-coverage.test.ts`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check --fix packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile.ts packages/compiler/src/lower/inline-derives.ts`.
      Additional evidence 2026-06-12: server render lowering now exposes
      `serverRenderLowering(...).replacements`, and `compile.ts` applies those server-render
      patches explicitly before emitting the server module. The compatibility
      `serverRenderSource()` wrapper remains for direct callers, but the compile path no longer
      hides server render source rewriting behind an emitter-local apply step. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts packages/compiler/src/model-pipeline.test.ts`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/emit/server.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: inline text binding lowering and hand-written binding stamp
      drift validation now use parser-owned `JsxElementModel.childSource` when deciding whether a
      JSX element body is a sole expression, removing another validator/lowerer dependency on
      ad-hoc module-source slicing for child content. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/stamps.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/lower/inline-derives.ts packages/compiler/src/validate/bindings.ts`.
      Additional evidence 2026-06-12: server render-host stamping now consumes the parsed
      `JsxElementModel.openingSource` for the host opening tag before applying handler and
      identity/dependency/state stamps, falling back to source slicing only if no parsed host
      element is available. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/stamps.test.ts`
      and `pnpm exec vp check packages/compiler/src/emit/server.ts`.
      Additional evidence 2026-06-12: `jsxElementChildBody()` now derives trimmed child bodies
      from parser-owned `JsxElementModel.childSource`, and query-update plan collection no
      longer accepts module source for data-bind-list/template extraction. Fragment-target child
      validation and data-bind-list validation now consume the parsed child body helper directly.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/fragment-targets.test.ts packages/compiler/src/query-coverage.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: `JsxExpressionModel` now records parser-owned
      JSX-expression container spans, and mixed-text inline `data-bind` lowering patches those
      spans directly instead of searching module source for surrounding braces with `indexOf`.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-update-plans.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/inline-derives.ts`.
      Additional evidence 2026-06-12: static CSS scoping now derives the rendered host selector
      from `componentRenderHostElement(model).tag`, and `emitCssModule()` no longer accepts
      module source just to recover the opening tag name. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/css.test.ts packages/compiler/src/compile-component.test.ts`
      and `pnpm exec vp check packages/compiler/src/css.ts packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: `serverRenderLowering()` now consumes handler facts plus
      the parsed model only; render-host stamping uses `JsxElementModel.openingSource` and no
      longer accepts module source as a fallback for host tag recovery. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/stamps.test.ts`
      and `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: `JsxAttributeModel` now carries parser-owned
      `leadingStart` spans, and platform behavior lowering uses that model span when deleting
      provable handler attributes. `platformBehaviorLowering()` no longer accepts module source.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/platform-lowering.test.ts packages/compiler/src/compile-component.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/platform.ts packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: `lowerInlineAttributeDerives()` no longer accepts module
      source or returns a source echo for diagnostics; `compile.ts` explicitly keeps the
      pre-prefix navigation source as the diagnostic coordinate surface while the lowerer remains
      model-only patch data. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/compile-component.test.ts`
      and
      `pnpm exec vp check packages/compiler/src/lower/inline-derives.ts packages/compiler/src/compile.ts`.
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
      Additional evidence 2026-06-12: `lowerPlatformBehaviors` now recognizes zero-argument
      document-element actions through the TypeScript parser front-end instead of regex-matching
      handler expression text. `scan/parse.ts` models `document.getElementById(...).method()`
      and matching `.open = !...open` toggles, while `platform-lowering.test.ts` pins typed/as-cast
      dialog actions that the old text regex could not lower. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/platform-lowering.test.ts` and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/platform.ts packages/compiler/src/platform-lowering.test.ts`.
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
      Additional evidence 2026-06-12: `packages/compiler/src/lower/navigation.ts` no longer
      imports `parseComponentModule`; it exposes separate static `<Link>` and static `href`
      lowering passes, and `packages/compiler/src/compile.ts` owns the post-link and post-href
      `modelForSourceChange` decisions with the author file name. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts packages/compiler/src/navigation-lowering.test.ts -t "navigation|Link|href"`,
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/lower/navigation.ts plans/codebase-quality-round2.md`,
      and `rg -n "parseComponentModule as parseComponentModuleModel|parseComponentModule\\(" packages/compiler/src/lower packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now exposes the parsed
      `componentRenderHostElement`; `emit/server.ts` uses that model to read existing `fw-deps`
      when merging declared query deps instead of regex-reading the rendered opening tag. The
      server emitter still uses a narrow replacement to update an existing attribute, but the
      dependency facts now come from the caller-owned JSX model. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "render host|fw-deps|query dependencies|parsed component render host"`,
      `pnpm exec vp check --fix packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/emit/server.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: JSX expression models now carry parser-derived free
      identifier references, handler lowering consumes those references directly for FW201, and
      fragment-target child validation consumes the same parsed JSX-expression references for
      FW230 instead of reparsing child HTML/source text. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/fragment-targets.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/validate/component-contracts.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/fragment-targets.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/compiler/src/model-pipeline.ts` no longer
      exports the legacy source-to-source transition wrapper; production lowering state now
      advances only through `lowerComponentPipelinePatches`, which applies checked replacement
      spans, carries an offset map, and reparses only when the patched source differs. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec vitest --run packages/compiler/src`,
      `pnpm exec vp check packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: static `href(...)` navigation lowering is now a
      model-only pass; `navigationHrefLowering` no longer accepts source text, and `compile.ts`
      passes the post-`<Link>` parsed model directly into the href patch producer. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: JSX element models now carry parser-owned
      opening-tag source, and `viewTransitionLowering` consumes that model fact directly instead
      of accepting raw module source and slicing by element spans inside the lowerer. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/lower/view-transitions.ts packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: JSX element models also carry parser-owned child source,
      and static `<Link>` navigation lowering is now a model-only patch producer that consumes
      `openingSource`/`childSource` rather than accepting raw module source. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `emit/server.ts` now updates existing `fw-deps`
      attributes by `JsxAttributeModel` span relative to the parsed render host instead of
      regex-searching the opening tag slice. `stamps.test.ts` pins a single-quoted authored
      `fw-deps` attribute that is replaced from the parsed span while preserving neighboring
      attributes and native-host identity stamping. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts -t "fw-deps|parsed attribute spans|query dependencies|returned host"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/stamps.test.ts`.
      Additional evidence 2026-06-12: `lower/view-transitions.ts` now rewrites
      `viewTransitionName` and static `style` through parsed JSX attribute spans instead of
      regex-scanning the opening tag text. `view-transitions.test.ts` pins a single-quoted
      style attribute on a self-closing host, proving the merge preserves neighboring attributes
      and removes only the parsed transition attribute. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/view-transitions.test.ts`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/lower/view-transitions.ts packages/compiler/src/view-transitions.test.ts`.
      Additional evidence 2026-06-12: server render emission now appends generated host
      attributes (`fw-c`, missing `fw-deps`, and `fw-state`) using the parsed render-host
      self-closing fact instead of regex-matching the opening tag suffix. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/compiler/src/view-transitions.test.ts`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/stamps.test.ts packages/compiler/src/view-transitions.test.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records document-element actions on
      zero-argument JSX arrow attributes, and `lower/platform.ts` consumes that parser-owned
      fact for dialog/popover/details platform substitutions instead of reparsing handler
      expression text. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/platform-lowering.test.ts -t "document element|platform|dialog|popover|details"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/platform.ts packages/compiler/src/platform-lowering.test.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records JSX ancestor tag facts on
      each `JsxElementModel`, and `validate/markup.ts` consumes those parser-owned ancestry
      facts for paragraph/content-model and table-row checks instead of recomputing ancestors
      from element span containment inside the validator. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/id-content-model.test.ts -t "ancestor|content-model|IDREF|duplicate literal ids|repeatable"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/validate/markup.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records parser-owned
      property-access facts on JSX attribute expressions and JSX child expressions, and
      inline-derive lowering consumes those facts instead of reparsing attribute, sole-text, and
      mixed-text expression snippets through `propertyAccessPaths()` / `solePropertyAccessPath()`
      helpers. `scan/parse.test.ts` pins the JSX expression facts, and `index.test.ts` proves
      string literals containing `cart.count` no longer fabricate attribute derives or text
      binding stamps while real `{cart.count}` still lowers to `data-bind`. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "JSX attribute and child expression property access|does not derive query stamps|inline attribute expressions|sole text-child query expressions|mixed text query expressions"`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/index.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: query-update coverage and stamp-drift validation now
      consume those parser-owned JSX expression facts as well, so FW311/FW222/FW223 no longer
      reparse JSX child expression snippets to decide whether a rendered query expression is a
      sole property path. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "JSX attribute and child expression property access|does not derive query stamps|query-dependent render positions|FW311 positions|Redundant hand-written binding stamp|Hand-written binding stamp|data-bind paths"`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/index.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records property-access facts per
      call argument, and query-update coverage consumes those facts for `renderOnce(...)` instead
      of reparsing joined call-argument text. `scan/parse.test.ts` pins nested call arguments and
      string-literal exclusions; `index.test.ts` proves a nested `renderOnce(...)` call with a
      query-looking string argument records only real parsed query reads. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "call argument property access|renderOnce coverage|query-looking text inside renderOnce|string literals inside inline expressions"`,
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/index.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records object-literal property
      path facts for each call argument, and `validate/component-contracts.ts` consumes those
      parser-owned facts for FW320 event-payload/query-overlap diagnostics instead of reparsing
      the second `emit(...)` argument through `objectLiteralPropertyPaths()`. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/state-events.test.ts -t "call argument property access|event payload|FW320"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/validate/component-contracts.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records parser-owned static literal
      values for component `state: () => ({ ... })` return objects, including nested objects,
      negative numbers, booleans, strings, and nulls. `emit/server.ts` consumes that model fact
      for `fw-state` stamping instead of reparsing the state object source with the
      string-scanner `parseLiteralObject()`. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/state-events.test.ts -t "static literal state|non-static state|stamps static island-local state|preserves apostrophes"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/emit/server.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records parser-owned static literal
      values for call arguments and JSX attribute expressions, and `lower/navigation.ts`
      consumes those facts for static `href(...)` option objects plus `<Link params/search>`
      attributes instead of reparsing object-literal snippets through `parseLiteralObject`.
      Unsupported object literals now stay `undefined` rather than being conflated with a real
      `null` literal. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/navigation-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/navigation.ts packages/compiler/src/navigation-lowering.test.ts`,
      and `rg -n "parseLiteralObject|literalStringValue" packages/compiler/src/lower/navigation.ts packages/compiler/src/scan/parse.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records static values and
      property-access facts for each zero-argument JSX arrow call argument, and
      `lower/handlers.ts` consumes those parsed facts for element-param extraction instead of
      reparsing concise call arguments or filtering literals through `literalValue()`. The
      parser test pins quoted commas, literal arguments, object arguments, and `state` arguments
      through the model. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/handler-lowering.test.ts`,
      and `rg -n "literalValue|zeroArgArrowCallArguments|parseLiteralObject|literalStringValue" packages/compiler/src/lower/handlers.ts packages/compiler/src/lower/navigation.ts`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records references and
      property-access facts for all JSX attribute expressions, not just zero-argument arrows,
      and `lower/handlers.ts` consumes those parser-owned facts for non-arrow event-param
      extraction and FW201 capture checks before falling back to standalone helper parsing.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `lower/handlers.ts` no longer imports or calls
      `functionBodyPropertyAccessPaths` for event element-param extraction. Non-arrow event
      expressions now receive parser-owned `PropertyAccessPathModel` facts from
      `JsxAttributeModel`, preserving inferred boolean/number usage where available and
      defaulting unresolved cases to string instead of reparsing body text. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/handler-lowering.test.ts packages/compiler/src/scan/parse.test.ts`,
      `pnpm exec vp check packages/compiler/src/lower/handlers.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts`,
      and `rg -n "functionBodyPropertyAccessPaths|collectSerializableMemberExpressions\\(|serializableMemberExpressions\\(" packages/compiler/src/lower/handlers.ts`.
      Additional evidence 2026-06-12: the legacy source-returning compatibility wrappers
      `lowerViewTransitions`, `lowerPlatformBehaviors`, `lowerNavigationLinks`,
      `lowerNavigationHrefs`, and `serverRenderSource` were removed from production compiler
      modules. The remaining compile path consumes patch-producing lowering APIs directly, and
      a source audit shows no compiler call sites for those removed wrappers. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/platform-lowering.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec vp check packages/compiler/src/lower/navigation.ts packages/compiler/src/lower/platform.ts packages/compiler/src/lower/view-transitions.ts packages/compiler/src/emit/server.ts`,
      and `rg -n "lowerNavigationHrefs|lowerNavigationLinks|lowerViewTransitions|lowerPlatformBehaviors|serverRenderSource" packages/compiler/src`.
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
      Additional evidence 2026-06-12: handler element-param discovery now reuses
      `functionBodyPropertyAccessPaths` from the TypeScript scan front-end instead of carrying a
      private property-access path walker in `lower/handlers.ts`; `scan/parse.test.ts` pins
      function-body path extraction with optional receiver segments and string-literal immunity.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts packages/compiler/src/index.test.ts packages/compiler/src/shared.test.ts`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/handlers.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: handler element-param type inference now reuses the
      TypeScript parser front-end's `expressionUsageType` classifier for the remaining fallback
      path instead of duplicating boolean/number parent-context checks in `lower/handlers.ts`.
      `scan/parse.test.ts` and `handler-lowering.test.ts` keep the string-literal immunity and
      AST usage-context behavior pinned. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/handler-lowering.test.ts -t "handler property access|element param types|AST usage contexts|string literal comparisons"`,
      `pnpm exec vp check --fix packages/compiler/src/scan/parse.ts packages/compiler/src/lower/handlers.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `emit/client.ts` now exposes
      `handlerExpressionLowering(expression, params).replacements`, so client handler body
      rewriting is available as explicit AST-derived `SourceReplacement` patch data before the
      existing emitter compatibility path applies it. `handler-lowering.test.ts` pins the exact
      source spans for `state` and element-param rewrites while preserving string-literal text.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/handler-lowering.test.ts`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check --fix packages/compiler/src/emit/client.ts packages/compiler/src/handler-lowering.test.ts`.
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
      Additional evidence 2026-06-12: `scan/parse.ts` now records string-literal array values
      and concise arrow-function parts for each call argument, and `analyze/query-updates.ts`
      consumes those parser-owned `derive(...)` argument facts instead of reparsing exported
      derive argument text through `stringLiteralArrayValues()` / `arrowFunctionParts()`.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts -t "call argument property access|named derives|semicolons|derive"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/analyze/query-updates.ts`.
- [x] **MED — Extract `src/types.ts`; break the layering inversion.** Canonical fact types live
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
      Additional evidence 2026-06-12: wrapped JSX expression path recognition now lives in the
      TypeScript parser front-end as `soleWrappedPropertyAccessPath`; inline text binding
      lowering and binding drift validation both consume that helper instead of carrying private
      `{...}` wrappers around `solePropertyAccessPath`. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "wrapped JSX expression|inline derive|data-bind|FW222|FW223"` and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/lower/inline-derives.ts packages/compiler/src/validate/bindings.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: trimmed JSX child-body extraction now lives in the
      TypeScript parser front-end as `jsxElementChildBody`; query-update analysis plus binding
      and fragment-target validators consume that shared model helper instead of each slicing and
      trimming JSX children independently. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "JSX child bodies|fragment target|data-bind update plans|template stamp"`,
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts packages/compiler/src/validate/component-contracts.ts`,
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
      Additional evidence 2026-06-12: the source/model transition rule now lives in
      `packages/compiler/src/model-pipeline.ts` with direct tests proving unchanged lowering
      passes reuse the existing model and changed passes parse exactly once with the author file
      name. `compile.ts` consumes that helper instead of relying on a private untested convention.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/model-pipeline.test.ts packages/compiler/src/index.test.ts packages/compiler/src/navigation-lowering.test.ts -t "compiler model pipeline|navigation|Link|href"` and
      `pnpm exec vp check packages/compiler/src/model-pipeline.ts packages/compiler/src/model-pipeline.test.ts packages/compiler/src/compile.ts`.
      Additional evidence 2026-06-12: app-authored string-render diagnostics now consume
      `ComponentModuleModel` facts from the caller-owned parse. `scan/parse.ts` records string
      render return spans on component models, `validate/authoring-surface.ts` uses those facts
      for normal app components, and `compile.ts` only keeps the standalone source parser for IR
      artifacts and rare exported `renderSource` fallback checks. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "FW235|compiler-emitted IR|fixpoint"`,
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "string-rendered|FW235|component model|compiler-emitted IR"`,
      `pnpm exec vp check packages/compiler/src/compile.ts packages/compiler/src/scan/parse.ts packages/compiler/src/validate/authoring-surface.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `scan/parse.ts` now records the first rendered HTML tag
      name on `StringRenderModel` facts, and `validate/authoring-surface.ts` consumes that
      parser-owned tag metadata for FW235 TSX-direction help instead of regex-reading normal
      component string-render text. The standalone `renderSource()` fallback path remains for
      rare app-authored IR exports. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/compile-component.test.ts -t "first HTML tag|FW235|string-rendered"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check --fix packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/validate/authoring-surface.ts`.
      Additional evidence 2026-06-12: exported app-authored `renderSource()` string-return
      diagnostics now also consume the caller-owned parse. `scan/parse.ts` records
      `renderSourceReturns` with literal spans and first tag metadata on `ComponentModuleModel`,
      and `validate/authoring-surface.ts` consumes those facts when a model is available instead
      of launching a second renderSource-specific AST walk. The standalone source parser remains
      only for direct validator callers that do not provide a model. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/compile-component.test.ts -t "renderSource|FW235|string-rendered|first HTML tag"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/validate/authoring-surface.ts packages/compiler/src/compile-component.test.ts`.
      Additional evidence 2026-06-12: server render emission now reads the parsed render host
      element tag and `fw-c` attribute facts when deciding native-host component identity
      stamping. `emit/server.ts` no longer regex-reads the opening tag name from the sliced
      source for this path, and `stamps.test.ts` pins a native-host render whose preceding
      string literal mentions the component tag. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/compiler/src/compile-component.test.ts -t "fw-c|native host|returned host|fixpoint"`,
      `pnpm exec vitest --run packages/compiler/src`, and
      `pnpm exec vp check packages/compiler/src/emit/server.ts packages/compiler/src/stamps.test.ts plans/codebase-quality-round2.md`.
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
      Closing evidence 2026-06-12: `emitElementParamTypes` now lives beside the canonical
      `ElementParam` fact in `packages/compiler/src/types.ts`, so `packages/compiler/src/emit/server.ts`
      imports handler fact data and param-type attribute emission from the fact module instead of
      depending on the handler-lowering phase. A current `rg` audit shows no compiler production
      modules import public types back through `index.ts`, no duplicate `queryShapesFromFacts`,
      shape-wrapper helpers, or `removeJsxAttribute(s)` implementations remain, and the former
      `emit/server.ts -> lower/handlers.ts` dependency is gone. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "handler captures|element params|registry metadata|server file"`,
      `pnpm exec vp check packages/compiler/src/types.ts packages/compiler/src/lower/handlers.ts packages/compiler/src/emit/server.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional evidence 2026-06-12: data-bind-list stamp extraction now lives on the analyzer
      path as `collectDataBindListStamps`; `validate/bindings.ts` consumes that shared fact
      collector instead of maintaining a private duplicate that could drift from client query-plan
      emission. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "data-bind|FW227|FW302|template stamp|query update"` and
      `pnpm exec vp check packages/compiler/src/analyze/query-updates.ts packages/compiler/src/validate/bindings.ts plans/codebase-quality-round2.md`.
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
      Additional evidence 2026-06-12: `packages/compiler/src/scan/text.ts` now skips template
      interpolation bodies by recursively matching `${...}` tokens, so the remaining scanner
      utility used by CSS literal balancing no longer treats interpolation braces as inert string
      text. `packages/compiler/src/scan/text.test.ts` pins nested template interpolation and
      token balancing around interpolated template literals. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/text.test.ts packages/compiler/src/index.test.ts -t "CSS|css-looking"` and
      `pnpm exec vp check packages/compiler/src/scan/text.ts packages/compiler/src/scan/text.test.ts plans/codebase-quality-round2.md`.
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
      Additional evidence 2026-06-12: mutation-handler scanning now records AST-derived
      property-access facts with source spans, and FW330 direct-DB validation consumes those
      facts instead of regex-matching handler body text. `index.test.ts` pins real mutation
      handler string/template text such as `request.db.insert(...)` as non-diagnostic while
      preserving the authored `request.db` diagnostic span. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "FW330|mutation handler property access|direct db"` and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/validate/component-contracts.ts packages/compiler/src/index.test.ts`.
      Additional evidence 2026-06-12: mutation-handler parameter names now live on the parsed
      `MutationHandlerModel`, including typed identifiers and simple destructured parameters, so
      FW330 no longer normalizes handler parameters from source text before checking direct DB
      access. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/index.test.ts -t "FW330|mutation handler parameter|mutation handler property access|direct db"` and
      `pnpm exec vp check packages/compiler/src/scan/parse.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/validate/component-contracts.ts packages/compiler/src/index.test.ts`.

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
      Additional evidence 2026-06-12: write predicate summaries now consume
      `ExtractedPredicateFact` records carried by `ExtractedWriteCall` from the original
      ts-morph write-chain AST; the old `extractPredicateSummary(call.statement, ...)`
      serialized-statement reparse path and `statement` payload were removed. Source and
      project extraction now share the same parsed predicate facts for write keys,
      update-from read keys, and non-eq degradation. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "predicate|parameterized keys|project insert-select and update-from read sources|project write predicates|static element-access write methods"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional evidence 2026-06-12: source-mode function discovery now computes write calls,
      local helper calls, and FW406 unresolved receiver/helper surfaces from the live ts-morph
      callback/body nodes before the temporary source file is forgotten, leaving serialized body
      reparses only as compatibility fallbacks. Expression-bodied callback bodies include the
      body call node itself, so `const addItem = (db) => writeAudit(db)` degrades to FW406
      instead of disappearing under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional bounded evidence 2026-06-12: direct touch-summary construction now requires
      AST-derived function facts and no longer reparses serialized function-body strings as a
      fallback for local helper calls, write calls, receiver aliases, external helper FW406s, or
      raw/relational receiver FW406s. The slice deleted the string-body wrappers
      `extractLocalFunctionCalls`, `extractDrizzleWriteCalls`, `extractExternalDbArgumentCalls`,
      `extractUnclassifiedDrizzleReceiverCalls`, `extractReceiverMutationCalls`,
      `extractRelationalQueryCalls`, `drizzleReceiverNames`, and
      `destructuredDrizzleReceiverAliases`, preserving SPEC §10-§11's "facts from parsed code,
      unknowns as FW406" contract. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "local helper summaries|unclassified Drizzle receiver calls|relational query API|raw db.execute|source extraction state"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
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
      Additional evidence 2026-06-12: source-mode namespace and named table imports now scope
      touch/query table and column-shape facts to the referenced relative source module instead
      of treating any `import * as schema` or named import as proof for every same-named table
      across the input set. `packages/drizzle/src/index.test.ts` covers same-identifier schema
      files where the unrelated module and private namespace members must not fabricate extra
      domains or projection shapes, preserving SPEC §10-§11's explicit static-fact contract.
      Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "namespace-imported"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode query definition discovery now walks ts-morph
      `VariableDeclaration` initializers instead of regex-scanning whole files for
      `query("...")`, so comments, strings, and templates containing exported query-like
      declarations no longer fabricate query read facts under SPEC §10-§11. Same-session
      evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "query definitions from comments strings or templates|query reads or relational diagnostics|Drizzle selects"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: touch-graph extraction now records
      `db.query.<table>.findMany/findFirst(...)` as static `relational-query` read facts when
      the relational table property resolves to an annotated table, while computed relational
      table names remain visible as FW406 under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "relational query API|static element-access raw and relational"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "relational query API|unresolved project relational"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode query read-domain, relational-diagnostic,
      join-nullability, and instance-key extraction now carries ts-morph query object facts
      through `ExtractedQueryDefinition` instead of serializing the query object and reparsing it
      with `queryBodyCallExpressions`. Static element-access predicate paths such as
      `cartItems["cartId"]` / `input["cartId"]` now resolve through AST nodes under
      SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode query output-schema detection now carries a
      ts-morph `ObjectLiteralExpression` fact from query definition extraction instead of
      scanning query object text with bespoke brace/comment/string helpers. The slice deleted
      `hasDeclaredQueryOutputSchema`, `readObjectPropertyName`, `skipTrivia`,
      `nextTopLevelEntry`, `findStringEnd`, and `findMatchingBrace`; `packages/drizzle/src/index.test.ts`
      covers static `output` properties, comments/strings, dynamic computed keys, and spread-only
      config under SPEC §10.2/FW410. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts packages/drizzle/src/runtime-surface.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode table alias and conditional-branch target
      extraction now walks ts-morph initializer expressions instead of regex-splitting
      initializer text, so unresolved conditional branches containing string punctuation keep
      resolved branch facts while surfacing explicit FW406 under SPEC §10-§11. Same-session
      evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "opaque branch strings contain colons|another branch is unresolved|local conditional table initializers"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "conditional table FW406|local conditional table resolution"`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check HEAD~1..HEAD`.
      Additional evidence 2026-06-12: source-mode receiver discovery now carries receiver aliases
      from ts-morph callback parameter binding nodes instead of string-splitting serialized
      parameter text with `splitTopLevelArgs`; the helper was deleted, and destructured
      `{ db: writer } = ...` parameters are extracted before body and transaction alias folding.
      This keeps receiver facts tied to parsed live code under SPEC §10-§11. Same-session
      evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "destructured receiver parameters|parenthesized parameter initializers|transaction callback receiver aliases|destructured Drizzle receiver aliases"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "destructured receiver parameters|transaction callback receiver aliases"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode transaction callback receiver aliases are no
      longer added to the whole-function receiver name set; receiver uses now walk the ts-morph
      identifier declaration back to a lexically enclosing `.transaction(...)` callback before
      treating the parameter as a Drizzle receiver. This prevents same-name unrelated or shadowed
      callback parameters from fabricating write touches or FW406 helper surfaces under SPEC
      §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "transaction callback receiver aliases|same-name callback receivers"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "transaction aliases|transaction callback receiver aliases"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source/project column-builder shape extraction now walks
      ts-morph initializer call chains for builder names plus `.notNull()`/`.primaryKey()`
      methods instead of regex-searching serialized initializer text, so comments and strings
      containing nullability markers no longer fabricate non-null query shapes under SPEC
      §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "column nullability"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "column nullability"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      and `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: source/project relational query extraction now gates
      `*.query.<table>.findMany/findFirst(...)` table facts on parsed query callback receiver
      parameters, so live non-DB objects inside query bodies no longer fabricate read domains or
      FW406/FW411 diagnostics under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "non-receiver objects|relational query API reads|element-access relational"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "non-receiver objects|element-access relational"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      and `pnpm exec vitest --run conformance/drizzle-pin`.
      Additional evidence 2026-06-12: source/project select-chain query extraction now gates
      `select`/`from`/join/`where` facts on the parsed query callback receiver chain, so
      live non-DB builders inside query bodies no longer fabricate read domains, FW406/FW411
      diagnostics, nullable join facts, or instance keys under SPEC §11.1. Same-session
      evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "non-receiver builders|Drizzle selects|instance keys|query reads or relational diagnostics"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source/project query extraction now treats real Drizzle
      `selectDistinct(...)` and `selectDistinctOn(..., projection)` calls as select-like AST
      query roots instead of only accepting `select(...)`. `selectDistinctOn` keeps its projection
      tied to the parsed second argument, so read domains and result shapes stay derived from
      ts-morph nodes under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "distinct selects"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "distinct selects"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source/project insert-select and update-from read-source
      extraction now walks the original ts-morph write-call chain instead of serializing the
      write statement and reparsing it through a separate source helper. Project mode resolves
      read-source table arguments through the same table-symbol map used for write targets, so
      table facts stay aligned with the synthetic project source while string contents such as
      `".from(prices)"` remain inert under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "read source tables from write call AST|project insert-select and update-from read sources|direct insert-select and update-from"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "real Drizzle project read sources|direct table source extraction"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source/project query read extraction now keeps
      receiver-bound `.from(...)`/join calls visible when their table argument is a computed
      expression: the read source is emitted as FW406 instead of disappearing or borrowing a
      descendant table symbol. Query instance-key extraction now carries parsed operand facts
      from ts-morph nodes instead of regex-parsing serialized `where(eq(...))` operand strings,
      and source callback extraction no longer slices/stores callback body text just to feed
      AST-backed extraction. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "computed query read sources|static element access predicates|Drizzle selects"`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "computed real Drizzle read sources|real Drizzle Postgres subset"`,
      `corepack pnpm exec vitest --run packages/drizzle/src`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin`,
      `corepack pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: project-mode query fact extraction now walks the
      original ts-morph `SourceFile` for query definitions, read-source table expressions, and
      `where(eq(...))` instance-key operands instead of routing project query bodies back
      through `sourceWithProjectExtractionResolved(...)` synthetic-source text. The rewritten
      project source is still used only as table-registry context, while authored source remains
      the site/diagnostic coordinate system under SPEC §10-§11. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts`;
      `corepack pnpm exec vitest --run packages/drizzle/src`;
      `corepack pnpm exec vitest --run conformance/drizzle-pin`;
      `corepack pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: project-mode write-target and
      insert-select/update-from read-source table extraction now resolves table arguments
      through ts-morph table symbols and static property paths instead of serializing the
      argument node through `sourceWithProjectTableIdentifiersResolved(...)`. Namespace-imported
      project writes and predicates such as `db.update(schema.cartItems).where(eq(schema.cartItems.id, id))`
      now resolve from the real exported table property symbol while computed or unproven table
      expressions still degrade to FW406 under SPEC §10-§11. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts -t "namespace-imported project write targets|imported table symbols|static element-access writes|recognizes real Drizzle receiver types"`;
      `corepack pnpm exec vitest --run packages/drizzle/src`;
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
      `corepack pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: project-mode namespace-imported table access now
      carries a ts-morph namespace export map into query and write extraction, so
      `schema.products` and static `schema["products"]` projections/read sources/write targets
      resolve from the referenced module's Drizzle table symbol while computed or unexported
      access still degrades to FW406. This narrowed the remaining synthetic project context
      source rewrite to statically proven namespace string keys while keeping table registry
      lookup aligned with authored source coordinates under SPEC §10-§11. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "namespace.*project (query|write)|namespace static element-access"`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "namespace.*project (query|write)|namespace static element-access"`,
      `corepack pnpm exec vitest --run packages/drizzle/src`,
      and `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: project-mode table registry context no longer rewrites
      source text at all before touch/query extraction. `packages/drizzle/src/static.ts` deleted
      `sourceFilesWithProjectExtractionResolvedFromProject`, `sourceWithProjectExtractionResolved`,
      `projectTableNamesByIdentifier`, and `applySourceReplacements`; project query context now
      carries original source plus ts-morph-derived column shapes, and project touch/query table
      lookup uses `projectSourceModuleContext(...)` entries built from resolved table symbols and
      namespace accesses. This removes the stale synthetic-source line-coordinate path while
      preserving SPEC §10-§11's explicit-table-fact/FW406 contract. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "imported table symbols|namespace-imported project|namespace static element-access project|project extraction state|project query"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: query loaders now walk ts-morph helper
      `CallExpression` nodes and mark identifier helpers that receive the loader's Drizzle
      receiver as FW406 instead of dropping the whole query fact when no direct select/read is
      visible. `packages/drizzle/src/index.test.ts` covers the project-mode disappearing-query
      case, and `conformance/drizzle-pin/src/index.test.ts` pins the same helper db handoff
      against real `drizzle-orm` imports under SPEC §11.1. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "query-loader helpers"`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "helper db handoff"`,
      `corepack pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: source-mode parse helpers now receive the
      `SourceFileInput` under analysis and create temporary ts-morph source files with the
      authored `fileName` instead of a module-global synthetic `__jiso_source.ts` name. This
      localizes source extraction identity to each file/call while preserving SPEC §10-§11's
      parsed-code fact contract and keeping `ts-morph` isolated to `@jiso/drizzle/static`;
      `packages/drizzle/src/runtime-surface.test.ts` pins the runtime/static seam and the
      absence of the synthetic source filename. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/index.test.ts -t "runtime annotation|source extraction state|project extraction state"`,
      `corepack pnpm exec vitest --run packages/drizzle/src`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin`,
      `corepack pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/runtime-surface.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.

- [ ] **HIGH — Remove fact-fabricating heuristics; degrade to FW406.**
      Column type from projection-key name (`/(count|qty|...)$/i` → number, index.ts:993);
      receiver detection by parameter name (`/^(db|tx|...|client|...)$/`, :1856-1858);
      `nullableJoinTables` only matching `.leftJoin` (:1010-1020 — right/full join nullability
      silently dropped). Real column types via the checker (project mode) or Drizzle column
      objects (pinned-runtime mode); unknown → FW406, never a guess.
      Additional evidence 2026-06-12: unknown column builders no longer fabricate string query
      shapes; `tableColumnShapes` omits unrecognized builder calls so selected custom Drizzle
      columns stay visible as FW406 unresolved projections under SPEC §10-§11. The package test
      covers source/project extraction with a `customType`-style builder, and pinned conformance
      imports real `drizzle-orm/pg-core` `customType`. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "unknown column builder"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "custom column builders"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional evidence 2026-06-12: write predicate row-key and non-eq classification now
      inspects parsed predicate AST nodes instead of string-matching predicate text, so
      `sql.raw("products.id")` no longer fabricates `predicate: "non-eq"` touch facts under
      SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`;
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check HEAD~1..HEAD`.
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
      Additional evidence 2026-06-12: source-mode select projection shape extraction now walks a
      parsed object literal instead of splitting projection text on top-level commas and the first
      colon, so punctuation inside string-literal projection keys no longer fabricates alternate
      query-shape keys or FW406 paths. Unresolved values keep actionable FW406 projection metadata
      keyed by the real property name under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "projection facts|computed projections|typed sql projections|Drizzle selects"`;
      `pnpm exec vitest --run packages/drizzle/src`;
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: scalar select projection classification now consumes the
      parsed `ts.Expression` for column paths, typed `sql<T>` projections, opaque SQL detection,
      and nullable-table attribution instead of serializing each expression and reparsing or
      regex-matching it. Static element-access columns such as `products["name"]` now resolve
      from AST facts under SPEC §10-§11 instead of degrading to fabricated unresolved projection
      diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts -t "element-access projection|project query shapes"`,
      `pnpm exec vitest --run packages/drizzle/src`,
      `pnpm exec vitest --run conformance/drizzle-pin`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: source-mode select projection discovery now walks
      ts-morph `CallExpression` nodes and real `ReturnStatement` ancestors instead of
      regex-scanning query object text and hand-matching select parentheses, so comments and
      strings containing `return db.select(...)` no longer fabricate the inferred result shape.
      Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "returned select|comments or strings"`;
      `pnpm exec vitest --run packages/drizzle/src`;
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`;
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`;
      and `git diff --check`.
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
      Additional evidence 2026-06-12: source-mode transaction callbacks now parse
      `db.transaction(async (writer) => ...)` and add the callback parameter as a Drizzle
      receiver alias, so writes and helper calls through non-canonical transaction receiver names
      are extracted or degraded to FW406 instead of disappearing; comment/string transaction text
      still cannot fabricate aliases under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "transaction callback receiver aliases|comments and strings"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "transaction callback receiver aliases"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: receiver-bound `refreshMaterializedView(...)` calls from
      the pinned Drizzle Postgres API now share the ts-morph static-member unresolved-surface
      scanner with raw `execute(...)`, so materialized-view refreshes are emitted as FW406
      instead of silently vanishing while comment/string refresh text remains inert under SPEC
      §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "materialized-view refresh|unclassified Drizzle receiver calls"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "materialized-view refresh"`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: receiver-bound `db.$count(...)` calls from the pinned
      Drizzle Postgres API now share the ts-morph static-member unresolved-surface scanner with
      raw `execute(...)` and materialized-view refreshes, so count helper reads are emitted as
      FW406 instead of silently vanishing while comment/string `$count` text remains inert under
      SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "count helper"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "count helper"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: project-mode extraction now carries typed
      `db.transaction(async (writer) => ...)` callback parameters into the Drizzle receiver set,
      so writes through the transaction alias are extracted while distinct fake transaction
      aliases remain ignored under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "project transaction callback receiver aliases"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: project-mode transaction callback receiver aliases now
      carry ts-morph symbol keys alongside their legacy receiver names before write extraction,
      so same-name callback parameters in unrelated lexical scopes no longer fabricate Drizzle
      write touches under SPEC §10-§11. Package and pinned conformance coverage exercise real
      transaction writes plus shadowed same-name fake receivers. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "project transaction callback receiver aliases"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "project transaction aliases"`.
      Additional evidence 2026-06-12: project-mode FW406 unresolved helper/receiver surfaces now
      come from ts-morph call expressions checked against typed Drizzle receiver symbols instead
      of reparsing project callbacks with receiver-name lists. The regression pins external
      helper calls, raw `execute`, `$count`, and relational query calls on the typed receiver
      while same-shaped fake receivers and a shadowed `db: FakeDb` helper remain inert under
      SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "project unresolved helper surfaces"`.
      Additional evidence 2026-06-12: source/project write extraction now routes
      `insert`/`update`/`delete` calls through the parsed static-member helper instead of
      accepting only dot property access, so `db["insert"](...)` and `db["update"](...)`
      write methods are extracted for real Drizzle receivers while fake project receivers stay
      inert under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "static element-access write methods|project static element-access writes"`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "static element-access write methods|real Drizzle receiver types with static element-access write methods"`.
      Additional evidence 2026-06-12: source/project unresolved-surface extraction now treats
      otherwise unclassified direct Drizzle receiver method calls as explicit FW406 surfaces
      while preserving typed-symbol gating and already-classified write/query/transaction
      behavior. Package coverage pins source-mode `db.batch(...)` / `db["$with"](...)`, project
      typed `PgDatabase` receivers versus fake lookalikes, and the pinned real Drizzle
      `PgDatabase` `$with` surface under SPEC §10-§11. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`.
      Additional evidence 2026-06-12: project-mode direct `findMany()`/`findFirst()` calls on a
      typed Drizzle receiver are no longer swallowed by the relational-query exemption; only
      real `db.query.<table>.findMany/findFirst(...)` chains remain classified as relational
      reads, while direct typed `db.findMany()` / `db["findFirst"]()` degrade to FW406 and fake
      lookalike receivers stay inert under SPEC §10-§11. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "project unknown direct receiver|relational query API|project relational"`,
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: project-mode relational query reads now require the
      relational table member to resolve through the project table-symbol map before contributing
      a read domain. Unknown members such as `db.query.archivedUsers.findMany(...)` remain
      visible as FW406 unresolved read-source diagnostics instead of silently producing an empty
      read set; package and real `drizzle-orm` conformance tests pin the degradation under
      SPEC §10-§11. Same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "project relational query"`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "unresolved project relational"`,
      `corepack pnpm exec vitest --run packages/drizzle/src`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin`,
      `corepack pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: project namespace table resolution now derives namespace
      tables from checker-visible module export symbols and the prepared source context follows
      `export *` barrels, so namespace imports from modules that re-export Drizzle table
      declarations resolve for query reads/projection shapes and write targets without weakening
      computed-access FW406 fallbacks under SPEC §10-§11. Package and real pinned `drizzle-orm`
      coverage exercise named re-export aliases chained through export-star barrels. Same-session
      evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "re-export barrels"`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "re-export barrels"`,
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts`,
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `corepack pnpm exec vitest --run packages/drizzle/src`,
      `corepack pnpm run test:conformance`,
      `corepack pnpm exec vp check packages/drizzle/src/static.ts packages/drizzle/src/index.test.ts conformance/drizzle-pin/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: query extraction now marks direct receiver calls inside
      query loaders that are not the static select family as FW406 query facts instead of
      omitting the query, so raw `db.execute(...)`, accidental `db.update(...)`, transactions,
      `batch`, and other direct Drizzle receiver surfaces stay visible under SPEC §10.2/§11.1
      even when no projection can be inferred. Package coverage pins source raw-query execution
      and project query-loader writes; real pinned `drizzle-orm` conformance pins `sql`-backed
      raw query execution. Focused same-session evidence:
      `corepack pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "raw query receiver|query-loader writes|projection-less|relational query API reads"`,
      and
      `corepack pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts -t "raw query execute|computed real Drizzle read sources|element-access relational"`.
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
      Additional bounded evidence 2026-06-12: `packages/drizzle/src/runtime-surface.test.ts`
      now pins the root runtime source against importing `ts-morph`, the static extractor barrel,
      graph serialization, or invalidation helpers while still proving `@jiso/drizzle/static`
      exposes extraction. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/runtime-surface.test.ts` and
      `pnpm exec vp check packages/drizzle/src/runtime-surface.test.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: the build-time extractor implementation moved from
      `packages/drizzle/src/index.ts` to `packages/drizzle/src/static.ts`, and
      `@jiso/drizzle/static` now targets that module directly while `src/index.ts` remains only a
      compatibility re-export for deep-import verification. `runtime-surface.test.ts` pins the
      dedicated static source as the only Drizzle module in this seam importing `ts-morph`, and
      keeps the runtime source free of both the static implementation and compatibility barrel.
      Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/index.test.ts`,
      `pnpm exec vitest --run conformance/drizzle-pin/src/index.test.ts`,
      `pnpm exec vp check packages/drizzle/package.json packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/index.ts packages/drizzle/src/static.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional bounded evidence 2026-06-12: `IGNORED_LOCAL_CALL_NAMES` no longer filters
      domain-like helper names (`insert`, `update`, `delete`, `select`), so a user-authored
      local helper named `insert()` now folds its write summary into callers instead of silently
      disappearing. Same-session evidence:
      `pnpm exec vitest --run packages/drizzle/src/index.test.ts -t "domain-like helper names"`
      and `pnpm exec vp check packages/drizzle/src/index.ts packages/drizzle/src/index.test.ts plans/codebase-quality-round2.md`.

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
      Additional bounded evidence 2026-06-12: moved that inline response-application parity
      harness into `packages/runtime/src/inline-loader.test.ts`, colocating generated/extracted
      source parity with the inline-loader suite while preserving the `applyMutationResponseToDom`
      comparison for keyed `fw-query`, unkeyed query, replace fragment, and append fragment
      effects. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts -t "inline response application|inline delegated|enhanced form request targets"`,
      `pnpm exec vp check packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now tracks identifier tokens before deciding whether `/` starts a regex literal, narrowing
      the custom helper hazard for regexes after keywords such as `return` while preserving the
      checked-in shipped installer byte-for-byte. `packages/runtime/src/inline-loader.test.ts`
      executes readable and minified custom inline sources against `//`, `/* */`, regex literals
      after `return` and arrow bodies, template literals, and the `join('; ')` wire separator.
      The broader package-level build emission step remains open. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`,
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now treats stripped line/block comments as token separators when needed and preserves
      separators for `+ +`, `- -`, and `//` hazards, avoiding minification-created operators or
      comments while preserving the checked-in shipped installer byte-for-byte.
      `packages/runtime/src/inline-loader.test.ts` executes readable and minified custom inline
      sources through comment-adjacent `return`, unary plus, and unary minus cases. Same-session
      evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts`,
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now emits the checked-in `packages/runtime/src/inline-loader.ts` module from the readable
      inline loader source and exposes package-local `build:inline-loader`/`check:inline-loader`
      scripts, making the package-owned build seam byte-checkable before a root build task is
      wired. `packages/runtime/src/inline-loader.test.ts` pins the emitted module source
      byte-for-byte against the checked-in runtime module. The broader root build integration and
      real-tool minifier replacement remain open. Same-session evidence:
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts`, and
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts packages/runtime/package.json plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now deletes the bespoke character scanner for inline-loader minification and delegates
      tokenization/comment removal to the TypeScript scanner already used in this repo, while
      preserving the checked-in shipped installer byte-for-byte through
      `pnpm --filter @jiso/runtime run check:inline-loader`. `packages/runtime/src/inline-loader.test.ts`
      keeps string/comment/regex parity coverage and now fails closed for unsupported template
      interpolation instead of allowing a silent rewrite. Root build-task integration remains
      open. Same-session evidence:
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`,
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/package.json` now makes
      package-local `build` and `check` execute the inline-loader generation/check scripts, so the
      runtime package fails before stale generated bootstrap source ships. `packages/runtime/src/inline-loader.test.ts`
      also runs the same trigger, response-application, and enhanced-form parity matrix through
      readable build source, freshly minified build source, checked-in generated bootstrap source,
      and the extracted installer. Root build-task integration and a declared external minifier
      dependency remain open. Same-session evidence:
      `pnpm --filter @jiso/runtime run build`,
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts`, and
      `pnpm exec vp check packages/runtime/package.json packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now parses and prints the readable SPEC.md §4.4 bootstrap with TypeScript before
      token-boundary compaction, deleting the generator's template-substitution token special case
      and leaving comment removal/syntax normalization to the compiler front end. The regenerated
      `packages/runtime/src/inline-loader.ts` is checked in from that build path, and
      `packages/runtime/src/inline-loader.test.ts` keeps readable/minified/generated/extracted
      trigger, response-application, enhanced-form, string/comment/regex, template-interpolation,
      and gzip parity pinned. Same-session evidence:
      `pnpm --filter @jiso/runtime run build:inline-loader`,
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm exec vp check packages/runtime/src/apply.ts packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts packages/runtime/src/mutation-response.test.ts`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now preserves parser-identified regex literal spans during token-boundary compaction,
      re-parses minified output, and compares AST leaf fingerprints against the compiler-printed
      source so regex/string/operator semantic drift fails the build before the checked-in
      bootstrap ships. `packages/runtime/src/inline-loader.test.ts` adds regex bodies with
      significant spaces and a regex-before-`instanceof` separator case to the existing
      readable/minified/generated/extracted loader parity matrix. Same-session evidence:
      `pnpm --filter @jiso/runtime run build:inline-loader`,
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now derives token-boundary separators by rescanning adjacent TypeScript tokens and honoring
      scanner lexical errors, rather than carrying a word/operator separator table. The helper
      still preserves parser-identified regex spans and keeps narrow regex-context guards for
      regex flags and division-before-regex boundaries. `packages/runtime/src/inline-loader.test.ts`
      pins `instanceof`, numeric-keyword, division/regex, regex-before-`instanceof`, string, and
      comment-adjacent operator cases while `check:inline-loader` keeps the generated bootstrap
      byte-identical. Same-session evidence:
      `corepack pnpm --filter @jiso/runtime run check:inline-loader`,
      `corepack pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/mutation-targets.ts` now owns
      the live `FW-Targets` header separator/serialization used by
      `packages/runtime/src/mutation-submit.ts`, so the enhanced mutation request header and
      returned target list are derived from one live target snapshot under SPEC §9.1. The readable
      inline bootstrap now validates `fw-query` chunks with `JSON.parse` and skips malformed or
      unnamed query chunks before dispatching `jiso:query`, matching the modular runtime's
      valid-named-query-only response application while still applying fragments under SPEC §4.4.
      The generated `packages/runtime/src/inline-loader.ts` was rebuilt from that source.
      Same-session evidence:
      `pnpm --filter @jiso/runtime run build:inline-loader`,
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/mutation-targets.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/mutation-targets.ts packages/runtime/src/mutation-targets.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts`
      now compares compiler-printed and minified JavaScript token fingerprints before the AST
      parity check, and fails closed when parser regex literal spans are not consumed cleanly by
      the scanner-backed minifier boundary. `packages/runtime/src/inline-loader.test.ts` extends
      the minifier parity harness with adjacent regex-plus-regex and regex-division-regex cases
      while `check:inline-loader` keeps the shipped bootstrap byte-identical. Same-session
      evidence:
      `corepack pnpm --filter @jiso/runtime run check:inline-loader`,
      `corepack pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now owns
      the root-vs-store runtime mutation response application helper used by
      `installMutationBroadcast`, so same-user tab sync no longer keeps a local DOM/store apply
      branch in `packages/runtime/src/index.ts`. `packages/runtime/src/mutation-response.test.ts`
      pins both store-only and DOM-backed helper paths. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "BroadcastChannel|rebroadcast|syncs mutation responses"`,
      `pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/index.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now owns
      canonical public `applyMutationResponse` directly instead of relying on a category-barrel
      alias, while preserving `applyMutationResponseToStore` as the same function. The shared
      keyed query store write moved to `packages/runtime/src/query-store.ts`, so store-only
      mutation/deferred apply and initial `script[fw-query]` hydration use one helper before
      reporting canonical typed-read keys under SPEC.md §9.4. `packages/runtime/src/query-store.test.ts`
      and `packages/runtime/src/mutation-response.test.ts` pin keyed hydration/apply slot parity
      plus barrel-to-owner function identity. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-store.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/apply.ts packages/runtime/src/query-store.ts packages/runtime/src/query-store.test.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now carries
      `applyQuery`, `beforeApplyQueries`, and `onError` through the store-only
      `applyMutationResponseToRuntime` branch, matching the DOM branch's shared
      query/fragment reader instead of silently dropping hook options when `root` is absent.
      `packages/runtime/src/mutation-response.test.ts` pins interposed keyed query values,
      `beforeApplyQueries`, and malformed query/fragment error reporting on that store-only
      path. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/*.test.ts`,
      `pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now owns
      the public store-only `applyMutationResponse` and `applyDeferredChunk` aliases directly,
      leaving `packages/runtime/src/index.ts` as a pure re-export for that apply surface instead
      of a wrapper owner. `packages/runtime/src/mutation-response.test.ts` pins index exports to
      the direct apply-path functions and the store helper. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts -t "mutation response|deferred chunk|apply"`,
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/index.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/apply-path.ts` now owns
      `applyDeferredStreamResponseToDom`, so deferred stream aggregation composes the shared
      deferred chunk DOM apply path instead of living in `packages/runtime/src/index.ts`.
      `packages/runtime/src/index.ts` preserves only the public re-export for this apply API, and
      `packages/runtime/src/mutation-response.test.ts` pins the barrel export to the apply-path
      implementation while covering multi-chunk query/fragment application under SPEC.md §9.1.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts -t "deferred|apply"`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/apply-path.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/mutation-submit.ts` now
      applies direct enhanced mutation responses, successful optimistic responses, and failed
      optimistic error-fragment responses through one fetched-response DOM apply helper. That
      helper centralizes metadata return shaping and successful-response broadcast publication,
      while preserving optimistic query interposition and the no-broadcast policy for failed
      mutation bodies. `packages/runtime/src/index.test.ts` pins the failed optimistic error
      fragment path with a broadcast installed. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "enhanced mutation|optimistic"`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vp check packages/runtime/src/mutation-submit.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/loader.ts` now owns
      `installJisoLoader`, loader options, default delegated events, query visible-return wiring,
      enhanced mutation broadcast setup, execution triggers, and disposal while
      `packages/runtime/src/index.ts` preserves only the public loader re-export. `loader.test.ts`
      pins the barrel export to the extracted owner and verifies delegated event dispatch plus
      listener disposal under SPEC.md section 4.4. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/loader.test.ts packages/runtime/src/index.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/loader.ts packages/runtime/src/loader.test.ts plans/codebase-quality-round2.md`,
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
- [x] **MED — One error policy per layer.** `dispatchEnhancedFormSubmit` swallows when `onError`
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
      Additional bounded evidence 2026-06-12: `packages/runtime/src/error-policy.ts`
      now owns the shared malformed-runtime-data reporter seam used by `wire-parser.ts`,
      `query-store.ts`, and `mutation-response.ts`; `error-policy.test.ts` pins optional
      reporter delivery and malformed JSON error construction while affected parser/store/header
      tests keep valid chunks applying after malformed wire data. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/error-policy.test.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vp check packages/runtime/src/error-policy.ts packages/runtime/src/error-policy.test.ts packages/runtime/src/wire-parser.ts packages/runtime/src/query-store.ts packages/runtime/src/mutation-response.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/error-policy.ts`
      now owns the contextual loader/event reporter seam as well as the lower wire/store
      reporter seam; `installJisoLoader` and `createEventBus` route delegated-event,
      execution-trigger, event-listener, and query-hydration diagnostics through that single
      contextual helper without changing the documented form-layer handling policy.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/error-policy.test.ts packages/runtime/src/events.test.ts packages/runtime/src/index.test.ts -t "error hook|loader failures|execution trigger|query-hydration"`,
      `pnpm exec vp check packages/runtime/src/error-policy.ts packages/runtime/src/error-policy.test.ts packages/runtime/src/events.ts packages/runtime/src/index.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Final evidence 2026-06-12: `packages/runtime/src/error-policy.ts` now owns the
      target-aware form-layer reporter alongside the lower runtime and contextual loader/event
      reporters; `packages/runtime/src/mutation-submit.ts` routes enhanced form, direct submit,
      and optimistic uncovered/failure reporting through that policy, while
      `packages/runtime/src/query-refetch.ts` reports visible-return callback and typed-read
      transport/body/apply failures through the lower runtime seam and continues later query
      refetches. The remaining direct `submitOptions.onError` call is typed form validation
      failure delivery, not a runtime error reporter. Same-session evidence:
      `rg -n "onError\\?\\.\\(|options\\.onError\\?\\.\\(|submitOptions\\.onError\\(|reportRuntime" packages/runtime/src/*.ts`,
      `corepack pnpm exec vitest --run packages/runtime/src/error-policy.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/index.test.ts -t "runtime error policy|visible-return|typed read|optimistic enhanced mutation fetch failures|direct enhanced mutation fetch failures|loader failures|query-hydration"`,
      `corepack pnpm exec vitest --run packages/runtime/src`, and
      `corepack pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/error-policy.ts packages/runtime/src/error-policy.test.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/query-refetch.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [x] **MED — Split `index.ts` subtractively** along its existing seams: `inline-loader.ts`,
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
      Additional bounded evidence 2026-06-12: `packages/runtime/src/query-refetch.ts` now owns
      the visible-return query hydration/refetch installer, including new `script[fw-query]`
      discovery, opt-out filtering, typed-read application, and in-flight refetch dedupe;
      `packages/runtime/src/index.ts` delegates that loader slice while retaining public loader
      orchestration. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts -t "hydrate|visible-return|refetch"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/query-refetch.ts packages/runtime/src/query-refetch.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted `packages/runtime/src/pending.ts` as
      the subtractive seam for `fw-deps` parsing and SPEC §10.4 pending-island stamping;
      `packages/runtime/src/index.ts` imports and re-exports that surface while keeping enhanced
      mutation orchestration. `packages/runtime/src/pending.test.ts` pins the runtime-barrel
      export, comma/whitespace dependency parsing, and stamp/unstamp behavior. Same-session
      evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/pending.test.ts packages/runtime/src/index.test.ts -t "pending|optimistic|enhanced mutations"`
      and
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/pending.ts packages/runtime/src/pending.test.ts plans/codebase-quality-round2.md`.
      Additional bounded evidence 2026-06-12: extracted
      `packages/runtime/src/mutation-targets.ts` as the subtractive seam for SPEC.md §9.1
      live-DOM `FW-Targets` collection; `packages/runtime/src/index.ts` now imports the helper
      and preserves the public `TargetCollectorRoot` type re-export. `packages/runtime/src/mutation-targets.test.ts`
      pins first-seen ordering, dedupe, nullish id fallback, empty-target suppression, and
      dependency formatting. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/mutation-targets.test.ts packages/runtime/src/index.test.ts -t "mutation targets|FW-Targets|enhanced mutations"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/mutation-targets.ts packages/runtime/src/mutation-targets.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted
      `packages/runtime/src/broadcast.ts` as the subtractive same-user mutation broadcast seam;
      `packages/runtime/src/index.ts` now imports and re-exports that surface while default
      broadcast installation stays in loader orchestration. `packages/runtime/src/broadcast.test.ts`
      pins sanitized change publication, mutation-wire replay through the shared apply path,
      invalid-message rejection, and channel close behavior. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts -t "BroadcastChannel|rebroadcast|syncs mutation responses|mutation broadcast"`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/broadcast.ts packages/runtime/src/broadcast.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/mutation-response.ts`
      now owns fallback FW-Idem generation alongside mutation response metadata parsing, removing
      that module-level idempotency state from `packages/runtime/src/index.ts` while preserving
      enhanced mutation orchestration behavior. `packages/runtime/src/mutation-response.test.ts`
      pins crypto-backed and fallback idempotency keys. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts`,
      `corepack pnpm exec vitest --run packages/runtime/src/index.test.ts -t "FW-Idem|optimistic|enhanced mutations"`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/mutation-response.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted
      `packages/runtime/src/loader-lifecycle.ts` as the subtractive loader listener and
      load/idle/visible execution-trigger seam; `packages/runtime/src/index.ts` now imports that
      implementation and preserves the public loader lifecycle type exports, while
      `packages/runtime/src/loader-lifecycle.test.ts` owns the focused trigger/disposer coverage
      moved out of `packages/runtime/src/index.test.ts`. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/loader-lifecycle.test.ts packages/runtime/src/index.test.ts -t "loader lifecycle|delegated loader failures|disposes loader listeners|execution trigger"`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/index.test.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/loader-lifecycle.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted
      `packages/runtime/src/mutation-failure.ts` as the subtractive enhanced-mutation failure
      parser seam, so `packages/runtime/src/index.ts` delegates `createSubmitContext` failure
      parsing instead of owning the shared wire-parser-backed `<fw-error>`/`<output>` reader.
      `packages/runtime/src/mutation-failure.test.ts` pins JSON, declared output, validation
      output, unknown fallback, and quoted `>` attribute behavior while
      `packages/runtime/src/submit-context.test.ts` keeps the public context integration covered.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-failure.test.ts packages/runtime/src/submit-context.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/mutation-failure.ts packages/runtime/src/mutation-failure.test.ts packages/runtime/src/submit-context.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted
      `packages/runtime/src/mutation-submit.ts` as the subtractive enhanced-mutation submit,
      optimistic submit, upload-progress, and typed submit-context seam. `packages/runtime/src/index.ts`
      now imports that submit layer for loader orchestration and re-exports the public submit
      surface instead of owning the implementation body. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/submit-context.test.ts packages/runtime/src/index.test.ts -t "submit context|enhanced mutations|optimistic enhanced|mutation queue|upload progress"`,
      `corepack pnpm exec vitest --run packages/runtime/src/submit-context.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/mutation-submit.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/broadcast.ts` now owns
      the default same-user `BroadcastChannel` setup used by `installJisoLoader`, leaving
      `packages/runtime/src/index.ts` to delegate that enhanced-mutation broadcast branch through
      the broadcast seam instead of carrying its own installer. `packages/runtime/src/broadcast.test.ts`
      pins default channel creation, publication, and disposal. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts -t "BroadcastChannel|rebroadcast|syncs mutation responses|mutation broadcast|enhanced mutations"`,
      `corepack pnpm exec vitest --run packages/runtime/src/broadcast.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/broadcast.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/index.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted `packages/runtime/src/derive.ts`
      as the owner for the public compiled-query derive helper and left
      `packages/runtime/src/index.ts` as a re-export-only runtime barrel. The same slice added
      shared `AttributeElementLike`/`AttributeMutatorLike` DOM-like shapes in
      `packages/runtime/src/dom-like.ts` and routed `events.ts`, `pending.ts`, and
      `query-bindings.ts` through them while preserving the existing public type names.
      `packages/runtime/src/derive.test.ts` pins the barrel export to the extracted owner and
      the source-level helper metadata shape. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/derive.test.ts packages/runtime/src/dom-like.test.ts packages/runtime/src/query-bindings.test.ts packages/runtime/src/pending.test.ts packages/runtime/src/events.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vp check packages/runtime/src/derive.ts packages/runtime/src/derive.test.ts packages/runtime/src/dom-like.ts packages/runtime/src/events.ts packages/runtime/src/pending.ts packages/runtime/src/query-bindings.ts packages/runtime/src/index.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: split the public runtime barrel into category
      barrels (`apply.ts`, `inline.ts`, `loader-api.ts`, `morphing.ts`, `mutation.ts`, and
      `query.ts`), reducing `packages/runtime/src/index.ts` to the package facade while preserving
      public exports. The apply/deferred compatibility aliases now live in `apply.ts`, and
      `packages/runtime/src/apply-path.ts` owns only the canonical implementation functions.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts -t "mutation response|deferred chunk|apply|runtime loader"`,
      `corepack pnpm exec vitest --run packages/runtime/src`,
      `corepack pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/apply.ts packages/runtime/src/inline.ts packages/runtime/src/loader-api.ts packages/runtime/src/morphing.ts packages/runtime/src/mutation.ts packages/runtime/src/query.ts packages/runtime/src/apply-path.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Final evidence 2026-06-12: `packages/runtime/src/index.ts` is a pure package facade over
      category barrels, and `packages/runtime/src/apply.ts` no longer exports the deferred chunk
      compatibility aliases (`applyDeferredChunk`/`applyDeferredChunkToDom`); deferred response
      tests now use canonical `applyMutationResponse`/`applyMutationResponseToDom` plus the
      dedicated `applyDeferredStreamResponseToDom` stream helper. Same-session evidence:
      `rg -n "applyDeferredChunk|applyDeferredChunkToDom" packages/runtime/src` returned no
      matches,
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "deferred|apply|mutation response|runtime loader"`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm exec vp check packages/runtime/src/apply.ts packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional bounded evidence 2026-06-12: `installJisoLoader` now re-scans only newly
      discovered `script[fw-query]` nodes before visible-return refetch, so query scripts inserted
      after loader installation hydrate into the query store and enter the refetch ledger without
      reprocessing previously seen scripts. `packages/runtime/src/query-store.test.ts` pins that a
      post-install `reviews` script is hydrated, included in the refetch list, and updated by the
      typed read response. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts -t "hydrate|visible-return|refetch"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/query-store.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `installQueryVisibleReturnRefetch` now carries the
      visible-return re-scan and refetch listener that had lived in `installJisoLoader`, so the
      hydrated-query ledger, newly inserted script discovery, typed-read application, and
      overlapping visible-return dedupe are covered in `packages/runtime/src/query-refetch.test.ts`
      without relying only on `index.test.ts`. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts packages/runtime/src/index.test.ts -t "hydrate|visible-return|refetch"`,
      `pnpm exec vp check packages/runtime/src/index.ts packages/runtime/src/query-refetch.ts packages/runtime/src/query-refetch.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: typed-read visible-return refetch now forwards
      malformed `fw-query` chunks into the shared apply-path `onError` reporter instead of
      silently dropping parse failures while applying later valid chunks. `packages/runtime/src/query-refetch.test.ts`
      pins both direct `refetchQueries` and `installQueryVisibleReturnRefetch` behavior through
      the extracted query-refetch seam. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts`,
      `pnpm exec vp check packages/runtime/src/query-refetch.ts packages/runtime/src/query-refetch.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: disposed visible-return query refetch installers
      now make stale `visibilitychange` listeners and mid-flight typed-read work inert, so
      roots that cannot actually unregister listeners do not keep observing hydrated query data
      after teardown. `packages/runtime/src/query-refetch.test.ts` pins stale-listener and
      mid-flight disposal behavior through the extracted query-refetch seam. Same-session
      evidence:
      `pnpm exec vitest --run packages/runtime/src/query-refetch.test.ts packages/runtime/src/query-store.test.ts`,
      `pnpm exec vitest --run packages/runtime/src/index.test.ts -t "hydrate|visible-return|refetch"`,
      `pnpm exec vp check packages/runtime/src/query-refetch.ts packages/runtime/src/query-refetch.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: extracted `packages/runtime/src/dom-like.ts` as
      the internal shared DOM-like type/helper seam for attribute readers/writers,
      selector-capable roots, listener targets, visibility roots, target elements, and
      text-content elements. `packages/runtime/src/events.ts`, `handlers.ts`,
      `query-bindings.ts`, `query-store.ts`, `pending.ts`, `mutation-targets.ts`,
      `loader-lifecycle.ts`, and `query-refetch.ts` now preserve their public exported type names
      while delegating repeated DOM-shape definitions to the shared seam; handlers and query
      bindings share `domAttributes()` for iterable and array-like attribute collections.
      `packages/runtime/src/dom-like.test.ts` pins that normalizer directly. Same-session
      evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/dom-like.test.ts packages/runtime/src/query-bindings.test.ts packages/runtime/src/loader-lifecycle.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/pending.test.ts packages/runtime/src/mutation-targets.test.ts packages/runtime/src/index.test.ts -t "DOM-like|data-bind|compiled query update plans|loader lifecycle|execution trigger|hydrate|visible-return|refetch|pending|mutation targets|FW-Targets"`,
      `corepack pnpm exec vitest --run packages/runtime/src`,
      `corepack pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      and
      `corepack pnpm exec vp check packages/runtime/src/dom-like.ts packages/runtime/src/dom-like.test.ts packages/runtime/src/events.ts packages/runtime/src/handlers.ts packages/runtime/src/query-bindings.ts packages/runtime/src/query-store.ts packages/runtime/src/pending.ts packages/runtime/src/mutation-targets.ts packages/runtime/src/loader-lifecycle.ts packages/runtime/src/query-refetch.ts packages/runtime/src/index.ts`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/query-bindings.ts`
      now exposes a per-apply `QueryBindingIndex` for `data-bind:*` candidate elements, and
      `packages/runtime/src/apply-path.ts` creates that index lazily once per DOM mutation/deferred
      response body so multiple query chunks share one attribute-binding scan before fragment
      morphing. `packages/runtime/src/query-bindings.test.ts` pins explicit index reuse across
      compiled plans, and `packages/runtime/src/mutation-response.test.ts` pins shared apply-path
      reuse for a two-query mutation body under SPEC.md §9.1/§4.8. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-bindings.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm exec vp check packages/runtime/src/apply-path.ts packages/runtime/src/query-bindings.ts packages/runtime/src/query-bindings.test.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/query-store.ts` now
      canonicalizes hydrated query instance keys through `queryWireKey`, so keyed
      `script[fw-query]` data enters the visible-return ledger as the same typed-read key used by
      `/_q/<query-key>` while still writing to the keyed `QueryStore` slot. `packages/runtime/src/apply-path.ts`
      now reports keyed `<fw-query>` mutation/deferred chunks through the same canonical key, so
      mutation-introduced query instances do not collapse to the bare query name before later
      refetch. `packages/runtime/src/query-store.test.ts`, `query-refetch.test.ts`, and
      `mutation-response.test.ts` pin keyed hydration, keyed visible-return typed-read URLs,
      keyed store updates, and keyed response summaries under SPEC.md §9.4. Same-session
      evidence:
      `pnpm exec vitest --run packages/runtime/src/query-store.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/mutation-response.test.ts`,
      `pnpm exec vitest --run packages/runtime/src`,
      `pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
      `pnpm exec vp check packages/runtime/src/query-store.ts packages/runtime/src/apply-path.ts packages/runtime/src/query-store.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/index.test.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/query-store.ts` now owns
      batched query chunk application through `applyQueryChunksToStore`, including canonical
      query-key reporting, interposed apply values, and after-apply hooks. `packages/runtime/src/apply-path.ts`
      routes store-only and DOM mutation response query application through that helper, while
      hydrated `script[fw-query]` writes also reuse it instead of duplicating the canonical
      apply/key collection behavior. `packages/runtime/src/query-store.test.ts` pins keyed
      batched apply with interposed values and after-apply hook values under SPEC.md §9.1/§9.4.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/query-store.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-refetch.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vp check packages/runtime/src/query-store.ts packages/runtime/src/query-store.test.ts packages/runtime/src/apply-path.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: `packages/runtime/src/wire-parser.ts` now parses
      `<fw-query>` chunks through the same quote-aware tag scanner boundary used by fragments,
      instead of a `[^>]*` opening-tag regex, so quoted `>` characters in query attributes do not
      drift from the inline loader's DOMParser behavior or collapse keyed runtime store updates.
      `packages/runtime/src/wire-parser.test.ts` pins quoted-tag-closer attributes and malformed
      query markup reporting, while `packages/runtime/src/mutation-response.test.ts` pins the
      store apply path for a keyed query whose key contains `>`. Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-refetch.test.ts`,
      `pnpm --filter @jiso/runtime run check:inline-loader`,
      `pnpm exec vp check packages/runtime/src/wire-parser.ts packages/runtime/src/wire-parser.test.ts packages/runtime/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional bounded evidence 2026-06-12: default same-user mutation broadcast replay now
      reports applied `<fw-query>` chunks back into the installed loader's visible-return ledger,
      so queries introduced by another tab after install become typed-read refetch eligible
      through the same shared apply path as direct enhanced submits. `packages/runtime/src/broadcast.test.ts`
      pins the broadcast `onAppliedQueries` seam, and `packages/runtime/src/index.test.ts`
      verifies a default `BroadcastChannel` replay-added query is included in later
      visible-return refetch. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts -t "broadcast|visible-return refetch|introduced by default broadcast"`,
      `corepack pnpm exec vp check packages/runtime/src/broadcast.ts packages/runtime/src/loader.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/index.test.ts`,
      and `git diff --check`.

Verification: runtime node + browser suites; gzip budget; the new parity suite is the gate for
any future inline-loader edit. Partial evidence 2026-06-12: `packages/runtime/src/index.ts` now
uses an internal `definedProps()` helper for optional runtime wiring across default broadcast
installation, enhanced submit, submit context, deferred chunks, broadcast replay, and the shared
mutation DOM-apply bridge. The remaining optional-spread sites are lower-risk serialization/test
objects or await later module splits. Same-session evidence:
`pnpm exec vitest --run packages/runtime/src/index.test.ts -t "enhanced|deferred|broadcast|submit context"` and
`pnpm exec vp check packages/runtime/src/index.ts plans/codebase-quality-round2.md`.
Additional bounded evidence 2026-06-12: `packages/runtime/src/defined-props.ts` now owns the
undefined-only optional runtime prop helper used by loader installation, enhanced mutation
submit/apply, deferred apply, mutation broadcast replay, mutation change sanitization, and
visible-return refetch wiring; `packages/runtime/src/defined-props.test.ts` pins that falsy
provided values are preserved while `undefined` is dropped. Same-session evidence:
`pnpm exec vitest --run packages/runtime/src/defined-props.test.ts packages/runtime/src/broadcast.test.ts packages/runtime/src/mutation-response.test.ts packages/runtime/src/query-refetch.test.ts packages/runtime/src/submit-context.test.ts packages/runtime/src/loader.test.ts packages/runtime/src/loader-lifecycle.test.ts`,
`pnpm exec vitest --run packages/runtime/src`,
`pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
`pnpm --filter @jiso/runtime run check:inline-loader`,
`pnpm exec vp check packages/runtime/src/defined-props.ts packages/runtime/src/defined-props.test.ts packages/runtime/src/loader.ts packages/runtime/src/mutation-submit.ts packages/runtime/src/apply-path.ts packages/runtime/src/broadcast.ts packages/runtime/src/mutation-response.ts packages/runtime/src/query-refetch.ts`,
and `git diff --check`.
Additional bounded evidence 2026-06-12: `packages/runtime/src/inline-loader-build.ts` now
generates a direct `inlineJisoLoaderInstaller` function in the checked-in runtime module, so
`installInlineJisoLoader` no longer reconstructs the installer through a runtime `eval` fallback;
`packages/runtime/src/inline-loader.ts` remains generated from the readable SPEC §4.4 bootstrap
source, and `packages/runtime/src/inline-loader.test.ts` pins the no-`eval` generated shape plus
root `check:inline-loader`/`check:build` script wiring. Same-session evidence:
`pnpm --filter @jiso/runtime run build:inline-loader`,
`pnpm --filter @jiso/runtime run check:inline-loader`,
`pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts`,
`pnpm exec vitest --run packages/runtime/src`,
`pnpm exec vitest --config vitest.browser.config.ts --run packages/runtime/src/index.browser.test.ts`,
`pnpm run check:inline-loader`,
`pnpm run check:build`,
`pnpm exec vp check package.json packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts packages/runtime/src/inline-loader.test.ts plans/codebase-quality-round2.md`,
and `git diff --check`.

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
      Additional evidence 2026-06-12: the static-export synthetic-request replay choreography
      now lives in `packages/server/src/static-replay.ts` instead of being embedded in
      `exportStaticApp()`. The extracted module owns normalized GET route replay, the
      successful-HTML FW229 teaching boundary, `/c/` module href harvesting, and query-version
      conflict detection; `packages/server/src/static-export.ts` remains the stable coordinator
      and public API re-export. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts`.
      Additional evidence 2026-06-12: the extracted static replay seam now also owns the
      SPEC §9.5 referenced `/c/` module replay boundary, rejecting successful non-JavaScript
      responses with FW229 before `exportStaticApp()` plans output writes. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/static-replay.test.ts packages/server/src/static-export.test.ts`.
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
      Additional evidence 2026-06-12: the app-shell mutation response adapter and webhook wire
      response adapter now use the shared `serverResponseToWebResponse` helper in
      `packages/server/src/response.ts` instead of local/cast-based Web `Response` conversion.
      `packages/server/src/response.test.ts` covers repeated `Set-Cookie` preservation and HEAD
      body suppression through the shared adapter. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/response.test.ts packages/server/src/app.test.ts packages/server/src/webhook.test.ts`,
      `corepack pnpm exec vp check packages/server/src/app.ts packages/server/src/response.ts packages/server/src/response.test.ts packages/server/src/webhook.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
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
      Additional evidence 2026-06-12: route response outcome contracts, the public `respond`
      file/stream helper, route outcome-to-page response assembly, HTML server-error response
      construction, and the shared `Retry-After` header helper moved from
      `packages/server/src/index.ts` into `packages/server/src/response.ts`; `query.ts` now
      reuses that response helper instead of carrying a duplicate. `index.ts` preserves the
      public exports. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/route-response.test.ts packages/server/src/response.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/query.ts packages/server/src/response.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: route declaration types, route request parsing,
      not-found outcomes, guarded page execution, route page response rendering, and the route
      current-URL helper moved from `packages/server/src/index.ts` into
      `packages/server/src/route.ts`; `app.ts` imports the extracted route seam directly while
      `index.ts` preserves the public re-exports. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/route.test.ts packages/server/src/route-response.test.ts packages/server/src/app.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/app.ts packages/server/src/index.ts packages/server/src/route.ts packages/server/src/route.test.ts packages/server/src/route-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: endpoint declaration/matching/run helpers moved from
      `packages/server/src/index.ts` into `packages/server/src/endpoint.ts`; the duplicated raw
      endpoint session-stripping proxy in `packages/server/src/webhook.ts` now reuses that module,
      and `app.ts` imports the endpoint seam directly while `index.ts` preserves public re-exports.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/endpoint.test.ts packages/server/src/app.test.ts packages/server/src/webhook.test.ts packages/server/src/index.test.ts`
      and
      `corepack pnpm exec vp check packages/server/src/index.ts packages/server/src/endpoint.ts packages/server/src/app.ts packages/server/src/webhook.ts packages/server/src/endpoint.test.ts`.
      Additional evidence 2026-06-12: route meta helpers, query-derived meta declarations, and
      server-rendered i18n catalog interpolation moved from `packages/server/src/index.ts` into
      `packages/server/src/meta.ts`; `index.ts` now preserves only the public meta/i18n re-exports
      while `packages/server/src/meta.test.ts` imports the extracted seam directly. Same-session
      evidence:
      `corepack pnpm exec vitest --run packages/server/src/meta.test.ts packages/server/src/route.test.ts packages/server/src/index.test.ts`,
      `corepack pnpm exec vp check packages/server/src/index.ts packages/server/src/meta.ts packages/server/src/meta.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: the route-page/route-render exception coverage for SPEC
      §9.2 private 500 responses and `onError` diagnostics moved from
      `packages/server/src/index.test.ts` into `packages/server/src/route.test.ts`, keeping the
      extracted route seam tested beside its implementation while reducing the barrel test's
      responsibilities. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/route.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/route.test.ts packages/server/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: mutation declarations, execution, response rendering,
      replayed enhanced responses per `SPEC.md` §8.1 / §9.1, change-record headers, fragment
      rerendering, and legacy `renderQueryScript` delegation moved from
      `packages/server/src/index.ts` into `packages/server/src/mutation.ts`; `index.ts` is now a
      re-exporting barrel for the mutation API, while `app.ts` dispatches app-shell mutations
      through the extracted seam instead of importing the package barrel. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/index.test.ts packages/server/src/app.test.ts packages/server/src/replay.test.ts packages/server/src/mutation-wire.test.ts packages/server/src/csrf.test.ts packages/server/src/guards.test.ts packages/server/src/change-record.test.ts packages/server/src/wire-fixtures.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/mutation.ts packages/server/src/app.ts packages/server/src/mutation-wire.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: change-record typing, manual invalidation records, inferred
      mutation touch expansion, the `arg:path` touch-key source convention, and domain-scoped query
      instance key matching moved from `packages/server/src/mutation.ts` into
      `packages/server/src/change-record.ts`; `mutation.ts` preserves the public
      `invalidate`/change-record type re-exports while delegating registry change construction and
      keyed query rerun matching to the extracted seam. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/change-record.test.ts packages/server/src/index.test.ts`,
      `pnpm exec vp check packages/server/src/change-record.ts packages/server/src/change-record.test.ts packages/server/src/mutation.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/server/src/webhook.ts` no longer imports server
      types through the package barrel; it imports change records, domains, response headers, and
      schema types directly from their owning server modules, leaving `index.ts` as the external
      public export surface rather than an internal dependency edge. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/webhook.test.ts`,
      `corepack pnpm exec vp check packages/server/src/webhook.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: document assembly moved from the additive
      `packages/server/src/document.ts` surface into `packages/server/src/document-core.ts`, and
      diagnostic document rendering/source-frame logic moved into
      `packages/server/src/document-diagnostics.ts`; `document.ts` now preserves the compatible
      public facade for `app.ts`, `vite.ts`, and `index.ts` while the focused tests exercise the
      extracted seams directly. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/document.test.ts packages/server/src/shell.test.ts packages/server/src/response.test.ts`,
      `pnpm exec vitest --run packages/server/src/*.test.ts`,
      `pnpm exec vp check packages/server/src/document.ts packages/server/src/document-core.ts packages/server/src/document-diagnostics.ts packages/server/src/document.test.ts packages/server/src/shell.test.ts packages/server/src/response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: the package public surface export list moved out of the
      central `packages/server/src/index.ts` file into grouped public API barrels under
      `packages/server/src/api/`; `index.ts` is now a four-line barrel that re-exports the app,
      data/mutation, rendering/wire, and routing/HTTP groups while preserving the same explicit
      external `@jiso/server` exports. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/*.test.ts`,
      `pnpm exec vp check packages/server/src/index.ts packages/server/src/api/app.ts packages/server/src/api/data.ts packages/server/src/api/rendering.ts packages/server/src/api/routing.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: app-shell Vite manifest parsing, route-entry validation,
      hint extraction, stylesheet href extraction, and manifest dist-asset planning moved from
      `packages/server/src/vite.ts` into `packages/server/src/vite-manifest.ts`; `vite.ts`
      now keeps the public helper/type re-exports while its remaining responsibilities are
      dev middleware plus build/export coordination. `packages/server/src/vite-manifest.test.ts`
      covers the extracted manifest seam directly, and `packages/server/src/vite.test.ts`
      still proves the re-exported API path through integration flows. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/vite-manifest.test.ts packages/server/src/vite.test.ts`,
      `corepack pnpm exec vp check packages/server/src/vite.ts packages/server/src/vite-manifest.ts packages/server/src/vite-manifest.test.ts plans/app-shell.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: app-shell Vite production build/output/export helpers
      moved from `packages/server/src/vite.ts` into `packages/server/src/vite-build.ts`;
      `vite.ts` now preserves the public helper/type re-exports and owns only dev middleware,
      SSR dev request ownership, diagnostics, and the bounded plugin `writeBundle` handoff into
      the extracted build seam. `packages/server/src/vite-build.test.ts` covers the seam
      directly for route-entry hints, compiled `/c/` file output, manifest-derived static export
      asset inputs, exported HTML, and copied Vite dist bytes while `packages/server/src/vite.test.ts`
      continues to cover the public `./vite.js` API path. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/vite-build.test.ts packages/server/src/vite.test.ts packages/server/src/vite-manifest.test.ts`.
- [ ] **LOW — Close the server cleanup inventory with an acceptance sweep.** Historical audit
      targets were dead code (`matchShellDispatch` post-loop return shell.ts:161-166; rate-limit
      tail `return options.max > 0` index.ts:576); `matchRoute` recompiling all routes per call
      (match.ts:75-81 — cache `compileRoute`); `Transfer-Encoding: chunked` on a buffered string
      body (deferred-stream.ts:54); double `<title>` in `renderErrorDocument` (document.ts:175);
      `isHeaderSource` false-positives on any non-empty object (index.ts:2322-2328); early-hints
      spread clobbering `Link` (document.ts:153-156); untested cookie-rejection branches
      (index.ts:2405-2461), `t()` throw (:1681), `metaFromQuery` error branches, session Proxy
      traps (:2076-2095). The implementation and focused coverage gaps now have evidence below;
      keep this item open until the full server vitest and wire-fixture acceptance sweep is rerun
      in the integration worktree.
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
      Additional evidence 2026-06-12: `packages/server/src/meta.test.ts` now covers the missing
      `t()` message error branch, and `packages/server/src/route-query-guards.test.ts` covers the
      session-provider request proxy traps through public route rendering: `session in request`,
      property descriptor, object keys/spread, and bound request methods. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/meta.test.ts packages/server/src/route-query-guards.test.ts`.
      Additional evidence 2026-06-12: route matcher normalization, specificity, raw param,
      cache-invalidation, and FW228 ambiguity coverage moved from app-shell tests into
      `packages/server/src/match.test.ts`, keeping the cached `match.ts` cleanup pinned beside
      its implementation. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/match.test.ts packages/server/src/shell.test.ts`,
      `corepack pnpm exec vp check packages/server/src/match.test.ts packages/server/src/shell.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.

Verification: server vitest + wire fixtures byte-for-byte acceptance.

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
      Additional evidence 2026-06-12: SQL verifier integration coverage for insert-select
      mutation reads, update-from source reads, raw SQL subquery reads, and raw SQL row-key
      predicates moved from `packages/test/src/index.test.ts` into
      `packages/test/src/verifier-sql.test.ts`, keeping `index.test.ts` focused on harness-level
      integration. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier-sql.test.ts packages/test/src/index.test.ts`,
      `corepack pnpm exec vp check packages/test/src/index.test.ts packages/test/src/verifier-sql.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: SQL statement observation moved from
      `packages/test/src/verifier-observation.ts` into
      `packages/test/src/sql-observer.ts`, leaving verifier observation focused on proxy and
      table-call recording while preserving the public `@jiso/test` barrel. The focused SQL
      verifier test now covers unparseable adapter-specific SQL pass-through with no fabricated
      observations, matching SPEC §11.2 instrumentation behavior. Same-session evidence:
      `pnpm exec vitest --run packages/test/src/verifier-sql.test.ts`,
      `pnpm exec vp check packages/test/src/sql-observer.ts packages/test/src/verifier-observation.ts packages/test/src/verifier-sql.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: SQL verifier CTE alias handling now adds non-recursive
      CTE aliases in declaration order, so a later CTE alias cannot hide an earlier binding's
      real table read. `packages/test/src/verifier-sql.test.ts` covers the public verifier path
      for the false-negative case and verifies row-key/read-domain evidence is recorded. Same-session
      evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier-sql.test.ts packages/test/src/query-verifier.test.ts packages/test/src/mutation-verifier.test.ts`,
      `corepack pnpm exec vp check packages/test/src/verifier-sql.ts packages/test/src/verifier-sql.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: the remaining public-harness verifier integration tests
      moved from `packages/test/src/index.test.ts` into
      `packages/test/src/harness-verifier.test.ts`, covering SPEC §11.4 mutation exec
      verification, structured diagnostic exposure, raw SQL write verification, and interleaved
      async capture scoping without keeping a package-barrel test monolith. Same-session
      evidence: `corepack pnpm exec vitest --run packages/test/src/harness-verifier.test.ts`,
      `corepack pnpm exec vitest --run packages/test/src`,
      `corepack pnpm exec vp check packages/test/src/harness-verifier.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: SQL observer-focused coverage moved from
      `packages/test/src/verifier-sql.test.ts` into `packages/test/src/sql-observer.test.ts`,
      keeping SPEC §11.2 unparseable SQL pass-through/no-fabricated-observation coverage,
      insert-select observation coverage, and CTE alias soundness at the observer seam while
      leaving `verifier-sql.test.ts` focused on verifier integration. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/sql-observer.test.ts packages/test/src/verifier-sql.test.ts`.
      Additional evidence 2026-06-12: `packages/test/src/test-fixtures.ts` now owns shared
      diagnostic expectation helpers backed by `diagnosticDefinitions`, and the split verifier
      suites use them for thrown FW402/FW404/FW407/FW408/FW410/FW411 assertions, structured
      FW403/FW405 warning records, and FW406 graph diagnostic fixture messages. Same-session
      evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier.test.ts packages/test/src/query-verifier.test.ts packages/test/src/verifier-sql.test.ts packages/test/src/mutation-verifier.test.ts packages/test/src/harness-verifier.test.ts packages/test/src/verifier-diagnostics.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sql-observer.test.ts`,
      `corepack pnpm exec vp check packages/test/src/test-fixtures.ts packages/test/src/verifier.test.ts packages/test/src/query-verifier.test.ts packages/test/src/verifier-sql.test.ts packages/test/src/mutation-verifier.test.ts packages/test/src/harness-verifier.test.ts packages/test/src/verifier-diagnostics.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sql-observer.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `jisoTest` case/runner construction moved from
      `packages/test/src/harness.ts` into `packages/test/src/test-case.ts`, leaving
      `harness.ts` focused on harness context creation while `packages/test/src/index.ts`
      preserves the public `jisoTest`, `JisoTestCase`, and `JisoTestRunner` exports.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/harness.test.ts packages/test/src/test-case.test.ts`,
      `corepack pnpm exec vitest --run packages/test/src`,
      `corepack pnpm exec vp check packages/test/src/index.ts packages/test/src/harness.ts packages/test/src/harness.test.ts packages/test/src/test-case.ts packages/test/src/test-case.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: parser-specific fragment cases for quoted attributes,
      nested same-tag targets, nested explicit `fw-fragment` elements, and non-target `fw-c` /
      `fw-deps` stamps moved from harness-backed page assertions into
      `packages/test/src/html-fragment.test.ts`; `page.test.ts` now covers the page assertion
      wrapper and harness page path. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/page.test.ts`
      and `corepack pnpm exec vitest --run packages/test/src`.
      Additional evidence 2026-06-12: `createJisoTestHarness().query()` now passes the
      verifier-wrapped DB as `context.db` alongside `context.request.db`, so SPEC §11.4 query
      loader tests can use the same observable DB seam as mutation tests instead of closing over
      `harness.db`. `packages/test/src/query-verifier.test.ts` asserts the context DB identity
      and read-domain verification through the public harness. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/query-verifier.test.ts packages/test/src/harness.test.ts packages/test/src/harness-verifier.test.ts`,
      `corepack pnpm exec vitest --run packages/test/src`,
      `corepack pnpm exec vp check packages/test/src/harness.ts packages/test/src/query-verifier.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: harness operation execution moved from
      `packages/test/src/harness.ts` into `packages/test/src/harness-operations.ts`, leaving
      `harness.ts` focused on context construction while the extracted module owns mutation
      execution, page fixture loading, query loader read verification, and FW410 output
      validation. `packages/test/src/harness-operations.test.ts` covers the direct seam for
      mutation capture, query read assertion before output validation, and lazy page fixtures.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/harness-operations.test.ts packages/test/src/harness.test.ts packages/test/src/query-verifier.test.ts packages/test/src/harness-verifier.test.ts packages/test/src/page.test.ts`,
      `corepack pnpm exec vp check packages/test/src/harness.ts packages/test/src/harness-operations.ts packages/test/src/harness-operations.test.ts`,
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
      Additional evidence 2026-06-12: commerce product-grid render failure injection now uses
      the explicit `CommerceRequest.renderFaults.productGrid` seam instead of mutating
      `db.products.values`, `cloneCommerceDb` no longer preserves custom `Map.values` test hooks,
      and no-JS product-grid failure rendering routes through the same `renderProductGrid`
      compiled-component path as normal rendering. Same-session evidence:
      `corepack pnpm --filter @jiso/example-commerce run emit-graph`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts -t "product-grid fragment failures|no-JS addToCart failures|loads every declared query"`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts`,
      `corepack pnpm --filter @jiso/example-commerce run emit-graph -- --check`,
      `corepack pnpm exec vp check examples/commerce/src/app.ts examples/commerce/src/app.test.ts examples/commerce/src/generated/graph.json examples/commerce/src/generated/touch-graph.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: declared commerce query loaders now take their data
      through the DB `read()` seam (`cart_items`, `products`, `orders`) and accept the harness
      query `context.db` source of truth while remaining compatible with the server query
      lifecycle's `context.request.db`. `app.test.ts` now verifies all declared commerce queries
      through `createJisoTestHarness()` with read-domain verification enabled, so direct fixture
      field reads would fail the example. Same-session evidence:
      `corepack pnpm --filter @jiso/example-commerce run emit-graph -- --check`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts`,
      `corepack pnpm exec vp check examples/commerce/src/app.ts examples/commerce/src/app.test.ts examples/commerce/src/queries.ts examples/commerce/src/generated/graph.json examples/commerce/src/generated/touch-graph.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: commerce cart page metadata now flows through the shared
      `commerceCartPageMeta(loadCartQuery(createCommerceDb()))` source-of-truth path for
      `commerceGraph`, while `scripts/emit-graph.mjs` consumes the same metadata formatter without
      importing runtime-heavy app modules. `app.test.ts` verifies the committed graph artifact plus
      runtime `renderCommercePageHints()` output agree with the real loader result.
      Same-session evidence:
      `corepack pnpm --filter @jiso/example-commerce run emit-graph -- --check`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts -t "ships graph facts"`,
      `corepack pnpm exec vitest --run examples/commerce/src/app.test.ts`,
      `corepack pnpm exec vp check examples/commerce/src/app.ts examples/commerce/src/app.test.ts examples/commerce/src/page-meta.ts examples/commerce/scripts/emit-graph.mjs plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: commerce graph/source-truth acceptance moved from
      `examples/commerce/src/app.test.ts` into `examples/commerce/src/source-truth.test.ts`,
      and the example now depends on the workspace `fw` package instead of deep-importing the
      CLI source for `fwCheck` / `fwExplain`. Same-session evidence:
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.test.ts -t "source-truth|loads declared commerce queries|verifies every declared query|resolves commerce route meta"`,
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.test.ts`,
      `corepack pnpm run check:build`,
      `node --test --test-name-pattern "P10 commerce invalidation is expressed through graph facts|P10 commerce graph assertions answer behavior mechanically|D2 commerce validates keyed append and optimistic reorder|D4 commerce adopt-dont-invent features stay represented|P4 commerce touch graph is a committed generated artifact" tests/fw-check.node.mjs`,
      `corepack pnpm exec vp check examples/commerce/package.json examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `source-truth.test.ts` now verifies paginated
      `productGridQuery` input through `createJisoTestHarness().query()` against a custom
      commerce DB with read-domain verification enabled, pinning the public harness path to the
      same source-of-truth DB seam as direct loaders. Same-session evidence:
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts -t "paginated commerce query input|cart/add update intent"`,
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`,
      `corepack pnpm exec vp check packages/test/src/query-verifier.test.ts examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`,
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
      Additional evidence 2026-06-12: route/query guard response coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/route-query-guards.test.ts`,
      keeping app session provider ordering, route guard redirects/forbidden shells, and query
      guard redirects/forbidden shells with the auth/session/guards seam. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/route-query-guards.test.ts packages/server/src/index.test.ts`,
      `corepack pnpm exec vp check packages/server/src/index.test.ts packages/server/src/route-query-guards.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: no-JS mutation response rendering coverage moved from
      `packages/server/src/index.test.ts` into
      `packages/server/src/mutation-no-js.test.ts`, keeping POST-redirect-GET success, typed
      failure pages, handler 500 `onError` reporting, and schema-validation field paths with the
      mutation response seam. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/mutation-no-js.test.ts packages/server/src/index.test.ts`,
      `corepack pnpm exec vp check packages/server/src/index.test.ts packages/server/src/mutation-no-js.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: mutation lifecycle coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/mutation.test.ts`, keeping
      typed `ctx.fail`, guard/input ordering, transaction callbacks/rollback, committed
      `Set-Cookie` forwarding, touch-derived reruns, inferred touch sites, row-key narrowing, and
      flat tag invalidation with the mutation seam. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/mutation.test.ts packages/server/src/index.test.ts`,
      `corepack pnpm exec vp check packages/server/src/mutation.test.ts packages/server/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: mutation endpoint request-mode routing coverage moved from
      `packages/server/src/index.test.ts` into `packages/server/src/mutation-endpoint.test.ts`,
      and document-load query-script escaping moved into `packages/server/src/wire-html.test.ts`
      with the shared wire emitter. The remaining `packages/server/src/index.test.ts` coverage is
      still mutation-response focused, so this broad split stays open. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/mutation-endpoint.test.ts packages/server/src/wire-html.test.ts packages/server/src/index.test.ts`,
      `corepack pnpm exec vp check packages/server/src/index.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/wire-html.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: the final mutation-response-focused suite moved from
      `packages/server/src/index.test.ts` into `packages/server/src/mutation-response.test.ts`,
      and the test now imports the extracted `mutation`, `domain`, `query`, and `schema` modules
      directly instead of the package barrel. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/mutation-response.test.ts`,
      `corepack pnpm exec vp check packages/server/src/mutation-response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/server/src/index.test.ts` is absent, and
      `packages/server/src/app.test.ts` now imports the app-shell collaborators from their
      extracted modules instead of `packages/server/src/index.ts`, keeping the request-shell
      boundary test off the public package barrel. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/app.test.ts`,
      `pnpm exec vp check packages/server/src/app.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`. Remaining work in this item is the broader direct-import sweep for
      the other server test files plus any shared fixture helpers that still reduce duplication.
      Additional evidence 2026-06-12: the broader server direct-import sweep is complete for
      `packages/server/src/*.test.ts`; every server test file now imports the owning server module
      instead of `packages/server/src/index.ts`, leaving the package barrel as an external public
      API surface. Same-session evidence: `rg -n "from './index\\.js'" packages/server/src` returned no matches, and
      `pnpm exec vitest --run packages/server/src/*.test.ts` passed 32 files / 215 tests.
      Remaining work in this item is any shared fixture helper extraction that still reduces
      duplication.
      Additional evidence 2026-06-12: mutation-oriented server tests now share the CSRF-disabled
      mutation wrapper through `packages/server/src/test-fixtures.ts`, and the repeated enhanced
      cart mutation/query/fragment fixture used by `mutation-response.test.ts` and
      `wire-fixtures.test.ts` moved into the same helper without reintroducing package-barrel
      imports. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/mutation-response.test.ts packages/server/src/wire-fixtures.test.ts packages/server/src/change-record.test.ts packages/server/src/guards.test.ts packages/server/src/replay.test.ts packages/server/src/mutation.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/schema.test.ts`,
      `corepack pnpm exec vitest --run packages/server/src/*.test.ts`,
      `corepack pnpm exec vp check packages/server/src/test-fixtures.ts packages/server/src/change-record.test.ts packages/server/src/guards.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation.test.ts packages/server/src/replay.test.ts packages/server/src/schema.test.ts packages/server/src/wire-fixtures.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: document assembly and diagnostic document coverage moved
      out of `packages/server/src/shell.test.ts` into `packages/server/src/document.test.ts`,
      importing `document-core.ts` and `document-diagnostics.ts` directly; the response header
      utility assertion moved to `packages/server/src/response.test.ts`, leaving
      `shell.test.ts` focused on shell dispatch. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/document.test.ts packages/server/src/shell.test.ts packages/server/src/response.test.ts`,
      `pnpm exec vitest --run packages/server/src/*.test.ts`,
      `pnpm exec vp check packages/server/src/document.ts packages/server/src/document-core.ts packages/server/src/document-diagnostics.ts packages/server/src/document.test.ts packages/server/src/shell.test.ts packages/server/src/response.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: Vite dev middleware ownership and diagnostic interception
      moved out of `packages/server/src/vite.ts` into `packages/server/src/vite-dev.ts`,
      leaving `vite.ts` as the public Vite API/re-export and plugin hook coordinator. The direct
      seam test in `packages/server/src/vite-dev.test.ts` covers dispatch-table request
      ownership plus page and mutation diagnostic response rendering; public API integration
      remains covered by the existing Vite suites. Same-session evidence:
      `corepack pnpm exec vitest --run packages/server/src/vite-dev.test.ts packages/server/src/vite.test.ts packages/server/src/vite-diagnostics.test.ts`,
      `corepack pnpm exec vp check packages/server/src/vite.ts packages/server/src/vite-dev.ts packages/server/src/vite-dev.test.ts packages/server/src/vite-diagnostics.test.ts packages/server/src/vite.test.ts`,
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
      Additional evidence 2026-06-12: inline-loader enhanced form request-target parity moved from
      `packages/runtime/src/index.test.ts` to `packages/runtime/src/inline-loader.test.ts`,
      comparing the generated/extracted inline loader request headers against
      `submitEnhancedMutation` with a local fake dependency root. Same-session evidence:
      `corepack pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts`,
      `corepack pnpm exec vp check packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: inline-loader response-application parity moved from
      `packages/runtime/src/index.test.ts` to `packages/runtime/src/inline-loader.test.ts`,
      preserving the modular `applyMutationResponseToDom` comparison for keyed `fw-query`,
      unkeyed query, replace fragment, and append fragment effects while reducing the monolith.
      Same-session evidence:
      `pnpm exec vitest --run packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts -t "inline response application|inline delegated|enhanced form request targets"`,
      `pnpm exec vp check packages/runtime/src/inline-loader.test.ts packages/runtime/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
- [x] compiler/index.test.ts (3,580 lines, zero per-module tests) → per-phase files; a
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
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/platform-lowering.test.ts`,
      preserving the broad compiler split as open. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/platform-lowering.test.ts packages/compiler/src/index.test.ts -t "platform|dialog|popover|details"`,
      `pnpm exec vp check packages/compiler/src/platform-lowering.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: component CSS helper coverage moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/css.test.ts`, covering
      scoping fallback, at-rule prefixing, nested host exclusions, dedupe, manifest collection,
      fragment metadata, and preload policy through the public compiler barrel. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/css.test.ts packages/compiler/src/index.test.ts -t "CSS|css|stylesheet|manifest"` and
      `pnpm exec vp check packages/compiler/src/css.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: fragment-target render-input, child-hoisting, FW230/FW303,
      string/comment non-match, registry metadata, and graph-fact coverage moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/fragment-targets.test.ts`,
      with FW230/FW303 expected messages and severities keyed to `diagnosticDefinitions`. The
      broad compiler split remains open. Same-session evidence:
      `corepack pnpm exec vitest --run packages/compiler/src/fragment-targets.test.ts packages/compiler/src/index.test.ts -t "fragment target|FW230|FW303"` and
      `corepack pnpm exec vitest --run packages/compiler/src/fragment-targets.test.ts packages/compiler/src/index.test.ts`,
      `corepack pnpm exec vp check packages/compiler/src/fragment-targets.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: explicit registry fact emission, graph-to-registry
      derivation, and app graph component derivation coverage moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/registry.test.ts`. The
      broad compiler split remains open for the remaining compile pipeline, diagnostics, query
      update, and stamp coverage. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/registry.test.ts packages/compiler/src/index.test.ts -t "registry|app graph|emits one server file"` and
      `pnpm exec vp check packages/compiler/src/registry.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: island-local state stamping/FW301 and event-payload FW320
      coverage moved from `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/state-events.test.ts`, with expected FW301/FW320 messages and
      severities keyed to `diagnosticDefinitions`. The broad compiler split remains open for the
      remaining query-shape, stamp-drift, merge, and mutation-direct-db groups. Same-session
      evidence:
      `pnpm exec vitest --run packages/compiler/src/state-events.test.ts packages/compiler/src/index.test.ts -t "state|FW301|FW320|event payload|FW302"` and
      `pnpm exec vp check packages/compiler/src/state-events.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: mutation direct-db FW330 coverage moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/direct-db.test.ts`,
      with expected FW330 message/severity keyed to `diagnosticDefinitions`. The broad compiler
      split remains open for the remaining query-shape, stamp-drift, and merge groups.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/direct-db.test.ts packages/compiler/src/index.test.ts -t "FW330|direct db|mutation handlers"`
      and `pnpm exec vp check packages/compiler/src/direct-db.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: query binding shape validation, nullable/optional path
      diagnostics, optional traversal lowering, and ejected list-stamp validation moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/query-bindings.test.ts`.
      The broad compiler split remains open for query-update, stamp-drift, and merge groups.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/query-bindings.test.ts packages/compiler/src/index.test.ts -t "data-bind|nullable|query shape|optional|list stamp|FW302|FW227"`
      and `pnpm exec vp check packages/compiler/src/query-bindings.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: query update plan emission for `data-bind`,
      `data-bind-list`, and named derives moved from `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/query-update-plans.test.ts`. The broad compiler split remains open
      for inline derive stamps, FW311 coverage, residual stamp drift, and merge groups.
      Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/query-update-plans.test.ts packages/compiler/src/index.test.ts -t "query update plans|named derives|semicolons"`
      and `pnpm exec vp check packages/compiler/src/query-update-plans.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: inline derive stamp lowering, FW311 update coverage,
      renderOnce/isomorphic classifications, template-stamp placeholder extraction, and app
      bootstrap query-plan wiring moved from `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/query-coverage.test.ts`. The broad compiler split remains open for
      residual stamp drift, attribute merge, ID/content-model diagnostics, and remaining compile
      pipeline groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/query-coverage.test.ts packages/compiler/src/index.test.ts -t "inline attribute|query-dependent|FW311|template stamp|renderOnce|bootstrap|isomorphic|string"`
      and `pnpm exec vp check packages/compiler/src/query-coverage.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: component identity/dependency stamps, residual `fw-c` /
      `fw-deps` validation, FW222/FW223 binding-stamp drift, binding-stamp string/comment
      non-matches, and the self-closing list-stamp diagnostic edge case moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/stamps.test.ts`.
      The broad compiler split remains open for attribute merge, ID/content-model diagnostics,
      and remaining compile pipeline groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/compiler/src/index.test.ts -t "stamp|fw-c|fw-deps|FW222|FW223|self-closing|binding"`
      and `pnpm exec vp check packages/compiler/src/stamps.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: residual primitive composition merge diagnostics FW231,
      FW232, and FW233 plus string/comment non-matches moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/attribute-merge.test.ts`.
      The broad compiler split remains open for residual FW226/FW302 checks, ID/content-model
      diagnostics, and remaining compile pipeline groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/attribute-merge.test.ts packages/compiler/src/index.test.ts -t "FW231|FW232|FW233|attribute merge"`
      and `pnpm exec vp check packages/compiler/src/attribute-merge.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: ID/IDREF diagnostics FW221/FW224 and HTML content-model
      diagnostics FW225 moved from `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/id-content-model.test.ts`, including package-prefixed behavior
      IDREFs, duplicate/repeatable id handling, native table-row acceptance, and string/comment
      non-matches. The broad compiler split remains open for residual FW226/FW302 checks and
      remaining compile pipeline groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/id-content-model.test.ts packages/compiler/src/index.test.ts -t "IDREF|FW221|FW224|content-model|FW225"`
      and `pnpm exec vp check packages/compiler/src/id-content-model.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: residual stamp drift FW226 coverage moved from
      `packages/compiler/src/index.test.ts` into `packages/compiler/src/stamps.test.ts`, and
      the remaining declared-shape FW302 absent-path case moved into
      `packages/compiler/src/query-bindings.test.ts`. The broad compiler split remains open for
      remaining compile pipeline, execution trigger, view-transition, and render-equivalence
      groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/index.test.ts -t "FW226|FW302|residual stamp|data-bind paths"`
      and `pnpm exec vp check packages/compiler/src/stamps.test.ts packages/compiler/src/query-bindings.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: execution trigger validation FW211/FW212, eager-trigger
      justification attachment, and string/comment non-matches moved from
      `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/execution-triggers.test.ts`, with expected messages and severities
      keyed to `diagnosticDefinitions`. The broad compiler split remains open for remaining
      compile pipeline, view-transition, and render-equivalence groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/execution-triggers.test.ts packages/compiler/src/index.test.ts -t "execution trigger|FW211|FW212"`
      and `pnpm exec vp check packages/compiler/src/execution-triggers.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: cross-document `viewTransitionName` lowering, static style
      merge behavior, registry emission, and string/comment non-matches moved from
      `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/view-transitions.test.ts`. The broad compiler split remains open for
      remaining compile pipeline and render-equivalence groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/view-transitions.test.ts packages/compiler/src/index.test.ts -t "view transition"`
      and `pnpm exec vp check packages/compiler/src/view-transitions.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: minifier-name collection and browser-handler diagnostics
      FW201/FW210 moved from `packages/compiler/src/index.test.ts` into
      `packages/compiler/src/handler-lowering.test.ts`, with FW210 message/severity keyed to
      `diagnosticDefinitions`. The broad compiler split remains open for remaining compile
      pipeline and render-equivalence groups. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/handler-lowering.test.ts packages/compiler/src/index.test.ts -t "minifier|FW201|FW210|serializability|anonymous handlers"`
      and `pnpm exec vp check packages/compiler/src/handler-lowering.test.ts packages/compiler/src/index.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: the remaining compile-component smoke, emitted-file,
      CSS artifact, render-equivalence, fixpoint, FW235 provenance, and empty-registry tests moved
      from `packages/compiler/src/index.test.ts` to
      `packages/compiler/src/compile-component.test.ts`; `packages/compiler/src/index.test.ts`
      no longer exists. This closes the zero-per-module-test monolith shape, while the separate
      Phase 2 IR architecture items remain open. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts` and
      `pnpm exec vp check packages/compiler/src/compile-component.test.ts plans/codebase-quality-round2.md`.
      Additional evidence 2026-06-12: added `packages/compiler/src/test-support.ts`
      `compileFixture()` returning emitted files keyed by `kind`, then migrated
      `packages/compiler/src/compile-component.test.ts` away from brittle positional
      server/client/registry/CSS source assertions for the core compile smoke, CSS, and registry
      cases. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts`,
      `pnpm exec vp check packages/compiler/src/compile-component.test.ts packages/compiler/src/test-support.ts plans/codebase-quality-round2.md`,
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
      Additional evidence 2026-06-12: SQL verifier integration cases moved from
      `packages/test/src/index.test.ts` into `packages/test/src/verifier-sql.test.ts`, covering
      insert-select mutation-read verification, update-from reads, subquery reads, and raw SQL
      row-key predicates outside the package index test. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier-sql.test.ts packages/test/src/index.test.ts`,
      `corepack pnpm exec vp check packages/test/src/index.test.ts packages/test/src/verifier-sql.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: the final package-barrel verifier integration cases moved
      from `packages/test/src/index.test.ts` into `packages/test/src/harness-verifier.test.ts`,
      so the `@jiso/test` suite now routes through seam-named tests for harness context, harness
      verifier integration, PGlite integration, query verification, mutation verification, SQL
      verification, page assertions, assertions, and verifier diagnostics. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/harness-verifier.test.ts`,
      `corepack pnpm exec vitest --run packages/test/src`,
      `corepack pnpm exec vp check packages/test/src/harness-verifier.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: SQL observer seam tests moved from
      `packages/test/src/verifier-sql.test.ts` into `packages/test/src/sql-observer.test.ts`,
      further reducing the SQL verifier monolith while preserving observer behavior coverage for
      SPEC §11.2 pass-through, insert-select read/write observation, and CTE alias soundness.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/sql-observer.test.ts packages/test/src/verifier-sql.test.ts`.
      Additional evidence 2026-06-12: `@jiso/test` verifier seam tests now share the diagnostic
      expectation helper in `packages/test/src/test-fixtures.ts`; the query, mutation, SQL,
      PGlite, harness, and diagnostic seam tests key formatted and structured messages to
      `diagnosticDefinitions` instead of copying canonical diagnostic sentence text locally.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/verifier.test.ts packages/test/src/query-verifier.test.ts packages/test/src/verifier-sql.test.ts packages/test/src/mutation-verifier.test.ts packages/test/src/harness-verifier.test.ts packages/test/src/verifier-diagnostics.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sql-observer.test.ts`,
      `corepack pnpm exec vp check packages/test/src/test-fixtures.ts packages/test/src/verifier.test.ts packages/test/src/query-verifier.test.ts packages/test/src/verifier-sql.test.ts packages/test/src/mutation-verifier.test.ts packages/test/src/harness-verifier.test.ts packages/test/src/verifier-diagnostics.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sql-observer.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `jisoTest` runner/case coverage moved from
      `packages/test/src/harness.test.ts` into `packages/test/src/test-case.test.ts`, matching
      the new `packages/test/src/test-case.ts` seam while `harness.test.ts` stays focused on
      harness context behavior. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/harness.test.ts packages/test/src/test-case.test.ts`,
      `corepack pnpm exec vitest --run packages/test/src`,
      `corepack pnpm exec vp check packages/test/src/index.ts packages/test/src/harness.ts packages/test/src/harness.test.ts packages/test/src/test-case.ts packages/test/src/test-case.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/test/src/test-case.test.ts` now pins the
      `jisoTest` runner seam by asserting the runner receives the same executable test-case
      `run` function returned to direct callers, keeping direct and runner-driven execution from
      drifting after the `test-case.ts` split. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/test-case.test.ts`,
      `corepack pnpm exec vp check packages/test/src/test-case.ts packages/test/src/test-case.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: direct HTML fragment parser seam coverage moved from
      `packages/test/src/page.test.ts` into `packages/test/src/html-fragment.test.ts`, leaving
      `page.test.ts` focused on harness-backed page assertions while preserving SPEC §9.1
      id / `fw-fragment-target` target coverage at the parser seam. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/page.test.ts`,
      `corepack pnpm exec vp check packages/test/src/html-fragment.test.ts packages/test/src/page.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: remaining parser edge cases for explicit fragment
      attributes, nested explicit fragments, quoted angle brackets, quoted same-tag text,
      nested same-tag targets, and rejected `fw-c` / `fw-deps` stamp matches moved from
      `packages/test/src/page.test.ts` into `packages/test/src/html-fragment.test.ts`.
      `page.test.ts` now covers only `createPageAssertion` and the harness-backed page path.
      Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/html-fragment.test.ts packages/test/src/page.test.ts`
      and `corepack pnpm exec vitest --run packages/test/src`.
      Additional evidence 2026-06-12: `packages/test/src/index.ts` was re-inspected and is now a
      29-line public export barrel only; no harness, verifier, SQL, PGlite, page, or assertion
      behavior remains there to split. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src`,
      `corepack pnpm exec vp check packages/test/src/index.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: harness operation coverage split out to
      `packages/test/src/harness-operations.test.ts` alongside the new
      `packages/test/src/harness-operations.ts` seam, so `harness.test.ts` remains focused on
      public context construction and DB handle behavior while operation internals have direct
      mutation/query/page tests. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/harness-operations.test.ts packages/test/src/harness.test.ts packages/test/src/query-verifier.test.ts packages/test/src/harness-verifier.test.ts packages/test/src/page.test.ts`,
      `corepack pnpm exec vp check packages/test/src/harness.ts packages/test/src/harness-operations.ts packages/test/src/harness-operations.test.ts`,
      and `git diff --check`.
      Additional evidence 2026-06-12: commerce source-truth graph acceptance split out of
      `examples/commerce/src/app.test.ts` into `examples/commerce/src/source-truth.test.ts`,
      keeping `fwCheck` / `fwExplain` matrix assertions in a named source-truth suite while
      `app.test.ts` remains focused on app behavior and generated component checks. Same-session
      evidence:
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.test.ts -t "source-truth|loads declared commerce queries|verifies every declared query|resolves commerce route meta"`,
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.test.ts`,
      `corepack pnpm exec vp check examples/commerce/package.json examples/commerce/src/app.test.ts examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/test/src/query-verifier.test.ts` now pins the
      public harness query-input path while read verification stays scoped to the harness DB, and
      commerce source-truth acceptance exercises paginated `productGridQuery` input through that
      path. Same-session evidence:
      `corepack pnpm exec vitest --run packages/test/src/query-verifier.test.ts`,
      `corepack pnpm exec vitest --run examples/commerce/src/source-truth.test.ts`,
      `corepack pnpm exec vp check packages/test/src/query-verifier.test.ts examples/commerce/src/source-truth.test.ts plans/codebase-quality-round2.md`,
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
