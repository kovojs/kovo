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
    - Additional progress 2026-06-17:
      `packages/compiler/src/emit/live-target-renderers.ts` appends
      compiler-generated `*$liveTargetRenderer` exports to lowered TSX modules
      for inferred live targets. These exports call the internal
      `componentLiveTargetRenderer()` helper with the component binding,
      component registry id, declared query expressions, and prop-derived query
      args.
    - `packages/compiler/src/compile-component.test.ts` proves singleton
      live-target renderer export emission; `packages/compiler/src/registry.test.ts`
      proves `productQuery.args((props) => ({ id: props.productId }))` is emitted
      as the generated renderer `args` callback.
    - Regenerated lowered artifacts in `examples/commerce/src/generated`,
      `examples/crm/src/generated`, `examples/stackoverflow/src/generated`, and
      `site/tutorial/steps/*/src/generated` now expose generated
      `*$liveTargetRenderer` exports.
    - Remaining gaps: target identity expressions for keyed/parameterized
      instances and coverage facts are not emitted yet; build/app-shell
      integration still needs to collect generated renderer exports
      automatically.
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
    - Additional progress 2026-06-17:
      generated lowered TSX renderer exports now consume emitted query binding
      facts, including `.args((props) => ...)`, and pass them to the server
      helper that reloads declared queries from serialized props.
    - Additional progress 2026-06-17:
      `packages/server/src/query.ts` now keeps a back-reference to the backing
      server query on runtime `.args((props) => ...)` bindings, so server JSX
      route rendering can load prop-bound component queries without app-authored
      loaders.
    - Verified with
      `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx packages/server/src/component-render.test.tsx`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gap: compiler-generated route IR still needs to stamp serialized
      component props for route pages, and build/app-shell wiring still needs to
      collect generated renderer exports automatically.
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
    - Additional progress 2026-06-17:
      `RoutePageComponentFact` now carries `propsExpression`,
      `serializedPropsExpression`, and optional `keyExpression` so generated
      route IR can stamp `kovo-props` from the same JSX invocation facts instead
      of re-parsing component calls.
    - `packages/compiler/src/route-pages.test.ts` covers `key={params.id}`,
      route-param props, static props, nested shell props, and empty props as
      generated props serialization facts.
    - Verified with
      `pnpm exec vitest --run packages/compiler/src/registry.test.ts packages/compiler/src/route-pages.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check -- SPEC.md plans/automatic-enhanced-refresh.md packages/compiler/src/types.ts packages/compiler/src/index.ts packages/compiler/src/route-pages.ts packages/compiler/src/route-pages.test.ts`.
    - Additional verification 2026-06-17:
      `pnpm exec vitest --run packages/compiler/src/route-pages.test.ts packages/compiler/src/registry.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, and
      `node scripts/api-surface-gate.mjs`.
    - Additional progress 2026-06-17:
      server route execution now installs request context for server JSX, and
      `@kovojs/server/jsx-runtime` recognizes Kovo `component(...)` descriptors,
      loads direct and prop-bound declared queries, and renders async JSX
      children. This enables runtime-authored route pages such as
      `page: () => <QuestionListRegion />` and
      `page: ({ params }) => <QuestionDetailRegion questionId={params.id} />`.
    - Verified with
      `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx packages/server/src/component-render.test.tsx packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gap: compiler-generated executable route IR and build/app-shell
      integration are still open; runtime JSX proves the authoring model but
      does not yet remove transitional generated registry imports.
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
    - Additional progress 2026-06-17:
      generated `LiveTargetRenderer` entries now carry their declared query keys,
      and mutation selection can choose `Kovo-Live-Targets` descriptors from
      renderer metadata even when DOM `kovo-deps` contains component-local query
      aliases.
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
    - Additional progress 2026-06-17:
      `packages/compiler/src/emit/server.ts` now stamps inferred live-target
      hosts with generated `kovo-props={JSON.stringify({ ... })}` for declared
      component props, and keeps `kovo-props` generated-only for semantic render
      equivalence. `packages/runtime/src/inline-loader-build.ts` now compacts
      local identifiers without rewriting string protocol names, so the shipped
      inline loader reads `kovo-live-component` instead of a shortened attribute.
    - Verified with
      `pnpm exec vitest --run packages/compiler/src/stamps.test.ts packages/runtime/src/inline-loader-build.test.ts packages/runtime/src/inline-loader-enhanced-submit.test.ts packages/runtime/src/mutation-targets.test.ts packages/runtime/src/mutation-fetch.test.ts`,
      `pnpm --filter @kovojs/runtime run check:inline-loader`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gap: legacy target-only compatibility remains until examples and
      app-shell integration finish migrating to generated live-target registries.
- [ ] **6. Server: auto-render affected targets.**
  - Add a generated-registry-aware response selector to `createApp()` /
    mutation response handling.
  - The selector should run all declared queries for each selected target and
    render full fragments without app-authored `fragmentRenderers` for ordinary
    success.
  - Delete the general explicit `mutationResponse` success-routing API once the
    generated path is in place; model auth redirects, raw endpoints, webhooks, and
    non-component responses through narrower declared surfaces.
  - Progress 2026-06-17:
    - `packages/server/src/mutation-wire.ts` defines generated
      `LiveTargetRenderer` entries keyed by component registry name.
    - `packages/server/src/app-types.ts`, `app.ts`, and
      `app-mutation-request.ts` let `createApp({ liveTargetRenderers })` pass
      generated renderer registries into enhanced mutation responses.
    - `packages/server/src/mutation.ts` selects affected
      `Kovo-Live-Targets` descriptors by intersecting committed rerun queries
      with live `Kovo-Targets`, then renders matching generated live-target
      fragments without app-authored `fragmentRenderers`.
    - `packages/server/src/mutation-response.test.ts` proves direct mutation
      responses render affected live-target descriptors from generated renderers;
      `packages/server/src/app.test.ts` proves the same path through
      `createApp()` / `createRequestHandler()`.
    - `packages/server/src/live-target-renderer.ts` adds the generated-code
      helper that reloads declared component queries from serialized props and
      calls `renderComponent()`; it is exported only from the internal wire
      subpath for compiler-emitted modules.
    - `packages/server/src/live-target-renderer.test.tsx` proves prop-derived
      query args are loaded from descriptors and render through the component's
      normal render function.
    - Verified with
      `pnpm exec vitest --run packages/server/src/mutation-response.test.ts packages/server/src/app.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/mutation-wire.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional verification 2026-06-17:
      `pnpm exec vitest --run packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts packages/server/src/app.test.ts packages/server/src/mutation-wire.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `packages/compiler/src/compile.ts` now threads inferred live target facts
      into compiler-generated lowered TSX exports that call
      `componentLiveTargetRenderer()` for real component modules; example and
      tutorial generated artifacts were refreshed with those exports.
    - Verified with
      `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts packages/server/src/app.test.ts packages/server/src/mutation-wire.test.ts`,
      `pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
      `pnpm --filter @kovojs/example-crm run emit-components -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`,
      `node site/tutorial/run-steps.mjs`,
      `pnpm --filter @kovojs/example-commerce test`,
      `pnpm --filter @kovojs/example-crm test`,
      `pnpm --filter @kovojs/example-stackoverflow test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `packages/server/src/live-target-renderer.ts` exposes declared query keys
      on generated renderers, and `packages/server/src/mutation.ts` uses those
      keys to select generated live descriptors and query JSON even when DOM
      dependency stamps use component-local query aliases.
    - Verified with
      `pnpm exec vitest --run packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts packages/server/src/app.test.ts packages/server/src/mutation-wire.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `componentLiveTargetRenderer()` now renders components with
      `{ ...context.props, ...queries }`, so serialized props are available to
      component render functions as well as query arg callbacks. This lets
      compiler-generated re-rendered fragments restamp their own `kovo-props`
      channel.
    - Verified with
      `pnpm exec vitest --run packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts packages/server/src/app.test.ts packages/server/src/mutation-wire.test.ts`,
      `pnpm --filter @kovojs/example-crm run emit-components -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`,
      `pnpm --filter @kovojs/example-crm test`,
      `pnpm --filter @kovojs/example-stackoverflow test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `packages/server/src/live-target-registry.ts` adds the internal
      `collectGeneratedLiveTargetRenderers()` primitive that extracts only
      compiler-emitted `*$liveTargetRenderer` exports from generated module
      namespaces, dedupes identical renderers, and rejects conflicting duplicate
      component ids. This is the framework-owned collection step needed before
      app-shell/build code can import generated modules without app-authored
      registry wiring.
    - Verified with
      `pnpm exec vitest --run packages/server/src/live-target-registry.test.ts packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts`
      and `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
    - Additional progress 2026-06-17:
      `packages/server/src/app-mutation-request.ts` now merges app-level
      `createApp({ queries })` registrations into the mutation registry used for
      enhanced mutation rerun selection. Mutations no longer have to duplicate
      the app query list in each `registry.queries` block for generated live
      targets to refresh.
    - Verified with
      `pnpm exec vitest --run packages/server/src/app.test.ts packages/server/src/mutation-response.test.ts packages/server/src/live-target-registry.test.ts`
      and `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
    - Remaining gaps: build/app-shell integration still needs to collect the
      generated renderer exports without app-authored `createApp()` wiring; the
      broad app-authored `mutationResponse` success-routing escape hatch is
      still present until examples migrate.
- [ ] **7. Migrate StackOverflow.**
  - Move presentational enrichment and detail filtering into declared queries or
    query arg bindings.
  - Remove generated target imports and `mutationResponse` fragment routing from
    `examples/stackoverflow/src/interactive-app.ts`.
  - Route pages should compose `<QuestionListRegion />` /
    `<QuestionDetail questionId={params.id} />` directly rather than calling
    `renderQuestionListPage`, `renderQuestionListRegion`, or
    `renderQuestionListRegionFromDb`.
  - Progress 2026-06-17:
    - `examples/stackoverflow/src/queries.ts` now declares prop-backed
      `questionDetail` and `questionAnswers` queries; `QuestionDetailRegion`
      declares `props: { questionId: String }` and binds both queries with
      `.args((props) => ...)`.
    - `examples/stackoverflow/src/interactive-app.ts` no longer has a manual
      `loadAnswersForQuestion()` helper and uses the declared detail queries for
      both full detail pages and the current transitional detail fragment
      renderer.
    - `examples/stackoverflow/src/graph.ts` marks prop-backed detail query edges
      as `await-fragment`, so kovo-check coverage stays explicit while the full
      fragment server-truth path matures.
    - Regenerated `examples/stackoverflow/src/generated/question-detail.tsx`,
      `generated/touch-graph.ts`, and `generated/graph.json`.
    - Verified with
      `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `examples/stackoverflow/src/interactive-app.ts` no longer defines an
      ordinary `mutationResponse` switch, `fragmentRenderers`, generated target
      constant imports, `renderQuestionListRegionFromDb`, or
      `renderQuestionDetailRegionFromDb`. It uses generated live-target
      renderers for ordinary enhanced mutation success; tests now post
      `Kovo-Live-Targets` descriptors and prove the real PGlite mutation response
      renders affected list/detail fragments from generated server truth.
    - `examples/stackoverflow/scripts/emit-components.mjs` now emits
      `src/generated/live-targets.ts`, which collects the generated
      `*$liveTargetRenderer` exports with the framework-owned collector.
    - Verified with
      `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`
      and
      `pnpm --filter @kovojs/example-stackoverflow test -- interactive-app.test.ts`.
    - Additional progress 2026-06-17:
      `examples/stackoverflow/src/interactive-app.tsx` is now a TSX-authored
      route module whose list and detail pages compose
      `<QuestionListRegion />` and
      `<QuestionDetailRegion questionId={params.id} />` directly through
      server JSX. The route module no longer calls `renderQuestionListPage`,
      `renderQuestionDetailPage`, or direct `question*.load(...)` page loaders.
      `examples/stackoverflow/tsconfig.json` includes TSX app modules and the
      demo server loads `/src/interactive-app.tsx`.
    - Verified with
      `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx packages/server/src/component-render.test.tsx`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `examples/stackoverflow/src/components/{question-list,question-detail}.tsx`
      and regenerated counterparts no longer export `QUESTION_*_TARGET`,
      `renderQuestion*Region`, `renderQuestion*Page`, or page-data wrapper
      types.
    - Verified with
      `rg -n "QUESTION_LIST_TARGET|QUESTION_DETAIL_TARGET|renderQuestionListRegion|renderQuestionListPage|renderQuestionDetailRegion|renderQuestionDetailPage|QuestionListPageData|QuestionDetailPageData" examples/stackoverflow/src/components examples/stackoverflow/src/generated`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-stackoverflow test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gaps: list-region presentational enrichment is still outside the
      declared query model, and the transitional generated live-target registry
      import is still present.
- [ ] **8. Migrate CRM.**
  - Move contact/deal/detail presentation data into declared queries or explicit
    component query args.
  - Remove generated target imports and `mutationResponse` fragment routing from
    `examples/crm/src/interactive-app.ts`.
  - Route pages should compose `<PipelineRegion />`, `<ContactsRegion />`, and
    `<DealDetailRegion dealId={params.id} />` directly rather than calling
    `render*Page`, `render*Region`, or `render*RegionFromDb` helpers.
  - Progress 2026-06-17:
    - `examples/crm/src/interactive-app.ts` no longer defines an ordinary
      `mutationResponse` switch, `fragmentRenderers`, generated target constant
      imports, `render*RegionFromDb`, or `readInputField`. It registers
      `createApp({ liveTargetRenderers, queries: crmQueries })` so ordinary
      enhanced mutation success refreshes visible query-backed regions from
      generated server truth.
    - `examples/crm/scripts/emit-components.mjs` now emits
      `src/generated/live-targets.ts`, which collects generated
      `*$liveTargetRenderer` exports with the framework-owned collector.
    - `examples/crm/src/queries.ts` registers all CRM query definitions for
      app-level rerun selection while keeping the local Drizzle extractor-facing
      loader shape; `examples/crm/src/mutations.ts` declares domain touches for
      `addContact`, `createDeal`, `moveDeal`, and `closeDeal`.
    - `examples/crm/src/interactive-app.test.ts` posts `Kovo-Live-Targets`
      descriptors and proves real PGlite mutation responses render affected
      contact, pipeline, and deal-detail fragments from generated renderers.
    - Verified with
      `pnpm --filter @kovojs/example-crm run emit-components -- --check`,
      `pnpm --filter @kovojs/example-crm run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-crm test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `examples/crm/src/interactive-app.tsx` is now a TSX-authored route module
      whose pages compose `<PipelineRegion />`, `<ContactsRegion />`, and
      `<DealDetailRegion dealId={params.id} />` directly through server JSX.
      The route module no longer calls `renderPipelinePage`,
      `renderContactsPage`, `renderDealDetailPage`, or direct page-level
      `*.load(...)`/Drizzle loaders. `examples/crm/tsconfig.json` includes TSX
      app modules and the demo server loads `/src/interactive-app.tsx`.
    - `examples/crm/src/components/deal-detail.tsx` now renders an explicit
      missing-deal state for unmatched route params instead of falling back to
      the first deal row.
    - Verified with
      `pnpm --filter @kovojs/example-crm run emit-components -- --check`,
      `pnpm --filter @kovojs/example-crm run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-crm test`,
      `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx packages/server/src/component-render.test.tsx`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Additional progress 2026-06-17:
      `examples/crm/src/components/{contacts,pipeline,deal-detail}.tsx` and
      regenerated counterparts no longer export `*_TARGET`, `render*Region`,
      `render*Page`, or page-data wrapper types.
    - Verified with
      `rg -n "CONTACT_LIST_TARGET|PIPELINE_TARGET|DEAL_DETAIL_TARGET|renderContactsRegion|renderContactsPage|renderPipelineRegion|renderPipelinePage|renderDealDetailRegion|renderDealDetailPage|ContactsPageData|PipelinePageData|DealDetailPageData|DetailDeal|DetailContact" examples/crm/src/components examples/crm/src/generated`,
      `pnpm --filter @kovojs/example-crm run emit-components -- --check`,
      `pnpm --filter @kovojs/example-crm run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-crm test`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gap: the transitional generated live-target registry import is
      still present.
- [ ] **9. Migrate commerce.**
  - Split the large commerce integration module so app-authored page/mutation
    code is separate from auth/webhook/test helpers.
  - Remove ordinary success fragment renderer routing from `app.ts` and
    `app-shell.ts`; keep explicit handlers only where required for auth failures,
    webhooks, downloads, or other non-component responses.
  - Route pages should compose cart/product/history components directly rather
    than using hand-authored fragment wrapper strings.
  - Progress 2026-06-17:
    - `examples/commerce/src/app.ts` and `examples/commerce/src/app-shell.ts`
      no longer pass app-authored `fragmentRenderers` for ordinary
      `cart/add` success. Both paths register/use generated
      `liveTargetRenderers`; the app-shell `mutationResponse` remains only for
      auth redirect/failure and add-to-cart failure page/fragment handling.
    - `examples/commerce/scripts/emit-components.mjs` now emits
      `src/generated/live-targets.ts`. The generated registry collects the
      cart-badge and order-history renderers and adds the Commerce-specific
      ProductGrid request-slot adapter so generated success rerenders keep
      CSRF/request-scoped forms.
    - `packages/server/src/mutation.ts` / `mutation-wire.ts` now support
      generated live-target `errorBoundary`, preserving ProductGrid per-island
      failure fallback without restoring app-authored success fragment routing.
    - `examples/commerce/src/app.add-to-cart.test.ts`,
      `examples/commerce/src/app-shell.test.ts`, and
      `packages/conformance-fixtures/src/commerce-fixtures.ts` now post
      `Kovo-Live-Targets` descriptors plus query-dependency `Kovo-Targets`,
      proving generated renderers update cart badge, product grid, and order
      history from server truth.
    - Verified with
      `pnpm exec vitest --run packages/server/src/mutation-response.test.ts packages/server/src/live-target-renderer.test.tsx packages/server/src/live-target-registry.test.ts`,
      `pnpm --filter @kovojs/example-commerce run emit-components -- --check`,
      `pnpm --filter @kovojs/example-commerce run emit-graph -- --check`,
      `pnpm --filter @kovojs/example-commerce test -- app.add-to-cart.test.ts app-shell.test.ts`,
      `pnpm --filter @kovojs/example-commerce test`,
      `pnpm exec vitest --run packages/conformance-fixtures/src/commerce-fixtures.test.ts`,
      `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check`.
    - Remaining gaps: route-page wrapper helpers and the transitional generated
      live-target registry import are still present; the app-shell still uses
      `mutationResponse` for auth redirects and add-to-cart failure rendering.
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
    - `packages/compiler/src/compile-component.test.ts` covers emitted
      `CartBadge$liveTargetRenderer`; `packages/compiler/src/registry.test.ts`
      covers emitted prop-backed `ProductDetail$liveTargetRenderer` with a
      generated `args: (props) => ({ id: props.productId })` callback.
    - `packages/compiler/src/route-pages.test.ts` covers route-param-backed
      component invocation facts for generated props serialization and
      `keyExpression`.
    - Remaining gap: keyed repeated and route-param-backed generated-renderer
      fixtures are still pending.
- [ ] **Runtime/server tests prove no app-authored fragment renderers are needed.**
  - Enhanced mutation success should update visible query-backed targets using the
    generated registry.
  - Progress 2026-06-17:
    - `packages/server/src/mutation-response.test.ts` proves generated live
      descriptors render from `liveTargetRenderers` and are selected from
      renderer-declared query keys even when DOM deps are component-local aliases.
    - `packages/server/src/mutation-response.test.ts` also proves generated
      live-target renderer `errorBoundary` handles a failing selected descriptor
      as a per-target fragment.
    - Remaining gap: build/app-shell wiring still needs to collect generated
      renderer exports automatically; examples still import transitional
      generated live-target registries and some escape-hatch `mutationResponse`
      failure/auth routing remains.
- [ ] **Example no-match checks prove the DX outcome.**
  - `rg -n 'fragmentRenderers|mutationResponse\\(|_TARGET|render[A-Za-z]+Region|render[A-Za-z]+RegionFromDb' examples/stackoverflow/src examples/crm/src examples/commerce/src`
    should have no ordinary app-authored success-routing hits after migration
    except explicitly documented escape hatches.
  - Evidence: pending.
