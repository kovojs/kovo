# No Magical Generated Imports

Created 2026-06-18. `SPEC.md` remains the framework behavior source of truth.
This plan removes app-author-facing knowledge of `src/generated/*` from examples,
tests, Vite config, and CSS. Generated artifacts stay committed and inspectable,
but app authors should interact with authored entries and public framework APIs.

## Goal

Examples should teach one rule: write authored TSX/JSX, route/app modules,
queries, mutations, styles, and themes; let Kovo compile, wire, and verify
generated artifacts. Direct generated imports are allowed only in compiler/build
internals, emit/check scripts, and narrowly named artifact tests.

## Target Shape

- [x] Update `SPEC.md` §5.2 to strongly discourage direct imports from generated
      app artifacts, especially from app-authored modules.
  - Evidence: `SPEC.md` §5.2 rule 8 now states generated app artifacts are
    reviewable outputs, not app dependencies, and reserves direct generated reads
    for compiler/build internals, emit freshness checks, and explicitly named
    artifact tests.
  - Proposed wording: "Generated artifacts are reviewable outputs, not app
    dependencies. App-authored modules MUST NOT import app-local generated
    modules such as `src/generated/*`; tests and scripts SHOULD prefer authored
    entry points and public explain/check APIs. Direct generated reads are
    reserved for compiler/build internals, emit freshness checks, and explicitly
    named artifact tests."
- [x] Clarify `SPEC.md` §9.5 so app-facing dev/build config points at an authored
      app entry, not a lowered route artifact.
  - Evidence: `SPEC.md` §9.5 documents `kovo({ app: '/src/app.tsx' })` from
    `@kovojs/server/vite`, requires an authored default-exported `KovoApp`, and
    forbids `src/generated/*` app entries.
  - Proposed behavior: Vite/dev integration loads `/src/app.tsx` or the configured
    authored entry; compiler-owned plugins resolve route IR, live-target
    registries, and generated client modules internally.
- [x] Add a public Vite plugin API with an explicit authored app entry.
  - Target API:
    `plugins: [kovo({ app: '/src/app.tsx' })]` from `@kovojs/server/vite`.
  - `app` is required, must not point into `src/generated/*`, and the module must
    default-export a `KovoApp`. Do not add `exportName`, `moduleId`, or
    `nodeHandlerExportName` to the app-facing API.
  - Evidence: `packages/server/src/vite.ts` exports `kovo({ app })`; `pnpm
    --filter @kovojs/server exec vitest --run src/vite.test.ts src/api/app.test.ts`
    passed and covers generated-entry rejection plus `@kovojs/server/vite`.
- [x] Add an app/route-level stylesheet declaration API so styles are render
      metadata, not Vite config.
  - Target API: `stylesheet('./styles.css', { theme })`,
    `stylesheet({ theme })` for theme-only CSS, and `stylesheet('./styles.css')`
    for authored global CSS without a theme.
  - Local stylesheet declarations derive a public asset href by default; `href`
    remains an optional override for custom emitted URLs.
  - Evidence: `packages/server/src/hints.ts` provides `stylesheet(...)`, route
    definitions already accept `stylesheets`, and `createApp({ stylesheets })`
    now stores app-wide styles inherited by route documents; `pnpm --filter
    @kovojs/server exec vitest --run src/app.test.ts src/app-document.test.ts
    src/static-export-assets.test.ts src/api/app.test.ts` passed.
- [x] Add a no-generated-import guard for app-authored source.
  - Scope: fail on `from './generated/*'`, `from '../generated/*'`, or dynamic
    generated imports outside `src/generated/**`, `scripts/**`, compiler-owned
    build helpers, and explicit artifact tests.
  - Evidence: `scripts/import-boundary.mjs` now allows generated reads
    only for emit/check scripts and explicitly named artifact/generated/graph
    tests or fixtures; ordinary tests no longer receive a blanket generated-read
    exemption. `pnpm exec vitest --run scripts/import-boundary.test.mjs` and
    `node scripts/import-boundary.mjs` passed after the direct app-source
    generated imports were removed or moved into explicit generated fixtures.
  - Evidence: Gallery interactive docs now keep generated demo imports
    inside `examples/gallery/src/interactive-docs.generated-fixtures.tsx`; the
    authored route shell imports the fixture instead of `src/generated/*`.
    `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/interactive-gallery.artifacts.test.ts src/interactive-gallery.compile.test.ts`
    passed.
- [ ] Keep generated artifacts committed and inspectable without making ordinary
      scenario tests import them.
  - Acceptance: `emit-components -- --check`, `emit-graph -- --check`, compiler
    conformance tests, and package-level generated-artifact tests own freshness.

## Commerce

- [ ] Change Commerce scenario tests and helpers to import the authored app entry
      (`./app.js`) instead of `./generated/app.kovo-route.js`.
  - Current generated imports are in `examples/commerce/src/app-test-helpers.ts`,
    `examples/commerce/src/app.test.ts`, and
    `examples/commerce/src/enhanced-navigation.test.ts`.
  - Current progress: those scenario files no longer import
    `./generated/app.kovo-route.js` directly; they use
    `examples/commerce/src/app.generated-fixtures.ts` while the public authored
    loader gap is closed. `pnpm --filter @kovojs/example-commerce exec vitest
    --run src/app.test.ts src/enhanced-navigation.test.ts` passed.
- [x] Delete `examples/commerce/src/source-truth.test.ts`.
  - Rationale: reading `src/generated/graph.json` from an example test is not a
    useful app-author DevX signal. Graph correctness should live in compiler/CLI
    package tests and explicit generated graph checks.
  - Evidence: `test ! -e examples/commerce/src/source-truth.test.ts` passed.
- [x] Move any remaining Commerce graph-smoke value into package-level coverage
      or a CLI/explain test that does not require app tests to know the generated
      file path.
  - Evidence: `pnpm --filter @kovojs/example-commerce run emit-graph -- --check`
    passed; `examples/commerce/scripts/emit-graph.mjs` owns graph, touch-graph,
    and optimistic artifact freshness checks.
- [x] Update Commerce Vite config to reference the authored entry only.
  - Target authoring shape:
    `plugins: [kovo({ app: '/src/app.tsx' })]`, with any demo-only conditional
    outside the `kovo()` API. No `moduleId: '/src/generated/app.kovo-route.tsx'`
    in `examples/commerce/vite.config.ts`.
  - Evidence: `examples/commerce/vite.config.ts` uses
    `kovo({ app: '/src/app.tsx' })`; `pnpm --filter @kovojs/example-commerce exec
    vitest --run src/app.test.ts src/enhanced-navigation.test.ts` passed.
- [x] Remove authored CSS imports of app-local generated CSS.
  - Target authoring shape: no `@import './generated/kovo-ui.css'` in
    `examples/commerce/src/styles.css`; the build/dev pipeline injects or
    expands framework/UI CSS from public stylesheet/theme declarations.
  - Evidence: `examples/commerce/src/styles.css` no longer imports
    `./generated/kovo-ui.css`; `pnpm --filter @kovojs/example-commerce exec
    vitest --run src/app.rendering.test.ts` passed and asserts authored CSS does
    not contain `./generated/`.

## CRM And StackOverflow

- [ ] Apply the same test/helper boundary to CRM and StackOverflow.
  - Scenario tests import authored entries or public helper factories, not
    `src/generated/*`.
  - Current progress: `examples/crm/src/app-shell.ts`,
    `examples/crm/src/interactive-app.test.ts`,
    `examples/stackoverflow/src/app-shell.ts`, and
    `examples/stackoverflow/src/interactive-app.test.ts` no longer import
    generated route modules directly; they use explicitly named generated
    fixtures until authored app loading preserves compiled route metadata.
    Focused CRM and StackOverflow interactive tests passed.
  - Current progress: `examples/crm/src/mutations.ts` no longer imports
    `src/generated/optimistic/*`; CRM keeps generated optimistic artifacts as
    review/check outputs while authored mutation exports own the runtime
    optimistic plans. `pnpm --filter @kovojs/example-crm exec vitest --run
    src/optimistic.test.ts src/interactive-app.test.ts src/graph.test.ts` and
    `pnpm --filter @kovojs/example-crm run emit-graph -- --check` passed.
- [x] Update CRM and StackOverflow Vite configs to reference authored app entries
      only.
  - Evidence: `examples/crm/vite.config.ts` and
    `examples/stackoverflow/vite.config.ts` use `kovo({ app: '/src/app-shell.ts' })`;
    focused interactive-app tests for both packages passed.
- [x] Remove authored CSS imports of app-local generated CSS from CRM and
      StackOverflow.
  - Evidence: `examples/crm/src/styles.css` and
    `examples/stackoverflow/src/styles.css` no longer import
    `./generated/kovo-ui.css`; `pnpm --filter @kovojs/example-crm exec vitest
    --run src/interactive-app.test.ts` and `pnpm --filter
    @kovojs/example-stackoverflow exec vitest --run src/interactive-app.test.ts`
    passed and assert authored CSS does not contain `./generated/`.
- [x] Audit public demo modules that export generated graph/optimistic artifacts.
  - Decision needed: either keep them behind explicitly named artifact exports or
    move them to package/conformance coverage so the public demo surface stays
    authored-first.
  - Evidence: `examples/crm/src/index.ts` and
    `examples/stackoverflow/src/app.ts` no longer import or re-export generated
    graph/optimistic artifacts; `rg "generated/" examples/crm/src/index.ts
    examples/stackoverflow/src/app.ts -n` returned no matches, and focused CRM
    graph/optimistic plus StackOverflow interactive tests passed.

## Vite Config Simplification

- [x] Add an app-facing Kovo Vite plugin so example configs do not manually
      `ssrLoadModule('@kovojs/server')`.
  - Candidate API:
    `kovo({ app: '/src/app.tsx' })`.
  - Evidence: `packages/server/src/vite.ts` exposes `kovo({ app })`; Commerce,
    CRM, and StackOverflow configs import `@kovojs/server/vite` directly with no
    local `ssrLoadModule('@kovojs/server')` wrappers.
- [x] Keep `kovo()` explicit: no default app discovery.
  - The app entry is required so the config remains readable and there is no
    hidden convention around `src/app.tsx`.
  - Evidence: `packages/server/src/vite.ts` requires `options.app` and has no
    fallback discovery branch; `src/vite.test.ts` covers generated-entry
    rejection.
- [x] Enforce default-export-only app modules for the public Vite plugin.
  - If the app module does not default-export a `KovoApp`, fail with a teaching
    diagnostic. Do not add an `exportName` option.
  - Evidence: `packages/server/src/vite.ts` exposes no `exportName` option and
    delegates to the existing default export app-shell loader; server Vite tests
    passed.
- [x] Keep demo-only plugin disabling outside the public Kovo plugin API.
  - Example shape:
    `plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [kovo({ app: '/src/app.tsx' })]`.
  - Evidence: Commerce, CRM, and StackOverflow configs keep
    `process.env.KOVO_DEMO_MULTITENANT ? [] : [...]` outside `kovo()`.
- [x] Keep styles out of Vite config.
  - Styles are app/route render metadata declared through `stylesheet(...)`;
    Vite materializes declared assets but does not own style semantics.
  - Evidence: Commerce, CRM, and StackOverflow declare route stylesheets in
    authored app modules with `stylesheet(...)`; focused example rendering tests
    passed.
- [x] Move repeated Vite dev server type aliases and plugin-loader wrappers into
      framework code or a shared examples helper.
  - Evidence: the repeated local dev-server interfaces and loader wrappers were
    removed from the three example Vite configs in favor of
    `@kovojs/server/vite`.
- [ ] Preserve `vite-plus` task inputs without hand-maintaining broad boilerplate
      in every example config.
  - Do not overload `kovo()` with `serve`/task options unless a separate
    vite-plus-specific helper is introduced.

## Stylesheet API

- [x] Add `stylesheet()` as the authored declaration for local, external, and
      theme-only styles.
  - Local authored CSS: `stylesheet('./styles.css')`.
  - Local authored CSS plus theme: `stylesheet('./styles.css', { theme })`.
  - Theme-only: `stylesheet({ theme })`.
  - External CSS: `stylesheet('https://cdn.example.com/reset.css')`.
  - Evidence: `packages/server/src/hints.ts` exports `stylesheet()` and
    `packages/server/src/hints.test.ts` covers local, local plus theme,
    theme-only, and external declarations.
- [x] Let local declarations derive their public URL.
  - `stylesheet('./styles.css')` should emit/link `/assets/styles.css` unless
    overridden with `href`.
  - Evidence: `pnpm --filter @kovojs/server exec vitest --run src/hints.test.ts
    src/api/app.test.ts`.
- [ ] Make emitted stylesheet assets aggregate compiler-owned CSS.
  - The emitted asset should contain declared theme CSS, authored global CSS when
    present, generated `@kovojs/ui` CSS used by the app graph, and generated
    `@kovojs/style` atomic CSS used by authored style objects.
  - Current gap: authored example CSS no longer imports `src/generated/kovo-ui.css`,
    but the framework-owned Vite/build aggregation hook still needs to materialize
    package UI CSS into the emitted `/assets/styles.css` asset.
- [ ] Allow app-wide and route-level stylesheet declarations.
  - App-level stylesheets are inherited by routes; route-level stylesheets can
    add page-specific CSS while remaining visible to page hints, fragments,
    static export, and `kovo explain page`.
  - Current progress: app-wide stylesheets are stored on `KovoApp`, merged into
    route documents before route-level stylesheets, applied to framework-owned
    error documents, and replayed through static export. Keep open until
    fragment/explain visibility is verified or implemented.

## Docs Site

- [ ] Migrate the docs site to the same authored styling format as the examples.
  - Component-specific styles should live next to the component that owns them,
    authored JSX should use `style={styles.foo}` / `style={[...]}`, and
    `style.attrs(...)` should remain a low-level runtime or package-internal
    escape hatch rather than the app-author-facing pattern.
  - Current progress: `site/src/components/docs-layout.tsx`,
    `site/src/components/example-split.tsx`, and
    `site/src/components/gallery.tsx` now co-locate authored style objects and
    feed their emitted CSS through `siteStylesheets`; `pnpm --filter
    @kovojs/site test`, `pnpm --filter @kovojs/site run build:css`, `pnpm
    --filter @kovojs/site exec node scripts/export-static.mjs`, and `rg -n
    "style\\.attrs" site/src --glob '!generated/**' -S` passed. Keep open for
    remaining class-based docs components and prose examples.
  - Current progress: docs site and tutorial generated artifact imports now sit
    behind explicit generated fixtures, and the islands guide imports
    `handler` from the public `@kovojs/runtime` root in its snippet. `pnpm
    --filter @kovojs/site test`, `pnpm --filter @kovojs/site exec node
    scripts/export-static.mjs`, and `node scripts/import-boundary.mjs` passed.
  - Current progress: docs prose examples now teach `style={...}` /
    `style={[...]}` instead of `style.attrs(...)`; `rg -n "style\\.attrs"
    site/content site/src site/tutorial --glob '!**/generated/**' -S`, `pnpm
    --filter @kovojs/site test`, and `git diff --check` passed. Keep open for
    remaining class-based docs components, especially `chrome.tsx` and
    `landing.tsx`.
  - Current progress: tutorial authored component snippets now co-locate
    component styles with `@kovojs/style`, generated tutorial component
    artifacts were refreshed, and `rg -n "class=|style\\.attrs"
    site/tutorial/steps/*/src --glob '!**/generated/**' -S`, `pnpm --filter
    @kovojs/site test`, `pnpm exec vitest --run site/tutorial/steps`, and `git
    diff --check` passed. Keep open for remaining class-based docs site
    components.

## Verification

- [x] Add/extend a guard command that proves authored example source has no
      generated imports.
  - Evidence: `node scripts/import-boundary.mjs` passed. `pnpm exec vitest --run
    scripts/import-boundary.test.mjs` passed and covers static imports,
    re-exports, dynamic imports, explicit artifact tests, explicit generated
    fixtures, and ordinary-test rejection.
- [ ] Run focused Commerce tests after removing generated imports and deleting
      `source-truth.test.ts`.
  - Current progress: `pnpm --filter @kovojs/example-commerce exec vitest --run
    src/app.test.ts src/enhanced-navigation.test.ts` passed after route-module
    imports moved behind generated fixtures and generated route artifacts were
    refreshed for `stylesheet(...)` declarations.
- [ ] Run focused CRM and StackOverflow tests after applying the same boundary.
  - Current progress: `pnpm --filter @kovojs/example-crm exec vitest --run
    src/optimistic.test.ts src/interactive-app.test.ts src/graph.test.ts` and
    `pnpm --filter @kovojs/example-stackoverflow exec vitest --run
    src/interactive-app.test.ts` passed after direct generated route imports
    moved behind generated fixtures.
- [x] Run `emit-components -- --check` and `emit-graph -- --check` for each
      migrated example.
  - Evidence: `pnpm --filter @kovojs/example-commerce run emit-components --
    --check`, `pnpm --filter @kovojs/example-commerce run emit-graph --
    --check`, `pnpm --filter @kovojs/example-crm run emit-components --
    --check`, `pnpm --filter @kovojs/example-crm run emit-graph -- --check`,
    `pnpm --filter @kovojs/example-stackoverflow run emit-components --
    --check`, and `pnpm --filter @kovojs/example-stackoverflow run emit-graph
    -- --check` passed after refreshing generated route artifacts. Gallery's
    equivalent `pnpm --filter @kovojs/example-gallery run
    emit:interactive-gallery -- --check` also passed.
- [ ] Run `pnpm run check` and `git diff --check` before closing the plan.
