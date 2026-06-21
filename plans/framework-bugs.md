# Framework Bugs Audit

**Date:** 2026-06-21

**Scope:** Follow-up audit after the Stack Overflow `postAnswer` refresh bug fixed in commit
`6787d044`. The audited bug class is identity drift across query keys, component aliases,
fragment targets, live-target descriptors, query instance keys, and mutation refresh selection.

**Status:** Audit report only. No remediation is implemented in this file.

## Confirmed Bug Backlog

- [ ] **Critical: mutation rerun query chunks use raw mutation input instead of component-bound query input.**
  - Evidence: [packages/server/src/mutation.ts](/Users/mini/kovo/packages/server/src/mutation.ts:1619)
    `renderQueryChunks` calls `runQuery(queryDefinition, input, request)` with the mutation input,
    while [packages/server/src/live-target-renderer.ts](/Users/mini/kovo/packages/server/src/live-target-renderer.ts:168)
    correctly reconstructs query input from `binding.args(context.props)`.
  - Failure mode: detail queries whose args differ from mutation inputs rerun with the wrong object.
    Stack Overflow `postAnswer` has `{ id: answerId, questionId }`, but `questionDetail` expects
    `{ id: questionId }`; `voteUp` has `{ targetId }`, so selected `questionDetail` can fail or
    load the wrong row.
  - Repro: submit `postAnswer` with `id="a2"` and `questionId="q1"` while
    `question-detail-region` is visible; assert the `questionDetail` query chunk, if emitted, is
    for `q1`, not `a2`. Submit `voteUp` with detail visible and assert no successful mutation
    turns into a rerun-query render error.
  - Fix sketch: generated/live-target renderers should own query reruns for component fragments, or
    mutation rerun chunks need stored per-live-target query inputs instead of raw mutation input.

- [ ] **High: `Kovo-Live-Targets` descriptors can bypass the `Kovo-Targets` live-DOM intersection.**
  - Evidence: [packages/server/src/mutation.ts](/Users/mini/kovo/packages/server/src/mutation.ts:1837)
    `selectMutationResponseTargets` treats a descriptor as affected when its renderer query list
    matches affected tokens, even when that descriptor target is absent from submitted
    `Kovo-Targets`.
  - Failure mode: a guessed or stale descriptor can make the server render a generated fragment for
    a target that is not in the current live DOM. This violates SPEC.md §9.1's stateless
    live-target selection model and can expose non-visible UI fragments if component ids are
    guessable.
  - Repro: send `Kovo-Targets: cart-badge=cart` and
    `Kovo-Live-Targets: admin-panel#components/admin/panel:{}` with an `admin-panel` renderer that
    declares `queries: ['cart']`; assert no `admin-panel` fragment is returned.
  - Fix sketch: only consider descriptors whose `target` has a matching parsed `Kovo-Targets`
    entry; use descriptor data to render an already-selected target, not to select targets by
    itself.

- [ ] **High: query endpoint chunks lose the declared query key for instance-keyed reads.**
  - Evidence: [packages/server/src/query.ts](/Users/mini/kovo/packages/server/src/query.ts:570)
    `renderQueryEndpointChunk` emits `name: instanceKey ?? queryDefinition.key` and no `key`
    attribute; [packages/browser/src/wire-parser.ts](/Users/mini/kovo/packages/browser/src/wire-parser.ts:244)
    splits a colon-bearing `name` into `{ name, key }`.
  - Failure mode: a query `productDetail` with instance key `product:p1` emits
    `<kovo-query name="product:p1">`, which parses as `{ name: 'product', key: 'p1' }`, not
    `{ name: 'productDetail', key: 'product:p1' }`. The query store can hydrate or settle the wrong
    slot, leaving the actual component query stale.
  - Repro: define `query('productDetail', { instanceKey: input => \`product:${input.id}\` })`,
    render a `/_q/productDetail?id=p1` response, parse it with `readMutationResponseBodyChunks` or
    `readQueryChunks`, and assert identity is `productDetail` + `product:p1`.
  - Fix sketch: query endpoint chunks should mirror mutation rerun chunks: `name=queryDefinition.key`
    and `key=instanceKey` when present.

- [ ] **High: repeated source/runtime component instances collapse to one live target.**
  - Evidence: [packages/server/src/jsx-runtime.ts](/Users/mini/kovo/packages/server/src/jsx-runtime.ts:553)
    derives the default target from the component leaf name; [packages/browser/src/mutation-targets.ts](/Users/mini/kovo/packages/browser/src/mutation-targets.ts:60)
    dedupes live descriptors by target and keeps the first props set.
  - Failure mode: two `<ProductDetail productId="p1" />` / `<ProductDetail productId="p2" />`
    instances source-served through JSX both stamp `kovo-fragment-target="product-detail"`, so the
    browser sends one descriptor and one props object. One instance can remain stale or receive the
    wrong fragment.
  - Repro: render two query-backed component instances with different props, collect
    `Kovo-Live-Targets`, and assert there are two distinct targets and two distinct serialized prop
    objects.
  - Fix sketch: source/runtime stamping needs a stable instance suffix when props/key identify a
    repeated live target, matching the compiler's `key` / `kovo-key` contract in SPEC.md §4.8 and
    §13.2.

- [ ] **High: browser target collection precedence does not match fragment apply precedence.**
  - Evidence: [packages/browser/src/mutation-targets.ts](/Users/mini/kovo/packages/browser/src/mutation-targets.ts:50)
    collects target identity as `kovo-fragment-target ?? id ?? kovo-c`, while
    [packages/browser/src/fragment-targets.ts](/Users/mini/kovo/packages/browser/src/fragment-targets.ts:17)
    and [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:290)
    apply fragments by searching `kovo-c` before id/`kovo-fragment-target`.
  - Failure mode: if one element advertises `kovo-fragment-target="cart"` and a sibling has
    `kovo-c="cart"`, the browser requests target `cart` for the first element but applies the
    returned fragment to the second.
  - Repro: DOM with `<section kovo-fragment-target="cart" kovo-deps="cart">old</section>` and
    `<aside kovo-c="cart">wrong</aside>`; submit a fragment for target `cart`; assert the section
    updates and the aside does not in both modular and inline loaders.
  - Fix sketch: make collection and apply use the same precedence, or reject ambiguous duplicate
    target identities before submit/apply.

- [ ] **High: compiler-emitted component `kovo-deps` still uses query aliases, not query keys.**
  - Evidence: [packages/compiler/src/emit/server.ts](/Users/mini/kovo/packages/compiler/src/emit/server.ts:2090)
    `declaredQueryDepsStamp` calls `componentOptionObjectKeys(model, 'queries')`, which are local
    render prop aliases. The source-served JSX fix now uses `binding.query.key` in
    [packages/server/src/jsx-runtime.ts](/Users/mini/kovo/packages/server/src/jsx-runtime.ts:547).
  - Failure mode: lowered/generated components can reproduce the exact Stack Overflow class:
    `queries: { answers: questionAnswers, question: questionDetail }` emits
    `kovo-deps="answers question"` instead of `questionAnswers questionDetail`.
  - Repro: compiler test with `questionAnswersQuery.key = 'questionAnswers'` bound under local key
    `answers`; assert emitted `kovo-deps` uses `questionAnswers`.
  - Fix sketch: the compiler scanner/model needs to retain the query definition key for each
    component query binding, not just the object property name.

- [ ] **Medium-high: parameterized live-target renderer matching loses instance identity.**
  - Evidence: [packages/server/src/live-target-renderer.ts](/Users/mini/kovo/packages/server/src/live-target-renderer.ts:65)
    exposes renderer `queries` as base query keys only; [packages/server/src/mutation.ts](/Users/mini/kovo/packages/server/src/mutation.ts:1876)
    uses those broad keys to select descriptors.
  - Failure mode: two visible `product-card` descriptors for `product:p1` and `product:p2` can both
    be selected when only `product:p1` changed because the renderer declares `['product']`.
  - Repro: submit mutation with live targets `product-card:p1=product:p1` and
    `product-card:p2=product:p2`; assert only the changed instance descriptor is selected.
  - Fix sketch: descriptor selection should derive each binding's instance key from descriptor props
    before comparing, or require the matching `Kovo-Targets` deps to carry the exact instance token.

- [ ] **Medium: broad query-token fallback makes instance-specific deps ambiguous.**
  - Evidence: [packages/server/src/mutation.ts](/Users/mini/kovo/packages/server/src/mutation.ts:1908)
    `queryRerunTokens` returns both `[query.key, query.instanceKey]` for an instance rerun.
  - Failure mode: a live target stamped `kovo-deps="product"` matches a specific
    `product:p1` invalidation. That can over-refresh unrelated instances and amplifies the
    parameterized descriptor bug above.
  - Repro: request `Kovo-Targets: product-card:p2=product` while the mutation only touches
    `product:p1`; assert p2 is not selected unless the change is whole-query/table-level.
  - Fix sketch: distinguish whole-query invalidation from instance invalidation instead of adding the
    base key to every instance rerun token set.

- [ ] **Medium: route component import aliases drop derived page query/navigation metadata.**
  - Evidence: [packages/compiler/src/route-pages.ts](/Users/mini/kovo/packages/compiler/src/route-pages.ts:149)
    stores navigation segment component names from route JSX facts; [packages/compiler/src/internal-graph.ts](/Users/mini/kovo/packages/compiler/src/internal-graph.ts:436)
    maps query metadata by component export name and then looks up `component.localName`.
  - Failure mode: `import { CartBadge as Badge } from './cart-badge.js'; page: () => <Badge />`
    records `Badge`, but graph derivation knows queries under `CartBadge`; page `queries` and
    navigation segment `queries` are silently omitted.
  - Repro: route compilation/graph test with an aliased component import; assert page facts still
    include the component's declared query keys.
  - Fix sketch: route facts should carry resolved import/export identity in addition to local JSX
    binding name, or graph derivation should consult route import alias metadata.

- [ ] **Medium: inline loader treats CSS-selector-invalid targets as total misses.**
  - Evidence: [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:290)
    wraps all target lookup in one `try/catch` and builds raw CSS selectors; modular lookup escapes
    selector strings at [packages/browser/src/fragment-targets.ts](/Users/mini/kovo/packages/browser/src/fragment-targets.ts:17).
  - Failure mode: a target that is valid as a DOM id but invalid in the first raw selector
    (`target"bad`, newline, backslash) can be found by modular runtime but silently missed by the
    inline loader.
  - Repro: installed inline loader with `<div id='target"bad' kovo-deps="x">old</div>` and a
    `<kovo-fragment target="target&quot;bad">...`; assert it updates, or formally reject that target
    charset in compiler/runtime validation.
  - Fix sketch: share the modular escaped lookup helper with the inline loader, or attempt
    `getElementById` outside the selector `try/catch`.

- [ ] **Medium: live-target header protocol is delimiter-fragile for target/component identities.**
  - Evidence: [packages/server/src/mutation-wire.ts](/Users/mini/kovo/packages/server/src/mutation-wire.ts:335)
    splits `Kovo-Targets` on `;` and `,`; [packages/server/src/mutation-wire.ts](/Users/mini/kovo/packages/server/src/mutation-wire.ts:412)
    parses descriptors using first `#` and first `:` after that. Browser serialization is raw at
    [packages/browser/src/mutation-targets.ts](/Users/mini/kovo/packages/browser/src/mutation-targets.ts:72).
  - Failure mode: authored `key`/id/target values containing `;`, `,`, `#`, or `:` can corrupt
    target parsing, descriptor parsing, or instance identity. SPEC.md §13.2 says authored `key`
    participates in fragment target identity, so this needs either encoding or validation.
  - Repro: target/key containing `#`, comma, or semicolon; assert browser-collected headers parse
    back to exactly one target descriptor with the same identity.
  - Fix sketch: encode header fields with a structured format, or enforce and document an allowed
    target/key charset at compile/runtime boundaries.

## Coverage Gaps That Would Have Caught This Class

- [ ] **Add DOM-derived header tests for Commerce enhanced mutations.**
  - Evidence: [examples/commerce/src/app-test-helpers.ts](/Users/mini/kovo/examples/commerce/src/app-test-helpers.ts:173)
    hard-codes cart page target headers before submit.
  - Repro coverage: render `/cart`, derive `Kovo-Targets` / `Kovo-Live-Targets` from the actual
    document, submit `addToCart`, and assert returned fragments update the visible regions.

- [ ] **Add DOM-derived header tests for CRM parameterized detail mutations.**
  - Evidence: [examples/crm/src/interactive-app.test.ts](/Users/mini/kovo/examples/crm/src/interactive-app.test.ts:182)
    hand-builds `deal-detail-region` headers for mutation tests.
  - Repro coverage: GET `/deals/d1`, collect headers from rendered DOM, POST `moveDeal` or
    `closeDeal`, and assert the detail fragment uses `{ dealId: 'd1' }` and updates without reload.

- [ ] **Finish DOM-derived header coverage for all Stack Overflow forms.**
  - Evidence: [examples/stackoverflow/src/interactive-app.test.ts](/Users/mini/kovo/examples/stackoverflow/src/interactive-app.test.ts:219)
    now covers `postAnswer`, but `voteUp`, `postQuestion`, and duplicate-title failure still rely
    on hand-built headers.
  - Repro coverage: collect headers from `/` and `/questions/q1` before submitting every visible
    enhanced form.

- [ ] **Replace regex header collection helpers with DOM or browser-runtime collection.**
  - Evidence: [examples/stackoverflow/src/interactive-app.test.ts](/Users/mini/kovo/examples/stackoverflow/src/interactive-app.test.ts:35)
    uses a regex/attribute decoder helper rather than the same browser collector used by enhanced
    submissions.
  - Repro coverage: use `@kovojs/browser` `readLiveTargetSnapshot` with a DOM implementation, or add
    a Playwright-level path that observes actual request headers.

- [ ] **Keep generated artifact checks explicit.**
  - Evidence: [tests/example-generated-graphs.global-setup.ts](/Users/mini/kovo/tests/example-generated-graphs.global-setup.ts:9)
    regenerates example graphs before tests, so ordinary tests validate current generator behavior
    but not committed artifact freshness.
  - Repro coverage: run `emit-graph -- --check` / `emit-components -- --check` in the relevant
    gates and document any known blocker, such as the current Stack Overflow component KV311 gap.

## Suggested Triage Order

- [ ] **P0:** Fix descriptor bypass, mutation raw-input reruns, query endpoint identity, and compiler
  alias-based `kovo-deps`.
- [ ] **P1:** Fix repeated source/runtime instance target identity and parameterized descriptor
  matching.
- [ ] **P2:** Unify browser collection/apply precedence and inline/modular target lookup escaping.
- [ ] **P3:** Define/validate live-target header identity encoding and broaden example DOM-derived
  coverage.

## Audit Inputs

- Main-thread source inspection of server mutation selection, source JSX stamps, compiler stamp
  emission, browser collection/apply, query endpoint wire chunks, and route graph metadata.
- Five sub-agent read-only audits over server live-target selection, browser runtime, compiler
  lowering, real examples/conformance, and query/mutation invalidation.
- No remediation tests were run for this report; the report is a backlog and repro plan, not proof
  of fixes.
