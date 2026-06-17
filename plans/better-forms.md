# Better forms — close the form-field type-safety gap end to end

## Sequencing

This plan is a **prerequisite for `plans/app-authoring-ergonomics.md` item 5**
(field-bound mutation failure UI). That plan's `<FieldError name="…" />` /
`<FormError />` surface is a thin authoring layer over what this plan establishes;
it must not re-open or fork these decisions:

- **KV242 — `name` ∈ mutation input schema** (Part A) is the same check that backs
  `<FieldError name>` binding downstream. Do not invent a second field-name check
  in the ergonomics plan.
- **`MutationRegistry` inference** (Part B) is what lets `<FieldError>/<FormError>`
  resolve a form's failure union without hand-written type args.
- **The single failure shape `{ code; payload; fieldErrors? }`** (Decisions + Part D)
  is the shape `<FieldError>` (reads `fieldErrors[name]`) and `<FormError>` (reads
  coded `payload`) render. The ergonomics plan explicitly drops `formFailure({ message })`
  in favor of this shape — so it must be locked here first.
- **CSRF-on for browser forms** (Decision + Part C3) is assumed by the ergonomics
  examples.

Ordering: land **Part A (KV242), Part B (registry inference), and Part D (failure
shape)** here before starting `app-authoring-ergonomics.md` item 5. Part C
(example fixes) can overlap with that item's example migration. Forward-compat
requirement: shape the A1/A3 field-fact surface so it can also back per-field
`<FieldError name>` resolution (field name → required/optional/error slot), not
only the form-level completeness check — the ergonomics layer should consume these
facts, not re-derive them.

## Context

The forms API reads cleanly (`<form enhance mutation={addToCart}>`) and the **mutation side** is well
typed: `mutation()` (`packages/server/src/mutation.ts:229`), `s.object()` input/error schemas, the
`ComponentMutationForms` render-state mapped type (`packages/core/src/index.ts:89-97`), and
`form.get(route)` GET forms are all sound. But the **one join the "statically verifiable end-to-end"
thesis (SPEC §1.1) depends on for forms** — that a `<form>`'s `<input name="…">` strings match the
bound mutation's input schema — is not actually enforced anywhere, and the example apps work around
its absence in ways that model the wrong patterns. A read-only audit (commerce/crm/stackoverflow/
gallery + the form type/runtime sources) found:

1. **No `name=` ∈ schema check.** SPEC §6.2 (line 509) lists "Form fields | mutation input schema |
   names ∈ schema; types match; **completeness** (missing required field = error)" as a proven
   surface, but **no KV code is assigned and no pass implements it.** The JSX namespace is
   `interface IntrinsicElements { [tag: string]: Record<string, unknown> }`
   (`packages/server/src/jsx-runtime.ts`), so `<input name="prce"/>` type-checks identically to the
   correct name; the mismatch surfaces only as a runtime 422 at submit. The only real enforcement,
   `formFields(form, [...])` (`packages/core/src/index.ts:615-619`), is opt-in and **called by zero
   examples**.
2. **String-keyed `form()` inference is unbacked → examples hand-duplicate the schema.** Generated
   artifacts augment only `QueryRegistry`/`InvalidationSets`, **never `MutationRegistry`**
   (`examples/commerce/src/generated/touch-graph.ts:69-77`). So `RegistryMutationInput<Key>` /
   `RegistryMutationFailure<Key>` fall back to `JsonValue`, forcing hand-written type args that
   restate the schema and can silently drift:
   ```ts
   // examples/commerce/src/components/product-grid.tsx:22 — duplicate of app.ts:436 schema
   const addToCartForm = form<
     'cart/add',
     { productId: string; quantity: number },
     { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
   >('cart/add');
   ```
3. **CSRF disabled on real browser forms.** SPEC §6.6 (line 652) reserves `csrf: false` for non-browser
   / externally-authenticated endpoints, yet `examples/crm/src/mutations.ts` (addContact, createDeal,
   moveDeal, closeDeal) and `examples/stackoverflow/src/mutations.ts` (postQuestion, postAnswer,
   voteUp) all set `csrf: false` on ordinary browser forms. Only commerce does it correctly.
4. **Failure shape is split across docs and code.** §6.3 render state (lines 587, 559) uses
   `failure.payload` / `fieldErrors`; the §6.3 programmatic `ctx.submit` onError (lines 572-574) uses
   `err.data` / `fields`. Current implementation is also split: component declared failures use
   `.payload`, component validation failures and `FormValidationFailure` use `.fields`, and runtime
   `ctx.submit` / `parseMutationFailure` tests use `.data` / `.fields`.
5. **Typed failure rendering demonstrated in only one app.** Only commerce reads
   `forms.<mutation>.failure` and renders error UI; crm/stackoverflow define no `errors` schema and
   render nothing on failure, so the §9.2 "no-JS fallback with typed failure state" promise is
   under-demonstrated.
6. **Repeated enhanced forms without `key` remain in examples.** SPEC §6.3 (lines 589-592) says a
   repeated enhanced form with no stable key is a teaching diagnostic. The compiler already has the
   traversal and existing KV238 coverage for repeatable typed enhanced mutation forms, but the crm
   move/close loops (`pipeline.tsx`, `deal-detail.tsx`) and the SO per-row `voteButton()` still need
   authored `key=` and verification.

**Goal:** make the form `name=` ⇄ schema join a real compile-time guarantee, wire mutation inference
so authors stop hand-duplicating types, fix the SPEC/example divergences, and prove the typed-failure
path in more than one app — without changing the clean authoring spelling.

## Decisions (locked)

- **The check is a compiler diagnostic, not just a TS type.** The HTML `name=` strings live in JSX
  the permissive `IntrinsicElements` index signature cannot constrain, so the binding-style check
  (KV227) is the model: run it in compiler lowering (editor-visible) **and** in `kovo check`. The
  KV242 diagnostic covers names-∈-schema + completeness +
  declared-coercion. `formFields()` stays as the importable-value escape for sites that build forms
  outside JSX, but is no longer the only enforcement.
- **`mutation={value}` stays the canonical spelling** (SPEC §6.3 line 580). The string-keyed
  `form('key')` helper must infer from an augmented `MutationRegistry`; hand-written `form<...>()`
  type args become unnecessary and are removed from examples.
- **One failure shape: `{ code; payload; fieldErrors? }`.** Migrate runtime/core/tests to the SPEC
  render-state shape: declared failures use `payload`; validation failures use
  `{ code: 'VALIDATION'; fieldErrors }`; programmatic `ctx.submit` and `parseMutationFailure` return
  the same shape. This is a code + docs migration, not docs-only.
- **CSRF on for all browser forms.** crm/stackoverflow adopt the commerce pattern; `csrf: false` is
  removed from browser mutations.
- **Scope = framework diagnostic + registry wiring + SPEC reconciliation + example fixes.** No change
  to the `<form enhance mutation={…}>` authoring surface.

## Established facts (verified this session)

- Implemented KV codes (compiler src, non-test): `KV201, 210-242, 301-304, 310-311, 320, 330,
402-409`. KV242 now anchors the form-field diagnostic; KV243+ remain free.
- `core/src/index.ts:541-619` defines `FormFieldName`/`CompleteFormFields`/`formFields` — a working
  compile-time completeness type, but opt-in and unused by every example.
- `core/src/index.ts:89-97` (`ComponentMutationForms`) types `forms.<m>.failure` correctly **when**
  the mutation's failure type is known; `RegistryMutationFailure<Key>` resolves via `MutationRegistry`.
- Generated `touch-graph.ts` augments `QueryRegistry` + `InvalidationSets` only — `MutationRegistry`
  is never populated, so string-keyed inference degrades to `JsonValue`.
- Compiler server emission already sees typed mutation forms: `packages/compiler/src/emit/server.ts`
  lowers `<form enhance mutation={value}>` in `enhancedMutationFormLowering`, and
  `packages/compiler/src/stamps.test.ts` covers local/imported mutation form lowering plus existing
  KV238 repeated-form diagnostics. The form-field check should extend this altitude or a nearby
  validation pass rather than inventing a separate source-string scan.
- `packages/compiler/src/emit/registry.ts` can emit `MutationRegistry` from supplied
  `registryFacts.mutations`, and compiler tests cover that path. The example/tutorial graph
  generators do not currently supply those mutation facts to their generated registry artifacts.

---

## Part A — Framework: the form-field diagnostic (critical path; do first)

- [x] **A0. Anchor the validation altitude.** Extend the existing compiler path that already sees
      typed mutation forms (`packages/compiler/src/emit/server.ts` or a nearby validation pass after
      JSX parsing) so KV242 uses parsed JSX/model facts. Evidence: name the traversal entry point and
      the tests proving it sees local and imported `mutation={...}` forms.
      - Evidence 2026-06-17: KV242 now runs inside
        `enhancedMutationFormRenderLowering()` in
        `packages/compiler/src/emit/server.ts`, the same traversal that lowers
        typed enhanced mutation forms and emits KV238. `packages/compiler/src/stamps.test.ts`
        proves the pass sees local `mutation={addToCart}` forms; the existing
        imported-form lowering fixture remains green and Part B owns
        registry-backed field facts.
      - Verified with
        `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/core/src/diagnostics.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts packages/compiler/src/spec-coverage-map.test.ts`,
        `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
        `node scripts/api-surface-gate.mjs`, and focused `git diff --check`.
- [ ] **A1. Emit/collect mutation input field facts.** Add a typed fact surface for mutation input
      fields: name, required/optional/defaulted, declared coercion kind, and source span/provenance.
      Populate it from `mutation()` definitions and generated registry facts, not source strings.
      - Progress 2026-06-17: local `mutation()` definitions now produce
        compiler-owned field facts from the TypeScript AST for `input:
        s.object({ ... })`, including field name and defaulted-vs-required
        status. Cross-module/generated registry field facts, coercion kind, and
        source-span/provenance remain open.
- [ ] **A2. Resolve the bound mutation's input schema at a `<form>`.** From `mutation={value}`
      (importable) resolve the `s.object` field set + required/optional + declared coercions; from the
      string-keyed `form('key')`/`mutationFormAttributes` path resolve via the registry (Part B).
      Decide from typed model facts, not source strings (SPEC §5 line 386).
      - Progress 2026-06-17: local `mutation={value}` forms resolve to local
        `s.object` field facts. Imported mutation values still lower for action
        stamps through existing registry facts, but field validation waits for
        Part B's generated `MutationRegistry`/field facts.
- [ ] **A3. Emit KV242.** For each enhanced `<form>` in v1 scope, collect literal descendant
      successful controls (`input`, `select`, `textarea`, including `type="hidden"` and submitter
      controls with `name`). Error on name ∉ schema, missing required field (completeness), and
      undeclared coercion for a non-string field. Define unsupported/dynamic cases explicitly:
      external `form="id"` controls, spread/dynamic `name`, file inputs, repeated names,
      checkbox/radio/multiple-select, and dotted/bracket paths either need a deliberate v1 rule,
      diagnostic, or documented escape. Teaching message shows the schema field set and the
      offending/missing name — mirror KV227's fix-menu tone.
      - Progress 2026-06-17: KV242 emits for literal descendant
        `input`/`select`/`textarea`/`button` controls with static `name` values,
        including hidden inputs and submitter-capable controls, and skips
        disabled controls. It reports name-not-in-schema and missing required
        local mutation fields with the expected field set in the message.
        Dynamic/external/repeated/file/dotted/bracket/coercion-specific cases
        remain open.
- [ ] **A4. Tests (red→green).** Compiler unit fixtures: wrong name, missing required field, extra
      field, hidden-field name match, coercion-declared-once, disabled/control-scope behavior, dynamic
      name escape/diagnostic, submitter `name`, and a green fixture for the corrected commerce form.
      Evidence: new `*.test.ts` in the compiler suite.
      - Progress 2026-06-17: `packages/compiler/src/stamps.test.ts` covers
        wrong names, missing required fields, hidden-field matching, and a green
        defaulted-field case for local mutation forms. The broader A4 fixture
        matrix remains open.
- [x] **A5. SPEC + diagnostics catalog.** Add KV242 to SPEC §6.2/§6.3 (assign the code the prose
      already promises) and to every diagnostic surface: `DiagnosticCode`, `diagnosticDefinitions`,
      `compilerDiagnosticTeachingSchemas`, diagnostic coverage matrix, SPEC diagnostic table,
      `spec-coverage-map` where applicable, and the docs/catalog surface used by `kovo explain`.
      - Evidence 2026-06-17: `SPEC.md` §6.2 and the diagnostic table now name
        KV242; `packages/core/src/diagnostics.ts` registers the code,
        definition, and teaching schema; `packages/core/src/diagnostics.test.ts`
        snapshots the registry; and
        `packages/compiler/src/diagnostic-coverage-matrix.test.ts` includes a
        positive/negative KV242 row. `spec-coverage-map` remains green without a
        dedicated mapping change.
      - Verified with
        `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/core/src/diagnostics.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts packages/compiler/src/spec-coverage-map.test.ts`,
        `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
        `node scripts/api-surface-gate.mjs`.

## Part B — Framework: wire `MutationRegistry` so inference works

- [ ] **B1. Feed mutation facts into generated registries.** Extend the actual example/tutorial
      graph generators (for example `examples/*/scripts/emit-graph.mjs`, tutorial registry emitters,
      and any app-shell graph emitters) so their emitted `declare module '@kovojs/core'` blocks include
      `MutationRegistry` entries. Prefer mapping each mutation key to `typeof <mutationDefinition>`
      when importable, because `core` already derives input/failure from server-style mutation value
      types; use explicit `{ input; failure }` facts only where the value type cannot be named.
- [ ] **B2. Verify inference end to end.** A type-level test (or `tsc` assertion) that `form('cart/add')`
      with no explicit type args yields the same `input`/`failure` as `form<...>()` does today, and
      that a schema rename propagates (drift turns the consumer red). Evidence: the assertion file.

## Part C — Example fixes (after A+B; commerce → crm → stackoverflow)

- [ ] **C1. Drop hand-written `form<...>()` type args.** Replace with bare `form('key')` (now
      inferring via B1) in `product-grid.tsx:22`, `app.ts:377`, `crm/src/forms.ts`, and the SO forms;
      delete the duplicated input/error type aliases. Existing suites stay green.
- [ ] **C2. Sweep tutorials/templates or explicitly defer.** Remove duplicated
      `form<'cart/add', ...>()` type args from tutorial steps and templates that participate in the
      same generated registries, or record a deliberate out-of-scope note with the follow-up owner.
- [ ] **C3. CSRF on.** Remove `csrf: false` from crm + stackoverflow browser mutations; adopt the
      commerce `csrf:` + `csrfField(...)` pattern at each render site, and update comments,
      interactive apps, and fixtures/tests that posted without the token.
- [ ] **C4. Typed failure rendering in crm + SO.** Add at least one `errors:` schema (e.g. a
      validation/conflict code) and render `forms.<mutation>.failure` in those components, proving the
      §9.2 path beyond commerce.
- [ ] **C5. Keyed repeated forms.** Add `key=` to the crm move/close loops and the SO per-row
      `voteButton()`; verify the existing KV238 repeated-form check accepts the corrected examples.

## Part D — SPEC reconciliation

- [ ] **D1. Migrate core/runtime/server failure types.** Change `FormValidationFailure`,
      `MutationErrorFailures`, `componentMutationFailureSlots`, `parseMutationFailure`, and
      `ctx.submit` tests so all public form failure state uses `{ code; payload; fieldErrors? }`.
      Declared mutation failures carry `payload`; schema validation carries
      `{ code: 'VALIDATION'; fieldErrors }`.
- [ ] **D2. Fix the failure-shape contradiction.** Update SPEC §6.3 lines 572-574 so the
      programmatic `ctx.submit` onError union uses `payload` / `fieldErrors` (matching lines 587/559
      and the migrated impl), not `data` / `fields`.
- [x] **D3. Cite KV242** wherever §6.2/§6.3 currently promise the form-field check in prose.
  - Evidence 2026-06-17: `SPEC.md` §6.2's typed-surface form-field row now
    cites KV242, and the SPEC diagnostic table includes KV242 for enhanced
    mutation form control/schema mismatches.
  - Verified with
    `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/core/src/diagnostics.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts packages/compiler/src/spec-coverage-map.test.ts`.

---

## Risks

- **Typed field-fact extraction (high).** The compiler can see mutation forms, but KV242 needs
  mutation input field metadata (required/optional/coercion) as typed facts. If value imports cannot
  be resolved in-process, generated `MutationRegistry`/field facts become the cross-module source.
- **Schema resolution across modules (med).** Resolving `mutation={addToCart}` → its `s.object` field
  set requires following the import to the typed definition; reuse the existing mutation-resolution
  the wire/registry already does, don't re-parse source (SPEC §5 line 386).
- **Failure-shape migration churn (med-high).** Moving runtime/core/tests from `data`/`fields` to
  `payload`/`fieldErrors` crosses public types, parser tests, server component failure rendering, and
  examples. `check:api-surface` changes are expected and must be deliberate.
- **Coercion completeness (med).** "Coercion declared once" for non-string fields (numbers, dates)
  must match the schema's declared coercion, not guess from `type="number"`.
- **Registry augmentation churn (med).** B1 touches generated artifacts + possibly core types;
  `check:api-surface` baseline updates deliberately. Re-run `emit-*` and keep fixpoint/conformance
  green.
- **Example test drift (low-med).** C3's CSRF flip changes POST fixtures; expect targeted test updates.

## Verification

- Part A: compiler unit fixtures (A4) red→green; `pnpm run check`, `check:api-surface`.
- Part B: `tsc` type-assertion (B2); regenerate artifacts, `check:kovo` + `test:conformance`.
- Part C: per-example suites green (`examples/commerce/src/app.add-to-cart.test.ts`,
  `crm`/`stackoverflow` app tests); `vp test` per example; `vp check --no-fmt`.
- Part D: core/server/runtime failure-shape tests green; docs/diagnostics-catalog link-check; SPEC
  self-consistency and repo search showing no public form failure examples use `data`/`fields`.
- Commit at checkpoints: A (diagnostic), B (registry), then one commit per fixed example, then SPEC.
