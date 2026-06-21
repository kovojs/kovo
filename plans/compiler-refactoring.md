# Compiler Refactoring

High-value architectural refactoring of `@kovojs/compiler`, split into **Part 1 — feature-neutral
refactorings** (behavior-preserving restructuring) and **Part 2 — capability-unlocking work** (new
authoring/verification/perf capabilities that the Part-1 substrate makes cheap and safe). `SPEC.md` §5
(Compiler) and `rules/compiler-hard-rules.md` are normative; every item below preserves the §5.2 hard
rules unless it is an explicit Part-2 capability that adds new accepted/emitted behavior.

Mark an item `[x]` only after the same session proves it against the gates named under "Neutrality
gates". File:line citations were spot-checked via grep (see "Verification provenance").

**Implementation status (2026-06-20)** — **done & merged to `main`**: Part 1 — **FN1, FN2, FN3, FN4, FN6,
FN8, FN9, FN10, FN12, FN13, FN14** (11 of 14); Part 2 — **CAP6, CAP9** (the two substrate-enabled gates).
**Done on branch (pending integration):** **FN11** (`emitDerive` chokepoint).
Each verified by tsc + the golden/conformance/render-equivalence oracles (+ fact-hash snapshots where facts
moved) + api-surface, committed as its own checkpoint. FN6/FN9/FN10 were implemented by parallel sub-agents
in isolated worktrees and integrated here.

**Open / deferred (genuinely multi-session; the substrate above unblocks them):**
- **FN5** — keystone pass-registry: the `ResultBuilder` half is a clean follow-up; the declarative `Pass`
  registry is large and carries the YAGNI caveat noted on the item. Not started.
- **FN7** — routing the 11 `createSourceFile` reparses through `scan/` (incl. cleaning `app-graph.ts` so it can
  move under the guarded `analyze/` zone): the plan's single largest neutral refactor; each site must reproduce
  fact bytes exactly. Not started.
- **Part 2 features** — **CAP1** (optimism IR unification + typed deriver channel), **CAP2** (`<kovo-live>` SSE),
  **CAP3** (lists at scale), **CAP7** (incremental compile, needs FN5), **CAP8** (fact-driven dev — note FN3
  removed the dead machinery, so this is rebuild-and-wire), **CAP10** (machine-readable diagnostics, builds on
  FN9). Each is a cross-package feature warranting its own effort; not started here to avoid shipping
  unverifiable/partial feature code to `main`.

## Thesis

The compiler is a **source-patch + reparse pipeline**: `compile.ts` parses one TSX file into a flat
typed `ComponentModuleModel`, runs a _hardcoded linear sequence_ of passes that each emit
`SourceReplacement` string patches, re-parses the whole file between passes via `applyModelPatchPass`
(`model-pipeline.ts` — the only seam), then string-templates four 1:1 artifacts (server/client/css/registry).

Almost every headline roadmap capability — derived-optimism integration, live queries, lists-at-scale,
incremental compile, machine-readable `explain`, a drift-proof cross-package ABI — is
blocked by the **same small set of structural facts**:

1. The pass sequence and result assembly are inline imperative code with no registry, decision-record,
   or fact-accumulator (`compile.ts:106-342`, `:740-826`).
2. The typed-fact boundary is leaky: 11 ad-hoc `ts.createSourceFile` reparses outside `scan/`, two
   duplicated escaping/sink taxonomies, four copies of the canonical JSON serializer, and a render-plan
   token duplicated across packages.
3. The data-plane brain (touch-set §11.1, derivation algebra §10.5) lives in `@kovojs/drizzle` with **no
   shared typed IR channel** into the compiler's per-component update plans.

So a modest wave of behavior-neutral plumbing refactors (Part 1) disproportionately de-risks the
capability work (Part 2). The two parts relate as **substrate → payload**.

## Neutrality gates (read before claiming any Part-1 item neutral)

The adversarial review surfaced that the obvious gate is the _wrong_ one. Pick the oracle deliberately:

- **Fixpoint is NOT a valid neutrality proof for authored-source pass refactors.** `assertFixpoint`
  (`compile.ts:834-846`) recompiles emitted artifacts with `sourceProvenance:'compiler-emitted'`, which
  hits the `isCompilerIrArtifact` early-return (`compile.ts:90`). It proves only that the IR pass-through
  is stable, never that an authored-source pass change preserves output.
- **Render-equivalence is the primary oracle, but it is weaker than advertised.**
  `semanticRenderEquivalenceCheck` (`emit/server.ts:95`) runs _both_ the expected and actual sides through
  the same `semanticRenderModel` walker and validates only the **server** artifact (never the client/delta
  path). Use it together with the golden corpus.
- **Golden-output corpus + conformance is the real byte-level oracle:** `compiler-conformance.test.ts`,
  `compile-component.test.ts`, `render-equivalence-boundary.test.ts`, `diagnostic-coverage-matrix.test.ts`.
  Insufficient for `scan/`-extraction changes (they check emitted bytes, not internal model shape) — add
  **fact-level golden tests** when touching `scan/parse.ts` fact extraction.
- **Fact-hash byte-stability is a THIRD, independent gate.** `factHash` (`hmr-impact.ts:60`) and
  `appGraphContributionHash` (`internal-graph.ts:89`) hash internal fact objects for HMR/graph-cache keys
  and are covered by neither fixpoint nor render-equivalence. Snapshot `factHash` output before/after any
  change to query-update / graph / HMR facts (e.g. the non-enumerable `outputContext` channel at
  `query-updates.ts:782`).
- **Cache-key soundness:** the dependency-footprint _producer_ (`compile.ts:470-518`) and the cache-key
  _narrower_ (`compile-cache.ts:351-416`) express the read-set contract twice; snapshot computed cache keys
  over the fixture corpus before/after touching either.
- **Unchanged by every Part-1 item** (preserve exactly): source-derived handler names; 1:1 file mapping;
  teaching errors (rule 5); registry atomicity; the public/internal/generated import boundary (rule 8,
  api-surface gate — exported symbol names must stay identical across all moves/barrels); TSX-only authoring
  (KV235); contextual output safety default-on (rule 10).

---

## Part 1 — Feature-neutral refactorings

Tags: `id · priority · effort/risk`. "Unlocks" lists Part-2 ids. Items deliberately scoped so a single
behavior change never hides inside a "neutral" move.

- [x] **FN1 · P0 · S/low — Hoist the render-plan token to a single shared module in `@kovojs/core`.** ✅ done
  - Done: new `packages/core/src/render-plan-token.ts` (+ `internal/render-plan-token` subpath) owns
    `RENDER_PLAN_GRAMMAR_VERSION` + `computeRenderPlanFingerprint`; `server/client-modules.ts` and
    `compiler/compile.ts` re-export thin wrappers under the historical names (`computeCompilerRenderPlanFingerprint`
    delegates). Verified: `client-modules.test.ts` + `compile-component.test.ts` (47 pass), api-surface gate (no new
    violations), import-boundary, `tsc -p tsconfig.json` clean.
  - Problem: `RENDER_PLAN_GRAMMAR_VERSION` _and_ the fingerprint hash function are duplicated byte-for-byte
    across compiler and server, hand-synced by comment. SPEC §5.2.1 mandates a single opaque build-stable
    token and KV416 fails the build on drift, so a one-character divergence is a silent correctness break
    (server accepts a foreign-shape delta / fails to detect deploy skew). Both packages already depend on `@kovojs/core`.
  - Evidence: `compile.ts:873`, `compile.ts:890-902`; `packages/server/src/client-modules.ts:14`, `:32`, `:166`.
  - Approach: add `packages/core/src/render-plan-token.ts` exporting `RENDER_PLAN_GRAMMAR_VERSION` +
    `computeRenderPlanFingerprint`. Re-export thin wrappers from compiler (`computeCompilerRenderPlanFingerprint`)
    and server so public/internal export names are unchanged. Natural neighbor: `core/query-delta.ts` (owns the
    §9.1.1 deep-merge the grammar gates).
  - Neutrality proof: identical value + identical body moved; every emitted token bit-identical. Proven by
    server `client-modules.test.ts`, `assertRenderPlanTokenMonotonicity` (KV416, `compile.ts:919-942`), api-surface gate.
  - Unlocks: CAP6.

- [x] **FN8 · P0 · M/med — Unify the output-context sink taxonomy into one module shared by emit and validation.** ✅ done (compiler-side scope)
  - Done: `output-context-facts.ts` now owns the canonical `URL_ATTRIBUTES` + exported `isUrlAttribute`; both emit
    (`outputContextForAttribute`) and the KV236 validator (`security/output-context.ts`) call it; the byte-identical
    duplicate set + predicate were deleted from the validator. `BOOLEAN_ATTRIBUTES` kept emit-only (asymmetry
    preserved). Verified the two sets were identical before merging; `tsc` clean + output-context-security/raw-html/
    payloads/facts + server-emit-security tests (31 pass) + api-surface gate. Scope note: a THIRD copy
    (`@kovojs/browser` `URL_BOUND_ATTRIBUTES`) + the `SAFE_URL_SCHEMES` allow-list stay separate — cross-package
    escaper unification + the soundness cross-check is **CAP9**.
  - Problem: the rule-10 escaping decision is split across two modules with duplicated, independently-maintained
    attribute tables. `output-context-facts.ts` (emit) and `security/output-context.ts` (validation / KV236) each
    define their own `URL_ATTRIBUTES` + sink predicates. Byte-identical today — which is exactly why one
    add/remove silently desyncs the gate from the emitter.
  - Evidence: `output-context-facts.ts:63` (`URL_ATTRIBUTES`), `:35` (`BOOLEAN_ATTRIBUTES`, emit-only);
    `security/output-context.ts:345`, `:332-366`.
  - Approach: promote one sink-taxonomy module (extend `output-context-facts.ts`) exporting canonical
    URL/boolean/raw-html/dynamic-sink classification + scheme allow-list; both `outputContextForAttribute` and the
    KV236 validator import it; delete the duplicate sets. Verify the two `URL_ATTRIBUTES` sets are identical first
    (they are). **Preserve the emit-only asymmetry of `BOOLEAN_ATTRIBUTES`** — do not start policing boolean attrs.
  - Neutrality proof: unified table = exact current union. Locked by `output-context-security.test.ts`,
    `output-context-raw-html.test.ts`, `output-context-payloads.test.ts`, `server-emit-security.test.ts` + render-equivalence.
  - Unlocks: CAP9.

- [x] **FN3 · P1 · S/low — Delete the dead fact-invalidation + persistent-prune machinery (or commit to wiring it).** ✅ done (deletion branch)
  - Done: removed `registryFactChanges`, `invalidateFacts`, `#inverseIndex`, `#indexEntry` (+ its two
    per-compile call sites), `compileDependencyFootprintFactKeys`, `compileDependencyFactKey`,
    `CompileDependencyFactChange`, `changedRecordKeys`/`changedArrayValues` from `compile-cache.ts`;
    `prunePersistentCompileCache` from `persistent-compile-cache.ts`; the matching `internal.ts` re-exports and
    dead tests. Live cache behavior (footprint-aware `getOrCreate`, key narrowing) unchanged; per-compile
    index-write cost removed. Open decision deferred to CAP8 if fact-driven incremental dev is wanted. Verified:
    grep (no remaining refs), `tsc` clean, compile-cache/persistent/hmr/cache-identity tests (21 pass), api-surface gate.
  - Problem: `CompileCache.invalidateFacts` / `registryFactChanges` / `#inverseIndex` and
    `prunePersistentCompileCache` are fully implemented, exported via `internal.ts`, and tested, but have **zero
    production callers** (only `internal.ts` re-exports + their own tests). Worse, the inverse index is _written_
    on every compile while its only reader is never called — production pays per-compile indexing cost for nothing.
    The on-disk cache also has no GC/max-size/TTL wired anywhere.
  - Evidence: `compile-cache.ts:38`, `:115`, `:133`; `persistent-compile-cache.ts:122`; `internal.ts:7`, `:13`.
    (grep confirms no callers outside defs + `internal.ts` re-exports.)
  - Approach: pick one coherent cache story. **Neutral branch:** remove `invalidateFacts` /
    `registryFactChanges` / `#inverseIndex` / `#indexEntry` / `compileDependencyFootprintFactKeys` /
    `prunePersistentCompileCache` from `internal.ts` and delete the dead code + tests (including the write-side
    index machinery, not just the reader). **Or** commit to CAP8 and wire it (that path is _not_ neutral). Do not leave half-wired.
  - Neutrality proof: deletion is strictly neutral — api-surface gate + grep confirm no consumer; removing the
    unused index-write also yields a small per-compile speedup.
  - Unlocks: CAP8 (mutually exclusive branch).

- [x] **FN2 · P1 · S/low — De-duplicate the canonical-JSON serializer behind one shared helper.** ✅ done
  - Done: new `packages/compiler/src/canonical-json.ts` exports the one `canonicalJson`; `fact-hash.ts`,
    `cache-identity.ts`, `compile-cache.ts`, and `persistent-compile-cache.ts` import it and dropped their local
    copies (the latter two kept the `stableJson` call shape by switching to `canonicalJson`). Intentional hash
    divergence preserved (fnv1a vs sha256). Verified: no leftover `stableJson`, `tsc` clean, cache-identity /
    compile-cache / persistent / hmr tests (21 pass) — byte-identical hashes/keys.
  - Problem: the canonical serializer is copied four times under two names; divergence would silently break
    cache-identity vs HMR fact-hash agreement.
  - Evidence: `fact-hash.ts:6` & `cache-identity.ts:121` (`canonicalJson`); `compile-cache.ts:428` &
    `persistent-compile-cache.ts:197` (`stableJson`). _(Spot-check found the 4th copy the original map missed.)_
  - Approach: export one `canonicalJson` from a shared internal module; all four import it. Confirm byte-identical
    output first. **Unify only the serializer, not the hash** — the fnv1a (fact-hash) vs sha256 (cache-identity /
    compile-cache) split is intentional.
  - Neutrality proof: identical bodies collapsed to one import; hash outputs unchanged. Covered by
    `cache-identity.test.ts`, `compile-cache.test.ts`, `hmr-impact.test.ts`.

- [x] **FN4 · P1 · S/low — Relocate `removeUnreferencedNamedImports` out of `compile.ts`.** ✅ done
  - Done: moved `removeUnreferencedNamedImports` + its 5 private helpers to new `emit/dead-imports.ts`; `compile.ts`
    imports it and dropped the now-unused `applySourceReplacements` import. Call site unchanged. `compile.ts` shed
    ~142 lines. Verified: `tsc` clean + compile-component / render-equivalence-boundary / compiler-conformance (43
    pass) — emitted server source byte-identical.
  - Problem: a ~141-line TS AST walk for dead-import pruning (the largest single block in `compile.ts`, doing its
    own `ts.createSourceFile`) lives in the orchestrator. It is a terminal emit/transform concern, not sequencing,
    and inflates the file every later pass-framework refactor must touch.
  - Evidence: `compile.ts:550-691`, `:551`.
  - Approach: move it + its private helpers (`isReferenceIdentifier`, `removeStatementReplacement`,
    `contiguousImportSpecifierRuns`, `removeNamedImportRunReplacement`) into `emit/` as a named terminal transform.
    No call-site behavior change.
  - Neutrality proof: pure relocation of a self-contained string→string function. Covered by
    `compile-component.test.ts` server assertions. (Remains a `createSourceFile` site wherever it lives — rule-9
    exposure unchanged, addressed by FN7.)
  - Unlocks: FN5.

- [ ] **FN5 · P0 · L/med — Extract a declarative pass list + `CompileResult` builder from the inline orchestrator.** _(keystone)_
  - Problem: `compileComponentModule` is a ~250-line straight-line function in which both the pass _sequence_
    (structural+href lower → reparse → style → reparse → analyze → server-render → terminal emit) and the result
    _assembly_ (53-line literal inlining `mergeQueryUpdatePlans` / `mergeStyleUpdateCoverage` /
    `dedupeOutputContextFacts` + 6 ad-hoc spreads) are hardcoded. Passes cannot be enumerated, reordered, profiled,
    individually tested, or attributed; each new fact category needs a hand-wired merge + result field. Note:
    `structuralJsxPhaseOrder` _looks_ like a pipeline descriptor but is never consulted by the orchestrator —
    decorative, read only by a snapshot test (`structural-jsx.ts:112`, used only in `structural-jsx-ir.test.ts`).
  - Evidence: `compile.ts:106-342`, `:153-162`, `:290-342`, `:740-826`; `model-pipeline.ts:31-58`.
  - Approach, two sub-steps: **(a)** a `ResultBuilder` owning the canonical merge/dedupe/sort rules per fact
    category (move existing helpers verbatim) with `build() → CompileResult` — lower-risk, do first. **(b)** a
    `Pass` interface `{name, kind, run(state, ctx)}` + ordered array driven by the existing `applyModelPatchPass`
    executor, encoding _today's exact order including the two reparse boundaries_. Critical: passes carry implicit
    ordering dependencies — `styleSpanProbe.handledSpans` feeds structural lowering's `skipInlineAttributeDeriveSpans`;
    style extraction (`compile.ts:133`) runs on _structurally-patched_ source/model; later analysis runs over the
    _second_ reparsed model. The registry must preserve this data threading relative to reparse boundaries.
  - Neutrality proof: behavior-preserving iff the registry encodes the exact current order + reparse boundaries.
    Primary oracle = golden corpus diff + render-equivalence + `compiler-conformance.test.ts` /
    `compile-component.test.ts` — **NOT fixpoint**. Add a fact-hash snapshot.
  - Unlocks: CAP1, CAP3, CAP7, CAP8.

- [x] **FN6 · P1 · M/low — Split `emit/server.ts` into render-lowering / equivalence-gate / mutation-form / shared-helper modules.** ✅ done
  - Done: pure module move (no logic edits). `emit/server.ts` (2239 lines) is now an 18-line re-export barrel
    keeping `compile.ts`/`stamps.test.ts`/`compile-component.test.ts` imports unchanged
    (`emitServerModule`, `serverRenderLowering`, `semanticRenderEquivalenceCheck`, `mutationFormExplainFacts`,
    `EmittedServerModule`, `ServerRenderLowering`, `ServerRenderStampWriteFact`). Concern modules:
    `emit/render-equivalence.ts` (gate: `semanticRenderEquivalenceCheck` + `semantic*`/`renderSemantic*` cluster),
    `emit/mutation-form.ts` (`mutationFormExplainFacts` + enhanced-mutation-form lowering/diagnostics),
    `emit/server-render.ts` (`serverRenderLowering`/`serverRenderPatches` + host-stamp writers + `emitServerModule`),
    `emit/server-emit-shared.ts` (helpers used by ≥2 concerns). Module DAG is acyclic:
    GATE→SHARED, MF→SHARED, SR→{MF,SHARED}, SHARED→∅. The "do not merge the gate's two render walks" rule
    is preserved (extraction only).
  - Shared set is the **transitive closure** of the 7 named gate-facing helpers (`componentMutationSlotName`,
    `enclosingEnhancedMutationForm`, `mutationFormErrorProps`, `mutationFormErrorIdExpression`,
    `enhancedMutationFormLowering`, `enhancedMutationFormBinding`, `staticStringAttributeValue`) **plus**
    `writerConflictDiagnostic` (MF+SR shared) — 24 decls total. The extra tail
    (`localMutationKey`, `submittedForm*`, `staticAttributeScalar`, `formLoweringOutputContext`,
    `renderAttributeWithName`, `attributeValueExpression`, `escapeTemplateLiteral`, `jsx*`,
    `enhancedMutationFormConflicts`, `importsMutationCsrfField`, `EnhancedMutationForm*`) is required to keep
    SHARED self-contained and the graph acyclic (placing it in MF would create a SHARED↔MF cycle), satisfying the
    "move once, no duplication" rule.
  - Verification: `tsc -p tsconfig.json --noEmit` clean; `node scripts/api-surface-gate.mjs` exit 0
    (baseline 1338, 0 new); vitest 107/107 across `compile-component`, `compiler-conformance`,
    `render-equivalence-boundary`, `stamps`, `registry`, `server-emit-security`, `diagnostic-coverage-matrix`.
  - Unlocks: CAP6.

- [ ] **FN7 · P1 · L/med — Route the ad-hoc reparses through the `scan/` boundary and widen the rule-9 guard.**
  - Problem: 11 production sites re-run `ts.createSourceFile` (plus `getText` re-reads) outside `scan/parse.ts`.
    The mechanical rule-9 guard only scans `lower|validate|analyze|emit` (+`graph.ts`), so the package-root files
    where source re-reads actually live are never inspected — exactly the gap (e.g. `internal-graph.ts` reparses a
    model field string; `route-pages.ts` uses `getText`).
  - Evidence: `createSourceFile` at `route-pages.ts:58`, `optimistic-inline.ts:35`, `compile.ts:551`,
    `internal-graph.ts:486`, `style.ts:227/262/373/460/1193`, `mutation-inputs.ts:28`,
    `emit/live-target-renderers.ts:32`; guard scope `packages/conformance-fixtures/src/source-fixtures.ts:585-591`.
  - Approach, per-site (not atomic): **Step 1 (clearly neutral, test-config only)** — widen
    `isPostParseGuardedFile` to include `style.ts` / `css.ts` / `internal-graph.ts` / `optimistic-inline.ts` /
    `mutation-inputs.ts` and flag bare `createSourceFile` outside `scan/`, bounding scope by failing loudly.
    **Step 2 (larger)** — extend `scan/parse.ts` to emit typed clock-cadence + query-binding facts on the existing
    `ObjectLiteralEntry` path; collapse `style.ts`'s 5 internal parses into one shared parse handed in by
    `compile.ts`; fold `internal-graph`'s string-reparse into typed facts; keep `route-pages.ts` as a dedicated
    route-grammar parse but _register_ it with the guard.
  - Neutrality proof: Step 1 neutral by construction. Step 2 must reproduce current fact **bytes** exactly
    (including the naive `[^,}]+` cadence truncation at `internal-graph.ts:206-210` — _fixing_ it is a behavior
    change, gate separately). Needs fixpoint/render-equivalence **plus new fact-level golden tests**; span-equality
    joins (`parse.ts:519-520`, `:568-571`) are load-bearing — preserve `start`/`openingEnd` exactly.
  - Unlocks: CAP1, CAP2, CAP7, CAP8.

- [x] **FN9 · P1 · M/low — Thread diagnostic positions through a `DiagnosticFactory` on `ValidatorContext`; stop passing raw source to validators.** ✅ done
  - Done: added `createDiagnosticFactory(fileName, source, offsetMap?)` + `DiagnosticFactory`/`DiagnosticSpan`
    (`diagnostics.ts`), with a memoized line-start binary-search `offsetToPosition` (byte-identical to the legacy
    O(n) prefix scan, incl. negative/zero/boundary offsets). `collectCompilerDiagnostics` now builds three frame-pinned
    factories — `loweredDiagnostics` (post-lowering `model`/`source`), `originalDiagnostics` (`originalModel`/
    `options.source`), `mappedDiagnostics` (generated offsets mapped via `sourceOffsetMap`) — and passes a factory +
    typed model to every validator; no validator receives a bare `source: string` anymore. Migrated all validators in
    `validate/{bindings,component-contracts,component-names,event-triggers,markup,navigation,temporal}.ts` and
    `security/output-context.ts`. Left `queryShapeFactDiagnostics` (`types.ts`) untouched — it is already source-free
    (positionless KV240, takes only `fileName` + facts), a legitimate rule-9 non-exception.
  - Neutrality proof: pure plumbing, byte-identical diagnostics. Proven by the full `packages/compiler` vitest suite
    (58 files / 566 tests pass) including `diagnostic-coverage-matrix`, `compiler-conformance`, render-equivalence, and
    the 5 named gates (`diagnostic-coverage-matrix`, `compile-component`, `compiler-conformance`, `state-bindings`,
    `output-context-security` — 67 pass). `tsc -p tsconfig.json --noEmit` clean; `node scripts/api-surface-gate.mjs`
    exit 0 (baseline 1338 unchanged; new exports are `@internal`).
  - Unlocks: CAP10.

- [x] **FN10 · P1 · M/med — Decompose `analyze/query-updates.ts` into binding / derive-stamp / coverage modules behind stable fact facades.** ✅ done
  - Done: split the 832-line file into `analyze/query-bindings.ts` (data-bind collection +
    data-bind-list template-stamp offset math), `analyze/query-derives.ts` (`derive()`/`data-derive`
    stamps), `analyze/query-coverage.ts` (coverage expression-path + `statusCoveredPaths`/`planCoveredPaths`
    precedence helpers), and `analyze/query-internal.ts` (shared helpers incl. the hidden non-enumerable
    `outputContext`/`outputContexts` channel, moved verbatim — `Object.defineProperty(..,{enumerable:false})`).
    `query-updates.ts` (311 lines) keeps `collectQueryUpdatePlans`/`collectQueryUpdateCoverage` as composition
    entrypoints and re-exports `collectDataBindListStamps`; importers (`compile.ts`, `validate/bindings.ts`)
    unchanged. Functions moved verbatim, no logic edits.
  - Evidence: `tsc -p tsconfig.json --noEmit` clean; 7 cited suites 83 pass (query-coverage/query-update-plans/
    query-bindings/registry/compiler-conformance/render-equivalence-boundary/hmr-impact); `api-surface-gate.mjs`
    exit 0; fact-hash sanity check on a data-bind+derive+list+isomorphic fixture — plans `bb03a6fa`/coverage
    `6f7b3b2e` and full JSON bytes byte-identical pre- vs post-split.
  - Problem: `query-updates.ts` (832 lines) mixes five concerns — data-bind collection, data-bind-list
    template-stamp assembly with offset math, `derive()`/`data-derive` stamp collection, 9 nearly-parallel coverage
    push-loops with subtle `statusCoveredPaths`/`planCoveredPaths` precedence, and a hidden non-enumerable
    `outputContext` side-channel (`Object.defineProperty`). This is the file v2 derived optimism + live queries must extend.
  - Evidence: `analyze/query-updates.ts:49-142`, `:144-311`, `:685-780`, `:782-796`.
  - Approach: split into `analyze/query-bindings.ts`, `analyze/query-derives.ts`, `analyze/query-coverage.ts`,
    keeping `collectQueryUpdatePlans` / `collectQueryUpdateCoverage` as the thin composition entrypoints the rest of
    the compiler imports. **Do not** convert the non-enumerable `outputContext` channel to a plain field in this
    slice — it is load-bearing for byte/fact-hash stability (excluded from `JSON.stringify` and `factHash`); carve
    that into its own fact-hash-gated step.
  - Neutrality proof: internal-only restructuring; signatures + emitted `QueryUpdatePlanFact` /
    `QueryUpdateCoverageFact` bytes unchanged. Proven by `query-coverage.test.ts` + `registry.test.ts` +
    render-equivalence + a fact-hash snapshot.
  - Unlocks: CAP1, CAP2, CAP3.

- [x] **FN12 · P1 · M/low — Delete the legacy standalone structural lowerers; fold their tests onto `lowerStructuralJsx`.** ✅ done
  - Done: deleted `lower/inline-derives.ts`, `lower/primitive-spreads.ts`, `lower/view-transitions.ts` and the legacy
    halves of `navigation.ts` (`navigationLinkLowering`/`navigationHrefLowering` + their private helpers) and
    `platform.ts` (`platformBehaviorLowering` + its interface; dropped the now-unused `SourceReplacement` import so
    platform.ts leaves the boundary registry). Kept the production paths: `navigationStandaloneHrefLowering`,
    `staticHrefAttributeValue`, `buildStaticHref`, and the `platformElementSubstitution`/`platformAttributes` helpers
    `lowerStructuralJsx` uses. Pruned the legacy-fn unit tests (one in `view-transitions.test.ts`, three in
    `navigation-lowering.test.ts`) while keeping all `compileComponentModule`-based production-path coverage; updated
    the `structural-boundary.test.ts` guard list to `['navigationStandaloneHrefLowering','lowerStructuralJsx']` and the
    `structural-boundary.md` table to the two surviving rows. ~1200 lines of dead/duplicated logic removed total.
    Verified: `tsc` clean, structural-boundary + navigation-lowering + view-transitions + platform-lowering +
    conformance + render-equivalence (43 pass) — production output unchanged.
  - Problem: `inline-derives.ts` (623 lines), `primitive-spreads.ts`, `view-transitions.ts`, and the JSX-structural
    halves of `navigation.ts`/`platform.ts` are dead in production (zero non-test callers; explicitly marked
    legacy "do not add production call sites" in `structural-boundary.md`) but ~1200 lines of duplicate logic that
    has **already drifted** (structural-jsx has a clock `now` inputs branch `inline-derives.ts` lacks). 8 helpers are
    verbatim in both copies; every fix must be applied + verified twice, and legacy tests can pass while production differs.
  - Evidence: `lower/structural-boundary.md:34-40`; `lower/inline-derives.ts:297-312` vs `lower/structural-jsx.ts:1146-1162`.
  - Approach: migrate each legacy lowerer's unit tests to drive `lowerStructuralJsx` (or a thin wrapper around the
    corresponding sub-pass), then delete the standalone functions + now-duplicate private helpers. **Retain**
    `navigationStandaloneHrefLowering` (terminal, prod) and `staticHrefAttributeValue` (shared, `structural-jsx.ts:419`).
    Update `structural-boundary.md` to drop retired rows.
  - Neutrality proof: production already routes exclusively through `lowerStructuralJsx`, so deleting code with zero
    production callers cannot change emitted output. Gated by `render-equivalence-boundary.test.ts` +
    `compiler-conformance.test.ts` + migrated unit tests + `structural-boundary.test.ts`.
  - Unlocks: FN11, CAP3.

- [x] **FN11 · P1 · M/med — Consolidate derive emission into one helper owning the `(exportName, inputs, params, expression, sink, context)` contract.** ✅ done
  - Done: added `emitDerive(EmitDeriveOptions)` in `lower/structural-jsx.ts` (owns export-name allocation via
    `nextExportName`, the lone `export const X = derive(<inputs>, (<params>) => <expr>);` template, and the
    `StateDeriveFact`/`GeneratedOutputWriteFact` pushes). All production derive sites route through it:
    `lowerAttributeDerive`, `lowerPrimitiveIndeterminateProp`, `lowerPrimitiveReactiveAttribute`, `recordStateDerive`,
    `recordQueryTextDerive`. Callers pass already-formatted `inputs`/`params` strings + fully-built fact objects, so
    each site's load-bearing shape (`JSON.stringify`'d vs literal `["state"]` inputs; `: any` vs un-annotated params;
    per-site fact fields; shared-vs-distinct outputContext object identity) stays byte- and identity-neutral. There is
    now exactly one `= derive(` template and one `nextExportName` caller in the file.
  - Verified (byte-neutral): tsc clean; `vitest --run packages/compiler` 582/582 (61 files), incl.
    `render-equivalence-boundary` + `compiler-conformance` (byte-identical emitted module/stamp guards) +
    `structural-jsx-ir` + `state-bindings`/`state-events` + `stamps`; `node scripts/api-surface-gate.mjs` exit 0
    (baseline 1338 unchanged). Unlocks CAP1.

- [x] **FN13 · P2 · S/low — Make the platform substitution table data-driven and drop the string round-trip.** ✅ done
  - Done: dialog method matching became a `dialogActionByMethod` table (mirroring the popover one); `platformAttributes`
    (string) → `platformAttributeList` returning typed `{name, value}` pairs (values pre-escaped as before); `lowerStructuralJsx`
    builds `JsxIrAttribute`s directly, removing the `split(' ')/split('=')` round-trip. Verified: tsc + platform-lowering +
    conformance + render-equivalence + structural-jsx-ir (22 pass) — byte-identical emission.
  - Problem: `platformSubstitutionFor` is an if/else ladder hard-gated on `tag==='button'` with method names
    inline; `platformAttributes` builds attribute _strings_ that `structural-jsx.ts:441-443` then re-parses by naive
    `split(' ')`/`split('=')` — fragile if any value contained a space or `=`. Adding a substitution touches matcher
    - renderer + the fragile re-split.
  - Evidence: `lower/platform.ts:85-123`, `:147-157`; `lower/structural-jsx.ts:441-450`.
  - Approach: replace the ladder with a declarative table `{tag, method/action, kind, targetCheck,
attributes:[{name, valueFrom}]}` and have `lowerPlatformBehaviors` consume the structured attribute list directly
    (build `JsxIrAttribute` from typed fields), eliminating the round-trip.
  - Neutrality proof: removing the string re-parse is neutral today (all current values are `escapeAttribute` ids +
    fixed action keywords, space/equals-free). Covered by platform behavior unit tests + render-equivalence. (Only a
    `button` matcher exists today — the table should reflect that, not invent `summary`/`details` rows.)
  - Unlocks: — (standalone cleanup; removes a fragile attribute-string round-trip).

- [x] **FN14 · P2 · S/low — Collapse the graph file trio into one canonical module + two thin facades.** ✅ done (root rename)
  - Done: renamed `internal-graph.ts` → `app-graph.ts` (ending the `internal-graph` vs `internal/graph` confusion);
    `graph.ts` (public) + `internal/graph.ts` (internal) facades + all importers updated. Kept at the package root
    rather than `analyze/` ON PURPOSE: `app-graph.ts` still does a `createSourceFile`/`getText` reparse of a
    query-refresh expression, which is exactly the rule-9 debt FN7 must clean before it can live under the guarded
    `analyze/` zone (confirmed via the `postParseSourceStringProjectFact` guard — moving it under `analyze/`
    surfaced 7 violations). Verified: tsc + registry + conformance + render-equivalence.
  - Problem: `deriveAppGraph` et al. live in `internal-graph.ts` (632 lines, at package root, _outside_ `analyze/`),
    while `graph.ts` (public) and `internal/graph.ts` (internal) are 13-line facades. There is one
    `deriveAppGraph` implementation; the public/internal split is deliberate (rule 8) but the naming triple + root
    placement is confusing enough that the analysis prompt itself cited wrong paths.
  - Evidence: `graph.ts:1-13`, `internal/graph.ts:1-13`, `internal-graph.ts:44-71`, `internal.ts:21`.
  - Approach: move `internal-graph.ts` → `analyze/app-graph.ts` (co-located with `query-updates.ts`/
    `query-shapes.ts`). Keep `graph.ts` + `internal/graph.ts` as the only two facades, importing from
    `analyze/app-graph.js`. Update `internal.ts:21` + the other in-repo importers (`compile.ts`, `internal/graph.ts`).
  - Neutrality proof: pure file move + import-path rewrite; no exported symbol/signature/byte change. api-surface
    gate + tsc + render-equivalence + `registry.test.ts`. Lowest-leverage item — sequence last.

---

## Part 2 — Capability-unlocking work

Each item adds new accepted/emitted behavior (**not** neutral) and names its Part-1 prerequisites.

- [ ] **CAP1 · P1 — Unify the hand-written + derived optimism IR behind a typed compiler↔deriver channel, with editor-visible KV310.** (SPEC §10.4/§10.5/§10.6; `plans/data-layer-roadmap.md` v2)
  - Already implemented (do **not** re-build): the §10.5 derivation algebra ships in `@kovojs/drizzle` —
    `deriveOptimistic(effects, shape)` returns a `{kind:'derived', program}` JSON-patch program or `{kind:'punt',
reason}` (`drizzle/derive.ts:41`); `serializeDerivedOptimistic` emits the artifact (`drizzle/derive-codegen.ts`);
    it runs via the `kovo compile drizzle-optimistic <input.json> --out <artifact.ts>` CLI target
    (`cli/index.ts:2014-2064`, `commands-manifest.ts:226`) with `derived`/`punt`(reason)/`await-fragment` statuses;
    the commuting-diagram property suite exists (`drizzle/derive.test.ts:8`). This item closes the **integration**
    gaps, not the algebra. (The `data-layer-roadmap.md` v2 checkbox reads open because that stage _bundles_ derived
    optimism with live queries + a CDC adapter — coarser than the code; the deriver sub-part is largely built.)
  - Summary: (a) collapse the two transform representations into the single shared IR SPEC §10.4 already promises —
    today the compiler's optimism path carries **hand-written** transforms as raw source strings
    (`optimistic-inline.ts:144` `property.getText`) while the deriver produces a structured JSON-patch `program`
    (`cli/index.ts:2052`), so generated/hand-written are _not_ yet pairwise-interchangeable as §10.4 requires;
    (b) replace the generated-JSON-file seam (`*.optimistic.json` → `kovo compile drizzle-optimistic`) between the
    per-component compiler and the deriver with a typed in-process channel — `compileComponentModule` already knows the
    query shapes, invalidation sets, and binding positions the deriver needs but feeds them only through generated
    artifacts (the compiler never imports the deriver or `@kovojs/core/derivation.ts`); (c) make KV310 exhaustiveness
    the **editor-visible type error** §10.6 specifies (off the `InvalidationSets` registry), not only the
    `kovo check`/CLI surface.
  - Blocked by: two disjoint IRs (`InlineOptimisticTransformFact` source strings vs. the deriver's `program`); the
    integration runs through generated JSON, not a typed contract; the compiler is strictly per-file (`types.ts:15`),
    so the typed channel must thread write-effect facts + query shapes in (it cannot recompute them whole-program).
  - Design guardrail: optimism is **query-keyed, never island-keyed** (§10.4) and derived transforms are emitted as
    **separate `generated/optimistic/*.ts` modules by design** (§5.1) — do NOT inline transforms into the
    per-component server/client modules. The runtime link is value-driven (transform mutates the shared query value →
    each consuming island's update plan reruns); the compile artifacts stay separate.
  - Prereqs: FN2 (shared serializer, same hoist discipline) + a **shared derivation-IR hoist** into `@kovojs/core`
    (extend the existing `core/derivation.ts`) that both `@kovojs/compiler` and `@kovojs/drizzle` import; FN10 (the
    coverage module is where the KV310 status belongs); FN7 (typed query-binding/shape facts feed the channel).
    Lighter on FN5 than originally claimed.
  - Payoff: removes the §10.4 IR-duplication hazard so hand-written transforms can override generated ones pair by
    pair; turns KV310 into an editor error instead of a CLI-only check; replaces a brittle generated-file handoff with
    a typed contract.

- [x] **CAP6 · P0 — Drift-proof render-plan token + cross-package ABI contract test.** ✅ done (contract test; remote-cache seam deferred)
  - Done: `render-plan-token-contract.test.ts` locks `computeCompilerRenderPlanFingerprint` to the shared
    `@kovojs/core` source `@kovojs/server` also re-exports (FN1), with order-insensitivity, KV416 monotonicity,
    determinism, and the pinned grammar constant. Remote/distributed `CompileCacheBackend` seam remains future work.
  - Summary: a build-failing cross-package conformance test that the compiler-produced render-plan token and the
    server-validated token agree; plus the seam for a distributed/remote content-addressed build cache.
  - Blocked by: grammar version + fingerprint fn are duplicated literals in two packages (`compile.ts:873`/`:890`;
    `client-modules.ts:14`/`:32`) with no shared definition and no cross-package equality test. Separately, the
    persistent cache read is hardwired to local-fs exact-key reads with hit semantics that diverge from the in-memory
    footprint-aware cache; no `CompileCacheBackend` interface exists.
  - Prereqs: FN1, FN6.
  - Sketch: with FN1's single core token home, add one cross-package conformance test asserting compiler == server
    token over a corpus (closes the silent stale-DOM-patch class). For remote cache: define
    `CompileCacheBackend {read(key, footprintCtx), write(key, footprint, result)}` and adapt both caches. Near-free
    unlock: the persistent cache already writes footprint to disk (`persistent-compile-cache.ts:112`) but never reads
    it — add a footprint-narrowed read path for in-memory/persistent hit parity.
  - Payoff: eliminates a high-severity silent-correctness class (deploy skew); enables cross-machine cache reuse
    keyed by `compilerBuildId` + content footprint for cold CI/fresh checkouts.

- [ ] **CAP2 · P1 — `<kovo-live>` live queries over SSE as a real authoring element.** (SPEC §9.3; `plans/data-layer-roadmap.md` v2)
  - Summary: a real `<kovo-live query=…>` element that subscribes to the identical `<kovo-query>`/`<kovo-fragment>`
    chunks, with guard-recheck-per-push and instance-key routing proven at compile time, layered additively over the
    existing wire vocabulary.
  - Blocked by: no compiler handling of a `<kovo-live>` element — the only `kovo-live` tokens are emit-side attribute
    names (`emit/server.ts:586`). Live targets are _inferred_ from server-refresh targets
    (`componentHasInferredServerRefreshTarget`, `scan/parse.ts:545` → `findLiveTargetFacts`, `internal-graph.ts:132`),
    not parsed from an authored element. `QueryUpdateCoverageFact.status` (`types.ts:625`) has no `'live'` member, so
    liveness cannot even be expressed in the coverage model.
  - Prereqs: FN5, FN10, FN7.
  - Sketch: add `<kovo-live>` to `scan/parse` modeling + a new structural lowering pass (FN5) + a `'live'` coverage
    status in FN10's module + a live-target fact + registry entry. Instance-key routing reuses the typed
    query-binding facts surfaced by FN7.
  - Payoff: real-time UI as an additive SSE transport over the existing query/fragment vocabulary; closes the gap
    between the roadmap promise and today's inference-only liveness.

- [ ] **CAP3 · P1 — Lists at scale: cursor pagination + keyed `mode='append'` fragment appends + keyed reorder.** (`plans/open-design-areas.md` §13.2; SPEC §9.1.1/§13.2)
  - Summary: cursor pagination via URL params, infinite-scroll as keyed `mode='append'` fragment appends, and keyed
    reorder sound under simultaneous optimism + morph, with O(changes) reconciliation instead of whole-list re-render.
  - Blocked by: `mode='append'` appears nowhere in compiler production code. `QueryTemplateStampFact`
    (`types.ts:587-606`) + `emitTemplateStampPlan` (`emit/client.ts:293-303`) emit a `render(item)` that
    `join('')`s the whole per-item template — insert-time interpolation only, no key/move/upsert/remove operation.
    `templateItemBindingPlaceholders` (`query-updates.ts:739-780`) computes offsets for interpolation, not keyed diff/move.
  - Prereqs: FN10, FN5, FN12.
  - Sketch: extract the template-stamp module from `query-updates.ts` (FN10) to make room for a keyed-diff plan; add
    a keyed-append lowering pass (FN5); extend `QueryTemplateStampFact` with move/keyed-upsert/remove operations and
    teach `applyCompiledQueryUpdatePlan` to apply them.
  - Payoff: large collections become first-class while keeping keyed deep-merge (§9.1.1) and `kovo-key` identity
    (§13.2) sound; avoids content-proportional whole-list fragment waste.

- [ ] **CAP7 · P1 — Incremental / partial recompilation keyed by per-pass fact fingerprints.** (SPEC §5.2.1 incremental cache; §9.5.1 fact-based HMR ladder)
  - Summary: sub-file incremental recompile (re-run only passes whose actually-read facts changed) and faster
    watch/HMR, extending the dependency-footprint inverse-index from cross-module to intra-component.
  - Blocked by: every compile re-parses 4–7 times and runs all passes start-to-finish; the only incrementality is
    whole-result caching keyed by source hash (`compile-cache.ts:181`). Passes have no individual identity (inline
    sequence) and the 11 independent `createSourceFile` sites defeat a single shared program; the model is flat
    arrays with no span index, and span-equality joins (`parse.ts:519`/`:568`) break silently if an incremental
    re-extraction shifts a span.
  - Prereqs: FN5, FN7.
  - Sketch: with FN5 each pass is an addressable, individually cacheable unit and FN7 gives one canonical program
    model. Add a parse memo (identical source strings reuse one `ts.SourceFile`) and a span→fact index (build it
    _before_ incrementalizing, or replace the fragile span-equality joins first). Extend the existing
    `CompileDependencyFootprint` inverse-index (`types.ts:135-152`) from cross-module to per-pass. `fact-hash.ts` /
    `cache-identity.ts` supply the fingerprint primitives.
  - Payoff: sub-linear rebuild on edits; lower watch-mode latency; faster CI on large component trees.

- [x] **CAP9 · P1 — Output-context soundness gate (every policed sink maps to an escaped emitter context).** ✅ done
  - Done: `output-context-soundness.test.ts` asserts the rule-10 lockstep FN8 unified — emit
    (`outputContextForAttribute`) returns `url-attribute` exactly when the KV236 validator's `isUrlAttribute`
    predicate gates it (across URL/plain/boolean attrs, case-insensitively), plus a compile-based check that a
    dynamic `href` emits a `url-attribute` `GeneratedOutputWriteFact` for the gated sink. (Cross-package escaper
    unification — the `@kovojs/browser` table — remains future work.)
  - Summary: a build-failing cross-check that every sink the KV236 validator forbids/permits corresponds to an
    emitter context that actually escapes it, closing the rule-10 lockstep gap structurally.
  - Blocked by: validation and emit classify sinks with separate duplicated tables (`security/output-context.ts:345`
    vs `output-context-facts.ts:63`) sharing no vocabulary, so there is no shared term to assert correspondence
    against. (Related but distinct: the three escapers across compiler/server/browser diverge on which chars they
    touch — `html.ts` escapes `&<>`, `security-output.ts` escapes `&<>"` — not a current bug for text children but
    blocks a future byte-exact client/delta gate.)
  - Prereqs: FN8.
  - Sketch: with FN8's single sink taxonomy, add a conformance test over `GeneratedOutputWriteFacts` asserting each
    emitted sink's context maps to an escape decision the KV236 validator agrees with. Separately, unify the three
    escapers behind one normative table + a cross-package agreement fixture (this part re-baselines emitted bytes —
    gate with golden artifacts, not purely neutral).
  - Payoff: turns an invisible rule-10 convention into a structural guarantee; prerequisite for the prod delta path
    (KV416 delta-equivalence half) which re-renders text client-side.

- [ ] **CAP8 · P2 — Fact-driven incremental dev rebuilds with bounded cache size.** (SPEC §9.5 HMR; §5.2 incremental cache)
  - Summary: wire the existing (currently dead) fact-invalidation engine into Vite `handleHotUpdate` so only modules
    whose actually-read facts changed recompile, and call `prunePersistentCompileCache` with a max-entries policy so
    the on-disk cache stops growing unbounded.
  - Blocked by: `invalidateFacts` / `registryFactChanges` / `#inverseIndex` and `prunePersistentCompileCache` are
    built + tested but have zero production callers (FN3); `vite handleHotUpdate` (`vite.ts:283`) never invalidates by
    fact and never prunes; `.kovo/cache/compiler` grows unbounded.
  - Prereqs: FN3 (the **wire** branch — mutually exclusive with deletion), FN5.
  - Sketch: connect `invalidateFacts` into `handleHotUpdate` when a registry/graph fact changes across a rebuild, and
    call `prunePersistentCompileCache(maxEntries)` after writes. Gate with new watch-mode correctness tests — this is
    **not** neutral (it changes _when_ recompiles happen).
  - Payoff: faster, correct incremental dev/watch builds with a stable cache footprint.

- [ ] **CAP10 · P2 — Machine-readable diagnostics + richer `kovo explain` decision graph.** (SPEC §5.2 rule 5; §5.3/§11.3/§11.4; `plans/devtools.md`)
  - Summary: diagnostics carry typed detail fields (not pre-concatenated English) and every lowering decision
    (extracted handlers, derives, platform substitutions, attribute merges, punts) is emitted as structured
    per-decision provenance an agent/IDE can consume.
  - Blocked by: detail is injected by raw string concat at ~37 sites (`markup.ts:352`,
    `security/output-context.ts:437`) and the emitted `CompilerDiagnostic` has no structured-detail field, so the
    structured `detailLabels` registry (`core/diagnostics.ts:67`) is bypassed. Decisions are scattered across
    hand-rolled passes that emit only final patches/facts (provenance is rich only inside `jsx-ir.ts`, confined to
    the structural pass — `emit/server.ts` does already emit `ServerRenderStampWriteFact`, so this is incremental, not total-absence).
  - Prereqs: FN9, FN5.
  - Sketch: FN9's teaching-diagnostic builder becomes the single construction path keyed on `detailLabels` (preserve
    per-site help overrides like `markup.ts:92-97`). FN5's pass registry lets each pass emit a stable typed decision
    record; generalize `jsx-ir` provenance + terminal-phase typed facts uniformly to backfill exact `SourceAnchor`
    spans the devtool needs.
  - Payoff: agents/IDEs consume diagnostics + lowering reasoning as a queryable graph (auto-repair, rich rendering);
    serves the agent-first "one graph, two renderers" thesis.

---

## Sequencing

- **Wave 0 — silent-correctness + dead weight (do first; independent, low-risk, high-leverage; parallelizable):**
  FN1 (token → core, removes ABI drift hazard), FN8 (unify output-context taxonomy, removes rule-10 desync hazard),
  FN3 (delete dead invalidation+prune, also stops the per-compile index-write cost), FN2 (canonicalJson dedupe).
- **Wave 1 — shrink the orchestrator + isolate units (prepares the pass framework; parallelizable by module ownership):**
  FN4 (relocate `removeUnreferencedNamedImports`; must precede FN5), FN6 (split `emit/server.ts` behind barrel),
  FN12 (delete legacy structural lowerers), FN14 (collapse graph trio).
- **Wave 2 — the keystone:** FN5 (declarative pass list + `ResultBuilder`). Do the `ResultBuilder` sub-step first
  (lower risk), then the pass-list driver encoding today's exact order + the two reparse boundaries. Single unlock for
  CAP3/CAP7/CAP8 (and feeds CAP1's derived-optimism pass). Gate with the golden corpus + render-equivalence + a fact-hash snapshot — **not
  fixpoint**. Run in the **main worktree** (centrality + reparse-coupling risk), not delegated.
- **Wave 3 — clean the typed-fact boundary + data-plane analysis (can overlap Wave 2 tail):** FN7 (do the guard-widening
  Step 1 early/cheap; Step 2 fact extraction is larger and needs fact-level golden tests), FN10 (decompose
  `query-updates.ts`), FN9 (`DiagnosticFactory`). FN12 → FN11 (do `emitDerive` after legacy deletion). FN13 is
  independent P2 cleanup.
- **Wave 4 — capability payload (gated on the substrate):** data-plane spine first — hoist the shared derivation IR
  into `@kovojs/core`, then CAP1 (unify the optimism IR + typed compiler↔deriver channel + editor-visible KV310),
  then CAP2 + CAP3 (share FN10/FN7). CAP6 can land as soon as FN1+FN6 are done. CAP9 follows FN8. CAP7/CAP8
  (incremental compile) and CAP10 (explain graph) come later, once the pass framework has proven stable in production.

**Cross-cutting gate discipline:** for every Part-1 item run the golden-output corpus + render-equivalence +
conformance as the primary neutrality oracle; add a fact-hash snapshot for anything touching
query-updates/internal-graph/HMR facts; add a cache-key snapshot for anything touching footprint/slicing; add
fact-level golden tests for FN7 Step 2. Never rely on `assertFixpoint` to prove an authored-source pass refactor neutral.

## Open questions

- **Cache story (FN3 vs CAP8):** delete the fact-invalidation engine outright, or commit to wiring fact-driven
  incremental dev now? Decide before Wave 0 so FN3 takes the right branch.
- **Shared derivation IR home (CAP1):** `@kovojs/core/derivation.ts` already exists for part of it — confirm it can
  host the full `InlineOptimistic*Fact` contract that both `@kovojs/compiler` and `@kovojs/drizzle` import without
  creating a dependency cycle.
- **FN7 fact-truncation bugs:** the naive `[^,}]+` cadence capture (`internal-graph.ts:206-210`) is a latent bug;
  the neutral move must preserve it byte-for-byte, then a _separate_ tracked fix corrects it. Worth its own ledger item.
- **Pass-framework scope (FN5):** ship just the linear pass list + `ResultBuilder`, or also a declared per-pass
  read-set (needed by CAP7) in the same slice? Leaning: linear first, read-sets when CAP7 starts.

## Verification provenance

File:line citations above were spot-checked this session via grep against `packages/compiler/src` and
`packages/server/src` on `main`. Confirmed: the render-plan grammar constant is byte-duplicated across
`compile.ts:873` and `client-modules.ts:14` (FN1); four canonical-JSON serializer copies under two names (FN2);
`invalidateFacts`/`registryFactChanges`/`prunePersistentCompileCache` have no production callers (FN3);
`structuralJsxPhaseOrder` is read only by a snapshot test, never the orchestrator (FN5); 11 `createSourceFile`
sites live outside `scan/` and the rule-9 guard scope is `(lower|validate|analyze|emit)/` only (FN7); `URL_ATTRIBUTES`
is duplicated emit-side vs validation-side with `BOOLEAN_ATTRIBUTES` emit-only (FN8). The architecture map was produced
by an 8-subsystem reader + adversarial-verifier fan-out; verifiers refuted/re-scoped several candidates (folding
`emit/server.ts` into the JSX tree — fights the documented `structural-boundary.md` design line; "merge the two
fact-slicers" — they are a complementary producer/narrower pair; "merge the two model-patch passes" — high-risk, style
extraction reads structural output), which is why those do not appear above.
