# Consistent Derivations Plan

**Status:** Active implementation started 2026-06-27. Baseline/SPEC contract, runtime/compiler
identity slices, Vite standalone lowering, and docs-focused migration are integrated. Drift
diagnostics, query-reference ergonomics, first-class queue objects, and remaining legacy cleanup are
still open.
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

- [x] **Confirm and snapshot the current named surfaces.**
  - Evidence needed: cite the exact current signatures and generated wire locations for
    `component`, `route`, `endpoint`, `webhook`, `mutation`, `query`, `domain`/`tag`, and mutation
    `queue` before changing behavior.
  - Evidence (2026-06-27 source snapshot before behavior changes): `component(definition)` in
    `packages/core/src/index.ts` already leaves `name` undefined for compiler derivation, with
    compiler naming in `packages/compiler/src/component-names.ts` and component wire stamps
    `kovo-c`/`kovo-live-component`/`kovo-fragment-target`; `route(path, definition)` in
    `packages/server/src/route.ts` and `endpoint(path, definition)` in
    `packages/server/src/endpoint.ts` keep path strings as public HTTP addresses;
    `packages/server/src/webhook.ts` uses `webhook(name, { path, ... })` and wires `name`, `path`,
    endpoint `reason`, and `webhookReplayScope(name)`; `mutation(key, definition)` and
    `queue?: string` in `packages/server/src/mutation/definition.ts` feed `/_m/${key}`,
    `data-mutation`, JSX form attributes in `packages/server/src/jsx-runtime.ts`, dispatch in
    `packages/server/src/app-dispatch.ts`, and replay scope composition in
    `packages/server/src/replay.ts`; `query(key, definition)` in `packages/server/src/query.ts`
    feeds `/_q/${key}`, `<kovo-query name>`, `<script kovo-query>`, query stores, and
    `kovo-deps` stamps; `domain(key)`/`tag(key)` in `packages/server/src/domain.ts` are the current
    invalidation currency for `reads`, `touches`, `Kovo-Changes`, and touch graphs.

- [x] **Add the SPEC rule for address strings vs derived registry identities.**
  - Update `SPEC.md` near the component derivation rule and the mutation/query/webhook/data-plane
    sections so the rule is stated once and referenced from each primitive.
  - The rule must preserve the current component behavior: component DOM leaves, registry keys,
    fragment targets, and handler names stay source-derived.
  - Evidence (2026-06-27): `SPEC.md` now defines the framework-wide address-string vs
    source-derived registry identity rule in §4.1, references it from §6.1, updates the webhook
    shape in §9.1, records domain/tag derivation in §10.1, updates query and mutation examples in
    §10.2/§10.3, and separates queue names from registry identities in §10.4.

## Phase 1 - Webhook Shape

- [x] **Make webhook path-first and derive the webhook registry name.**
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

  - Evidence (2026-06-27): `packages/server/src/webhook.ts` and
    `packages/server/src/webhook.test.ts` accept the path-first shape and reject `options.path`;
    `packages/compiler/src/source-derived-lowering.ts` and `packages/compiler/src/vite.ts` assign
    exported `webhook('/path', { ... })` declarations source-derived names before Vite evaluates
    `createApp()`. Verification passed `pnpm exec vitest run packages/compiler/src/vite.test.ts
packages/server/src/vite.test.ts packages/server/src/mutation.test.ts packages/server/src/webhook.test.ts
packages/compiler/src/source-reparse-boundary.test.ts packages/server/src/access-graph.test.ts
examples/commerce/src/app.test.ts examples/crm/src/interactive-app.test.ts
examples/stackoverflow/src/interactive-app.test.ts`, `pnpm run check:vp`, and
    `git diff --check`.

- [x] **Update webhook audit, replay, diagnostics, docs, and tests for derived names.**
  - `kovo explain --endpoints` should still print a stable webhook name, but that name should be
    compiler-derived.
  - Webhook replay/idempotency must continue to scope by the derived webhook identity plus provider
    event id.
  - Integrated evidence (2026-06-27): `packages/server/src/api/app.test.ts`,
    `packages/server/src/access.test.ts`, and `packages/server/src/access-graph.test.ts` were updated
    for path-first webhook audit/access behavior; focused webhook/app tests passed after integration.
    `packages/server/src/webhook.test.ts` now covers replay scope with a compiler-assigned webhook
    identity; `packages/cli/src/index.kovo-explain.test.ts` now pins `kovo explain --endpoints` and
    access output for a derived-style webhook name. Verification passed `pnpm exec vitest run
packages/cli/src/index.kovo-explain.test.ts`, `pnpm run check:vp`, and `git diff --check`.

## Phase 2 - Mutation Keys

- [x] **Derive mutation registry keys from source.**
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
  - Integrated evidence (2026-06-27): `packages/server/src/mutation/definition.ts` accepts
    object-form `mutation({ input, handler })`; `packages/compiler/src/compile.ts`,
    `packages/compiler/src/emit/server-emit-shared.ts`, `packages/compiler/src/emit/mutation-form.ts`,
    and `packages/compiler/src/scan/mutation-inputs.ts` derive compiler-proved object-form mutation
    keys from module namespace plus exported binding via `packages/compiler/src/mutation-names.ts`
    and the shared `packages/compiler/src/registry-identities.ts` helper. Focused integration
    verification passed `pnpm exec vitest run packages/server/src/mutation.test.ts
packages/server/src/app.test.ts packages/compiler/src/scan/mutation-inputs.test.ts
packages/compiler/src/registry.test.ts packages/compiler/src/registry-identities.test.ts`,
    `pnpm run check:vp`, and `git diff --check`. `packages/compiler/src/source-derived-lowering.ts`
    and `packages/server/src/vite.test.ts` additionally prove exported standalone Vite app/server
    `mutation({ ... })` declarations are assigned derived keys before `createApp()` consumes them.

- [x] **Add rename/collision diagnostics for derived mutation keys.**
  - Duplicate derived mutation keys must be an error.
  - Derived key changes since the previous emitted graph should warn like component key drift, because
    deployed documents and replay records can still name the previous identity.
  - Integrated evidence (2026-06-27): `packages/server/src/app.ts` now fails closed when object-form
    mutations reach `createApp()` without compiler-derived key metadata and continues to reject
    duplicate resolved mutation keys; `packages/compiler/src/app-graph.ts` reports duplicate
    mutation graph keys as `KV421` before invalidation derivation indexes them and reports
    previous-registry type moves as `KV246`. Verification passed `pnpm exec vitest run
packages/compiler/src/registry.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts
packages/compiler/src/spec-coverage-map.test.ts packages/core/src/diagnostics.test.ts`,
    `pnpm run check:vp`, and `git diff --check`.

- [ ] **Update mutation form lowering and registry typing to use mutation values instead of authored key strings.**
  - `<form mutation={addToCart}>` should continue to be the normal author path.
  - Direct helpers should accept the mutation definition object; bare string helpers should be
    reserved for generated IR or removed from app-facing docs.
  - Integrated evidence (2026-06-27): `packages/compiler/src/emit/mutation-form.ts`,
    `packages/compiler/src/emit/render-equivalence.ts`, `packages/server/src/mutation.test.ts`, and
    `packages/compiler/src/registry.test.ts` cover object-form mutation values through generated form
    action/data-mutation output and registry metadata. `site/content/guides/mutations.md`,
    `site/content/guides/optimistic.md`, and `docs/worked-example-add-to-cart.md` now use the
    derived form in public snippets. `packages/core/src/index.ts` now lets `form(addMutation)` derive
    the component form handle from a mutation value and fail closed when the runtime key is unresolved;
    verification passed `pnpm exec vitest run packages/core/src/index.test.ts`,
    `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check`. The public commerce,
    CRM, and StackOverflow examples no longer use string-keyed `form('...')` handles; verification
    passed `pnpm exec vitest run examples/commerce/src/app.test.ts
examples/crm/src/interactive-app.test.ts examples/stackoverflow/src/interactive-app.test.ts
examples/stackoverflow/src/optimism-derivation.test.ts`, `pnpm run check:vp`, and
    `git diff --check`. `packages/core/src/index.ts`, `packages/browser/src/optimism.ts`, and
    `packages/browser/src/optimism-typing.test.ts` now document and prove `form(addMutation)` as
    the normal `OptimisticFor` typing path; verification passed `pnpm exec vitest run
packages/browser/src/optimism-typing.test.ts packages/core/src/index.test.ts`. Remaining gap:
    direct-test query/domain declarations still need a generated live-target/query-key lowering path
    before their key-first forms can be removed. `packages/browser/src/submit-context-apply.test.ts`
    now exercises `ctx.submit` with mutation-value form handles; verification passed
    `pnpm exec vitest run packages/browser/src/submit-context-apply.test.ts
packages/browser/src/submit-context-failure.test.ts`.

## Phase 3 - Query Keys

- [x] **Derive query registry keys from source.**
  - Target authoring shape:

    ```ts
    export const cart = query({
      reads: [cartDomain],
      load,
    });
    ```

  - The derived key remains the identity for `<kovo-query name="...">`, `kovo-deps`, query stores,
    query deltas, binding coverage, and generated registries.
  - Integrated evidence (2026-06-27): `packages/server/src/query.ts` accepts object-form
    `query({ load, ... })` and `query.elevated({ ... })`; `packages/compiler/src/compile.ts` wraps
    exported object-form query declarations with compiler-proved keys from the shared
    `packages/compiler/src/registry-identities.ts` helper; `packages/server/src/app.ts` fails closed
    when unresolved object-form queries reach `createApp()` and continues to reject duplicate
    resolved query keys. Focused integration verification passed `pnpm exec vitest run
packages/server/src/query-endpoint.test.ts packages/server/src/app.test.ts
packages/compiler/src/compile-component.test.ts packages/compiler/src/registry-identities.test.ts`,
    `pnpm run check:vp`, `pnpm run check:api-surface`, and `git diff --check HEAD~1..HEAD`.
    `packages/compiler/src/source-derived-lowering.ts` and `packages/server/src/vite.test.ts`
    additionally prove exported standalone Vite app/server `query({ ... })` and
    `query.elevated({ ... })` declarations are assigned derived keys before `createApp()` consumes
    them.

- [ ] **Replace string-keyed query references in authoring surfaces.**
  - Optimistic maps should not require authors to spell query keys manually when query values are in
    scope.
  - Component `queries` object keys remain render-local names; the backing query identity should come
    from the query definition.
  - Integrated evidence (2026-06-27): `packages/compiler/src/scan/optimistic-inline.ts` now resolves
    same-file query value references such as `[cartQuery.key]`, including exported object-form
    `query({ ... })` declarations, and tests cover the local value form. Verification passed
    `pnpm exec vitest run packages/server/src/mutation.test.ts
packages/compiler/src/scan/optimistic-inline.test.ts examples/crm/src/interactive-app.test.ts`,
    `pnpm run check:api-surface`, `pnpm run check`, and `git diff --check HEAD~1..HEAD`.
    The scanner now also resolves imported query value references when the caller supplies static
    imported source, including explicit-key queries and source-derived object-form query exports;
    `pnpm exec vitest run packages/compiler/src/scan/optimistic-inline.test.ts`, `pnpm run
check:vp`, and `git diff --check` passed. Remaining gap: the production lowering caller still needs
    to pass the resolver, so this authoring-surface item remains open.

- [x] **Add query key drift and collision diagnostics.**
  - Duplicate derived query keys and changed derived query keys must be reported before generated
    registries or wire artifacts can drift silently.
  - Integrated evidence (2026-06-27): `packages/compiler/src/app-graph.ts` now reports duplicate
    query read-set keys as `KV240` before generated query registries and invalidation derivation can
    collapse them and reports previous-registry type moves as `KV247`. Verification passed `pnpm
exec vitest run packages/compiler/src/registry.test.ts
packages/compiler/src/diagnostic-coverage-matrix.test.ts
packages/compiler/src/spec-coverage-map.test.ts packages/core/src/diagnostics.test.ts`,
    `pnpm run check:vp`, and `git diff --check`.

## Phase 4 - Domains And Tags

- [x] **Allow domains and tags to derive their stable names.**
  - Target authoring shape:

    ```ts
    export const cartDomain = domain();
    export const cartItem = tag();
    ```

  - The derived name remains the invalidation currency used by `reads`, `touches`, change records,
    generated touch graphs, and explain output.
  - Integrated evidence (2026-06-27): `packages/server/src/domain.ts` allows zero-argument
    `domain()` and `tag()` as compiler-derived placeholders; `packages/drizzle/src/static/schema.ts`
    derives exported zero-argument domain/tag names from module path plus exported binding in static
    extraction; `packages/server/src/generated-query-registry.ts` folds generated read domains into
    unresolved query reads; `packages/server/src/change-record.ts` fails closed if unresolved
    derived domains reach manual change/touch emission. Focused verification passed `pnpm exec
    vitest run packages/server/src/generated-query-registry.test.ts
packages/server/src/change-record.test.ts packages/drizzle/src/index.writes-receivers.test.ts`,
    `pnpm run check:vp`, `pnpm run check:api-surface`, and `git diff --check HEAD~1..HEAD`.
    Authored guides now show zero-argument `domain()` in the default snippets.

- [ ] **Keep explicit domain/tag names only as an escape hatch for intentionally shared external vocabulary.**
  - Document when `domain('billing')` is still clearer than deriving from a local binding.
  - The default should favor derivation in starter templates and guides.
  - Integrated evidence (2026-06-27): `site/content/guides/data-layer.md` and
    `site/content/guides/queries.md` now favor zero-argument domains in public snippets, and
    `site/content/guides/data-layer.md` documents explicit `domain('billing')`/`tag(...)` as shared
    external vocabulary rather than local declaration identity. Remaining gap: starter/example source
    still needs migration.

## Phase 5 - Queues And Shared Groups

- [x] **Clarify mutation queue naming separately from registry identity.**
  - `queue: 'cart'` is a conceptual grouping, not a declaration identity.
  - Add a derived per-mutation queue option such as `queue: true` if the common case is one queue per
    mutation.
  - For shared queues, consider a named queue object rather than an untyped string:

    ```ts
    export const cartQueue = queue();
    export const addToCart = mutation({ queue: cartQueue, ... });
    ```

  - Integrated evidence (2026-06-27): `packages/server/src/mutation/definition.ts` accepts
    `queue: true` and normalizes it to the resolved mutation key for key-first mutations;
    `packages/compiler/src/compile.ts` emits the same normalization after compiler-derived object-form
    mutation keys; `packages/compiler/src/scan/optimistic-inline.ts` lowers object-form
    `queue: true` into the derived mutation identity for optimistic plans; `examples/crm/src/mutations.ts`
    accepts the widened queue posture. Focused verification passed `pnpm exec vitest run
packages/server/src/mutation.test.ts packages/compiler/src/scan/optimistic-inline.test.ts
packages/compiler/src/registry.test.ts`, `pnpm run check:vp`, and `git diff --check`.
    `packages/server/src/mutation/definition.ts` now also exposes first-class `queue('name')` values
    and `MutationQueue`; `examples/crm/src/mutations.ts` uses `queue('crm')` for its intentionally
    shared CRM queue; public guides now distinguish `queue: true` from named queue values.
    Verification passed `pnpm exec vitest run packages/server/src/mutation.test.ts
packages/compiler/src/scan/optimistic-inline.test.ts examples/crm/src/interactive-app.test.ts`,
    `pnpm run check:api-surface`, `pnpm run check`, and `git diff --check HEAD~1..HEAD`.

## Phase 6 - Migration And Verification

- [ ] **Update examples, tutorials, docs, and starter templates to the derived forms.**
  - Replace redundant first-argument registry names in docs after the implementation and tests land.
  - Keep public examples aligned with the rule: paths explicit, registry identities derived.
  - Integrated evidence (2026-06-27): docs-focused migration updated
    `site/content/guides/{mutations,queries,data-layer,endpoints-webhooks,security,optimistic,styling}.md`,
    `site/content/getting-started/{mental-model,why-kovo}.md`,
    `docs/worked-example-add-to-cart.md`, `packages/create-kovo/templates/src/mutations.ts`, and
    `examples/crm/src/mutations.ts`. Verification passed `pnpm exec vitest run
packages/create-kovo/src/index.build.test.ts examples/crm/src/interactive-app.test.ts`,
    `pnpm run check`, `pnpm run check:api-surface`, and `git diff --check HEAD~1..HEAD`.
    Public example migration also moved commerce/CRM/StackOverflow mutations and commerce queries to
    source-derived declarations, refreshed devtool graph JSON, and removed the starter template's
    stale string-keyed form handle; verification passed `pnpm exec vitest run
examples/commerce/src/app.test.ts examples/crm/src/interactive-app.test.ts
examples/stackoverflow/src/interactive-app.test.ts packages/create-kovo/src/index.build.test.ts
packages/core/src/index.test.ts`, `pnpm run check:vp`, and `git diff --check`. Remaining gap:
    some direct-test example query/domain/form handles still have explicit key strings. Tutorial step
    source now uses derived query and mutation identities with `form(addToCart)` where applicable;
    verification passed `pnpm exec vitest --run
site/tutorial/steps/03-queries/src/app.test.ts site/tutorial/steps/04-mutations/src/app.test.ts
site/tutorial/steps/05-optimistic/src/app.test.ts site/tutorial/steps/06-streaming/src/app.test.ts
site/tutorial/steps/07-verification/src/app.test.ts`, `pnpm run check:vp`, and `git diff --check`.
    Public examples now also remove residual string-keyed form handles and type components from the
    mutation values; verification passed `pnpm exec vitest run examples/commerce/src/app.test.ts
examples/crm/src/interactive-app.test.ts examples/stackoverflow/src/interactive-app.test.ts
examples/stackoverflow/src/optimism-derivation.test.ts`, `pnpm run check:vp`, and
    `git diff --check`. Public API examples and browser typing tests now use mutation-value forms
    for optimistic authoring; verification passed `pnpm exec vitest run
packages/browser/src/optimism-typing.test.ts packages/core/src/index.test.ts`. Remaining gap:
    CRM/StackOverflow direct-test query/domain declarations still use explicit names because
    migrating them currently exposes unkeyed generated live-target query definitions in direct
    Vitest paths.

- [ ] **Update generated registries, explain snapshots, compiler tests, server tests, and browser wire tests.**
  - Cover `/_m/*`, `data-mutation`, CSRF audience, replay scope, query wire chunks, domain touch
    graphs, and endpoint audits.
  - Integrated evidence (2026-06-27): compiler-emitted live-target renderers now pass concrete
    query definitions and prop-derived args from `LiveTargetFact.queryBindings` into
    `componentLiveTargetRenderer(...)` while leaving non-executable `{}` test stubs on the runtime
    fallback path; verification passed `pnpm exec vitest run
packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts`.

- [ ] **Remove legacy compatibility unless `SPEC.md` explicitly keeps it.**
  - Kovo is in technical preview, so prefer one clean authoring model over compatibility modes.
  - If a temporary migration parser is needed for generated IR fixpoint tests, keep it internal and
    document the removal point.

## Latest Verification

- 2026-06-27: `pnpm run check:vp` and `git diff --check` passed after the baseline/SPEC ledger
  update.
- 2026-06-27: Integrated path-first webhook slice `b10bd522b`; `pnpm vitest --run
packages/server/src/webhook.test.ts packages/server/src/api/app.test.ts`, `pnpm run check:vp`, and
  `git diff --check HEAD~1..HEAD` passed.
- 2026-06-27: Integrated mutation object-form/source-key slice `75edc89f2` plus shared helper
  consolidation `f948c28f7`; `pnpm exec vitest run packages/server/src/mutation.test.ts
packages/server/src/app.test.ts packages/compiler/src/scan/mutation-inputs.test.ts
packages/compiler/src/registry.test.ts packages/compiler/src/registry-identities.test.ts`,
  `pnpm run check:vp`, and `git diff --check` passed.
- 2026-06-27: Added per-mutation queue shorthand `queue: true`; `pnpm exec vitest run
packages/server/src/mutation.test.ts packages/compiler/src/scan/optimistic-inline.test.ts
packages/compiler/src/registry.test.ts`, `pnpm run check:vp`, and `git diff --check` passed.
- 2026-06-27: Integrated query object-form/source-key slice `4351aea0`; `pnpm exec vitest run
packages/server/src/query-endpoint.test.ts packages/server/src/app.test.ts
packages/compiler/src/compile-component.test.ts packages/compiler/src/registry-identities.test.ts`,
  `pnpm run check:vp`, `pnpm run check:api-surface`, and `git diff --check HEAD~1..HEAD` passed.
- 2026-06-27: Integrated domain/tag derivation slice `a8286f4d1`; `pnpm exec vitest run
packages/server/src/generated-query-registry.test.ts packages/server/src/change-record.test.ts
packages/drizzle/src/index.writes-receivers.test.ts`, `pnpm run check:vp`,
  `pnpm run check:api-surface`, and `git diff --check HEAD~1..HEAD` passed.
- 2026-06-27: Fixed integrated query dedupe/source-reparse regressions in `cfcc60e65`; `pnpm exec
vitest run packages/compiler/src/source-reparse-boundary.test.ts packages/server/src/access-graph.test.ts
packages/server/src/app.test.ts examples/commerce/src/app.test.ts examples/crm/src/interactive-app.test.ts
examples/stackoverflow/src/interactive-app.test.ts` and `pnpm exec vitest run
packages/compiler/src/compile-component.test.ts packages/server/src/query-endpoint.test.ts` passed.
- 2026-06-27: Integrated standalone Vite lowering slice `50bb4cd0a` plus scanner-boundary fix
  `94079af7c`; `pnpm exec vitest run packages/compiler/src/vite.test.ts packages/server/src/vite.test.ts
packages/server/src/mutation.test.ts packages/server/src/webhook.test.ts
packages/compiler/src/source-reparse-boundary.test.ts packages/server/src/access-graph.test.ts
examples/commerce/src/app.test.ts examples/crm/src/interactive-app.test.ts
examples/stackoverflow/src/interactive-app.test.ts`, `pnpm run check:vp`,
  `pnpm run check:api-surface`, and `git diff --check` passed.
- 2026-06-27: Integrated docs-focused migration slice `a29ad53da`; `pnpm exec vitest run
packages/create-kovo/src/index.build.test.ts examples/crm/src/interactive-app.test.ts`,
  `pnpm run check`, `pnpm run check:api-surface`, and `git diff --check HEAD~1..HEAD` passed.
- 2026-06-27: Added derived-webhook explain proof; `pnpm exec vitest run
packages/cli/src/index.kovo-explain.test.ts`, `pnpm run check:vp`, and `git diff --check` passed.
- 2026-06-27: Integrated query collision graph diagnostics `937e281af`; `pnpm exec vitest run
packages/compiler/src/registry.test.ts packages/server/src/app.test.ts
packages/cli/src/index.kovo-explain.test.ts`, `pnpm run check:vp`, and
  `git diff --check HEAD~1..HEAD` passed.
- 2026-06-27: Integrated queue values and local optimistic query references `45bbec954`; `pnpm exec
vitest run packages/server/src/mutation.test.ts packages/compiler/src/scan/optimistic-inline.test.ts
examples/crm/src/interactive-app.test.ts`, `pnpm run check:api-surface`, `pnpm run check`, and
  `git diff --check HEAD~1..HEAD` passed.
- 2026-06-27: Refreshed the mutation collision SPEC coverage citation after integration; `pnpm exec
vitest run packages/compiler/src/spec-coverage-map.test.ts`, `pnpm run test`, and
  `git diff --check` passed.
- 2026-06-27: Added mutation/query previous-registry drift diagnostics `KV246`/`KV247`; `pnpm exec
  vitest run packages/compiler/src/registry.test.ts
packages/compiler/src/diagnostic-coverage-matrix.test.ts
packages/compiler/src/spec-coverage-map.test.ts packages/core/src/diagnostics.test.ts`,
  `pnpm run check:vp`, and `git diff --check` passed.
- 2026-06-27: Added optional static-import resolution for optimistic query value refs; `pnpm exec
vitest run packages/compiler/src/scan/optimistic-inline.test.ts`, `pnpm run check:vp`, and
  `git diff --check` passed.
- 2026-06-27: Integrated public examples/templates source-derived migration; `pnpm exec vitest run
examples/commerce/src/app.test.ts examples/crm/src/interactive-app.test.ts
examples/stackoverflow/src/interactive-app.test.ts packages/create-kovo/src/index.build.test.ts
packages/core/src/index.test.ts`, `pnpm run check:vp`, and `git diff --check` passed.
- 2026-06-27: Integrated tutorial step source-derived migration; `pnpm exec vitest --run
site/tutorial/steps/03-queries/src/app.test.ts site/tutorial/steps/04-mutations/src/app.test.ts
site/tutorial/steps/05-optimistic/src/app.test.ts site/tutorial/steps/06-streaming/src/app.test.ts
site/tutorial/steps/07-verification/src/app.test.ts`, `pnpm run check:vp`, and `git diff --check`
  passed.
- 2026-06-27: Removed residual string-keyed public example form handles; `pnpm exec vitest run
examples/commerce/src/app.test.ts examples/crm/src/interactive-app.test.ts
examples/stackoverflow/src/interactive-app.test.ts examples/stackoverflow/src/optimism-derivation.test.ts`,
  `pnpm run check:vp`, and `git diff --check` passed.
- 2026-06-27: Updated public `form(addMutation)`/`OptimisticFor` docs and browser typing coverage;
  `pnpm exec vitest run packages/browser/src/optimism-typing.test.ts packages/core/src/index.test.ts`
  passed.
- 2026-06-27: Emitted generated live-target renderer query bindings from compiler facts; `pnpm exec
vitest run packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts`
  passed.
- 2026-06-27: Exercised browser `ctx.submit` with mutation-value form handles; `pnpm exec vitest
run packages/browser/src/submit-context-apply.test.ts packages/browser/src/submit-context-failure.test.ts`
  passed.
