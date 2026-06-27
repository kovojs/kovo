# Consistent Derivations Plan

**Status:** Draft active plan created 2026-06-27. No implementation has landed.
**Source of truth:** `SPEC.md` remains normative. This plan should update `SPEC.md` first, then code,
tests, generated artifacts, and docs.

## Decision

Kovo should use one API rule:

- First positional string arguments are for externally meaningful addresses or protocol paths.
- Framework registry identities are derived from source when the compiler can derive them from an
  exported binding plus module path.
- Explicit names remain available only for conceptual grouping that intentionally spans declarations
  and cannot be inferred from one declaration, such as a shared client mutation queue.

This keeps `route('/products/:id', ...)` and `endpoint('/healthz', ...)` explicit while aligning
`mutation`, `query`, `domain`/`tag`, and webhook registry names with the component model.

## Baseline

- [ ] **Confirm and snapshot the current named surfaces.**
  - Evidence needed: cite the exact current signatures and generated wire locations for
    `component`, `route`, `endpoint`, `webhook`, `mutation`, `query`, `domain`/`tag`, and mutation
    `queue` before changing behavior.

- [ ] **Add the SPEC rule for address strings vs derived registry identities.**
  - Update `SPEC.md` near the component derivation rule and the mutation/query/webhook/data-plane
    sections so the rule is stated once and referenced from each primitive.
  - The rule must preserve the current component behavior: component DOM leaves, registry keys,
    fragment targets, and handler names stay source-derived.

## Phase 1 - Webhook Shape

- [ ] **Make webhook path-first and derive the webhook registry name.**
  - Target authoring shape:

    ```ts
    export const orderPaid = webhook('/webhooks/order-paid', {
      verify,
      input,
      handler,
    });
    ```

  - Derive the webhook audit/replay name from the exported binding plus module path.
  - Keep the path explicit because it is the public HTTP receiver.
  - Remove the current redundant shape:

    ```ts
    webhook('order-paid', { path: '/webhooks/order-paid', ... })
    ```

- [ ] **Update webhook audit, replay, diagnostics, docs, and tests for derived names.**
  - `kovo explain --endpoints` should still print a stable webhook name, but that name should be
    compiler-derived.
  - Webhook replay/idempotency must continue to scope by the derived webhook identity plus provider
    event id.

## Phase 2 - Mutation Keys

- [ ] **Derive mutation registry keys from source.**
  - Target authoring shape:

    ```ts
    export const addToCart = mutation({
      input,
      handler,
    });
    ```

  - Derive the mutation key from module path plus exported binding, using the same stability and
    collision rules as components.
  - The derived key remains the identity for `/_m/*`, `data-mutation`, CSRF audience binding,
    replay scope, generated mutation touch registries, and `kovo explain --endpoints`.

- [ ] **Add rename/collision diagnostics for derived mutation keys.**
  - Duplicate derived mutation keys must be an error.
  - Derived key changes since the previous emitted graph should warn like component key drift, because
    deployed documents and replay records can still name the previous identity.

- [ ] **Update mutation form lowering and registry typing to use mutation values instead of authored key strings.**
  - `<form mutation={addToCart}>` should continue to be the normal author path.
  - Direct helpers should accept the mutation definition object; bare string helpers should be
    reserved for generated IR or removed from app-facing docs.

## Phase 3 - Query Keys

- [ ] **Derive query registry keys from source.**
  - Target authoring shape:

    ```ts
    export const cart = query({
      reads: [cartDomain],
      load,
    });
    ```

  - The derived key remains the identity for `<kovo-query name="...">`, `kovo-deps`, query stores,
    query deltas, binding coverage, and generated registries.

- [ ] **Replace string-keyed query references in authoring surfaces.**
  - Optimistic maps should not require authors to spell query keys manually when query values are in
    scope.
  - Component `queries` object keys remain render-local names; the backing query identity should come
    from the query definition.

- [ ] **Add query key drift and collision diagnostics.**
  - Duplicate derived query keys and changed derived query keys must be reported before generated
    registries or wire artifacts can drift silently.

## Phase 4 - Domains And Tags

- [ ] **Allow domains and tags to derive their stable names.**
  - Target authoring shape:

    ```ts
    export const cartDomain = domain();
    export const cartItem = tag();
    ```

  - The derived name remains the invalidation currency used by `reads`, `touches`, change records,
    generated touch graphs, and explain output.

- [ ] **Keep explicit domain/tag names only as an escape hatch for intentionally shared external vocabulary.**
  - Document when `domain('billing')` is still clearer than deriving from a local binding.
  - The default should favor derivation in starter templates and guides.

## Phase 5 - Queues And Shared Groups

- [ ] **Clarify mutation queue naming separately from registry identity.**
  - `queue: 'cart'` is a conceptual grouping, not a declaration identity.
  - Add a derived per-mutation queue option such as `queue: true` if the common case is one queue per
    mutation.
  - For shared queues, consider a named queue object rather than an untyped string:

    ```ts
    export const cartQueue = queue();
    export const addToCart = mutation({ queue: cartQueue, ... });
    ```

## Phase 6 - Migration And Verification

- [ ] **Update examples, tutorials, docs, and starter templates to the derived forms.**
  - Replace redundant first-argument registry names in docs after the implementation and tests land.
  - Keep public examples aligned with the rule: paths explicit, registry identities derived.

- [ ] **Update generated registries, explain snapshots, compiler tests, server tests, and browser wire tests.**
  - Cover `/_m/*`, `data-mutation`, CSRF audience, replay scope, query wire chunks, domain touch
    graphs, and endpoint audits.

- [ ] **Remove legacy compatibility unless `SPEC.md` explicitly keeps it.**
  - Kovo is in technical preview, so prefer one clean authoring model over compatibility modes.
  - If a temporary migration parser is needed for generated IR fixpoint tests, keep it internal and
    document the removal point.

## Latest Verification

- 2026-06-27: Plan only. Current source inspection found the relevant existing contracts in
  `SPEC.md`, `packages/server/src/mutation/definition.ts`, `packages/server/src/query.ts`,
  `packages/server/src/route.ts`, `packages/server/src/endpoint.ts`, `packages/server/src/webhook.ts`,
  and `packages/server/src/domain.ts`.
