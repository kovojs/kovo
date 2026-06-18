# Good Example Plan

Created 2026-06-18. `SPEC.md` is the framework behavior source of truth.
This ledger turns the Commerce example into a readable app while preserving the
framework proof coverage that Commerce currently carries.

## Goal

Commerce should teach the app-author mental model, not the framework's
conformance machinery. A reader should be able to understand the example by
reading authored routes, layouts, components, queries, mutations, and forms.
Generated IR, graph proofs, dev-server wiring proofs, derived-optimism algebra,
and low-level wire assertions should remain inspectable, but they should live in
package-level or conformance coverage unless they are part of the user-facing
commerce story.

This plan extends `plans/example-readability.md`: that ledger removed the
production-hardening surfaces; this one removes the remaining framework seams
that still make the simplified Commerce example feel like a test fixture.

## Target Shape

- [ ] Commerce authored source imports authored components, queries, mutations,
  layouts, and framework APIs only; app modules do not import app-local
  `src/generated/*` artifacts except in scripts, generated files, or tests that
  explicitly check generated artifacts.
  - Evidence to add: `rg -n "from './generated/|from \"\\./generated/" examples/commerce/src --glob '!**/generated/**' --glob '!**/*.test.ts'` exits 1.
- [ ] Commerce app code keeps direct framework/wire helpers out of the happy
  path: no app-authored `renderMutationEndpointResponse`,
  `renderComponentMutationFailure`, `componentMutationFailureSlots`,
  `MutationWireHeaderSource`, or direct `Kovo-*` header construction outside
  tests or package-level fixtures.
  - Evidence to add: no-match checks over `examples/commerce/src` excluding
    tests and generated artifacts, plus focused app-shell tests for browse,
    login/logout, add-to-cart success, and add-to-cart failure.
- [ ] Commerce tests are scenario tests, not proof matrices: keep route rendering,
  auth/session, no-JS add-to-cart, enhanced add-to-cart, and one graph/explain
  smoke; move generated-IR freshness, derived-optimism commuting diagrams,
  app-shell middleware command matrices, delta-wire internals, and broad graph
  source-truth assertions to package/conformance tests.
  - Evidence to add: an inventory table mapping each removed Commerce test file
    or assertion group to its new package/conformance test.
- [ ] Commerce remains an end-to-end demo of `SPEC.md` §6.3 typed mutation
  forms, §9.1 enhanced mutation round-trips, §9.2 expected failures vs
  unexpected errors, §9.5 request shell provisioning, and §10.5 derived
  optimism, but package tests own the exhaustive proof for each contract.
  - Evidence to add: focused Commerce tests plus package-level tests named under
    each moved contract.

## Track A: Readable Commerce

- [ ] Remove legacy direct-render entry points from Commerce app source or move
  them behind package/conformance fixtures.
  - Current friction: `examples/commerce/src/app.ts` still exports direct helpers
    such as `renderCartPage`, `renderProductGrid`, `submitAddToCart`, and
    no-JS submit helpers that duplicate app-shell responsibilities.
  - Remedy: make `createCommerceAppShell()` the normal execution path for the
    example. Keep tiny testing helpers only when they model user-visible flows;
    move low-level endpoint-helper tests to server package tests.
  - Evidence to add: Commerce scenario tests use `createCommerceAppShell()` or
    HTTP-style request handlers for app behavior; low-level helper tests have
    package-level replacements.
- [x] Make `ProductGrid` authoring local and ordinary.
  - Current friction: `ProductGridRenderSlots`, request threading, explicit
    `componentMutationFailureSlots`, and `renderAddToCartMutationFailure*`
    helpers make the component read like a failure-wire adapter.
  - Remedy: forms declare `mutation={addToCart}`, `<FieldError>`, and
    `<FormError>` in the authored component; CSRF, submitted-form target,
    request-scoped form state, and failure re-rendering are provided by the
    framework.
  - Evidence: `examples/commerce/src/components/product-grid.tsx` contains no
    `ComponentRenderSlots`, `componentMutationFailureSlots`, `MutationFail`,
    `csrfField`, or `ProductGridRenderSlots`; verified with
    `rg -n "ComponentRenderSlots|componentMutationFailureSlots|MutationFail|csrfField|ProductGridRenderSlots" examples/commerce/src/components/product-grid.tsx`
    exiting 1. Focused Commerce and server form-context tests pass as recorded
    in Latest verification.
- [x] Replace string-built login/logout forms with authored JSX form components.
  - Current friction: `renderCommerceLoginForm()` and
    `renderCommerceLogoutForm()` manually call `renderMutationFormAttributes`,
    `csrfField`, and `FormError`.
  - Remedy: author `LoginForm` and `LogoutForm` as Kovo form components using
    `mutation={commerceSignIn}` / `mutation={commerceSignOut}` and
    `<FormError>`; the compiler lowers the mutation URL, CSRF field, and error
    binding.
  - Evidence: `renderCommerceLoginForm()` and `renderCommerceLogoutForm()` now
    use `jsx`/`jsxs` with `mutation={commerceSignIn}` /
    `mutation={commerceSignOut}`; app-authored code no longer imports
    `renderMutationFormAttributes` or calls `csrfField`. Verified with
    `rg -n "renderMutationFormAttributes|csrfField|<form \\$\\{|FormError\\(" examples/commerce/src/app.ts examples/commerce/src/app-shell.tsx`
    exiting 1, and the focused Commerce auth/shell tests passing in Latest
    verification.
- [ ] Keep generated artifacts inspectable but out of app-authored control flow.
  - Current friction: `app.ts` imports generated component modules,
    `generated/optimistic/cart-add`, and `generated/touch-graph`; scripts splice
    Commerce-specific code into generated ProductGrid output.
  - Remedy: generated files are consumed by the build/server runtime and
    conformance checks. App-authored modules import authored components and
    declarations; graph/optimism facts are surfaced through `kovo explain` and
    package-level generated-artifact tests.
  - Evidence: app-authored runtime modules no longer import generated component,
    graph, touch, or optimism artifacts. Remaining gap: the Commerce scenario
    helper still imports `src/generated/app-shell.kovo-route.js` so enhanced
    tests load the generated live-target registry; direct authored app-shell
    execution currently lacks automatic route-component live-target
    registration.
- [ ] Reduce Commerce-local commentary that explains framework internals.
  - Current friction: many source comments are conformance notes about generated
    stamps, static extraction, and graph behavior rather than app intent.
  - Remedy: keep comments that clarify app domain behavior; move framework
    explanations to `SPEC.md`, docs, package tests, or conformance fixture names.
  - Evidence to add: source comments in `examples/commerce/src` mostly describe
    commerce behavior, not why the compiler/runtime works.

## Track B: Move Proof Burden

- [x] Inventory every Commerce proof assertion and choose a permanent owner.
  - Current candidates: generated IR freshness, generated graph facts,
    `kovo-check`, derived optimism transforms, commuting diagrams, query deltas,
    no-JS/enhanced equivalence, Vite middleware delegation, app-shell command
    matrix, CSRF/auth happy paths, and fragment error boundaries.
  - Remedy: keep only scenario-level assertions in Commerce; move protocol,
    compiler, runtime, server, and Drizzle proofs to their owning packages or
    `packages/conformance-fixtures`.
  - Evidence: inventory table below, verified in this slice with
    `corepack pnpm exec vitest run packages/compiler/src/compiler-conformance.test.ts packages/compiler/src/spec-coverage-map.test.ts`,
    `corepack pnpm exec vitest run packages/conformance-fixtures/src/derivation-fixtures.test.ts packages/drizzle/src/derive.test.ts packages/runtime/src/apply-mutation-response-delta.test.ts packages/server/src/mutation-delta.test.ts packages/test/src/derivation-pglite.test.ts`,
    and `corepack pnpm exec vitest run examples/commerce/src/source-truth.test.ts`.

| Commerce assertion | new owner | command | reason it is no longer example-local |
| --- | --- | --- | --- |
| Generated component IR freshness from `examples/commerce/src/app.rendering.test.ts` | `packages/compiler/src/compiler-conformance.test.ts` | `corepack pnpm exec vitest run packages/compiler/src/compiler-conformance.test.ts packages/compiler/src/spec-coverage-map.test.ts` | `SPEC.md` §5.2 makes TSX lowering, fixpoint, and render equivalence compiler behavior; Commerce now relies on `emit-components -- --check` for artifact freshness. |
| Broad generated graph equality and `kovo-check` facts from `examples/commerce/src/source-truth.test.ts` | `packages/conformance-fixtures/src/graph-fixtures.test.ts`, `packages/compiler/src/spec-coverage-map.test.ts`, and CLI kovo-check coverage | `corepack pnpm exec vitest run packages/compiler/src/spec-coverage-map.test.ts` | Static graph shape and diagnostic acceptance are framework proof surfaces; Commerce keeps one `cart/add` explain smoke showing the example is wired. |
| Derived optimism commuting diagrams from `examples/commerce/src/derivation-commuting.test.ts` | `packages/conformance-fixtures/src/derivation-fixtures.test.ts`, `packages/drizzle/src/derive.test.ts`, and `packages/test/src/derivation-pglite.test.ts` | `corepack pnpm exec vitest run packages/conformance-fixtures/src/derivation-fixtures.test.ts packages/drizzle/src/derive.test.ts packages/test/src/derivation-pglite.test.ts` | `SPEC.md` §10.5 assigns algebra soundness to the deriver; Commerce only needs the explain summary `total=3 derived=3`. |
| Query-delta internals from `examples/commerce/src/queries-delta.test.ts` | `packages/server/src/mutation-delta.test.ts` and `packages/runtime/src/apply-mutation-response-delta.test.ts` | `corepack pnpm exec vitest run packages/runtime/src/apply-mutation-response-delta.test.ts packages/server/src/mutation-delta.test.ts` | `SPEC.md` §9.1.1 delta selection, merge, and build-token fallback are protocol/runtime behavior, not Commerce scenario behavior. |
| App-shell command matrix and Vite delegation in `examples/commerce/src/app-shell.test.ts` | `packages/server/src/vite-dev-middleware.test.ts`, `packages/server/src/node.test.ts`, and server app dispatch tests | Pending | `SPEC.md` §9.5 makes request-shell dispatch and dev middleware package behavior; Commerce should keep HTTP user-flow smokes only. |
| Fragment header grammar and live-target internals in Commerce shell/add-to-cart tests | `packages/runtime/src/mutation-targets.test.ts`, `packages/runtime/src/fragment-targets.test.ts`, `packages/server/src/live-target-registry.test.ts`, and server mutation wire tests | Pending | `SPEC.md` §9.1 owns `Kovo-Targets` / `Kovo-Live-Targets`; app examples should assert visible cart, stock, order, and validation behavior. |
| Expected vs unexpected fragment error-boundary proof using `renderFaults` | `packages/server/src/live-target-renderer.test.tsx`, `packages/server/src/component-render.test.tsx`, `packages/server/src/route-jsx.test.tsx`, and `packages/server/src/mutation-response.test.ts` | `corepack pnpm exec vitest run packages/server/src/live-target-renderer.test.tsx packages/server/src/component-render.test.tsx packages/server/src/route-jsx.test.tsx packages/server/src/mutation-response.test.ts` | `SPEC.md` §9.2 makes expected failure forms typed and unexpected render failures server/component behavior; Commerce request types no longer carry test-only fault hooks. |

- [x] Move generated component/route IR freshness checks out of Commerce tests.
  - SPEC link: `SPEC.md` §5.2 requires lowered IR to stay authorable and
    fixpoint-checkable.
  - Remedy: package/compiler or conformance tests should compile representative
    Commerce-like components/routes and assert fixpoint/render equivalence.
    Commerce can keep `emit-components -- --check` as a build freshness command,
    not a broad example-local test.
  - Evidence: `packages/compiler/src/compiler-conformance.test.ts` now owns the
    Commerce component committed-IR §5.2 gate; `examples/commerce/src/app.rendering.test.ts`
    no longer imports compiler/conformance proof helpers. Verified with
    `corepack pnpm exec vitest run packages/compiler/src/compiler-conformance.test.ts examples/commerce/src/app.rendering.test.ts`.
- [x] Move derived optimism algebra out of Commerce scenario tests.
  - SPEC link: `SPEC.md` §10.5 defines derivation algebra.
  - Remedy: `@kovojs/drizzle` or conformance fixtures own property/commuting
    tests for insert/update/select shapes. Commerce keeps one smoke asserting
    `cart/add` is explain-derived for `cart`, `productGrid`, and `orderHistory`.
  - Evidence: deleted `examples/commerce/src/derivation-commuting.test.ts`;
    package commands above prove the contract fixtures and real-PGlite commuting
    suite, while `examples/commerce/src/source-truth.test.ts` keeps the
    `OPTIMISTIC-SUMMARY total=3 derived=3` smoke.
- [ ] Move app-shell middleware and command-matrix proof to server/app-shell tests.
  - SPEC link: `SPEC.md` §9.5 defines the request shell and app entry behavior.
  - Remedy: package/server tests own Vite delegation, Node handler conversion,
    client module serving, and query/mutation endpoint wiring. Commerce keeps
    one HTTP smoke that proves `/cart`, login, and add-to-cart work in the
    example shell.
  - Evidence to add: server/app-shell tests cover shared plugin behavior; the
    Commerce test no longer reads `package.json` or `vite.config.ts` to enforce
    command matrices.
- [x] Move wire-level delta and fragment internals to runtime/server tests.
  - SPEC link: `SPEC.md` §9.1 and §9.1.1 define fragment and query-delta wire.
  - Remedy: package tests assert `Kovo-Targets`, `Kovo-Live-Targets`, keyed
    fragments, delta payloads, and stylesheet behavior. Commerce scenario tests
    assert visible behavior: cart count changes, stock changes, order appears,
    and validation errors render.
  - Evidence: deleted `examples/commerce/src/queries-delta.test.ts`; verified
    query-delta package ownership with
    `corepack pnpm exec vitest run packages/runtime/src/apply-mutation-response-delta.test.ts packages/server/src/mutation-delta.test.ts`.
    Header-grammar cleanup in Commerce shell tests remains tracked by the
    pending inventory rows above.
- [x] Move unexpected-error boundary proof to component/server tests.
  - SPEC link: `SPEC.md` §9.2 separates expected mutation failures from
    unexpected errors.
  - Remedy: define first-class component/live-target error-boundary authoring,
    test it in server/component rendering, and keep Commerce free of
    test-only `renderFaults` request fields.
  - Evidence: `corepack pnpm exec vitest run packages/server/src/live-target-renderer.test.tsx packages/server/src/component-render.test.tsx packages/server/src/route-jsx.test.tsx packages/server/src/mutation-response.test.ts` passes, covering full-page `<ErrorBoundary>` fallback and component-local generated live-target fragment fallback. `rg -n "withCommerceProductGridLiveTargetAdapter|renderFaults|ProductGrid\\$commerceLiveTargetRenderer" examples/commerce packages scripts` exits 1.

## Framework Deficiencies And Remedies

- [ ] **Deficiency 1: generated artifacts still leak into authored app modules.**
  - Current symptom: `examples/commerce/src/app.ts` imports
    `./generated/cart-badge`, `./generated/order-history`,
    `./generated/product-grid`, `./generated/optimistic/cart-add`, and
    `./generated/touch-graph`.
  - Why it matters: `SPEC.md` §5.2 says lowered IR is an artifact to inspect, not
    app-authored source to wire by hand. Requiring app modules to choose generated
    imports makes build output part of the app mental model.
  - Remedy: enforce the boundary as **authored imports for humans, generated
    imports for compiled runtime artifacts and proof tests only**.
    App-authored Commerce modules should import authored components such as
    `./components/cart-badge.js`, `./components/order-history.js`, and
    `./components/product-grid.js`. The compiler/build then rewrites or wires
    those references to generated execution artifacts in generated route/runtime
    modules. Generated component modules, route modules, live-target registries,
    touch graphs, and optimism transforms stay committed and inspectable, but
    are registered by the compiler/build or consumed by package-level proof
    commands rather than hand-imported by app runtime modules.
  - Allowed generated import contexts: files under `src/generated/`, emit/build
    scripts, and tests whose purpose is explicitly generated-artifact freshness,
    graph/explain, or conformance proof.
  - Acceptance: no app-authored Commerce module imports `./generated/*`; compiler
    diagnostics catch app-local generated imports outside allowed artifact/test
    contexts.
  - Evidence to add:
    `rg -n "from './generated/|from \"\\./generated/" examples/commerce/src --glob '!**/generated/**' --glob '!**/*.test.ts'`
    exits 1 with no matches.
- [ ] **Deficiency 2: mutation failure response policy is too broad and too
  manual.**
  - Current symptom: `createCommerceAppShell()` has a key switch for sign-in,
    sign-out, and add-to-cart response policy; direct helpers repeat
    `renderFailurePage` and `renderFailureFragment` logic.
  - Clarification: the framework still needs an internal mutation registry so a
    POST to `/_m/<key>` can find the mutation, run guards/CSRF/transaction, and
    produce the HTTP response. The deficiency is the **app-authored centralized
    dispatcher**. Ordinary apps should not have to write one broad
    `mutationResponses` switch just to render typed form failures or redirect
    after common successes.
  - Why it matters: `SPEC.md` §6.3 and §9.2 make expected failures a typed form
    concern. App authors should not route ordinary validation/coded failures
    through a central endpoint switch to get the same form back.
  - Remedy: move response policy to the narrowest declarative owner:
    - mutation-level `defaultRedirectTo` for static/common POST-redirect-GET
      behavior,
    - form/route-local defaults for expected failure rendering,
    - app-level overrides only as an escape hatch for unusual cross-cutting
      response behavior.
    Enhanced and no-JS failure rendering should default to the submitted
    form/route context. Add a route/form-local failure-page default that can
    reconstruct the containing route and bind `forms.<mutation>.failure` without
    bespoke `renderFailurePage` / `renderFailureFragment` functions.
  - Handler return-value rule: mutation handlers should return domain/change
    values and typed failures (`context.fail(...)`) by default. Allow
    `context.redirect(...)` only as an explicit escape hatch for dynamic
    redirects that depend on data produced by the mutation, such as a newly
    created order id. Static redirects like Commerce add-to-cart use
    `defaultRedirectTo: '/cart'` because they are navigation policy, not the
    domain write result.
  - Acceptance: Commerce add-to-cart and sign-in failures render through
    `<FieldError>` / `<FormError>` without app-authored failure fragment/page
    callbacks. Commerce has no broad app-authored mutation response dispatcher
    for ordinary success/failure behavior; any remaining app-level mutation
    response hook is documented as an escape hatch and covered by package tests.
- [x] **Deficiency 3: request-scoped form data and CSRF are exposed as component
  slots.**
  - Current symptom: `ProductGridRenderSlots` carries `request` and
    `forms.addToCart.failure`; `renderAddToCartForm()` receives request solely
    to emit CSRF and failure UI.
  - Why it matters: `SPEC.md` §6.3 typed forms and §9.5 request shell imply the
    framework knows the request, session, CSRF policy, submitted form instance,
    and mutation failure state. The component should declare the form, not carry
    transport state.
  - Remedy: make request-aware mutation forms a framework feature. The author
    writes only the form intent:
    ```tsx
    <form enhance mutation={addToCart} key={item.id}>
      <input type="hidden" name="productId" value={item.id} />
      <input name="quantity" type="number" min="1" max={item.stock} value="1" />
      <FieldError name="quantity" />
      <FormError code="OUT_OF_STOCK" />
    </form>
    ```
    The compiler/runtime lowers that to the mutation action, POST method,
    submitted-form target, CSRF hidden field when the mutation declares CSRF,
    and typed failure bindings for the enclosing form instance. Live-target
    re-renderers receive the same request/form context automatically, so
    refreshed ProductGrid forms keep CSRF fields and clear per-form failure
    state without app-authored slots.
  - Commerce cleanup target: delete `ProductGridRenderSlots`,
    `ProductGridMutationSlots`, `defaultProductGridRenderSlots`,
    `productGridItemSlots`, `addToCartFailureSlots`,
    `renderAddToCartMutationFailureForm`,
    `renderAddToCartMutationFailureError`, and any `request` parameter whose only
    purpose is CSRF/failure state.
  - Acceptance: `ProductGrid` has no custom render-slot type for ordinary form
    failure/CSRF behavior; live-target refresh and no-JS page rerender both show
    the same typed errors.
  - Evidence: implemented runtime-deferred `<FieldError>` / `<FormError>`
    resolution in `packages/core/src/index.ts` and
    `packages/server/src/jsx-runtime.ts`; route and generated live-target
    renderers carry submitted failure input and CSRF context. Verified with
    `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx packages/server/src/mutation-endpoint.test.ts packages/server/src/live-target-renderer.test.tsx`,
    the focused Commerce scenario suite, and the no-match ProductGrid scan above.
- [x] **Deficiency 4: component/live-target error boundaries are not first-class
  authoring.**
  - Current symptom: `scripts/emit-components.mjs` splices a Commerce-specific
    ProductGrid live-target adapter with an error boundary and a test fault hook.
  - Why it matters: `SPEC.md` §9.2 distinguishes expected mutation failures from
    unexpected errors. Unexpected render errors need an ordinary component or
    route boundary declaration, not generated-file surgery.
  - Remedy: use a React-style `<ErrorBoundary>` as the primary authoring surface:
    ```tsx
    <ErrorBoundary fallback={<ProductGridError />}>
      <ProductGrid />
    </ErrorBoundary>
    ```
    The compiler lowers the boundary wrapper to server/live-target boundary facts
    and a stable boundary fragment target. During full-page render, the nearest
    boundary renders its fallback when a descendant render throws. During
    live-target fragment refresh, a descendant render failure patches the nearest
    boundary target with the fallback instead of requiring generated-file
    splicing. Expected mutation failures remain separate and continue through
    `<FieldError>` / `<FormError>`, not error boundaries. Component-local
    `boundaries: { error }` can remain a future convenience, but the tree-local
    boundary is the authoring model.
  - Commerce cleanup target: delete `CommerceRenderFaults`,
    `request.renderFaults?.productGrid?.()`,
    `withCommerceProductGridLiveTargetAdapter(...)`, and any generated
    `ProductGrid$commerceLiveTargetRenderer` splice. If Commerce keeps a
    ProductGrid fallback, it should be authored as `<ErrorBoundary>` in the route
    tree.
  - Acceptance: no Commerce script mutates generated ProductGrid output; package
    tests prove per-island fragment error boundaries.
  - Evidence: `examples/commerce/src/app-shell.tsx` authors `<ErrorBoundary fallback={<ProductGridError />}>`; `examples/commerce/src/components/product-grid.tsx` declares the same fallback for generated live-target rendering. `corepack pnpm exec vitest run packages/server/src/live-target-renderer.test.tsx packages/server/src/component-render.test.tsx packages/server/src/route-jsx.test.tsx packages/server/src/mutation-response.test.ts` passes, including per-island generated live-target fragment fallback. `corepack pnpm --filter @kovojs/example-commerce run emit-components -- --check` passes. `rg -n "withCommerceProductGridLiveTargetAdapter|renderFaults|ProductGrid\\$commerceLiveTargetRenderer" examples/commerce packages scripts` exits 1.
- [x] **Deficiency 5: direct endpoint helper APIs invite app-level wire
  reconstruction.**
  - Current symptom: Commerce exports `submitAddToCart`,
    `submitAddToCartNoJs`, `submitCommerceSignInNoJs`, and
    `submitCommerceSignOutNoJs`, each manually passing CSRF, headers, redirects,
    failure renderers, request, and session provider.
  - Why it matters: `SPEC.md` §9.1 says enhanced mutations and no-JS forms share
    one endpoint contract. App examples should demonstrate the app shell, not
    teach authors to reconstruct endpoint calls by hand.
  - Remedy: narrow direct endpoint helpers to package tests or mark them
    low-level framework APIs, and add a framework-provided test utility that
    drives the real app `RequestHandler` instead of bypassing it. Commerce tests
    should express user actions such as route render, form submit, enhanced form
    submit, login, and logout through that utility:
    ```ts
    const testApp = createKovoTestClient(createCommerceAppShell().requestHandler);

    await testApp.get('/cart');
    await testApp.submit(addToCart, {
      enhanced: true,
      fields: { productId: 'p1', quantity: '2' },
      session: userSession,
    });
    ```
    The utility may automate form encoding, cookies, CSRF extraction/submission,
    and enhanced headers, but it must still send `Request` objects through the
    app handler so tests cover the same path users hit.
  - Package-test ownership: server/runtime tests own direct
    `renderMutationEndpointResponse` behavior, `Kovo-Targets` /
    `Kovo-Live-Targets` grammar, no-JS 303s, enhanced fragment envelopes, 422
    failure envelopes, stylesheet inclusion, and CSRF rejection.
  - Acceptance: Commerce app source no longer exports low-level submit helpers;
    Commerce tests use the framework test utility for form submission; server
    package tests own direct `renderMutationEndpointResponse` coverage.
  - Evidence: `examples/commerce/src/app.ts` no longer exports
    `submitAddToCart*`, `submitCommerceSignInNoJs`,
    `submitCommerceSignOutNoJs`, or calls `renderMutationEndpointResponse`.
    Verified with
    `rg -n "renderMutationEndpointResponse|MutationWireHeaderSource|submitAddToCart|submitCommerceSignInNoJs|submitCommerceSignOutNoJs|componentMutationFailureSlots|renderComponentMutationFailure|ProductGridRenderSlots|renderAddToCartMutationFailure" examples/commerce/src --glob '!**/*.test.ts' --glob '!**/generated/**'`
    exiting 1. Remaining `Kovo-*` header construction is confined to the
    Commerce scenario helper until a framework test client owns enhanced
    request simulation.
- [x] **Deficiency 6: graph and derivation facts still require example-local
  generated plumbing.**
  - Current symptom: Commerce app exports `commerceTouchGraph`,
    `commerceQueryDomains`, `commerceGraph`, and `addToCartOptimistic` from
    generated files so tests and docs can prove graph behavior.
  - Why it matters: `SPEC.md` §10.5 wants derivation to be explainable, but app
    authors should ask the CLI, not import generated graph data into app runtime
    modules.
  - Remedy: make the CLI the app-author inspection surface: `kovo explain`,
    `kovo check`, and example-local `emit-graph -- --check` commands read the
    committed generated artifacts and print graph/derivation facts. Do **not**
    introduce a public runtime or app-author API such as `explainProject()` for
    graph/optimism inspection. Package internals may use private helpers in tests,
    but the public contract is CLI output plus committed generated artifacts.
    App runtime exports stay domain-oriented.
  - Runtime registration rule: if enhanced mutation refresh still needs generated
    touch/query facts at runtime, the compiler/build registers those facts in
    generated route/runtime artifacts. App-authored modules do not import or
    re-export generated touch graphs, query-domain maps, graph JSON, or optimism
    transforms.
  - Acceptance: Commerce graph smoke uses CLI output and/or generated artifact
    freshness commands; app runtime modules do not re-export generated
    graph/touch/optimism facts.
  - Evidence:
    `rg -n "commerceTouchGraph|commerceQueryDomains|cartAddDerivedOptimistic|addToCartOptimistic|commerceGraph" examples/commerce/src/app.ts`
    exits 1 with no matches; Commerce graph smoke reads generated graph JSON
    from the test, and app runtime modules no longer re-export generated
    graph/touch/optimism facts.
- [ ] **Deficiency 7: app-shell setup still teaches integration internals.**
  - Current symptom: Commerce app-shell source constructs a memory client module
    registry, exposes a manual client module, casts request types for CSRF, and
    tests Vite plugin delegation details.
  - Why it matters: `SPEC.md` §9.5 request shell is the public app entry model.
    The app declaration must remain inspectable because it is where request
    context and security assumptions become concrete: routes, mutations,
    `req.db`, `req.session`, document defaults, guards, CSRF, and exposed
    query/mutation endpoints. The deficiency is not an explicit app shell; it is
    making ordinary examples teach low-level transport/dev-server/client-module
    plumbing.
  - Remedy: keep the request shell as a readable app declaration:
    ```ts
    export const commerceApp = createApp({
      db: () => createCommerceDb(),
      document: { lang: 'en-US' },
      mutations: [addToCart, commerceSignIn, commerceSignOut],
      routes: [commerceHomeRoute, commerceCartRoute, commerceLoginRoute],
      sessionProvider: commerceSessionProvider,
    });
    ```
    Provide a higher-level app-shell helper or starter-style wrapper that owns
    request handler creation, Node handler conversion, default client module
    registry setup, generated route/runtime artifact loading, and standard Vite
    dev middleware integration. Keep low-level registries and Vite delegation in
    server/app-shell tests.
  - Acceptance: Commerce app-shell source reads like app setup; package tests
    cover client-module registry and Vite integration.

## Verification Gate

- [x] Run focused Commerce checks after each simplification slice:
  `pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
  `pnpm --filter @kovojs/example-commerce run emit-graph -- --check`, and the
  reduced Commerce scenario suite.
  - Evidence: focused scenario checks ran as
    `corepack pnpm exec vitest run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.rendering.test.ts`;
    emit freshness commands are recorded in latest verification below.
- [x] Run the moved package/conformance checks named by Track B before deleting
  or weakening any Commerce-local proof assertion.
  - Evidence: package owner commands named in the completed Track B items passed
    before deleting the Commerce derivation and delta proof files.
- [x] Run root gates before marking this plan complete:
  `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
  `node scripts/api-surface-gate.mjs`, and `git diff --check`.
  - Evidence: latest verification below records all three commands passing for
    this Track B slice; the plan remains open for pending app-shell and
    error-boundary proof relocation.

Latest verification:

- [x] `pnpm --filter @kovojs/example-commerce run emit-components -- --check`
  passed after the framework form-context and Commerce ProductGrid cleanup.
- [x] `pnpm --filter @kovojs/example-commerce run emit-graph -- --check`
  passed after regenerating graph/touch artifacts.
- [x] `pnpm exec vitest --run examples/commerce/src/app.add-to-cart.test.ts examples/commerce/src/app.queries.test.ts examples/commerce/src/source-truth.test.ts examples/commerce/src/app-shell.test.ts examples/commerce/src/app.rendering.test.ts examples/commerce/src/app.auth.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/registry.test.ts packages/server/src/route-jsx.test.tsx packages/server/src/mutation-endpoint.test.ts packages/server/src/live-target-renderer.test.tsx`
  passed.
- [x] `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` passed.
- [x] `node scripts/api-surface-gate.mjs` passed with
  `public-exports-needing-attention=2904 (baseline=2904, fixed-this-run=0)`.
- [x] `git diff --check` passed.

- [x] `corepack pnpm --filter @kovojs/example-commerce run emit-components -- --check`
  passed after regenerating stale generated route IR with
  `corepack pnpm --filter @kovojs/example-commerce run emit-components`.
- [x] `corepack pnpm --filter @kovojs/example-commerce run emit-graph -- --check`
  passed.
- [x] `corepack pnpm exec vitest run examples/commerce/src/source-truth.test.ts examples/commerce/src/app.rendering.test.ts packages/compiler/src/compiler-conformance.test.ts packages/compiler/src/spec-coverage-map.test.ts`
  passed.
- [x] `corepack pnpm exec vitest run packages/conformance-fixtures/src/derivation-fixtures.test.ts packages/drizzle/src/derive.test.ts packages/runtime/src/apply-mutation-response-delta.test.ts packages/server/src/mutation-delta.test.ts packages/test/src/derivation-pglite.test.ts`
  passed.
- [x] `git diff --check` passed.
- [x] `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`
  passed.
- [x] `node scripts/api-surface-gate.mjs` passed with
  `public-exports-needing-attention=2904 (baseline=2904, fixed-this-run=0)`.
