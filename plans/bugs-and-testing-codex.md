# Bugs and Testing Audit - Codex

**Date:** 2026-06-23
**Scope:** Critical/high severity bugs and critical testing gaps found by a parallel audit of
compiler, server/runtime, UI components, public examples, and CI/test coverage.
**Method:** Five read-only sub-agents audited independent slices while the main thread reproduced
public-site issues with Playwright against `https://kovo.sh/examples/`,
`https://kovo.sh/components/`, and the deployed Cloud Run example services. No production code was
changed in this worktree.
**Current-state refresh:** Rechecked against `main`/`origin/main` at `e9255f58` (`Merge gallery
follow-up fixes (accordion/alert-dialog/autocomplete)`) after `main` moved. That merge closed
separate accordion, alert-dialog centering/light-dismiss, and autocomplete Enter issues tracked in
`plans/bad-components-followup.md`; it does not close the open items below. The closest overlap is
Alert Dialog: current main now has a browser assertion that focus lands inside the open alertdialog,
so this audit's remaining overlay item is scoped to Dialog/Drawer/Sheet.

## Summary

- **Critical bugs:** endpoint CSRF is declared default-on but not enforced; BroadcastChannel
  principal fingerprints can collapse distinct non-cookie sessions.
- **High bugs:** request-shell load shedding is missing; unauthenticated enhanced mutation failures
  use the wrong 422 fragment path; compiler diagnostics miss cross-module/non-public cases; shipped
  UI primitives have keyboard/ARIA regressions; public examples have broken primary workflows.
- **Critical testing gaps:** CI omits several root acceptance gates, example TSX typechecking can
  cache-hit stale, and the gallery browser suite is not part of root CI/acceptance.

## Critical Bugs

- [ ] **Enforce default-on CSRF for `endpoint()` handlers before dispatch.**
  - **Severity:** Critical security bug.
  - **Evidence:** `endpoint()` documents CSRF as default-on unless `csrf:false` is supplied
    (`packages/server/src/endpoint.ts:70`), but the declaration only stores an exemption
    (`packages/server/src/endpoint.ts:100`) and `runEndpoint()` directly calls the handler
    (`packages/server/src/endpoint.ts:121`). App dispatch routes endpoint matches straight to
    `runEndpoint()` after lifecycle resolution (`packages/server/src/app-dispatch.ts:78`), with no
    token validation.
  - **Repro:** Define `endpoint('/account/email', { method: 'POST', handler })` without
    `csrf:false`; submit a cross-site POST with no `kovo-csrf`. Current code reaches `handler`.
  - **Testing gap:** Add server tests that default-CSRF POST/PUT/PATCH/DELETE endpoints reject
    missing/invalid tokens before handler execution, and that only `csrf:false` plus justification
    reaches raw machine-ingress handlers.
  - **Verification run:** `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts --reporter=dot` passed, confirming current endpoint tests do not cover default-CSRF enforcement.

- [ ] **Derive BroadcastChannel session fingerprints from the resolved lifecycle request.**
  - **Severity:** Critical cross-principal data-leak risk.
  - **Evidence:** Route rendering resolves lifecycle/session in `renderRoutePageResponse()`
    (`packages/server/src/route.ts:836`), but document stamping later calls
    `sessionFingerprintFromRequest(request)` on the original request
    (`packages/server/src/app-document.ts:95`). The fingerprint function falls back to hashing the
    first cookie value when no `request.session` is present (`packages/server/src/app-document.ts:148`).
  - **Repro:** Use `sessionProvider(req) => ({ id: req.headers.get('x-session-id') })`, or put the
    session in a second cookie while the first cookie is a shared `theme=light`. Page rendering uses
    the resolved session, but the stamped `kovo-session` can be identical across principals.
  - **Testing gap:** Add document tests for non-cookie sessions and second-cookie sessions with an
    identical first cookie; assert distinct `<meta name="kovo-session">` values. Add a browser
    integration proving cross-principal broadcast discard uses those stamped values.

## High Bugs

- [ ] **Add pre-dispatch request-shell limits for anonymous floods and large bodies.**
  - **Severity:** High availability/security bug.
  - **Evidence:** `CreateAppOptions` exposes no request-limit configuration, `handleAppRequest()`
    dispatches immediately, and the Node adapter constructs Web `Request`s before any body-size
    gate. Existing `guards.rateLimit` runs inside guard/mutation logic and supports only
    `global | session`, not the SPEC-required pre-dispatch per-IP/global limiter.
  - **Repro:** Send large or repeated anonymous POSTs to `/_m/...` or a raw endpoint. Current code
    reaches body parsing, replay/schema work, or endpoint handler code instead of 413/429 at the
    shell.
  - **Testing gap:** Add request-shell tests for max body size 413 before `formData()`/`json()`,
    per-IP/global 429 before mutation replay/schema/guard, and coverage for endpoint/query paths.

- [ ] **Return 401 + `Kovo-Reauth` for unauthenticated enhanced mutation guard failures.**
  - **Severity:** High auth/session UX correctness bug.
  - **Evidence:** Enhanced mutation guard failure renders a typed failure fragment using
    `guardFailure.status` (`packages/server/src/mutation.ts:749`). Browser mutation application has
    no `Kovo-Reauth` branch (`packages/browser/src/mutation-apply.ts:119`). The integration test
    currently locks in anonymous guarded mutation as 422 with `UNAUTHORIZED`
    (`tests/integration/specs/guarded-mutation.spec.ts:14`).
  - **Repro:** Submit an enhanced guarded mutation after session expiry. Current behavior is a 422
    fragment with `data-error-code="UNAUTHORIZED"` rather than 401 + `Kovo-Reauth` navigation.
  - **Testing gap:** Update guarded mutation coverage to assert 401 `Kovo-Reauth` for unauthenticated
    enhanced submits, 303 for no-JS unauthenticated submits, and typed 403 only for
    authenticated-but-unauthorized submits.

- [ ] **Extend KV420 nested-stateful-island diagnostics across module boundaries.**
  - **Severity:** High compiler correctness bug.
  - **Evidence:** SPEC requires KV420 when a stateful island is rendered inside another component's
    server-refreshable fragment target. The validator explicitly only resolves same-module siblings
    because registry facts lack per-component local-state metadata
    (`packages/compiler/src/validate/component-contracts.ts:227`).
  - **Repro:** Put a stateful `Stepper` component in `stepper.tsx`, import it into `cart-panel.tsx`,
    and render `<Stepper />` inside a query-backed `CartPanel` refresh target. Expected KV420;
    current implementation cannot classify the imported child.
  - **Testing gap:** Add a cross-module KV420 compiler test and extend registry facts with a
    stateful-component fact instead of relying only on same-file component models.

- [ ] **Close KV235 import-boundary holes for bare/internal and app-local generated specifiers.**
  - **Severity:** High compiler/public-surface bug.
  - **Evidence:** SPEC §5.2 bans `kovo/internal` and app-authored generated imports, but
    `isNonPublicKovoSpecifier()` only matches `@kovojs/*/(internal|generated)`
    (`packages/compiler/src/validate/authoring-surface.ts:54`), and
    `isAppLocalGeneratedSpecifier()` only matches relative `./generated` or `../generated`
    (`packages/compiler/src/validate/authoring-surface.ts:58`).
  - **Repro:** `isNonPublicKovoSpecifier('kovo/internal')`,
    `isAppLocalGeneratedSpecifier('src/generated/cart.server.js')`, and
    `isAppLocalGeneratedSpecifier('/src/generated/cart.server.js')` currently return false.
  - **Testing gap:** Extend import-boundary compiler tests to cover bare `kovo/internal` and
    non-relative app-local generated import spellings.

- [ ] **Move clock/renderOnce decisions out of raw source-string matching and widen the guard.**
  - **Severity:** High compiler conformance/testing gap.
  - **Evidence:** The rule-9 source-string guard scans `packages/compiler/src/graph.ts` plus
    lower/validate/analyze/emit directories (`packages/conformance-fixtures/src/source-fixtures.ts:585`),
    but not `app-graph.ts` or `compile.ts`, where clock explain/update-plan decisions live.
  - **Repro:** A component with quoted/computed/commented `clocks` keys and `renderOnce` positions can
    become spelling-sensitive because post-parse decisions are not fully typed-fact driven.
  - **Testing gap:** Widen `postParseSourceStringProjectFact` to `app-graph.ts` and `compile.ts`, then
    add clock tests for quoted/computed/commented object keys and `renderOnce` classification.

- [ ] **Restore modal ARIA attributes and focus behavior for Dialog/Drawer/Sheet overlays.**
  - **Severity:** High accessibility bug.
  - **Evidence:** `dialogContentAttributes()` returns `role: 'dialog'` and `aria-modal: 'true'`
    (`packages/headless-ui/src/primitives/dialog.ts:83`), but `DialogContent` renders only
    `aria-describedby`, `aria-labelledby`, `closedby`, `data-state`, `id`, and `open`
    (`packages/ui/src/dialog.tsx:274`). `Drawer` and `Sheet` call the same primitive but also omit
    `role`/`aria-modal` when rendering `<dialog>` (`packages/ui/src/drawer.tsx:320`,
    `packages/ui/src/sheet.tsx:322`). Public Playwright reproduction on
    `https://kovo.sh/components/dialog/`: clicking "Review cart" opens a native `<dialog>`, but it
    has no explicit `role`, no `aria-modal`, and `document.activeElement` remains `BODY`. The
    all-components pass confirmed the same missing modal attributes/focus pattern on
    `https://kovo.sh/components/drawer/` and `https://kovo.sh/components/sheet/`. By comparison,
    Alert Dialog renders `role="alertdialog"` and `aria-modal="true"`, and current main asserts
    `dialog.contains(document.activeElement)` for Alert Dialog in
    `examples/gallery/src/interactive-gallery.interactions-a.browser.test.ts:131`.
  - **Expected parity:** shadcn/Radix dialog surfaces modal semantics and focus is moved into the
    dialog/focus trap.
  - **Testing gap:** Add gallery browser tests that open Dialog, Drawer, and Sheet, then assert modal
    role/`aria-modal`, initial focus inside the dialog, Escape/close return focus to the trigger, and
    no background tab stop is reachable.

- [ ] **Fix Select keyboard/value parity on the component gallery.**
  - **Severity:** High component interaction bug.
  - **Evidence:** Public reproduction on `https://kovo.sh/components/select/`: focusing the trigger
    and pressing `ArrowDown`, `ArrowDown`, `Enter` opens/highlights Express briefly but returns to
    Standard. Pointer selection updates trigger/hidden value to `express`, while
    `[data-demo-state="select-value"]` remains `Standard`. The demo wires `SelectValue` separately at
    `examples/gallery/src/interactive/select-demo.tsx:226`; keyboard result handling is in
    `examples/gallery/src/interactive/select-demo.tsx:79`; active descendant support exists in the
    primitive at `packages/headless-ui/src/primitives/select.ts:530`.
  - **Expected parity:** shadcn/Radix Select value and trigger stay synchronized; keyboard navigation
    moves highlight and commits the highlighted option.
  - **Testing gap:** Add real keyboard/browser tests asserting `aria-activedescendant`, final selected
    value, hidden input, trigger text, and `SelectValue` update together.

- [ ] **Move real DOM focus for Tabs roving keyboard navigation.**
  - **Severity:** High keyboard accessibility bug.
  - **Evidence:** Public reproduction on `https://kovo.sh/components/tabs/`: focus Overview, press
    `ArrowRight`; Details receives `tabIndex=0`, but `document.activeElement` remains Overview. Enter
    then activates Overview again. The demo only mutates `state.activeValue` in
    `examples/gallery/src/interactive/tabs-demo.tsx:36`; primitive movement returns the next value at
    `packages/headless-ui/src/primitives/tabs.ts:274`, with no imperative focus handoff.
  - **Expected parity:** Radix/shadcn-style Tabs move focus to the next trigger on arrow keys; manual
    activation then activates the newly focused tab.
  - **Testing gap:** Add a browser test that uses real keyboard input, asserts focus moves to Details,
    then Enter activates the Details panel.

- [ ] **Repair the public Commerce example primary add-to-cart workflow.**
  - **Severity:** High public-example/product bug.
  - **Evidence:** Public Playwright reproduction against
    `https://kovo-commerce-sfqtuclaza-uc.a.run.app/`: the page renders `Qty` with a visible default
    Add to cart form, but clicking the first "Add to cart" returns `422 /_m/cart/add` and replaces
    the form with `{}` while the cart remains `0`. Source renders `value="1"` in the number field
    (`examples/commerce/src/components/product-grid.tsx:193`) and protects the mutation with CSRF
    (`examples/commerce/src/domain.ts:211`). The realistic e2e test explicitly records that anonymous
    demo add-to-cart returns CSRF 422 and does not assert a successful user workflow
    (`tests/commerce-realistic.e2e.test.ts:9`).
  - **Testing gap:** Add a public-demo/browser smoke that signs in or mints the expected anonymous
    CSRF/session state, clicks the rendered Add to cart button, and asserts cart badge/order/product
    grid convergence instead of accepting CSRF 422 as the end state.

- [ ] **Fix the Commerce example's broken `More` pagination link or remove it from public output.**
  - **Severity:** High public-example navigation bug.
  - **Evidence:** `ProductGrid` emits `<a href="/products?after=${cursor}">More</a>`
    (`examples/commerce/src/components/product-grid.tsx:134`), but the app declares only `/`, `/cart`,
    and `/login` routes (`examples/commerce/src/app.tsx:99`, `:112`, `:125`). The realistic e2e note
    records the target as not a standalone route (`tests/commerce-realistic.e2e.test.ts:14`).
  - **Repro:** Follow the visible public "More" link in the Commerce iframe; the target is non-200
    instead of paginating products.
  - **Testing gap:** Add a commerce link smoke that renders the public page and follows every visible
    in-app anchor, failing on non-200 targets.

- [ ] **Add live health checks for deployed example iframes, especially Stack Overflow.**
  - **Severity:** High public-example availability gap.
  - **Evidence:** Public Playwright/curl reproduction during this audit:
    `https://kovo.sh/examples/stackoverflow/` loaded the page, but the iframe service
    `https://kovo-stackoverflow-sfqtuclaza-uc.a.run.app/` returned HTTP 503 and the iframe body was
    `Service Unavailable`. Commerce and CRM roots returned 200 in the same probe.
  - **Testing gap:** Existing static site smoke checks iframe `src` presence, not service health.
    Add a separate live-service health check for Commerce/CRM/Stack Overflow root and one core route
    per app, kept outside offline static-site gates if necessary.

## Critical Testing Gaps

- [ ] **Make CI run the omitted root acceptance gates.**
  - **Severity:** Critical release-gate gap.
  - **Evidence:** Root `acceptance` includes `check`, `check:api-surface`, `test`, `test:browser`,
    `test:integration`, `check:build`, `check:publish`, perf, conformance, and `check:kovo`
    (`package.json:14`). CI runs narrower shards: `vp check`, raw `vitest`, `vp run browser`,
    `vp run integration`, `vp run build`, `vp run conformance`, and `vp run kovo-check`
    (`.github/workflows/ci.yml:28`, `:54`, `:75`, `:96`, `:116`, `:178`, `:199`).
  - **Missing coverage:** CI has no equivalent for `check:imports`, `check:no-committed-generated`,
    `vp run typecheck-examples`, `check:api-surface`, or `check:publish`.
  - **Action:** Add a CI job that runs the omitted script gates through `vp exec pnpm`, or align CI
    with root `acceptance` where runtime permits. Follow `rules/github-workflows.md`.

- [ ] **Include TSX sources in the `typecheck-examples` task cache key.**
  - **Severity:** High cache correctness gap.
  - **Evidence:** `typecheck-examples` runs `tsc` on Commerce, Stack Overflow, CRM, and Reference
    (`vite.config.ts:132`), but its task inputs include only `src/**/*.ts` for the example apps
    (`vite.config.ts:140`, `:143`, `:146`, `:149`). The TS configs include TSX and the apps contain
    TSX entry/component files.
  - **Missing coverage:** A TSX-only break can cache-hit `vp run typecheck-examples` instead of
    rerunning the command that would catch invalid app/component code.
  - **Action:** Add `src/**/*.tsx` inputs for TSX-bearing examples and a meta-test comparing task
    inputs against each command's `tsconfig.json` include extensions.

- [ ] **Run the gallery browser suite from root CI/acceptance.**
  - **Severity:** High UI regression gate gap.
  - **Evidence:** Root browser acceptance includes only `packages/browser/src/**/*.browser.test.ts`
    (`tests/browser-acceptance.mjs:4`; `vitest.browser.config.ts:16`). Root Vitest excludes browser
    tests (`vite.config.ts:208`). The gallery owns a separate browser suite
    (`examples/gallery/package.json:9`; `examples/gallery/vitest.browser.config.ts:26`) covering
    compiled demos for dialogs, menus, fields, select, slider, tabs, toast, tooltip, and more.
  - **Missing coverage:** Browser-only focus, ARIA state, native form ownership, and compiled handler
    regressions in `@kovojs/ui`/`@kovojs/headless-ui` can pass root CI.
  - **Action:** Add CI and root acceptance coverage for
    `pnpm --filter @kovojs/example-gallery run test:browser`, or add an explicit meta-test that
    fails when browser suites exist outside root acceptance without a CI/package gate.

## Commands Run

- Current-main refresh:
  - Inspected source and tests at `e9255f58` for every open item and for the merged
    `plans/bad-components-followup.md` overlap.
- Public Playwright probes over `https://kovo.sh/examples/`, `https://kovo.sh/components/`,
  `https://ui.shadcn.com/docs/components`, targeted high-risk component pages, and an automated
  broad interaction pass over all 44 public component pages.
- Public Playwright probes against `https://kovo-commerce-sfqtuclaza-uc.a.run.app/`,
  `https://kovo-crm-sfqtuclaza-uc.a.run.app/`, and
  `https://kovo-stackoverflow-sfqtuclaza-uc.a.run.app/`.
- Focused existing-test verification from sub-agents:
  - `pnpm exec vitest --run packages/compiler/src/fragment-targets.test.ts packages/compiler/src/compile-component.test.ts packages/compiler/src/source-reparse-boundary.test.ts`
  - `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts --reporter=dot`
- Local reproduction/verification:
  - `pnpm exec vitest --run tests/commerce-realistic.e2e.test.ts` (passed; boots the local Commerce
    real stack and verifies the documented CSRF/add-to-cart posture rather than a successful public
    add-to-cart workflow)
