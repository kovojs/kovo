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
  criticalCss: [
    commerceAppStyleCss,
    authFormStyleCss,
    cartBadgeStyleCss,
    orderHistoryStyleCss,
    productGridStyleCss,
  ],
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
  (`packages/compiler/src/route-pages.ts`) records component _names_, not a
  route→component→CSS mapping, so per-route critical CSS can't be computed.
- **Seam C — collection is package-scoped only.** There is no app-source
  equivalent of `extractPackageComponentCss`; app components fall back to the
  runtime `emitAtomicCss` export path (visible in
  `examples/commerce/src/generated/product-grid.tsx`, which retains runtime
  `style.create` + `style={...}` and the `productGridStyleCss` export).

## Plan

### Phase 0 — Decision & SPEC alignment

- [x] Record the target authoring surface above as normative for v1 styling and
      reconcile with `plans/open-design-areas.md` §13.1 (still open). Confirm no
      §5.2/KV235 conflict: the served sheet is an emitted artifact; app TSX only
      writes `style.create` + `style={...}`.
  - Evidence 2026-06-19:
    `plans/open-design-areas.md` §13.1 links this ledger for app-side
    auto-collection, and `SPEC.md` §13.1 authorizes extracting static
    `style.create(...)`, `defineVars`, and `createTheme` into ordinary emitted CSS
    assets while §5.2 keeps that CSS out of app-authored source.

### Phase 1 — App-source CSS collection in the build (core)

- [x] Add an app-scoped collector over the compiled component graph that
      produces one `CssAssetManifest` via `collectCssAssetManifest`. (Seam A/C)
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/vite.test.ts packages/cli/src/index.kovo-build.test.ts packages/server/src/build.test.ts -t "CSS asset manifest|auto-collects compiled component CSS|materializes declared and build-owned CSS"` proves `createKovoVitePlugin().getCssAssetManifest()` dedupes compiled `cssAssets`.
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/package-styles.test.ts packages/cli/src/index.kovo-build.test.ts -t "extractAppComponentCss|auto-collects compiled component CSS"` proves `extractAppComponentCss()` scans app-authored `style.create(...)` modules and skips generated artifacts.
- [x] Make `kovo build` emit the served stylesheet from that manifest: the sink
      referenced by `stylesheet('./styles.css')` is filled with collected
      component CSS without a per-component `criticalCss` argument. (Seam A)
  - Evidence 2026-06-19:
    `packages/cli/src/index.kovo-build.test.ts` builds a TSX component with a
    `css:` block and `stylesheet('./styles.css')`, then verifies
    `.kovo/client/assets/styles.css` contains the component CSS while Vite CSS
    remains in its manifest asset.
  - Evidence 2026-06-19:
    `npx vitest --run packages/cli/src/index.kovo-build.test.ts -t "auto-collects compiled component CSS"`
    also verifies the same build writes the collected route chunk at
    `.kovo/client/assets/routes/index.css`.
- [x] Wire the Vite plugin to accumulate each compiled component's `cssAssets`
      and surface the manifest to the build. (Seam A)
  - Evidence 2026-06-19:
    `packages/compiler/src/vite.test.ts` covers plugin accumulation; `packages/cli/src/index.ts`
    passes the manifest CSS into `writeKovoNeutralBuild()`.
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/vite.test.ts -t "resolved Vite root|CSS asset manifest"`
    proves build-time Vite root resolution keeps CSS asset source names
    app-relative for route split matching.
- [x] Inline route-critical CSS from the collected manifest during document
      rendering.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/route-pages.test.ts packages/compiler/src/css.test.ts packages/cli/src/index.kovo-build.test.ts -t "serializes route page CSS facts|maps route page CSS facts|links only reachable build CSS chunks"`
    proves the collected manifest is split by route facts and each built route
    document inlines only its reachable `data-kovo-critical-href` base/route
    critical CSS, excluding unrelated route CSS.

### Phase 2 — Route-scoped critical CSS (optional, builds on existing splitter)

> Moved to `plans/fine-grained-css.md`, which owns route/fragment CSS splitting
> end-to-end (route facts → splitter → per-route link/inline). The Seam B work
> below is the shared prerequisite; check this item off with a pointer to that
> ledger when fine-grained-css Phases 1–3 land.

- [x] Have `compileRouteModule` emit route→component CSS facts so the build can
      feed `CssRouteSplitTarget` and use `createCssAssetResolver`
      (`css.ts:202`) to inline only the active route's critical CSS while the
      full sheet loads lazily. (Seam B) - Evidence: two routes with disjoint components inline disjoint critical CSS;
      shared atoms dedupe into the base chunk.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/route-pages.test.ts packages/compiler/src/css.test.ts packages/cli/src/index.kovo-build.test.ts -t "serializes route page CSS facts|maps route page CSS facts|links only reachable build CSS chunks"`
    proves `compileRouteModule` serializes `routePageFacts[].css`, the facts map
    to `CssRouteSplitTarget`, and two built routes inline/link disjoint route
    chunks plus shared base CSS.

### Phase 3 — Migrate examples, starter, docs off the manual surface

- [x] Remove `export const *StyleCss = style.emitAtomicCss(... __rules ...)` and
      the `criticalCss: [...]` lists from `examples/{commerce,crm,stackoverflow}`;
      routes keep only `stylesheet('./styles.css', { theme })`.
  - Evidence 2026-06-19:
    `rg -n "emitAtomicCss|__rules|StyleCss|criticalCss" examples/commerce/src examples/crm/src examples/stackoverflow/src -g'*.ts' -g'*.tsx'`
    returns no hits; `npx vitest --run examples/commerce/src/app.rendering.test.ts examples/commerce/src/app.test.ts`
    and `npx vitest --run examples/crm/src/interactive-app.test.ts examples/stackoverflow/src/interactive-app.test.ts`
    pass.
- [x] Remove `export const *StyleCss = style.emitAtomicCss(... __rules ...)` and
      the `criticalCss: [...]` lists from `site/tutorial/steps/*` and the
      `create-kovo` starter; routes keep only
      `stylesheet('./styles.css', { theme })`.
  - Evidence 2026-06-19:
    `rg -n "emitAtomicCss|__rules|StyleCss|criticalCss" packages/create-kovo/templates site/src site/content site/tutorial -g'*.ts' -g'*.tsx' -g'*.md' -g'!*test.ts'`
    returns no hits; `npx vitest --run packages/create-kovo/src/index.test.ts site/src/route-kit.test.ts`
    and `corepack pnpm --filter @kovojs/site run build:css` pass.
  - Caveat:
    `corepack pnpm --filter @kovojs/site run build` is blocked by the existing
    tutorial snippet extractor error `05-optimistic/src/app.ts:77`, after CSS
    generation succeeds.
- [x] Update styling docs (`docs/`, starter README, `kovo explain`) to teach the
      one-import + no-export surface.
  - Evidence 2026-06-19:
    `site/content/guides/styling.md`, `packages/create-kovo/templates/README.md`,
    and `packages/create-kovo/templates/docs/framework-rules.md` teach
    `style.create(...)` + `style.attrs(...)` with build-known CSS and no CSS
    string exports; `rg -n "style\\.create|style\\.attrs|emitAtomicCss|__rules|criticalCss|StyleCss|stylesheet" packages/cli packages/create-kovo/templates site/content docs -g'*.ts' -g'*.md'`
    shows `kovo explain` only reports stylesheet hrefs.

### Phase 4 — Demote the now-unnecessary public API

- [x] Move `emitAtomicCss`, `AtomicRule`, `createAtomicStyles`, `AtomicCssResult`,
      and the `__rules` accessor off the app-facing `@kovojs/style` entry to
      `@kovojs/style/internal` (or a generated subpath), keeping app-facing
      surface to `create`, `attrs`/`props`, `defineVars`, `createTheme`,
      `keyframes`, `tokens`, and `defineTheme`. Resolves
      `plans/audit-api-20260618-180210.md:1324`.
  - Evidence 2026-06-19:
    `packages/style/src/index.test.ts` asserts the root style module does not
    expose `emitAtomicCss`, `createAtomicStyles`, or `raw`; `packages/style/dist/index.d.mts`
    omits `emitAtomicCss`, `AtomicRule`, `CssEmitOptions`, and `CompiledStyle`
    after `corepack pnpm --filter @kovojs/style run build:dist`.
  - Evidence 2026-06-19:
    `pnpm run check:api-surface` passes with
    `public-exports-needing-attention=1571 (baseline=1571, fixed-this-run=0)`;
    the count is unchanged because these root exports were already documented,
    not baseline debt.

### Phase 5 — Authoring ergonomics polish

- [x] Collapse the double import: drop `import { tokens }` in favor of the
      namespace re-export (already present, `index.ts:2`) or ship a single
      `{ style, tokens }` entry; update examples/docs.
  - Evidence 2026-06-19:
    `rg -n "import \\{ tokens \\} from '@kovojs/style';" packages/create-kovo/templates/src examples/commerce/src examples/crm/src site/content/guides packages/create-kovo/src/index.test.ts -g'*.ts' -g'*.tsx' -g'*.md'`
    has no app/doc source hits after moving those call sites to `style.tokens`;
    `npx vitest --run packages/create-kovo/src/index.test.ts examples/commerce/src/app.rendering.test.ts examples/crm/src/interactive-app.test.ts site/src/route-kit.test.ts`
    passes.
- [x] Inject `style.create` provenance (`namespace`/`source`) from the compiler
      call site so authors stop hand-typing
      `{ namespace: 'button', source: 'button.tsx' }` (`packages/ui/src/*.tsx`).
  - Evidence 2026-06-19:
    `rg -n "namespace: '.*source|source: '.*\\.tsx'" packages/ui/src -g'*.tsx' -g'!*.test.tsx' -g'!*.stylex.test.tsx'`
    reports only the `style.keyframes(...)` identity in `skeleton.tsx`; all
    production `style.create(...)` identity objects are gone from `@kovojs/ui`.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/ui/src/*.stylex.test.tsx packages/ui/src/index.markup.test.tsx`
    proves direct `@kovojs/ui` source execution still emits the same stable
    class/source provenance without hand-authored `style.create` identities.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/package-styles.test.ts packages/compiler/src/style.test.ts`
    proves compiler extraction injects missing provenance and package CSS
    extraction over `@kovojs/ui` keeps the expected `kv-*` namespaces.

## Out of scope

- `style.raw(...)` dynamic escape hatch (unchanged; `SPEC.md` §13.1).
- Shadow-DOM scoping or a runtime theme store (explicitly rejected, §13.1).
- The component-level `style.attrs(...)` merge path — it is ergonomic and stays.

## Latest verification

- 2026-06-19 Phase 0 ledger review:
  `rg -n "13\\.1|CSS|style|stylesheet|auto-collection|open design" plans/open-design-areas.md SPEC.md`.
- 2026-06-19 CSS build slice:
  `corepack pnpm exec tsc --noEmit --pretty false`; `corepack pnpm exec vp check`;
  `git diff --check`.
- 2026-06-19 style provenance slice:
  `corepack pnpm exec tsc --noEmit --pretty false`; `git diff --check`.
