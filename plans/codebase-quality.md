# Codebase Quality Remediation Plan

Status: in progress; audited against the repository on 2026-06-11
Companion: archived `plans/improve-compiler.md` entry in `plans/archive.md`
(compiler-specific plan; referenced by Phase 4, not duplicated here).
Source: whole-repo quality review (2026-06-11) — compiler deep-dive plus parallel package reviews of runtime, server, drizzle/core, cli/create-jiso/test, examples/conformance.

Out of scope by decision: toolchain/gate/packaging hygiene (pre-release tooling, fresh-clone
install path, cache-invalidation globs, fw-check gate restructuring, publishability). This plan
covers source quality: security, correctness, architecture, drift, and test quality.

## Progress checklist

- [x] Phase 1 server security/protocol findings are implemented: scoped replay store with TTL/reservations, CSRF fail-closed ordering, defined mutation 5xx envelopes, reduced `FW-Changes`, non-replayed schema 422s, bounded/richer rate limiting, and immutable schema builders.
- [x] Phase 2 runtime resilience findings are implemented: fetch-rejection fallback/error sink, guarded JSON parsing, serialized island state writes, loader-scoped signal cleanup with `dispose`, visible-return refetch dedupe, omitted-optimistic-truth diagnostics, `crypto.randomUUID()` idempotency, and indeterminate upload progress.
- [x] Phase 3 Drizzle integrity findings are implemented or materially addressed: arrow handlers, AST extraction, source-mode table recognition, query shape/nullability, projection-less select diagnostics, FW410 message/suppression hardening, and conformance peer/pin coverage.
- [x] Phase 4 compiler work is underway with the companion plan now carrying detailed checked items.
- [ ] Phase 5 duplicate de-drift is partially implemented: test-harness/runtime fragment
      semantics, TouchGraph type sharing, FW help-string unification, commerce generated
      artifacts, and runtime export aliases are materially addressed, but inline loader
      build-time generation and the commerce CLI deep-import cleanup remain open.
- [ ] Phase 6 API honesty/correctness items are mostly implemented: CLI check-family filtering,
      stable input errors, fail-on-findings, entry-point guards, structural test equality, and
      `jisoTest` runner registration are done, but pglite verifier passthrough still swallows
      unparseable string SQL instead of emitting an unresolved-site fact.
- [x] Phase 6 remaining API work is closed for the tracked items: `form()` registry-value
      inference alignment is done, the broad dead/duplicate code sweep is complete, and remaining
      compiler cleanup is tracked in `plans/archive.md` under the archived
      `plans/improve-compiler.md` entry.
- [ ] Module splits remain open: compiler/server/drizzle/runtime have initial extracted modules,
      while most server/drizzle/runtime responsibilities still live in package `src/index.ts`
      barrels. Runtime evidence 2026-06-11: fragment/query/deferred-stream wire parsing moved to
      `packages/runtime/src/wire-parser.ts` with the public `FragmentChunk` export preserved.
- [x] SPEC reconciliation queue is closed for doc-only drift: CSRF ordering, `FW-Changes`,
      5xx envelopes, mutation response coverage, fragment content type/vocabulary, immutable
      module serving/versioning, and FW410 severity now match the verified implementation.

## Cross-cutting themes

1. **Regex-over-source is a repo-wide pattern with silent-failure bugs in every instance** —
   compiler (see companion plan), drizzle extractor, test-harness fragment parsing, runtime
   wire parsing. Each owns a format or language that deserves a real parser; drizzle already
   builds a ts-morph AST and discards it.
2. **Server has security findings that are ship-blockers independent of any refactor**
   (replay-store IDOR, CSRF default-off vs SPEC §6.6, idempotency commit window).
3. **Duplicated logic has already drifted** — inline minified loader vs runtime, CLI's copied
   TouchGraph types, hand-written FW messages, hand-written "generated" example artifacts,
   test-harness fragment semantics vs runtime.
4. **Test quality is bimodal**: excellent behavioral/contract tests next to restatement tests
   (substring assertions on minified code, snapshot-the-whole-table, `toContain` on template
   copies, hardcoded line numbers). Zero adversarial inputs exist for the known regex hazards.
5. **Monolith modules**: runtime (2,178), server (2,104), drizzle (1,508) each span many
   separable concerns with clean seams, mirrored by monolith test files.

---

## Phase 1 — Server security and mutation-protocol correctness (do first)

All in `packages/server/src/index.ts`. Each item gets a failing test first; several need a
SPEC reconciliation note (see end).

- [x] **HIGH — Replay store keyed by client-controlled idem alone → cross-user response
      disclosure + unbounded memory** (index.ts:631-643, 1293-1294, 1866-1875).
      `renderMutationResponse` returns a cached response for a matching `FW-Idem` _before_ CSRF,
      guards, or validation run; the store has no principal scoping, so user B presenting user A's
      idem (stamped into A's HTML, visible in logs) receives A's rendered query data and
      `FW-Changes`. The memory store also never evicts. Fix: key replay records by
      `sessionId + idem` (make the store API force scoping), add TTL/eviction to
      `createMemoryMutationReplayStore`, and run CSRF before replay lookup. SPEC §10 (IDOR
      posture), §6.6.
- [x] **HIGH — CSRF is silently opt-in; SPEC §6.6 mandates it on every mutation POST**
      (index.ts:870, 1193). Omitting `csrf` from a `mutation()` definition disables verification
      with no diagnostic. Flip the default to required (explicit `csrf: false` escape hatch with
      a diagnostic), and order the check before input parsing (index.ts:1188-1199 currently runs
      user-supplied `Schema.parse` on tokenless cross-site requests and leaks field-level
      validation detail pre-CSRF).
- [x] **HIGH — Idempotency fails across the commit window** (index.ts:1296-1327, 1709-1710,
      1797-1808). If a rerun query `load` or non-boundary fragment renderer throws _after_ the
      handler transaction commits and _before_ `storeMutationReplay` runs, the client retries the
      same idem, finds no record, and re-executes the side effect. Fix: store the replay record
      (or a handler-completed marker) atomically with handler completion, and render chunks into
      it afterward; a chunk failure must produce a defined partial-response/error envelope, not an
      escaped exception. Also remove the silent `if (!result.ok) continue;` (index.ts:1710) —
      a rerun query whose guard/args re-validation fails must signal the client instead of
      leaving stale store data (SPEC §10.3 read-your-writes).
- [x] **MED — `FW-Changes` echoes full mutation input into a response header** (index.ts:1323,
      1585-1592). Form input (potentially PII/passwords) lands in proxy/log pipelines; non-Latin-1
      chars make Node's `setHeader` throw, turning a successful mutation into a 500; large inputs
      blow proxy header limits. Reduce the record to `{domain, keys}` (requires client-side
      check: runtime `readMutationChangeHeader` consumers).
- [x] **MED — Replayed pure-validation 422s brick corrected resubmissions** (index.ts:1298-1304;
      test index.test.ts:2020-2052). Don't store VALIDATION failures that never reached the
      handler under the idem key (or restamp idem in the failure fragment).
- [x] **MED — Rate limiter: unbounded `counts` Map, per-process state, and rejections surface as
      422 `UNAUTHORIZED` instead of 429** (index.ts:262-289, 1427-1435). Evict expired entries;
      document (or fix) the no-`windowMs` permanent-lockout semantics; extend the `Guard` result
      type so a limiter can express _why_ it failed and the wire can say 429 + `Retry-After`.
- [x] **MED — No defined 5xx story** (index.ts:383, 623, 698, 772). Status unions claim errors
      can't happen while loaders/guards/renderers/transactions can all throw with no defined wire
      behavior; query-endpoint failures are JSON while every other error path is HTML fragments.
      Define one error envelope (SPEC currently defines only the 422 path — reconcile).
- [x] **LOW — Schema builders mutate in place behind a chaining API** (index.ts:150-163, 189-197).
      `qty.min(1)` silently changes `qty` everywhere. Return new instances.

Verification: server vitest suite with new adversarial tests (cross-session replay, throw-after-
commit, malformed/hostile `FW-Idem`/`FW-Targets`, non-Latin-1 input, rate-limit window reset);
wire-format changes re-pin fixtures in `fixtures/wire/` and run full `pnpm run acceptance`.
Commit per finding.

## Phase 2 — Runtime resilience (user-data loss and error paths)

All in `packages/runtime/src/index.ts`.

- [x] **HIGH — Enhanced form submit can silently lose user data** (index.ts:235-244, 380-411,
      1569-1610). `preventDefault()` runs before the fetch; a network failure escapes as an
      unhandled rejection with no fallback, retry, or error hook — native submit was suppressed
      and the input is gone. Define the failure contract (error hook + at minimum re-enable /
      surface state on the form; consider falling back to native submit on fetch rejection).
      Same dispatch chain: `dispatchDelegatedEvent`'s throw on a missing handler export
      (index.ts:474) skips the `fw-state` write-back and vanishes; the event bus discards
      listener rejections (index.ts:88). Every listener entry point needs a defined error sink.
- [x] **MED — Unguarded `JSON.parse` at three trust boundaries** (index.ts:634, 1954, 2136).
      One malformed SSR `<fw-query>` script aborts `installJisoLoader` before any listeners
      register (zero interactivity); a malformed chunk mid-stream leaves partial application;
      a malformed `FW-Changes` header throws after server-side success. Catch, surface a
      diagnostic, continue. (`readElementState` already models the right behavior.)
- [x] **MED — Lost-update race on `fw-state` write-back** (index.ts:453-481). Read-once /
      write-unconditionally around awaited handlers means overlapping events or a mid-handler
      morph clobber state. Re-read-and-merge or serialize per-island dispatch.
- [x] **MED — Module-global `islandSignalControllers` leaks and is shared across installs**
      (index.ts:533, 556-569, 1400). Cleanup only runs on replace-mode fragment application;
      tests already hand-scrub the global (index.test.ts:757-761, 827). Scope it to the loader
      instance; add teardown (see 6).
- [x] **MED — Tab refocus double-refetch; `focus` listener dead against a real `document`**
      (index.ts:246-266, 958-986). `visibilitychange` + `focus` both fire on tab switch with no
      in-flight dedupe (serial awaits, twice); window-focus events never reach document listeners,
      so the second wiring is dead in real browsers and only "works" against FakeRoot. Pick one
      signal, dedupe in-flight, and add a browser-suite test (the node test at index.test.ts:1026
      currently codifies the double-fire).
- [x] **LOW — No teardown** (index.ts:221-278, 1777-1817). `installJisoLoader` returns only
      `{ events }`; listeners, IntersectionObserver, and the auto-created BroadcastChannel can
      never be uninstalled — hostile to tests/HMR and compounds finding 4. Return a dispose.
- [x] **LOW — Optimistic prediction becomes truth when the server omits a query chunk**
      (index.ts:1679-1695). `settle` discards the server-truth snapshot for transformed queries
      absent from the response. Emit a diagnostic for uncovered transforms instead of persisting
      fiction (reconcile with SPEC §10 on whether the server must echo every invalidated query).
- [x] **LOW — `Math.random()` idempotency keys** (index.ts:2128-2130 and inline loader).
      The key exists for server-side dedupe; use `crypto.randomUUID()`.
- [x] **LOW — Upload progress writes raw bytes against `max="100"` when total is unknown**
      (index.ts:421-433). Remove `value` for indeterminate progress; delete the self-confusing
      `progress.total ? '100' : String(total)` expression. Untested branch — add the test.

Verification: runtime node + browser vitest suites; new tests for fetch-rejection path,
malformed payloads at each `JSON.parse` site, overlapping dispatches, refocus dedupe (browser
suite). Loader size budget (fw-check ≤4KB gzip) re-checked whenever the inline loader changes.
Commit per finding or related pair.

## Phase 3 — Drizzle extraction correctness (verification integrity)

All in `packages/drizzle/src/index.ts`. These determine whether the framework's central
invariant (SPEC §850: `observed ⊆ static ∪ FW406-annotated`) actually holds.

- [x] **HIGH — Arrow-function handlers are invisible to write extraction** (index.ts:1073-1097).
      `export const addItem = async (db) => { ... }` yields no touch-graph entry _and no FW406_ —
      the static side under-approximates with no marker, the one direction the SPEC forbids.
      Extract arrow/const-assigned handlers; until then, emit FW406 for any db-receiving function
      the extractor cannot analyze.
- [x] **HIGH — Adopt the AST the package already builds** (index.ts:334-364 vs 894-898, 1342-1345,
      1450-1474). Project mode constructs a ts-morph `Project`, uses it only to rewrite
      identifiers, then re-runs regexes on patched text. Migrate extraction (tables, functions,
      writes, predicates) onto the AST; this retires the semicolon-required table regex, the
      string/comment-blind brace matcher, and the statement-end scan that attributes later `eq()`
      calls to the wrong write. Mirror the compiler plan's hard rule: plain-data model out,
      no ts-morph types past the extraction layer.
- [x] **HIGH — Shape derivation guesses from column names and cannot express nullability**
      (index.ts:643-649, 57-66). `/(count|qty|...|amount)$/i` → number, else string; a text column
      `discount` types as number; `leftJoin` nullability and json columns are unrepresentable
      (the `'array'`/`'object'` members of `QueryShape` are unreachable — dead surface). These
      facts feed FW302/FW410 verdicts. Use real column types (project mode has the checker;
      pinned-runtime mode can read Drizzle column objects), and add nullable/optional to
      `QueryShape` (coordinate with compiler `pathExistsInShape`).
- [x] **MED — `extractParameterizedKey` is position-blind across the statement**
      (index.ts:1359-1379). `or(eq(id, a), eq(id, b))` claims single-row scope while two rows are
      touched — under-invalidation; an `eq` against an unregistered table fabricates a row key
      (index.ts:1394-1405 guard only covers annotated tables). Tie key extraction to the `where`
      argument's AST node, and degrade to table-level on `or`.
- [x] **MED — Any `const` containing `domain: "..."` registers as a table** (index.ts:902-919).
      Source mode should require `pgTable(` + `jiso(` like project mode's
      `isAnnotatedTableInitializer` (index.ts:515-517) — two modes, one recognition rule.
- [x] **MED — Projection-less selects vanish from query facts silently** (index.ts:582, 601-612).
      `db.select().from(...)` escapes FW407 read-domain checking and shape verification with no
      diagnostic. Emit an "unanalyzable projection" fact (FW406-style) instead of `continue`.
- [x] **LOW — FW410 static emission reuses the runtime-failure sentence, and suppression is a
      substring test** (index.ts:667-672, 655-657). Split the static (missing schema) message from
      the runtime (shape mismatch) one; replace `/\boutput\s*:/` with a real property check (free
      once item 2 lands).
- [x] **LOW — Conformance pin doesn't pin the real integration point** (conformance/drizzle-pin/
      src/index.test.ts:20-39). No test executes `pgTable(name, cols, jiso({...}))` against the
      pinned drizzle-orm 0.45.2 — the one call signature that drizzle version bumps would break.
      Add it, and declare `drizzle-orm` as a peer dependency of `@jiso/drizzle`.

Every fix here adds the adversarial tests the suite lacks: no-semicolon source, arrow handlers,
`or(...)` predicates, braces in strings, name-vs-type column mismatches.

Verification: drizzle vitest + `pnpm run test:conformance`; touch-graph output changes re-pin
golden files with the diff explained in the commit. Items 1 and 2 can proceed as separate
sub-agent slices (1 is regex-level and ships first; 2 subsumes it later).

## Phase 4 — Compiler

Execute the archived `plans/improve-compiler.md` work (Phases 0-4 there). No duplication here; one note — the
`QueryShape` nullability extension (Phase 3 item 3 above) lands in `@jiso/compiler`'s
`pathExistsInShape`/`queryShapeAtPath`, so sequence it with that plan's Phase 0/1 work.

## Phase 5 — De-drift the duplicates

Each item replaces a second implementation with a single source of truth. Independent slices;
good sub-agent candidates with explicit file ownership.

- [ ] **Inline minified loader** (`runtime/src/index.ts:219`). A second hand-minified loader that
      has already diverged (silently skips missing handler exports where the runtime throws; raw
      `innerHTML` with no morph/store/broadcast). Generate the string at build time from real
      source (esbuild-minified entry sharing modules with the runtime), assert behavior parity in
      tests instead of `toContain` on minified substrings (index.test.ts:306-314), keep the ≤4KB
      budget assertion.
      Reopened 2026-06-11: `packages/runtime/src/index.ts` still derives
      `jisoLoaderSource` from `installInlineJisoLoader.toString()` at module load; this is tracked
      by `plans/codebase-quality-round2.md` Phase 4.1.
- [x] **Test-harness fragment resolution** (`test/src/index.ts:567-593`). Resolves targets by
      `fw-c`/tag where the runtime uses `getElementById`/`[fw-fragment-target]`, and truncates at
      the first nested same-tag close. Export the runtime's resolution/parsing for the harness to
      consume; the harness must never teach semantics the loader doesn't execute.
- [x] **TouchGraph types copied into the CLI and already drifted** (`cli/src/index.ts:189-208` vs
      `drizzle/src/index.ts:23-55` — the CLI copy lacks `domain?` on unresolved sites, which
      `test/src/index.ts:483,506` relies on). Move the graph types to `@jiso/core` (both packages
      already depend on it) and delete both copies.
- [x] **Hand-written FW messages** (`cli/src/index.ts:573` rewrites FW407's sentence). All
      diagnostic text flows from `diagnosticDefinitions` (SPEC §11.3 single source); add the
      missing `help` field to `core/diagnostics.ts` so callers stop ad-hoc appending (drizzle
      FW410, compiler help strings migrate onto it).
- [ ] **Commerce example's hand-written "generated" artifacts** (`examples/commerce/src/generated/`,
      `app.ts:519`). The reference app (README: SPEC §16 acceptance target) never runs the
      compiler; its staleness test compares two hand-authored literals. Add real component source
  - an emit script so `graph.json`/`touch-graph.ts` are produced by `compileComponentModule` +
    `deriveAppGraph`, with a test asserting emit-equals-committed. This creates the repo's only
    end-to-end proof of the headline pipeline. Also: drop the hardcoded `app.ts:196` line-number
    assertions in `app.test.ts` (compute like fw-check's `lineNumberFor`), and declare the `fw`
    dependency instead of the `../../../packages/cli/src` deep import. Depends on Phase 4 being
    far enough along that the compiler accepts the example's components.
    Reopened 2026-06-11: `examples/commerce/src/app.ts` and
    `examples/commerce/src/app.test.ts` still deep-import `../../../packages/cli/src/index.js`;
    no `fw` dependency is declared in `examples/commerce/package.json`. The remaining cleanup is
    tracked by `plans/codebase-quality-round2.md` Phase 1.4 and Phase 6.
- [x] **Byte-identical runtime export pairs** (`runtime/src/index.ts:1374-1384, 1409-1443`).
      `applyMutationResponse`/`applyDeferredChunk` and their `*ToDom` twins: alias or delete one
      pair (public API — deprecate via alias first).

## Phase 6 — API honesty and small correctness (cli / create-jiso / test / core)

- [x] **`fw check optimistic|coverage` are silent no-ops** (`cli/src/index.ts:238-239`) — the
      token only shifts argv; all checks run regardless, and the fixtures-per-fact-type tests
      can't notice. Filter by check family or reject the subcommand.
- [x] **CLI input handling** (`cli/src/index.ts:240-291, 608-609`): bare
      `JSON.parse(readFileSync(...))` everywhere — ENOENT/SyntaxError/mis-shaped graphs produce
      raw stack traces from the tool whose brand is stable diagnostics. One guarded loader with
      a diagnostic-quality message; tests for missing/malformed/mis-shaped input, unknown
      command, and explain-usage error.
- [x] **Audit exit codes** (`cli/src/index.ts:335, 347, 518, 593`): the §10.3 IDOR audit
      (`--unscoped`/`--unguarded`) always exits 0; only `ERROR `-prefixed lines flip `fw check`.
      Add `--fail-on-findings` (or document the diffable-list rationale in SPEC).
- [x] **Entry-point guard breaks on spaces/symlinks/Windows** (`cli/src/index.ts:1049`,
      `create-jiso/src/index.ts:576`): compare against `pathToFileURL(process.argv[1]).href`,
      and add an out-of-process spawn test (all current tests call `main()` in-process, so the
      parse-but-run-nothing-exit-0 failure mode is invisible).
- [x] **`propertyTest`/`assertMutationError` equality is `JSON.stringify`**
      (`test/src/index.ts:607-609, 437`): key-order-sensitive and `undefined`-blind in a public
      testing API whose product is counterexamples. Structural deepEqual.
- [ ] **Verifier proxy assumes `query`/`exec`/`sql` take SQL strings** (`test/src/index.ts:313-325`):
      narrow on `typeof === 'string'` and degrade unparseable statements to an unresolved-site
      fact instead of throwing before the user's real method runs.
      Reopened 2026-06-11: `packages/test/src/index.ts` now narrows to strings before observing,
      but unparseable string SQL is still swallowed instead of degraded to an unresolved-site fact;
      `packages/test/src/index.test.ts` asserts that no observed fact is emitted for malformed SQL.
- [x] **`jisoTest(name, fn, options)` registers nothing** (`test/src/index.ts:448-454`): it
      ignores `name` and invokes `fn` immediately while reading as an `it()`-alike. Integrate
      with the runner or reduce the API to `createJisoTestHarness`.
- [x] **`form()` ignores `MutationRegistry` value types** (`core/src/index.ts:245-251`):
      `query()` derives `Result` from its registry; `form()` requires hand-supplied
      `Input`/`Failure` generics while the registry value position sits unused. Align before
      codegen starts populating real types.
- [x] **Dead/duplicate code sweep**: `exportTableAliases` ⊂ `importExportTableAliases`
      (`drizzle/index.ts:995-1014` vs 973-993), duplicated keyword sets and const-decl regexes
      (drizzle), unused `getDiagnosticDefinition` export (`core/diagnostics.ts:200-202`),
      `renderQueryChunk` vs `renderQueryEndpointChunk` and the twin record-accumulators in server
      (index.ts:1728-1753, 1437, 1531), `findHandlerBodies` twin loops (compiler — already in the
      companion plan).

  Implemented so far: Drizzle identifier/const-declaration regex and ignored-call sets are
  shared; the subset `exportTableAliases` helper is gone and all alias propagation uses
  `importExportTableAliases`; the unused core diagnostic-definition export is gone; server record
  accumulation and query chunk rendering use shared helpers. Remaining compiler cleanup is tracked
  by the archived `plans/improve-compiler.md` work.

Verification: per-package vitest + root `pnpm run check`; CLI behavior changes (1-4) update
`tests/fw-check.node.mjs` expectations where output text is pinned.

## Module splits (fold into the phase that touches each package)

Don't run a standalone split phase; extract modules as the substantive work above touches each
area, keeping `src/index.ts` barrels and API surface verbatim (mirrors compiler plan Phase 2):

- **server** → `schema.ts`, `guards.ts`, `csrf.ts`, `query.ts`, `mutation.ts`, `route.ts`,
  `hints.ts`, `stream.ts`, `html.ts` (Phase 1 already touches most of these seams).
  Evidence: versioned client module serving is now isolated in
  `packages/server/src/client-modules.ts`, with `src/index.ts` preserving the public barrel
  exports. The extracted helper owns SPEC §6.6 deploy-skew behavior for immutable retained
  handler module URLs.
  Evidence: page hint rendering, route meta resolution, i18n hint scripts, stylesheet hint
  dedupe/rendering, and speculation rules now live in `packages/server/src/hints.ts`, with
  `src/index.ts` preserving the public barrel exports. The extracted helper owns SPEC §13.1's
  shared stylesheet delivery behavior for pages, mutation fragments, and deferred fragments.
  Evidence: deferred stream rendering, stream chunk sorting, deferred query chunks, and deferred
  fragment chunks now live in `packages/server/src/deferred-stream.ts`, with shared escaping in
  `packages/server/src/html.ts`; `src/index.ts` preserves the public barrel exports.
- **runtime** → `events.ts`, `loader.ts`, `store.ts`, `optimistic.ts`, `wire.ts`, `morph.ts`,
  `broadcast.ts` (seams verified clean — almost nothing crosses them). Also stop exporting
  internals (`stampPendingQueries`, `abortRemovedIslandSignals`, `hydrateQueryScripts`, …)
  that blur the public contract.
  Evidence: typed event bus/delegated event shapes now live in `packages/runtime/src/events.ts`,
  query store and `fw-query` hydration now live in `packages/runtime/src/query-store.ts`, and
  guarded JSON parsing now lives in `packages/runtime/src/json.ts`; `src/index.ts` preserves the
  public barrel exports.
  Evidence: delegated handler references, parameter/state hydration, serialized state writes, and
  island signal lifetime cleanup now live in `packages/runtime/src/handlers.ts`; `src/index.ts`
  preserves the public handler exports and loader/morph integration points for SPEC §4.5–§4.7.
  Evidence: fragment application and the browser-free structural morph contract now live in
  `packages/runtime/src/morph.ts`; `src/index.ts` preserves the public morph exports and the
  enhanced mutation DOM integration points for SPEC §11.4/§13.2.
- **drizzle** → `extract/` (AST), `graph.ts`, `serialize.ts` (falls out of Phase 3 item 2).
  Evidence: v1 invalidation registry derivation and serialization now live in
  `@jiso/drizzle`, with unit coverage for touch graph × query read-set matching and generated
  `InvalidationSets` output. Initial split: invalidation registry derivation/serialization is
  isolated in `packages/drizzle/src/invalidation.ts`, with `src/index.ts` preserving the public
  barrel.
  Evidence: touch graph entry construction, domain/touch graph serialization, and graph
  diagnostics now live in `packages/drizzle/src/graph.ts`, with `src/index.ts` preserving the
  public barrel exports. The extracted helper owns the committed touch graph output and
  FW406/FW409 diagnostics for SPEC §10.6 and §11.1.

## SPEC reconciliation queue

Closed on 2026-06-11 as documentation/spec reconciliation only; no package runtime, server, or
compiler implementation changes were needed.

1. [x] **CSRF ordering.** SPEC §6.6 and §10.3 now agree on CSRF before schema parsing, replay
       lookup, and guards. Verified in `packages/server/src/index.ts` (`runMutation` and
       `renderMutationResponse`) and pinned by server tests for default CSRF-before-parse and
       no replay lookup before CSRF validation.
2. [x] **`FW-Changes` content.** SPEC §9.1 defines the public header as sanitized
       `{domain, keys}` records with no input echo. Verified by `mutationWireChangeRecords` in
       `packages/server/src/index.ts`, runtime header sanitization in `packages/runtime/src/index.ts`,
       and server/runtime tests for omitted input, ASCII-safe headers, and malformed header handling.
3. [x] **Error envelope.** SPEC §9.2 defines stable 5xx behavior: query endpoint JSON
       `SERVER_ERROR`, route HTML fallback/error shell, and enhanced mutation 500 fragments
       (`SERVER_ERROR` for handler exceptions, `RENDER_ERROR` for post-commit render failures).
       Verified by server tests covering query, route, enhanced mutation, and no-JS mutation 500s.
4. [x] **Mutation response coverage.** SPEC §10.4 now says successful enhanced mutations should
       include rerun `<fw-query>` chunks for derivable invalidated query instances; omitted server
       truth for an optimistic transform is a visible runtime diagnostic, not silent truth promotion.
       Verified by runtime `uncoveredOptimisticQueries`/`settleWithoutServerTruth` behavior and tests
       reporting omitted optimistic server truth.
5. [x] **Fragment content type/vocabulary.** SPEC §9.1 uses
       `text/vnd.jiso.fragment+html; charset=utf-8`, `<fw-fragment>`, default morph semantics, and
       `mode="append"`. Verified by server mutation/deferred response tests and runtime fragment
       parsing/application tests.
6. [x] **Module serving/versioning.** SPEC §6.6's immutable versioned module guarantee is
       implemented by the server memory registry and compiler-emitted `?v=` handler URLs. Verified by
       server tests for retained old module versions, immutable cache headers, and versioned hrefs,
       plus compiler tests for versioned handler URLs and retained dev-middleware modules.
7. [x] **FW410 severity.** SPEC §11.3 fixes FW410 at `error`, matching
       `packages/core/src/diagnostics.ts` and drizzle/core tests.

## Sequencing summary

| Phase | Theme                               | Risk                                | Gate                                             |
| ----- | ----------------------------------- | ----------------------------------- | ------------------------------------------------ |
| 1     | Server security + mutation protocol | High-value, wire-visible            | server vitest + fixtures re-pin + acceptance     |
| 2     | Runtime resilience                  | Medium, behavior-visible (intended) | runtime node+browser vitest                      |
| 3     | Drizzle extraction integrity        | Medium                              | drizzle vitest + conformance                     |
| 4     | Compiler (companion plan)           | Per companion plan                  | per companion plan                               |
| 5     | De-drift duplicates                 | Medium (5.1, 5.5 largest)           | cross-package: full `pnpm run test` + acceptance |
| 6     | API honesty + cleanup               | Low                                 | per-package vitest + check                       |

Phases 1-3 are independent and can run as parallel sub-agent tracks (per-package file
ownership; integration, gate runs, and commits centralized). Phase 5 depends on 1-4 landing
in the packages it unifies. Within every phase: adversarial regression test first, narrowest
verification after each fix, checkpoint commit per finding or coherent pair.
