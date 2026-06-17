# Better DX: inferred fragment targets

Created 2026-06-17. Behavioral source of truth is `SPEC.md`; this ledger sequences a
design change that removes `fragmentTarget: true` and hand-authored
`kovo-fragment-target="..."` from app TSX. The goal is to preserve Kovo's static
coverage guarantees while making query invalidation drive the enhanced mutation
refresh path.

## Goal

An app author should normally write only query dependencies and typed render code:

```tsx
export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
```

The framework derives the rest:

```html
<cart-badge kovo-deps="cart" kovo-fragment-target="cart-badge">
  <span data-bind="cart.count">3</span>
</cart-badge>
```

On mutation, the server intersects committed invalidation with live DOM targets:

```txt
addToCart invalidates cart
Kovo-Targets: cart-badge=cart
=> rerender or query-delta the live cart-badge target
```

Enhanced form failures use the same transport envelope, but they are a separate
render path: the submitted form instance is inferred as the failure target, and
the same form render function receives typed mutation failure state.

```tsx
export const AddToCartForm = component({
  queries: { product: productQuery },
  props: s.object({ productId: s.string() }),
  mutations: { addToCart },
  render: ({ product }, _state, { productId, forms }) => (
    <form enhance mutation={addToCart} key={productId}>
      <input type="hidden" name="productId" value={productId} />
      {forms.addToCart.failure?.code === 'OUT_OF_STOCK' ? (
        <output role="alert" data-error-code="OUT_OF_STOCK">
          Only {forms.addToCart.failure.payload.availableQuantity} left.
        </output>
      ) : null}
      <button disabled={product.stock <= 0}>Add to cart</button>
    </form>
  ),
});
```

## Design direction

- [x] **Keep `data-bind` as the cheap update plan, not as authoring burden.**
  - Decision: `data-bind` remains lowered IR from `SPEC.md` §4.8 and remains the
    query-delta application path from `SPEC.md` §9.1.1. This plan does not replace
    scalar/path updates with mandatory DOM morphs.
- [x] **Stop requiring authors to hand-write `kovo-fragment-target`.**
  - Decision: app-authored TSX should never need a string the compiler can derive
    from the component binding and call-site identity. This extends the §4.8
    "stamps are derived" rule to fragment target DOM hooks.
- [x] **Make query-backed components live-target candidates by default.**
  - Decision: a component with `queries` gets `kovo-deps` and a resolvable live
    target on its root when the compiler can prove the root can be addressed and
    the render can be reconstructed from declared query data plus serializable
    stamped props.
- [x] **Preserve an escape hatch for non-refreshable or intentionally local UI.**
  - Decision: `disableServerRefresh: true` is the only component-level escape
    hatch. There is no force-on / "always" mode: server refreshability is inferred
    from queries, update coverage, reconstructability, and live target identity.
- [x] **Separate successful invalidation targets from form failure targets.**
  - Decision: mutation success uses invalidation ∩ live query targets. Mutation
    failure uses the submitted enhanced form's inferred target and re-runs the
    same form render with typed failure state. Form errors are not a use case for
    forcing a component-level server refresh boundary.
- [x] **Author error UI in the normal render function.**
  - Decision: no separate hand-written failure fragment template. The enhanced
    path returns a `<kovo-fragment>` for the submitted form instance; the no-JS
    path re-renders the full page with the same failure state.
- [x] **Use typed mutation bindings, not action strings, in app TSX.**
  - Decision: authors write `<form enhance mutation={addToCart}>`; the compiler
    emits the concrete mutation action URL, mutation key, typed input metadata,
    submitted-form target, and failure-state type.
- [x] **Author instance identity as `key`, lower it to `kovo-key`.**
  - Decision: app TSX uses React/Flutter-style `key={...}` for stable render
    identity. Lowered IR carries `kovo-key` because that is the runtime DOM
    identity contract shared by morph, stamps, and target derivation.

## Open contract questions

- [x] **Choose the author-facing escape-hatch spelling.**
  - Decision: use `disableServerRefresh: true`. Remove `fragmentTarget: true`
    rather than deprecating it, and do not add an `'always'` force-on mode.
  - Evidence: owner decision in this planning session, 2026-06-17.
- [x] **Define target identity for multiple instances.**
  - A singleton query component can use the derived DOM leaf (`cart-badge`).
    Repeated or prop-keyed instances need a derived target such as
    `product-form:p2`.
  - Rule direction: derive from the nearest stable authored `key`, or from keyed
    serializable component props when the component itself is directly keyed. The
    compiler lowers authored `key` to runtime `kovo-key`.
  - Hidden inputs are submitted data, not render identity; they may match the key
    but are not the primary source of target identity.
  - Evidence:
    - `SPEC.md` §4.1/§4.2 now defines query-backed inferred targets, singleton
      leaf targets, keyed repeated targets, duplicate/ambiguous identity errors,
      and derived `kovo-fragment-target` IR.
    - `SPEC.md` §9.1 now defines `Kovo-Targets` serialization as
      `target=queryInstance queryInstance`, including keyed repeated targets such
      as `product-form:p2=product:p2`.
    - Verified with `rg -n 'disableServerRefresh|Kovo-Targets|kovo-fragment-target' SPEC.md`
      and `git diff --check` on 2026-06-17.
- [x] **Define when auto targets ship full fragments vs query deltas only.**
  - Rule direction: if every invalidated position under the target is covered by
    §4.8 bindings/derives/keyed stamps, prefer query JSON or prod query deltas;
    otherwise send a fragment rerender when the component is server-reconstructible.
  - Evidence:
    - `SPEC.md` §4.9 now defines `fragment` as an inferred server-refreshable
      query target status, not an explicit component option.
    - `SPEC.md` §9.1 now defines deterministic success response selection:
      committed changes intersect live targets, §4.8-covered positions refresh
      through query values/deltas, and uncovered reconstructible targets receive
      fragments.
    - Verified with `rg -n 'inferred server-refreshable|Kovo-Targets|KV311|KV303' SPEC.md`
      and `git diff --check` on 2026-06-17.
- [x] **Choose typed mutation binding over string action authoring.**
  - Decision: app-authored forms use `mutation={addToCart}`. The emitted IR may
    contain `action="/_m/cart/add"`, but app TSX should not require stringly
    mutation URLs.
  - Evidence: owner decision in this planning session, 2026-06-17.
- [x] **Define compatibility for existing `fragmentTarget: true`.**
  - Decision: no compatibility alias. Remove the option immediately and migrate
    examples/tests/docs in the same implementation slice. Existing `fragmentTarget`
    usage becomes an invalid component option with a diagnostic that points to
    query inference and `disableServerRefresh: true`.
  - Evidence: owner decision in this planning session, 2026-06-17.
- [x] **Define inferred form target identity and failure state shape.**
  - Repeated forms need stable instance identity. Prefer ordinary local identity
    (`key={productId}` / keyed component props, lowered to `kovo-key`) over
    globally coordinated target strings. If no stable key can be derived,
    enhanced form lowering emits a teaching diagnostic.
  - Decision: typed failure state lives in the render context / third render arg,
    e.g. `render: (queries, state, { productId, forms }) => ...`, with
    `forms.addToCart.failure: null | { code; payload; fieldErrors? }`.
  - Evidence:
    - `SPEC.md` §6.3 now defines `<form enhance mutation={addToCart}
      key={productId}>`, typed `forms.<mutation>.failure`, stable key
      requirements, and compiler-derived submitted-form targets.
    - `SPEC.md` §9.2 now defines enhanced HTTP 422 form-fragment rerender,
      no-JS full-page parity, typed failure state, and bypassing success
      invalidation selection on failures.
    - Verified with `rg -n 'mutation=\\{addToCart\\}|forms\\.<mutation>\\.failure|Failure responses' SPEC.md`
      and `git diff --check` on 2026-06-17.
- [x] **Define success vs failure response selection.**
  - Decision: on success, intersect committed changes with submitted live targets;
    send query value/delta when §4.8 covers affected output, otherwise send a
    fragment when the target is reconstructible. On failure, skip invalidation and
    rerender the submitted form target with typed failure state.
  - Evidence: owner decision in this planning session, 2026-06-17.

## Implementation plan

- [x] **1. SPEC contract update.**
  - Update `SPEC.md` §4.1 to make `queries` the ordinary declaration for live
    query-backed components, not `fragmentTarget: true`.
  - Update `SPEC.md` §4.2/§4.8 so compiler-derived stamps include the
    fragment-target DOM hook when a query-backed component root needs one.
  - Update `SPEC.md` §4.9 so status `fragment` is "server-refreshable inferred
    target" rather than "inside a `fragmentTarget` option".
  - Update `SPEC.md` §9.1/§9.1.1 so invalidation ∩ live targets drives the
    response, with §4.8 query updates preferred over fragments when sufficient.
  - Update `SPEC.md` §6.3/§9.2 so enhanced forms infer their submitted failure
    target and typed mutation errors flow through the same render function used by
    the no-JS full-page path.
  - Update `SPEC.md` §4.8/§13.2 so app-authored `key` is the TSX source form and
    `kovo-key` is the lowered DOM/runtime identity stamp.
  - Evidence:
    - `SPEC.md` §4.1 now makes `queries` the ordinary declaration for inferred
      live query-backed components and defines `disableServerRefresh: true` as
      force-off only.
    - `SPEC.md` §4.2/§4.8 now define compiler-derived `kovo-fragment-target`,
      `kovo-deps`, and `kovo-key` as emitted IR while app TSX writes typed
      queries, expressions, and `key`.
    - `SPEC.md` §4.9 now defines `fragment` coverage as inferred
      server-refreshable targets and updates KV311 guidance away from
      `fragmentTarget: true`.
    - `SPEC.md` §6.3/§9.2 now define typed mutation form authoring,
      submitted-form target inference, typed failure state, and no-JS parity.
    - `SPEC.md` §9.1 now defines invalidation intersected with live
      `Kovo-Targets`, query value/delta preference, and fragment fallback.
    - Verified with `rg -n 'fragmentTarget: true|failureTarget|force-on|fragmentTarget,' SPEC.md`,
      `rg -n 'disableServerRefresh|inferred server-refreshable|Kovo-Targets|mutation=\\{addToCart\\}|forms\\.<mutation>\\.failure|KV303|KV311' SPEC.md`,
      and `git diff --check` on 2026-06-17.
    - Formatting gap: `pnpm exec prettier --check SPEC.md` could not run because
      this workspace does not currently provide a `prettier` command
      (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prettier" not found`).
- [x] **2. Compiler graph facts: infer refreshable targets from queries.**
  - Replace `componentOptionStaticValue(model, 'fragmentTarget') === true` as the
    sole source of `FragmentTargetFact` with an inference pass over query-backed
    components.
  - Implement `disableServerRefresh: true` as a force-off path; do not implement a
    force-on mode.
  - Emit diagnostics when a query-backed component cannot be server-refreshed:
    missing single root, unserializable props/children, ambiguous repeated target,
    or unsupported client-owned state.
  - Evidence:
    - Integrated commit `b43620d9` (`compiler: infer fragment targets from
      queries`) from `agent/inferred-targets`.
    - `packages/compiler/src/scan/parse.ts` derives fragment targets from
      query-backed components and honors `disableServerRefresh: true`.
    - `packages/compiler/src/graph.ts` generates `FragmentTargets` facts from the
      inferred target set.
    - `packages/compiler/src/validate/component-contracts.ts` reports removed
      `fragmentTarget` usage and reconstructability/coverage diagnostics against
      inferred targets.
    - Verified with `pnpm exec vitest --run $(find packages/compiler/src -name '*.test.ts' | sort)`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      `git diff --check` on 2026-06-17.
- [x] **3. Compiler lowering: always emit resolvable live target hooks.**
  - For inferred refresh targets, emit `kovo-fragment-target="<derived-target>"`
    on the component root whenever `kovo-c` will be omitted or insufficient.
  - Preserve the current `kovo-c` rule from `SPEC.md` §4.2 for component identity;
    the fragment hook is a derived runtime target stamp, not app-authored TSX.
  - Add fixpoint validation so emitted IR may carry the stamp while app source is
    linted if it hand-authors the same derivable stamp.
  - Evidence:
    - `packages/compiler/src/emit/server.ts` emits derived
      `kovo-fragment-target` hooks for inferred targets while preserving existing
      `kovo-c` emission behavior.
    - `packages/compiler/src/validate/component-contracts.ts` lints
      app-authored derivable `kovo-fragment-target` while allowing emitted IR to
      carry the runtime stamp for fixpoint validation.
    - Covered by `packages/compiler/src/fragment-targets.test.ts`,
      `packages/compiler/src/stamps.test.ts`, and full compiler test command
      listed under item 2.
- [x] **4. Update coverage: classify inferred fragment coverage.**
  - Change query coverage so `fragment` status comes from the inferred
    server-refreshable target set, not only the explicit option.
  - Prefer `plan` for path/derive/stamp positions and use `fragment` only for
    positions outside the §4.8 grammar but inside a reconstructible target.
  - Update KV311 help text to recommend query-derived refresh targets and the
    `disableServerRefresh: true` force-off escape hatch.
  - Evidence:
    - `packages/compiler/src/analyze/query-updates.ts` and
      `packages/compiler/src/validate/component-contracts.ts` classify inferred
      query-backed server-refresh targets as `fragment` coverage, with `plan` and
      `isomorphic` taking priority.
    - `packages/compiler/src/query-coverage.test.ts` covers inferred fragment
      coverage, force-off behavior, and KV311 help mentioning
      `disableServerRefresh: true`.
    - Covered by full compiler test command listed under item 2.
- [x] **5. Runtime/server response selection: invalidation intersects live targets.**
  - Ensure `Kovo-Targets` continues to read `kovo-deps` from the live DOM and uses
    derived target names.
  - Add a server-side selection helper that takes committed `Kovo-Changes`, live
    targets, query dependencies, and update coverage facts, then chooses query
    value/delta vs fragment renderers deterministically.
  - Selection rule: success intersects committed changes with submitted live
    targets; §4.8-covered affected output gets query value/delta, and uncovered
    but reconstructible targets get fragments. Failure bypasses this selector and
    rerenders the submitted form target with typed failure state.
  - Keep dev legible: full `<kovo-query>` and full `<kovo-fragment>` where a
    fragment is selected; prod may use §9.1.1 deltas.
  - Evidence:
    - Integrated commit `7a72498a` (`server: select mutation response targets
      from live deps`) from `agent/runtime-selection`.
    - `packages/server/src/mutation-wire.ts` parses structured live target deps
      from `Kovo-Targets` while preserving legacy target strings.
    - `packages/server/src/mutation.ts` selects response chunks from committed
      rerun queries intersected with live target deps, sends plan-covered targets
      through query chunks, and keeps reconstructible uncovered targets on the
      fragment path.
    - `packages/runtime/src/mutation-fetch.ts` sends structured live targets from
      the live DOM and includes submitted form target metadata in modular
      enhanced submits.
    - Verified with `pnpm exec vitest --run packages/core/src/index.test.ts packages/core/src/diagnostics.test.ts packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/mutation-form.test.ts packages/server/src/mutation*.test.ts packages/server/src/wire-fixtures.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      `git diff --check` on 2026-06-17.
- [x] **6. Enhanced form-target inference and typed failure rerender.**
  - Lower enhanced mutation forms to carry a derived submitted-form target without
    app-authored `kovo-fragment-target`.
  - Derive repeated form identity from authored `key` / keyed component props,
    lowering to `kovo-key` in emitted IR; reject ambiguous repeated forms with a
    diagnostic.
  - Replace app-authored `action="/_m/..."` mutation URLs with typed
    `mutation={addToCart}` authoring and compiler-emitted action URLs.
  - Thread typed mutation failure state into the same render path for enhanced
    fragment responses and no-JS full-page 422 responses.
  - Remove manual `failureTarget` requirements where the submitted form target can
    be inferred from the request.
  - Evidence:
    - Partial runtime/server evidence: integrated commit `7a72498a` adds
      `submittedFormTarget` parsing and failure fallback order
      `failureTarget ?? submittedFormTarget ?? first target ?? error`.
    - `packages/runtime/src/inline-loader-build.ts` and regenerated
      `inline-loader.ts` now send `Kovo-Form-Target` from the submitted enhanced
      form's derived target identity while preserving structured `Kovo-Targets`
      collection from live query targets.
    - `packages/runtime/src/inline-loader-enhanced-submit.test.ts` covers parity
      with modular enhanced submit headers, including the submitted form target.
    - Verified with `pnpm --filter @kovojs/runtime run build:inline-loader`,
      `pnpm --filter @kovojs/runtime run check:inline-loader`, and
      `pnpm exec vitest --run packages/runtime/src/inline-loader-enhanced-submit.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/runtime/src/mutation-fetch.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation-wire.test.ts`
      on 2026-06-17.
    - Partial compiler lowering evidence: `packages/compiler/src/emit/server.ts`
      lowers locally resolvable `<form enhance mutation={addToCart}
      key={productId}>` to emitted `method`, `action`, `data-mutation`,
      `kovo-fragment-target`, and `kovo-key` attributes while preserving
      render-equivalence semantics for generated `kovo-key`.
    - `packages/compiler/src/stamps.test.ts` covers the typed form lowering,
      output-context facts, render equivalence, and fixpoint behavior.
    - Verified with `pnpm exec vitest --run packages/compiler/src/stamps.test.ts`,
      `pnpm exec vitest --run $(find packages/compiler/src -name '*.test.ts' | sort)`,
      and `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` on
      2026-06-17.
    - Commerce response wiring now relies on request-derived submitted form
      targets instead of manual `failureTarget` for add-to-cart handlers in
      `examples/commerce/src/app.ts` and `app-shell.ts`.
    - Imported mutation values resolve through `registryFacts.mutations`, so
      ordinary component modules can lower `<form enhance mutation={addToCart}
      key={...}>` even when the mutation is imported from the app module.
    - Verified imported mutation lowering with
      `pnpm exec vitest --run $(find packages/compiler/src -name '*.test.ts' | sort)`
      on 2026-06-17.
    - `packages/compiler/src/scan/parse.ts` marks JSX elements inside `.map(...)`
      callbacks as repeatable, and `packages/compiler/src/emit/server.ts`
      rejects repeatable typed enhanced mutation forms without authored `key`
      identity instead of guessing a submitted form target.
    - `packages/compiler/src/scan/parse.test.ts` and `stamps.test.ts` cover the
      repeatable-form parser fact and `KV238` diagnostic for unkeyed repeatable
      typed mutation forms.
    - Verified with
      `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/stamps.test.ts`
      and `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` on
      2026-06-17.
    - `packages/core/src/index.ts` now exposes typed component mutation form
      render context: declaring `mutations: { addToCart }` gives the third
      render argument `forms.addToCart.failure` typed from `FormFailure`.
    - `packages/core/src/index.test.ts` covers typed
      `forms.addToCart.failure`, validation failures, and rejection of
      undeclared form names.
    - Verified with
      `pnpm exec vitest --run packages/core/src/index.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/scan/parse.test.ts`,
      `pnpm exec vitest --run packages/server/src/mutation-response.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/mutation-endpoint.test.ts`,
      and `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` on
      2026-06-17.
    - `packages/server/src/component-render.ts` now provides
      `renderComponentMutationFailure()` and `componentMutationFailureSlots()`,
      injecting concrete SPEC §6.3/§9.2 `forms.<mutation>.failure` state into
      the ordinary component render call.
    - `packages/server/src/component-render.test.tsx` covers declared mutation
      failures as `{ code, payload }` and schema validation failures as
      `{ code: 'VALIDATION', fields }` in component render slots.
    - `packages/server/src/mutation-response.test.ts` covers enhanced 422
      fragment rerender through `renderComponentMutationFailure()`.
    - `packages/server/src/mutation-no-js.test.ts` covers no-JS full-page 422
      rerender through the same component mutation failure state helper.
    - Verified with
      `pnpm exec vitest --run packages/server/src/component-render.test.tsx packages/server/src/mutation-response.test.ts packages/server/src/mutation-no-js.test.ts`
      and `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` on
      2026-06-17.
- [x] **7. Type registry and breaking migration.**
  - Generate `FragmentTargets` facts for inferred targets so existing typed APIs
    keep working.
  - Remove `fragmentTarget` from the component definition type.
  - Add diagnostics for removed `fragmentTarget` usage and hand-authored derivable
    `kovo-fragment-target`; diagnostics should point to query inference,
    `disableServerRefresh: true`, and keyed form/component identity where
    applicable.
  - Evidence:
    - `packages/core/src/index.ts` removes
      `fragmentTarget?: boolean` from component definitions by making the removed
      option `never`, adds typed `disableServerRefresh?: boolean`, and updates
      component docs to describe inferred live targets.
    - `packages/core/src/index.test.ts` covers preserving
      `disableServerRefresh: true` and compile-time rejection of
      `fragmentTarget: true`.
    - `packages/core/src/diagnostics.ts` updates KV238 help to point to stable
      keyed identity and `disableServerRefresh: true`, not the removed option.
    - `packages/compiler/src/graph.ts` generates `FragmentTargets` facts for
      inferred targets.
    - `packages/compiler/src/validate/component-contracts.ts` reports removed
      `fragmentTarget` usage and hand-authored derivable `kovo-fragment-target`
      with help pointing to query inference, keyed identity, and
      `disableServerRefresh: true`.
    - Verified with `pnpm exec vitest --run packages/core/src/index.test.ts packages/core/src/diagnostics.test.ts`,
      `pnpm exec vitest --run $(find packages/compiler/src -name '*.test.ts' | sort)`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      `git diff --check` on 2026-06-17.
- [x] **8. Commerce reference cleanup.**
  - Remove `fragmentTarget: true` and `kovo-fragment-target="cart-badge"` from
    `examples/commerce/src/components/cart-badge.tsx` once inference covers it.
  - Replace the add-to-cart form's manual `kovo-fragment-target` /
    `failureTarget` / string action wiring with `key={...}`,
    `mutation={addToCart}`, inferred form target identity, and typed failure state
    rendered by the form function itself.
  - Refresh generated `examples/commerce/src/generated/cart-badge.tsx` so the IR
    still carries `kovo-deps`, `data-bind`, and the derived target hook.
  - Update commerce tests that assert `Kovo-Targets`, fragment facts, and generated
    graph output.
  - Evidence:
    - Partial component cleanup complete: `examples/commerce/src/components/cart-badge.tsx`,
      `order-history.tsx`, and `product-grid.tsx` no longer use
      `fragmentTarget: true`; `cart-badge.tsx` no longer hand-authors its root
      `kovo-fragment-target`.
    - Regenerated `examples/commerce/src/generated/{cart-badge,order-history,product-grid}.tsx`;
      generated IR now carries compiler-derived `kovo-fragment-target` hooks for
      the query-backed roots.
    - Verified with `pnpm --filter @kovojs/example-commerce run emit-components`,
      `pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
      and `pnpm --filter @kovojs/example-commerce test` on 2026-06-17.
    - Add-to-cart response wiring no longer passes manual `failureTarget` in
      `examples/commerce/src/app.ts` or `app-shell.ts`; verified with
      `pnpm --filter @kovojs/example-commerce test -- app.add-to-cart.test.ts app-shell.test.ts`
      on 2026-06-17.
    - Add-to-cart form source now writes `mutation={addToCart}` and
      `key={item.id}` instead of manual `action`, `data-mutation`, or
      `kovo-fragment-target`; `examples/commerce/scripts/emit-components.mjs`
      passes mutation registry facts and rejects hand-authored
      `kovo-fragment-target` in source.
    - Regenerated `examples/commerce/src/generated/product-grid.tsx` now carries
      compiler-emitted `action`, `data-mutation`, `kovo-fragment-target`, and
      `kovo-key` for the add-to-cart form, with target
      `add-to-cart:${item.id}`.
    - Verified with `pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
      `pnpm --filter @kovojs/example-commerce test -- app.add-to-cart.test.ts app-shell.test.ts source-truth.test.ts`,
      `pnpm --filter @kovojs/example-commerce test`, and
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts` on 2026-06-17.
    - `examples/commerce/src/components/product-grid.tsx` now declares
      `mutations: { addToCart }`, reads typed
      `slots.forms.addToCart.failure`, and renders the add-to-cart form from the
      typed form failure shape instead of server `MutationFail`.
    - `examples/commerce/src/app.ts` renders full product-grid failures through
      `renderComponentMutationFailure()` with submitted `productId` only as
      repeated-form identity; `app.ts` and `app-shell.ts` render submitted-form
      fragments through `renderAddToCartMutationFailureForm()`.
    - Regenerated `examples/commerce/src/generated/product-grid.tsx` carries the
      typed failure-slot render path while preserving compiler-emitted form
      targets.
    - Verified with
      `pnpm exec vitest --run examples/commerce/src/app.add-to-cart.test.ts examples/commerce/src/app.rendering.test.ts examples/commerce/src/app.queries.test.ts examples/commerce/src/app-shell.test.ts`,
      `pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      no-match checks
      `rg -n 'ProductGridRenderContext|renderAddToCartForm\\(product, failure|failure\\?: AddToCartFailureState' examples/commerce/src`,
      `rg -n 'failure\\.error\\.code' examples/commerce/src/components/product-grid.tsx examples/commerce/src/generated/product-grid.tsx`,
      and
      `rg -n 'failureTarget|kovo-fragment-target="cart-badge"|fragmentTarget: true|action="/_m/cart/add"|data-mutation="cart/add"' examples/commerce/src/components examples/commerce/src/app.ts examples/commerce/src/app-shell.ts`
      on 2026-06-17.
- [ ] **9. Broader example/docs migration.**
  - Audit StackOverflow and CRM components that currently hand-author
    `kovo-fragment-target` and remove attributes where inference covers them.
  - Audit enhanced forms across examples and starters for manual failure target
    strings; migrate to inferred form targets where the render path has typed
    failure state.
  - Update docs/tutorials so authors learn "declare queries; Kovo derives live
    targets" before learning escape hatches.
  - Evidence:
    - Partial docs/prose migration completed in `site/content/guides/mutations.md`,
      `site/content/tutorial/03-queries.md`, `site/content/tutorial/04-mutations.md`,
      and `docs/integration-testing.md`: author-facing prose now distinguishes
      TSX `key`/`mutation={...}` from emitted `kovo-key`/action/fragment target
      wire hooks.
    - Verified with `pnpm --filter @kovojs/site run content` and
      `pnpm --filter @kovojs/site test -- --runInBand` on 2026-06-17.
    - Remaining gap: tutorial step source/generated artifacts, StackOverflow,
      CRM, starter/reference auth forms, and remaining commerce auth/upload
      forms still need migration after typed failure-state support lands.
- [ ] **10. Final gates.**
  - Run focused compiler/runtime/server/example tests for inferred targets,
    form-target inference, mutation responses, query coverage, and commerce.
  - Run the broad acceptance gate if the implementation changes shared compiler,
    runtime, or SPEC behavior across packages.
  - Evidence:
    - Pending.

## Risks

- [ ] **Too many targets by default.**
  - Risk: every query-backed component becoming addressable may inflate registry
    facts and response-selection work.
  - Mitigation: use update coverage to prefer query deltas; expose force-off for
    purely presentational children; report explain output so owners can see target
    fan-out.
- [ ] **Ambiguous repeated instances.**
  - Risk: a component rendered multiple times with one derived leaf cannot be
    safely patched by the singleton target name.
  - Mitigation: require authored `key` or stamped serializable identity for
    repeated inferred targets, lowering to `kovo-key` in emitted IR; otherwise
    emit a teaching diagnostic instead of guessing.
- [ ] **Server reconstructability gaps.**
  - Risk: query invalidation can identify stale UI that still cannot be rerendered
    as a fragment because props/children capture unserializable values.
  - Mitigation: keep §4.5 reconstructability checks; classify covered §4.8
    positions as query-plan updates even when full fragment rerender is blocked.
- [ ] **Conflating form failures with query invalidation.**
  - Risk: successful write refresh and failed submit rerender share
    `<kovo-fragment>` on the wire, so implementation may accidentally route them
    through one concept.
  - Mitigation: model them as separate selectors: invalidation ∩ live query
    targets for success, submitted form target + typed failure state for 422.
- [ ] **API churn around `fragmentTarget`.**
  - Risk: removing the option abruptly breaks existing apps and docs.
  - Mitigation: make the change in one coherent breaking slice: SPEC, types,
    diagnostics, examples, generated artifacts, docs, and tests move together.

## Proving commands

- [x] SPEC contract updated and mechanically checked:
      `rg -n 'fragmentTarget: true|failureTarget|force-on|fragmentTarget,' SPEC.md`,
      `rg -n 'disableServerRefresh|inferred server-refreshable|Kovo-Targets|mutation=\\{addToCart\\}|forms\\.<mutation>\\.failure|KV303|KV311' SPEC.md`,
      and `git diff --check` passed on 2026-06-17.
- [x] Compiler graph/lowering/query-coverage tests green:
      `pnpm exec vitest --run $(find packages/compiler/src -name '*.test.ts' | sort)`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      `git diff --check` passed on 2026-06-17.
- [ ] Enhanced form target inference and typed failure rerender tests green:
      command pending.
- [x] Runtime/server mutation response tests green:
      `pnpm exec vitest --run packages/core/src/index.test.ts packages/core/src/diagnostics.test.ts packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/mutation-form.test.ts packages/server/src/mutation*.test.ts packages/server/src/wire-fixtures.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      `git diff --check` passed on 2026-06-17.
- [ ] Commerce generated artifacts and interactive mutation tests green: command
      pending.
- [ ] Broad `pnpm run acceptance` green after shared behavior changes: command
      pending.
