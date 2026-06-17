# Compiler Quality Follow-Up

Created 2026-06-16. This is the implementation ledger for re-proving the claims in
`plans/compiler-quality.md`. Treat the checked state in that older assessment as non-authoritative:
each item below stays open until this plan records direct source evidence and passing verification
for the exact claim. `SPEC.md` remains the normative source of truth.

Temporary unrelated red-baseline issues are not tracked here. The items below focus on the substantive
compiler-quality gaps found during the 2026-06-16 audit.

## Semantic Equivalence

- [ ] Make SPEC §5.2 render equivalence compare authored TSX semantics against compiled server IR.
  - [ ] Change the compile pipeline so the authored-side reference is derived from `originalModel`
        or an equivalent authored semantic render fact, not the post-lowering `model`.
  - [ ] Add an explicit test proving the compile pipeline calls the semantic gate with authored
        semantics before structural JSX lowering.
  - [ ] Add a visible-drift fixture for primitive `asChild` composition where the lowered element's
        visible tag/text/attribute differs from the authored reference and the semantic check fails.
  - [ ] Add a visible-drift fixture for `Link` lowering where an incorrect generated `href` fails the
        semantic check.
  - [ ] Add a visible-drift fixture for `viewTransitionName`/style lowering where an incorrect
        visible style value fails the semantic check.
  - [ ] Add a visible-drift fixture for inline query text binding and mixed text span insertion where
        generated-only `data-bind` passes but visible text drift fails.
  - [ ] Add a visible-drift fixture for handler/server-render stamping where generated `on:*`,
        `data-p-*`, `kovo-c`, `kovo-deps`, and `kovo-state` are ignored only through the explicit
        allowlist.
  - [ ] Preserve `detail`, `expected`, and `actual` on failing render-equivalence checks through the
        CLI `kovo check` surface.
  - [ ] Preserve `detail`, `expected`, and `actual` on failing render-equivalence checks through the
        compile/MCP JSON-RPC surface.
  - [ ] Record verification commands under this item after implementation.

- [ ] Retire or clearly quarantine the old source-normalization render-equivalence path.
  - [ ] Audit every import and call site of `renderEquivalenceCheck`,
        `semanticRenderEquivalenceCheck`, and `renderEquivalenceSourceCheck`.
  - [ ] Remove `renderEquivalenceSourceCheck()` from production exports or move it behind a clearly
        named test-support boundary.
  - [ ] Add a static/kovo-check guard proving production compile/check code cannot use
        source-normalization as semantic evidence.
  - [ ] Keep any remaining regex normalization tests explicitly labeled as legacy/test-only.
  - [ ] Record verification commands and grep evidence under this item.

## Structural IR

- [ ] Define the structural IR ownership boundary.
  - [ ] Document which transformations must be represented in the JSX IR because they rewrite
        element/tag/attribute/child structure.
  - [ ] Document which transformations may remain terminal `SourceReplacement` patches because they
        do not overlap authored structural rewrites.
  - [ ] Add a source-level guard or test that fails when a new lowerer under `packages/compiler/src/lower`
        returns structural `SourceReplacement`s without being registered in the boundary document.

- [ ] Move remaining overlapping structural rewrites into the JSX IR.
  - [ ] Migrate platform behavior substitution attributes into the JSX IR or prove they are terminal
        and non-overlapping.
  - [ ] Migrate `href()` call and navigation attribute replacement into the JSX IR where it rewrites
        JSX attributes.
  - [ ] Migrate server-render component identity/dependency/state stamp insertion into the JSX IR or
        a typed terminal stamp phase with conflict detection.
  - [ ] Migrate state derive URL versioning from attribute string patches to typed derive/reference
        facts.
  - [ ] Migrate static StyleX/style extraction attribute rewrites into the JSX IR or prove the style
        phase is terminal and conflict-checked.
  - [ ] Add writer/provenance diagnostics for conflicts between author, primitive, structural
        lowerer, style lowerer, server stamp, and handler stamp writers.

- [ ] Prove structural rewrite composition with one end-to-end fixture.
  - [ ] Include primitive attrs/asChild in the fixture.
  - [ ] Include `Link` lowering in the fixture.
  - [ ] Include dynamic `viewTransitionName` lowering in the fixture.
  - [ ] Include StyleX/static style extraction in the fixture.
  - [ ] Include state and query attribute derives in the fixture.
  - [ ] Include mixed text binding insertion in the fixture.
  - [ ] Include nested children and fragment-target/slot-like child shape.
  - [ ] Include platform substitution in the fixture.
  - [ ] Include handler stamping and chained primitive handler refs in the fixture.
  - [ ] Assert the output is stable independent of transform registration order, either by a
        deliberate order-shuffle test or by a typed IR phase-order invariant.

- [x] Make IR prefix/import insertion deterministic and non-accidental.
  - [x] Remove the unused `prefix` result field from `StructuralJsxLowering`, or make the compile
        pipeline consume it intentionally.
  - [x] Add a fixture with generated `escapeText`, `derive`, and runtime output-context imports in
        the same module.
  - [x] Assert generated imports are deduped, sorted, and inserted at the intended module location.
  - [x] Assert recompiling emitted IR is a byte-stable fixpoint when generated imports are present.
  - Evidence (2026-06-16): `packages/compiler/src/lower/structural-jsx.ts` no longer exposes a
        `prefix` field, and `packages/compiler/src/compile.ts` applies structural import insertion
        only through source replacements.
  - Evidence (2026-06-16): `packages/compiler/src/structural-jsx-ir.test.ts` snapshots a single
        component requiring generated `escapeText`, `derive`, and `kovoStyleProperty` imports and
        asserts `assertFixpoint(result)`; `pnpm --filter @kovojs/compiler exec vitest --run
        src/structural-jsx-ir.test.ts` passes.

## Security Contexts

- [x] Lower safe dynamic style objects through property-scoped runtime sanitizers instead of dynamic
      raw CSS text.
  - Evidence (2026-06-16): `packages/compiler/src/lower/structural-jsx.ts` lowers
    `style={{ ... }}` state/query derives to per-property `kovoStyleProperty(...)` calls while
    preserving arbitrary dynamic raw `style={...}` rejection in
    `packages/compiler/src/security/output-context.ts`.
  - Evidence (2026-06-16): `packages/runtime/src/security-output.ts` adds an internal
    `kovoStyleProperties(...)` helper plus allowlisted length/transform property sanitizers, and
    `packages/server/src/jsx-runtime.ts` renders object-valued server `style` props by composing the
    public `kovoStyleProperty(...)` helper without expanding the runtime barrel API.
  - Evidence (2026-06-16): `packages/compiler/src/output-context-security.test.ts` snapshots
    state style-object lowering; `packages/runtime/src/security-output.test.ts` and
    `packages/server/src/jsx-runtime.test.ts` cover property sanitization/server rendering.
  - Evidence (2026-06-16): `pnpm --filter @kovojs/example-gallery run
    emit:interactive-gallery`, `pnpm exec vitest --run
    examples/gallery/src/interactive-gallery.compile.test.ts
    examples/gallery/src/interactive-gallery.client-behavior.test.ts`, and `pnpm --filter
    @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts
    src/interactive-gallery.native.browser.test.ts` pass for the scroll-area/slider gallery
    coverage that previously hit KV236.

- [ ] Represent generated output contexts as typed compiler facts.
  - [ ] Add a shared compiler type for generated output writes with at least these contexts: text,
        attribute, boolean attribute, URL attribute, style property, CSS text, HTML fragment, script
        text, and trusted/raw HTML.
  - [ ] Thread output-context facts through server render emission for generated text and attributes.
  - [ ] Thread output-context facts through client query-plan emission for text bindings and derived
        attribute stamps.
  - [ ] Thread output-context facts through template stamp emission before HTML-fragment assembly.
  - [ ] Thread output-context facts through state derive emission and runtime state binding updates.
  - [ ] Thread output-context facts through URL-bearing attributes and dynamic URL updates.
  - [ ] Thread output-context facts through generated style properties and CSS text.
  - [ ] Add a static test that fails if a generated interpolation is emitted without an output-context
        fact.

- [x] Complete the security payload matrix.
  - [x] Add server-render and client-update agreement tests for text payloads containing `<`, `>`,
        `&`, and quotes.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-payloads.test.ts`
      snapshots initial server text escaping through `escapeText(...)` and client query text
      updates through `textContent` for payloads containing `<`, `>`, `&`, double quotes, and
      single quotes.
    - Evidence (2026-06-16): `pnpm exec vitest --run
      packages/compiler/src/output-context-payloads.test.ts` passes.
    - Evidence (2026-06-16): `packages/runtime/src/query-bindings.browser.test.ts` snapshots one
      browser DOM fixture where escaped server-rendered query text and a later
      `applyCompiledQueryUpdatePlan(...)` text update produce the same `textContent` for a payload
      containing `<`, `>`, `&`, double quotes, and single quotes, with zero parsed `<img>` nodes.
    - Evidence (2026-06-16): `pnpm exec vitest --run --config vitest.browser.config.ts
      packages/runtime/src/query-bindings.browser.test.ts
      packages/runtime/src/mutation-response-dom.browser.test.ts` passes.
  - [x] Add title and ARIA attribute payload tests.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-payloads.test.ts`
      snapshots compiler-generated `title`, `aria-label`, and `aria-description` derive stamps,
      emitted client update plans, and runtime `setAttribute` results for payloads containing
      `<`, `>`, `&`, double quotes, and single quotes.
    - Evidence (2026-06-16): `pnpm exec vitest --run
      packages/compiler/src/output-context-payloads.test.ts` passes.
  - [x] Add literal `href` tests for internal routes, explicit external URLs, and unsafe schemes.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-payloads.test.ts`
      snapshots an internal route literal, an explicit `external` full-origin URL, a missing
      `external` marker diagnostic, and an unsafe `javascript:` literal diagnostic.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-payloads.test.ts` passes.
  - [x] Add dynamic URL update tests for safe routes and unsafe schemes.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-payloads.test.ts`
      snapshots query-plan updates for dynamic `href` and `src`; the live runtime update preserves a
      safe `/images/...` URL and neutralizes `javascript:alert(1)` to `#`.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-payloads.test.ts` passes.
  - [x] Add style-property tests for allowed generated properties and rejected arbitrary dynamic CSS.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-security.test.ts`
      snapshots generated state style-object lowering to `kovoStyleProperty(...)` and rejects
      arbitrary dynamic raw `style={...}` text; `packages/runtime/src/security-output.test.ts`
      covers allowed `view-transition-name`, length/transform properties, and rejected unsafe
      `background-image`.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-security.test.ts` and `pnpm exec vitest --run
      packages/runtime/src/security-output.test.ts packages/server/src/jsx-runtime.test.ts` pass.
  - [x] Add component CSS block tests for unsafe `url()` values.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-security.test.ts` asserts a
      component `styles` block containing `background-image: url("javascript:...")` emits KV236
      with `styles contains an unsafe CSS url()`.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-security.test.ts` passes.
  - [x] Add template stamp tests where list item values attempt HTML injection.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-payloads.test.ts`
      executes the generated `data-bind-list` query plan against a fake template-stamp host and
      snapshots `kovoEscapeHtml(...)` output for list item values containing `<`, `>`, `&`, and
      quotes.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run -u
      src/output-context-payloads.test.ts` passes.
  - [x] Add fragment-target tests where refreshed fragment values attempt HTML injection.
    - Evidence (2026-06-16): `packages/runtime/src/mutation-response-dom.browser.test.ts`
      snapshots a real browser mutation fragment refresh whose server-escaped payload contains
      `<`, `>`, `&`, double quotes, and single quotes; fragment morphing preserves the decoded
      `textContent` and leaves zero parsed `<img>` nodes.
    - Evidence (2026-06-16): `pnpm exec vitest --run --config vitest.browser.config.ts
      packages/runtime/src/query-bindings.browser.test.ts
      packages/runtime/src/mutation-response-dom.browser.test.ts` passes.
  - [x] Add raw HTML rejection tests for plain strings at every supported raw HTML sink.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-raw-html.test.ts`
      snapshots KV236 diagnostics for statically visible plain strings at
      `dangerouslySetInnerHTML`, `innerHTML`, `rawHtml`, and `html`.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-raw-html.test.ts src/output-context-security.test.ts
      src/output-context-payloads.test.ts` passes.
  - [x] Add trusted HTML acceptance tests for the explicit Kovo trusted wrapper and browser
        TrustedHTML-compatible values.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-raw-html.test.ts`
      snapshots zero KV236 diagnostics plus emitted server IR for `trustedHtml("<b>...")` and
      `trustedHtml({ toString() { ... } })`/compatible values across the supported raw HTML sinks.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-raw-html.test.ts src/output-context-security.test.ts
      src/output-context-payloads.test.ts` passes.

- [x] Implement the CSP/nonce or hash metadata contract promised by the D4 decision.
  - [x] Decide and document whether Kovo emits nonces, hashes, or both for generated inline scripts
        and styles.
    - Evidence (2026-06-16): Kovo emits deterministic `sha256-...` hashes rather than request
      nonces for generated inline style/script content; `packages/server/src/csp.ts` defines the
      hash format and `renderContentSecurityPolicy(...)` assembly helper.
  - [x] Extend compiler-emitted script/style artifact metadata to carry the chosen CSP data.
    - Evidence (2026-06-16): `packages/compiler/src/css.ts` adds `cspHash` to generated
      `CssAsset`/`ComponentCssAsset` metadata for critical component CSS assets, computed from the
      exact escaped style text rendered by the server.
  - [x] Extend server/app-shell document assembly to consume and emit that metadata.
    - Evidence (2026-06-16): `packages/server/src/hints.ts` carries CSP hashes through page hints
      for critical styles, i18n scripts, and speculation-rule scripts, and
      `packages/server/src/document-core.ts` returns combined document CSP metadata while emitting
      hash attributes for the inline loader and document query scripts.
  - [x] Add tests proving generated document HTML includes nonce/hash data where required.
    - Evidence (2026-06-16): `packages/server/src/document.test.ts` asserts generated document
      HTML contains `data-kovo-csp-hash="sha256-..."` on critical CSS, the inline loader, and query
      hydration scripts; `packages/server/src/hints.test.ts`, `packages/server/src/meta.test.ts`,
      and `packages/server/src/route.test.ts` cover i18n and speculation-rule script hashes.
  - [x] Add tests proving generated headers or CSP policy assembly can reference the emitted metadata.
    - Evidence (2026-06-16): `packages/server/src/document.test.ts` snapshots
      `renderContentSecurityPolicy(document.csp)`, proving `script-src`/`style-src` policy assembly
      can reference the emitted hashes.
  - [x] Add tests proving metadata is stable or intentionally per-request according to the chosen
        contract.
    - Evidence (2026-06-16): `packages/compiler/src/css.test.ts` snapshots stable generated
      `cspHash` values for compiler CSS assets, and `packages/server/src/document.test.ts` snapshots
      stable document CSP metadata for generated inline scripts/styles.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/compiler/src/css.test.ts
      packages/server/src/hints.test.ts packages/server/src/document.test.ts
      packages/server/src/meta.test.ts packages/server/src/route.test.ts
      packages/server/src/wire-html.test.ts` passes.

- [ ] Tighten Trusted HTML to an actual escape-hatch contract.
  - [ ] Define the runtime/browser-compatible TrustedHTML shape Kovo accepts.
  - [ ] Make raw HTML sinks reject plain strings at compile time when statically visible.
  - [ ] Make raw HTML sinks reject or safely no-op plain strings at runtime when the value is dynamic.
  - [ ] Make raw HTML sinks unwrap only Kovo `TrustedHtml` or browser TrustedHTML-compatible values.
  - [ ] Preserve trusted/raw HTML context through generated server and client artifacts.

## Conformance Bar

- [ ] Build a mechanically auditable diagnostic coverage matrix for compiler-owned diagnostics.
  - [ ] Define the authoritative list of compiler-owned KV2xx/KV3xx codes in one test/table.
  - [ ] Mark non-compiler-owned or future-domain diagnostics out of scope with an explicit reason.
  - [ ] For every in-scope code, add a positive fixture showing accepted behavior.
  - [ ] For every in-scope code, add a negative fixture emitting the diagnostic.
  - [ ] For every in-scope code, snapshot code, severity, message, help/fix menu, source position,
        source length, and source file.
  - [ ] Include KV201 and KV230 compatibility snapshots because they guard SPEC §4.3/§4.5 capture
        channels.
  - [ ] Add a guard that fails when a new compiler-owned KV2xx/KV3xx diagnostic lacks matrix rows.

- [ ] Prove SPEC clause coverage for the quantified compiler promises.
  - [ ] Create a SPEC coverage map for §4.3 handler/capture lowering accepted paths and diagnostics.
  - [ ] Create a SPEC coverage map for §4.6 primitive composition and attribute merge accepted paths
        and diagnostics.
  - [ ] Create a SPEC coverage map for §4.8 bindings, derives, stamps, nullability, and residual-stamp
        accepted paths and diagnostics.
  - [ ] Create a SPEC coverage map for §4.9 coverage classification accepted paths and diagnostics.
  - [ ] Create a SPEC coverage map for §5.2 TSX-only authoring, fixpoint, semantic equivalence,
        teaching diagnostics, and post-parse typed-facts checks.
  - [ ] Create a SPEC coverage map for §6.1.1 component/package naming accepted paths and diagnostics.
  - [ ] Create a SPEC coverage map for §6.4 typed navigation, IDREF, and cross-island event accepted
        paths and diagnostics.
  - [ ] Create a SPEC coverage map for §11.3/§11.4 diagnostic registry and mutation/domain-related
        compiler checks.
  - [ ] Ensure the map cites fixtures from the reference app, commerce app, and focused generated
        fixtures, not only helper/unit tests.

- [ ] Add the browser matrix promised by the conformance bar.
  - [ ] Classify which compiler-quality behaviors genuinely require a browser rather than
        browser-free DOM fixtures.
  - [ ] Add or update Playwright/Vitest browser configuration for Chromium, Firefox, and WebKit.
  - [ ] Add CI workflow coverage for the three-engine browser matrix.
  - [ ] Keep bulky screenshots/traces generated as CI artifacts rather than checked-in fixtures.
  - [ ] Record local command evidence naming all three engines.

## Performance Gates

- [ ] Make compiler performance gates honest and reproducible.
  - [ ] Keep generated corpora for one large TSX component.
  - [ ] Keep generated corpora for many small components.
  - [ ] Keep generated corpora for many routes and registry facts.
  - [ ] Keep generated corpora for CSS-heavy components.
  - [ ] Keep generated corpora for heavy primitive composition.
  - [ ] Keep generated corpora for a mixed real-app-style fixture.
  - [ ] Check exact file counts and LOC floors for every corpus.
  - [ ] Check cold and warm elapsed budgets for every corpus and total.
  - [ ] Print file count, input LOC, emitted LOC, compile count, transform fact counts,
        diagnostics, cold elapsed time, and warm elapsed time.
  - [ ] Either instrument real parse count or rename the metric so it does not imply hidden reparses
        are counted.
  - [ ] Wire `pnpm run test:compiler-perf` into acceptance.
  - [ ] Make `pnpm exec vitest --run tests/compiler-perf.test.ts` intentionally skip with a clear
        reason or run a non-budget smoke path.

## Diagnostics

- [ ] Enforce the full teaching diagnostic schema for every compiler diagnostic.
  - [ ] Define the required schema per diagnostic class: lowering error, validation error, lint,
        warning, registry/graph error, and escape-hatch advisory.
  - [ ] Require a problem statement for every compiler diagnostic.
  - [ ] Require a would-have-lowered form when a lowering exists.
  - [ ] Require a blocked reason for every blocking diagnostic.
  - [ ] Require a concrete fix menu for every compiler diagnostic.
  - [ ] Require a SPEC citation for every compiler diagnostic.
  - [ ] Require suppression/escape posture text when a suppression or escape exists.
  - [ ] Update KV238, KV239, KV240, and any similar short-help diagnostics to satisfy the schema.
  - [ ] Add registry tests that validate schema by class, not only presence of `Fixes:` and `SPEC §`.
  - [ ] Add Vite surface tests preserving structured help, source position, length, severity, and
        dynamic context.
  - [ ] Add CLI surface tests preserving structured help, source position, length, severity, and
        dynamic context.
  - [ ] Add MCP surface tests preserving structured help, source position, length, severity, and
        dynamic context.

## Identity And Collision Checks

- [ ] Re-prove duplicate component-name checks.
  - [ ] Add or verify duplicate explicit component name fixture emits KV237.
  - [ ] Add or verify inferred kebab-case collision fixture emits KV237.
  - [ ] Add or verify registry-facts collision fixture emits KV237.
  - [ ] Add or verify distinct-name fixture emits no KV237.
  - [ ] Snapshot KV237 teaching help and source anchors.

- [ ] Re-prove duplicate fragment-target checks.
  - [ ] Add or verify module-local duplicate fragment-target fixture emits KV238.
  - [ ] Add or verify registry-facts fragment-target collision fixture emits KV238.
  - [ ] Add or verify distinct fragment-target fixture emits no KV238.
  - [ ] Snapshot KV238 teaching help and source anchors.

- [ ] Re-prove duplicate static view-transition checks.
  - [ ] Add or verify module-local duplicate static `viewTransitionName` fixture emits KV239.
  - [ ] Add or verify registry-facts static view-transition collision fixture emits KV239.
  - [ ] Add or verify distinct static view-transition fixture emits no KV239.
  - [ ] Document dynamic view-transition uniqueness scope until page-composition proof exists.
  - [ ] Snapshot KV239 teaching help and source anchors.

- [ ] Re-prove duplicate query-shape and route collision checks.
  - [ ] Add or verify duplicate query-shape facts with different shapes emit KV240.
  - [ ] Add or verify duplicate query-shape facts with identical shapes emit KV240.
  - [ ] Add or verify distinct query-shape facts emit no KV240.
  - [ ] Add or verify exact duplicate route facts emit KV228 before route registry dedupe.
  - [ ] Add or verify distinct route facts emit no KV228.
  - [ ] Snapshot KV240 and duplicate-route KV228 teaching help.

## Compatibility Paths

- [ ] Re-prove weak compatibility helper retirement.
  - [ ] Verify `capturesUnserializableReferences()` requires a model-backed context.
  - [ ] Verify handler lowering calls `capturesUnserializableReferences()` with model-backed context.
  - [ ] Verify fragment-target validation calls `capturesUnserializableReferences()` with
        model-backed context.
  - [ ] Verify no public compiler export exposes a weak capture-check helper.
  - [ ] Verify tests use explicit fixtures rather than a weak helper mode.
  - [ ] Run KV201 handler capture fixtures.
  - [ ] Run KV230 fragment-target child capture fixtures.

## Plan Cleanup

- [ ] Reconcile or archive `plans/compiler-quality.md` once this follow-up is complete.
  - [ ] Remove or correct stale executive-summary claims that describe implemented follow-up work as
        still missing.
  - [ ] Remove or correct checked entries whose implementation evidence was superseded by this plan.
  - [ ] Preserve the original assessment as historical context if useful, but make clear that this
        follow-up ledger contains the authoritative closure evidence.
  - [ ] Archive `plans/compiler-quality.md` if it no longer describes active work.

## Final Acceptance

- [ ] Run final compiler-quality gates from a clean or intentionally documented worktree.
  - [ ] `pnpm --filter @kovojs/compiler exec tsc --noEmit`
  - [ ] `pnpm --filter @kovojs/compiler exec vitest run`
  - [ ] `pnpm --filter @kovojs/core exec vitest run src/diagnostics.test.ts`
  - [ ] `pnpm --filter @kovojs/runtime exec tsc --noEmit`
  - [ ] `pnpm --filter @kovojs/runtime exec vitest run src/security-output.test.ts src/query-bindings.test.ts`
  - [ ] `pnpm run test:compiler-perf`
  - [ ] `pnpm run test:browser`
  - [ ] `pnpm run test:conformance`
  - [ ] `pnpm run check:kovo`
  - [ ] `git diff --check`
  - [ ] Record exact command results under the checklist item they prove.
  - [ ] Record a concrete reason and scoped replacement evidence for any skipped command.
