# Reactive UI: island-local state → DOM update plan (Jiso §4.8 for `state`)

Status: **open — design complete, not started.** Created 2026-06-14. Split out of `plans/fix-ui.md`
Phase 1 (the long pole). `SPEC.md` is the source of truth; cite §4.8 (the update plan), §4.4 (the
loader's responsibilities), §4.9 (update coverage), §6.2 (binding type-checks). This is the framework
subsystem that makes a component's DOM update when its own island-local `state` changes — today that
works only for **queries**.

## Goal

**A component handler that only mutates `ctx.state` reflects to the DOM automatically** — attributes
and text that read `state.*` re-render via the §4.8 update plan (bindings → derives → stamps), with no
hand-authored `getElementById`/`setAttribute`. Proven by: `switch`, `toggle`, `disclosure`, `checkbox`
become functional in the no-shim Playwright harness with their handlers reduced to a single state
mutation; the existing imperative demos keep working unchanged; all compiler gates (fixpoint, update
coverage, gzip budget) stay green.

Phase 1 is intentionally scalar and same-island: pure state paths, state-only attribute/text derives,
and correct same-island scoping. State list stamps, mixed query+state derives, and primitive helper
binding emission are follow-up phases unless a target demo cannot be made spec-conformant without one
of them.

## Background: the gap (verified in source)

SPEC §4.8: _"When a query value — **or island-local state; same machinery, two data sources** —
changes, the loader runs, in order: bindings → derives → stamps."_ SPEC §4.4 lists, as a loader
responsibility: _"Update plan (bindings → derives → stamps, §4.8) on query/**state** change, by
walking the self-describing attributes."_

Reality today (read 2026-06-14):

- **Lowering only sees queries.** `packages/compiler/src/lower/inline-derives.ts`
  (`lowerInlineAttributeDerives`) computes `knownQueryNames(...)` and **returns early when there are no
  queries**, so a JSX read of `state.checked` is never lowered to a `data-bind`/derive. The
  text-stamp/attr-derive paths are all query-gated.
- **Analysis keys on query names.** `packages/compiler/src/analyze/query-updates.ts`
  (`collectQueryUpdatePlans`, `collectQueryUpdateCoverage`) groups bindings by `query` name only;
  there are no state binding/coverage facts.
- **The loader never applies state bindings.** The inline 4KB loader
  (`packages/runtime/src/inline-loader-build.ts`, `dispatch`) writes `fw-state` and stops — it does
  **not** walk bindings (grep: 0 `data-bind` references). Client binding application lives in the full
  loader (`packages/runtime/src/query-bindings.ts` `applyQueryBindings`/
  `applyCompiledQueryUpdatePlan`), and is wired only for the **query** store via the bootstrap
  (`emit/bootstrap.ts` → `installJisoLoader({ queryPlans })`).

Net: `state.checked` flips, `fw-state` updates, but `aria-checked`, `data-state`, and `{state.checked
? 'on':'off'}` text stay frozen at their server-rendered values. The demos that "work" hand-write the
DOM updates in the handler (verbose, duplicated, e.g. tabs forgot to read `event.key`).

This is **not** "add client signals": SPEC §4.4 explicitly rejects "runtime signal graphs in the core
client … the client dependency graph is compile-time-known, so the compiler emits a per-query update
plan instead." Reactive UI = teach that same compile-time plan + DOM-walk that `state` is a second
input source.

## What already exists and is reusable (mirror it for `state`)

- **Derives already carry a declared input.** `QueryDeriveFact` (`packages/compiler/src/types.ts`) is
  `{ expression, exportName, input, name, param, selector }`. A state derive is the same shape with
  `input: 'state'` and `param: 'state'`. SPEC §4.8: "Declared inputs tell the loader which … changes
  re-run it."
- **The binding-application core is source-agnostic at heart.** `query-bindings.ts` `applyQueryBindings`
  walks `[data-bind]` (→ `textContent`) and `[data-bind:<attr>]` (→ `setAttribute`) and runs derives.
  Only the **value resolver** (query store) is query-specific; a `state` resolver (read the island's
  parsed `fw-state`) slots in.
- **Binding grammar is defined** (SPEC §4.8): `data-bind="path"` text; `data-bind:<attr>` attribute;
  null-aware `?.` paths; inline expressions lower to named derives. Reuse verbatim, with a reserved
  root segment for state (below).
- **Coverage gate exists** (`collectQueryUpdateCoverage`, §4.9 / FW311) — extend to state reads.
- **Fixpoint/IR + minification-safe named exports** already hold for query derives; state derives are
  the same emission shape, so the parity/fixpoint gates extend rather than being rebuilt.

## Design

### D1. Binding representation — reuse `data-bind`, reserve the `state` root

Author writes `{state.checked}` / `aria-checked={state.checked ? 'true' : 'false'}`. Lower to the
**same** attributes the query path uses, with the path rooted at the reserved segment `state`:

```html
<input data-bind:aria-checked="/c/switch.client.js#Switch$ariaChecked" data-bind:data-state="…" />
<output data-bind="state.checked"></output>
<!-- pure path, boolean→text via format -->
```

- The loader's value resolver dispatches on the **root segment**: `state` → read the island's parsed
  `fw-state`; any other root → the query store (unchanged). `state` becomes a reserved binding root
  (it already names the render param, so no authoring surprise). Validate no query may be named
  `state` (compile error if so).
- Inline expressions → named derives with `input: 'state'`, `param: 'state'`, receiving the parsed
  state object. Same lazy-load + non-renamable export rules as query derives.
- Mixed-source inline expressions (`state.open && cart.count > 0`) are **not** Phase 1 lowering
  targets. They must be classified as uncovered/unsupported until the framework grows multi-input
  derives, because a state-only derive would silently miss query updates and a query-only derive would
  silently miss state updates.
- Boolean-presence attributes (`hidden`, `disabled`, `required`, etc.) must not lower to raw
  `"false"` strings. Direct path bindings are valid for text, reflected string attributes, ARIA, and
  `data-*`; presence attributes lower through derives that return a present value or `null`/`undefined`
  so the loader removes the attribute per SPEC §4.8 empty semantics.
- This keeps "a merged element is indistinguishable from one written by hand" (Constitution #3/#4): the
  wire shows ordinary `data-bind` attributes.

_Decision to confirm during impl:_ unified `data-bind` with a reserved root (above, preferred — matches
SPEC "same machinery") vs. a distinct `data-bind-state` family. Prefer unified unless the resolver
ambiguity (query vs state root) proves messy.

### D2. Lowering — emit state bindings/derives

- [ ] Add `state` expression detection alongside the query path in `scan/parse.ts` / a new
      `lower/inline-state-derives.ts` (mirror `lower/inline-derives.ts`): recognize JSX text and
      attribute expressions whose only reactive root is `state`, and lower them to
      `data-bind`/`data-bind:<attr>` + named derives. Do **not** early-return on "no queries".
- [ ] Reject or classify mixed query+state expressions as unhandled coverage in Phase 1; do not emit a
      single-input derive for an expression that depends on two update sources.
- [ ] Lower boolean-presence attributes through null-removing derives instead of direct path bindings
      that would serialize `false` as a still-present attribute.
- [ ] **Spread caveat (the switch bug).** `{...switchRootAttributes({ checked: state.checked })}`
      hides the `state` dependency behind an opaque helper call — the compiler cannot see it. Phase 1
      handles this by **migrating the 4 target demos** to bind state-dependent attributes as direct
      expressions the compiler can analyze only where that does not violate SPEC §4.6 primitive-owned
      attribute rules. If a target attribute is primitive-owned (`data-state`, primitive ARIA), either
      pull in the minimal primitive-binding emission needed for that slot or leave the direct override
      lint-visible; do not normalize a FW232 violation as the long-term shape. The general "make
      primitive composition emit the bindings" is Phase 2 of `plans/fix-ui.md` (§4.6 attrs-function
      chaining), out of scope here unless required for spec-conformant acceptance.
- [ ] Classification mirrors §4.8: sole-text-child expression → stamp that element; mixed content →
      synthesized `<span data-bind>` (reported in `fw explain`); attribute position → named derive.

### D3. Analysis — state binding facts, not a runtime plan

- [ ] Add state binding/coverage facts in `analyze/query-updates.ts` or a sibling
      `analyze/state-updates.ts` for type-checking, diagnostics, and `fw explain` only. Do **not** emit
      or depend on a separate runtime `StateUpdatePlanFact`; SPEC §4.8 says the DOM is the plan and
      there is no separate compiled-plan artifact.
- [ ] Runtime identity for state updates is the nearest `[fw-state]` host, not `fw-c`: SPEC §4.2 allows
      omitting `fw-c` when the host tag spells the component name, and nested stateful islands must not
      be updated by an ancestor's state mutation.
- [ ] Defer `data-bind-list="state.items"` until after scalar state bindings are proven. When it lands,
      reuse `fw-key` reconciliation and item-relative binding semantics verbatim.

### D4. Emit — derives + island wiring

- [ ] `emit/server.ts`: emit the `data-bind`/`data-bind:<attr>` attributes on the lowered element; mark
      the island host so the loader can scope the walk (the island already carries `fw-c` + `fw-state`;
      reuse, do not add a second marker — SPEC §4.6 "one element = one island").
- [ ] `emit/client.ts`: emit state derives as client-module exports (same module the handlers live in;
      `input: 'state'`).
- [ ] Do **not** add a `statePlans` bootstrap object. The inline and full loaders self-discover state
      bindings by walking `[data-bind]` / `[data-bind:*]` under the mutated `[fw-state]` host, keeping
      SPEC §4.8's DOM-as-plan contract intact.

### D5. Loader — apply state bindings on mutation (SPEC §4.4 responsibility)

The loader that runs in the gallery is the **inline 4KB loader**; it currently applies no update plan
at all. Two sub-decisions:

- [ ] **Where application lives.** SPEC §4.4 makes update-plan walking a loader responsibility, so add a
      minimal **state-binding walk** to the inline loader's `dispatch`: after
      `stateHost.setAttribute('fw-state', …)`, walk `stateHost`'s subtree for `[data-bind]` /
      `[data-bind:*]` whose path roots in `state`, recompute from the new state object, and set
      `textContent` / `setAttribute`. Pure-path bindings apply inline; **derive-backed** bindings
      lazy-`import()` the derive module (SPEC §4.8 "loads lazily on first relevant change"), keeping the
      always-loaded path small.
- [ ] **Gzip budget.** The inline loader has a 4KB gzip budget (`inlineJisoLoaderGzipByteBudget`); Phase
      0 left ~0.8KB headroom. Keep the inline walker to simple paths + a lazy derive hook; if it doesn't
      fit, lazy-load the whole state-apply module on first state mutation. Re-run the parity `--check`
      and budget assertion (`pnpm --filter @jiso/runtime build:inline-loader`).
- [ ] **Reuse, don't fork.** Factor the `applyQueryBindings` core in `query-bindings.ts` so the
      walk/format logic is shared and parameterized by a value resolver (`query` vs `state`); the full
      bootstrap loader gets the same state application for free.
- [ ] **Scope + identity.** Apply scoped to the mutated island's `fw-state` host subtree (not the whole
      document), and skip bindings whose closest `[fw-state]` is a nested island rather than the
      mutated host. Respect `?.` empty semantics (text → empty string, attribute → remove) exactly as
      the server renderer does (SPEC §4.8 FW222 drift rule).

### D6. Coverage — §4.9 exhaustiveness for state

- [ ] Extend `collectQueryUpdateCoverage` (FW311 / §4.9) to flag a JSX read of `state.*` in a DOM
      position that did **not** lower to a binding/derive (so nothing a handler mutates silently goes
      stale — this is exactly what hid the switch `<output>` bug). Decide FW311-extension vs. a
      state-specific sibling code; wire the diagnostic + fix-menu message (extract a named derive / bind
      directly).
- [ ] Before landing the diagnostic, resolve the SPEC wording mismatch: §4.9 and the FW311 table
      currently say "query-dependent" output. Preferred change is to broaden FW311 to
      query/state-dependent DOM positions while documenting that state positions have Phase 1 statuses
      `plan`, `isomorphic`, or `renderOnce`; `fragment` is not a state remedy unless SPEC later defines
      how client-private state participates in server fragments.

### D7. Backward compatibility with the imperative demos

- [ ] The ~20 imperative demos hand-write DOM and have **no** state bindings, so the new walk finds
      nothing to apply → they are unaffected (verify in the no-shim harness). Where a demo both
      hand-writes DOM **and** has a now-lowered `state` expression (e.g. an `<output>{state.x}>`), the
      compiler will start binding it; ensure no double-application conflict (the handler's manual write
      and the binding agree). Phase 3 of `plans/fix-ui.md` then deletes the redundant imperative code.

## Implementation checklist (sequence)

- [x] **S1 — Spike the loader walk in isolation.** Add a `state` resolver + shared apply to
      `query-bindings.ts`; unit-test `applyStateBindings(host, state)` against hand-written `data-bind`
      fixtures (no compiler yet). Proves the runtime half end-to-end.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts` exports
    `applyStateBindings(host, state)` and shares path/attribute formatting with query bindings;
    `packages/runtime/src/handlers.ts` applies it after delegated handler commit when the state host
    supports `querySelectorAll`; `packages/runtime/src/inline-loader-build.ts` contains the minimal
    inline pure-path state walker and regenerated `packages/runtime/src/inline-loader.ts`.
  - Verification 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run
    src/query-bindings.test.ts src/handlers.test.ts src/inline-loader-delegated.test.ts` passed
    36 tests; `pnpm --filter @jiso/runtime exec tsc --noEmit` passed; `pnpm --filter @jiso/runtime
    build:inline-loader` reported the generated loader unchanged after the final source cleanup.
- [x] **S2a — Lowering, text paths** (D2): `state.*` sole text children and mixed text expressions
      lower to `data-bind="state.*"` without creating a fake query plan.
  - Evidence 2026-06-15: `packages/compiler/src/lower/inline-derives.ts` recognizes `state.*` paths
    for text binding classification even when a component has no queries; `packages/compiler/src/
    analyze/query-updates.ts` and `packages/compiler/src/validate/bindings.ts` exclude the reserved
    `state` root from query-plan and query-shape handling.
  - Verification 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
    src/state-bindings.test.ts src/query-coverage.test.ts src/query-bindings.test.ts` passed
    29 tests; `pnpm --filter @jiso/compiler exec tsc --noEmit` passed.
- [ ] **S2b — Lowering, attribute derives** (D2): state-only attribute expressions lower to
      derive-backed `data-bind:<attr>`/client exports without emitting a runtime `statePlans` artifact;
      boolean-presence attributes remove on false/null rather than serializing `"false"`.
- [ ] **S3 — Analysis + coverage facts** (D3): state binding/coverage facts for diagnostics and explain
      output only; tests prove no emitted runtime `statePlans` artifact is required.
- [ ] **S4 — Emit** (D4): server attributes + client derives; fixpoint/IR parity holds
      (`assertFixpoint`/`assertRenderEquivalence` in the gallery emit path).
- [ ] **S5 — Loader application** (D5): wire the walk into the inline loader `dispatch`; regenerate
      `inline-loader.ts`; budget + parity `--check` green.
- [ ] **S6 — Coverage gate** (D6): FW311-for-state diagnostic + tests.
- [ ] **S7 — Migrate the 4 target demos** to declarative state binding (drop the helper-spread for
      state-dependent attrs where spec-conformant): `switch`, `toggle`, `disclosure`, `checkbox`.
      Handler bodies reduce to the state mutation (+ the primitive's `*TriggerClick` for the change
      contract where applicable). Do not hide primitive-owned attribute override lints; either avoid
      those direct writes or promote the minimal primitive-binding emission needed.
- [ ] **S8 — Re-emit the gallery** (`pnpm --filter @jiso/example-gallery emit:interactive-gallery`) and
      verify in the no-shim harness; update any demo-fixture/markup tests.

## Focused verification matrix

- [x] State-only component without `fw-deps` still updates from `fw-state` + `data-bind="state.*"`.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.test.ts` covers
    `applyStateBindings` on a plain `[fw-state]` host with text and attribute state bindings and no
    `fw-deps`; the focused runtime vitest command above passed.
- [x] Nested stateful islands do not cross-update: an ancestor state mutation skips descendant bindings
      whose closest `[fw-state]` is the descendant host.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.test.ts` and
    `packages/runtime/src/inline-loader-delegated.test.ts` both assert a descendant `[fw-state]`
    binding keeps its stale child value when the ancestor host applies state bindings; the focused
    runtime vitest command above passed.
- [x] A query named `state` is rejected before emission.
  - Evidence 2026-06-15: `packages/core/src/diagnostics.ts` defines FW304 for reserved query names;
    `packages/compiler/src/validate/component-contracts.ts` rejects `queries: { state: ... }` via the
    normal validation pipeline; `packages/compiler/src/state-bindings.test.ts` covers the diagnostic.
    Verification: `pnpm --filter @jiso/compiler exec vitest run src/state-bindings.test.ts` passed
    4 tests; `pnpm --filter @jiso/core exec vitest run src/diagnostics.test.ts` passed 3 tests.
- [x] Optional state paths use the same `?.` empty semantics as query paths (text → empty string,
      attribute → remove).
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.test.ts` asserts
    `state.deal.contact?.name` renders text as `''` and removes `aria-label`; the focused runtime
    vitest command above passed.
- [ ] Boolean-presence attributes such as `hidden` are added/removed via derives; no test accepts
      `hidden="false"` as a passing update.
- [ ] Mixed query+state expressions are rejected or reported as unhandled coverage until multi-input
      derives are designed.
- [x] Chained handlers update DOM from the final `ctx.state` value after all handler refs run.
  - Evidence 2026-06-15: `packages/runtime/src/handlers.test.ts` asserts modular delegated handlers
    update `data-bind="state.count"` after two chained refs mutate one context; `packages/runtime/src/
    inline-loader-delegated.test.ts` asserts the same for the readable, freshly minified, generated,
    and extracted inline loader installers; the focused runtime vitest command above passed.
- [ ] The four target demo client modules contain state mutation and derive exports only; no
      hand-authored DOM writes are needed for the state-bound slots.

## Acceptance criteria

- [ ] `switch`/`toggle`/`disclosure`/`checkbox` toggle visibly in the **unmodified** static export
      (no-shim Playwright): `aria-checked`/`aria-pressed`/`data-state`/`hidden`/`<output>` all update
      from a one-line state-mutation handler. Presence attributes like `hidden` are proven by
      add/remove behavior, not by serializing `"false"`.
- [ ] The generated client modules for those four contain **no** `getElementById`/`setAttribute` (state
      mutation only) — the inverse of the current "DECLARATIVE-ONLY → broken" taxonomy in
      `scratch/fix-ui-evidence.md`.
- [ ] All imperative demos still pass the no-shim harness (no regressions).
- [ ] Gates: runtime + compiler + gallery suites green; `vp check` clean; inline-loader gzip budget +
      parity `--check` green; gallery emit fixpoint (`assertFixpoint`) green; new
      state-coverage diagnostic has tests.

## Risks

- **Gzip budget (4KB inline loader).** The state walker must fit or lazy-load; biggest constraint. Plan
  D5 mitigates with simple-paths-inline + lazy derives.
- **Reserved-root ambiguity.** `state` as a binding root must not collide with a query named `state`;
  add a validation. Re-confirm the unified-`data-bind` vs `data-bind-state` decision early (D1) — it's
  load-bearing for the resolver.
- **Nested island bleed.** A subtree walk from an ancestor `[fw-state]` can see descendant islands.
  Loader tests must prove nearest-`[fw-state]` scoping before gallery migration.
- **Mixed query/state expressions.** Single-input derives cannot safely cover expressions that read two
  update sources. Phase 1 must classify them as unsupported/unhandled or explicitly defer them.
- **Boolean presence attributes.** Direct path writes can produce `hidden="false"` bugs. Presence attrs
  must use derives that remove on false/null.
- **Fixpoint / byte-stable IR.** State derives + `data-bind` attributes change emitted IR; the gallery
  emit asserts fixpoint and render-equivalence — extend fixtures, don't fight the gate.
- **Spread opacity.** Phase 1 sidesteps `{...helper(state)}` by migrating the 4 demos to direct
  expressions; the general primitive-composition binding is Phase 2 (`plans/fix-ui.md` §4.6 chaining)
  and must not regress this work.
- **Primitive-owned attrs.** Directly binding primitive-owned `data-state` / ARIA can violate SPEC §4.6
  FW232. Keep the violation visible or pull the minimum primitive binding emission into scope; do not
  bless direct overrides as the final design.
- **Double application.** A demo that both hand-writes DOM and gets an auto-binding could fight itself;
  D7 + the migration (S7) keep the four target demos binding-only.

## Out of scope (tracked elsewhere)

- Primitive `on:*` handler chaining / `*Attributes()` emitting bindings — `plans/fix-ui.md` Phase 2.
- Per-component demo rewrites beyond the 4 reactivity-blocked ones — `plans/fix-ui.md` Phase 3.
- Promoting the `@jiso/runtime` URL fix framework-wide — `plans/fix-ui.md` Phase 0 follow-up.

## Evidence / seams

- Gap confirmation + handler taxonomy: `scratch/fix-ui-evidence.md`.
- Query path to mirror: `lower/inline-derives.ts`, `analyze/query-updates.ts`, `types.ts`
  (`QueryDeriveFact`/`QueryUpdatePlanFact`), `runtime/src/query-bindings.ts` (`applyQueryBindings`).
- Loader seam: `runtime/src/inline-loader-build.ts` `dispatch` (writes `fw-state`, applies nothing);
  budget in `inlineJisoLoaderGzipByteBudget`; regen via `pnpm --filter @jiso/runtime build:inline-loader`.
- No-shim acceptance harness: `scratch/gallery-verify-noshim.mjs` (to be promoted to a CI gate in
  `plans/fix-ui.md` Phase 5).
