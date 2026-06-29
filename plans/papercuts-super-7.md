# Papercuts Super 7

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five runtime tracks (client-island
runtime + deploy wall, liveness, MPA navigation, custom endpoints, accessibility/theme), each
authored as a real app and adversarially verified. The super-6 fixes landed first: a fresh
scaffold passes `pnpm run check`, islands now hydrate in `vp dev`, and the prod auth cookie is
fixed.

**Meta-theme — `kovo build` (the deploy gate) silently fails to lower authored components, so
client interactivity that works in `vp dev` is dead or undeployable in production.** The root
cause is now pinned (§A1): the prod bundle runs the source-derived-registry pre-plugin (which
wraps `component(...)` in `__kovoAssignDerived`) **before** the kovo transform, and the kovo
transform's reentry guard treats that wrapper as already-lowered and skips it. An authored
island (with `onClick`) then trips the fail-closed assertion → **build fails** (the deploy
wall); a server-fragment region (no island hooks) silently bundles with no renderer → **empty
success body** (the `bugz-16` reopen of `bugz-14` B2). This corrects super-6 A1's misdiagnosis
(it is registry-wrapper + reentry-guard, **not** oxc JSX ordering) and proves the wall is a
fixable ordering/guard bug, not an inherent limit. The remaining findings are real runtime gaps
in navigation (§C), endpoints (§D), and the deployable SSR/no-JS a11y/theme layer (§E).

**Security/soundness escalated to `plans/bugz-16.md`** (1 item): the prod `kovo build` artifact
ships an empty enhanced-mutation success body (stale UI + dead multi-tab sync) — a production
reopen of `bugz-14` B2, sharing §A1's root cause.

## Scope

- Apps: five fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local to
  the monorepo, under `/Users/mini/kovo-dogfood-pg7-20260629/` (+ `/Users/mini/kovo-dogfood-pg7-base`).
  Gates per app: `pnpm run check`, `tsc --noEmit`, `vp test`, `build:prod`, plus dev/prod HTTP +
  Playwright drives.
- Out of scope: published-npm behavior; the non-default `--sqlite` template; the roadmap L4 Live
  transport (unimplemented by design, SPEC §9.3); areas covered by super-1…6 + bugz-13…15. The
  escalated success-body item is in `bugz-16.md`. Throwaway apps are safe to delete; do **not**
  re-run `pnpm install` in them without isolation.

## Issues

### A. `kovo build` doesn't lower authored components (the deploy wall, root cause found)

- [x] **A1 — `kovo build` cannot ship an authored client island: the source-derived-registry pre-plugin wraps `component(...)` in `__kovoAssignDerived`, which trips the kovo transform's reentry guard, so the still-raw island JSX is never lowered and the build fails closed. The wall is a fixable plugin-ordering/guard bug, not an inherent limit (corrects super-6 A1's root cause).** (high, framework; found by `t1-islands-runtime`)
  - Observed behavior: `kovo build ./src/app.tsx` (= the starter's only deploy path) on a default scaffold with one authored L1 island exits 1: "kovo build cannot ship an authored client island that reached the server bundle before Kovo lowering … fails closed". The same island hydrates correctly in `vp dev`. There is no app-accessible build flag to lower it (`kovo build --help` = `--out/--preset/--check/--no-cache`); the only working island-ship path in the repo is the gallery's bespoke `materialize-interactive-gallery.mjs`, which calls the internal `compileComponentModule` ahead of time and commits generated `.client.js`/`.tsx` — not exposed to a create-kovo author.
  - Root cause: `packages/cli/src/commands/build-export.ts:2078-2083` orders `sourceDerivedRegistryVitePlugin` (`enforce:'pre'`) **before** `kovoPlugin`; `source-derived-lowering.ts` rewrites `component({…})` into `__kovoAssignDerivedComponentName(component({…}), key)` + an injected `@kovojs/server/internal/wire` import; `packages/compiler/src/vite.ts:489-492` `isKovoGeneratedServerModuleReentry` returns true when the source matches the ABI import pattern **and** includes `__kovoAssignDerived` (or `componentLiveTargetRenderer`), so the kovo transform early-returns `null` (`vite.ts:298-303`) and never lowers the still-raw island JSX; `onClick` survives into the SSR bundle and `assertNoUnloweredKovoClientIslandHooks` (`build-export.ts:2114-2124`) throws. Decisive disproof of super-6 A1's "oxc automatic JSX" cause: with the SAME oxc config but the registry pre-plugin removed, the island lowers fine (raw `onClick` = false); re-adding the registry plugin reproduces the failure.
  - Why it matters: SPEC §5.1 promises the prod pipeline lowers `tsx → … → server.js + client.js (prod only)` and §7 makes L1/L2 islands first-class, but the starter's documented deploy path cannot ship a single authored island, with no exposed alternative. (Same root cause as `bugz-16` B1, where a fragment region silently ships an empty body instead of failing.)
  - Repro evidence (self-verified): an authored `component({state,render})` island in `app.tsx` → `kovo build ./src/app.tsx` exit 1; source lines confirmed (`build-export.ts:2078-2083`, `compiler/vite.ts:489-492`); a rollup build with the registry pre-plugin removed lowers the island (no raw `onClick`).
  - Acceptance: `kovo build` lowers authored islands (and registry-wrapped fragment components) for production — lower before the registry naming wrapper, or exclude authored (un-lowered) modules from the reentry guard. Prove with a build test: a starter with one authored island builds, emits a per-component `.client.js`, and the island hydrates in the prod artifact; plus the `bugz-16` B1 end-to-end success-body assertion.
  - Fixed evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts packages/server/src/vite-data-plane-gate.test.ts --reporter=dot` passes 50 tests / 1 skipped, including authored-island prod build lowering and registry-wrapped fragment success chunks.

- [x] **A2 — Two stateful islands in one module: the SECOND island's valid local-state bindings fail KV302 (false positive), because state-shape validation resolves only the first component (the fail-closed state-side twin of `bugz-14` B3, which fixed the query half).** (med, framework; found by `t1-islands-runtime`)
  - Observed behavior: two `component({state,render})` islands in one module, each binding its own local state (`{state.count}` / `{state.text}`), makes `vp dev` return `500` with `KV302 … data-bind path is not present in the declared query shape: state.text` on the **second** island. The first island's identical-shaped bindings compile fine; reordering moves the failure to whichever island is second — a false rejection of valid code.
  - Root cause: `packages/compiler/src/validate/bindings.ts:65-74` collects all module-wide `binding.query === 'state'` attributes and validates each via `validateStateBindingPath`; `:188-199` resolves allowed state roots through `componentStateReturnObjectModel` → `firstComponentModel(model)?.stateReturnObject` (`scan/parse.ts:410-413`) — **always component[0]**. So every state binding in the module is checked against component[0]'s `state()` shape; the 2nd island's legitimate keys are absent → spurious KV302. This is the state-shape twin of `bugz-14` B3 (which fixed only the query-shape half, and was fail-open; this half is fail-closed).
  - Why it matters: SPEC §7 explicitly supports multiple coordinated islands on a page and §4.5/§4.8 treat multi-component modules as first-class (lowering already iterates all components). Co-locating two small stateful islands in one file is the natural pattern; it is silently un-authorable with a misleading "not in declared query shape" error that points at queries when the cause is state-shape resolution.
  - Repro evidence: `compileComponentModule` on a module with two `component({state,render})` islands fails KV302 on the second under both orderings; live `GET /` rendering them → 500. Source confirmed at `bindings.ts:188-199`, `parse.ts:410-413`.
  - Acceptance: state-binding validation resolves each binding against its own component's `state()` shape (iterate `model.components[i]`, not just `[0]`). Prove with a compile test: two stateful islands in one module each binding their own state both compile.
  - Fixed evidence: `pnpm exec vitest --run packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-bindings.test.ts --reporter=dot` passes 52 tests with two- and three-component local-state coverage plus a later-component missing-key negative.

### B. Liveness runtime for server-fragment regions

- [x] **B1 — Refetch-on-focus (SPEC §9.3) is structurally inert for the starter's server-fragment region: a freshly-loaded tab has no client query ledger to refresh, so returning to focus never re-runs the query over `/_q/`.** (low, docs/framework; found by `t2-liveness`)
  - Observed behavior: on a fresh authed `/` the document has zero `script[kovo-query]` and zero `[data-bind*]` — the contacts list is pure server HTML inside `kovo-fragment-target="contacts-region"`. The focus/visibility refetch (now wired into the runtime by super-6 A4) seeds its client ledger only from hydrated/applied `<kovo-query>` scripts, of which the starter region has none, so focus-return refetches nothing.
  - Root cause: refetch-on-focus is a query-**value** refresh over `/_q/` whose ledger is seeded by `rememberQueryScripts`/`rememberQueryChunk` (`packages/browser/src/inline-loader-build.ts`, `query-visible-return.ts:94`); a server-fragment region ships no client query store/data-bind, so there is nothing to refresh into. (Compounds `bugz-16` B1: the same region also can't receive a success delta.)
  - Why it matters: SPEC §9.3 advertises refetch-on-focus as one of the two shipped liveness mechanisms ("re-runs queries when a stale tab returns … fakes an embarrassing share of live UX"), but for the idiomatic server-fragment region it does nothing — the mechanism only applies to client-store/data-bind regions, which the starter doesn't use. At minimum a docs/SPEC clarification of which region shapes get focus-refetch.
  - Repro evidence: `t2-liveness` — fresh authed `/` has 0 `script[kovo-query]`/`[data-bind]`; focus-return issues no `/_q/`. Source: `query-visible-return.ts:94`, `inline-loader-build.ts` ledger seeding.
  - Acceptance: either server-fragment regions participate in focus-refetch (fragment re-render over the live-target path), or SPEC §9.3/the starter docs state that focus-refetch applies only to client-store query regions. (Note: the prod-success-body half of this region's liveness is the `bugz-16` B1 defect.)
  - Fixed evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/query-visible-return.browser.test.ts --reporter=dot` passes 96 browser tests with visible-return fragment refresh coverage.

### C. Navigation runtime

- [x] **C1 — `viewTransitionName` props lower to `view-transition-name` CSS but never animate: no cross-document `@view-transition { navigation: auto }` opt-in is emitted, and the loader's morph path never calls `startViewTransition()`.** (med, framework; found by `t3-navigation`)
  - Observed behavior: `<span viewTransitionName="brand">` correctly lowers to `view-transition-name: brand` CSS, but across a real navigation no transition animates.
  - Root cause: the framework stamps `view-transition-name` (working) but emits no cross-document opt-in at-rule into any document/stylesheet, and the deferred loader's enhanced-nav morph never calls `document.startViewTransition()`. `jsx-runtime.ts:263`, `structural-jsx.ts:301` (stamping) with no opt-in/trigger counterpart.
  - Why it matters: SPEC §8 markets cross-document view transitions as opt-in via the `viewTransitionName` props the compiler stamps (and KV239 polices duplicate VT names), implying they animate — but the stamped names are inert. An author follows the SPEC and gets no transition.
  - Repro evidence: `t3-navigation` — stamped VT names present in CSS; no `@view-transition` rule in any document; no `startViewTransition` call in the loader; no animation across nav.
  - Acceptance: emit the cross-document `@view-transition { navigation: auto }` opt-in (and/or call `startViewTransition()` on the enhanced morph) so stamped names animate, or SPEC §8 marks VTs unshipped. SPEC §8.
  - Fixed evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/query-visible-return.browser.test.ts --reporter=dot` passes 96 browser tests, including enhanced navigation using `document.startViewTransition()`.

- [x] **C2 — The loader pins `history.scrollRestoration='manual'` unconditionally and only restores scroll on the enhanced path, so back/forward scroll position is lost on every full-GET fallback navigation.** (med, framework; found by `t3-navigation`)
  - Observed behavior: scroll down `/about`, click to `/guide`, `history.back()` → `/about` at `scrollY=0`, not the previous `863`.
  - Root cause: `packages/browser/src/inline-loader.ts` sets `history.scrollRestoration='manual'` at install and never restores it to `'auto'`; the full-GET fallback `ng()` does a raw navigation with no scroll restoration, and the loader restores scroll only on the enhanced morph path.
  - Why it matters: back/forward scroll restoration is baseline browser behavior an MPA gets for free; globally disabling it but only re-implementing it on the enhanced path makes every fallback navigation lose scroll — a regression versus a plain server-rendered site (and SPEC §8 says enhanced nav owns scroll restoration only for completed enhanced navs).
  - Repro evidence: `t3-navigation` prod build, Playwright back/forward → `scrollY` not restored on full-GET. Source: `inline-loader.ts` `scrollRestoration='manual'` pin.
  - Acceptance: restore `scrollRestoration='auto'` for the full-GET fallback (or restore scroll on those navigations too), so back/forward scroll survives regardless of path. SPEC §8.
  - Fixed evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/query-visible-return.browser.test.ts --reporter=dot` passes 96 browser tests, including full-GET fallback restoring native scroll restoration.

- [x] **C3 — An enhanced (JS) mutation form authored as a plain route-page helper (not `component()`) stamps `enhance` but never lowers `FormError` to a target anchor, so on the enhanced path the failure errors are silently swallowed — including the starter's own `LoginForm`.** (med, framework; found by `t3-navigation`)
  - Observed behavior: deployed prod build, enhanced login with a wrong password: the submit is intercepted (no full reload), the server returns `422` with `text/vnd.kovo.fragment+html`, but the error never renders — the user sees nothing. The no-JS path (full re-render) does show it.
  - Root cause: `auth-forms.tsx:84` `LoginForm` is a plain `export function` with `FormError`; `contacts.tsx:221` `ContactsRegion` is a `component()`. `packages/compiler/src/emit/mutation-form.ts:35,76` `mutationFormErrorRenderLowering` is gated on `componentRenderSlotsParam(model)` (i.e. only fires inside `component()`), so a `FormError` in a plain helper function is never lowered to an enhanced error target.
  - Why it matters: login is the most-exercised form in the starter and this is the deployed path. Half-applied enhancement is the trap: JS interception is on (so the no-JS full re-render is suppressed) but the error target was never lowered (so the enhanced path has nowhere to render it) → silent failure on the primary auth flow.
  - Repro evidence: `t3-navigation` — enhanced wrong-password login → 422 with no visible error; `LoginForm` is a plain helper. Source: `mutation-form.ts:35,76`, `auth-forms.tsx:84`.
  - Acceptance: `FormError` in a plain route-page helper either lowers to an enhanced error target (matching `component()`), or the starter authors `LoginForm` as a `component()` / the compiler diagnoses the un-lowered `FormError` under `enhance`. SPEC §9.2.
  - Fixed evidence: `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts --testNamePattern "typechecks the generated app|typechecks the generated SQLite app variant|runs the generated in-app tests|runs the generated production build graph gate" --reporter=dot` passes with the starter `LoginForm` authored as a compiler-visible component.

### D. `endpoint()` REST/runtime conformance

- [x] **D1 — `endpoint()` returns `404` (with the full HTML 404 shell, no `Allow` header) for a wrong-method request on an existing endpoint path, while routes and `/_q/` correctly return `405`.** (med, framework; found by `t4-endpoints`)
  - Observed behavior: `POST /api/health` (a declared GET-only `endpoint()`) returns `404` + the HTML 404 shell, in both dev and prod.
  - Root cause: `packages/server/src/shell.ts:165-181` `matchShellDispatch` endpoint branch does `endpoints.find(… endpointMethodMatches && endpointPathMatches)`; on no match `if (!endpoint) continue;` falls through to a terminal `{kind:'not-found'}` — it never distinguishes "path exists, method wrong" (which should be `405 + Allow`) from "path absent".
  - Why it matters: REST/JSON-API clients branch on `405 + Allow` to discover the supported verb on a known resource; `404` tells them the resource doesn't exist, breaking SDK/discovery behavior. SPEC §9.5 defines the dispatch order but the method-mismatch case isn't a 405.
  - Repro evidence: `t4-endpoints` — `POST /api/health` → 404; `GET` → 200. Source: `shell.ts:165-181`.
  - Acceptance: a wrong-method request to an existing endpoint path returns `405` with an `Allow` header listing the supported methods. SPEC §9.5.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/shell.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/capability-route.test.ts packages/server/src/endpoint.test.ts packages/server/src/app.test.ts --reporter=dot` passes 120 tests, including endpoint method-mismatch 405 + `Allow`.

- [x] **D2 — A content-negotiating `endpoint()` (vary body by `Accept`) is unrepresentable in the single-body response posture, and produces a dev/CI `500` (KV423) but a prod `200` — a posture audit that splits behavior for the same code.** (low, framework; found by `t4-endpoints`)
  - Observed behavior: an endpoint returning JSON by default but HTML for `Accept: text/html` cannot declare its `response.body` honestly (the model allows exactly one of `'json'|'html'|…`); the dev/CI posture audit fails it with KV423 while prod serves `200` — the same handler behaves differently by environment.
  - Root cause: `packages/server/src/endpoint.ts:11,23` — `EndpointResponseBody` is a single literal and `EndpointResponsePosture.body` holds exactly one; there is no union/negotiated option. The posture audit is dev/CI-only, so the conflict surfaces as a 500 in dev and is absent in prod.
  - Why it matters: content negotiation is a canonical REST pattern; the framework makes it either a hard dev failure or a posture declaration that lies, and the dev-only audit means the two environments disagree for identical code.
  - Repro evidence: `t4-endpoints` — a content-negotiating endpoint → dev KV423 500, prod 200. Source: `endpoint.ts:11,23`.
  - Acceptance: allow an endpoint to declare a negotiated/multi-body posture (or a `'negotiated'` body kind), so a content-negotiating endpoint passes the audit and behaves identically in dev and prod. SPEC §9.1.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/shell.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/capability-route.test.ts packages/server/src/endpoint.test.ts packages/server/src/app.test.ts --reporter=dot` passes 120 tests, and `pnpm run check:api-surface` passes with the posture type export.

- [x] **D3 — A thrown `endpoint()` handler returns the full HTML route-error shell (`text/html`, ~3.7 KB) even though the endpoint declared `body:'json'` — there is no endpoint-appropriate JSON 500 path.** (low, framework; found by `t4-endpoints`)
  - Observed behavior: an `endpoint({response:{body:'json'}, handler:()=>{throw …}})` returns, in dev and prod, a `500` with the HTML error document — content-type contradicts the declared `json`. (The shell is generic; it does not leak the thrown message, so this is a format/contract bug, not a secret leak.)
  - Root cause: `packages/server/src/app-request.ts:64-83` wraps dispatch in one try/catch that unconditionally returns `renderAppErrorDocumentResponse(app, request, 500)` (the route HTML shell), with no branch on `match.kind`/endpoint response shape. SPEC §9.2 distinguishes the typed-endpoint 500 (`JSON {code:'SERVER_ERROR'}`) from the route 500 (HTML shell); the endpoint case takes the route path.
  - Why it matters: an `endpoint()` is the declared machine/API surface; on an unhandled error it answers a JSON client with a 3.7 KB HTML document whose content-type contradicts the declared posture, breaking API consumers' error handling.
  - Repro evidence: `t4-endpoints` — thrown `body:'json'` endpoint → `500 text/html` shell. Source: `app-request.ts:64-83`.
  - Acceptance: an unhandled error in a non-HTML `endpoint()` returns an endpoint-appropriate error (e.g. JSON `{code:'SERVER_ERROR'}` with the declared content-type). SPEC §9.2.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/shell.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/capability-route.test.ts packages/server/src/endpoint.test.ts packages/server/src/app.test.ts --reporter=dot` passes 120 tests, including JSON endpoint exception responses.

### E. Accessibility & theme on the deployable SSR/no-JS layer

- [x] **E1 — Enumerated state-ARIA attributes (`aria-expanded`/`-checked`/`-selected`/`-pressed`/`-current`) authored with a boolean are SSR-rendered with HTML boolean-PRESENCE semantics, so `aria-expanded={false}` is omitted entirely (and `={true}` renders as a bare attribute) — producing absent/inverted a11y state on the no-JS layer and a server↔loader render-equivalence drift.** (high, framework; found by `t5-a11y-theme`)
  - Observed behavior: `aria-expanded={false}` renders as **no attribute** (a control that should announce "collapsed" announces nothing); `aria-expanded={true}` renders as bare `aria-expanded` rather than `aria-expanded="true"`. ARIA enumerated attributes require the literal string `"true"`/`"false"`, not HTML boolean presence.
  - Root cause: `packages/server/src/jsx-runtime.ts` applies universal HTML boolean-presence to all attributes — `:278` (`value===false` → omit) and `:335` (`value===true ? ` ${name}`:`="…"`) — with carve-outs only for`key`/`viewTransitionName`/raw-HTML attrs, and **no carve-out for enumerated ARIA attributes** (despite the `AriaBoolean = boolean | 'false' | 'true'`type at`:776`). So a boolean ARIA value is mis-serialized.
  - Why it matters: these attributes are the load-bearing a11y state for the entire toggle/tab/disclosure/checkbox family on the **deployable** SSR/no-JS layer (independent of island hydration — a plain server-rendered control), and a security/no-JS-first framework with a WCAG 2.2 AA target ships inverted/absent state. It is also a server↔loader render-equivalence drift (the client loader may set the string form). Likely the root of the "gallery toggle-family freezes" symptom.
  - Repro evidence: `t5-a11y-theme` — `aria-expanded={false}` SSR output omits the attribute; source confirmed at `jsx-runtime.ts:275-278,333-335` (no aria carve-out among the boolean-presence rules).
  - Acceptance: enumerated ARIA attributes render their value as the literal string (`aria-expanded="false"`/`"true"`), not boolean presence. Prove with a render test over the enumerated-ARIA set for `true`/`false`. (See `rules/accessibility-conformance.md` — this is a defect report, not a conformance claim.)
  - Fixed evidence: `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/style/src/index.test.ts --reporter=dot` passes 77 tests, including literal boolean serialization for ARIA states.

- [x] **E2 — Keyboard focus is lost to `<body>` after a success-path mutation fragment morph when focus was on a non-input focusable (e.g. the submit button) — the starter's primary "Add contact" flow.** (med, framework; found by `t5-a11y-theme`)
  - Observed behavior: focus the `Add contact` submit button, submit (enhanced fragment-swap re-render of `ContactsRegion`) → focus moves to `<body>` (lost), so keyboard/SR users lose their place after every successful mutation.
  - Root cause: `packages/browser/src/morph.ts` `captureActiveDomState` (`:414-422`) / `restoreActiveDomState` (`:434-447`) / `isActiveDomFormControl` (`:407-412`) only handle `HTMLInputElement`/`HTMLTextAreaElement`; a focused `<button>`/`<a>`/`[tabindex]` is not captured, so focus is not restored across the morph.
  - Why it matters: this is the default starter's primary interactive flow, and the submit button is the natural keyboard focus at submit time; SPEC §9.1's morph contract is to preserve focus/state across a fragment swap.
  - Repro evidence: `t5-a11y-theme` — focus button, submit → `document.activeElement` = `<body>`. Source: `morph.ts:407-447`.
  - Acceptance: the morph preserves focus for any focusable element (by stable id/`kovo-key`/selector), not just input/textarea. Prove with an e2e: focus a button, trigger a fragment morph, assert focus is restored to it. SPEC §9.1.
  - Fixed evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/mutation-response-dom.browser.test.ts --reporter=dot` passes 27 browser tests, including focused-button preservation across a fragment morph.

- [x] **E3 — `defineTheme`'s generated dark scheme is unreachable in the default starter: it activates only via a JS `data-theme` toggle, cannot honor `prefers-color-scheme`, and the starter ships no toggle and no FOUC guard — so OS-dark and all no-JS users only ever see the light theme.** (med, framework; found by `t5-a11y-theme`)
  - Observed behavior: the starter's `appTheme.css` contains a full `:root[data-theme="dark"]{…}` block (every token), but the served `<html>` never sets `data-theme`, ships no theme toggle, and no `@media (prefers-color-scheme: dark)`. So the auto-generated dark scheme is dead for OS-dark users and impossible without JS.
  - Root cause: `packages/server/src/theme.ts:221` `DEFAULT_DARK_SELECTOR=:root[data-theme=dark]`; `emitThemeCss` (`:636-653`) renders the dark block only via `renderBlock(darkSelector, …)`, and `renderBlock` (`:700-702`) wraps in exactly one brace pair and cannot emit an `@media` wrapper; the starter provides no toggle/FOUC guard.
  - Why it matters: Kovo auto-generates a Material dark scheme in every app's CSS and then leaves it unreachable by exactly the users (OS-dark, no-JS) a security/no-JS-first framework should serve — a generated-but-dead feature.
  - Repro evidence: `t5-a11y-theme` — `appTheme.css` has the dark block; document never sets `data-theme`; no `@media`. Source: `theme.ts:221,636-653,700-702`.
  - Acceptance: the generated dark scheme is reachable without JS — emit it under `@media (prefers-color-scheme: dark)` (or ship a no-JS-respecting toggle + FOUC guard) so OS-dark/no-JS users get dark. SPEC §13.1.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/style/src/index.test.ts --reporter=dot` passes 77 tests, including default `prefers-color-scheme: dark` theme CSS and custom-selector behavior.

## Refuted / Not Carried Forward

- **nav-rt-5 — "Speculation-Rules prefetch is not reused by the enhanced-nav loader fetch (double fetch per nav)"** — refuted as framing. The observable (2+ GETs per nav; the speculation prefetch isn't reused by the loader's own fetch) is literally true, but it is expected browser/loader behavior (the prefetch warms the HTTP cache; the loader fetch is conditionally served from it), not a defect — and not a duplicate-work bug worth filing.

## Latest Verification

- `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts packages/server/src/vite-data-plane-gate.test.ts --reporter=dot`: passes 50 tests / 1 skipped, proving A1 and `bugz-16` B1 plus graph-derivation output-shape coverage.
- `pnpm exec vitest --run packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-bindings.test.ts --reporter=dot`: passes 52 tests, proving A2.
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/query-visible-return.browser.test.ts --reporter=dot`: passes 96 browser tests, proving B1/C1/C2.
- `pnpm exec vitest run packages/server/src/shell.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/capability-route.test.ts packages/server/src/endpoint.test.ts packages/server/src/app.test.ts --reporter=dot`: passes 120 tests, proving D1-D3 and storage HEAD dispatch.
- `pnpm exec vitest run packages/server/src/jsx-runtime.test.ts packages/style/src/index.test.ts --reporter=dot`: passes 77 tests, proving E1/E3.
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/mutation-response-dom.browser.test.ts --reporter=dot`: passes 27 browser tests, proving E2.
- `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts --testNamePattern "typechecks the generated app|typechecks the generated SQLite app variant|runs the generated in-app tests|runs the generated production build graph gate" --reporter=dot`: passes the starter auth-form/build coverage for C3.
