# Codebase Quality Remediation Plan — Round 2

Status: not started; findings audited against the repository on 2026-06-11
Companions: `plans/codebase-quality.md` (round 1, largely executed), `plans/improve-compiler.md`
(compiler plan — Phase 2 here supersedes its remaining cleanup items with an architecture change).
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

- [ ] Phase 0 ledger honesty: false `[x]` items corrected in `plans/codebase-quality.md` and
      `IMPLEMENT_v1.md`; checkbox-accuracy rule added to CLAUDE.md.
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

- [ ] **Correct the false round-1 checkboxes.**
  - `plans/codebase-quality.md:237` (Phase 5 commerce item) claims the CLI deep import was
    replaced with an `fw` dependency. Reality: `examples/commerce/src/app.ts:24` and
    `app.test.ts:8` still deep-import `../../../packages/cli/src/index.js`; no `fw` dependency
    exists in `examples/commerce/package.json`. Re-open the item (it is executed by Phase 1.4
    and Phase 6 here).
  - `plans/codebase-quality.md` Phase 5 "inline minified loader" claims build-time generation
    from real source (esbuild). Reality: `runtime/src/index.ts:309-316` regex-minifies
    `Function.prototype.toString()` output at module load. Re-open; executed by Phase 4.1.
- [ ] **Re-audit every remaining `[x]`** in `plans/codebase-quality.md` and the IMPLEMENT_v1.md
      progress checklist against code, spot-checking the cited evidence. Record corrections in
      the ledger itself with date.
- [ ] **Add a rule to CLAUDE.md**: a checkbox may be checked only with cited file/test evidence
      verified in the same session; evidence lines name the verifying test or command.

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
- [ ] **Make create-jiso templates real files** (`create-jiso/src/index.ts:63-473`, ~470 lines of
      escaped template literals including a CI workflow and double-escaped regexes inside
      `.mjs`-in-string). Move to a `templates/` directory copied at scaffold time with `{{name}}`
      substitution; templates are linted/typechecked as code. Replace the template-substring test
      with: scaffold into a temp dir, run `tsc --noEmit` (and the scaffold's own test script)
      on the result.
- [ ] **Document the test topology** (root README or CONTRIBUTING): the five mechanisms (package
      vitest, browser config, `tests/*.node.mjs`, conformance workspaces, acceptance chain), and
      make `scripts/fw-check.mjs` fail with a "run `vp run build` first" message instead of a raw
      import error when `dist/` is missing (tests/fw-check.node.mjs:5 hidden ordering dep).
- [ ] **Give the graph schema one home.** Move `FwExplainInput` and friends from
      `cli/src/index.ts:14-241` to `@jiso/core`, with element-level validation (an unknown
      diagnostic code currently crashes `fw` with a raw TypeError —
      `diagnosticDefinitions[lint.code].message` at cli/src/index.ts:1309, :855, :878, :891).
      Compiler `RegistryGraphInput` (compiler/src/graph.ts:33-47) and the CLI consume it; the
      commerce deep imports die here. While in the CLI: collapse the four copy-pasted
      read/write/return dispatch blocks (cli/src/index.ts:300-345), reject unknown flags instead
      of treating them as file paths, fix `fw <unknown>` claiming "not implemented yet" (:347),
      and stop deriving the exit code by scraping formatted output lines (:799-803 — findings
      should be structured first, rendered second).

Verification: full `pnpm run acceptance` (the gate is the thing changing — its replacement must
catch a seeded regression: mutate a fixture graph and confirm red). Commit per item.

## Phase 2 — Compiler: make the model the IR

Supersedes the remaining cleanup items in `plans/improve-compiler.md`. The parser migration was
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
- [ ] **HIGH — Retire regex rewriting of handler bodies.** emit/client.ts:89
      (`/\bstate\b/g → ctx.state` corrupts `log('state changed')`), :96 (member-expression
      substitution inside string literals), lower/handlers.ts:262 (harvests params from string
      contents), :277-294 (`splitArguments` is quote-blind). All become AST-node operations on
      the model. Add the adversarial tests first: `'state'` in strings, quoted commas in args,
      member expressions in template literals.
- [ ] **HIGH — Kill the derive mega-regex.** validate/bindings.ts:215-216 silently drops any
      `derive()` export whose expression contains `;` in a string or unusual formatting — its
      stamps vanish from `collectQueryUpdatePlans` with no diagnostic. scan/parse.ts already
      walks every CallExpression; use it.
- [ ] **MED — Extract `src/types.ts`; break the layering inversion.** Canonical fact types live
      in index.ts, which imports every phase; phases import back (bindings.ts:15-25, emit/server.ts:10,
      lower/handlers.ts:7), and three modules dodge the cycle with diverging private structural
      copies (emit/client.ts:4-32, emit/registry.ts:7-32, component-contracts.ts:21-55 — the
      last already lacks `source` on `QueryShapeFact`). One types module, delete the copies,
      make index.ts a true barrel + thin orchestrator. Deduplicate `queryShapesFromFacts` (3
      copies), the shape-wrapper quartet (2), `removeJsxAttribute` (2).
- [ ] **MED — Move analysis out of validate/.** `collectQueryUpdatePlans` and coverage
      classification feed emit, not validation; positions travel through a module-global
      `WeakMap` (`updateCoverageSpans`, bindings.ts:45-48) read back in component-contracts.ts:271.
      An `analyze/` phase with explicit spans in its output kills the side channel.
- [ ] **MED — CSS host detection onto the model.** css.ts:211/:220/:238 grep the whole module
      with bare regexes (match inside comments/strings). The component option entries are already
      in the parsed model; `scan/text.ts:39`'s `findStringEnd` has no template-interpolation
      handling — retire it where the model suffices, fix it where it must stay (CSS literal
      balancing).
- [ ] **MED — Make the render-equivalence gate real.** emit/server.ts:28-41 compares
      `serverRenderSource(...)` against itself round-tripped through its own escaper — it can
      only fail if the escape pair disagrees. Execute the emitted server module's render against
      the authored render over the test corpus (SPEC §5.2.3's semantic gate, currently
      tautological).
- [ ] **LOW** — `validateDirectDbAccess` early-returns after the first offending handler per file
      (component-contracts.ts:174-191); FW201 silently replaces FW210 for handlers that are both
      anonymous and unserializable (lower/handlers.ts:44-62); `graph.ts:1` imports `'./shared.ts'`
      while everything else uses `.js`; `inferComponentName` hides a re-parse in a default
      parameter (index.ts:376).

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
- [ ] **HIGH — Remove fact-fabricating heuristics; degrade to FW406.**
      Column type from projection-key name (`/(count|qty|...)$/i` → number, index.ts:993);
      receiver detection by parameter name (`/^(db|tx|...|client|...)$/`, :1856-1858);
      `nullableJoinTables` only matching `.leftJoin` (:1010-1020 — right/full join nullability
      silently dropped). Real column types via the checker (project mode) or Drizzle column
      objects (pinned-runtime mode); unknown → FW406, never a guess.
- [ ] **HIGH — Cover the invisible read/write surfaces or mark them.** Relational query API
      (`db.query.users.findMany()`) matches neither read (:1138) nor write (:598) extraction;
      `db.execute(sql``)` is skipped by `extractExternalDbArgumentCalls` (:1820). Either
      extract them or emit FW406 for any db-receiving expression the extractor cannot classify —
      the static set must not under-approximate silently.
- [ ] **MED — Make the drizzle-orm coupling real and tested.** The `>=0.45.2 <1` pin is
      decorative: drizzle-orm is never imported, absent from devDeps, and every project test
      fabricates a `declare module "drizzle-orm/pg-core"` shim (index.test.ts:1742, 1791, 1846).
      Add drizzle-orm to devDeps; one integration test using real `pgTable`/`select`/`update`
      against the pinned range; centralize every surface assumption (DB-class-name regex :605,
      table-factory names :763, `jiso()` extraConfig contract :95-97) in one `drizzle-surface.ts`
      so a version bump breaks one file and one test.
- [ ] **MED — Split the build-time/runtime seam.** ts-morph is a runtime dependency of the
      package exporting the `jiso()` table annotation (drizzle/package.json:10) — apps importing
      the annotation drag the TS compiler into their production graph. Separate entrypoints:
      runtime (`jiso()`, types) and static (extraction, graph, invalidation). Delete the phantom
      `@jiso/drizzle` dep in test/package.json:11.
- [ ] **LOW** — module-global mutable `sourceExtractionFileId` (:53); fresh ts-morph `Project`
      per `parseSourceFile` call with files re-parsed 3+× per pass (:1457); `IGNORED_LOCAL_CALL_NAMES`
      mixing JS keywords with domain names (:57-71 — a user helper named `insert` is silently
      never folded); shorthand properties dropped by `queryShapeFromObjectLiteral` (:930);
      rename one of the two unrelated `graph.ts` files (compiler vs drizzle).

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
      minified and source loaders.
- [ ] **HIGH — Ship the DOM morph.** The only real keyed DOM morph (focus/selection/scroll
      capture-restore) lives in index.browser.test.ts:12-182; every consumer must rewrite it, and
      the flagship browser test substantially tests its own test code. Promote to a
      `dom-morph.ts` export; the browser test consumes the export.
- [ ] **MED — Unify the apply path.** `submitOptimisticEnhancedMutationDirect`
      (index.ts:1584-1675) re-rolls `applyMutationResponseToDom` inline because the rebaser needs
      an interposition seam the shared function lacks. Add the query-interposition hook; delete
      the parallel path. Also: `parseMutationFailure` (index.ts:1256-1301) rolls its own
      `<fw-error>`/`<output>` regexes — route through wire-parser; delete dead
      `QueryStore.hydrate` (query-store.ts:31-39, never called, divergent error policy vs
      `hydrateQueryScripts`).
- [ ] **MED — Fix ambient-scope argument override in handlers.ts.**
      `abortRemovedIslandSignals(currentHtml, nextHtml, scope)` ignores its explicit `scope`
      whenever the module-level `activeIslandSignalScope` is set
      (handlers.ts:217: `islandSignalControllersFor(activeIslandSignalScope ?? scope)`).
      Explicit argument wins; audit the other module-level registries (:28-32) for the same
      pattern, and add per-test scope isolation (the 4,435-line suite has zero
      beforeEach/afterEach).
- [ ] **MED — One error policy per layer.** `dispatchEnhancedFormSubmit` swallows when `onError`
      exists (index.ts:610-613, including a doubled `if (!options.onError)`) while
      `submitEnhancedMutation` calls `onError` and rethrows (:1556-1558); `readFragmentChunks`
      silently truncates on unbalanced markup (wire-parser.ts:82) while the query path reports.
      Decide, document on the option type, align.
- [ ] **MED — Split `index.ts` subtractively** along its existing seams: `inline-loader.ts`,
      `loader.ts`, `enhanced-mutation.ts`, `optimism.ts`, `query-bindings.ts`, `broadcast.ts`;
      index.ts a pure barrel. Remove the test-shaped production branch in `bindingAttributes`
      (index.ts:1885-1910 — the `Object.entries` arm exists only for `FakeQueryPlanElement`;
      give the fake a real ArrayLike `attributes` instead). Collapse the alias export pairs
      (`applyDeferredChunk`/`applyDeferredChunkToDom`).
- [ ] **LOW** — `hydratedQueries` frozen at install (index.ts:330-342): queries introduced by
      later mutations never become refetch-eligible — fix or document as SPEC-intended;
      `unescapeHtml` missing `&#39;`/`&apos;` (wire-parser.ts:162-168) — pin the server↔runtime
      escaping contract with a shared fixture; `applyQueryBindings` full-document `*` scan per
      chunk (index.ts:1384); consolidate the six near-identical `*Like` element interfaces.

Verification: runtime node + browser suites; gzip budget; the new parity suite is the gate for
any future inline-loader edit. A `definedProps()` helper for the ~30 optional-spread sites is
optional sugar — take it only if it falls out of the split.

## Phase 5 — Server: finish the extraction subtractively

Coordinate with the in-flight uncommitted work (document.ts, app.ts, app.test.ts) — integrate or
land it first; don't fork it.

- [ ] **HIGH — One wire-html emitter.** The `fw-query` markup is hand-built in four places:
      `renderQueryScript` (index.ts:2870-2874), its byte-identical copy
      `renderDocumentQueryScript` (document.ts:162-166), deferred-stream.ts:71-76, and
      `renderQueryWireChunk` (index.ts:2851-2862). Create `wire-html.ts`; delete the document.ts
      copy and the duplicated `QueryScriptRenderOptions` interface (declared twice, aliased in
      index.ts to dodge its own collision); every extraction from here on removes the original.
- [ ] **HIGH — One `onError` diagnostic seam.** Seven bare `catch {}` sites on 500 paths
      (index.ts:903, :1583, :1619, :1862, :2002; client-modules.ts:82; app.ts:203) give operators
      zero signal. Thread `onError(error, context)` through all of them; add `{ cause }` to the
      rerun-query throw (index.ts:2802). Also stop leaking raw `error.message` in
      `renderMutationRenderErrorFragment` (index.ts:2935-2943) — every sibling path emits the
      constant body.
- [ ] **MED — Extract the replay choreography.** The reserve/commit logic threaded through
      `renderMutationResponse`'s three exit paths (index.ts:1817-1924, :2993) is the subtlest
      concurrency code in the package, interleaved with rendering. Wrap as
      `withReplay(scope, idem, fn)`; `runMutation` (100 lines) and the response renderer shrink
      around it.
- [ ] **MED — Unify the eight `{body, headers, status}` response types** behind one base; one
      case-insensitive header utility (today: `readHeader` index.ts:3091 fully case-insensitive
      vs document.ts:137 two-casings vs `findResponseHeaderName` index.ts:2397).
- [ ] **MED — Split `index.ts`** along the round-1 seam list (schema, guards/session,
      csrf/cookies, query, mutation+replay, route, header utils), index.ts a pure barrel. The
      absence of module-level mutable state makes this mechanical today. Name the stringly
      conventions while passing through: the `'arg:path'` micro-DSL (index.ts:2715-2734), the
      `${domain}:${key}` instance-key convention (:2784), the duck-probed session scope
      (:3020-3052 → reuse `SessionRequestLike`), the duplicated `'https://jiso.local'` origin.
- [ ] **LOW** — dead code (`matchShellDispatch` post-loop return shell.ts:161-166; rate-limit
      tail `return options.max > 0` index.ts:576); `matchRoute` recompiling all routes per call
      (match.ts:75-81 — cache `compileRoute`); `Transfer-Encoding: chunked` on a buffered string
      body (deferred-stream.ts:54); double `<title>` in `renderErrorDocument` (document.ts:175);
      `isHeaderSource` false-positives on any non-empty object (index.ts:2322-2328); early-hints
      spread clobbering `Link` (document.ts:153-156); untested cookie-rejection branches
      (index.ts:2405-2461), `t()` throw (:1681), `metaFromQuery` error branches, session Proxy
      traps (:2076-2095).

Verification: server vitest + wire fixtures byte-for-byte (remove the newline fudge at
index.test.ts:4227 while here — it weakens the byte-for-byte claim) + acceptance.

## Phase 6 — Verification harness soundness + example honesty

- [ ] **HIGH — `@jiso/test` Proxy interception hazards.** Name-based duck typing intercepts any
      property named `read/write/sql/query/exec/pglite` (test/src/index.ts:299-344); each
      `db.pglite` access mints a new Proxy (`db.pglite !== db.pglite`, :307-309); per-get binding
      policy differs between `wrap` and `wrapSqlHandle` (:373); handles captured before `wrap()`
      bypass observation silently; concurrent `exec` calls cross-attribute writes via the shared
      `observed` array index window (:115-127). Fix: cache proxies per-target, intercept on the
      adapter seam rather than property names where possible, serialize or scope observation per
      call, and detect/throw on the captured-handle bypass if detectable — otherwise document it
      as a hard usage rule with a lint-style runtime warning.
- [ ] **MED — Split `test/src/index.ts`** (harness / verifier / sql-observer / html-fragment
      modules); unify the two diagnostic channels (FW402/404/407/408 throw strings,
      FW403/405 return structured records); delete the dead FW411 special case
      (:1176-1179 — identical to the general path) and the third FW411 message copy; move
      `diagnosticsForTouchGraph` to one home and delete the verbatim CLI copy
      (drizzle/graph.ts:136-161 vs cli/src/index.ts:850-874).
- [ ] **MED — Commerce example: one source of truth.** `cartQuery.load` returns a constant while
      `loadCartQuery(db)` does the real read (app.ts:123-126 vs :280-284);
      `productGridQuery.load` conjures a fresh `createCommerceDb()` (:161); the committed
      graph.json bakes the fake in (`"Jiso Commerce (1)"`). Make declared queries the real
      loaders — the showcase must demonstrate the pattern the framework sells. Remove the
      unexplained test-hook accommodation (app.ts:111-114 — inject the fault through a seam
      instead); deduplicate `renderProductGrid`/`renderProductGridWithFailure` (:286 vs :436)
      and the two hand-rolled escapers (:548-554 → server html.ts); replace the inline CSRF
      secret (:54) with an obvious `EXAMPLE_ONLY_` name.
- [ ] **MED — Typecheck the example and spikes.** `examples/commerce` and three of four
      conformance spikes sit outside every tsconfig (root includes only `packages/**`), so the
      registry-augmentation showcase (generated/touch-graph.ts:43-50) may never be
      project-typechecked. Add tsconfigs (or extend the root include) and wire them into
      `vp check`. Share one wire-transcript fixture parser between fw-check and app-shell-spike
      (currently two implementations of the `>>> REQUEST` format).
- [ ] **LOW** — better-auth guard-failure literals restate server shapes
      (better-auth/src/index.ts:126-142) — import the constants or keep the cross-package
      agreement test and note it; create-jiso error-path output to stdout while exiting 1;
      auth-spike dead narrowing guard (auth-spike/src/index.test.ts:260-263).

Verification: test/drizzle/commerce vitest + conformance + acceptance; a new adversarial
concurrency test for the harness (two interleaved `exec` calls attribute correctly or fail
loudly).

## Phase 7 — Test-suite restructuring (folds into Phases 2-6; tracked here)

The monolith test files are a symptom: all unit testing routes through package barrels.
As each phase splits a source module, split its tests in the same commit.

- [ ] server/index.test.ts (4,323 lines, one misnamed describe) → per-module files; shared
      fixture factory for the 22 re-declared `domain('cart')` setups; `match.ts` gets its own
      test file; document tests move out of shell.test.ts.
- [ ] runtime/index.test.ts (4,435 lines, mutation tests under "query store") → per-module
      files; `Fake*` classes to a shared `test-fixtures.ts`; direct unit tests for wire-parser,
      handlers, morph; replace counted-microtask flushing with a single `flush()` helper.
- [ ] compiler/index.test.ts (3,580 lines, zero per-module tests) → per-phase files; a
      `compileFixture()` helper returning files by kind; diagnostic assertions reference
      `diagnosticDefinitions[code].message` instead of pasted strings (today a one-word rewording
      breaks dozens of tests).
- [ ] drizzle (one describe, 57 its, 68 inline pgTable fixtures, 3 module-shim copies) and
      test-package suites: same treatment; CLI tests get the temp-dir + stream-spy ritual
      (16 hand-copies) as one helper.

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
