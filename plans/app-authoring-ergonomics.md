# App Authoring Ergonomics Follow-Up

Created 2026-06-17. Behavioral source of truth is `SPEC.md`; this follow-up
tracks framework work that improves the app-authoring model exposed by the
examples but is not the core automatic enhanced refresh implementation in
`plans/automatic-enhanced-refresh.md`.

## Goal

App authors should write authored components, routes, layouts, queries,
mutations, and guards directly, and the framework should provide everything that
today leaks as integration glue. Authors should not:

- import app-local generated modules from route/layout source,
- mutate `Request` to pass `db`/`session` (those are already framework channels),
- branch on `request.session` to decide whether to render a guarded region,
- write string shell wrapper helpers for document or page chrome,
- hand-duplicate the app query registry,
- or route ordinary mutation failures through one broad app-level switch.

Every item below is graded by **(a) the authored artifact the author writes,
(b) the teaching diagnostic when they get it wrong, and (c) a no-match check that
the old seam is gone** — not by the no-match check alone. In a compiler-first
framework whose thesis is statically-verifiable end-to-end authoring
(`SPEC.md` §1.1), the diagnostics *are* the DX.

## Author mental model (target)

A request flows through one obvious tool per stage. This plan exists to make each
stage a first-class surface instead of example glue:

| Stage | Tool | SPEC | Today's seam |
| --- | --- | --- | --- |
| Request provisioning | `createApp({ sessionProvider, db })` → typed `req.session` / `req.db` | §6.5, §9.5, §10.2/§10.3 | `Object.defineProperty(request, …)` |
| Authorization | `guard` on route/query/mutation/layout | §10.3 | ad hoc `request.session?.user?.id` branches |
| Data | `query()` declared once | §10.2 | split presentational loaders (closed in AER) |
| Page chrome | nested `layout()` + `<Shell>` components; document via `documentTemplate` | §4.5, §9.5 | `renderSoShell`/`renderCartPageBody` strings |
| Render | `component()` / `route().page` JSX | §4.1, §6.4 | app-local `./generated/*` imports |
| Write | `mutation()` | §10.3 | — |
| Expected failure | `<FieldError>` / `<FormError>` over typed `forms.<m>.failure` | §6.3, §9.2 | broad `mutationResponse` switch |
| Unexpected error | per-island error boundary (§13.5 adopt list) | §9.2, §13.5 | none |

Gaps this model exposes that the old 7-item plan did not name: there was no clear
stage for **unexpected errors** (kept separate from expected failures below), and
**session provisioning was treated as a new `context` primitive when `SPEC.md`
already specifies it** (see item 2).

## Dependency map (do not double-track)

This plan owns only the residue after these land; cite the exact checkbox each
item inherits from rather than re-deciding it:

- `plans/automatic-enhanced-refresh.md` — owns generated live-target rendering,
  removal of app-authored success-fragment routing, route JSX composition (#4,
  #7–9), and key-scoped `createApp({ mutationResponses })` policies (#9). Items 1,
  6, and the redirect half of the old failure switch are AER residue.
- `plans/better-dx.md` — `disableServerRefresh` as the only refresh escape hatch,
  derived `kovo-fragment-target`/`kovo-key`, typed `mutation={…}` binding, and
  typed `forms.<m>.failure` (all `[x]`). Item 5 builds *on top of* this, not
  beside it.
- `plans/better-forms.md` — KV242 (`name` ∈ schema), `MutationRegistry` inference,
  the single failure shape `{ code; payload; fieldErrors? }`, CSRF-on. Item 5
  consumes these decisions verbatim; do not re-open the failure shape.

## Scope boundaries

- [ ] **Do not add a static-export/read-only framework mode for these examples.**
  - StackOverflow, CRM, and Commerce are interactive; retire their example
    static-export paths (item 8). Static export remains a framework capability,
    but must keep a dedicated non-example fixture so it does not bitrot.
- [ ] **Do not block `plans/automatic-enhanced-refresh.md`.** Start after or
  alongside AER when a slice is clearly independent.
- [ ] **Nested layouts target authoring parity, not runtime persistence (v1).**
  - Decision 2026-06-17: each navigation still renders a full server document;
    `SPEC.md` §13.4 (no persistent cross-navigation elements) stays intact. The
    layout authoring surface must leave a seam so a later enhanced-navigation /
    leaf-morph layer can add persistence without changing how authors write
    layouts (mirrors the no-JS→enhanced mutation ladder). Runtime persistence is
    out of scope here and is tracked separately in
    `plans/enhanced-navigation.md`, which depends on this item's `layout()`
    composition and must keep `<Link>`→`<a href>`, full-document GET as canonical
    + fallback, and no-JS↔enhanced render-equivalence.

## Plan

- [x] **1. Hide app-local generated component imports from route/layout source.**
  - Target authoring:
    ```tsx
    route('/', { page: () => <QuestionListRegion /> });
    ```
  - Framework direction: the build wires authored component references to
    generated lowered IR for server execution (AER #7–9 already self-register
    live-target renderers). Generated files stay inspectable artifacts, not
    app-authored imports. This is specifically the residual **component-symbol
    import** (`import { QuestionListRegion } from './generated/question-list.js'`),
    distinct from the `liveTargetRenderers` wiring AER already removed.
  - Teaching diagnostic: extend the `SPEC.md` §5.2 rule-8 import-boundary
    diagnostic (today it covers `@kovojs/*/generated`) to **app-local** `./generated/*`
    imports in route/layout modules, pointing at the authored component instead.
  - Acceptance evidence:
    - `rg -n "from './generated/(question|contacts|deal|pipeline|cart-badge|order-history|product-grid)" examples/stackoverflow/src/interactive-app.tsx examples/crm/src/interactive-app.tsx examples/commerce/src/app-shell.tsx` exits 1 with no hits, proving authored route/layout modules import authored components instead of generated component artifacts.
    - `rg -n "from \"\\./(question-detail|question-list|contacts|deal-detail|pipeline|cart-badge|order-history|product-grid)\\.js\"" examples/stackoverflow/src/generated/interactive-app.kovo-route.tsx examples/crm/src/generated/interactive-app.kovo-route.tsx examples/commerce/src/generated/app-shell.kovo-route.tsx` shows generated route artifacts still import the generated component modules for execution.
    - `pnpm exec vitest --run packages/compiler/src/route-pages.test.ts` passes and includes a red/green compiler fixture proving KV235 fires on an app-local generated import and names the authored component as the fix.
    - `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`, `pnpm --filter @kovojs/example-crm run emit-components -- --check`, and `pnpm --filter @kovojs/example-commerce run emit-components -- --check` pass with route import rewrites installed.
    - Focused route/example tests pass: `pnpm --filter @kovojs/example-crm test -- interactive-app.test.ts`; `pnpm --filter @kovojs/example-stackoverflow test -- interactive-app.test.ts`; `pnpm --filter @kovojs/example-commerce test -- app-shell.test.ts app.rendering.test.ts`.

- [x] **2. Provision `db`/`session` through framework channels, not `Request` mutation.**
  - Reconciliation (corrects the original `createApp({ context })` proposal):
    `SPEC.md` already specifies request provisioning. **Do not introduce a parallel
    `context.session`.**
    - Session: `createApp({ sessionProvider })` (§9.5) resolves once before route/
      query/mutation guards; `req.session` is typed from the session schema (§6.5).
      The examples' `Object.defineProperty(request, 'session', …)` is simply *not
      using `sessionProvider`*.
    - Database: `query(db, req)` / mutation `req.db` are already Tx-typed in the
      request context (§10.2/§10.3). The genuine gap is **who populates `req.db` at
      the `createApp` level** — there is no declared app-side `db`/transaction
      provider today, which is why examples hand-inject it.
  - Target authoring:
    ```ts
    const app = createApp({
      sessionProvider: (req) => auth.session(req),   // §9.5 — session only
      db: (req) => database,                          // NEW: typed tx/db provider seam
      routes, mutations,
    });
    ```
  - Framework direction: add a typed `db` provider on `createApp()` that populates
    the Tx-typed `req.db` channel queries/mutations already read. Reconcile with
    AER's "server route execution installs request context for server JSX" so there
    is exactly **one** request-context path used by full-page render, live-target
    refresh fragments, and direct query endpoints (a live-target refresh re-runs
    queries outside the original request and must receive the same `db`/session).
  - Teaching diagnostic: a query/mutation that reads a `db`/session field the
    configured providers do not supply is a typed error at `createApp()`, not a
    runtime `undefined`.
  - Acceptance evidence:
    - StackOverflow and CRM no longer use `Object.defineProperty(request, 'db'` /
      `'session'`; Commerce no longer needs `withCommerceRequestContext()` /
      `attachCommerceRequestContext()`.
    - A `tsc` type-test proves `req.db` and `req.session` are inferred inside a
      query/mutation/guard with **zero annotations**, and that a provider-shape
      rename propagates red to consumers.
    - A live-target refresh test proves the generated fragment re-render receives
      the same `db`/session as the originating request.
  - Evidence:
    - `createApp({ db })` is implemented in the app shell lifecycle and dispatches
      through route pages, query endpoints, mutation handlers/live-target refresh,
      and session-free endpoints; `pnpm exec vitest --run packages/server/src/app.test.ts`
      covers these paths.
    - `createApp()` now accepts app-scoped declaration callbacks (`queries:
      ({ query }) => ...`, `mutations: ({ mutation }) => ...`, `routes:
      ({ route }) => ...`) whose helpers contextually type query loaders,
      mutation handlers, route pages, and guards from configured `db` and
      `sessionProvider`; `pnpm exec vitest --run packages/server/src/app-authoring-context.test.ts packages/server/src/app.test.ts` passes.
    - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` passes with
      `packages/server/src/app-authoring-context.test.ts` proving zero-annotation
      `request.db` / `request.session` inference and `@ts-expect-error` provider
      shape rename failures.
    - `rg -n "Object\.defineProperty\(request, '(db|session)'|attachCommerceRequestContext|withCommerceRequestContext" examples/stackoverflow/src examples/crm/src examples/commerce/src` exits 1 with no hits after regenerating example route artifacts.
    - Example checks pass: `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`; `pnpm --filter @kovojs/example-crm run emit-components -- --check`; `pnpm --filter @kovojs/example-commerce run emit-components -- --check`; `pnpm --filter @kovojs/example-crm test -- interactive-app.test.ts`; `pnpm --filter @kovojs/example-stackoverflow test -- interactive-app.test.ts`; `pnpm --filter @kovojs/example-commerce test -- app-shell.test.ts app.rendering.test.ts`.
    - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, `node scripts/api-surface-gate.mjs`, and `git diff --check` pass.

- [x] **3. First-class nested layouts (supersedes the old "no layouts yet" item).**
  - Decision 2026-06-17: ship nested layouts for authoring parity with peer
    frameworks, on Kovo's explicit `route()` model (no file-system-convention
    routing — that would contradict §6.4's static route table). Layouts are the
    first-class form of `SPEC.md` §4.5 component-composition chrome.
  - Target authoring:
    ```tsx
    const AppLayout = layout({
      queries: { viewer: viewerQuery, cart: cartQuery },   // loaded once/request
      render: ({ viewer, cart }, _state, { children }) =>
        <Shell><Nav viewer={viewer} cartCount={cart.count} />{children}</Shell>,
    });

    const AdminLayout = layout({
      parent: AppLayout,                       // explicit nesting chain
      guard: role('admin'),                    // segment guard, composes with route guard
      boundaries: { unauthorized: (req) => <AdminDenied /> },
      render: ({}, _s, { children }) => <AdminFrame>{children}</AdminFrame>,
    });

    route('/admin/users/:id', {
      layout: AdminLayout,
      page: ({ params }) => <UserDetail userId={params.id} />,
    });
    ```
  - Framework direction:
    - Compiler composes `AppLayout > AdminLayout > page` into each route's server
      IR (extends the AER route-JSX lowering one nesting level; `children` lowers
      to the §4.5 opaque `Html` slot).
    - **Layout-level queries are live-targets** (§4.1/§9.1): a layout's cart badge
      refreshes on `addToCart` exactly like an in-page region — no app wiring.
    - **Per-segment boundaries** (`notFound`/`unauthorized`/`error`) override the
      app-level §9.5 `errorShells` for that segment; **segment `guard`** composes
      with route/query guards.
    - **Document vs chrome split:** document assembly stays
      `createApp({ documentTemplate })` (§9.5); layouts are page chrome (§4.5).
      This resolves the original item 4 conflation where `renderCartPageBody` built
      the whole `<html>`.
    - **Persistence seam:** runtime is full-document-per-navigation (§13.4
      unchanged); the authoring surface must not assume persistence, so a later
      leaf-morph navigation layer can be added transparently.
  - Teaching diagnostic: unresolvable/cyclic layout `parent` chains, a layout query
    that cannot reconstruct on refresh (reuse KV303), or ambiguous segment-boundary
    resolution produce teaching errors, not runtime fallbacks.
  - Acceptance evidence:
    - Route document tests prove nested layout output, layout-query live-target
      refresh, per-segment boundary selection, and segment-guard composition.
    - A `kovo explain page <path>` (or `--layouts`) surface shows the composed
      layout chain and which queries belong to which segment.
  - Current evidence:
    - Server authoring now exposes `layout({ parent, guard, queries, render })`
      and `route(..., { layout })`; `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx packages/server/src/route.test.ts packages/server/src/app.test.ts`
      passes with nested parent output, layout query loading from the route
      request, and layout guard composition.
    - `createApp()` app-scoped authoring now exposes a provider-typed `layout`
      factory alongside `query`, `mutation`, and `route`; `pnpm exec vitest
      --run packages/server/src/app-authoring-context.test.ts` and `pnpm exec
      tsc -p tsconfig.json --noEmit --pretty false` prove layout guards/renders
      see inferred `db`/`session` request providers.
    - Route compilation derives parent-first layout-chain facts from local
      `layout({ parent, queries })` declarations; `pnpm exec vitest --run
      packages/compiler/src/route-pages.test.ts` passes with a fixture asserting
      layout names and query keys in the emitted route IR fact.
    - `pnpm exec vitest --run packages/compiler/src/route-pages.test.ts` also
      passes negative fixtures proving unresolved and cyclic local layout chains
      produce KV303 teaching diagnostics instead of silently dropping layout
      facts.
    - `kovo explain page --layouts` now surfaces compiler-derived route layout
      chains and each layout segment's query keys through graph page facts;
      `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts
      packages/compiler/src/registry.test.ts packages/core/src/graph.test.ts`
      passes with fixtures for graph-threaded layout facts, in-process page
      explain output, and CLI `page --layouts` parsing.
    - Layout/route segment boundaries now support `boundaries.notFound`,
      `boundaries.unauthorized`, and `boundaries.error`; `pnpm exec vitest
      --run packages/server/src/route-jsx.test.tsx packages/server/src/app-document.test.ts
      packages/server/src/route.test.ts packages/server/src/route-query-guards.test.ts
      packages/server/src/app.test.ts` passes with fixtures proving nearest
      segment boundary selection and override of app-level 404/403 shells.
    - Query-backed layouts now stamp generated `kovo-deps`/target metadata so
      enhanced mutations rerun affected layout query chunks without app-authored
      fragment renderers; `pnpm exec vitest --run packages/server/src/route-jsx.test.tsx
      packages/server/src/app.test.ts packages/server/src/mutation-response.test.ts
      packages/runtime/src/mutation-targets.test.ts` passes with an app-shell
      fixture where `Kovo-Targets: <generated-layout-target>=cart` returns the
      refreshed `cart` query chunk.
    - Route lowering now derives navigation segment facts for each layout and
      page leaf and threads them into `kovo explain page --layouts`; `pnpm exec
      vitest --run packages/compiler/src/route-pages.test.ts packages/compiler/src/registry.test.ts
      packages/cli/src/index.kovo-explain.test.ts packages/core/src/graph.test.ts`
      passes with fixtures for emitted route IR facts, graph page facts, and
      explain output.
    - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`,
      `node scripts/api-surface-gate.mjs`, and `git diff --check` pass.

- [ ] **4. Replace string shell helpers with layouts + `documentTemplate`.**
  - Framework direction: convert document-level shells to
    `createApp({ documentTemplate })` (§9.5) and page chrome to layout/`<Shell>`
    components (item 3). Ensure the JSX runtime handles children + generated
    component composition so no string wrapper helper is needed.
  - Acceptance evidence:
    - `rg -n "renderSoShell|renderCrmShell|renderCommerceCartShell|renderCartPageBody" examples/{stackoverflow,crm,commerce}/src` has no hits.
    - Route document tests prove layout output, component stamps, stylesheets, and
      metadata still compose correctly.

- [ ] **5. Field-bound mutation failure UI (replaces the broad failure switch).**
  - Decision 2026-06-17 (resolves the original `formFailure`/`<Failure>` proposal,
    which conflicted with §9.2 and `better-forms.md`):
    - **Adopt the single failure shape `{ code; payload; fieldErrors? }`** from
      `better-forms.md`; **drop `formFailure({ message })`** (free-text, uncoded
      failures contradict §9.2's exhaustive coded union).
    - **Primary surface: field-bound components** `<FieldError name="…" />` and
      `<FormError />`, compiler-bound to the enclosing `<form mutation={m}>`:
      - `name` is checked ∈ the mutation input schema (this *is* KV242 from
        `better-forms.md` — do not invent a second check).
      - a11y auto-wired: `role="alert"` + `aria-describedby` from the input to its
        `<FieldError>`.
      - Validation failures map to the matching `<FieldError>` (`fieldErrors[name]`);
        declared coded errors (e.g. `OUT_OF_STOCK`) render in `<FormError />` by
        default, with optional explicit field targeting.
    - **Raw `forms.<m>.failure` (§6.3) stays the escape hatch** for custom UI.
    - **Expected vs unexpected stay separate:** `<FieldError>/<FormError>` handle
      422 typed failures; *unexpected* render/runtime errors go to a per-island
      **error boundary** (unify with the §13.5 adopt-don't-invent list), not a
      failure outlet. No `<Failure>` ancestor-bubbling for expected failures.
    - **Redirects/auth response policy are not this item:** they are AER #9's
      key-scoped `createApp({ mutationResponses })`. The commerce "broad switch"
      mixes redirect + failure-page rendering; this item owns only field/form error
      display, AER owns the redirect/response policy.
  - Target authoring:
    ```tsx
    <form enhance mutation={signIn}>
      <input name="email" /><FieldError name="email" />
      <input name="password" type="password" /><FieldError name="password" />
      <FormError />
      <button>Sign in</button>
    </form>
    ```
  - Teaching diagnostic: `<FieldError name="prce">` (name ∉ schema) → KV242 with the
    schema field set; `<FieldError>/<FormError>` outside an `enhance` form → teaching
    error.
  - Acceptance evidence:
    - Commerce app-shell no longer has a mutation-key switch for sign-in/sign-out/
      add-to-cart **failure display** (redirect policy moves to `mutationResponses`).
    - Sign-in and add-to-cart render failures through `<FieldError>/<FormError>`;
      a CRM or SO form gains a declared `errors:` schema and renders it (proving the
      §9.2 typed path beyond commerce — closes the `better-forms.md` C4 gap).
    - Existing auth redirect, CSRF, no-JS, and enhanced failure tests still pass.

- [ ] **6. Derive the app query registry from routes/components/layouts.**
  - Framework direction: the build emits the query registry from queries reachable
    through route/layout/component declarations (Constitution #2: "no global
    knowledge at local sites"). Mutation rerun selection and query endpoints consume
    the generated registry.
  - Scope correction: kill **all** duplication surfaces found in the audit, not just
    the `createApp` array —
    - `createApp({ queries: [...] })` (app shells),
    - mutation `registry: { queries: [...] }`,
    - per-component generated `queries: [...]`,
    - and the `graph.ts` domain→query maps (`commerce/graph.ts`, `crm/graph.ts`).
  - Teaching diagnostic: a query rendered by a component/layout but unreachable in
    the derived registry (e.g. behind a dead branch) is reported by `kovo explain`,
    so "renders but won't refresh" is never silent.
  - Acceptance evidence:
    - App shells, mutation registries, and `graph.ts` no longer carry manual query
      arrays for route/component/layout queries.
    - Enhanced mutation tests prove generated-registry queries are available for
      affected-target selection; query-endpoint tests prove public query routes
      still resolve.

- [ ] **7. Retire static export from interactive examples (+ keep a fixture).**
  - Remove static export scripts/tests/docs refs and static-only page helpers from
    StackOverflow, CRM, Commerce; delete the commerce static-export shell rather
    than preserve `renderCartPageBody(…, { readOnly: true })`.
  - Add/keep a **dedicated minimal static-export fixture** (non-example) so the
    framework capability retains regression coverage after the examples drop it.
  - Acceptance evidence:
    - Example package scripts no longer expose static/export commands for these
      interactive examples; tests no longer assert their static-export output.
    - A standalone static-export fixture test stays green and is referenced from
      the static-export docs.

## Cross-cutting DX (new — not in the original plan)

- [ ] **8. Teach the model in the starter template, not just examples.**
  - `packages/create-kovo` templates are the first surface real users hit. They
    must demonstrate `sessionProvider`/`db` providers (item 2), a nested layout
    (item 3), and `<FieldError>/<FormError>` (item 5) — not the retired seams.
  - Acceptance evidence: a generated starter type-checks and its smoke test renders
    a layout + a form with field errors; no template uses `Object.defineProperty`
    on `Request` or string shell helpers.

- [ ] **9. Extend `kovo explain` to the new seams.**
  - Cover request provisioning (which `db`/session fields a query sees), layout
    composition chains, query-registry membership, and `<FieldError>` ⇄ schema
    binding, so the "why did this happen?" loop matches the existing
    `kovo explain` surfaces (§ verification table).
  - Acceptance evidence: `kovo explain` output snapshots for a layout-nested route
    and a form's resolved field-error bindings.

- [ ] **10. Naming + inference consistency pass.**
  - One vocabulary pass across `<FieldError>`/`<FormError>`, error boundaries,
    `documentTemplate`, `layout`, and `sessionProvider`/`db` so "failure" vs "error"
    and "shell" vs "layout" vs "document" are used consistently in API, SPEC, and
    docs.
  - End-to-end inference is asserted with `tsc` type-tests for each new surface
    (item 2 providers, item 3 layout queries, item 5 field names), not just runtime
    behavior.

## Verification Targets

- [x] **No app-local generated imports in route/layout modules** (+ diagnostic fixture).
  - Evidence: item 1 compiler fixture and no-match route/layout import check above; generated imports that remain in tests/loaders, touch graph, optimistic helpers, and legacy non-route modules are owned by later items.
- [x] **No app-authored `Request` mutation for `db`/`session`; providers inferred end to end.**
  - Evidence: item 2 no-match, app-scoped declaration type-test, server lifecycle test, example tests, root `tsc`, API gate, and `git diff --check` above.
- [ ] **Nested layouts compose, refresh layout queries, and scope boundaries/guards per segment.** Evidence pending.
- [ ] **No string shell helpers; document via `documentTemplate`, chrome via layouts.** Evidence pending.
- [ ] **Expected failures render via `<FieldError>/<FormError>` (KV242-checked); unexpected via error boundaries; no `formFailure({ message })`.** Evidence pending.
- [ ] **No manual query-registry duplication across shells, mutation registries, generated files, or `graph.ts`.** Evidence pending.
- [ ] **No static-export surface in interactive examples; capability covered by a standalone fixture.** Evidence pending.
- [ ] **Starter template teaches the model; `kovo explain` covers the new seams; inference type-tests pass.** Evidence pending.
