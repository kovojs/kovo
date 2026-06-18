# Hot Module Reloading

Created 2026-06-17. Behavioral source of truth is `SPEC.md`; this ledger scopes
how Kovo should support hot module reloading without weakening the compiler,
request-shell, or loader contracts.

## Goal

Kovo dev should update edited app code with the smallest sound browser action
that still routes through server truth:

- component edits refresh the affected server-owned DOM from the app shell when
  the compiler can prove the boundary,
- handler-only edits use the same server-fragment refresh path when eligible,
- route/app-shell/topology edits fall back to Vite's full reload,
- compiler errors surface as Kovo teaching diagnostics on page, fragment, and
  mutation requests.

The design must preserve `SPEC.md` §4.4's delegated loader/import model,
`SPEC.md` §5.2's 1:1 file mapping and TSX-only authoring rules, `SPEC.md`
§9.5's request shell as the dev-serving owner, and `SPEC.md` §9.1.1's
render-plan version skew checks.

## Current Baseline

- [x] **Client handler modules are already immutable and versioned.**
  - Evidence: `packages/compiler/src/lower/handlers.ts` derives
    `/c/<source>.client.js?v=<hash>` handler URLs with source-derived export
    names; `packages/server/src/client-modules.ts` serves versioned modules with
    immutable cache headers; `packages/compiler/src/vite.test.ts` verifies old
    and new client module versions are both retained after repeat transforms.
- [x] **The current compiler Vite plugin only records compiled client modules.**
  - Evidence: `packages/compiler/src/vite.ts` compiles component modules in
    `transform()`, stores emitted `kind === 'client'` files in an in-memory map,
    and serves matching `/c/...?...` requests from middleware. It does not emit
    HMR messages, invalidate Vite's module graph, or classify edit impact.
- [x] **The app-shell dev plugin already reloads the server app per request.**
  - Evidence: `packages/server/src/vite-dev.ts` calls `server.ssrLoadModule()`
    inside middleware before dispatching shell-owned requests; the example/site
    Vite configs load `kovoAppShellViteDevPlugin` and point it at the app-shell
    module.
- [x] **Generated live-target renderers tolerate server-side module reloads.**
  - Evidence: `packages/server/src/live-target-registry.ts` replaces registered
    renderers by component id, with a comment naming dev/HMR module reloads as
    the reason.
- [x] **Dev diagnostics already have the right response shape.**
  - Evidence: `packages/server/src/vite-dev.ts` keeps a diagnostic ledger and
    renders teaching-error documents or fragment wire responses for dependent
    route and mutation requests, matching the diagnostic behavior required by
    `SPEC.md` §5.2 and the diagnostic table near §11.3.
- [x] **Build-token plumbing can become the HMR skew guard.**
  - Evidence: `SPEC.md` §5.1 and §9.1.1 require a render-plan version token;
    `packages/server/src/app-document.ts` stamps it into documents and
    `packages/server/src/app-mutation-request.ts` threads it into mutation wire
    responses from `app.clientModules.buildToken()`.

## Design Direction

- [x] **Use Vite HMR as the transport, not as the behavior model.**
  - Decision: Kovo should send explicit `custom` HMR events over Vite's websocket
    for Kovo component/app-shell changes, while Vite still owns static asset
    updates and final full reload delivery.
- [x] **Keep the loader delegated and resumable.**
  - Decision: do not add hydration, component re-rendering, a client router, or a
    client component graph. The dev HMR client should be a small dev-only module
    that talks to the existing runtime paths: dynamic `import()`, query refetch,
    and fragment/morph application.
- [x] **Treat HMR as a dev refresh protocol over server truth.**
  - Decision: render-impacting edits should request fresh route/fragment/query
    output from the dev app shell and morph it in. The browser does not locally
    re-run component render functions.
- [x] **Classify edit impact from typed compile facts.**
  - Decision: the compiler should report an `HmrImpact` fact from the parsed and
    lowered model, not infer impact with source-string heuristics after parsing.
    This follows `SPEC.md` §5.2 rule 9.
- [x] **Make server-fragment refresh the main hot path.**
  - Decision: after the initial diagnostics/full-reload milestone, eligible
    component edits should refresh through generated live-target renderers and
    existing morph/query application. Handler-only edits should not get a
    separate early protocol.
- [x] **Prefer correctness over preserving transient local state.**
  - Decision: if an edit changes the render-plan token, query shape, route table,
    component identity, live-target identity, emitted bootstrap, or app shell
    wiring, the first implementation may full reload. Finer refresh can be added
    only where the server-owned boundary is mechanically proven.

## Open Contract Questions

- [x] **Define the public dev API surface.**
  - Choose whether app authors use one combined plugin or continue composing the
    compiler plugin plus `kovoAppShellViteDevPlugin`. The likely target is a
    public convenience wrapper that wires diagnostics, component compilation,
    app-shell dev serving, and HMR events without exposing internal subpaths.
  - Evidence: `SPEC.md` §9.5.1 defines the app-facing dev API as a convenience
    wrapper around the compiler plugin plus app-shell dev plugin; app authors do
    not hand-wire generated refresh registries, HMR endpoints, or client module
    maps into `createApp()`.
- [x] **Specify the dev-only browser entry.**
  - Decide whether the app-shell document injects a `/@kovo/hmr-client` module in
    dev or whether the Vite plugin injects it through HTML transform. It must be
    absent from build/static export artifacts.
  - Evidence: `SPEC.md` §9.5.1 states the dev-only browser entry is served or
    injected only by the Vite dev stack and must be absent from production build
    and static export artifacts.
- [x] **Define the stable HMR event vocabulary.**
  - Proposed events:
    `kovo:component-render`, `kovo:route-shell`, `kovo:diagnostics`, and
    `kovo:full-reload`. Each event should carry the source file, old/new client
    hrefs when known, impacted component registry keys/live targets, diagnostics
    summary, and the new render-plan token.
  - Evidence: `SPEC.md` §9.5.1 defines `kovo:component-render`,
    `kovo:route-shell`, `kovo:diagnostics`, and `kovo:full-reload` plus their
    source, module href, impacted target, diagnostic, and render-plan-token
    payload expectations.
- [x] **Define fragment refresh endpoints for HMR.**
  - The current live-target renderer path is mutation-driven. HMR needs a
    dev-only request shape that can ask the app shell to re-render either the
    current route document or a set of live targets from their stamped props,
    using the same server renderers as enhanced mutation refresh.
  - Evidence: `SPEC.md` §9.5.1 requires dev-only refresh endpoints to reuse
    existing app-shell route rendering, query reads, live-target renderers, and
    fragment-wire code; production `createRequestHandler()` must not expose HMR
    endpoints.
- [x] **Define non-refreshable handler edit behavior.**
  - If a handler-only edit is outside any proven refreshable target, the default
    should be full reload. A future attribute-ref patch may be allowed only as an
    optimization when the compiler proves DOM shape, params, query plans, target
    identity, and render output are unchanged.
  - Evidence: `SPEC.md` §9.5.1 requires `kovo:full-reload` for missing facts,
    query-plan/render-plan changes, app-shell/topology changes, or any unsafe
    change; handler-only edits without a proven compatible live target therefore
    fall into the full-reload class.
- [x] **Define pending work behavior.**
  - Decide how HMR interacts with pending optimistic mutations, focused inputs,
    forms with unsaved values, and in-flight enhanced requests. Conservative
    first milestone: full reload when pending optimistic work exists; otherwise
    use morph survival guarantees.
  - Evidence: `SPEC.md` §9.5.1 includes pending optimistic work in the
    `kovo:full-reload` fallback class unless a future implementation can prove a
    narrower server-owned refresh is safe.

## Implementation Plan

- [x] **1. SPEC contract update.**
  - Add a dev/HMR subsection under `SPEC.md` §5 or §9.5 that defines HMR as
    dev-only, server-truth refresh over Vite transport.
  - State the impact classes and fallback ladder: server fragment/query refresh,
    route document refresh, full reload.
  - State that HMR does not relax `SPEC.md` §5.2 fixpoint, TSX-only authoring,
    public-import, diagnostic, or post-parse typed-fact rules.
  - State that generated artifacts and static export output never contain HMR
    code.
  - Evidence: `SPEC.md` §9.5.1 defines dev-only HMR over Vite transport,
    server-truth refresh, the fallback ladder, typed-fact impact classification,
    diagnostic behavior, app-author API boundaries, and production/static-export
    absence requirements; `git diff --check` passes.
- [ ] **2. Compiler HMR impact facts.**
  - Extend `compileComponentModule()` to return impact metadata:
    component registry key, DOM leaf, emitted client href, emitted query update
    plan hash, live target facts, stylesheet asset facts, and diagnostics.
  - Add a small diff/classifier utility that compares prior and next metadata for
    one source file and returns `componentRefresh`, `routeRefresh`,
    `diagnosticError`, or `fullReload`, with optional sub-reasons such as
    handler-only, query-plan, style, or route-shell change.
  - Cover with focused tests in `packages/compiler/src/vite.test.ts` or a new
    `hmr-impact.test.ts`, including the no-source-string rule from `SPEC.md`
    §5.2 rule 9.
- [ ] **3. Vite plugin HMR transport.**
  - Extend `packages/compiler/src/vite.ts` with `handleHotUpdate` support and a
    typed dev-server websocket surface.
  - On successful component transform, record old/new module hrefs and send the
    classified Kovo event instead of relying on Vite's default JS module HMR for
    compiled `/c/` artifacts.
  - On error diagnostics, record the dev diagnostic ledger and send
    `kovo:diagnostics` so the current page can fetch/render the teaching
    diagnostic without waiting for the next navigation.
- [ ] **4. Shared app-shell dev integration.**
  - Add a public app-shell dev wrapper that wires compiler diagnostics into
    `createKovoAppShellDevDiagnosticLedger()` and keeps route/mutation diagnostic
    responses consistent with `packages/server/src/vite-dev.ts`.
  - Ensure `kovoAppShellViteDevPlugin()` can expose the current app, current
    build token, and dev-only refresh handlers without app-authored generated
    imports.
  - Update examples/site Vite configs to use the wrapper once the internal
    behavior is proven.
- [ ] **5. Dev-only HMR client runtime.**
  - Emit or serve a small dev module that subscribes to Kovo HMR events.
  - For `kovo:component-render`, call a dev refresh endpoint and feed returned
    query/fragment wire through existing runtime apply/morph code.
  - For `kovo:diagnostics`, render the server-produced teaching document or
    fragment through the same path used by failed dev requests.
  - For unsafe classes, delegate to Vite full reload.
- [ ] **6. Dev refresh endpoints.**
  - Add dev-only shell endpoints for current-route refresh and live-target
    refresh. They should be available only in Vite dev middleware, not production
    `createRequestHandler()`.
  - Reuse existing route rendering, query endpoint, live-target renderer, and
    fragment wire code instead of adding a client render path.
  - Include old/new build tokens so the HMR client can reject stale patches and
    full reload.
- [ ] **7. Verification matrix.**
  - Unit test impact classification in the compiler package.
  - Unit test Vite websocket event emission with fake dev-server objects.
  - Unit test app-shell dev endpoints and diagnostic integration in
    `packages/server/src/vite-dev*.test.ts`.
  - Browser test a small fixture: edit handler body, edit rendered text, edit
    query-bound field, introduce/fix a compiler error, edit route table, and
    verify focus/input survival or documented reload fallback.
  - Add a static export/build assertion that HMR modules and endpoints are absent
    outside dev.

## First Milestone Slice

- [ ] **Ship conservative full-reload HMR with precise diagnostics.**
  - Wire the public dev wrapper and diagnostic ledger.
  - Classify compiler errors and unsafe edits explicitly.
  - Send Kovo diagnostics immediately on error and Vite full reload for all
    successful component/app-shell edits.
  - Prove no production/static-export output changes.
- [ ] **Then add server-fragment refresh for live targets.**
  - Use generated live-target renderers and existing morph/query application for
    edits that keep component identity, live-target identity, props, and query
    plans compatible.
  - Route handler-only edits through this same refresh path when the edited
    component has a proven live target; otherwise full reload.
- [ ] **Optionally add a handler-ref attribute patch later.**
  - Consider only if fragment refresh is too broad in practice. The patch must
    be compiler-produced and limited to replacing stale `on:*` refs with new
    versioned refs where the rendered output is otherwise unchanged.

## Risks

- [ ] **Stale immutable module URLs.**
  - Because old `/c/...?...` URLs intentionally stay valid, HMR must refresh
    eligible DOM from the server or full reload. Silent mixed behavior where
    existing DOM keeps old handlers after a claimed hot update is not acceptable.
- [ ] **Route/app-shell module cache skew.**
  - `ssrLoadModule()` reloads modules through Vite, but generated registry side
    effects and `createApp()` defaults must be audited so old live-target
    renderers, query declarations, and client module registries do not coexist
    invisibly.
- [ ] **Over-refreshing loses the DX goal.**
  - The conservative fallback is full reload, but the plan should avoid becoming
    only full reload. The second milestone must prove a tangible win:
    server-fragment refresh for eligible component edits, including handler-only
    edits inside proven live targets.
- [ ] **Dev/prod divergence.**
  - Every HMR endpoint, event, and client module must be dev-only, and the
    existing build/export tests should assert absence in production artifacts.
