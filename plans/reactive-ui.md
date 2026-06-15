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
  there is no `state` plan.
- **The loader never applies a state plan.** The inline 4KB loader
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
- This keeps "a merged element is indistinguishable from one written by hand" (Constitution #3/#4): the
  wire shows ordinary `data-bind` attributes.

_Decision to confirm during impl:_ unified `data-bind` with a reserved root (above, preferred — matches
SPEC "same machinery") vs. a distinct `data-bind-state` family. Prefer unified unless the resolver
ambiguity (query vs state root) proves messy.

### D2. Lowering — emit state bindings/derives

- [ ] Add `state` expression detection alongside the query path in `scan/parse.ts` / a new
      `lower/inline-state-derives.ts` (mirror `lower/inline-derives.ts`): recognize JSX text and
      attribute expressions whose member-root is `state`, and lower them to `data-bind`/`data-bind:<attr>` + named derives. Do **not** early-return on "no queries".
- [ ] **Spread caveat (the switch bug).** `{...switchRootAttributes({ checked: state.checked })}`
      hides the `state` dependency behind an opaque helper call — the compiler cannot see it. Phase 1
      handles this by **migrating the 4 target demos** to bind state-dependent attributes as direct
      expressions the compiler can analyze (use the primitive helper only for static parts). The
      general "make primitive composition emit the bindings" is Phase 2 of `plans/fix-ui.md` (§4.6
      attrs-function chaining), out of scope here.
- [ ] Classification mirrors §4.8: sole-text-child expression → stamp that element; mixed content →
      synthesized `<span data-bind>` (reported in `fw explain`); attribute position → named derive.

### D3. Analysis — per-island state update plan

- [ ] Add `collectStateUpdatePlan(model)` in `analyze/query-updates.ts` (or a sibling
      `analyze/state-updates.ts`). Unlike queries (N named inputs), an island has **one** state object,
      so the plan is **per-component** (`fw-c`): the set of state-bound selectors + derives + list
      stamps to re-apply when that island's `state` changes. New facts:
      `StateUpdatePlanFact { componentName, paths, derives?, stamps?, templateStamps? }` in `types.ts`
      (parallel to `QueryUpdatePlanFact`, minus the `query` key).
- [ ] List stamps (`data-bind-list` over a `state` array) reuse `fw-key` reconciliation — include for
      completeness; most gallery state is scalar so this can land second.

### D4. Emit — derives + plan + island wiring

- [ ] `emit/server.ts`: emit the `data-bind`/`data-bind:<attr>` attributes on the lowered element; mark
      the island host so the loader can scope the walk (the island already carries `fw-c` + `fw-state`;
      reuse, do not add a second marker — SPEC §4.6 "one element = one island").
- [ ] `emit/client.ts`: emit state derives as client-module exports (same module the handlers live in;
      `input: 'state'`).
- [ ] Decide the **plan delivery** (see D5): either the inline loader self-discovers the plan by walking
      `[data-bind]` under the `fw-state` host (no emitted plan object needed), or emit a compiled
      per-island state plan like `queryPlans`. **Prefer self-discovery by DOM walk** (SPEC "the DOM is
      the plan" — no separate compiled-plan artifact), keeping emission minimal.

### D5. Loader — apply the state plan on mutation (SPEC §4.4 responsibility)

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
      document); respect `?.` empty semantics (text → empty string, attribute → remove) exactly as the
      server renderer does (SPEC §4.8 FW222 drift rule).

### D6. Coverage — §4.9 exhaustiveness for state

- [ ] Extend `collectQueryUpdateCoverage` (FW311 / §4.9) to flag a JSX read of `state.*` in a DOM
      position that did **not** lower to a binding/derive (so nothing a handler mutates silently goes
      stale — this is exactly what hid the switch `<output>` bug). Decide FW311-extension vs. a
      state-specific sibling code; wire the diagnostic + fix-menu message (extract a named derive / bind
      directly).

### D7. Backward compatibility with the imperative demos

- [ ] The ~20 imperative demos hand-write DOM and have **no** state bindings, so the new walk finds
      nothing to apply → they are unaffected (verify in the no-shim harness). Where a demo both
      hand-writes DOM **and** has a now-lowered `state` expression (e.g. an `<output>{state.x}>`), the
      compiler will start binding it; ensure no double-application conflict (the handler's manual write
      and the binding agree). Phase 3 of `plans/fix-ui.md` then deletes the redundant imperative code.

## Implementation checklist (sequence)

- [ ] **S1 — Spike the loader walk in isolation.** Add a `state` resolver + shared apply to
      `query-bindings.ts`; unit-test `applyStateBindings(host, state)` against hand-written `data-bind`
      fixtures (no compiler yet). Proves the runtime half end-to-end.
- [ ] **S2 — Lowering** (D2): `state` text + attribute expressions → `data-bind`/derives; unit tests in
      a new `state-bindings.test.ts` mirroring `query-bindings.test.ts`.
- [ ] **S3 — Analysis + types** (D3): `StateUpdatePlanFact`, `collectStateUpdatePlan`; tests mirroring
      `query-update-plans.test.ts`.
- [ ] **S4 — Emit** (D4): server attributes + client derives; fixpoint/IR parity holds
      (`assertFixpoint`/`assertRenderEquivalence` in the gallery emit path).
- [ ] **S5 — Loader application** (D5): wire the walk into the inline loader `dispatch`; regenerate
      `inline-loader.ts`; budget + parity `--check` green.
- [ ] **S6 — Coverage gate** (D6): FW311-for-state diagnostic + tests.
- [ ] **S7 — Migrate the 4 target demos** to declarative state binding (drop the helper-spread for
      state-dependent attrs): `switch`, `toggle`, `disclosure`, `checkbox`. Handler bodies reduce to the
      state mutation (+ the primitive's `*TriggerClick` for the change contract where applicable).
- [ ] **S8 — Re-emit the gallery** (`pnpm --filter @jiso/example-gallery emit:interactive-gallery`) and
      verify in the no-shim harness; update any demo-fixture/markup tests.

## Acceptance criteria

- [ ] `switch`/`toggle`/`disclosure`/`checkbox` toggle visibly in the **unmodified** static export
      (no-shim Playwright): `aria-checked`/`aria-pressed`/`data-state`/`hidden`/`<output>` all update
      from a one-line state-mutation handler.
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
- **Fixpoint / byte-stable IR.** State derives + `data-bind` attributes change emitted IR; the gallery
  emit asserts fixpoint and render-equivalence — extend fixtures, don't fight the gate.
- **Spread opacity.** Phase 1 sidesteps `{...helper(state)}` by migrating the 4 demos to direct
  expressions; the general primitive-composition binding is Phase 2 (`plans/fix-ui.md` §4.6 chaining)
  and must not regress this work.
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
