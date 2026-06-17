# Automatic Enhanced Mutation Refresh

Created 2026-06-17. Behavioral source of truth is `SPEC.md`; this ledger tracks
the work to make enhanced mutation refresh an internal compiler/runtime concern,
not an app-authored `mutationResponse` / `fragmentRenderers` concern.

## Goal

App authors should write query-backed components and enhanced mutation forms:

```tsx
route('/', {
  page: () => <QuestionListRegion />,
});

export const QuestionListRegion = component({
  queries: { questionList, questionScore },
  render: ({ questionList, questionScore }) => ...,
});
```

For parameterized pages, route params should pass as ordinary serializable props:

```tsx
route('/questions/:id', {
  page: ({ params }) => <QuestionDetail questionId={params.id} />,
});

export const QuestionDetail = component({
  props: s.object({ questionId: s.string() }),
  queries: {
    question: questionQuery.args((props) => ({ id: props.questionId })),
    answers: answerListQuery.args((props) => ({ questionId: props.questionId })),
  },
  render: ({ question, answers }) => ...,
});

<form enhance mutation={postAnswer}>...</form>
```

They should not import generated target constants, route enhanced mutation
responses by mutation key, write region wrapper functions, or hand-author
fragment renderers. Specifically, app-authored files should not contain ordinary
success-path plumbing such as:

- `QUESTION_LIST_TARGET`
- `renderQuestionListRegion`
- `renderQuestionListRegionFromDb`
- `fragmentRenderers`
- `mutationResponse` switch statements

The framework should derive the enhanced response from:

- the submitted mutation's committed change record / touch graph,
- the browser's live `Kovo-Targets`,
- the query-backed component's declared queries and serializable props,
- the generated server renderer for that component instance.

No-JS behavior remains ordinary POST -> redirect/full-page render. This plan only
removes app-authored bookkeeping from the enhanced path.

## Current Problems

- [ ] **Examples still teach app-authored refresh routing.**
  - `examples/stackoverflow/src/interactive-app.ts` and
    `examples/crm/src/interactive-app.ts` manually import generated target
    constants and choose `fragmentRenderers` by mutation key.
  - `examples/commerce/src/app.ts` / `app-shell.ts` do the same plus lower-level
    no-JS and auth response wiring, making the normal app authoring model hard to
    see.
- [ ] **Examples wrap components in app-authored region functions.**
  - StackOverflow and CRM expose `renderQuestionListRegion`,
    `renderPipelineRegion`, and similar helpers so app shells can manually
    re-render fragments. Those helpers should become generated artifacts or
    disappear behind route/component lowering; app source should compose
    components directly in `route().page`.
- [ ] **Generated target constants leak into app source.**
  - Query-backed component roots already derive `kovo-fragment-target` per
    `SPEC.md` §4.1/§4.2, but app shells still import generated `*_TARGET`
    constants to build response fragments.
- [ ] **Queries and page loaders are split in some examples.**
  - StackOverflow and CRM keep some presentational joins or route-param filtering
    outside the declared query model, so the server cannot yet re-run only the
    component's declared queries to reconstruct every region.
- [ ] **`createApp()` lacks a generated server-render registry.**
  - `SPEC.md` §9.1 describes mutation fragments/query JSON, and §4.1/§4.2
    describes query-backed refreshable components, but the implementation still
    requires app code to connect live targets to component render functions.

## Design Direction

- [ ] **Lock route pages as compiler-processed TSX source.**
  - Decision: `route().page` authoring may return JSX, but that JSX is scanned
    and lowered by the Kovo compiler into generated server IR. It is not merely
    opaque runtime JSX execution.
  - Consequence: route pages must stay inside the statically analyzable Kovo
    authoring subset. Unsupported dynamic route composition receives a teaching
    diagnostic rather than falling back to app-authored refresh wiring.
  - This is a pre-release breaking direction: do not preserve APIs that require
    app authors to hand-route enhanced mutation fragments.
- [ ] **Make "refresh" generated IR, not an app API.**
  - App source should not mention `refresh`, `fragmentRenderers`, target
    constants, or mutation-key routing for ordinary enhanced mutation success.
  - If an internal name is needed, prefer "server render registry" or "live target
    registry" over an author-facing "refresh" concept.
- [ ] **Make route pages compose components directly.**
  - The target authoring shape is `route('/', { page: () => <QuestionListRegion /> })`,
    not `page: () => renderQuestionListPage(loadData())`.
  - Route pages may pass route params/search values as props, but should not
    select fragment targets or call hand-authored region render helpers.
- [ ] **Generate a live target registry for query-backed components.**
  - For each inferred server-refreshable component, emit registry metadata:
    derived target identity, component binding, declared queries, query arg
    expressions, serializable props, and the server render function.
  - The generated metadata is an artifact like lowered IR: inspectable for
    verification, but not app-authored source.
- [ ] **Let the build own generated registry wiring.**
  - Decision: app authors do not pass a `generated` or `refresh` option to
    `createApp()`. The compiler/build integration wires generated route IR and
    live target registry artifacts into the server entry.
  - Transitional explicit registry imports are allowed only inside generated
    artifacts and tests that inspect generated output.
- [ ] **Stamp enough reconstructability data into dev HTML.**
  - A live target must carry or reference the data needed to reconstruct the
    component instance on the server: component identity, target identity,
    serializable props / keys, and query instance dependencies.
  - Dev output should stay legible and auditable. Production may compress or
    version this state if `kovo explain` can reconstruct it.
- [ ] **Use component query declarations as the only ordinary data source.**
  - Region re-rendering should run the component's declared queries with derived
    args, then call the component render function.
  - Extra page/region loaders should be treated as a migration smell unless they
    are declared as query composition or an explicit non-refreshable escape hatch.
- [ ] **Support route/prop-derived query args as first-class authoring.**
  - Finish the local-args model described by `SPEC.md` §8 so a component can bind
    query inputs from its own props, including route params passed as props.
  - Repeated component instances must derive stable target identity from authored
    `key` or serializable keyed props.
- [ ] **Require explicit stable identity for repeated or parameterized targets.**
  - Decision: singleton query-backed components use the derived component leaf.
    Repeated or parameterized targets must have stable identity from authored
    `key` or a declared identity prop that is serializable and visible in route
    composition.
  - Ambiguous target identity is a compile error, not a runtime best effort.
- [ ] **Auto-select enhanced mutation responses on the server.**
  - After a mutation commits, intersect the committed changes with live
    `Kovo-Targets`.
  - Decision for the first complete design: reload all declared queries for each
    selected target and return a full fragment from the generated live target
    registry. Query JSON/delta selection is a later optimization layered on the
    same registry, not a prerequisite for removing app-authored routing.
  - Failure responses remain submitted-form rerenders per `SPEC.md` §6.3/§9.2.
- [ ] **Keep explicit escape hatches narrow and auditable.**
  - Components that cannot be reconstructed should use
    `disableServerRefresh: true` or receive a compiler diagnostic explaining the
    missing serializable props/query args.
  - Decision: remove ordinary explicit `mutationResponse` success routing. Raw
    endpoints/webhooks, downloads, auth redirects, and non-component responses
    use separate declared framework surfaces rather than a general mutation
    response switch.
- [ ] **Put UI data in queries, with derivation metadata per field/query.**
  - Decision: queries should represent the actual data needed to render the
    component. "Skinny derivation queries plus separate presentation loaders" are
    rejected for ordinary app code.
  - The compiler may derive optimistic/delta behavior for the fields and query
    shapes it can prove and mark the rest as full-fragment/server-truth only.

## Implementation Plan

- [x] **1. SPEC contract update.**
  - Update `SPEC.md` §4.1/§4.2/§4.8/§9.1 to state that enhanced mutation success
    response selection and target rendering are generated from query-backed
    component metadata, not app-authored `mutationResponse` routing.
  - Define the live target registry as generated authorable IR and describe the
    dev-mode HTML/runtime stamps used to reconstruct component instances.
  - Clarify that no-JS mutation behavior remains full-page/redirect and does not
    require target reconstruction.
  - Lock the following decisions: compiler-processed route JSX, full-fragment
    first implementation, all declared queries reloaded for selected targets,
    no app-authored generated-registry wiring, no general `mutationResponse`
    success switch, and query shapes that match UI data.
  - Evidence 2026-06-17:
    - `SPEC.md` §4.5 now says route pages returning JSX are
      compiler-processed Kovo source, not opaque runtime JSX, and that the
      compiler lowers route pages into server IR plus the live-target registry.
    - `SPEC.md` §9.1 now defines `Kovo-Live-Targets`, generated success response
      selection, full-fragment-first target rendering, all-declared-query reloads
      for selected targets, and no ordinary app-authored `mutationResponse` /
      `fragmentRenderers` / target-constant / `render*RegionFromDb` success path.
    - `SPEC.md` §9.5 now says generated route IR and live-target registry wiring
      are build-owned, not app-authored `createApp({ generated, refresh })`.
    - `SPEC.md` §10.2 now says queries are the UI data contract and rejects
      skinny derivation queries plus separate presentation loaders for ordinary
      app code.
    - Verified with `rg -n 'compiler-processed Kovo source|Kovo-Live-Targets|ordinary app-authored `mutationResponse`|Queries are the UI data contract|Generated route IR and live-target registry' SPEC.md`
      and `git diff --check -- SPEC.md plans/automatic-enhanced-refresh.md`.
- [ ] **2. Compiler: emit live target registry metadata.**
  - Extend the component scan/emit pipeline to produce metadata for inferred
    server-refreshable targets: component id, target identity expression, declared
    queries, query arg bindings, required props, render export, and coverage facts.
  - Reject inferred refresh when props/query args are not serializable or target
    identity is ambiguous.
  - Progress 2026-06-17:
    - `packages/core/src/index.ts` now has an augmentable
      `LiveTargetRegistry` generated-registry surface.
    - `packages/compiler/src/internal-graph.ts` derives `LiveTargetFact` for
      inferred server-refreshable query-backed components, joining target,
      component registry key, declared query names, and props type.
    - `packages/compiler/src/emit/registry.ts` emits a `LiveTargetRegistry`
      interface and declaration merge in generated registry modules.
    - `packages/compiler/src/compile-component.test.ts` and
      `packages/compiler/src/registry.test.ts` cover generated live-target
      registry output for a query-backed component.
    - Verified with
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts packages/compiler/src/route-pages.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and the focused `git diff --check`.
    - Remaining gaps: render exports, target identity expressions for
      keyed/parameterized instances, and coverage facts are not emitted yet.
- [ ] **3. Compiler/core: make query args from props/routes usable.**
  - Ensure `query.args((props) => ...)` style authoring is typed, scanned, emitted,
    and available to generated server renderers.
  - Route params/search values should reach components as ordinary serializable
    props, so detail-page regions do not need ad-hoc loaders.
  - Progress 2026-06-17:
    - `packages/core/src/index.ts` adds typed `query(...).args((props) => args)`
      component-query bindings for serializable props.
    - `packages/server/src/query.ts` wraps parameterized query schemas with a
      callable args binder while preserving normal schema parsing for query
      endpoints and mutation reruns.
    - `packages/compiler/src/internal-graph.ts` extracts component query binding
      facts, including `.args((props) => ...)` source, props parameter name, and
      accessed prop paths; `packages/compiler/src/emit/registry.ts` emits those
      facts in `LiveTargetRegistry`.
    - `packages/core/src/index.test.ts`,
      `packages/server/src/query-endpoint.test.ts`, and
      `packages/compiler/src/registry.test.ts` cover typed query args binding,
      schema parsing, and registry emission for
      `productQuery.args((props) => ({ id: props.productId }))`.
    - Verified with
      `pnpm exec vitest --run packages/core/src/index.test.ts packages/server/src/query-endpoint.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts packages/compiler/src/route-pages.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gap: generated server renderers do not yet consume the emitted
      query binding facts to reload and render component instances.
- [ ] **4. Server/compiler: lower route JSX pages.**
  - Support route pages that return TSX component invocations, for example
    `page: () => <QuestionListRegion />` and
    `page: ({ params }) => <QuestionDetail questionId={params.id} />`.
  - The lowering should generate the initial page query loads, component render
    call, live target metadata, and page shell integration without requiring
    app-authored `render*Page` / `render*Region` functions.
  - Route shell/layout composition is ordinary JSX component composition, e.g.
    `<SoShell><QuestionListRegion /></SoShell>`, and is lowered with the route
    page rather than expressed through hand-authored string wrappers.
  - Progress 2026-06-17:
    - `packages/compiler/src/route-pages.ts` adds `compileRouteModule()` to
      extract JSX-authored `route().page` composition facts: route path,
      component invocations, static props, and route-param property access props.
    - `packages/compiler/src/types.ts` defines `RoutePageFact`,
      `RoutePageComponentFact`, and `RoutePageComponentPropFact`; the compiler
      root exports the new fact extractor and types.
    - `packages/compiler/src/route-pages.test.ts` covers
      `page: () => <QuestionListRegion />`, parameterized props
      `questionId={params.id}`, nested shell composition
      `<SoShell><QuestionListRegion /></SoShell>`, and ignoring string-returning
      legacy routes.
    - `deriveAppGraph({ routePages })` now accepts compiled route-page facts and
      derives route registry facts from JSX-authored route modules, covered by
      `packages/compiler/src/registry.test.ts`.
    - Verified with
      `pnpm exec vitest --run packages/compiler/src/registry.test.ts packages/compiler/src/route-pages.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check -- SPEC.md plans/automatic-enhanced-refresh.md packages/compiler/src/types.ts packages/compiler/src/index.ts packages/compiler/src/route-pages.ts packages/compiler/src/route-pages.test.ts`.
    - Remaining gap: this is fact extraction only; generated executable route IR,
      initial query loading, and app-shell integration are still open.
- [ ] **5. Runtime: send complete live target descriptors.**
  - Extend `Kovo-Targets` collection so enhanced mutation POSTs carry enough
    structured target data for the server to find the generated registry entry and
    reconstruct props/query instances.
  - Preserve backward compatibility while examples migrate, then remove legacy
    target-only assumptions once tests cover the new path.
  - Progress 2026-06-17:
    - `packages/compiler/src/emit/server.ts` stamps inferred refreshable hosts
      with generated `kovo-live-component` registry keys while keeping the stamp
      generated-only for semantic render equivalence.
    - `packages/runtime/src/mutation-targets.ts` collects both legacy
      `Kovo-Targets` dependency entries and structured `Kovo-Live-Targets`
      descriptors from one live DOM scan; modular enhanced fetch and the inline
      loader now send both headers.
    - `packages/server/src/mutation-wire.ts` parses `Kovo-Live-Targets` into
      structured `{ target, component, props }` descriptors while preserving
      legacy `Kovo-Targets` parsing for current selection behavior.
    - `packages/runtime/src/mutation-targets.test.ts`,
      `packages/runtime/src/inline-loader-enhanced-submit.test.ts`,
      `packages/server/src/mutation-wire.test.ts`, and
      `packages/compiler/src/stamps.test.ts` cover descriptor collection,
      inline/modular parity, server parsing, and compiler host stamping.
    - Verified with
      `pnpm exec vitest --run packages/runtime/src/mutation-targets.test.ts packages/runtime/src/mutation-fetch.test.ts packages/runtime/src/mutation-submit.test.ts packages/runtime/src/loader-enhanced-mutation-submit.test.ts packages/runtime/src/submit-context-apply.test.ts packages/runtime/src/mutation-optimistic-pagehide.test.ts packages/runtime/src/inline-loader-enhanced-submit.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-artifact-minifier.test.ts packages/server/src/mutation-wire.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `pnpm --filter @kovojs/runtime run check:inline-loader`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gap: generated route/render lowering does not yet stamp actual
      serializable component props or consume descriptors to render fragments.
- [ ] **6. Server: auto-render affected targets.**
  - Add a generated-registry-aware response selector to `createApp()` /
    mutation response handling.
  - The selector should run all declared queries for each selected target and
    render full fragments without app-authored `fragmentRenderers` for ordinary
    success.
  - Delete the general explicit `mutationResponse` success-routing API once the
    generated path is in place; model auth redirects, raw endpoints, webhooks, and
    non-component responses through narrower declared surfaces.
  - Evidence: pending.
- [ ] **7. Migrate StackOverflow.**
  - Move presentational enrichment and detail filtering into declared queries or
    query arg bindings.
  - Remove generated target imports and `mutationResponse` fragment routing from
    `examples/stackoverflow/src/interactive-app.ts`.
  - Route pages should compose `<QuestionListRegion />` /
    `<QuestionDetail questionId={params.id} />` directly rather than calling
    `renderQuestionListPage`, `renderQuestionListRegion`, or
    `renderQuestionListRegionFromDb`.
  - Evidence: pending.
- [ ] **8. Migrate CRM.**
  - Move contact/deal/detail presentation data into declared queries or explicit
    component query args.
  - Remove generated target imports and `mutationResponse` fragment routing from
    `examples/crm/src/interactive-app.ts`.
  - Route pages should compose `<PipelineRegion />`, `<ContactsRegion />`, and
    `<DealDetailRegion dealId={params.id} />` directly rather than calling
    `render*Page`, `render*Region`, or `render*RegionFromDb` helpers.
  - Evidence: pending.
- [ ] **9. Migrate commerce.**
  - Split the large commerce integration module so app-authored page/mutation
    code is separate from auth/webhook/test helpers.
  - Remove ordinary success fragment renderer routing from `app.ts` and
    `app-shell.ts`; keep explicit handlers only where required for auth failures,
    webhooks, downloads, or other non-component responses.
  - Route pages should compose cart/product/history components directly rather
    than using hand-authored fragment wrapper strings.
  - Evidence: pending.
- [ ] **10. Docs/tutorial update.**
  - Teach the authoring model as "declare queries and serializable props; Kovo
    updates enhanced mutations from server truth automatically."
  - Move target constants, live target registry, and fragment envelopes into
    verification/debugging docs rather than app-author tutorials.
  - Evidence: pending.

## Verification Targets

- [ ] **Compiler tests prove generated registry facts.**
  - Add fixtures for singleton, keyed repeated, and route-param-backed query
    components.
  - Progress 2026-06-17:
    - `packages/compiler/src/registry.test.ts` covers a singleton cart live target
      and a prop-backed query args binding fixture.
    - Remaining gap: keyed repeated and route-param-backed generated-renderer
      fixtures are still pending.
- [ ] **Runtime/server tests prove no app-authored fragment renderers are needed.**
  - Enhanced mutation success should update visible query-backed targets using the
    generated registry.
  - Evidence: pending.
- [ ] **Example no-match checks prove the DX outcome.**
  - `rg -n 'fragmentRenderers|mutationResponse\\(|_TARGET|render[A-Za-z]+Region|render[A-Za-z]+RegionFromDb' examples/stackoverflow/src examples/crm/src examples/commerce/src`
    should have no ordinary app-authored success-routing hits after migration
    except explicitly documented escape hatches.
  - Evidence: pending.
