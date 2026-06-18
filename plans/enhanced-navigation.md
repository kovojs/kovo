# Enhanced Navigation - layout persistence over the MPA baseline

Created 2026-06-17. Behavioral source of truth is `SPEC.md`. This plan is a
proposal to add a client navigation enhancement that can preserve layout DOM
across same-origin route navigations while keeping the full-document MPA as the
canonical behavior.

This is intentionally staged. The first implementation path must fetch the
canonical full document and use it as the render oracle. Header-selected partial
navigation responses are a later optimization only after the full-document path
proves equivalence.

## Goal

When JS is present and a navigation is eligible, Kovo should keep unchanged
layout segments mounted (nav, sidebars, in-layout media/state) and morph changed
segments from the server-rendered target document. When JS is absent, the click
is a normal browser navigation to the same URL. On any uncertainty, mismatch, or
runtime failure, the system falls back to a full GET.

No route, data, guard result, chrome, or document state may become reachable only
through client navigation.

## Required SPEC Reconciliation

- [x] **Amend the normative MPA language before implementation.**
  - Current `SPEC.md` says client router and SPA navigation are rejected (§3.1),
    every navigation is a full document (§4.5), navigation between places is
    always real (§7), and `<Link>` has zero router runtime (§8). Enhanced
    navigation must be specified as a progressive enhancement that keeps those
    URLs and server routes canonical rather than as a client router.
  - Evidence: `SPEC.md` §1.3, §3.1, §7, and §8 now define enhanced navigation as
    a JS-on progressive enhancement over real URLs and canonical server
    documents, not as a client-owned router or app-authored mode.
- [x] **Graduate the persistent-navigation decision out of open design.**
  - The current persistent cross-navigation rule lives in
    `plans/open-design-areas.md` item 13.4, while this plan previously referred
    to `SPEC.md` §13.4. The SPEC change must either add a real subsection or
    explicitly keep the open-design entry as the tracked non-normative risk.
  - Evidence: `plans/open-design-areas.md` item 13.4 is resolved to `SPEC.md` §8
    and this plan; app-level SharedWorker/popout escape hatches remain documented
    for media/state outside the compiler-stamped proof.
- [x] **Define enhanced navigation as a new §7/§8 rung, not an app-authored mode.**
  - Authors still write `route()`, `layout()`, `component()`, `<Link>`, and real
    anchors. App TSX must not hand-author navigation targets or lowered segment
    stamps; that would remain KV235 territory.
  - Evidence: `SPEC.md` §8 states enhanced navigation is loader-owned, optional,
    and derived from real anchors plus compiler-stamped segment metadata; app TSX
    does not author segment stamps or persistence policy.

## Load-Bearing Invariants

- [x] **`<Link>` and `href()` still lower to real `<a href>`.**
  - JS-off, modified clicks, context-menu open, copy-link, crawlers, and external
    tools all see the canonical URL.
  - Evidence: `packages/core/src/index.test.ts` and
    `packages/compiler/src/navigation-lowering.test.ts` prove `href()` and
    `<Link>` produce real URL/anchor output; `examples/commerce/src/app-shell.test.ts`
    proves Commerce `/`, `/cart`, and `/login` routes serve no-JS full HTML
    documents over the app-shell HTTP entry.
- [x] **Full-document GET is the oracle, not just the fallback.**
  - Phase 1 enhanced navigation fetches the full target document, parses it, and
    morphs from that document. Partial responses are forbidden until the
    full-document path has render-equivalence evidence.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves an eligible same-origin anchor fetches the target full HTML document,
    parses its head/body, preserves the unchanged layout segment, and replaces
    the changed page segment from the target document.
- [x] **Only unchanged layout segments persist.**
  - "Only the leaf changes" is an optimization, not a promise. Active nav state,
    breadcrumbs, route/search-dependent chrome, auth state, layout queries,
    document attrs, or guard/boundary changes may require morphing a layout
    segment or falling back to a full GET.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves a shared layout segment persists when its target-document chrome is
    equivalent and the route leaf changes; `packages/runtime/src/inline-loader-navigation.test.ts`
    proves divergent layout chrome replaces the current body from the parsed
    target document across all inline installer artifacts.
- [x] **The server remains authoritative for target route and guard results.**
  - Any client-supplied current chain is an optimization hint only. The server or
    full target document determines the destination layout chain and rendered
    output; the client never uses its current chain to skip guards or layouts.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves the loader uses the fetched target document for the destination
    page/layout output; `packages/runtime/src/inline-loader-navigation.test.ts`
    proves target-document layout divergence replaces the current body across
    all inline installer artifacts and proves final same-origin HTML redirect
    documents plus server-rendered 403/404/500 HTML shells drive the final
    document and URL.
- [x] **Deploy skew is loud and recoverable.**
  - Reuse the §9.1.1 render-plan version token. Token mismatch discards the
    enhanced path and performs a full GET.
  - Evidence: `packages/runtime/src/inline-loader-navigation.test.ts` runs the
    readable, freshly minified, generated-bootstrap, and extracted inline
    installers and proves `<meta name="kovo-build">` mismatch falls back through
    `location.assign`.

## Interception Contract

- [x] **Intercept only navigations that native browser navigation can replace.**
  - Eligible: same-origin app route, normal unmodified left click, GET
    navigation, no `target`, no `download`, no external marker, and an HTML
    response.
  - Ineligible: cross-origin URLs, full-origin external links, modified clicks,
    new-tab/window targets, downloads, hash-only same-document movement,
    `respond.file()`, `respond.stream()`, non-GET outcomes, and unknown content
    types. These use native navigation.
  - Evidence: `packages/runtime/src/inline-loader-navigation.test.ts`
    proves cross-origin, modified-click, target, download, hash-only, and nested
    `on:click` anchors are not intercepted by any inline installer artifact.
    It also proves non-HTML responses fall back through `location.assign`;
    `packages/runtime/src/inline-loader-navigation.browser.test.ts` proves the
    eligible same-origin HTML path is intercepted.
- [x] **Redirects and non-200 route outcomes are server-owned.**
  - Enhanced navigation may follow same-origin HTML redirects only when the final
    response passes the same eligibility checks. 403/404/500 shells are target
    documents and may be morphed only when their segment/document stamps are
    compatible; otherwise full GET.
  - Evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader-navigation.test.ts`
    passed with 36 tests and proves final same-origin HTML redirects and
    server-rendered 403/404/500 HTML shells are morphed from the fetched target
    document across all inline installer artifacts.
- [x] **Head and document shell updates are part of navigation.**
  - The full-document MVP must update or validate `<title>`, meta, html/body
    attrs, stylesheet/modulepreload hints, speculation rules, and route-level
    document state. Unsupported shell drift falls back to full GET.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run
    packages/runtime/src/inline-loader-navigation.browser.test.ts --api 63350`
    passed and proves target document updates `<title>`, meta, html/body attrs,
    stylesheet/modulepreload hints, and speculation rules.

## Segment Identity And Morph Contract

- [x] **Segment stamps are derived from layout/route lowering.**
  - Each layout segment and leaf gets a compiler-derived navigation segment stamp
    plus enough metadata to compare the current document with the target
    document. App TSX does not write these stamps.
  - Evidence: `packages/compiler/src/route-pages.test.ts` proves derived page
    and layout segment facts for component-backed pages, native-JSX leaf pages,
    and `KV303` spread-prop rejection; `packages/server/src/route-jsx.test.tsx`
    proves rendered `kovo-nav-*` page/layout stamps from generated route
    metadata; `packages/compiler/src/compile-component.test.ts` and
    `packages/compiler/src/route-pages.test.ts` prove `KV235` rejection for
    app-authored `kovo-nav-*`; `packages/cli/src/index.kovo-explain.test.ts`
    proves `kovo explain page --layouts` lists navigation segment ids and
    metadata.
- [x] **Segment preservation is based on target-document equivalence.**
  - The runtime compares the current and target layout chains. Shared unchanged
    prefixes can persist; divergent or changed suffixes morph from the target
    document. If equivalence cannot be proven, full GET.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    covers unchanged-prefix preservation and changed leaf morphing; `packages/runtime/src/inline-loader-navigation.test.ts`
    covers divergent layout chrome body replacement from the parsed target
    document across all inline installer artifacts.
- [x] **Island lifecycle follows the existing morph rules.**
  - Islands inside preserved segments keep DOM identity and client state. Islands
    removed by a morphed segment have `ctx.signal` aborted. Islands inserted by a
    morph remain inert until their declared trigger fires and are observed for
    `on:visible`, `on:idle`, and `on:load` exactly like mutation fragments.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run
    packages/runtime/src/inline-loader-navigation.browser.test.ts --api 63354`
    passed and proves preserved layout island signals survive, removed page
    island signals abort, and inserted page `on:load`/`on:idle`/`on:visible`
    triggers start once after enhanced navigation. `pnpm exec vitest --run
    packages/runtime/src/inline-loader-delegated.test.ts
    packages/runtime/src/delegated-loader-lifecycle.test.ts` is included in the
    106-test runtime gate and proves the underlying ctx.signal reuse/disposal
    contract.
- [x] **Duplicate IDREF and parser-stability guarantees remain intact.**
  - The enhanced path must not create duplicate ids between a persisted segment
    and a morphed segment, and it must preserve the KV225 parser-stability
    assumptions that fragment morphing relies on.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/id-content-model.test.ts
    packages/runtime/src/inline-loader-navigation.test.ts
    packages/runtime/src/inline-loader-build.test.ts
    packages/runtime/src/inline-loader-artifact-minifier.test.ts` passed 64
    tests and proves compiler KV224 duplicate-id/IDREF rejection, compiler KV225
    parser-reparenting rejection, and enhanced-navigation fallback when a morphed
    segment would duplicate an id from preserved layout chrome across all inline
    installer artifacts.

## Runtime State Contract

- [x] **History, scroll, focus, and announcements emulate browser navigation.**
  - Define `pushState`/`replaceState`, `popstate`, scroll restoration, hash
    scrolling, focus target after navigation, route-change announcement, and
    restoration for back/forward.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves successful enhanced navigation moves focus to the page root, sets
    manual scroll restoration, scrolls to top for plain URLs, emits
    `kovo:navigate`, and scrolls target-document hash anchors into view.
    `packages/runtime/src/inline-loader-navigation.test.ts` proves `popstate`
    restores saved scroll without pushing another history entry across all
    inline installer artifacts.
- [x] **Navigation concurrency is deterministic.**
  - A newer navigation cancels stale fetch/morph work. In-flight mutations keep
    the existing §8/§10.4 pagehide/keepalive semantics. Pending optimistic state
    must be reconciled from server truth, discarded on full GET, or explicitly
    diagnosed; it must not silently survive into an incompatible document.
  - Evidence: `pnpm exec vitest --run packages/runtime/src/inline-loader-navigation.test.ts`
    proves stale target documents cannot override a newer navigation across all
    inline installer artifacts; `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves mutation snapshots after enhanced navigation are taken from the
    post-navigation DOM and exclude stale pre-navigation targets;
    `packages/runtime/src/mutation-optimistic-pagehide.test.ts` proves pending
    optimistic mutation state is discarded/reconciled through the bfcache-safe
    `pagehide` cleanup path.
- [x] **bfcache hygiene is preserved.**
  - No `unload` handlers, no global session heap, and no listeners that block the
    existing bfcache acceptance gates.
  - Evidence: `pnpm exec vitest --run packages/runtime/src/query-visible-return-refetch.test.ts
    packages/runtime/src/mutation-optimistic-pagehide.test.ts
    packages/conformance-fixtures/src/runtime-fixtures.test.ts` passed as part of
    the 71-test runtime gate and proves visible-return/pageshow refetch,
    pagehide optimistic cleanup, and `afterInstall: { pagehide: true, unload:
    false }` conformance behavior. `rg -n "unload|beforeunload|pagehide|pageshow|visibilitychange|popstate"
    packages/runtime/src/inline-loader-build.ts packages/runtime/src/inline-loader.ts
    packages/runtime/src/*.test.ts packages/conformance-fixtures/src/runtime-fixtures.test.ts`
    shows the inline enhanced-navigation loader registers `popstate`, while
    bfcache-sensitive runtime paths use `pagehide`/`pageshow`/`visibilitychange`
    and keep `unload` out of the loader.
- [x] **Inline-loader budget remains explicit.**
  - Navigation code must fit the current 8KB gzip inline-loader budget or the
    SPEC must deliberately change that budget with acceptance evidence.
  - Evidence: `pnpm --filter @kovojs/runtime run check:inline-loader` passed and
    `node --experimental-strip-types - <<'NODE' ...` reported
    `inline-loader-gzip=5596/8192`.

## Implementation Plan

- [x] **0. Navigation contract gate.**
  - Amend SPEC/open-design text, define eligibility, segment stamps,
    document-shell handling, lifecycle, fallback rules, and the browser evidence
    matrix. No compiler/server/runtime implementation begins until this is
    closed.
  - Evidence: `SPEC.md` §8 now defines eligibility, full-document oracle,
    target-document authority, document-shell validation/fallback, segment
    persistence, history/scroll/focus/announcement ownership, concurrency,
    bfcache, and loader-budget constraints. Browser evidence remains open under
    the phase-specific verification targets below.
- [x] **1. Compiler: derived segment metadata only.**
  - After `plans/app-authoring-ergonomics.md` item 3 lands, extend layout/route
    lowering so each segment has derived navigation identity, dependency
    metadata, and explain output. Reject unscannable dynamic composition with a
    teaching diagnostic rather than silently disabling proof.
  - Evidence: `packages/compiler/src/route-pages.test.ts` covers route/layout
    navigation segment derivation, native-JSX leaf pages, and `KV303` for
    unscannable spread props; `packages/server/src/route-ir.test.ts` proves
    generated page metadata carries navigation segments; `packages/server/src/route-jsx.test.tsx`
    proves the server stamps page and nested layout roots from that metadata;
    `packages/cli/src/index.kovo-explain.test.ts` covers explain output.
- [x] **2. Runtime MVP: full-document enhanced navigation.**
  - Intercept eligible anchors, fetch the canonical full HTML document, parse it,
    validate build token and segment metadata, update document-shell fields, and
    morph changed segments through the shared fragment/morph path. Fall back to
    `location.href = url` on any unsupported case.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    covers eligible anchor interception, full-document fetch, head/title update,
    unchanged layout preservation, changed leaf replacement, and shared inline
    morph application; `packages/runtime/src/inline-loader-navigation.test.ts`
    covers build-token mismatch fallback across all inline installer artifacts;
    `packages/runtime/src/inline-loader-artifact-minifier.test.ts` pins the
    minified navigation parser/segment hooks; `pnpm --filter @kovojs/runtime run
    check:inline-loader` passed under the 8KB gzip budget.
- [x] **3. History/focus/scroll/concurrency hardening.**
  - Add `pushState`/`popstate`, scroll/hash restoration, focus movement,
    route-change announcement, in-flight cancellation, and bfcache-safe teardown.
  - Evidence so far: `packages/runtime/src/inline-loader.test.ts` proves the
    inline loader registers `popstate`; `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves successful enhanced navigation focuses the preserved layout root,
    sets manual scroll restoration, scrolls to top, and emits the full-document
    `kovo:navigate` announcement, and scrolls target-document hash anchors into
    view; `packages/runtime/src/inline-loader-navigation.test.ts` proves stale
    response suppression and popstate scroll restoration across all inline
    installer artifacts; `packages/runtime/src/query-visible-return-refetch.test.ts`,
    `packages/runtime/src/mutation-optimistic-pagehide.test.ts`, and
    `packages/conformance-fixtures/src/runtime-fixtures.test.ts` prove bfcache
    hygiene; `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves post-navigation mutation snapshots exclude stale targets, and
    `packages/runtime/src/mutation-optimistic-pagehide.test.ts` proves pending
    optimistic state cleanup.
- [x] **4. Mutation/live composition after enhanced navigation.**
  - Prove `Kovo-Targets`/`Kovo-Live-Targets` snapshots include preserved layout
    targets after navigation, inserted leaf targets are discoverable, and stale
    targets do not double-morph.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run
    packages/runtime/src/inline-loader-navigation.browser.test.ts --api 63359`
    passed and proves an integrated enhanced navigation followed by an enhanced
    mutation sends preserved layout and inserted leaf entries in
    `Kovo-Targets`/`Kovo-Live-Targets`, excludes the stale pre-navigation target,
    and applies the inserted leaf fragment once.
- [x] **5. Render-equivalence and no-JS gates.**
  - Extend the §5.2/§9.2 gates so no-JS full load and JS-on enhanced navigation
    produce equivalent DOM over the corpus, after normalizing intentionally
    persisted browser state.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves enhanced navigation body markup matches the fetched full target
    document after normalizing the loader-added focus tabindex; `examples/commerce/src/app-shell.test.ts`
    proves Commerce `/`, `/cart`, and `/login` serve no-JS full HTML documents;
    `examples/crm/src/interactive-app.test.ts` and
    `examples/stackoverflow/src/interactive-app.test.ts` prove their authored
    routes serve no-JS full HTML documents; `examples/commerce/src/enhanced-navigation.test.ts`
    boots the real Commerce app in Chromium, performs enhanced `/` -> `/cart`
    navigation, proves the shared layout DOM identity persists, and proves the
    enhanced body matches a fresh `/cart` full document after tabindex
    normalization.
- [x] **6. Partial response optimization is explicitly deferred.**
  - V1 enhanced navigation keeps the full target document as the only navigation
    oracle. Header-selected navigation fragments, target-chain hints, or
    route-partial responses remain a later optimization only after corpus-level
    no-JS/full-load versus enhanced-navigation render-equivalence is proven.
  - Evidence: `SPEC.md` §8 now states navigation partials are not a v1 protocol
    and app authors cannot opt into or hand-author them.
- [x] **7. Example and docs proof.**
  - Demonstrate one real example, preferably Commerce or StackOverflow: JS-on
    preserves unchanged layout media/state, JS-off performs full navigations to
    the same URLs, and docs teach the feature as an enhancement.
  - Evidence: `examples/commerce/src/app-shell.test.ts` proves Commerce no-JS
    full-document route loads and proves `/` plus `/cart` render a shared
    compiler-derived layout navigation segment with distinct page segments;
    `packages/runtime/src/inline-loader-navigation.browser.test.ts` proves the
    loader preserves unchanged layout DOM for that segment shape; `site/content/docs/mental-model.md`,
    `site/content/docs/why-kovo.md`, and `site/content/tutorial/01-first-page.md`
    teach enhanced navigation as a full-document progressive enhancement.

## Verification Targets

- [x] **JS-off route walk:** every app route loads and navigates as full documents.
  - Evidence: `examples/commerce/src/app-shell.test.ts` proves Commerce `/`,
    `/cart`, and `/login` routes serve full HTML documents with no fragment
    response markers; `examples/crm/src/interactive-app.test.ts` proves CRM `/`,
    `/contacts`, and `/deals/d1`; `examples/stackoverflow/src/interactive-app.test.ts`
    proves StackOverflow `/` and `/questions/q1`.
- [x] **Anchor semantics:** `<Link>` emits `<a href>` and modified/external/hash/
      download navigations remain native.
  - Evidence: `packages/core/src/index.test.ts` and
    `packages/compiler/src/navigation-lowering.test.ts` prove typed `href()` and
    `<Link>` lower to real URL/anchor output; `packages/runtime/src/inline-loader-navigation.test.ts`
    proves modified, cross-origin, hash-only, target, and download anchor clicks
    are not intercepted.
- [x] **Full-document MVP:** JS-on fetches canonical HTML, morphs compatible
      segments, and falls back on unsupported document-shell drift.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves full-document fetch, compatible leaf morphing, document shell updates,
    and body render-equivalence to the fetched target document; `packages/runtime/src/inline-loader-navigation.test.ts`
    proves build-token, non-HTML, duplicate-id morph, and missing navigation
    segment fallback across all inline installer artifacts.
- [x] **Segment persistence:** unchanged layout island/media state survives;
      changed layout or leaf segments morph from server-rendered target HTML.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves unchanged layout persistence, changed leaf morphing, preserved layout
    island signal survival, removed page island abort, and inserted page trigger
    startup; `packages/runtime/src/inline-loader-navigation.test.ts` proves
    divergent layout body replacement.
- [x] **Render-equivalence:** enhanced navigation DOM matches fresh full-load DOM
      after allowed browser-state normalization.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves body markup equivalence to the fetched full target document after
    normalizing the loader-added focus tabindex; `examples/commerce/src/enhanced-navigation.test.ts`
    proves the same equivalence against the real Commerce app over HTTP in
    Chromium while preserving the shared layout DOM identity.
- [x] **Version and guard safety:** build-token mismatch, auth redirect, 403/404,
      and morph failure fall back to full GET or morph the correct server shell.
  - Evidence: `packages/runtime/src/inline-loader-navigation.test.ts`
    proves build-token mismatch, non-HTML fallback, final same-origin HTML
    redirects, and 403/404/500 shell morphing across inline artifacts.
    It also proves duplicate-id morph failure falls back to full GET.
- [x] **Mutation/live after navigation:** preserved and inserted targets refresh
      correctly with no stale-target or double-morph races.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    covers enhanced navigation followed by mutation, preserved layout target
    `layout-shell`, inserted target `cart-badge`, stale target exclusion, and
    single fragment application after navigation.
- [x] **History/scroll/focus/a11y/bfcache:** back/forward, restoration,
      route-change announcement, axe, and bfcache hygiene pass.
  - Evidence: `packages/runtime/src/inline-loader-navigation.browser.test.ts`
    proves focus, top scroll, hash scroll, and route-change announcement;
    `packages/runtime/src/inline-loader-navigation.test.ts` proves popstate
    scroll restoration; bfcache hygiene is covered by the runtime visible-return,
    pagehide, and conformance fixtures; `examples/commerce/src/enhanced-navigation.test.ts`
    performs a real Commerce enhanced navigation in Chromium and asserts the
    navigated document has no axe violations.
- [x] **Loader budget:** inline loader remains within the SPEC budget or the SPEC
      budget change is explicitly accepted.
  - Evidence: `pnpm --filter @kovojs/runtime run check:inline-loader` passed and
    the measured shipped source was `inline-loader-gzip=5596/8192`.
