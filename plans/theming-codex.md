# Seed theming — typed tokens + generated UI themes

## Context

Kovo's styled UI components currently hard-code neutral palettes directly in their
`style.create(...)` objects (`packages/ui/src/button.tsx`, `card.tsx`, `badge.tsx`, etc.). That
works for a default look, but it fails the design-system goal: an app author cannot change one
theme definition and have every copied or workspace UI component follow it.

The desired direction is Material Design 3 style theming:

- generate a coherent light/dark color system from one seed color;
- expose **reference tokens** (tonal palettes) and **system tokens** (roles such as `primary`,
  `onPrimary`, `surface`, `outline`, `errorContainer`);
- let Kovo UI components reference semantic tokens rather than literal colors;
- preserve Kovo's StyleX-first extraction and light-DOM/no-shadow CSS-variable model from
  `SPEC.md` §3.1 and §13.1.

Material's official generator already exists: `@material/material-color-utilities` / the
`material-foundation/material-color-utilities` repo. The TypeScript package exposes HCT, tonal
palettes, `themeFromSourceColor`, light/dark schemes, custom color harmonization, and CSS variable
helpers. It is Apache-2.0 and published as `@material/material-color-utilities`.

## Decisions (locked)

- **Choose the better path: typed public tokens, not literal `var(...)` strings everywhere.** Kovo
  should expose a typed theme token layer and teach the compiler to extract token/theme rules and
  imported token references. The fast path of hand-writing `var(--kovo-theme-...)` strings in every
  UI component is rejected except as an interim migration escape.
- **Build-time only for v1.** Seed colors lower to static CSS custom properties during build/codegen.
  Runtime "Material You" color math is a later opt-in island, not part of the default client runtime.
- **Use M3 role names verbatim for the system-token contract.** Prefer role names such as `primary`,
  `on-primary`, `primary-container`, `surface-container-high`, `outline-variant`, and
  `error-container` at the CSS/token boundary so Kovo can reuse Material role mapping guidance.
- **Public surface lives on root `@kovojs/style`.** `@kovojs/ui` is private/copy-in; copied
  components need imports that resolve against public packages. Because nearly every app that uses
  `style.create(...)` will also define a theme, export `defineTheme`, `themeFromSeed`, and `tokens`
  from the root style package. Keep algorithm/private helpers internal rather than making authors
  discover a secondary subpath for the common path.
- **Use Material Color Utilities as a dependency first.** Do not vendor until there is a proven
  supply-chain, bundle-size, or API-stability reason. Keep Kovo's public API as a small adapter so a
  future vendor swap is contained.
- **Token CSS is document CSS.** Theme variables are ordinary custom properties on `:root`,
  `[data-theme="dark"]`, or a theme class. Components stay light DOM and StyleX-authored, per
  `SPEC.md` §3.1/§13.1.
- **System tokens are the UI contract.** Components should use system roles (`primary`,
  `onPrimary`, `surfaceContainerLow`, `outlineVariant`, `errorContainer`) first. Component-specific
  tokens are allowed only where a repeated UI need does not map cleanly to Material roles.
- **Scheme variant and contrast are public seed-generation knobs.** Default to Material's
  `tonal-spot` style unless upstream API evidence points elsewhere; expose contrast as the a11y
  lever rather than baking one contrast level into Kovo.
- **The v1 ergonomic API is single-theme and declarative.** The app-facing path is
  `defineTheme({ seed, shape, colors })`; do not add a multiple-theme registry in the first
  implementation slice. The API is Kovo theming; Material is the color-generation implementation
  detail.
- **Precise overrides use composition, not callbacks.** `defineTheme({ base, sys, component })` is
  the extension shape: authors can create a generated base theme, then define one derived
  theme using values from `base.sys`, `base.ref`, or `base.custom`. Avoid a special
  `override({ sys, ref, custom, tone })` callback unless the base form proves insufficient.
- **Custom semantic colors are generated, not ad hoc.** Non-core roles such as success/warning use
  Material custom color groups with harmonization (`blend: true`) rather than manually selected
  green/yellow literals.
- **No runtime global theme store.** Theme selection is CSS class/attribute/stylesheet state. A
  no-flash script or server-selected attribute is app chrome, not a core client graph.
- **Image seed is deferred/lowest priority.** Build-time image seed extraction can be added later
  behind the same Kovo API, but the core v1 path is explicit seed color input.

## Established facts (verified during design exploration)

- `@kovojs/style` already has `defineVars` and `createTheme` helpers, but compiler extraction does
  not yet collect their `__rules`.
- `packages/compiler/src/style.ts` currently extracts only same-file static `style.create(...)`
  literals and primitive values. It does not resolve imported token objects such as
  `tokens.primary`.
- `site/content/guides/styling.md` already documents the intended split: StyleX for component atoms,
  plain document CSS for page chrome and CSS custom-property themes.
- `@kovojs/ui` is private and copy-in oriented; copied components import only public packages.
- The Material Color Utilities TypeScript package provides `themeFromSourceColor`, `CorePalette`,
  `TonalPalette`, `Scheme`, HCT helpers, custom colors, and an `applyTheme` CSS-variable helper.

---

## Part A — Public theme token API

- [x] **A1. Export theme APIs from root `@kovojs/style`.** Add `defineTheme`, `themeFromSeed`,
      `tokens`, and their public types to `packages/style/src/index.ts`; update api-reference/docs
      so the root package remains documented. Do not re-export the full Material package.
  - Evidence: `packages/style/src/index.ts` explicitly re-exports `defineTheme`,
    `themeFromSeed`, `tokens`, and public Kovo-owned theme types from
    `packages/style/src/theme.ts`; `node site/scripts/api-ref.mjs && node
    site/scripts/api-examples-check.mjs` passes with
    `api-ref/v1 packages=8 exports=641 documented=465`.
- [x] **A2. Add the Material Color Utilities dependency.** Declare
      `@material/material-color-utilities` as a real dependency of `@kovojs/style`; pin the version
      range deliberately and record Apache-2.0 in the dependency/license review notes if such a
      ledger exists.
  - Evidence: `packages/style/package.json` declares
    `@material/material-color-utilities` as a dependency pinned to `^0.3.0`;
    `corepack pnpm view @material/material-color-utilities version license --json`
    reported Apache-2.0. Version `0.4.0` was not used because its root ESM import
    currently fails in Node on an extensionless generated internal import.
- [x] **A3. Define the token model.** Add typed reference tokens, system color tokens, and custom
      color token groups. Include light/dark schemes and a stable CSS variable naming convention
      such as `--kovo-theme-ref-palette-primary-40` and `--kovo-theme-sys-color-primary`.
  - Evidence: `packages/style/src/theme.ts` defines typed reference palettes,
    system color roles, shape tokens, custom color groups, and the exported
    `tokens` object. `packages/style/src/index.test.ts` asserts token refs such
    as `var(--kovo-theme-sys-color-primary)` and
    `var(--kovo-theme-ref-palette-primary-40)`.
- [ ] **A4. Implement seed generation.** Add `themeFromSeed(seed, options)` supporting
      hex/ARGB input, light/dark output, `variant`, `contrast`, and custom colors with optional
      harmonization. Keep the Kovo return shape independent from upstream class shapes.
  - Partial evidence: `packages/style/src/theme.ts` implements hex/ARGB seed
    generation, light/dark values, `tonal-spot` and `content` variants, custom
    colors with optional harmonization, and Kovo-owned return types. Gap:
    nonzero `contrast` currently fails loudly instead of silently no-oping because
    the Node-safe Material package version does not expose the newer dynamic
    contrast schemes.
- [x] **A5. Add the ergonomic single-theme API.** Implement `defineTheme({ seed, shape,
colors, variant?, contrast? })` as the common app-facing entry point. It should return the
      theme object/assets Kovo needs without requiring authors to manually call a separate
      CSS-emission function in the common path.
  - Evidence: `packages/style/src/theme.ts` implements `defineTheme({ seed })`
    by returning a `KovoTheme` with generated `css`, `ref`, `sys`, `light`,
    `dark`, and `custom` values; `packages/style/src/index.test.ts` exercises
    `defineTheme({ seed: '#6750A4' })`.
- [x] **A6. Implement CSS emission behind the ergonomic API.** Add deterministic internal/lower-level
      emission such that `defineTheme(...)` can emit `:root`, dark selector/class blocks,
      and optional reference-palette variables. Output must be stable enough for snapshots.
  - Evidence: `packages/style/src/theme.ts` emits deterministic `:root` and
    `:root[data-theme="dark"]` blocks with reference palette, system color,
    shape, custom, and component variables. `packages/style/src/index.test.ts`
    pins exact `#6750A4` values and CSS variable names.
- [x] **A7. Add the `base` composition form.** Support `defineTheme({ base, sys?,
component?, shape?, colors? })` so app authors can derive one final theme from seed-generated
      values without an override callback. Evidence should include a test where border color/radius
      derive from a generated base theme.
  - Evidence: `packages/style/src/theme.ts` implements the `base` form, and
    `packages/style/src/index.test.ts` derives `outline`, `cornerSmall`, and a
    component border token from `base.sys.color.primary`.
- [x] **A8. Decide current token-sheet alias compatibility.** Inspect
      `packages/headless-ui/src/lib/token-sheet.ts` and decide whether the M3 sheet preserves
      existing document aliases such as `--color-*` / `@theme inline`, replaces them, or emits both
      during a migration window. Evidence: token-sheet test updates.
  - Evidence: `packages/headless-ui/src/lib/token-sheet.ts` now preserves
    `@theme inline`, `--color-*`, and `--radius-*` aliases while remapping
    legacy `--kovo-*` tokens to `--kovo-theme-sys-*`. Verification:
    `corepack pnpm exec vitest run packages/headless-ui/src/lib/token-sheet.test.ts`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`;
    `git diff --check`.
- [x] **A9. Type-level and unit tests.** Assert token names, generated CSS variable names,
      light/dark role presence, custom-color groups, deterministic output, and exact known outputs
      for a canonical seed such as `#6750A4`.
  - Evidence: `packages/style/src/index.test.ts` pins public token var names,
    exact `#6750A4` generated values, custom color groups, CSS variable names,
    `base` composition, unsupported contrast behavior, and generated on-role
    contrast pairs. Verification: `corepack pnpm --filter @kovojs/style test`;
    `corepack pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
- [x] **A10. Keep callback overrides out of v1.** Document in JSDoc/design notes that derived themes
      should use the `base` form; do not expose a placeholder callback option.
  - Evidence: `packages/style/src/theme.ts` exposes only seed and `base` object
    forms in `DefineThemeOptions`; its `defineTheme` JSDoc names `base` as the
    derivation path, and no callback override type or placeholder is exported.

## Part B — Compiler support for typed tokens/themes

- [x] **B1. Extract `style.defineVars(...)` rules.** Extend the StyleX extraction environment so
      variable declarations contribute CSS rules to component/package CSS assets, not just runtime
      objects.
  - Evidence: `corepack pnpm exec vitest --run packages/compiler/src/style.test.ts
    packages/compiler/src/package-styles.test.ts` passes; `style.test.ts` asserts same-file
    `style.defineVars(...)` emits `:root` custom-property CSS and style-rule provenance.
- [x] **B2. Extract `style.createTheme(...)` rules.** Ensure theme override classes/attributes emit
      custom-property CSS and carry provenance in CSS manifests.
  - Evidence: `corepack pnpm exec vitest --run packages/compiler/src/style.test.ts
    packages/compiler/src/package-styles.test.ts` passes; `style.test.ts` asserts same-file
    `style.createTheme(...)` emits theme override CSS and manifest provenance.
- [x] **B3. Resolve token references in `style.create(...)`.** Teach the static style object resolver
      to fold module-local and imported token values that are known `defineVars`/Material token
      exports, so UI code can say `color: tokens.sys.color.onPrimary` instead of a raw string.
  - Evidence: `corepack pnpm exec vitest --run packages/compiler/src/style.test.ts
    packages/compiler/src/package-styles.test.ts` passes; `style.test.ts` asserts
    `tokens.sys.color.primary`, `tokens.sys.shape.cornerMedium`, and
    `style.tokens.sys.color.onPrimary` imported from root `@kovojs/style` lower
    into atomic CSS. It also proves a bounded same-package static adapter import
    (`./theme.js`) can resolve public token aliases for package component CSS.
- [ ] **B4. Add diagnostics for unresolved token expressions.** If a component style references a
      token-like expression the extractor cannot prove static, emit a clear diagnostic rather than
      silently dropping CSS.
- [ ] **B5. Tests for cross-file and package extraction.** Cover app-local tokens, imported public
      Material tokens, package component CSS extraction, theme class CSS, and failure diagnostics.
  - Partial evidence: `packages/compiler/src/style.test.ts` covers same-file
    vars/themes, root public token imports, and one-level same-package static
    token adapters; `packages/compiler/src/package-styles.test.ts` proves
    `@kovojs/ui` package CSS extraction still emits migrated component CSS. Gap:
    leave open until B4 has a dedicated unresolved token diagnostic test.

## Part C — UI component migration

- [x] **C1. Add a shared UI theme/token module.** Create the Kovo UI token adapter used by copied
      components, importing root `@kovojs/style` theme exports and exporting typed token aliases for
      component authors where a local alias improves readability.
  - Evidence: `packages/ui/src/theme.ts` now re-exports local semantic aliases over
    `@kovojs/style` `tokens` for StyleX-authored light-DOM components per `SPEC.md` §13.1.
- [x] **C2. Pilot migrate core display primitives.** Convert Button, Card, Badge, Alert, Kbd,
      Separator, Progress, Skeleton to system/custom tokens while preserving class snapshots except
      for expected value hashes.
  - Evidence: `packages/ui/src/{button,card,badge,alert,kbd,separator,progress,skeleton}.tsx`
    import `./theme.js` and use semantic theme tokens instead of hard-coded component color
    literals; `corepack pnpm exec vitest run packages/ui/src/button.stylex.test.tsx
    packages/ui/src/card.stylex.test.tsx packages/ui/src/badge.stylex.test.tsx
    packages/ui/src/alert.stylex.test.tsx packages/ui/src/kbd.stylex.test.tsx
    packages/ui/src/separator.stylex.test.tsx packages/ui/src/progress.stylex.test.tsx
    packages/ui/src/skeleton.stylex.test.tsx -u`, `corepack pnpm exec tsc -p tsconfig.json
    --noEmit --pretty false`, and `git diff --check` all pass.
- [ ] **C3. Migrate form controls.** Convert Checkbox, Switch, RadioGroup, Field, NumberField,
      Select, Combobox, Autocomplete, Slider, OTP, Meter to system tokens and state-specific roles.
- [ ] **C4. Migrate overlays/navigation.** Convert Dialog, AlertDialog, Drawer, Sheet, Popover,
      HoverCard, Tooltip, DropdownMenu, ContextMenu, Menubar, NavigationMenu, Command, Tabs,
      Toolbar, Accordion, Collapsible, Disclosure, Toast, Table, Avatar, Breadcrumb, ScrollArea.
- [ ] **C5. Keep override props author-last.** Verify all `style`/`styles` override surfaces still
      win by StyleX property merge order after token migration.
- [ ] **C6. Snapshot and visual smoke tests.** Refresh StyleX snapshots intentionally and add a
      small example/theme smoke proving one seed changes multiple component families.
- [ ] **C7. Add a hex-literal migration gate.** After the UI migration, add or document a grep/lint
      gate proving no component color hex literals remain except intentional non-color values or
      test fixtures.

## Part D — Copy-in and app ergonomics

- [ ] **D1. Update the UI registry.** Ensure copied components include any shared theme/token file
      they need, and that registry dependencies remain public (`@kovojs/style`,
      `@kovojs/headless-ui`, `@kovojs/core`, `@kovojs/server`).
- [ ] **D2. Add starter theme CSS wiring.** Update create-kovo/examples so a generated app has a
      seed theme stylesheet or generated `theme.ts` path from day one.
- [ ] **D3. Document theme selection.** Show server-selected light/dark, user-selected
      `[data-theme]`, and no-flash script placement without introducing a core runtime theme store.
- [ ] **D4. Add a seed-color recipe.** Document how an app changes one seed/custom-color list and
      regenerates or emits theme CSS for all UI components.
- [ ] **D5. Document derived themes with `base`.** Show the pattern:
      `const base = defineTheme({ seed }); export const theme = defineTheme({
base, sys: { color: { outline: base.sys.color.primary } } });` for apps that want precise
      token changes without a callback.

## Part E — SPEC, docs, and plan closure

- [x] **E1. Update `SPEC.md` §13.1.** Record that StyleX-authored component styles may reference
      compiler-known CSS custom-property tokens, and that theme tokens are document CSS.
  - Evidence: `SPEC.md` §13.1 now defines extracted StyleX/theme-token CSS as
    ordinary document CSS custom properties and names `--kovo-theme-ref-*` /
    `--kovo-theme-sys-*` variables; `git diff --check` passes.
- [x] **E2. Update styling docs.** Expand `site/content/guides/styling.md` with Material reference
      tokens, system tokens, seed generation, and the copy-in story.
  - Evidence: `site/content/guides/styling.md` documents `defineTheme`,
    generated reference/system variables, custom colors, `tokens`, and `base`
    composition. Verification: `node site/scripts/api-examples-check.mjs`;
    `corepack pnpm --filter @kovojs/site run build`.
- [ ] **E3. Update component docs.** Explain that `@kovojs/ui` components use system tokens by
      default and remain overrideable through `style`/`styles`.
- [x] **E4. API reference coverage.** Add public JSDoc for the new root `@kovojs/style` theme
      symbols and keep api-surface gates clean.
  - Evidence: public theme exports in `packages/style/src/theme.ts` have JSDoc
    and Kovo-owned public types; `node scripts/api-surface-gate.mjs && node
    site/scripts/api-ref.mjs && node site/scripts/api-examples-check.mjs` passes
    with `api-ref/v1 packages=8 exports=641 documented=465`.
- [x] **E5. Accessibility proof.** Add a focused conformance note/test for important `on-*` role
      foreground/background pairs using the generated contrast level, following
      `rules/accessibility-conformance.md`. Do not claim WCAG coverage without the cited evidence.
  - Evidence: `packages/style/src/index.test.ts` verifies canonical generated
    light and dark `on-*` foreground/background role pairs have contrast ratio
    at least 4.5, without making broader primitive accessibility claims.
    Verification: `corepack pnpm --filter @kovojs/style test`.

---

## Risks

- **Compiler static-resolution complexity (high).** Imported token references require enough
  module-resolution awareness to stay deterministic without building a general evaluator. Keep the
  accepted expression grammar intentionally narrow.
- **Package/copy-in boundary (high).** Copied UI components cannot depend on private `@kovojs/ui`
  files. Any shared theme module must either be copied with components or live in a public package.
- **Material upstream API drift (med).** Wrap upstream APIs behind Kovo types and snapshot generated
  output so drift is visible. Vendoring remains a later option if upstream churn or package policy
  becomes a real problem.
- **Snapshot churn (med).** Migrating colors to tokens changes atomic value hashes broadly. Do it in
  component-family slices with focused tests.
- **Success/warning semantics (med).** Material core roles do not include all app-semantic states.
  Use generated custom color groups and document the mapping.
- **CSS volume (low-med).** Emitting every reference palette tone can bloat CSS. Make reference-token
  emission configurable; system tokens should be the default.
- **Existing token-sheet compatibility (low-med).** Examples and page CSS may depend on today's
  `--color-*` aliases. Decide this explicitly before replacing `token-sheet.ts`.

## Verification

- Part A: `pnpm --filter @kovojs/style exec vitest run`; token-sheet tests if alias compatibility
  changes; api-surface gate for new root exports.
- Part B: compiler style extraction tests plus package-style extraction tests; `pnpm --filter
@kovojs/compiler exec vitest run src/style.test.ts src/package-styles.test.ts`.
- Part C: `pnpm --filter @kovojs/ui exec vitest run`; targeted snapshot review; hex-literal grep
  gate; example smoke with two seeds.
- Part D: UI copy-in smoke test; create-kovo starter test if theme files are generated there.
- Part E: `node site/scripts/api-ref.mjs`; `pnpm --filter @kovojs/site run check:links`;
  accessibility proof command/file; `pnpm run check:api-surface`.
- Final gate before closing checkboxes: `pnpm run check` plus the narrow commands named under each
  completed item.

## Checkpoint commits

- Commit A after the public theme API and tests.
- Commit B after compiler token/theme extraction and diagnostics.
- Commit C in component-family slices, not as one large UI migration.
- Commit D after registry/starter/doc ergonomics.
- Commit E after SPEC/docs/api-reference cleanup and final gates.
