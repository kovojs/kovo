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

- [x] **A1. Declare the prefix.** `packages/ui/package.json` now declares `"prefix": "kovo-ui-"`
      alongside `vendoredSource`. Verified KV234-safe (`@kovojs/*` exempt from the reservation).
- [x] **A2. Package-CSS extraction pass.** `packages/compiler/src/package-styles.ts` →
      `extractPackageComponentCss`: enumerates `exports` `.tsx`, runs `extractKovoStyles`, dedupes,
      and normalizes to browser-valid CSS (px on bare lengths, valid `@layer` idents, drops
      nesting-`&` rules). Evidence: `package-styles.test.ts`.
- [x] **A3. Resolution helper.** `resolvePackageManifestPath` exported from `package-prefixes.ts`.
- [x] **A4. Link the package CSS.** Took the lower-risk route: example `emit-ui-css.mjs` writes
      `src/generated/kovo-ui.css` (token sheet + component CSS), `@import`-ed by `styles.css` so the
      existing `/assets/styles.css` serves it (no core `deriveAppGraph`/api-surface churn). Also
      enhanced the shared extractor (`style.ts`) to resolve module-local const-object spreads
      (fixes `field.tsx`); 189 style/ui snapshot tests still green. Evidence: `vp build` emits a
      67 kB lightningcss-clean `dist/assets/styles.css` with `kv-*`.
- [x] **A5. Extractor-coverage gate.** `extractPackageComponentCss` emits a per-file diagnostic when
      `style.create` yields no CSS. Coverage = **43/45**; only `progress.tsx` / `skeleton.tsx`
      (keyframes-by-identifier) remain — documented; examples must avoid animated Progress/Skeleton.
- [x] **A6. Tests.** `package-styles.test.ts` asserts core namespaces + browser-valid output + the
      coverage gate. Compiler suite green (348); api-surface clean.

**Pilot:** A1–A6 validated end-to-end on commerce.

> **Latent @kovojs/style gaps found (tracked upstream fixes):** the StyleX engine emits unitless
> numeric lengths and digit-leading `@layer` sub-names — invalid CSS that never surfaced because no
> app had served @kovojs/ui's CSS. Normalized in the served text only (class hashes unchanged); the
> proper fix belongs in `@kovojs/style` emit (snapshot churn) — deferred. Likewise `table.tsx`'s
> `[&_tr:last-child]` is unsupported StyleX syntax (component-authoring fix).

---

## Part B — Example redesign (after Part A; commerce → crm → stackoverflow)

Keep ALL existing Kovo behavior (queries, mutations, fragment targets, derived optimism, guards, i18n)
and existing tests green; change only data shape + presentation.

Pattern proven on commerce: import `@kovojs/ui` components and render them with `.definition.render(props)`
(the JSX runtime only renders functions, so `<Button>`-as-tag does not work; the gallery uses the same
`.definition.render` pattern). The `kv-*` classes are styled by Part A's generated stylesheet.

**commerce (pilot — product grid done):**
- [x] **B1 (commerce).** Added `@kovojs/ui` + `@kovojs/style` deps (+ `@kovojs/headless-ui` devDep for
      the token sheet); `styles.css` `@import`s `generated/kovo-ui.css`.
- [x] **B2 (commerce products).** `products` gained `name`/`category`/`emoji` (defaulted, so cart/add
      optimism + fixtures unaffected) + a real seed catalog; `productGridQuery` selects them; IR/graph
      regenerated; query/source-truth/render fixtures updated. All 55 commerce tests pass.
- [x] **B3 (commerce product grid).** Card + Badge (category + stock-aware) + Button via
      `.definition.render`, formatted price, keyed `<article>` host + mutation form intact.
- [ ] **B3 (commerce remainder).** cart-badge → keep reactive `cart.count` binding (can't wrap a
      data-bind in `.definition.render`), restyle as a token pill; order-history → `Table` (updates
      the `'order-1': 'p1 x 2 - 2998'` keyvalue fixtures).
- [ ] **B4 (commerce).** Page-chrome polish: grid layout, spacing/elevation via token vars.

**crm (not started):** B1 deps+theme · B2 richer contacts/deals · B3 nav→`Tabs`, buckets→`Card`,
pipeline→`Table`+`Badge`, forms→`Field`/`Button`/`Dialog` · B4 polish.

**stackoverflow (not started):** B1 deps+theme · B2 authors/tags/timestamps · B3 list→`Card`/`Table`
+vote `Button`+`Badge`+`Avatar`, composer→`Field`/`Button` · B4 polish.

> Recommended: fan out crm + stackoverflow as parallel sub-agents now that the commerce pattern
> (dep wiring + `emit-ui-css` + `.definition.render` + fixture-update discipline) is proven.

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
