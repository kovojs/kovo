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

- [ ] Update `SPEC.md` §5.2 to strongly discourage direct imports from generated
      app artifacts, especially from app-authored modules.
  - Proposed wording: "Generated artifacts are reviewable outputs, not app
    dependencies. App-authored modules MUST NOT import app-local generated
    modules such as `src/generated/*`; tests and scripts SHOULD prefer authored
    entry points and public explain/check APIs. Direct generated reads are
    reserved for compiler/build internals, emit freshness checks, and explicitly
    named artifact tests."
- [ ] Clarify `SPEC.md` §9.5 so app-facing dev/build config points at an authored
      app entry, not a lowered route artifact.
  - Proposed behavior: Vite/dev integration loads `/src/app.tsx` or the configured
    authored entry; compiler-owned plugins resolve route IR, live-target
    registries, and generated client modules internally.
- [ ] Add a public Vite plugin API with an explicit authored app entry.
  - Target API:
    `plugins: [kovo({ app: '/src/app.tsx' })]` from `@kovojs/server/vite`.
  - `app` is required, must not point into `src/generated/*`, and the module must
    default-export a `KovoApp`. Do not add `exportName`, `moduleId`, or
    `nodeHandlerExportName` to the app-facing API.
- [ ] Add an app/route-level stylesheet declaration API so styles are render
      metadata, not Vite config.
  - Target API: `stylesheet('./styles.css', { theme })`,
    `stylesheet({ theme })` for theme-only CSS, and `stylesheet('./styles.css')`
    for authored global CSS without a theme.
  - Local stylesheet declarations derive a public asset href by default; `href`
    remains an optional override for custom emitted URLs.
- [ ] Add a no-generated-import guard for app-authored source.
  - Scope: fail on `from './generated/*'`, `from '../generated/*'`, or dynamic
    generated imports outside `src/generated/**`, `scripts/**`, compiler-owned
    build helpers, and explicit artifact tests.
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
- [ ] Delete `examples/commerce/src/source-truth.test.ts`.
  - Rationale: reading `src/generated/graph.json` from an example test is not a
    useful app-author DevX signal. Graph correctness should live in compiler/CLI
    package tests and explicit generated graph checks.
- [ ] Move any remaining Commerce graph-smoke value into package-level coverage
      or a CLI/explain test that does not require app tests to know the generated
      file path.
- [ ] Update Commerce Vite config to reference the authored entry only.
  - Target authoring shape:
    `plugins: [kovo({ app: '/src/app.tsx' })]`, with any demo-only conditional
    outside the `kovo()` API. No `moduleId: '/src/generated/app.kovo-route.tsx'`
    in `examples/commerce/vite.config.ts`.
- [ ] Remove authored CSS imports of app-local generated CSS.
  - Target authoring shape: no `@import './generated/kovo-ui.css'` in
    `examples/commerce/src/styles.css`; the build/dev pipeline injects or
    expands framework/UI CSS from public stylesheet/theme declarations.

## CRM And StackOverflow

- [ ] Apply the same test/helper boundary to CRM and StackOverflow.
  - Scenario tests import authored entries or public helper factories, not
    `src/generated/*`.
- [ ] Update CRM and StackOverflow Vite configs to reference authored app entries
      only.
- [ ] Remove authored CSS imports of app-local generated CSS from CRM and
      StackOverflow.
- [ ] Audit public demo modules that export generated graph/optimistic artifacts.
  - Decision needed: either keep them behind explicitly named artifact exports or
    move them to package/conformance coverage so the public demo surface stays
    authored-first.

## Vite Config Simplification

- [ ] Add an app-facing Kovo Vite plugin so example configs do not manually
      `ssrLoadModule('@kovojs/server')`.
  - Candidate API:
    `kovo({ app: '/src/app.tsx' })`.
- [ ] Keep `kovo()` explicit: no default app discovery.
  - The app entry is required so the config remains readable and there is no
    hidden convention around `src/app.tsx`.
- [ ] Enforce default-export-only app modules for the public Vite plugin.
  - If the app module does not default-export a `KovoApp`, fail with a teaching
    diagnostic. Do not add an `exportName` option.
- [ ] Keep demo-only plugin disabling outside the public Kovo plugin API.
  - Example shape:
    `plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [kovo({ app: '/src/app.tsx' })]`.
- [ ] Keep styles out of Vite config.
  - Styles are app/route render metadata declared through `stylesheet(...)`;
    Vite materializes declared assets but does not own style semantics.
- [ ] Move repeated Vite dev server type aliases and plugin-loader wrappers into
      framework code or a shared examples helper.
- [ ] Preserve `vite-plus` task inputs without hand-maintaining broad boilerplate
      in every example config.
  - Do not overload `kovo()` with `serve`/task options unless a separate
    vite-plus-specific helper is introduced.

## Stylesheet API

- [ ] Add `stylesheet()` as the authored declaration for local, external, and
      theme-only styles.
  - Local authored CSS: `stylesheet('./styles.css')`.
  - Local authored CSS plus theme: `stylesheet('./styles.css', { theme })`.
  - Theme-only: `stylesheet({ theme })`.
  - External CSS: `stylesheet('https://cdn.example.com/reset.css')`.
- [ ] Let local declarations derive their public URL.
  - `stylesheet('./styles.css')` should emit/link `/assets/styles.css` unless
    overridden with `href`.
- [ ] Make emitted stylesheet assets aggregate compiler-owned CSS.
  - The emitted asset should contain declared theme CSS, authored global CSS when
    present, generated `@kovojs/ui` CSS used by the app graph, and generated
    `@kovojs/style` atomic CSS used by authored style objects.
- [ ] Allow app-wide and route-level stylesheet declarations.
  - App-level stylesheets are inherited by routes; route-level stylesheets can
    add page-specific CSS while remaining visible to page hints, fragments,
    static export, and `kovo explain page`.

## Docs Site

- [ ] Migrate the docs site to the same authored styling format as the examples.
  - Component-specific styles should live next to the component that owns them,
    authored JSX should use `style={styles.foo}` / `style={[...]}`, and
    `style.attrs(...)` should remain a low-level runtime or package-internal
    escape hatch rather than the app-author-facing pattern.

## Verification

- [ ] Add/extend a guard command that proves authored example source has no
      generated imports.
- [ ] Run focused Commerce tests after removing generated imports and deleting
      `source-truth.test.ts`.
- [ ] Run focused CRM and StackOverflow tests after applying the same boundary.
- [ ] Run `emit-components -- --check` and `emit-graph -- --check` for each
      migrated example.
- [ ] Run `pnpm run check` and `git diff --check` before closing the plan.
