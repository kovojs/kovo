# Compiler Quality Follow-Up

Created 2026-06-16. This is the implementation ledger for re-proving the claims in
`plans/compiler-quality.md`. Treat the checked state in that older assessment as non-authoritative:
each item below stays open until this plan records direct source evidence and passing verification
for the exact claim. `SPEC.md` remains the normative source of truth.

Temporary unrelated red-baseline issues are not tracked here. The items below focus on the substantive
compiler-quality gaps found during the 2026-06-16 audit.

## Semantic Equivalence

- [x] Make SPEC §5.2 render equivalence compare authored TSX semantics against compiled server IR.
  - [x] Change the compile pipeline so the authored-side reference is derived from `originalModel`
        or an equivalent authored semantic render fact, not the post-lowering `model`.
  - [x] Add an explicit test proving the compile pipeline calls the semantic gate with authored
        semantics before structural JSX lowering.
  - [x] Add a visible-drift fixture for primitive `asChild` composition where the lowered element's
        visible tag/text/attribute differs from the authored reference and the semantic check fails.
  - [x] Add a visible-drift fixture for `Link` lowering where an incorrect generated `href` fails the
        semantic check.
  - [x] Add a visible-drift fixture for `viewTransitionName`/style lowering where an incorrect
        visible style value fails the semantic check.
  - [x] Add a visible-drift fixture for inline query text binding and mixed text span insertion where
        generated-only `data-bind` passes but visible text drift fails.
  - [x] Add a visible-drift fixture for handler/server-render stamping where generated `on:*`,
        `data-p-*`, `kovo-c`, `kovo-deps`, and `kovo-state` are ignored only through the explicit
        allowlist.
  - [x] Preserve `detail`, `expected`, and `actual` on failing render-equivalence checks through the
        CLI `kovo check` surface.
  - [x] Preserve `detail`, `expected`, and `actual` on failing render-equivalence checks through the
        compile/MCP JSON-RPC surface.
  - [x] Record verification commands under this item after implementation.
  - Evidence (2026-06-17): `packages/compiler/src/compile.ts` calls
        `semanticRenderEquivalenceCheck(fileNames.server, originalModel, ...)`, so the authored
        reference is captured before structural JSX lowering.
  - Evidence (2026-06-17): `packages/compiler/src/emit/server.ts` renders authored `Link`,
        static `viewTransitionName`, and primitive `asChild` semantics before comparing with the
        lowered server artifact.
  - Evidence (2026-06-17): `packages/compiler/src/compile-component.test.ts` covers the authored
        `Link` pipeline check plus explicit visible-drift failures for `Link`, `viewTransitionName`,
        mixed text/data-bind spans, handler/server stamps, and primitive `asChild` composition.
  - Evidence (2026-06-17): `packages/cli/src/index.kovo-check.test.ts` asserts failing
        render-equivalence checks print `detail`, `expected`, and `actual`; `packages/cli/src/index.ts`
        maps failed compile/v1 render-equivalence checks into MCP structured content with the same
        fields.
  - Evidence (2026-06-17): `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts
        packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.compile-mcp.test.ts
        packages/compiler/src/stamps.test.ts packages/compiler/src/view-transitions.test.ts
        packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/handler-lowering.test.ts`
        passed; `pnpm exec tsc --noEmit --pretty false` passed.

- [x] Retire or clearly quarantine the old source-normalization render-equivalence path.
  - [x] Audit every import and call site of `renderEquivalenceCheck`,
        `semanticRenderEquivalenceCheck`, and `renderEquivalenceSourceCheck`.
  - [x] Remove `renderEquivalenceSourceCheck()` from production exports or move it behind a clearly
        named test-support boundary.
  - [x] Add a static/kovo-check guard proving production compile/check code cannot use
        source-normalization as semantic evidence.
  - [x] Keep any remaining regex normalization tests explicitly labeled as legacy/test-only.
  - [x] Record verification commands and grep evidence under this item.
  - Evidence (2026-06-17): `packages/compiler/src/emit/server.ts` exports
        `semanticRenderEquivalenceCheck` only; the previous `renderEquivalenceCheck`,
        `renderEquivalenceSourceCheck`, `RenderEquivalenceIgnoredSpan`,
        `removeIgnoredSpans`, and `normalizeRenderEquivalenceSource` production path was removed.
  - Evidence (2026-06-17): `packages/compiler/src/compile-component.test.ts` now exercises
        generated `renderSource()` execution through `semanticRenderEquivalenceCheck`, not the
        removed source comparator.
  - Evidence (2026-06-17): `packages/compiler/src/render-equivalence-boundary.test.ts` scans
        non-test TypeScript files under `packages/compiler/src` and `packages/cli/src` and fails on
        `renderEquivalenceSourceCheck`, `renderEquivalenceCheck(`,
        `normalizeRenderEquivalenceSource`, `expectedIgnoredSpans`, or `removeIgnoredSpans`; it also
        asserts `compile.ts` calls
        `semanticRenderEquivalenceCheck(fileNames.server, originalModel, serverModule.executableSource)`.
  - Evidence (2026-06-17): `rg -n
        "renderEquivalenceCheck|renderEquivalenceSourceCheck|normalizeRenderEquivalenceSource|expectedIgnoredSpans|removeIgnoredSpans|semanticRenderEquivalenceCheck"
        packages/compiler/src packages/cli/src` found no source-normalization helper references
        outside the new test's forbidden-pattern list; remaining production hits are
        `semanticRenderEquivalenceCheck`, `renderEquivalenceChecks` result plumbing, and
        `RenderEquivalenceCheck` types.
  - Evidence (2026-06-17): `pnpm exec vitest --run
        packages/compiler/src/compile-component.test.ts
        packages/compiler/src/render-equivalence-boundary.test.ts` passed, and
        `pnpm exec tsc --noEmit --pretty false` passed.

## Structural IR

- [x] Define the structural IR ownership boundary.
  - [x] Document which transformations must be represented in the JSX IR because they rewrite
        element/tag/attribute/child structure.
  - [x] Document which transformations may remain terminal `SourceReplacement` patches because they
        do not overlap authored structural rewrites.
  - [x] Add a source-level guard or test that fails when a new lowerer under `packages/compiler/src/lower`
        returns structural `SourceReplacement`s without being registered in the boundary document.
  - Evidence (2026-06-17): `packages/compiler/src/lower/structural-boundary.md` defines the
        SPEC §5.2 ownership rule for JSX IR structural rewrites versus terminal
        `SourceReplacement` patches, and registers current source-patch lowerers as `jsx-ir-owner`,
        `structural-debt`, or `legacy-structural-entrypoint`.
  - Evidence (2026-06-17): `packages/compiler/src/structural-boundary.test.ts` scans
        `packages/compiler/src/lower/*.ts` and fails when an exported lowerer that imports
        `SourceReplacement` is absent from the boundary document or lacks an ownership class;
        `pnpm --filter @kovojs/compiler exec vitest run` passes in the integrated main worktree.

- [ ] Move remaining overlapping structural rewrites into the JSX IR.
  - [ ] Migrate platform behavior substitution attributes into the JSX IR or prove they are terminal
        and non-overlapping.
  - [ ] Migrate `href()` call and navigation attribute replacement into the JSX IR where it rewrites
        JSX attributes.
  - [ ] Migrate server-render component identity/dependency/state stamp insertion into the JSX IR or
        a typed terminal stamp phase with conflict detection.
  - [ ] Migrate state derive URL versioning from attribute string patches to typed derive/reference
        facts.
  - [x] Migrate static StyleX/style extraction attribute rewrites into the JSX IR or prove the style
        phase is terminal and conflict-checked.
  - [ ] Add writer/provenance diagnostics for conflicts between author, primitive, structural
        lowerer, style lowerer, server stamp, and handler stamp writers.
  - Evidence (2026-06-17): `packages/compiler/src/style.ts` now records StyleX-owned static and
        dynamic style attribute spans; `packages/compiler/src/compile.ts` threads those spans into
        `collectCompilerDiagnostics`, and `packages/compiler/src/security/output-context.ts` uses
        them to keep arbitrary dynamic `style={...}` red while accepting compiler-owned StyleX
        replacements as already-lowered class/CSS output.
  - Evidence (2026-06-17): `packages/compiler/src/structural-jsx-ir.test.ts` composes static
        StyleX extraction with the structural JSX fixture, including extracted atomic CSS,
        `data-style-src`, style rule attribution, and no KV236 diagnostic.
  - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest --run
        src/structural-jsx-ir.test.ts src/style.test.ts src/output-context-security.test.ts`
        passed.

- [x] Prove structural rewrite composition with one end-to-end fixture.
  - [x] Include primitive attrs/asChild in the fixture.
  - [x] Include `Link` lowering in the fixture.
  - [x] Include dynamic `viewTransitionName` lowering in the fixture.
  - [x] Include StyleX/static style extraction in the fixture.
  - [x] Include state and query attribute derives in the fixture.
  - [x] Include mixed text binding insertion in the fixture.
  - [x] Include nested children and fragment-target/slot-like child shape.
  - [x] Include platform substitution in the fixture.
  - [x] Include handler stamping and chained primitive handler refs in the fixture.
  - [x] Assert the output is stable independent of transform registration order, either by a
        deliberate order-shuffle test or by a typed IR phase-order invariant.
  - Evidence (2026-06-17): `packages/compiler/src/structural-jsx-ir.test.ts` fixture
        `composes overlap-prone JSX rewrites through one canonical tree` now combines primitive
        `attrs`/`asChild`, `Link` lowering, dynamic `viewTransitionName` style derive, static
        StyleX extraction, query `title` derive, state `hidden` derive, mixed text binding
        insertion, nested child shape, fragment target facts, platform dialog substitution, and
        author+primitive handler chaining.
  - Evidence (2026-06-17): `packages/compiler/src/lower/structural-jsx.ts` exports
        `structuralJsxPhaseOrder`, and `packages/compiler/src/structural-jsx-ir.test.ts` snapshots
        the typed phase-order invariant used to keep JSX IR structural rewrites deterministic.
  - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest run
        src/structural-jsx-ir.test.ts` passes.

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

- [x] Represent generated output contexts as typed compiler facts.
  - [x] Add a shared compiler type for generated output writes with at least these contexts: text,
        attribute, boolean attribute, URL attribute, style property, CSS text, HTML fragment, script
        text, and trusted/raw HTML.
  - [x] Thread output-context facts through server render emission for generated text and attributes.
  - [x] Thread output-context facts through client query-plan emission for text bindings and derived
        attribute stamps.
  - [x] Thread output-context facts through template stamp emission before HTML-fragment assembly.
  - [x] Thread output-context facts through state derive emission and runtime state binding updates.
  - [x] Thread output-context facts through URL-bearing attributes and dynamic URL updates.
  - [x] Thread output-context facts through generated style properties and CSS text.
  - [x] Add a static test that fails if a generated interpolation is emitted without an output-context
        fact.
  - Evidence (2026-06-17): `packages/compiler/src/output-context-facts.ts` defines
        `GeneratedOutputWriteFact` and `OutputContext` with text, attribute, boolean-attribute,
        url-attribute, style-property, css-text, html-fragment, script-text, and trusted-html
        contexts.
  - Evidence (2026-06-17): `packages/compiler/src/compile.ts` aggregates output-context facts from
        structural lowering, server render lowering, query update plans, and state derives into
        `CompileResult.outputContextFacts`.
  - Evidence (2026-06-17): `packages/compiler/src/emit/server.ts`,
        `packages/compiler/src/analyze/query-updates.ts`,
        `packages/compiler/src/lower/inline-derives.ts`,
        `packages/compiler/src/lower/structural-jsx.ts`, and `packages/compiler/src/style.ts`
        attach output-context facts to generated server stamps/handlers, query text/attribute
        stamps, template stamps, state derives, and style/class updates.
  - Evidence (2026-06-17): `packages/compiler/src/output-context-facts.test.ts` asserts
        `CompileResult.outputContextFacts` contains facts for generated server text, query
        attributes, query text, state text derives, and template stamps; `packages/compiler/src/stamps.test.ts`
        snapshots server host stamp output-context facts.
  - Evidence (2026-06-17): `packages/compiler/src/output-context-facts.test.ts` snapshots
        URL-bearing `href`/`src` query derives as `url-attribute` facts, generated state
        `style={{ ... }}` derives as `style-property` facts, StyleX extracted CSS artifacts as
        `css-text` facts, and accepted `trustedHtml(...)` raw HTML sinks as `trusted-html` facts;
        it also asserts generated `escapeText(...)` and `kovoStyleProperty(...)` interpolation
        helper calls have matching output-context facts.
  - Evidence (2026-06-17): `packages/compiler/src/style.ts` returns `css-text` output-context
        facts from `extractKovoStyles`, `packages/compiler/src/security/output-context.ts`
        exposes `collectTrustedHtmlOutputContextFacts(...)`, and `packages/compiler/src/compile.ts`
        aggregates both into `CompileResult.outputContextFacts`.
  - Evidence (2026-06-17): `rg "script-text|<script|script\\b" packages/compiler/src -n`
        found no current generated script-text writer beyond the declared `OutputContext` member
        and unrelated diagnostics/tests.
  - Evidence (2026-06-17): `pnpm exec vitest --run packages/compiler/src/output-context-facts.test.ts
        packages/compiler/src/output-context-payloads.test.ts packages/compiler/src/output-context-security.test.ts
        packages/compiler/src/output-context-raw-html.test.ts` passed; `pnpm exec tsc --noEmit
        --pretty false` passed.
  - Evidence (2026-06-17): `pnpm exec vitest --run packages/compiler/src/output-context-facts.test.ts
        packages/compiler/src/output-context-payloads.test.ts packages/compiler/src/output-context-security.test.ts
        packages/compiler/src/query-update-plans.test.ts packages/compiler/src/query-coverage.test.ts
        packages/compiler/src/state-bindings.test.ts packages/compiler/src/compile-component.test.ts
        packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.compile-mcp.test.ts
        packages/compiler/src/stamps.test.ts packages/compiler/src/view-transitions.test.ts
        packages/compiler/src/navigation-lowering.test.ts packages/compiler/src/handler-lowering.test.ts`
        passed; `pnpm exec tsc --noEmit --pretty false` passed.

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

- [x] Tighten Trusted HTML to an actual escape-hatch contract.
  - [x] Define the runtime/browser-compatible TrustedHTML shape Kovo accepts.
    - Evidence (2026-06-16): `packages/runtime/src/security-output.ts` defines
      `BrowserTrustedHTML` as a `Symbol.toStringTag === "TrustedHTML"` object with `toString()`,
      plus `isBrowserTrustedHtml(...)` and `isKovoTrustedHtml(...)` guards.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/runtime/src/security-output.test.ts
      packages/server/src/jsx-runtime.test.ts` passes.
  - [x] Make raw HTML sinks reject plain strings at compile time when statically visible.
    - Evidence (2026-06-16): `packages/compiler/src/output-context-raw-html.test.ts` snapshots
      KV236 diagnostics for statically visible plain strings at `dangerouslySetInnerHTML`,
      `innerHTML`, `rawHtml`, and `html`.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-raw-html.test.ts src/output-context-security.test.ts` passes.
  - [x] Make raw HTML sinks reject or safely no-op plain strings at runtime when the value is dynamic.
    - Evidence (2026-06-16): `packages/server/src/jsx-runtime.test.ts` asserts dynamic plain
      strings and unbranded objects at raw HTML sinks render empty element content instead of HTML.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/runtime/src/security-output.test.ts
      packages/server/src/jsx-runtime.test.ts` passes.
  - [x] Make raw HTML sinks unwrap only Kovo `TrustedHtml` or browser TrustedHTML-compatible values.
    - Evidence (2026-06-16): `packages/runtime/src/security-output.test.ts` covers
      `kovoTrustedHtmlContent(...)` unwrapping Kovo `TrustedHtml`, wrapped browser TrustedHTML, and
      direct browser TrustedHTML while returning `""` for strings and unbranded objects.
    - Evidence (2026-06-16): `packages/server/src/jsx-runtime.test.ts` covers all four raw HTML sink
      spellings rendering only trusted raw content.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/runtime/src/security-output.test.ts
      packages/server/src/jsx-runtime.test.ts` passes.
  - [x] Preserve trusted/raw HTML context through generated server and client artifacts.
    - Evidence (2026-06-17): `packages/compiler/src/output-context-raw-html.test.ts`
      snapshots accepted `trustedHtml(...)` raw HTML sinks for `dangerouslySetInnerHTML`,
      `innerHTML`, `rawHtml`, and `html`, including `trusted-html` output-context facts for every
      sink and the emitted server artifact; the same test asserts the generated client artifact does
      not contain a raw HTML writer.
    - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest --run
      src/output-context-raw-html.test.ts src/output-context-facts.test.ts
      src/output-context-security.test.ts` passed.

## Conformance Bar

- [x] Build a mechanically auditable diagnostic coverage matrix for compiler-owned diagnostics.
  - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) defines one authoritative `compilerOwnedDiagnosticMatrix` table covering in-scope compiler-owned KV2xx/KV3xx diagnostics and an explicit `outOfScopeCompilerDiagnostics` table for `KV310`.
  - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest run` passes in the
        integrated main worktree.
  - [x] Define the authoritative list of compiler-owned KV2xx/KV3xx codes in one test/table.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) centralizes the list in `compilerOwnedDiagnosticMatrix`.
  - [x] Mark non-compiler-owned or future-domain diagnostics out of scope with an explicit reason.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) snapshots `outOfScopeCompilerDiagnostics`, explicitly documenting why `KV310` is excluded from the executable compiler matrix.
  - [x] For every in-scope code, add a positive fixture showing accepted behavior.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) runs one `positive` fixture per matrix row and asserts zero emissions for that row's diagnostic.
  - [x] For every in-scope code, add a negative fixture emitting the diagnostic.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) runs one `negative` fixture per matrix row and asserts at least one emission for that row's diagnostic.
  - [x] For every in-scope code, snapshot code, severity, message, help/fix menu, source position,
        source length, and source file.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) snapshots representative normalized diagnostic facts with `code`, `severity`, `message`, `help`, `start`, `length`, and `fileName`.
  - [x] Include KV201 and KV230 compatibility snapshots because they guard SPEC §4.3/§4.5 capture
        channels.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) keeps a dedicated `keeps KV201 and KV230 teaching diagnostics compatibility-visible` snapshot.
  - [x] Add a guard that fails when a new compiler-owned KV2xx/KV3xx diagnostic lacks matrix rows.
    - Evidence (2026-06-17): [packages/compiler/src/diagnostic-coverage-matrix.test.ts](/Users/mini/kovo/packages/compiler/src/diagnostic-coverage-matrix.test.ts) compares `diagnosticDefinitions` against `compilerOwnedDiagnosticMatrix` plus `outOfScopeCompilerDiagnostics` and fails on uncovered new codes.

- [x] Prove SPEC clause coverage for the quantified compiler promises.
  - Evidence (2026-06-17): [packages/compiler/src/spec-coverage-map.ts](/Users/mini/kovo/packages/compiler/src/spec-coverage-map.ts) defines the authoritative coverage map for `SPEC.md` §4.3, §4.6, §4.8, §4.9, §5.2, §6.1.1, §6.4, and §11.3/§11.4.
  - Evidence (2026-06-17): [packages/compiler/src/spec-coverage-map.test.ts](/Users/mini/kovo/packages/compiler/src/spec-coverage-map.test.ts) verifies each clause has accepted-path, diagnostic, and reference/commerce app citations; each cited file exists; each cited test name is present; and each cited diagnostic code exists in `diagnosticDefinitions`.
  - Evidence (2026-06-17): `pnpm exec vitest --run packages/compiler/src/spec-coverage-map.test.ts` passed.
  - Evidence (2026-06-17): `pnpm exec tsc --noEmit --pretty false` passed.
  - [x] Create a SPEC coverage map for §4.3 handler/capture lowering accepted paths and diagnostics.
  - [x] Create a SPEC coverage map for §4.6 primitive composition and attribute merge accepted paths
        and diagnostics.
  - [x] Create a SPEC coverage map for §4.8 bindings, derives, stamps, nullability, and residual-stamp
        accepted paths and diagnostics.
  - [x] Create a SPEC coverage map for §4.9 coverage classification accepted paths and diagnostics.
  - [x] Create a SPEC coverage map for §5.2 TSX-only authoring, fixpoint, semantic equivalence,
        teaching diagnostics, and post-parse typed-facts checks.
  - [x] Create a SPEC coverage map for §6.1.1 component/package naming accepted paths and diagnostics.
  - [x] Create a SPEC coverage map for §6.4 typed navigation, IDREF, and cross-island event accepted
        paths and diagnostics.
  - [x] Create a SPEC coverage map for §11.3/§11.4 diagnostic registry and mutation/domain-related
        compiler checks.
  - [x] Ensure the map cites fixtures from the reference app, commerce app, and focused generated
        fixtures, not only helper/unit tests.

- [x] Add the browser matrix promised by the conformance bar.
  - [x] Classify which compiler-quality behaviors genuinely require a browser rather than
        browser-free DOM fixtures.
  - [x] Add or update Playwright/Vitest browser configuration for Chromium, Firefox, and WebKit.
  - [x] Add CI workflow coverage for the three-engine browser matrix.
  - [x] Keep bulky screenshots/traces generated as CI artifacts rather than checked-in fixtures.
  - [x] Record local command evidence naming all three engines.
  - Evidence (2026-06-17): `tests/browser-acceptance.mjs` declares
        `browsers: ['chromium', 'firefox', 'webkit']`, and `vitest.browser.config.ts` maps that
        list to Vitest browser instances while keeping the suite scoped to
        `packages/runtime/src/**/*.browser.test.ts`.
  - Evidence (2026-06-17): `.github/workflows/ci.yml` installs matching Playwright binaries for
        `chromium firefox webkit` before `vp run browser`; `rules/github-workflows.md` documents
        the three-engine install rule for root browser matrix workflow edits.
  - Evidence (2026-06-17): `packages/conformance-fixtures/src/command-fixtures.ts`,
        `packages/conformance-fixtures/src/command-fixtures.test.ts`, and
        `tests/kovo-check.node.mjs` project the browser acceptance fact as a three-engine
        `browsers` list. Browser-required coverage remains the runtime DOM/loader/morph/query
        behavior under `packages/runtime/src/**/*.browser.test.ts`; compiler-quality diagnostics,
        coverage maps, and generated-output shape remain browser-free Vitest fixtures.
  - Evidence (2026-06-17): `pnpm run test:browser` passed with `chromium`, `firefox`, and `webkit`
        instances: 21 browser test files and 63 browser tests. The first Firefox run exposed
        subpixel `scrollTop` preservation (`3.7333333492279053` versus `4`), so
        `packages/runtime/src/mutation-response-dom.browser.test.ts` and
        `packages/runtime/src/inline-loader-response-apply.browser.test.ts` now assert preserved
        scroll position with `toBeCloseTo(4, 0)`.
  - Evidence (2026-06-17): `pnpm exec vitest --run
        packages/conformance-fixtures/src/command-fixtures.test.ts
        packages/conformance-fixtures/src/package-exports.test.ts`, `node --test
        --test-name-pattern "framework-owned browser suite is wired into acceptance"
        tests/kovo-check.node.mjs`, and `pnpm exec tsc --noEmit --pretty false` passed.
        No new screenshot or trace artifacts were added by the passing three-engine matrix run.

## Performance Gates

- [x] Make compiler performance gates honest and reproducible.
  - [x] Keep generated corpora for one large TSX component.
  - [x] Keep generated corpora for many small components.
  - [x] Keep generated corpora for many routes and registry facts.
  - [x] Keep generated corpora for CSS-heavy components.
  - [x] Keep generated corpora for heavy primitive composition.
  - [x] Keep generated corpora for a mixed real-app-style fixture.
  - [x] Check exact file counts and LOC floors for every corpus.
  - [x] Check cold and warm elapsed budgets for every corpus and total.
  - [x] Print file count, input LOC, emitted LOC, compile count, transform fact counts,
        diagnostics, cold elapsed time, and warm elapsed time.
  - [x] Either instrument real parse count or rename the metric so it does not imply hidden reparses
        are counted.
  - [x] Wire `pnpm run test:compiler-perf` into acceptance.
  - [x] Make `pnpm exec vitest --run tests/compiler-perf.test.ts` run the real gate.
  - Evidence (2026-06-17): `tests/compiler-perf.test.ts` defines the six generated corpora
        (`large-component`, `many-small-components`, `many-routes-registries`,
        `css-heavy-components`, `heavy-primitive-composition`, and `mixed-real-app`) and reads
        exact `fileCount`, `minLoc`, cold, warm, and total budgets from
        `tests/compiler-perf.budgets.json`.
  - Evidence (2026-06-17): `tests/compiler-perf.test.ts` now runs under direct Vitest without the
        old `KOVO_RUN_COMPILER_PERF` skip guard, prints environment metadata, prints `inputLoc`
        instead of ambiguous `loc`, prints no inferred parse-count metric, and prints emitted LOC,
        compile count, aggregate transform facts, client exports, handlers, query plans, CSS assets,
        platform substitutions, render-equivalence checks, update coverage, view transitions,
        diagnostics, and cold/warm elapsed times.
  - Evidence (2026-06-17): `package.json` keeps `pnpm run test:compiler-perf` in `acceptance`, and
        `vite.config.ts` wires the `compiler-perf` task directly to
        `vitest --run tests/compiler-perf.test.ts`.
  - Evidence (2026-06-17): `pnpm exec vitest --run tests/compiler-perf.test.ts --reporter verbose`
        passed and printed: environment `node=v24.12.0`, `platform=darwin`, `arch=arm64`,
        `cpuCount=10`; corpus metrics `large-component files=1 inputLoc=610 coldMs=141.8
        warmMs=102.1`, `many-small-components files=48 inputLoc=624 coldMs=60.6 warmMs=55.1`,
        `many-routes-registries files=32 inputLoc=384 coldMs=25.8 warmMs=24.7`,
        `css-heavy-components files=16 inputLoc=2480 coldMs=13.2 warmMs=9.6`,
        `heavy-primitive-composition files=20 inputLoc=2800 coldMs=57.8 warmMs=47.1`,
        `mixed-real-app files=8 inputLoc=200 coldMs=15.9 warmMs=12.6`, and
        `total files=125 inputLoc=7098 coldMs=315.0 warmMs=251.1`.
  - Evidence (2026-06-17): `pnpm run test:compiler-perf` passed through `vp run compiler-perf`;
        `pnpm exec tsc --noEmit --pretty false` passed; `pnpm run check:build` passed. A broader
        `node --test tests/kovo-check.node.mjs` run after building still failed on unrelated
        baseline fixture drift in wire, loader, CSP, and commerce page-hint assertions, not in the
        compiler performance gate.

## Diagnostics

- [x] Enforce the full teaching diagnostic schema for every compiler diagnostic.
  - [x] Define the required schema per diagnostic class: lowering error, validation error, lint,
        warning, registry/graph error, and escape-hatch advisory.
  - [x] Require a problem statement for every compiler diagnostic.
  - [x] Require a would-have-lowered form when a lowering exists.
  - [x] Require a blocked reason for every blocking diagnostic.
  - [x] Require a concrete fix menu for every compiler diagnostic.
  - [x] Require a SPEC citation for every compiler diagnostic.
  - [x] Require suppression/escape posture text when a suppression or escape exists.
  - [x] Update KV238, KV239, KV240, and any similar short-help diagnostics to satisfy the schema.
  - [x] Add registry tests that validate schema by class, not only presence of `Fixes:` and `SPEC §`.
  - [x] Add Vite surface tests preserving structured help, source position, length, severity, and
        dynamic context.
  - [x] Add CLI surface tests preserving structured help, source position, length, severity, and
        dynamic context.
  - [x] Add MCP surface tests preserving structured help, source position, length, severity, and
        dynamic context.
  - Evidence (2026-06-17): `packages/core/src/diagnostics.ts` defines
        `compilerDiagnosticTeachingSchemas` for KV201 plus compiler-owned KV2xx/KV3xx diagnostics,
        classifying required lowered-form, blocked-reason, and escape-posture fields under
        SPEC §5.2.
  - Evidence (2026-06-17): `packages/core/src/diagnostics.test.ts` asserts each compiler
        diagnostic has a problem statement, concrete `Fixes:`, `SPEC §` citation, required
        `Would lower to:`/`Would hoist children to:` text, required `Blocked reason:`, and
        documented escape posture when the schema marks one.
  - Evidence (2026-06-17): `packages/core/src/diagnostics.ts` expands KV238, KV239, KV240, and
        KV311 help with would-have-lowered and blocked-reason text;
        `packages/compiler/src/diagnostic-coverage-matrix.test.ts` snapshots the expanded teaching
        text plus source file, position, length, severity, and dynamic context.
  - Evidence (2026-06-17): `packages/compiler/src/vite.test.ts` preserves structured KV201 help,
        `SPEC §4.3 and §5.2`, `start`, `length`, and registry severity through the Vite module
        diagnostic callback while the thrown teaching error renders each help line.
  - Evidence (2026-06-17): `packages/cli/src/index.compile-mcp.test.ts` preserves structured
        KV201/KV210 help, source position, length, severity, and SPEC citation through
        `compileComponentV1(...)`, `handleKovoMcpRequest(...)`, and the SDK MCP lifecycle.
  - Evidence (2026-06-17): `pnpm exec vitest --run packages/core/src/diagnostics.test.ts
        packages/compiler/src/diagnostic-coverage-matrix.test.ts packages/compiler/src/vite.test.ts
        packages/cli/src/index.compile-mcp.test.ts packages/cli/src/index.kovo-check.test.ts`
        passed.
  - Evidence (2026-06-17): `pnpm exec tsc --noEmit --pretty false` passed.

## Identity And Collision Checks

- [x] Re-prove duplicate component-name checks.
  - [x] Add or verify duplicate explicit component binding fixture emits KV237.
  - [x] Add or verify inferred kebab-case collision fixture emits KV237.
  - [x] Add or verify registry-facts collision fixture emits KV237.
  - [x] Add or verify distinct-name fixture emits no KV237.
  - [x] Snapshot KV237 teaching help and source anchors.
  - Evidence (2026-06-17): `packages/compiler/src/component-names.test.ts` snapshots KV237
        diagnostics for duplicate exported component bindings, inferred kebab-case collisions, and
        `registryFacts.components` collisions, including `SPEC §4.2`, `SPEC §4.8`, `SPEC §6.1.1`,
        `start`, and `length`; the same file asserts distinct effective names emit no KV237.

- [x] Re-prove duplicate fragment-target checks.
  - [x] Add or verify module-local duplicate fragment-target fixture emits KV238.
  - [x] Add or verify registry-facts fragment-target collision fixture emits KV238.
  - [x] Add or verify distinct fragment-target fixture emits no KV238.
  - [x] Snapshot KV238 teaching help and source anchors.
  - Evidence (2026-06-17): `packages/compiler/src/fragment-targets.test.ts` snapshots KV238
        diagnostics for module-local and `registryFacts.fragmentTargets` collisions, including
        `SPEC §4.5`, `SPEC §4.8`, `SPEC §6.2`, `start`, and `length`; the same file asserts
        distinct fragment targets emit no KV238.

- [x] Re-prove duplicate static view-transition checks.
  - [x] Add or verify module-local duplicate static `viewTransitionName` fixture emits KV239.
  - [x] Add or verify registry-facts static view-transition collision fixture emits KV239.
  - [x] Add or verify distinct static view-transition fixture emits no KV239.
  - [x] Document dynamic view-transition uniqueness scope until page-composition proof exists.
  - [x] Snapshot KV239 teaching help and source anchors.
  - Evidence (2026-06-17): `packages/compiler/src/view-transitions.test.ts` snapshots KV239
        diagnostics for module-local and `registryFacts.viewTransitions` collisions, including
        `SPEC §8`, `start`, `length`, and the validator scope note that dynamic names require
        page-composition proof; the same file asserts distinct static names emit no KV239.

- [x] Re-prove duplicate query-shape and route collision checks.
  - [x] Add or verify duplicate query-shape facts with different shapes emit KV240.
  - [x] Add or verify duplicate query-shape facts with identical shapes emit KV240.
  - [x] Add or verify distinct query-shape facts emit no KV240.
  - [x] Add or verify exact duplicate route facts emit KV228 before route registry dedupe.
  - [x] Add or verify distinct route facts emit no KV228.
  - [x] Snapshot KV240 and duplicate-route KV228 teaching help.
  - Evidence (2026-06-17): `packages/compiler/src/query-bindings.test.ts` snapshots KV240 for
        duplicate query-shape facts with different and identical shapes and asserts distinct query
        shape facts emit no KV240; `packages/compiler/src/registry.test.ts` snapshots duplicate
        route KV228 before route registry dedupe and asserts distinct route facts emit no KV228.
  - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest --run
        src/component-names.test.ts src/fragment-targets.test.ts src/view-transitions.test.ts
        src/query-bindings.test.ts src/registry.test.ts src/diagnostic-coverage-matrix.test.ts`
        passed.

## Compatibility Paths

- [x] Re-prove weak compatibility helper retirement.
  - [x] Verify `capturesUnserializableReferences()` requires a model-backed context.
    - Evidence (2026-06-17): [packages/compiler/src/handler-lowering.test.ts](/Users/mini/kovo/packages/compiler/src/handler-lowering.test.ts) now proves `capturesUnserializableReferences(['track', 'LABEL'], { model })` accepts parsed named-import/module-constant facts, while the same references are rejected against an empty parsed model.
  - [x] Verify handler lowering calls `capturesUnserializableReferences()` with model-backed context.
    - Evidence (2026-06-17): [packages/compiler/src/handler-lowering.test.ts](/Users/mini/kovo/packages/compiler/src/handler-lowering.test.ts) keeps a direct `lowerEventHandlers(...)` fixture that allows named-import and module-constant captures and emits only KV210, proving the lowering path passes the parsed model-backed context into `capturesUnserializableReferences()`.
  - [x] Verify fragment-target validation calls `capturesUnserializableReferences()` with
        model-backed context.
    - Evidence (2026-06-17): [packages/compiler/src/fragment-targets.test.ts](/Users/mini/kovo/packages/compiler/src/fragment-targets.test.ts) now proves fragment-target children can reference a named import plus module constant (`formatMoney`, `CURRENCY`) without KV230, which depends on the model-backed allowlist in [packages/compiler/src/validate/component-contracts.ts](/Users/mini/kovo/packages/compiler/src/validate/component-contracts.ts).
  - [x] Verify no public compiler export exposes a weak capture-check helper.
    - Evidence (2026-06-17): [packages/compiler/src/compatibility-boundary.test.ts](/Users/mini/kovo/packages/compiler/src/compatibility-boundary.test.ts) asserts `packages/compiler/package.json` still publishes only `.` and `./graph`, and [packages/compiler/src/index.ts](/Users/mini/kovo/packages/compiler/src/index.ts) does not export or re-export `capturesUnserializableReferences()`.
  - [x] Verify tests use explicit fixtures rather than a weak helper mode.
    - Evidence (2026-06-17): [packages/compiler/src/compatibility-boundary.test.ts](/Users/mini/kovo/packages/compiler/src/compatibility-boundary.test.ts) asserts the KV201/KV230 coverage files keep explicit `compileComponentModule({ source: ... })` fixtures and do not reference helper-mode toggles.
  - [x] Run KV201 handler capture fixtures.
    - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest --run src/handler-lowering.test.ts src/conformance-compat.test.ts src/compatibility-boundary.test.ts` passed.
  - [x] Run KV230 fragment-target child capture fixtures.
    - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest --run src/fragment-targets.test.ts src/conformance-compat.test.ts src/compatibility-boundary.test.ts` passed.
  - Evidence (2026-06-17): `pnpm --filter @kovojs/compiler exec vitest --run src/diagnostic-coverage-matrix.test.ts -t "keeps KV201 and KV230 teaching diagnostics compatibility-visible"` passed.

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
