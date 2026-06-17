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
- [ ] **Define target identity for multiple instances.**
  - A singleton query component can use the derived DOM leaf (`cart-badge`).
    Repeated or prop-keyed instances need a derived target such as
    `product-form:p2`.
  - Rule direction: derive from the nearest stable authored `key`, or from keyed
    serializable component props when the component itself is directly keyed. The
    compiler lowers authored `key` to runtime `kovo-key`.
  - Hidden inputs are submitted data, not render identity; they may match the key
    but are not the primary source of target identity.
  - Done = `SPEC.md` defines singleton vs keyed target derivation, duplicate
    diagnostics, and how `Kovo-Targets` serializes each instance.
- [ ] **Define when auto targets ship full fragments vs query deltas only.**
  - Rule direction: if every invalidated position under the target is covered by
    §4.8 bindings/derives/keyed stamps, prefer query JSON or prod query deltas;
    otherwise send a fragment rerender when the component is server-reconstructible.
  - Done = `SPEC.md` §4.9 and §9.1.1 describe deterministic selection and the
    compiler exposes the classification in explain output.
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
- [ ] **Define inferred form target identity and failure state shape.**
  - Repeated forms need stable instance identity. Prefer ordinary local identity
    (`key={productId}` / keyed component props, lowered to `kovo-key`) over
    globally coordinated target strings. If no stable key can be derived,
    enhanced form lowering emits a teaching diagnostic.
  - Decision: typed failure state lives in the render context / third render arg,
    e.g. `render: (queries, state, { productId, forms }) => ...`, with
    `forms.addToCart.failure: null | { code; payload; fieldErrors? }`.
  - Done = `SPEC.md` §6.3/§9.2 define enhanced form target inference, no-JS
    parity, typed failure state lifetime, and diagnostics for unkeyed repeated
    forms.
- [x] **Define success vs failure response selection.**
  - Decision: on success, intersect committed changes with submitted live targets;
    send query value/delta when §4.8 covers affected output, otherwise send a
    fragment when the target is reconstructible. On failure, skip invalidation and
    rerender the submitted form target with typed failure state.
  - Evidence: owner decision in this planning session, 2026-06-17.

## Implementation plan

- [ ] **1. SPEC contract update.**
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
    - Pending.
- [ ] **2. Compiler graph facts: infer refreshable targets from queries.**
  - Replace `componentOptionStaticValue(model, 'fragmentTarget') === true` as the
    sole source of `FragmentTargetFact` with an inference pass over query-backed
    components.
  - Implement `disableServerRefresh: true` as a force-off path; do not implement a
    force-on mode.
  - Emit diagnostics when a query-backed component cannot be server-refreshed:
    missing single root, unserializable props/children, ambiguous repeated target,
    or unsupported client-owned state.
  - Evidence:
    - Pending.
- [ ] **3. Compiler lowering: always emit resolvable live target hooks.**
  - For inferred refresh targets, emit `kovo-fragment-target="<derived-target>"`
    on the component root whenever `kovo-c` will be omitted or insufficient.
  - Preserve the current `kovo-c` rule from `SPEC.md` §4.2 for component identity;
    the fragment hook is a derived runtime target stamp, not app-authored TSX.
  - Add fixpoint validation so emitted IR may carry the stamp while app source is
    linted if it hand-authors the same derivable stamp.
  - Evidence:
    - Pending.
- [ ] **4. Update coverage: classify inferred fragment coverage.**
  - Change query coverage so `fragment` status comes from the inferred
    server-refreshable target set, not only the explicit option.
  - Prefer `plan` for path/derive/stamp positions and use `fragment` only for
    positions outside the §4.8 grammar but inside a reconstructible target.
  - Update KV311 help text to recommend query-derived refresh targets and the new
    force-off/force-on escape hatches.
  - Evidence:
    - Pending.
- [ ] **5. Runtime/server response selection: invalidation intersects live targets.**
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
    - Pending.
- [ ] **6. Enhanced form-target inference and typed failure rerender.**
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
    - Pending.
- [ ] **7. Type registry and breaking migration.**
  - Generate `FragmentTargets` facts for inferred targets so existing typed APIs
    keep working.
  - Remove `fragmentTarget` from the component definition type.
  - Add diagnostics for removed `fragmentTarget` usage and hand-authored derivable
    `kovo-fragment-target`; diagnostics should point to query inference,
    `disableServerRefresh: true`, and keyed form/component identity where
    applicable.
  - Evidence:
    - Pending.
- [ ] **8. Commerce reference cleanup.**
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
    - Pending.
- [ ] **9. Broader example/docs migration.**
  - Audit StackOverflow and CRM components that currently hand-author
    `kovo-fragment-target` and remove attributes where inference covers them.
  - Audit enhanced forms across examples and starters for manual failure target
    strings; migrate to inferred form targets where the render path has typed
    failure state.
  - Update docs/tutorials so authors learn "declare queries; Kovo derives live
    targets" before learning escape hatches.
  - Evidence:
    - Pending.
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

- [ ] SPEC contract tests updated and green: command pending.
- [ ] Compiler graph/lowering/query-coverage tests green: command pending.
- [ ] Enhanced form target inference and typed failure rerender tests green:
      command pending.
- [ ] Runtime/server mutation response tests green: command pending.
- [ ] Commerce generated artifacts and interactive mutation tests green: command
      pending.
- [ ] Broad `pnpm run acceptance` green after shared behavior changes: command
      pending.
