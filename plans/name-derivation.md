# Plan: Derive component names (drop the required `component('name', …)` string)

Created 2026-06-16. Behavioral source of truth is `SPEC.md`; this ledger sequences the work and
records evidence. Update `SPEC.md` (not just this plan) where the component-identity contract changes.

## Goal & framing

Today every component carries an explicit wire-name string:

```tsx
export const CountBadge = component('count-badge', {
  fragmentTarget: true,
  queries: { count: countQuery },
  render: ({ count }) => <count-badge kovo-fragment-target="count-badge">…</count-badge>,
});
```

That string is a **residual string the compiler can derive** — exactly what `SPEC.md` §4.8 forbids
requiring in TSX: _"a residual string may be validated in emitted IR, but TSX never requires a string
the compiler can derive from a typed expression."_ The component name is the most prominent remaining
violation. Goal: make the name **derived by default**, keep an **explicit override** for the cases
that genuinely need a decoupled identity, and preserve today's **type-level name** via codegen.

### What the string is (constraints any replacement must satisfy)

The string is the component's **wire name**, and it is load-bearing in shipped artifacts:

- `kovo-c` stamp / dashed host tag — the morph identity in served HTML (§4.2). The compiler **omits
  `kovo-c` when the host tag already spells the name** (`<cart-badge>`) and emits it on native hosts
  (`<tr kovo-c="cart-row">`). Any derived name must keep this optimization coherent.
- fragment-target name (`kovo-fragment-target`, registry-keyed; §4.5, §9.1).
- CSS `@scope` host selector (§13.1) and view-transition names.
- registry uniqueness key — the **KV237** (duplicate component effective wire name) and **KV238**
  (duplicate fragment-target wire name) diagnostics, plus the recent wire-name/query-shape facts
  (commits `6a7ab011`, `e606ae1e`).
- the type-level `Name` in `Component<Name, Definition>`, which flows into augmented registries
  (`FragmentTargets`, etc.) keyed by name.

### Decisions (locked with maintainer, 2026-06-16)

- **Scope: pure derivation, NO override (revised 2026-06-16, supersedes the earlier "Option D").**
  `component(definition)` takes only the definition object — there is **no `name` field at all** and
  the bare `component('name', …)` positional form is removed. The component name is *always* derived;
  there is one way to author and zero authored name strings. Rationale: with auto-disambiguation for
  DOM-leaf collisions (below), every former override use case collapses into "name the binding well":
  native hosts still derive the leaf from the binding and emit it as `kovo-c` (the dashed-vs-native
  split only governs *whether* `kovo-c` is emitted, not its source); package prefixing is the binding
  name (`AcmeCartBadge` → `acme-cart-badge`, and the export name is already the public API); and
  collisions are resolved by the compiler, not the author. This is the strongest possible reading of
  SPEC §4.8 ("TSX never requires a string the compiler can derive"): not just *not required* —
  *not accepted*. An override remains a future-additive, non-breaking escape hatch if a real authoring
  case (e.g. a kebab-casing edge the algorithm gets wrong) ever demands a decoupled name.
- **Default source: module path + binding identifier.** The exported binding (`CountBadge` →
  `count-badge`) gives the human-meaningful leaf and disambiguates multiple components in one file
  (e.g. `packages/ui/src/alert-dialog.tsx` exports 5). The module path supplies a namespace that
  makes names unique across files/packages without author effort.
- **Types: codegen augmentation.** The compiler already emits registry `.d.ts` facts (§14, "the only
  codegen is trivial registry `.d.ts` files"); extend that to key `FragmentTargets` and a
  name→component map off the derived names. Correct-after-build, like route typegen.

### SPEC alignment

This is a SPEC-conformance change, not a divergence: §4.8 general rule, §3 "source-derived names"
posture (§ lines 60, 344), and the §11 "declare facts once → derive every surface → validate residual
strings against generated registries" principle all point here. `SPEC.md` §4.2 and the `component()`
signature text must be updated to describe derivation + override.

## Name format — LOCKED: Option 2 (split identities), 2026-06-16

Two derived values, because DOM identity and registry uniqueness are different problems with
different constraints (the DOM wants the shortest stable morph anchor; the registry wants global
uniqueness):

- **DOM wire name = binding leaf** (`CountBadge` -> `count-badge`). This is the `kovo-c`/host-tag
  identity. Because it still equals the dashed host tag `<count-badge>`, the §4.2 kovo-c-omission
  rule keeps firing and **served HTML, CSS `@scope` selectors, view-transition names, and semantic
  snapshots are unchanged**. Native hosts still emit the leaf explicitly (`<tr kovo-c="cart-row">`).
- **Registry/type key = module path + binding leaf** (`counter/count-badge`). Internal/type-layer
  only — never reaches the DOM. KV237/KV238 collision checks and the generated `FragmentTargets` /
  name->component map key on this, so cross-file / cross-package leaf collisions auto-namespace away
  instead of erroring.

Rejected — **Option 1 (single combined wire name)**: would put `counter/count-badge` in `kovo-c`
everywhere, defeating §4.2 omission, rewriting all served HTML, and forcing a CSS-safe separator into
DOM-facing names. Only attractive if dashed hosts were abandoned (a §3.1-level reversal — out of scope).

### Sub-decisions (Option 2)

- [x] **Path root — LOCKED (2026-06-16): package-`src/`-relative.** The registry-key namespace is the
  module's path relative to the nearest enclosing package `src/` (and the `tests/integration/fixtures/`
  root for integration fixtures). Stable regardless of where the repo is checked out; independent of
  monorepo layout above the package.
- [x] **Path namespace composition — LOCKED (2026-06-16): full-path-mechanical (filename included).**
  Registry key = `<path rel. to src/, dirs + filename minus ext>/<leaf>`, no collapse special-case.
  So `ui/src/alert-dialog.tsx` + `AlertDialogTrigger` → `alert-dialog/alert-dialog-trigger`;
  `fixtures/counter/count-badge.tsx` + `CountBadge` → `counter/count-badge/count-badge`. Stutter is
  accepted because the key is type-layer only (never DOM/CSS-facing). Rationale: the filename is the
  only distinguisher for two same-leaf components in one directory; including it makes the registry
  key uniquely identify (file, binding) and reserves KV237 collisions for genuine duplicates.
  Consequence: registry-key uniqueness no longer implies DOM-leaf uniqueness — see the collision item.
- [x] **Separator — LOCKED (2026-06-16): `/`.** Joins namespace segments and leaf in the registry
  key. Mirrors the path it's derived from; type-layer only, so no CSS-safety constraint; won't be
  confused with binding dot-paths (`cart.count`).
- [x] **DOM-leaf collision — LOCKED (2026-06-16): auto-disambiguate, stably.** When two distinct
  components (distinct registry keys, e.g. `tabs/root` and `accordion/root`) would render the same
  short DOM leaf onto one page, the compiler emits a disambiguated `kovo-c` automatically — no error,
  no author action. **Constraint: the disambiguated value MUST be derived from a stable source (the
  registry key), never a build-order index**, so the wire name is reproducible across builds and
  in-flight clients don't mismatch mid-deploy. Detection runs in the page/graph composition pass
  (per-rendered-page DOM leaves), distinct from the per-module registry pass that powers KV237/KV238.
  **Disambiguated form — LOCKED (2026-06-16): the full registry key** (e.g. `kovo-c="accordion/root"`).
  Trivially stable across builds, already unique, and self-documenting in the Elements panel.
- [x] **Override semantics — REMOVED (2026-06-16): no overrides.** See the revised scope decision;
  there is no `name` field, so there is nothing to specify here. (Kept as a future-additive option.)

## Implementation slices

- [x] **Runtime API: single-arg `component(definition)`, no `name`** (`packages/core/src/index.ts`).
  - Remove the positional `name` parameter and do not add a `name` definition field. The descriptor
    still exposes a `name`, injected by the compiler when derived. Collapse `Component<Name, Definition>`
    so `Name` no longer comes from a literal arg (it is recovered via codegen, not inference).
  - Update the JSDoc example (currently `component('app-counter', …)`) and `ComponentDefinitionInput`.
  - Evidence: `packages/core/src/index.ts` now exposes `component(definition)` and removes the
    literal `Name` generic from `Component`; `pnpm --filter @kovojs/core exec vitest run` and
    `pnpm --filter @kovojs/core exec tsc --noEmit` passed on 2026-06-16.
  - Evidence: `packages/compiler/src/compile.ts` injects the derived registry key onto the emitted
    descriptor as `ComponentBinding.name = "<registry-key>"`, while keeping the definition object free
    of any `name` field; `packages/compiler/src/compile-component.test.ts` verifies the emitted
    assignment. `packages/compiler/src/scan/parse.ts` no longer parses `component('name', { ... })`
    as a component model, and `packages/compiler/src/scan/parse.test.ts` verifies that legacy form is
    ignored by the compiler parser. `packages/core/src/index.test.ts` verifies the positional string
    call is a TypeScript error. `pnpm --filter @kovojs/compiler exec vitest run`, `pnpm --filter
    @kovojs/compiler exec tsc --noEmit`, `pnpm --filter @kovojs/core exec vitest run`, and `pnpm
    --filter @kovojs/core exec tsc --noEmit` passed on 2026-06-16.
- [ ] **Compiler: derive the name in lowering** (`packages/compiler/src/lower/structural-jsx.ts` and
  the component-model builder).
  - Derive from the exported binding identifier (the lowering already tracks `exportName`) + module
    path per the format decision. Inject the derived name into the component model + emitted descriptor.
  - Respect the §4.2 host-tag omission rule against the chosen DOM wire name.
  - Honor §11.3 post-parse discipline: derive from typed model facts/spans, not raw source
    (name-formatting of model-derived identifiers is explicitly permitted, §11.3 line 351).
  - Evidence: `packages/compiler/src/component-names.ts` derives DOM leaves and registry keys from
    `ComponentModel.localName` plus the module path; `packages/compiler/src/compile.ts`,
    `packages/compiler/src/css.ts`, `packages/compiler/src/emit/server.ts`, and
    `packages/compiler/src/graph.ts` thread those values through CSS, stamps, graph facts, and
    fragment-target facts. `pnpm --filter @kovojs/compiler exec vitest run` and
    `pnpm --filter @kovojs/compiler exec tsc --noEmit` passed on 2026-06-16.
  - Evidence: `packages/compiler/src/graph.ts` now carries `domName` in component graph facts and
    annotates duplicate DOM leaves with stable registry-key `disambiguatedDomName` facts during graph
    composition; `packages/cli/src/index.ts` prints those facts in `kovo explain component`.
    `pnpm --filter @kovojs/compiler exec vitest run`, `pnpm --filter kovo exec vitest run`, `pnpm
    exec vp run build`, and `node tests/kovo-check.node.mjs` passed on 2026-06-16.
  - Gap: the compiler still does not rewrite served page HTML/CSS to the disambiguated `kovo-c` in a
    per-rendered-page composition pass.
- [x] **Registry/type codegen** (registry `.d.ts` emission + `validate/component-names.ts`).
  - Emit `FragmentTargets` and a name→component map keyed off derived names; KV237/KV238 key on the
    derived (namespaced) key. Update `componentNameRegistration` to source the derived name.
  - Evidence: `packages/compiler/src/registry.test.ts` verifies generated `FragmentTargets` entries
    and component graph facts use derived registry keys such as
    `components/cart/cart-badge/cart-badge`; `packages/compiler/src/fragment-targets.test.ts` verifies
    KV238 keys on derived registry names; `packages/compiler/src/component-names.test.ts` verifies
    KV237 duplicate checks on derived registry names. `pnpm --filter @kovojs/compiler exec vitest run`
    passed on 2026-06-16.
  - Evidence: `packages/compiler/src/emit/registry.ts` now emits `ComponentRegistry` and augments
    `@kovojs/core` with derived registry keys from the local component plus graph registry facts;
    `packages/core/src/index.ts` exposes the augmentable `ComponentRegistry` merge target.
    `packages/compiler/src/compile-component.test.ts`, `packages/compiler/src/registry.test.ts`, and
    `packages/core/src/index.test.ts` verify the emitted map and core merge target. `pnpm --filter
    @kovojs/compiler exec vitest run` and `pnpm --filter @kovojs/core exec vitest run` passed on
    2026-06-16.
- [ ] **Diagnostics.**
  - Repoint KV237/KV238 messaging (`packages/core/src/diagnostics.ts:339,348`) away from
    "give one component a distinct `component(\"wire-name\")` value" — with derivation there is no
    string to change, so the fix is "rename the binding" (or move the file). KV237 now fires only on a
    genuine duplicate registry key (same file path + same binding leaf is impossible; this catches
    cross-path key clashes that survive full-path namespacing).
  - Evidence: `packages/core/src/diagnostics.ts` now points KV237/KV238 fixes at binding renames,
    module moves, or fragment-target removal; `pnpm --filter @kovojs/core exec vitest run
    src/diagnostics.test.ts` passed on 2026-06-16.
  - [ ] Auto-disambiguation reporting: when the DOM-leaf collision pass rewrites a `kovo-c`, surface
    it in `kovo explain component` (no error, but it must be inspectable — a silent wire-name change is
    exactly what the "no silent caps" discipline forbids).
    - Evidence: graph-level reporting plumbing exists: `ComponentExplain` accepts `domName` and
      `disambiguatedDomName`, `deriveAppGraph` derives stable registry-key disambiguation facts for
      duplicate DOM leaves, and `kovo explain component` prints `dom-name:` /
      `effective-dom-name:`. Verified by `packages/compiler/src/registry.test.ts`,
      `packages/cli/src/index.kovo-explain.test.ts`, `pnpm --filter @kovojs/compiler exec vitest run`,
      `pnpm --filter kovo exec vitest run`, and `node tests/kovo-check.node.mjs` on 2026-06-16.
    - Gap: still no page-level rewrite pass that changes the actual emitted `kovo-c`, so this remains
      open.
  - [ ] New diagnostic: a derived name that **changed** vs. the last emitted registry fact (wire names
    are deploy-load-bearing; a silent change breaks morph identity for in-flight clients). Decide
    severity (warn vs. error) and whether it gates only when fragmentTarget/cross-build matters.
- [x] **Migrate call sites off the positional string.**
  - Fixtures: `tests/integration/fixtures/{counter/count-badge,stock/stock-badge}.tsx`.
  - `packages/ui/src/*.tsx` (~30 components, multi-per-file — the binding-leaf derivation must hold
    here) and `packages/ui/scripts/build-registry.mjs:60` (regex scans `component('name', …)` — update
    to the new form).
  - Conformance/compat corpora and any `component('…'` in tests.
  - Evidence: `rg -n "component\(\s*(['\"])" --glob '!plans/name-derivation.md'` now returns only
    generic `component(` sentinels plus negative tests in `packages/compiler/src/scan/parse.test.ts`
    and `packages/core/src/index.test.ts` that assert the old positional form is rejected; no authored
    call sites remain. `node packages/ui/scripts/build-registry.mjs` passed on 2026-06-16; `pnpm
    --filter kovo exec vitest run src/index.kovo-add.test.ts` passed on 2026-06-16.
- [ ] **SPEC update.** §4.2 (identity + kovo-c omission against derived name), the `component()`
  signature/description, and §14 codegen note. Cite this plan.
  - Evidence: `SPEC.md` §4.1 now specifies single-argument `component(definition)` and derived DOM
    leaf/registry key split; §4.2 documents host-tag omission against the derived DOM leaf and stable
    collision disambiguation; §6.1 documents derived registry keys; §11.3 diagnostic summaries and
    §13.1 CSS text use derived registry/DOM identity. `node tests/kovo-check.node.mjs` passed on
    2026-06-16.
  - Evidence: `SPEC.md` §6.1.1 now says package prefixes affect package behavior/provenance
    vocabulary and that component DOM leaves remain binding-derived; packages encode public prefixes
    through exported binding names. `rg -n "wire name|wire-name|component name string|component\(\)|ComponentRegistry|registry key|derived DOM|package prefix" SPEC.md site/content docs packages/core/src/index.ts`
    inspected the remaining identity wording on 2026-06-16.
  - Gap: the SPEC text still does not cite this plan explicitly.
- [x] **Docs.** `docs/integration-testing.md` fixtures and any authoring docs showing the string form.
  - Evidence: `rg -n "component\(\s*(['\"])" docs site/content site/tutorial
    packages/create-kovo/templates examples -g '*.md' -g '*.ts' -g '*.tsx' -g '*.mjs'` returned no
    results on 2026-06-16; `docs/integration-testing.md` uses current fixture/component guidance.

## Verification

- [x] `pnpm --filter @kovojs/compiler exec vitest run` (lowering + component-names + conformance).
  - Evidence: passed on 2026-06-16.
- [x] `pnpm --filter @kovojs/core exec vitest run` (descriptor shape, `FragmentTargets` typing — see
  `packages/core/src/index.test.ts:56,277`).
  - Evidence: passed on 2026-06-16.
- [x] Integration suite (`tests/integration`) green — served HTML / semantic snapshots unchanged under
  Option 2 (or snapshots intentionally updated under Option 1).
  - Evidence: `pnpm run test:integration` passed on 2026-06-16 (6 Playwright tests).
- [x] `kovo-check` post-parse guard still passes (no new raw-source reads).
  - Evidence: `node --test --test-name-pattern "post-parse compiler phases"
    tests/kovo-check.node.mjs` passed on 2026-06-16.
- [x] Full `kovo-check` passes with derived registry-key expectations.
  - Evidence: `node tests/kovo-check.node.mjs` passed on 2026-06-16.
- [x] Built `.d.ts` registry facts inspected: derived names present, fragment-target keys typed.
  - Evidence: `node tests/kovo-check.node.mjs` test "P1 fragment targets emit typed registry facts"
    passed on 2026-06-16; its generated registry consumer fixture uses
    `fragmentTarget('cart-row/cart-row', { rowId: 'row-1' })` and rejects missing, mistyped, and
    undeclared props.

## Risks

- Wire-name churn in shipped HTML if Option 1 is chosen — breaks morph identity across a deploy
  boundary; Option 2 avoids it.
- Type-level name only correct after a build (inherent to codegen augmentation) — ensure DX/order so
  `FragmentTargets` checks don't flake pre-build.
- Default/anonymous exports have no binding to derive from — require the `name` override (diagnostic).
- `packages/ui` multi-per-file is the stress case for binding-leaf derivation; validate early.
