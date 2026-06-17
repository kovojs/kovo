# Better examples — showcase `@kovojs/ui` (polished light SaaS look)

## Context

The three embedded demo apps — `examples/commerce`, `examples/crm`, `examples/stackoverflow` —
are Kovo's public showcase (the docs site embeds each one live beside its source via
`site/src/examples.ts`). They look amateur today because:

- **None use `@kovojs/ui`.** Each hand-rolls an incomplete Tailwind-subset utility CSS in
  `examples/<app>/src/styles.css` and writes raw `<article class="rounded border …">` markup. The
  framework ships ~43 production, accessible, styled components (`@kovojs/ui`) and a complete
  shadcn-style token sheet — the examples ignore all of it.
- **The data models are too thin to look real.** `examples/commerce/src/schema.ts` `products` is
  just `{ id, stock, unitPrice }`, so cards render `p2 — 5 in stock` (no name, image, price,
  category). CRM/SO are richer but still placeholder-ish.
- **No design system:** flat, no elevation, arbitrary spacing, weak hover/focus states, minimal
  brand identity.

**Goal:** redesign all three apps to look like polished, modern light SaaS products by **depending
on and importing `@kovojs/ui` directly** and enriching their data — turning the examples into a real
showcase of the component library.

## Decisions (locked)

- **Consumption = direct dependency.** Examples add `"@kovojs/ui": "workspace:*"` and
  `import { Button } from '@kovojs/ui/button'`. Requires framework work (Part A); critical path.
  Aligns implementation with **SPEC §6.1.1** ("@kovojs/ui declares `kovo-ui-`"); the current
  `vendoredSource`-only manifest (no prefix) is the deviation. (`kovo add` copy-in stays supported.)
- **Theming = built-in component look + light per-app overrides.** Keep components' default styling;
  drop `kovoUiTokenSheetCss` into each app for page-chrome tokens; override accent/spacing per app via
  typed `style`/`styles` props. Do **not** refactor the ~43 component sources to read the token sheet.
- **Scope = all three apps.** **Data = enrich `schema.ts` + seed/fixtures.** **Aesthetic = polished light SaaS.**

## Established facts (verified)

- App-source CSS extraction is wired: `packages/compiler/src/style.ts` (`extractKovoStyles`) →
  `compile.ts` emits per-component `.css` assets → linked by `packages/server/src/vite-build.ts` +
  `vite-manifest.ts` + `hints.ts`.
- **Gap:** no pass extracts an imported `node_modules` component's `style.create` CSS today; examples
  compile app `src/**` via per-example codegen scripts and discard package CSS. So `import { Button }`
  currently yields `kv-*` class names with **no CSS served**.
- Atomic class names are content/namespace-deterministic and `@kovojs/ui` pins `{ namespace, source }`
  (e.g. `button.tsx`), so CSS extracted by a separate pass matches the classes the component's runtime
  `style.attrs` emits — this makes Part A viable.
- Prefix is safe/additive: `packages/compiler/src/validate/package-prefixes.ts` exempts `@kovojs/*`
  from the `kovo-*` reservation; `kovo-ui-` matches the pattern; `kovo add` only asserts `vendoredSource`.
- Theme: `kovoUiTokenSheetCss` (`packages/headless-ui/src/lib/token-sheet.ts`) emits `:root` light +
  `[data-theme="dark"]` blocks plus `--color-*`/`--radius-*` aliases.
- Regenerate derived artifacts via `examples/<app>/scripts/emit-components.mjs` (commerce) +
  `emit-graph.mjs` after schema/component edits.

---

## Part A — Framework enablement (critical path; do first)

Make `import { Button } from '@kovojs/ui/button'` render correctly-styled in a built example page.

**Scope = styling-only first cut.** Serves CSS for imported package components; does NOT rewrite
`<Button>` into `kovo-ui-` hosts or stamp `kovo-c`/behavior attributes (no package-component
host-lowering exists for any package today; SPEC §6.1.1 describes hosts nothing renders — a tracked
SPEC tension). Host-stamping is a separate follow-up.

- [ ] **A1. Declare the prefix.** `packages/ui/package.json`: `"kovo": { "vendoredSource": true }` →
      `"kovo": { "vendoredSource": true, "prefix": "kovo-ui-" }`. Cite SPEC §6.1.1.
- [ ] **A2. Package-CSS extraction pass.** New `packages/compiler/src/package-styles.ts` →
      `extractPackageComponentCss(packageName, manifestDir)`: enumerate `exports` `.tsx`, run
      `extractKovoStyles` per file, build `cssAssets` via `componentCssAssetForFile` (`css.ts`),
      `dedupeCss`.
- [ ] **A3. Resolution helper.** `packages/compiler/src/package-prefixes.ts`: export
      `resolvePackageDir` / promote `findPackageManifestPath` so A2 can locate package source.
- [ ] **A4. Link the package CSS.** Fold package `cssAssets` into `deriveAppGraph`
      (`packages/compiler/src/graph.ts`) so existing registry→server hint linking serves them; extend
      `CompileAppGraphResult`/options in `packages/compiler/src/types.ts`.
- [ ] **A5. Extractor-coverage gate (RISK MITIGATION — before Part B).** The conservative extractor
      bails to `null` on spreads/computed/non-static `style.create` → those render **silently
      unstyled**. Add a diagnostic for unhandled `style.create` in a `kovo.prefix` package, and
      confirm coverage for: Button, Card, Badge, Table, Field, Avatar, Separator, Alert, Dialog, Tabs,
      Skeleton. Fix/note gaps before redesign.
- [ ] **A6. Tests.** Compiler unit test: `extractPackageComponentCss` class names == `button.tsx`
      runtime `style.attrs` output. Build/export test on pilot app: package CSS asset emitted + linked.

**Pilot:** validate A1–A6 end-to-end on commerce before scaling to all three.

---

## Part B — Example redesign (after Part A; commerce → crm → stackoverflow)

Keep ALL existing Kovo behavior (queries, mutations, fragment targets, derived optimism, guards, i18n)
and existing tests green; change only data shape + presentation.

- [ ] **B1. Wire deps + theme.** Add `"@kovojs/ui": "workspace:*"` (+ `@kovojs/style` where needed).
      Replace hand-rolled `src/styles.css` with `kovoUiTokenSheetCss` (chrome tokens) + a small
      document-CSS layer for page shell/layout only (component CSS comes from Part A).
- [ ] **B2. Enrich data + seed.** Extend `schema.ts`, update `queries.ts` selects, refresh
      seed/fixtures; re-run `emit-components.mjs`/`emit-graph.mjs` to regenerate `src/generated/**` +
      `generated/optimistic/**` (artifacts, never hand-authored — SPEC §5.2). Cite SPEC §10.1/§4.8.
      - **commerce** `products`: add `name`, `description`, `imageUrl`/emoji, `category`; format price.
        Order history: join product name, format totals.
      - **crm**: richer contact (name, company, email, avatar initials), deal owner; mostly presentational.
      - **stackoverflow**: question author, tags, timestamps, body excerpt; answer author/accepted state.
- [ ] **B3. Rebuild pages from `@kovojs/ui`** (override via `style` props):
      - **commerce**: grid → `Card`+image+`Badge`+`Button`+`Field`(qty); cart badge → `Badge`; orders → `Table`.
      - **crm**: nav → `NavigationMenu`/`Tabs`; buckets → `Card`; pipeline → `Table`+`Badge`; forms → `Field`/`Button`/`Dialog`.
      - **stackoverflow**: list → `Card`/`Table`+vote `Button`+`Badge`(tags)+`Avatar`; composer → `Field`+`Button`.
      Keep page chrome (header/sidebar/container) as document CSS.
- [ ] **B4. Per-app polish.** Consistent spacing/elevation/type scale via token vars + light overrides;
      real hover/focus/disabled states; a small brand accent per app.

---

## Risks

- **Extractor coverage (med-high).** Complex components may emit no CSS silently. Gate A5; fallback =
  `kovo add` copy-in for the few that don't extract.
- **Determinism (med).** Needs every used component to pin `namespace`+`source`; verify in A5.
- **Core/api-surface churn (med).** A4/A5 touch core graph types; `check:api-surface` baseline updates deliberately.
- **SPEC host-stamping gap (scope).** First cut styles `<Button>` without `kovo-ui-` hosts; tracked follow-up + SPEC reconciliation.
- **Generated-artifact drift.** Re-run `emit-*`; keep fixpoint/conformance (`check:kovo`, conformance) green.

## Verification

- Part A: compiler unit test (A6) + pilot build/export test (asset emitted+linked);
  `pnpm run check`, `check:api-surface`, `check:build`.
- Part B: existing suites green (`examples/commerce/src/app.rendering.test.ts`, `app.add-to-cart.test.ts`,
  `app-shell.test.ts`); `vp test` per example; `pnpm run check:kovo` + `test:conformance` after regen.
- Visual: `pnpm run docs:serve` → inspect `/examples/<name>/`.
- Commit at checkpoints: A1–A6, then one commit per redesigned app.
