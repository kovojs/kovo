# Compiler Better Audit

Status: active audit report and remediation roadmap.
Date: 2026-06-25.

This report audits the compiler as a load-bearing security boundary for `SPEC.md`, especially
sections 1.3, 2, 5.2, 5.2.1, 5.2.2, 6.6, 10, and 11. It is not an implementation branch. The
main worktree scope for this session was limited to this plan file.

## Verdict

The compiler has strong foundations: typed scanner models, a centralized validation pipeline,
fixpoint/render-equivalence checks, output-context diagnostics, source-reparse boundary tests,
generated-artifact tests, Vite integration tests, and a broad compiler diagnostic corpus. It is
not yet at the bar implied by "world-class compiler" or "primary security guarantee boundary."

The main gap is not raw effort; the code already contains a large amount of thoughtful work. The
gap is that several security guarantees still depend on optional facts, caller-supplied provenance,
server-side constructors, or diagnostics that are not proven to block artifact output. Adversarial
probes also found concrete output-context bypasses where unsafe author input is emitted without a
diagnostic. A compiler carrying this much security weight needs fail-closed contracts at every
phase boundary, exhaustive negative tests for known sink families, and build/runtime wiring tests
that execute generated artifacts rather than only inspecting source text.

## Evidence Gathered

- Main worktree inspection covered `SPEC.md`, `rules/compiler-hard-rules.md`, `packages/compiler/src`,
  `packages/server/src`, `packages/core/src/diagnostics.ts`, and the active compiler plans.
- Main worktree verification: `pnpm exec vitest --run packages/compiler/src/vite.test.ts` passed
  1 file / 18 tests.
- Adversarial worktree: `/Users/mini/kovo-agent-compiler-adversarial`, branch
  `agent/compiler-adversarial-audit`, base `22a275a968908be9fb6b27448250be85ca5f546c`.
- Adversarial verification: `pnpm exec vitest --run packages/compiler/src/adversarial-probe.test.ts --reporter verbose`
  passed and logged 17 probes from an untracked scratch test in that worktree.
- Adversarial focused suite: `pnpm exec vitest --run packages/compiler/src/output-context-security.test.ts packages/compiler/src/server-emit-security.test.ts packages/compiler/src/client-secret-capture.test.ts packages/compiler/src/id-content-model.test.ts --reporter verbose`
  passed 50 tests in the adversarial worktree.
- Parallel audit slices inspected security invariants, architecture/maintainability, diagnostics
  and tests, generated output/runtime ABI boundaries, and adversarial behavior.

Full acceptance gates were not run because this was a report-only audit and no production code was
changed.

## Strengths To Preserve

- `compileComponentModule` is deliberately surrounded by fixpoint and render-equivalence helpers
  tied to `SPEC.md` section 5.2.
- `validateOutputContexts` is a real default-on output-safety pass, and existing tests cover many
  URL, style, raw HTML, rawtext, and spread cases.
- Source reparsing is fenced by `packages/compiler/src/source-reparse-boundary.test.ts`; source
  parsing is centralized in `scan/`.
- The diagnostic coverage matrix gives many compiler-owned `KV2xx` and `KV3xx` diagnostics both
  positive and negative fixtures.
- The compiler computes render-plan fingerprints and folds them into component client hrefs.
- Client secret capture now fails closed for many value-position import captures and omits unsafe
  imports from emitted client modules.
- Server module serving has immutable cache headers and same-origin CORP on production registry
  responses.

## Priority Findings

### Critical: output-context bypasses still emit unsafe HTML

`packages/compiler/src/security/output-context.ts` validates many sinks, but adversarial probes
found bypasses that produced emitted server source with no diagnostics:

- Non-inline object spread: `const props = { href: 'javascript:alert(1)' }; <a {...props}>`.
- Computed spread with unsafe URL fields.
- Direct lowercase event attributes such as `<button onclick="alert(1)">`.
- Direct `srcdoc="<script>alert(1)</script>"`.

The current code validates direct URL attributes, dynamic `data-bind:on*`, dynamic `srcdoc`, and
literal entries of inline object spreads, but it does not close these authored forms as a single
sink inventory. This conflicts with `SPEC.md` section 5.2 rule 10 and section 4.8's output-context
posture.

### Critical: malformed TSX can compile without a syntax diagnostic

`parseSourceFile` calls `ts.createSourceFile` and the scan model proceeds without surfacing
`parseDiagnostics`. The adversarial probe for malformed JSX (`<div><span></div>`) emitted files
with no diagnostic. A security compiler should refuse syntactically malformed author input before
lowering or emission.

### Critical: route/page access posture is not compiler-derived

`RoutePageFact` carries `css`, `components`, `fileName`, `layouts`, `navigationSegments`,
`regions`, and `route`, but no guard/access posture. `derivedPageFactsFromRoutePages` maps route
page facts into explain graph pages with route, queries, layouts, and navigation segments only.
Server-side `accessFactsFromApp` can derive runtime app access facts, but the JSX route compiler
does not make page access a mandatory compiler fact. That leaves `KV436`-style default-deny posture
dependent on graph inputs outside the route compiler.

### Critical: render-plan token is optional at the server registry boundary

`compileComponentModule` computes a render-plan fingerprint and includes it in component client
href versions. The server registry can fold `renderPlanFingerprint` into `buildToken()`, but only
if it is supplied or later set. `createKovoAppShellBuild` registers compiled client modules without
threading a compiler render-plan fingerprint into the registry. `SPEC.md` section 5.2.1 says the
token is mandatory and must move on query shape or grammar changes, not merely on client module
bytes.

### High: query-shape facts can silently disappear or fail open

`queryShapesFromFacts` indexes by query name with first-writer-wins behavior. Conflicting facts for
the same query should be a diagnostic before render-plan token generation, registry emission, or
confidentiality checks. Separately, `validateSecretQueryWire` returns no diagnostics when no query
shape facts are present, so a missing fact producer can turn a `KV435` confidentiality check into a
no-op.

### High: security diagnostics are not all proven build-blocking

The compiler diagnostic matrix type only includes `KV2xx` and `KV3xx`, leaving security-heavy
`KV4xx` diagnostics outside the same positive/negative matrix discipline. Existing tests often
prove a diagnostic appears, but not that an `error` diagnostic blocks Vite/build output or prevents
serving emitted modules.

### High: client publish escape facts are produced but not exposed end to end

`analyzeClientCaptures` produces `PublishToClientFact` values and comments say they must be
threaded into graph capabilities for `kovo explain --capabilities`. `CompileResult` does not expose
those facts today. The escape also needs a non-empty, reviewable reason.

### High: file-name derived output paths need confinement

The adversarial worktree showed `fileName: '../outside/evil.tsx'` leading to emitted artifact names
and handler URLs containing `../outside/evil`. Normal callers probably pass trusted normalized
paths, but a load-bearing compiler should normalize or reject traversal-shaped file names before
deriving emitted paths or URLs.

### Medium: duplicate static IDs in repeated JSX are not fully modeled

The adversarial probe found a static `id="row"` inside `.map()` with no diagnostic, while duplicate
IDs in simpler conditional branches are detected. This is both an accessibility issue and a
selector/event-targeting correctness issue for generated UI.

### Medium: compiler phase contracts are too implicit for the security bar

`compileComponentModule` still orchestrates parsing, lowering, validation, client/server emission,
registry facts, CSS, HMR metadata, render-plan fingerprints, and fixpoint facts in one long public
entry point. `LOWERING_PASSES` is useful, but pass dependencies are enforced by `!` assertions
rather than typed pre/postconditions. Validators manually choose original/lowered/mapped diagnostic
frames, and source replacement failures throw generic `Error` messages without writer/phase
provenance.

### Medium: ABI and determinism logic is duplicated across compiler/server boundaries

Client module URL/version semantics exist in compiler lowering, compiler Vite dev serving, and
server registry serving. Dev serving returns only a JavaScript content type, while production
registry responses add immutable caching and CORP. Bootstrap import aliases use a 32-bit FNV hash
described as "collision-resistant-enough." URL scheme policy also exists in compiler output-context
logic rather than being fully shared with core security URL helpers.

### Medium: persistent cache footprint metadata is not useful across restarts

The in-memory compile cache learns dependency footprints and can narrow cache keys, but Vite
persistent cache reads and writes under the initial broad key. Across process restarts, the stored
footprint is not used to read by the narrowed key. This is mostly a maintainability/performance
issue, but stale or confusing cache behavior increases risk in a security compiler.

### Medium: `KV330` is still lint despite being part of data-plane soundness

`KV330` flags direct DB access in mutation handlers as lint, while `SPEC.md` sections 10 and 11
make domain write provenance central to invalidation and verifier soundness. Either the lint
severity needs a rigorous residual-risk justification, or direct DB access must become a blocking
diagnostic in compiler/check gates that claim data-plane security.

## Remediation Roadmap

### Phase 0: close concrete fail-open behavior

- [x] Add adversarial regression tests for every output-context bypass observed in this audit and
      make them emit `KV236` or a stricter sink-specific diagnostic.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/output-context-security.test.ts`
    passes with KV236 coverage for non-inline unsafe spreads, computed-key unsafe spreads, direct
    lowercase `onclick`, and direct `srcdoc`.
- [x] Replace the current partial sink inventory with a single closed inventory for direct attrs,
      inline spreads, non-inline spreads that can be statically resolved, derived attrs, and dynamic
      bindings.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/output-context-security.test.ts` and
    `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts` pass after scanner facts
    expanded statically resolvable spreads and output-context validation reused the same sink checks
    for direct attributes and spread entries.
- [ ] Surface TypeScript/TSX parse diagnostics before lowering and block emission for malformed
      author input.
  - Evidence: `parseSourceFile` calls `ts.createSourceFile`; the adversarial malformed JSX probe
    emitted files with no diagnostic.
- [ ] Normalize and confine compiler `fileName` before deriving artifact names, import paths, or
      `/c/` URLs.
  - Evidence: adversarial probe with `../outside/evil.tsx` produced traversal-shaped output names
    and URLs.
- [ ] Extend static ID analysis to repeated JSX containers such as `.map()` and other loop-like
      render patterns.
  - Evidence: adversarial probe found repeated `id="row"` inside `.map()` with no diagnostic.

### Phase 1: make security graph facts mandatory at compiler boundaries

- [ ] Thread route guard/access posture through `compileRouteModule`, `RoutePageFact`, route IR,
      and app graph derivation.
  - Evidence: `RoutePageFact` has no guard/access fields and `derivedPageFactsFromRoutePages` only
    emits route/query/layout/navigation facts.
- [ ] Define the compiler/server ownership line for raw `endpoint()` and `webhook()` metadata, then
      make missing or ambiguous metadata visible to `kovo check` as a blocking app graph diagnostic.
  - Evidence: endpoint constructors carry required metadata types, but the compiler audit did not
    find an equivalent compiler-owned graph extraction/gate for `KV423`.
- [ ] Make missing query-shape facts a fail-closed condition for components that declare queries in
      production/security-check modes.
  - Evidence: `validateSecretQueryWire` returns `[]` when `componentQueryShapes(options)` is absent.
- [ ] Reject duplicate or conflicting query-shape facts before registry emission, render-plan token
      input, or confidentiality checks.
  - Evidence: `queryShapesFromFacts` keeps the first fact for a query and ignores later facts.
- [ ] Expose `PublishToClientFact` from compilation and include it in graph capabilities/explain
      output with a non-empty reason.
  - Evidence: `validate/client-capture.ts` produces publish facts and documents the intended graph
    handoff, but `CompileResult` does not expose them.
- [ ] Decide whether `KV330` is blocking. If it remains lint, add a written soundness proof and an
      acceptance test showing data-plane security claims do not depend on it.
  - Evidence: core diagnostics define `KV330` as lint while its help text says direct DB access
    bypasses domain write analysis.

### Phase 2: harden render-plan and generated-output ABI

- [ ] Make the render-plan fingerprint mandatory across compiler, Vite build, static export, server
      registry, full-page documents, mutation deltas, full responses, and `/_q` responses.
  - Evidence: server `buildToken()` folds `renderPlanFingerprint` only if supplied; `createKovoAppShellBuild`
    registers modules without setting it.
- [ ] Add an end-to-end test where query shape or render-plan grammar changes while client module
      bytes remain identical, and prove all mandatory tokens/hrefs move.
  - Evidence: current server tests cover manual registry fingerprints, not compiler-to-server
    pipeline threading.
- [ ] Move client module URL/version encoding and decoding into one shared internal ABI helper used
      by compiler emit, Vite dev serving, and server registry serving.
  - Evidence: equivalent URL logic exists across compiler and server code paths today.
- [ ] Align Vite dev client-module responses with production registry safety headers, or document
      and test why dev is intentionally weaker.
  - Evidence: Vite dev middleware sets only `Content-Type`; production registry responses set
    immutable cache control, CORP, and content type.
- [ ] Replace bootstrap 32-bit FNV aliases with collision-checked deterministic aliases or a
      stronger digest.
  - Evidence: `emit/bootstrap.ts` calls the FNV suffix "collision-resistant-enough."
- [ ] Centralize unsafe URL scheme policy in the core security URL helper and import it from
      compiler output-context validation.
  - Evidence: compiler output-context logic has local URL-scheme checks while core already owns URL
    attribute helpers.

### Phase 3: make phase contracts typed and reviewable

- [ ] Split `compileComponentModule` into typed immutable phase results: parse, lower, validate,
      emit client, emit server, emit registry/CSS, and verify.
  - Evidence: the current entry point spans most compiler responsibilities and relies on shared
    local state across phases.
- [x] Replace lowering-pass `!` assertions with typed pass dependencies, declared outputs, and a
      startup/self-test that verifies pass graph ordering and required products.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/lowering-pipeline.test.ts` and
    `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts` pass after
    `LOWERING_PASSES` declared required/provided products and `runLoweringPipeline` removed its
    non-null assertions.
- [ ] Introduce a phase-owned source replacement accumulator that records writer, phase, original
      span, generated span, and conflict diagnostics.
  - Evidence: `applySourceReplacements` throws generic span errors with no writer or phase context.
- [ ] Replace the manual validator array with typed validator registration by coordinate frame:
      original, lowered, mapped, or graph.
  - Evidence: validators currently choose among `originalDiagnostics`, `loweredDiagnostics`, and
    `mappedDiagnostics` manually.
- [x] Make JSX IR tree construction linear or near-linear and add stress tests for large component
      trees.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/jsx-ir.test.ts` and
    `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts` pass after
    `createJsxIrTree` switched parent assignment to a stack-based pass with a deep-tree regression
    test.
- [ ] Either make persistent compile-cache reads footprint-aware across process restarts or remove
      the misleading persisted footprint field.
  - Evidence: Vite writes persistent entries under the broad key even when the result has a learned
    dependency footprint.
- [ ] Tighten `sourceProvenance` so only trusted compiler-generated artifacts can suppress
      app-authoring-surface diagnostics.
  - Evidence: `validateAuthoringSurface` skips checks whenever callers pass
    `sourceProvenance: 'compiler-emitted'`.

### Phase 4: raise verification to the same level as the threat model

- [ ] Extend the diagnostic coverage matrix to security-heavy `KV4xx` compiler/check diagnostics,
      especially `KV421`, `KV423`, `KV424`-`KV438`.
  - Evidence: the matrix row type is restricted to `KV2xx` and `KV3xx`.
- [ ] Add build-blocking tests that prove `error` diagnostics prevent Vite/build output and prevent
      serving emitted modules, while lint/notice diagnostics stay non-blocking where intended.
  - Evidence: many current tests assert diagnostic presence but not artifact refusal.
- [ ] Convert high-risk substring tests into generated-artifact execution tests for server HTML,
      client module behavior, mutation delta behavior, and `/_q` response behavior.
  - Evidence: existing security tests often inspect emitted source text instead of executing the
    generated artifact boundary.
- [ ] Add TSX-authored integration coverage for XSS and output-context cases, not only hand-authored
      lowered IR or runtime fixtures.
  - Evidence: some integration coverage proves runtime escaping but not TSX compiler emission.
- [ ] Add real Vite/CLI diagnostic formatting snapshots for `KV236`, `KV235`, `KV437`, and `KV438`,
      including line/column stability across lowering and reparsing.
  - Evidence: diagnostic coordinate frames are centralized but selected manually by validators.
- [ ] Expand `spec-coverage-map` to explicitly cover `SPEC.md` sections 5.2.1, 5.2.2, 6.6, 10, and
      11 for compiler-owned security guarantees.
  - Evidence: the current compiler coverage map is useful but does not make all high-stakes clauses
    first-class coverage targets.

## Acceptance Bar

Do not claim this remediation complete until all of the following are true:

- [ ] Every Phase 0 adversarial case has a checked-in regression test and a blocking diagnostic or
      fail-closed compile error.
- [ ] A shape-only render-plan change moves the compiler href, document token, mutation response
      token, full response token, and query response token in an end-to-end test.
- [ ] Missing/conflicting query-shape facts cannot silently suppress `KV435` or produce stale
      render-plan tokens in production/check modes.
- [ ] Route, query, mutation, endpoint, and webhook access posture all appear in one app graph
      explain/check path with default-deny behavior proven by tests.
- [ ] `publishToClient` escapes are visible in explain output and require a non-empty reason.
- [ ] All compiler-owned `error` diagnostics in the security set are proven to block output.
- [ ] The compiler phase graph is documented in types, and no phase can read a product that an
      earlier phase has not declared.
- [ ] Full repo gates relevant to compiler/security pass, including the focused compiler suite,
      Vite/build tests, `kovo check` tests, and generated-artifact integration tests.
