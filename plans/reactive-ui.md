# Reactive UI: island-local state -> DOM update plan

Status: **done**. Created 2026-06-14; compacted 2026-06-15.

`SPEC.md` is normative. This plan records the completed Phase 1 implementation of SPEC §4.8 for
island-local `state`: a handler that mutates only `ctx.state` now updates same-island DOM bindings
without hand-authored `getElementById`, `setAttribute`, `textContent`, `document`, or `globalThis`
escape hatches in the target demo paths.

## SPEC Alignment

- [x] **SPEC §4.4 loader responsibility:** state changes run the update plan through the loader.
  - Evidence 2026-06-15: `packages/runtime/src/handlers.ts` applies state bindings after delegated
    handlers commit `fw-state`; `packages/runtime/src/inline-loader-build.ts` applies the same
    behavior in the always-loaded inline loader and regenerates `packages/runtime/src/inline-loader.ts`.
- [x] **SPEC §4.8 DOM-as-plan contract:** state reactivity uses existing self-describing
      `data-bind`/`data-bind:<attr>` attributes, not a separate `statePlans` runtime artifact.
  - Evidence 2026-06-15: `packages/compiler/src/state-bindings.test.ts` asserts server
    `data-bind:<attr>` refs, client derive exports, no `queryUpdatePlans`, no `statePlans`, and
    fixpoint for a state-only component.
- [x] **SPEC §4.8 binding roots:** `state` is the reserved binding root for island-local state.
  - Evidence 2026-06-15: `packages/compiler/src/validate/component-contracts.ts` rejects
    `queries: { state: ... }`; FW304 is registered in `packages/core/src/diagnostics.ts`; the
    compiler state-binding tests cover the diagnostic.
- [x] **SPEC §4.8 empty semantics:** optional paths and boolean-presence attributes remove attrs or
      render empty text consistently with the server renderer.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.test.ts` covers optional state paths;
    `packages/compiler/src/state-bindings.test.ts` covers boolean-presence derives returning `""` or
    `null`.
- [x] **SPEC §4.9 update coverage:** query/state-dependent DOM positions have coverage facts, and
      unsupported mixed query+state expressions stay FW311 instead of lowering to an unsound
      single-input derive.
  - Evidence 2026-06-15: `SPEC.md` §4.9 and FW311 now say query/state-dependent output;
    `packages/compiler/src/state-bindings.test.ts` and `packages/cli/src/index.fw-check.test.ts`
    cover state coverage and `source=state` output.
- [x] **SPEC §5.2 authored-source boundary:** app components remain TSX/JSX source; lowered IR and
      generated client modules are checked only as artifacts.
  - Evidence 2026-06-15: the target authored demos live in `examples/gallery/src/interactive/*.tsx`;
    generated files under `examples/gallery/src/generated/interactive/` were refreshed with
    `pnpm --filter @jiso/example-gallery emit:interactive-gallery`.

## Decisions Locked

- [x] **Use unified `data-bind`, not `data-bind-state`.**
  - Rationale: SPEC §4.8 says query and island-local state use the same machinery. The resolver
    dispatches by root segment: `state.*` reads the nearest `[fw-state]`; other roots remain query
    data.
- [x] **Keep state application scoped to the nearest `[fw-state]` host.**
  - Rationale: SPEC §4.2 allows component identity without always relying on `fw-c`, and nested
    stateful islands must not be updated by an ancestor mutation.
- [x] **Leave multi-input derives out of Phase 1.**
  - Rationale: `state.open && cart.count > 0` cannot be represented by a safe single-input derive.
    It remains FW311 until multi-input derive semantics are designed.
- [x] **Defer state list stamps.**
  - Rationale: scalar state paths, state-only derives, and same-island scoping were the Phase 1
    acceptance surface. `data-bind-list="state.items"` should reuse the existing keyed stamp contract
    later, not create a parallel mechanism here.
- [x] **Treat primitive-owned binding emission as `plans/fix-ui.md` work.**
  - Rationale: SPEC §4.6 says primitive-owned ARIA and `data-state` slots need primitive merge/binding
    ownership. Phase 1 migrated only the blocked target demos; general primitive attrs-function
    binding emission stays in the UI plan.

## Completion Ledger

- [x] **Compiler lowering:** state-only text and attribute expressions lower to `data-bind` or named
      state derives without requiring queries.
  - Evidence 2026-06-15: `packages/compiler/src/lower/inline-derives.ts` recognizes state-only text
    and attributes, routes boolean-presence attributes through null-removing derives, and leaves mixed
    query+state expressions uncovered.
  - Verification 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run
    src/state-bindings.test.ts src/query-coverage.test.ts src/query-bindings.test.ts
    src/handler-lowering.test.ts` passed; `pnpm --filter @jiso/compiler exec tsc --noEmit` passed.
- [x] **Analysis and diagnostics:** state binding/coverage facts are available to compiler,
      `fw check`, and test fixtures without creating runtime state plan objects.
  - Evidence 2026-06-15: `packages/compiler/src/analyze/query-updates.ts`,
    `packages/core/src/graph.ts`, `packages/cli/src/index.ts`, and
    `packages/test/src/compiler-fixtures.ts` preserve and print optional coverage source.
  - Verification 2026-06-15: `pnpm --filter @jiso/core exec vitest run src/diagnostics.test.ts`,
    `pnpm --filter fw exec vitest run src/index.fw-check.test.ts`, and
    `pnpm exec vitest run packages/test/src/compiler-fixtures.test.ts
    packages/test/src/fw-check-fixtures.test.ts packages/test/src/package-exports.test.ts` passed.
- [x] **Runtime application:** modular and inline loaders apply pure-path and derive-backed state
      bindings after handlers mutate state, including chained handler refs.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts` exposes `applyStateBindings`;
    `packages/runtime/src/handlers.ts` awaits it after delegated handler execution;
    `packages/runtime/src/inline-loader-build.ts` mirrors it for inline bootstrap source.
  - Verification 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run
    src/query-bindings.test.ts src/handlers.test.ts src/inline-loader-delegated.test.ts` passed;
    `pnpm --filter @jiso/runtime check:inline-loader` passed;
    `pnpm --filter @jiso/runtime exec tsc --noEmit` passed.
- [x] **Native checkbox property parity:** state-bound `checked` and `indeterminate` writes update live
      input properties, not only attributes.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts` reflects
    `data-bind:checked` and `data-bind:indeterminate`; `packages/runtime/src/loader.ts` and
    `packages/runtime/src/inline-loader-build.ts` initialize SSR-native mixed checkboxes during
    loader install.
  - Verification 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run
    src/query-bindings.test.ts src/loader.test.ts src/inline-loader-delegated.test.ts
    src/handlers.test.ts` passed; `pnpm --filter @jiso/runtime check:inline-loader` passed.
- [x] **Target demo migration:** `switch`, `toggle`, `disclosure`, and `checkbox` use declarative state
      bindings for the relevant ARIA/data/native/output slots.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/{switch-demo,toggle-demo,
    disclosure-demo,checkbox-demo}.tsx` removed state-dependent DOM writes for the bound slots; the
    generated client modules export state derives and local state mutation handlers.
  - Verification 2026-06-15: `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t "checkbox stamped"`,
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit`, and
    `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`
    passed.
- [x] **No imperative DOM escape hatches in target paths:** the target authored/generated paths do not
      use DOM escape hatches for the state-bound slots.
  - Verification 2026-06-15: `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"
    examples/gallery/src/interactive/checkbox-demo.tsx
    examples/gallery/src/generated/interactive/checkbox-demo.tsx
    examples/gallery/src/generated/interactive/checkbox-demo.client.js` found no matches; earlier
    target-wide scans for switch/toggle/disclosure also found no authored/generated DOM writes.
- [x] **Gallery no-shim acceptance:** the target demos work in the unmodified static export, and
      existing imperative demos continue to smoke-test.
  - Verification 2026-06-15: `node examples/gallery/scripts/export-static.mjs --out
    examples/gallery/dist` reported `html=1 client-modules=36 assets=1 diagnostics=0`; `node
    scratch/gallery-verify-noshim.mjs` passed with 0 runtime specifier errors and only known font
    404s.

## Residual Work Moved Elsewhere

- [x] **Primitive attrs-function binding emission transferred to `plans/fix-ui.md`.**
  - Evidence 2026-06-15: `plans/fix-ui.md` keeps the Phase 2 primitive-owned attribute/chaining work
    open, including avoiding long-term direct overrides of primitive-owned ARIA/`data-state` slots per
    SPEC §4.6 FW232.
- [x] **Per-component demo cleanups transferred to `plans/fix-ui.md`.**
  - Evidence 2026-06-15: `plans/fix-ui.md` tracks remaining component-family work after the reactive
    substrate was completed.
- [x] **Compiler/runtime hardening beyond scalar state transferred to `plans/compiler-hardening.md`
      or future SPEC work.**
  - Evidence 2026-06-15: this plan intentionally leaves multi-input derives and state list stamps out
    of scope because SPEC §4.8 does not yet define their client-private state semantics.

## Current Risks

- [x] **Inline loader budget was proven for Phase 1.**
  - Evidence 2026-06-15: `pnpm --filter @jiso/runtime check:inline-loader` passed after state binding
    and checkbox `indeterminate` support were added.
- [x] **Nested island bleed was covered.**
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.test.ts` and
    `packages/runtime/src/inline-loader-delegated.test.ts` assert descendant `[fw-state]` bindings do
    not update from an ancestor state mutation.
- [x] **Mixed query/state expressions remain intentionally unsupported.**
  - Evidence 2026-06-15: FW311 coverage tests assert mixed expressions are reported instead of
    lowered unsafely.

## Latest Checkpoint

- [x] Commit `89b3549e` (`Hydrate checkbox indeterminate state`) closed the last reactive substrate
      gap needed by the checkbox target demo.
  - Evidence 2026-06-15: the commit added native `indeterminate` state binding, loader initialization
    for SSR mixed checkboxes, generated checkbox `data-bind:indeterminate`, and plan evidence in
    `plans/fix-ui.md`.
