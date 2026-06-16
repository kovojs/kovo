# Compiler Quality Assessment

Created 2026-06-15. This is a read-only assessment of `@kovojs/compiler`, not an implementation
ledger. `SPEC.md` remains the behavioral source of truth; this document evaluates the current
compiler against that bar and against mature web-framework compiler practice in Angular, Vue, Svelte,
Next/React Server Components, and similar systems.

## Executive Verdict

The compiler is promising and materially more principled than a typical prototype: it has a compact
parse -> lower -> validate -> emit pipeline, stable named artifacts, a diagnostic registry, green
compiler-local tests, and several SPEC-backed safety checks. It is not yet world-class. The gap is not
intent or architecture; it is maturity: semantic verification is still source-normalization based,
some transforms are patch-oriented rather than AST-emission oriented, performance budgets are not
systematically measured, and the security model is partly defensive patches rather than a uniform
escaping/taint discipline.

Current maturity rating: **strong early compiler / pre-world-class**.

| Dimension         | Rating | World-class comparison                                                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Understandability | **B**  | Easier to read than Angular/Vue internals because it is small and artifact-oriented, but less rigorously layered than their compiler cores. |
| Performance       | **C+** | Likely fine for small projects; lacks the incremental, benchmarked, cache-aware machinery expected from Angular/Vue/Svelte-class compilers. |
| Maintainability   | **B-** | Good tests and modular files, but source-patch transforms and permissive fallback paths increase long-term regression risk.                 |
| Security          | **B-** | Strong security ambition and some concrete XSS fixes, but not yet a uniform, mechanically enforced security contract.                       |

## Evidence Inspected

- `SPEC.md` §3 and §5.2 define the compiler posture: legible artifacts, authorable IR/fixpoint,
  source-derived names, render equivalence, teaching diagnostics, TSX-only app authoring, and the
  post-parse typed-facts rule.
- `packages/compiler/src/compile.ts` is the orchestration point. It parses once, runs lowerers
  (`primitive-spreads`, view transitions, platform lowering, navigation, inline derives), reparses
  the patched model, validates, emits server/client/CSS/registry artifacts, versions client refs, and
  records update coverage.
- `packages/compiler/src/lower/attribute-merge.ts` and `lower/primitive-spreads.ts` show that SPEC
  §4.6 primitive composition is no longer just a gallery oracle; the real compiler has a merge engine
  and an attrs/asChild lowering path.
- `packages/compiler/src/lower/handlers.ts`, `validate/component-contracts.ts`,
  `validate/bindings.ts`, and `analyze/query-updates.ts` show several earlier heuristic gates have
  moved to typed parser facts.
- Verification run for this assessment:
  `pnpm --filter @kovojs/compiler exec vitest run` -> **25 files / 258 tests passed**.
- Verification run for this assessment:
  `pnpm --filter @kovojs/compiler exec tsc --noEmit` -> **passed**.

## Quantitative Conformance Bar

A Kovo compiler quality claim is "world-class" only when this compact bar is met against the decided
corpus: the reference app, the commerce app, and focused generated fixtures.

| Area | Minimum bar |
| ---- | ----------- |
| Diagnostic coverage | Every compiler-owned KV2xx/KV3xx diagnostic has a positive fixture, a negative fixture, and a stable text snapshot covering code, severity, message, help/fix menu, and source surface. KV201/KV230 compatibility snapshots are included with this cleanup because they guard the capture-channel contract in SPEC §4.3 and §4.5. |
| SPEC clause coverage | Every falsifiable compiler promise in SPEC §4.3, §4.6, §4.8, §4.9, §5.2, §6.1.1, §6.4, and §11.3/§11.4 has at least one corpus fixture that proves the accepted path and one that proves the diagnostic or check path. Clause-only design decisions remain recorded as decisions, not test coverage. |
| Browser matrix | Browser tests are limited to behavior that cannot be proven browser-free and must run on Chromium, Firefox, and WebKit in CI; bulky screenshots/traces stay generated artifacts, not checked-in fixtures. |
| Performance posture | Performance gates remain deliberately deferred by D3. Until D3 is reopened, compiler performance evidence is descriptive only: full compiler tests, type-checking, and any local timing notes do not constitute a blocking budget. |
| Security payload matrix | Security fixtures must cover text, title/ARIA attributes, `href`/route URLs, style/CSS values, template stamps, fragment targets, and raw/trusted-HTML escape hatches, with server-render and client-update agreement where both paths exist. |

## Understandability

Strengths:

- The main control flow is clear. `compileComponentModule()` is readable end-to-end: parse,
  package-prefix discovery, first-pass lowerers, model patch/reparse, handler lowering, coverage,
  validation, emit, and verification metadata.
- File ownership is mostly coherent. `lower/**`, `validate/**`, `analyze/**`, `emit/**`, and
  `scan/**` map well to SPEC §5.1.
- Artifacts are intentionally readable: generated client modules expose named handler/derive exports,
  registry types are emitted as stable source, and client URLs include source-derived names plus a
  short version.
- Many comments cite SPEC clauses or security findings where ambiguity would matter. This is useful
  in a framework whose core promise is auditability.

Weaknesses:

- The compiler is still patch-first. Most lowering is `SourceReplacement` over spans followed by a
  reparse. That is understandable at 17k LOC, but mature compilers usually have a typed IR builder
  and printer for transformations that change structure. Patch-order interactions are harder to
  reason about as features grow.
- Parser model types are broad bags of facts. `ComponentModuleModel` is convenient, but not a
  phase-specific IR with invariants per stage. Angular/Vue-style compilers tend to make phase
  boundaries explicit enough that illegal states become unrepresentable.
- Render equivalence is named like a semantic gate but currently normalizes source strings rather
  than independently rendering authored and lowered semantics. That is easier to inspect than the old
  tautology, but it is still weaker than SPEC §5.2 rule 3.
- Some functions still encode structural decisions through string conventions (`state.*`,
  `data-bind:*`, selector strings, route strings). Some are explicitly permitted by SPEC §5.2, but
  they remain mental overhead.

Compared to Angular/Vue:

Angular and Vue are harder to read locally, but their compiler phases are more formalized and have
years of edge-case hardening. Kovo is more transparent and human-auditable, but less mature in
internal abstraction boundaries.

## Performance

Strengths:

- The compiler has a small dependency surface. It relies on TypeScript and local code, which keeps
  startup and package risk low.
- Output is designed for runtime performance: source-derived handler names, explicit query update
  plans, no runtime signal graph in the core client, and self-describing DOM bindings align with
  SPEC §3 and §4.8.
- The local compiler test suite is fast enough to run frequently: 258 tests completed in about two
  seconds during this assessment.

Weaknesses:

- The compiler reparses after patching. That is simple and safe enough today, but it scales poorly
  compared with an incremental AST/IR pipeline.
- There is no obvious compiler-performance benchmark suite for large TSX modules, many components,
  large route graphs, or CSS-heavy components. World-class frameworks track these regressions because
  compiler latency is product UX.
- Several passes scan `jsxElements(model)` independently. For current sizes this is fine; at
  framework scale, repeated whole-model sweeps and selector/string construction need profiling.
- CSS scoping uses a hand-written parser. It is now depth/quote-aware for selector splitting, but CSS
  parsing and nesting are large surfaces. Vue/Svelte-class tooling typically either uses established
  parser infrastructure or has extensive fixture corpora.

Compared to Angular/Vue:

Kovo's generated runtime posture is potentially competitive, possibly better for low-JS pages. The
compiler implementation itself is not yet in the same class for measured incremental build behavior,
large-project throughput, cache invalidation, or regression tracking.

## Maintainability

Strengths:

- Test density is respectable for package size: 25 compiler test files, 258 tests, plus TypeScript
  checking.
- The diagnostic model is centralized through `@kovojs/core` definitions, matching SPEC §11.3's rule
  that surfaces must not invent severities.
- The hardening work has moved several checks away from raw string heuristics: KV201 now has a model
  allowlist path, KV301 uses initializer property-access facts, KV221 scopes IDREFs per component,
  and primitive attribute merge has a real compiler module.
- The active plan discipline is useful: previous findings have evidence and proving commands, which
  makes regressions easier to audit.

Weaknesses:

- `compileComponentModule()` is doing too much coordination in one function. It is readable, but it is
  also the place where phase ordering bugs will accumulate.
- The patch/reparse architecture makes cross-transform conflicts likely as the compiler gains more
  sugar. Example risk classes: primitive spread lowering plus inline derives, view transition style
  lowering plus attribute merge, and event handler lowering plus chained primitive handlers.
- Some validation is intentionally non-blocking (`lint`/`warn`), including important consistency
  signals like KV311. That matches the diagnostic registry, but it means "green build" can still mean
  "known coverage gaps exist."
- The assessment found current code still has compatibility shims such as `capturesUnserializableReferences`
  falling back to the old denylist when called without a model. That kind of dual semantics tends to
  survive longer than intended.
- The world-class frameworks have broad conformance suites against real template syntax, SSR,
  hydration, sourcemaps, production minification, ecosystem libraries, and browser behavior. Kovo has
  a good package-local suite but a smaller demonstrated conformance surface.

Compared to Angular/Vue:

Kovo is easier for a maintainer to enter today, but Angular/Vue have stronger institutional
maintainability: explicit IRs, longer-lived public contracts, large compatibility suites, and heavy
release engineering. Kovo needs those before it can claim comparable durability.

## Security

Strengths:

- The compiler treats several security-relevant mistakes as compile-time diagnostics: handler capture
  channels (KV201), invalid IDREFs (KV221), content-model mismatches (KV225), residual stamps
  (KV226), binding path validation (KV302), and direct db access in mutation handlers (KV330).
- The text escaping pass in `lower/inline-derives.ts` directly addresses a stored-XSS class by
  wrapping simple data-path text children in `escapeText(...)`.
- Template stamp client rendering escapes interpolated values before assembling HTML strings.
- The framework posture favors server truth and readable wire artifacts, which improves auditability
  compared with opaque client cache/runtime state.

Weaknesses:

- Security is not yet uniform. Text escaping is a targeted lowering pass, template stamps have local
  escaping, and attributes depend on JSX/runtime behavior. A world-class compiler usually has one
  central output-context model: text, attribute, URL, style, script, raw HTML, trusted value, etc.
- CSS and style lowering remain sensitive. `view-transition-name` and style merging are generated as
  strings; CSS value validation and URL-bearing CSS are not visibly modeled as security contexts.
- `renderEquivalenceSourceCheck()` normalizes with regexes. That is acceptable as a regression guard,
  but it should not be treated as a security or semantic proof.
- `runInNewContext()` still exists for emitted server render checking. It is bounded and local, but
  mature frameworks are careful to isolate or avoid code execution during checks unless there is a
  clear sandbox model.
- Route/link validation exists, but security review normally also wants endpoint/mutation/CSRF/auth
  compiler surfaces integrated with app-level gates. SPEC §11.4 describes this broader surface; this
  compiler package alone does not prove it.

Compared to Angular/Vue:

Kovo's security ambition is higher than many frameworks because it wants machine-auditable artifacts
and compile-time diagnostics. The implementation is not yet as hardened as mature frameworks with
years of XSS, SSR, sanitizer, CSP, URL, and ecosystem edge-case pressure.

## Highest-Risk Gaps

- [x] **Replace render-equivalence source normalization with a real semantic differential.**
  - Risk: SPEC §5.2 rule 3 promises `render(src) == render(compile(src))`, but the current check
    compares normalized source forms and strips generated attributes with regexes. That catches some
    accidental drift, but it is not an independent semantic proof.
  - Why it matters: this gate is supposed to protect every lowering. If it is weak, later features can
    preserve apparent source shape while changing rendered behavior.
  - Candidate implementation path: add an authored-side reference renderer over the parsed
    `ComponentModuleModel`, render the lowered server artifact independently, normalize only an
    explicit typed allowlist of generated runtime attrs, then diff byte-for-byte with a useful
    failure report.
  - Acceptance evidence: a fixture where a lowerer changes visible HTML must fail the semantic gate;
    a fixture adding only allowed generated attrs must pass; `kovo check` must report this as a real
    differential, not a source-normalization check.
  - Evidence 2026-06-16: `packages/compiler/src/emit/server.ts` implements
    `semanticRenderEquivalenceCheck()`, rendering the authored `ComponentModuleModel` and the
    emitted server artifact independently before comparing semantic HTML.
  - Evidence 2026-06-16: `packages/compiler/src/compile.ts` wires the semantic differential into the
    blocking `renderEquivalenceChecks` gate.
  - Evidence 2026-06-16: `packages/compiler/src/compile-component.test.ts` proves visible HTML drift
    fails and generated-only runtime attributes pass.
  - Evidence 2026-06-16: `packages/cli/src/index.ts` preserves semantic differential
    `detail`/`expected`/`actual` for failing compile results so `kovo check` reports a real
    `RENDER_EQUIV` differential.
  - Verification 2026-06-16:
    `pnpm --filter @kovojs/compiler exec vitest run src/compile-component.test.ts` -> 17 tests
    passed.
  - Verification 2026-06-16: `pnpm --filter @kovojs/compiler exec vitest run` -> 26 files / 261
    tests passed.
  - Verification 2026-06-16: `pnpm --filter @kovojs/compiler exec tsc --noEmit` -> passed.
  - Verification 2026-06-16:
    `pnpm --filter kovo exec vitest run src/index.kovo-check.test.ts src/index.compile-mcp.test.ts`
    -> 2 files / 54 tests passed.
  - Verification 2026-06-16: `pnpm --filter kovo exec tsc --noEmit` -> passed.
  - [x] Decision made: use a Kovo model interpreter as the authored-side reference renderer.
    - Evidence 2026-06-15: user chose D1=A. The interpreter should walk `ComponentModuleModel` and
      supported Kovo JSX semantics instead of executing authored TSX.
  - [x] Decision made: generated-only delta allowlist is `kovo-c`, `kovo-deps`, `kovo-state`,
        `kovo-param-types`, `on:*`, DOM `on[A-Z]` handler attributes, `data-p-*`, `data-bind`,
        `data-bind:*`, `data-derive`, and `data-derive-attr`.
    - Evidence 2026-06-16: `isGeneratedOnlyRenderAttribute()` in
      `packages/compiler/src/emit/server.ts` defines the compiler-emitted stamp allowlist with
      SPEC §5.2/§4.8 citations.
  - [x] Decision made: make the real semantic gate blocking immediately.
    - Evidence 2026-06-15: user chose D1b=A, preferring the stringent posture over warning-first
      rollout.

- [ ] **Reduce patch-order fragility by introducing phase-specific IR builders for structural
      transforms.**
  - Risk: the compiler currently relies heavily on span patches followed by a reparse. That is simple
    but fragile when multiple lowerers rewrite the same element or attribute family.
  - Why it matters: Angular/Vue/Svelte-class compilers survive growth by making phase invariants
    explicit. Kovo's compiler will accumulate conflicts around primitive composition, state/query
    bindings, view transitions, navigation, and event handler lowering unless the structural rewrite
    surface becomes more formal.
  - Decision 2026-06-15: use the TypeScript compiler API as the parser/source-span substrate, but
    build a **Kovo-owned full JSX tree IR** rather than stopping at an element-opening/attribute IR.
    The IR should encode Kovo semantics directly: authored/generated/primitive ownership,
    source spans, child nodes, expression nodes, binding/update metadata, merge provenance, and
    diagnostic anchors.
  - Candidate implementation path: keep `SourceReplacement` only as a temporary bridge and for truly
    terminal source patches. Introduce a full JSX tree IR plus a canonical printer, then migrate
    lowerers from source-span patches to IR transforms in coherent slices. The first production slice
    should still be opening tags and attributes, but it must be implemented as the first subset of the
    full-tree IR, not as a separate short-lived IR.
  - Acceptance evidence: primitive attrs/asChild, `Link`, dynamic `viewTransitionName`, state/query
    attribute derives, mixed text binding insertion, and nested child rewrites can be composed in one
    fixture without depending on replacement order; conflict diagnostics name both writers and point
    to authored spans.
  - [x] Decision made: structural scope is full JSX tree IR, implemented incrementally.
    - Evidence 2026-06-15: user chose full JSX tree IR and agreed to use the TypeScript compiler API
      as the parse/span foundation while keeping Kovo semantics in a custom IR.
  - [x] Decision made: use canonical compiler formatting for full JSX tree IR output.
    - Evidence 2026-06-15: user accepted D2b=A, favoring deterministic fixpoint output over authored
      formatting preservation.
  - [x] Decision made: migrate the broad overlap-prone structural slice first.
    - Evidence 2026-06-15: user accepted D2c=A. The first migration target includes primitive
      composition, navigation `Link`, view-transition style merging, inline state/query attribute
      derives, mixed text binding insertion, and fragment/slot child lowering.

- [ ] **Add compiler performance gates.**
  - Risk: the compiler is fast on the current package-local suite, but there is no performance
    contract for real app scale or CI regression detection.
  - Why it matters: compiler latency is part of framework UX. Angular/Vue users expect predictable
    rebuilds, stable CI times, and no pathological behavior as component count grows.
  - Candidate implementation path: create a `p10-compiler-perf` fixture set with generated corpora:
    one large TSX component, many small components, many routes/registries, CSS-heavy components,
    heavy primitive composition, and a mixed real-app fixture. Measure cold compile and warm repeat
    compile under the same `vp run p10-perf` discipline already used elsewhere.
  - Acceptance evidence: checked-in baselines and budgets exist; CI fails or warns on clear
    regressions; output includes file count, LOC, transform count, parse count, and elapsed time.
  - [x] Decision made: defer compiler performance gates for now.
    - Evidence 2026-06-15: user explicitly said performance is the only decision area they do not care
      about right now and accepted D3=C. Keep this as deliberately deferred, not complete.

- [ ] **Centralize output-context security.**
  - Risk: security handling is distributed: text interpolation has an `escapeText(...)` pass,
    template-stamp client rendering escapes locally, attributes depend on JSX/runtime behavior, and
    URLs/styles are handled by feature-specific code.
  - Why it matters: distributed escaping is where mature web frameworks historically accumulate XSS
    bugs. World-class compilers use context-aware emission rules and make unsafe raw HTML explicit.
  - Candidate implementation path: introduce an output-context model used by lowerers and emitters:
    text, attribute, boolean attribute, URL attribute, style property, CSS text, HTML fragment, script
    text, and trusted/raw escape hatches. Each generated interpolation must carry a context and pass
    through one emitter.
  - Acceptance evidence: malicious payload fixtures exist for text, title/aria attrs, `href`,
    `style`, CSS component blocks, list template stamps, fragment targets, and raw HTML escape hatches.
    Server render and client update paths must agree.
  - [x] Decision made: raw HTML exists only through an explicit Kovo trusted HTML wrapper type, with
        browser Trusted Types interop as the target shape.
    - Evidence 2026-06-15: user chose the D4/B posture after reviewing how a Kovo `TrustedHtml`
      wrapper could accept or produce browser `TrustedHTML` where supported. Plain strings at raw
      HTML sinks should be rejected; normal text remains escaped.
  - [x] Decision made: enforce a strict URL policy by default.
    - Evidence 2026-06-15: user accepted D4b=A. Internal route helpers are trusted after validation;
      literal external URLs need an explicit escape hatch; unsafe schemes such as `javascript:` are
      rejected except for narrowly specified safe contexts.
  - [x] Decision made: enforce a strict style/CSS policy by default.
    - Evidence 2026-06-15: user accepted D4c=A. Generated style properties should use
      property-specific validation/escaping; arbitrary dynamic CSS text should be rejected unless a
      future safe CSS value API exists.
  - [x] Decision made: CSP/nonces are a compiler/server contract.
    - Evidence 2026-06-15: user accepted D4d=A. Generated scripts/styles need nonce or hash metadata
      that the server can emit and enforce.

- [ ] **Turn world-class claims into conformance suites.**
  - Risk: green package-local tests can still miss framework-level drift across compiler, server,
    runtime, CLI, and examples.
  - Why it matters: world-class framework compilers are trusted because their compatibility matrix is
    broad and boring. Kovo's design is cross-package by nature, so compiler quality cannot be proven
    only inside `packages/compiler`.
  - Candidate implementation path: define a compiler conformance harness that starts from authored
    TSX and checks lowered IR, emitted server/client modules, registry facts, static export, runtime
    DOM updates, browser behavior where necessary, and diagnostic snapshots for negative cases.
  - Acceptance evidence: each high-value SPEC promise has at least one positive and one negative
    fixture; every KV2xx/KV3xx compiler diagnostic has a diagnostic snapshot with help text; browser
    tests cover only behavior that cannot be proven browser-free.
  - [x] Decision made: use a reference app, commerce app, and focused generated fixtures as the
        conformance corpus.
    - Evidence 2026-06-15: user accepted D5=A.
  - [x] Decision made: quantitative "world-class" bar covers diagnostic coverage, SPEC clause
        coverage, browser matrix, performance posture, and security payload matrix.
    - Evidence 2026-06-16: see "Quantitative Conformance Bar" in this plan.
  - [x] Decision made: commit stable text snapshots and generate bulky/browser artifacts in CI.
    - Evidence 2026-06-15: user accepted D5b=A.
  - [x] Quantitative conformance bar defined for the decided corpus.
    - Evidence 2026-06-16: `plans/compiler-quality.md` now defines diagnostic coverage, SPEC clause
      coverage, browser matrix, deliberately deferred performance posture, and security payload
      matrix under "Quantitative Conformance Bar."
  - [x] Initial compatibility cleanup snapshots added without bulky/browser artifacts.
    - Evidence 2026-06-16: `packages/compiler/src/conformance-compat.test.ts` snapshots KV201,
      KV230, KV235, and KV311 structured diagnostic text; narrow verification
      `pnpm --filter @kovojs/compiler exec vitest run src/conformance-compat.test.ts
      src/fragment-targets.test.ts src/query-coverage.test.ts src/state-bindings.test.ts
      src/stamps.test.ts` passed.

- [x] **Retire compatibility paths with weaker semantics.**
  - Risk: compatibility branches preserve old behavior after the main path has improved. The clearest
    current example is `capturesUnserializableReferences()` using a model-backed allowlist in normal
    handler lowering but falling back to the old denylist when called without a model.
  - Why it matters: dual semantics make audits unreliable. A future caller can accidentally take the
    weak path and reintroduce a closed class of bugs.
  - Candidate implementation path: audit exported helper functions in `packages/compiler/src/**`,
    classify each as production API, test-only helper, or private implementation detail, and remove
    or harden weaker fallbacks.
  - Acceptance evidence: no production validator can call KV201 capture checking without a model;
    tests use explicit fixtures rather than weaker helper modes; API exports are minimal.
  - [x] Decision made: delete weak compatibility helpers by default; move only genuinely useful test
        helpers to `test-support.ts`.
    - Evidence 2026-06-15: user accepted D6=A+B. Production code should use only the strong semantic
      form; weak fallback exports should not remain as documented footguns.
  - Evidence 2026-06-16: `capturesUnserializableReferences()` now requires an explicit
    model-backed context; `rg -n "capturesUnserializableReferences\\(" packages/compiler/src`
    shows only handler lowering and fragment-target validation call sites plus the helper
    definition; `rg -n "capturesUnserializableReferences" packages/compiler/src/index.ts
    packages/**/*.test.ts packages/conformance-fixtures/src` returns no public export or test
    helper use. Narrow compiler verification passed with the command listed under the conformance
    snapshot evidence above.

- [ ] **Broaden diagnostics from detection to teaching.**
  - Risk: diagnostics can correctly detect a problem but still fail SPEC §5.2 rule 5 if they do not
    show the would-have-lowered output, why it cannot compile, and a concrete fix menu.
  - Why it matters: Kovo's compiler is intended for humans and code-generation agents. Teaching
    diagnostics are part of the product, not polish.
  - Candidate implementation path: define a diagnostic help contract for every compiler-owned KV2xx
    and KV3xx code, then snapshot both message and help. KV230 is the model; KV311 is the immediate
    gap because it currently emits a terse coverage message.
  - Acceptance evidence: diagnostic snapshots cover message, severity, source position, help, and
    fix options; Vite/CLI/MCP surfaces render the same structured fields.
  - [x] Decision made: every compiler diagnostic, new and existing, must have teaching help before
        merge.
    - Evidence 2026-06-15: user accepted the stringent D7=A posture.
  - [ ] Decision needed: define the required diagnostic schema. Recommended fields: problem,
        would-have-lowered form, blocked reason, fix menu, SPEC citation, and suppression/escape
        posture when one exists.
  - [x] Decision made: incomplete teaching content is a blocking quality gate for all compiler
        diagnostics.
    - Evidence 2026-06-15: user chose D7=A rather than a new-code-only gradual retrofit.

## Decision Register

- [ ] **D1: Semantic equivalence strategy.** Authored-side renderer and blocking rollout decisions
      made: use a model interpreter and make the semantic gate blocking. Remaining D1 decision:
      generated-delta allowlist.
- [x] **D2: Structural IR scope.** Use a Kovo-owned full JSX tree IR on top of the TypeScript compiler
      API, implemented incrementally; use canonical compiler formatting; migrate the broad
      overlap-prone structural slice first.
  - Evidence 2026-06-15: user accepted D2 full-tree IR, D2b=A, and D2c=A.
- [x] **D3: Performance policy.** Defer compiler performance gates for now.
  - Evidence 2026-06-15: user accepted D3=C and explicitly deprioritized performance.
- [x] **D4: Security context model.** Raw HTML only via Kovo `TrustedHtml` with Trusted Types interop;
      strict URL policy; strict style/CSS policy; CSP/nonces are a compiler/server contract.
  - Evidence 2026-06-15: user accepted D4/B, D4b=A, D4c=A, and D4d=A.
- [x] **D5: Conformance bar.** Define the corpus and quantitative meaning of "world-class" for Kovo:
      SPEC coverage, diagnostic coverage, browser coverage, performance budgets, and security
      payload matrix.
  - Evidence 2026-06-16: "Quantitative Conformance Bar" defines the reference-app, commerce-app, and
    focused-generated-fixture corpus plus the diagnostic, SPEC, browser, performance, and security
    criteria.
- [x] **D6: Internal API policy.** Delete weak compatibility helpers by default; move only genuinely
      useful test helpers to `test-support.ts`.
  - Evidence 2026-06-15: user accepted D6=A+B.
- [x] **D7: Diagnostic quality gate.** Every compiler diagnostic, new and existing, must ship with
      teaching help snapshots before merge.
  - Evidence 2026-06-15: user chose D7=A.

## Bottom Line

Kovo's compiler has a distinctive and valuable design direction: readable emitted artifacts,
compile-time dataflow visibility, and DOM-described update plans. Those are real strengths, and the
current code is good enough to keep building on.

It should not yet be described as Angular/Vue/Svelte-class compiler engineering. The missing pieces
are the boring ones world-class frameworks accumulate over time: formal intermediate stages,
independent semantic equivalence, broad conformance, performance budgets, and a uniform security
context model. The fastest path to world-class quality is to preserve Kovo's auditability advantage
while replacing source-normalization and patch-order assumptions with stronger IR and verification
infrastructure.
