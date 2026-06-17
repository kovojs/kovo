# Plan: Material Design 3 theming for `@kovojs/ui`

**Status:** Superseded by `plans/theming-codex.md` on 2026-06-17. Keep this file as historical
design context only; do not use it as the active implementation ledger.
**Design:** `docs/material-theming-spike.md` (decisions in §8).
**Goal:** Set a seed color in one place → generate the full M3 token set (build time) → every
`@kovojs/ui` component themes coherently, light and dark.

**Supersession note:** `plans/theming-codex.md` keeps this plan's useful details — build-time-only
v1, M3 role names, variant/contrast knobs, known-output tests, token-sheet alias decision,
accessibility proof, image-seed deferral, and a post-migration hex-literal gate — but uses the
correct critical path for Kovo: first add public `@kovojs/style/material` tokens and compiler support
for `defineVars`/`createTheme` extraction plus imported token references. That compiler work is
required before `@kovojs/ui` can safely migrate from hardcoded hex to typed `tokens.*`.

**Locked decisions:** M3 token names verbatim · build-time only (no client color math) · vendor a
trimmed engine as `@kovojs/color` · `themeFromSeed(seed, { variant='tonal-spot', contrast })` public
knobs · image-seed lowest priority.

**Architecture (one line):** `themeFromSeed` (build) → M3 system tokens emitted to `:root` /
`:root[data-theme="dark"]` → typed `defineVars` `tokens` object → components bind `tokens.*` instead
of hardcoded hex.

---

## Phase 0 — Color engine (`@kovojs/color`)

- [ ] Vendor a trimmed material-color-utilities into `packages/color/`: keep `hct/`, `palettes/`,
      `dynamiccolor/` (DynamicScheme + MaterialDynamicColors + variants), `utils/`
      (color/math/string); drop legacy `scheme/`, `temperature/`, `dislike/`, `blend/` (add `blend/`
      back only if harmonized custom brand colors are wanted). Preserve Apache-2.0 headers + add NOTICE.
- [ ] Expose one stable public function `themeFromSeed(seed, { variant?, contrast? }): KovoTheme`
      returning reference palettes + light/dark **system-token maps** (hex strings). Keep engine
      internals private per `rules/api-surface.md`; update `api-surface-baseline.json`.
- [ ] Guarantee determinism: no `Date.now`/random; pure given (seed, variant, contrast) so emitted
      CSS is reproducible and fixpoint/render-equivalence gates stay sound.
- [ ] Unit-test against known M3 outputs (e.g. seed `#6750A4` → `primary` tone-40, `on-primary`,
      `surface-container-high` exact hex). _Evidence: name the test file + command._

## Phase 1 — M3 system-token contract

- [ ] Regenerate `headless-ui/.../token-sheet.ts` from a default seed using **M3 role names**
      (`primary`, `on-primary`, `primary-container`, `surface`, `surface-container-*`, `on-surface`,
      `outline`, `error`, …). Keep the existing emit machinery (`renderTokenBlock`, `:root` +
      `:root[data-theme="dark"]`).
- [ ] Decide + implement `--color-*` document-alias compatibility layer (keep app-CSS aliases vs drop).
      _Sub-question carried from spike §8.1._
- [ ] Assert `kovoUiTokenSheetCss` shape preserved (light `:root` block + dark `[data-theme]` block,
      document aliases). _Evidence: `token-sheet.test.ts`._

## Phase 2 — Typed token refs + component rewire (the bulk of the work)

- [ ] Emit a typed `tokens` object via `style.defineVars` so components write
      `tokens.surfaceContainerHigh` (typed `var(--kovo-…)`).
- [ ] Codemod the **97 `@kovojs/ui` components** from hardcoded hex → `tokens.*`. Fan out per
      component family (button/card/badge, overlays, form controls, nav, …) per CLAUDE.md parallel-slice
      guidance; each slice owns its files + refreshes its `*.stylex.test.tsx` snapshot.
      _Baseline today: 0 of 97 components reference any token var._
- [ ] Verify no hex literals remain in `packages/ui/src/*.tsx` (grep gate) and snapshots are coherent
      across light/dark. _Evidence: grep result + `*.stylex.test.tsx` run._

## Phase 3 — Multi-theme + docs

- [ ] `createTheme(tokens, themeFromSeed(otherSeed))` example: a second brand / high-contrast theme
      applied to a subtree with no component changes.
- [ ] Update `site/content/guides/styling.md` with the seed → tokens → components story + the
      `createTheme` example; cross-link the spike.

## Phase 4 — A11y + later

- [ ] Assert `on-*` roles clear WCAG against their pairs using the DynamicScheme contrast knob; record
      under `rules/accessibility-conformance.md` (net win vs today's unguaranteed hex).
- [ ] (Lowest priority) image-seed: `sourceColorFromImage` via quantizer+score, behind build-time API.
- [ ] (Deferred, out of v1) runtime "Material You" opt-in island shipping the trimmed engine.

---

## Risks / proving

- **The 97-component rewrite is the real cost**, not the color math — keep it a mechanical codemod +
  snapshot diff, fanned out.
- **Proving commands** (fill in exact invocations when slices land): `@kovojs/color` unit tests ·
  `token-sheet.test.ts` · per-family `*.stylex.test.tsx` · hex-literal grep gate · api-surface check.
- Do not mark a checkbox `[x]` until the same session verifies cited test/command/file evidence for
  the exact claim (CLAUDE.md progress discipline).
