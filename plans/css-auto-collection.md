# CSS Auto-Collection (App-Authored Styles)

Make app-authored `style.create(...)` CSS collect automatically into the served
stylesheet, the same way `@kovojs/ui` styles already do. Delete the hand-rolled
`emitAtomicCss` + `__rules` + per-component `*StyleCss` export + central
`criticalCss: [...]` registration ritual from app authoring.

Authority: `SPEC.md` §13.1 (the compiler **may** extract static `style.create`,
`defineVars`, `createTheme` into ordinary CSS assets) and §5.2 / **KV235** (TSX is
the sole app-authoring surface; lowered IR/extracted CSS is an output artifact,
never something app code hand-authors). The manual `emitAtomicCss` export is
exactly the kind of lowered-artifact plumbing §5.2 says should not live in app
source. Follow-up to the archived `plans/claude-stylex.md` (retired 2026-06-17),
whose `better-examples.md` close-out explicitly deferred app-side collection.

## Problem (current authoring surface)

Every styled app component ends with identical boilerplate that reaches into the
private `__rules` field the merge path itself skips (`index.ts:550`):

```tsx
const productGridStyles = style.create({ field: {...}, row: {...} });
export const productGridStyleCss = style.emitAtomicCss(
  Object.values(productGridStyles).flatMap((entry) => entry.__rules ?? []),
);
```

…and `app.tsx` must re-import every `*StyleCss` by name and list them by hand:

```tsx
stylesheet('./styles.css', {
  criticalCss: [commerceAppStyleCss, authFormStyleCss, cartBadgeStyleCss,
                orderHistoryStyleCss, productGridStyleCss],
  theme: commerceTheme,
});
```

Adding one styled component is a 3-edit dance across 2 files; miss a step and
styles silently vanish (no diagnostic). This leaks `emitAtomicCss`, `AtomicRule`,
`createAtomicStyles`/`AtomicCssResult`, and `__rules` into the public API
(flagged in `plans/audit-api-20260618-180210.md:1324`).

## Target authoring surface

```tsx
// component — no *StyleCss export, no emitAtomicCss, no __rules
import { style, tokens } from '@kovojs/style';
const s = style.create({ field: {...}, row: {...} });
<div style={s.row} />
```
```tsx
// route/app — one sink, no criticalCss list; build fills it from the route's
// reachable component graph and auto-inlines critical CSS
route('/', { page, layout, stylesheets: [stylesheet('./styles.css', { theme: commerceTheme })] });
```

## What already exists (machinery — do not rebuild)

- `extractKovoStyles` (`packages/compiler/src/style.ts:133`) extracts atoms from a
  component module, lowers static `style={...}` props to `class`/`data-style-src`
  IR, and returns `{ css, ruleUsages, replacements }`.
- `compile.ts:202,240,287,298` already emits per-component `cssAssets`
  (`ComponentCssAsset` with `criticalCss` + `styleRuleUsages`).
- `collectCssAssetManifest`, `selectCssAssets`, `createCssAssetResolver`, and
  route-split chunks (`CssSplitOptions` / `CssRouteSplitTarget`) in
  `packages/compiler/src/css.ts` already aggregate and route assets per page /
  fragment / route.
- `extractPackageComponentCss` (`packages/compiler/src/package-styles.ts:58`) is
  the working package-scoped collector, invoked via `kovo compile package-css`.

## The gap (three seams)

- **Seam A — build doesn't consume component `cssAssets`.**
  `stylesheetCssByPath()` (`packages/server/src/build.ts:659`) only reads
  manually declared `stylesheets[].criticalCss`; it never traverses compiled
  components' `cssAssets`. The Vite plugin (`packages/compiler/src/vite.ts:153`)
  compiles components but discards their `cssAssets` and emits no CSS manifest.
- **Seam B — routes carry no CSS facts.** `compileRouteModule`
  (`packages/compiler/src/route-pages.ts`) records component *names*, not a
  route→component→CSS mapping, so per-route critical CSS can't be computed.
- **Seam C — collection is package-scoped only.** There is no app-source
  equivalent of `extractPackageComponentCss`; app components fall back to the
  runtime `emitAtomicCss` export path (visible in
  `examples/commerce/src/generated/product-grid.tsx`, which retains runtime
  `style.create` + `style={...}` and the `productGridStyleCss` export).

## Plan

### Phase 0 — Decision & SPEC alignment
- [ ] Record the target authoring surface above as normative for v1 styling and
      reconcile with `plans/open-design-areas.md` §13.1 (still open). Confirm no
      §5.2/KV235 conflict: the served sheet is an emitted artifact; app TSX only
      writes `style.create` + `style={...}`.
      - Evidence: link this ledger from `plans/open-design-areas.md` §13.1; cite
        `SPEC.md` §13.1 ("compiler **may** extract … into ordinary CSS assets").

### Phase 1 — App-source CSS collection in the build (core)
- [ ] Add an app-scoped collector that runs `extractKovoStyles` over the app's
      compiled component graph and produces one `CssAssetManifest`
      (reuse `collectCssAssetManifest`). Model it on `extractPackageComponentCss`
      but discover app component sources from the route/component graph rather
      than a package `exports` map. (Seam A/C)
- [ ] Make the build emit the served stylesheet from that manifest: the sink
      referenced by `stylesheet('./styles.css')` is filled with the collected
      atomic CSS, and critical CSS is auto-inlined — no per-component
      `criticalCss` argument. Extend `stylesheetCssByPath()`
      (`build.ts:659`) to merge manifest assets into the declared sink instead
      of only reading hand-supplied `criticalCss`. (Seam A)
- [ ] Wire the Vite plugin (`vite.ts:153`) to accumulate each compiled
      component's `cssAssets` and surface the manifest to the build (dev + prod
      parity), so `kovo build` and `vite build` produce identical sheets.
      - Evidence: a build test asserting an app component's atom (e.g.
        `productGridStyles.field` background) appears in the emitted
        `/assets/styles.css` **without** any `emitAtomicCss` export in app source;
        critical CSS inlined in the page `<style>` (`hints.ts:202`).

### Phase 2 — Route-scoped critical CSS (optional, builds on existing splitter)
- [ ] Have `compileRouteModule` emit route→component CSS facts so the build can
      feed `CssRouteSplitTarget` and use `createCssAssetResolver`
      (`css.ts:202`) to inline only the active route's critical CSS while the
      full sheet loads lazily. (Seam B)
      - Evidence: two routes with disjoint components inline disjoint critical CSS;
        shared atoms dedupe into the base chunk.

### Phase 3 — Migrate examples, starter, docs off the manual surface
- [ ] Remove `export const *StyleCss = style.emitAtomicCss(... __rules ...)` and
      the `criticalCss: [...]` lists from `examples/{commerce,crm,stackoverflow}`,
      `site/tutorial/steps/*`, and `create-kovo` starter; routes keep only
      `stylesheet('./styles.css', { theme })`.
      - Evidence: `grep -rn "emitAtomicCss\|__rules\|StyleCss" examples site packages/create-kovo`
        returns no app-source hits; each example renders byte-identical styled
        HTML before/after (golden/build test).
- [ ] Update styling docs (`docs/`, starter README, `kovo explain`) to teach the
      one-import + no-export surface.

### Phase 4 — Demote the now-unnecessary public API
- [ ] Move `emitAtomicCss`, `AtomicRule`, `createAtomicStyles`, `AtomicCssResult`,
      and the `__rules` accessor off the app-facing `@kovojs/style` entry to
      `@kovojs/style/internal` (or a generated subpath), keeping app-facing
      surface to `create`, `attrs`/`props`, `defineVars`, `createTheme`,
      `defineConsts`, `keyframes`, `tokens`, `defineTheme`, `raw`,
      `firstThatWorks`. Resolves `plans/audit-api-20260618-180210.md:1324`.
      - Evidence: `api-surface-baseline.json` diff shows the symbols removed from
        the public entry; `rules/api-surface.md` gate passes.

### Phase 5 — Authoring ergonomics polish
- [ ] Collapse the double import: drop `import { tokens }` in favor of the
      namespace re-export (already present, `index.ts:2`) or ship a single
      `{ style, tokens }` entry; update examples/docs.
- [ ] Inject `style.create` provenance (`namespace`/`source`) from the compiler
      call site so authors stop hand-typing
      `{ namespace: 'button', source: 'button.tsx' }` (`packages/ui/src/*.tsx`).

## Out of scope
- `style.raw(...)` dynamic escape hatch (unchanged; `SPEC.md` §13.1).
- Shadow-DOM scoping or a runtime theme store (explicitly rejected, §13.1).
- The component-level `style.attrs(...)` merge path — it is ergonomic and stays.

## Latest verification
- _(none yet — plan created 2026-06-18)_. Per-checkbox proving commands are noted
  inline; run the narrowest first (focused build test for Phase 1), broaden to
  root `tsc` + API-surface + `git diff --check` before each checkpoint commit.
