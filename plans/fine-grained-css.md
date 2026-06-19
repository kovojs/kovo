# Fine-Grained CSS Delivery (Ship Only What the Route Needs)

Stop overshipping CSS. Today every route links one monolithic stylesheet
containing every component's atoms, and inlines a single critical-CSS list that
spans every component, regardless of what the route actually renders. Make the
build split the collected atomic CSS into a small shared **base** chunk plus
per-**route** and per-**fragment** chunks, and have the server link/inline only
the chunks a given route (or patched-in fragment) can reach.

Authority: `SPEC.md` §13.1 (StyleX styles compile to _globally collision-free
atomic classes_ that _dedupe into declared stylesheet assets_ — splitting a
deduped global sheet into route-reachable subsets is an emission-artifact
decision, not a new authoring surface) and §5.2 / **KV235** (the served sheet and
its chunks are emitted artifacts; app TSX only writes `style.create` +
`style={...}`). Per-route critical CSS is also §4.2's promise that the L0 layer
ships the smallest correct first paint.

## Relationship to `plans/css-auto-collection.md` (read first)

This plan **depends on and supersedes Phase 2 of** `plans/css-auto-collection.md`:

- `css-auto-collection.md` Phase 1 makes the build _collect_ app-authored
  `style.create(...)` atoms into one `CssAssetManifest` (closing **Seam A**: the
  Vite plugin currently discards each compiled component's `cssAssets`,
  `vite.ts:153`). This plan **consumes** that manifest; it does not re-solve
  collection. If Phase 1 is not yet done, this plan's Phase 2 can run against the
  package-scoped manifest (`extractPackageComponentCss`,
  `package-styles.ts:58`) as an interim source, but the end state assumes the
  app-graph manifest exists.
- `css-auto-collection.md` Phase 2 ("Route-scoped critical CSS (optional)") is the
  seed of this plan and should be marked **moved here**. The route→component→CSS
  facts it calls **Seam B** are the shared prerequisite (Phase 1 below). When this
  plan lands Phase 1–3, check off that item in `css-auto-collection.md` with a
  pointer to this ledger instead of duplicating the work.

## Problem (current delivery surface)

Every route links the same monolithic sheet and inlines every component's
critical CSS:

- The build merges _all_ app + route stylesheets into one file and reads only
  hand-supplied `criticalCss`; it never splits per route
  (`stylesheetCssByPath`, `packages/server/src/build.ts:659-683`).
- The serving layer already supports a per-route stylesheet _list_
  (`[...app.stylesheets, ...route.stylesheets]`,
  `packages/server/src/app-document.ts:137`), but apps register exactly one
  monolithic sheet, so the list is one entry on every route.
- Apps hand-author one critical-CSS list spanning every component:
  - `examples/commerce/src/app.tsx:74` — `criticalCss: [commerceAppStyleCss,
authFormStyleCss, cartBadgeStyleCss, orderHistoryStyleCss,
productGridStyleCss, …]` shipped to `/login` and every other route.
  - `site/src/route-kit.ts:16-29` — one `/assets/site.css` whose `criticalCss`
    inlines `chrome`, `docs-layout`, `example-split`, `gallery`, `landing`, and
    `searchDialog` on **every** page; the landing route pays for gallery + docs
    CSS it never renders.
- The generated route graph confirms it: every route's `stylesheets` is
  `["/assets/styles.css"]` (`examples/commerce/src/generated/graph.json:57,87`).

Cost scales O(all-components) per page: adding a styled component grows the
first-paint critical CSS and the linked sheet for routes that never use it.

## What already exists (machinery — do not rebuild)

- **The splitter is built but dormant.** `computeCssSplitChunks`
  (`packages/compiler/src/css.ts:232-299`) already produces
  `{ base, routes, fragments }` chunks:
  - `selectRouteCssAssets` (`css.ts:301`) gathers a route's assets by source
    file, href, and fragment target.
  - `sharedRouteCssAssets` (`css.ts:336`) hoists atoms used across routes into
    `base.css`, so shared styles are not duplicated per route.
  - `selectCssAssetsByFragmentTarget` (`css.ts:327`) carves out island/fragment
    CSS into `fragments/<target>.css`.
  - `CssRouteSplitTarget` / `CssSplitOptions` (`css.ts:68-87`) are the inputs;
    `createCssAssetResolver` (`css.ts:202`) resolves the right chunk set per
    render. **None of these are fed real route facts** — only conformance
    fixtures call them (`packages/conformance-fixtures/src/generated-module-fixtures.ts`).
- **Per-component assets carry the facts the splitter needs.** Compiled
  components already emit `ComponentCssAsset` with `criticalCss`,
  `fragmentTargets`, and `styleRuleUsages` (`css.ts:28-44`; emitted at
  `compile.ts:202,240,287,298`).
- **The serving layer already takes a list.** `mergeAppRouteHints`
  (`app-document.ts:136`) concatenates app + route stylesheets;
  `renderPageStylesheetHint` inlines per-asset critical CSS into
  `<style data-kovo-critical-href="…">` and emits the lazy `<link>` + 103 Early
  Hints (`packages/server/src/hints.ts:128-213`).
- **Fragment/mutation responses already carry stylesheets.** Deferred fragment
  chunks render `stylesheets` with their wire HTML
  (`packages/server/src/deferred-stream.ts:81`), and the mutation path threads
  `renderer.stylesheets` through every response branch
  (`packages/server/src/mutation.ts:1090,1102,1137,1149`). A fragment can pull
  its own chunk when patched in.

## The gap (three seams)

- **Seam B — routes carry no CSS facts.** `compileRouteModule`
  (`packages/compiler/src/route-pages.ts`) records each route's component
  _names_ (`CompiledRoutePageMetadata.components`, `route.ts:258`), not a
  route→component→CSS-asset mapping. Without the reachable source-file /
  fragment-target set per route, the build cannot build `CssRouteSplitTarget`s.
- **Seam D — the build never invokes the splitter.** `stylesheetCssByPath`
  (`build.ts:659`) concatenates everything into one sink. Nothing passes
  `CssSplitOptions.routes` to `collectCssAssetManifest`, so `chunks` is never
  populated and `base.css`/`routes/*.css`/`fragments/*.css` are never emitted.
- **Seam E — the route declaration links the monolith.** Routes (and the app)
  declare a single `stylesheet('./styles.css', …)`. Even with chunks emitted,
  nothing rewrites a route's `stylesheets` to `[base.css, routes/<route>.css]`,
  so the document would still link the whole sheet.

## Target delivery surface

```tsx
// route/app — unchanged authoring: one sink, no criticalCss list.
// The build splits the collected manifest and rewrites what each route links.
route('/', { page, layout, stylesheets: [stylesheet('./styles.css', { theme })] });
```

Emitted artifacts:

```
/assets/base.css            # theme + atoms reachable from ≥ N routes / the layout
/assets/routes/index.css    # atoms unique to "/"
/assets/routes/login.css    # atoms unique to "/login"
/assets/fragments/cart.css  # atoms only reachable through the cart fragment
```

Served behavior: the `/` document links `base.css` + `routes/index.css` and
inlines only those two chunks' critical CSS; `routes/login.css` and
`fragments/cart.css` are never sent to `/`. A cart fragment patched in by a
mutation pulls `fragments/cart.css` if not already present.

## Plan

### Phase 0 — Baseline measurement & topology decision

- [x] Quantify the pre-migration overship baseline with a committed test showing
      the site route kit inlined one monolithic critical sheet that combined
      route-specific namespaces before any route-specific splitter could run.
  - Evidence 2026-06-19:
    `git show a557efdb:site/src/route-kit.test.ts` records the baseline test
    that asserted landing, docs-layout, and gallery namespaces in one monolithic
    inline sheet over 40 KB. Current `site/src/route-kit.test.ts` now asserts
    those component atoms are not manually listed in critical CSS after
    `plans/css-auto-collection.md` Phase 3.
- [x] Add per-route byte accounting that records linked CSS and inlined critical
      CSS vs. bytes reachable from that route's component graph.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/css.test.ts packages/cli/src/index.kovo-build.test.ts -t "accounts linked and inlined route CSS bytes|links only reachable build CSS chunks"`
    proves `cssRouteByteAccounting()` records route-linked, inline-critical,
    and graph-reachable CSS byte counts, and `kovo build` route fixtures assert
    `/` and `/login` link/inline fewer page CSS bytes than the all-route chunk
    total.
- [x] Capture commerce + site route CSS byte numbers as the regression baseline
      this plan must beat.
  - Evidence 2026-06-19:
    `node examples/commerce/scripts/measure-style-size.mjs --json` records
    commerce emitted CSS at 125,079 bytes; `/`, `/cart`, and `/login` each link
    `/assets/styles.css` at 118,746 bytes and inline 11,001 critical CSS bytes.
    `node site/scripts/measure-route-style-size.mjs --json` records site emitted
    CSS at 109,111 bytes; `/`, `/docs/quickstart`, and `/guides/styling` each
    link `/assets/site.css` at 109,111 bytes and inline 10,986 critical CSS
    bytes.
- [x] Decide chunk topology and the base-hoist threshold (atoms used by ≥ N
      routes, plus anything the shared layout/chrome renders, go to `base.css`;
      route-unique atoms to `routes/<route>.css`; fragment-only atoms to
      `fragments/<target>.css`). Record how `style.raw(...)` and the runtime
      `emitAtomicCss` escape hatch (un-attributable to a route) stay in `base`. - Evidence: decision recorded here; reconcile with `SPEC.md` §13.1 (global
      atomic, deduped) and `plans/open-design-areas.md` §13.1.
  - Decision 2026-06-19:
    Use `base.css` for theme CSS, raw/unattributable atoms, and atoms reachable
    from at least two routes or shared layout/chrome; emit `routes/<route>.css`
    for route-unique atoms and `fragments/<target>.css` for late fragment-only
    atoms. This preserves SPEC §13.1 global atomic dedupe while making chunking
    an emitted-artifact decision.

### Phase 1 — Emit route→component→CSS facts (Seam B; shared with css-auto-collection)

- [x] Have `compileRouteModule` (`route-pages.ts`) emit, per route, reachable
      component CSS source file names surfaced on route metadata and generated
      route IR so the build can read it without re-deriving the component tree.
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/route-pages.test.ts packages/compiler/src/css.test.ts`
    proves `routePageFacts[].css.sourceFileNames` is derived from component
    imports and serialized into route IR.
- [x] Enrich route CSS facts with reachable fragment targets.
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/package-styles.test.ts -t "extracts route CSS split targets"`
    proves app route CSS target extraction joins route component CSS source
    files to inferred fragment targets and surfaces them on `routePageFacts[].css`
    and `CssRouteSplitTarget.fragmentTargets`.
- [x] Map route CSS facts to `CssRouteSplitTarget` shape (`route`,
      `sourceFileNames`, `fragmentTargets`) — the exact input
      `selectRouteCssAssets` (`css.ts:301`) already consumes.
  - Evidence 2026-06-19:
    `packages/compiler/src/css.test.ts` covers
    `cssRouteSplitTargetsFromRouteFacts()` deduping and sorting route CSS facts.

### Phase 2 — Feed the splitter in the real build (Seam D)

- [x] In the build, construct `CssSplitOptions.routes` from Phase 1 facts and
      call `collectCssAssetManifest` with `split` so `chunks =
{ base, routes, fragments }` is populated (`css.ts:232`). Source the asset
      manifest from `css-auto-collection.md` Phase 1's app-graph collector (or the
      package collector as interim).
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/css.test.ts packages/compiler/src/package-styles.test.ts packages/compiler/src/route-pages.test.ts packages/compiler/src/vite.test.ts packages/server/src/build.test.ts packages/cli/src/index.kovo-build.test.ts -t "maps route page CSS facts|extracts route CSS split targets|serializes route page CSS facts|CSS asset manifest|resolved Vite root|materializes declared and build-owned CSS|auto-collects compiled component CSS"`
    proves route facts map into splitter targets, Vite-collected CSS uses
    app-relative source names, and `kovo build` emits
    `.kovo/client/assets/routes/index.css` for a route-owned component.
- [x] Materialize content-hashed route chunks as real emitted assets through the
      neutral build stylesheet writer.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "auto-collects compiled component CSS"`
    verifies `kovo build` writes a hashed
    `.kovo/client/assets/routes/index-*.css` chunk.
- [x] Materialize content-hashed base chunks as real emitted assets.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "links only reachable build CSS chunks"`
    verifies `kovo build` writes a hashed `.kovo/client/assets/base-*.css`
    chunk.
- [x] Materialize content-hashed fragment chunks as real emitted assets
      (`fragments/*.css`).
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "links only reachable build CSS chunks"`
    verifies `kovo build` writes a hashed
    `.kovo/client/assets/fragments/home-panel-home-panel-*.css` chunk for a
    query-backed styled component.

### Phase 3 — Link/inline only the route's chunks (Seam E)

- [x] Add emitted route chunks to built route stylesheet hints so the active
      route document links and inlines its route chunk.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "auto-collects compiled component CSS"`
    verifies `.kovo/static/index.html` contains
    `data-kovo-critical-href="/assets/routes/index.css"` and links
    `/assets/routes/index.css`.
- [x] Rewrite each route's resolved `stylesheets` to `[base.css,
routes/<route>.css]` (theme stays on `base`/app), using
      `createCssAssetResolver` (`css.ts:202`) at the document boundary
      (`app-document.ts:136`) so the linked set is route-reachable only. App-wide
      `stylesheets` shrinks to the global/base entry.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "links only reachable build CSS chunks"`
    verifies `/` links `base.css` + `routes/index.css` and not
    `routes/login.css`, while `/login` links `base.css` + `routes/login.css`
    and not `routes/index.css`.
- [x] Inline only the active route's chunks' critical CSS via the existing
      `renderPageStylesheetHint` path (`hints.ts:202`); drop the hand-authored
      `criticalCss: [...]` lists.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "links only reachable build CSS chunks"`
    verifies the built `/` and `/login` documents contain only their reachable
    `data-kovo-critical-href` entries.

### Phase 4 — Fragments, islands, and mutation responses

- [x] Ship fragment-only atoms in `fragments/<target>.css` and have a
      fragment/mutation response reference its chunk so a patched-in island is
      styled without a flash, reusing the `stylesheets` already threaded through
      `mutation.ts`.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "references build fragment CSS chunks"`
    proves the built node server's enhanced mutation live-target response links
    base, source-route, and `fragments/home-panel-home-panel-*.css` chunks while
    excluding the unrelated `/login` route chunk.
- [x] Skip fragment atoms already present in `base`/the current route chunk
      (no double-ship, no FOUC).
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "references build fragment CSS chunks"`
    proves a `/login` mutation response pulls the `home-panel` fragment chunk
    while the same target from `/` omits it because the route chunk already
    contains that critical CSS.
- [x] Client navigation: when a client-side route change swaps to a route whose
      chunk is not yet loaded, load it before/with the swap. Confirm against how
      Kovo navigations actually transfer (full nav vs. fragment) and document the
      chosen mechanism.
  - Evidence 2026-06-19:
    `npx vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts -t "updates head, html, and body shell fields"`
    proves enhanced navigation fetches the full target document and replaces the
    head, including the target route stylesheet link. `SPEC.md` §8 confirms
    enhanced navigation is not a client router and uses the full target document
    as its oracle.

### Phase 5 — Dev/prod/static-export parity

- [x] Make the Vite dev plugin (`vite.ts:153`), `kovo build`, and static export
      (`static-export-*`) emit identical chunking, so dev critical CSS and linked
      chunks match production byte-for-byte. - Evidence: a parity test comparing dev-served vs. built `<link>`/critical
      sets for one route.
  - Progress 2026-06-19:
    `corepack pnpm exec vitest --run packages/server/src/vite-dev.test.ts -t "serves build-owned stylesheet chunks|adapts the loaded app"`
    proves the app-shell dev plugin can receive build-owned base/route
    stylesheet assets and serve the active route with the same linked and
    inline-critical chunk set.
    `corepack pnpm exec vitest --run packages/server/src/vite.test.ts packages/server/src/vite-dev.test.ts -t "threads compiler route CSS chunks|serves build-owned stylesheet chunks|loads the authored app entry"`
    proves the public `@kovojs/server/vite` adapter now runs the compiler Vite
    hooks, passes the split compiler CSS manifest into app-shell dev, and serves
    the active route's hashed CSS chunk while excluding the unrelated route.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "serves byte-identical route CSS hints"`
    proves the same split-route fixture serves byte-identical build-owned
    stylesheet links and `data-kovo-critical-href` CSS for `/` through public
    Vite dev, emitted node-server output, and static export output.

### Phase 6 — Migrate examples + site off the monolith

- [x] Drop the hand-rolled single `criticalCss: [...]` / one-sheet declarations
      from `examples/{commerce,crm,stackoverflow}`, `site/src/route-kit.ts`, and
      the `create-kovo` starter; routes keep only stylesheet declarations and
      inherit build-owned chunked delivery.
  - Evidence 2026-06-19:
    `rg -n "criticalCss|emitAtomicCss|__rules|StyleCss|styleCss|stylesheet\\('./styles\\.css'|stylesheets" examples/commerce/src examples/crm/src examples/stackoverflow/src site/src packages/create-kovo/templates -g '*.ts' -g '*.tsx'`
    shows no generated-rule exports or component critical lists in those apps;
    remaining matches are authored stylesheet declarations and route-kit theme
    critical CSS.
- [ ] Prove each example renders styled HTML with strictly smaller per-route CSS
      than the Phase 0 baseline; update `graph.json`,
      `app.rendering.test.ts` (`examples/commerce/src/app.rendering.test.ts`),
      and `route-kit.test.ts` expectations with byte evidence.
  - Progress 2026-06-19:
    `corepack pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "auto-collects compiled component CSS|links only reachable build CSS chunks"`
    proves split app CSS is no longer duplicated into the declared
    `/assets/styles.css` sink for build fixtures.
    `corepack pnpm exec vitest --run examples/commerce/src/app.rendering.test.ts -t "keeps authored global CSS"`
    boots the emitted commerce node server and proves `/`, `/cart`, and `/login`
    each serve linked+inline CSS below the Phase 0 commerce route total
    (129,747 bytes).
    `node examples/commerce/scripts/measure-style-size.mjs --json` records built
    commerce route totals: `/` 111,988 linked + 11,001 inline, `/cart` 111,988
    linked + 11,001 inline, `/login` 113,560 linked + 12,572 inline.
    `node --input-type=module` probe over `examples/crm/scripts/serve.mjs`
    records CRM dev route totals after public Vite CSS handoff: `/` links
    `/assets/styles.css` + `/assets/routes/index-9232ec27.css` at 2,484 bytes
    and inlines 13,313 bytes; `/contacts` links
    `/assets/routes/contacts-de2015d1.css` at 2,062 bytes and inlines 16,705
    bytes; `/deals/d1` links `/assets/routes/deals-id-2de2f59d.css` at 3,089
    bytes and inlines 25,654 bytes.
    `node --input-type=module` probe over
    `examples/stackoverflow/scripts/serve.mjs` records Stack Overflow dev route
    totals: `/` links `/assets/styles.css` +
    `/assets/routes/index-317cb718.css` at 4,336 bytes and inlines 14,908
    bytes; `/questions/q1` links `/assets/routes/questions-id-57301277.css`
    at 3,468 bytes and inlines 17,040 bytes.
  - Gap:
    create-kovo starter and site still need comparable route-byte proof before
    this checkbox can close.

### Phase 7 — Overship regression gate

- [x] Add a conformance check that fails the build if a route links or inlines an
      atom unreachable from that route's component/fragment graph, and emits the
      bytes-per-route number from Phase 0 as an artifact so regressions are
      visible. Wire into `rules/v1-acceptance.md` CSS/assets gate if appropriate. - Evidence: the gate flags a deliberately over-listed route in a fixture.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/css.test.ts packages/cli/src/index.kovo-build.test.ts -t "flags StyleX atoms|auto-collects compiled component CSS|links only reachable build CSS chunks|serves byte-identical route CSS hints"`
    proves `cssRouteDeliveryGate()` reports a deliberately delivered `/login`
    StyleX atom on `/`, returns the route byte-accounting artifact, and the
    `kovo build` app-source and Vite split paths call the gate before emitting
    build-owned CSS chunks.

## Risks & open questions

- **Chunk granularity vs. request count.** Too many tiny route chunks trade bytes
  for round-trips; the base+route 2-chunk model plus `sharedRouteCssAssets`
  hoisting is the floor. Consider merging sub-threshold route chunks into base.
- **Caching tradeoff.** A monolith is cached once across the site; per-route
  chunks mean a returning visitor re-downloads a route chunk on first visit to
  that route, but `base.css` (the bulk) stays cached. Net win for first paint;
  document the tradeoff and keep `base` stable-hashed.
- **Dynamic/un-attributable atoms.** `style.raw(...)` and the runtime
  `emitAtomicCss` path cannot be statically pinned to a route → must live in
  `base` (or a catch-all). Don't strand them.
- **Shared layout/chrome.** Components rendered by the shared layout on every
  route must hoist to `base`, or every route chunk duplicates them. Threshold
  tuning (Phase 0).
- **Fragment FOUC / morph identity.** Loading a fragment chunk late must not
  flash unstyled content or break morph identity (`SPEC.md` §4.4).
- **Depends on `css-auto-collection.md` Phase 1** for the app-graph manifest; if
  that slips, Phases 2–3 run against the package manifest as interim.

## Out of scope

- The CSS _collection_ mechanism (app-source `style.create` → manifest) — owned by
  `plans/css-auto-collection.md` Phase 1; this plan consumes its output.
- Shadow-DOM scoping or a runtime theme store (explicitly rejected, `SPEC.md`
  §13.1).
- `style.raw(...)` dynamic escape hatch behavior (unchanged; stays in `base`).
- Per-component HTTP/2 push or speculative prefetch of other routes' chunks
  (possible follow-up, not required for "don't overship").

## Latest verification

- 2026-06-19 parity slice:
  `corepack pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "auto-collects compiled component CSS|links only reachable build CSS chunks|serves byte-identical route CSS hints|references build fragment CSS chunks"`;
  `corepack pnpm exec tsc --noEmit --pretty false`; `git diff --check`.
- 2026-06-19 overship gate slice:
  `corepack pnpm exec vitest --run packages/compiler/src/css.test.ts packages/cli/src/index.kovo-build.test.ts -t "flags StyleX atoms|auto-collects compiled component CSS|links only reachable build CSS chunks|serves byte-identical route CSS hints"`;
  `corepack pnpm exec tsc --noEmit --pretty false`; `git diff --check`.
