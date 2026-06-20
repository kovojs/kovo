# Spike: Material Design 3 theming for `@kovojs/ui`

**Status:** Design exploration (no code yet)
**Author:** (handoff from design-space spike)
**Related:** `packages/style` (StyleX fork), `packages/headless-ui/src/lib/token-sheet.ts`, `packages/ui/*`
**Upstream:** [M3 design tokens](https://m3.material.io/foundations/design-tokens/overview), [material-color-utilities](https://github.com/material-foundation/material-color-utilities) (Apache-2.0)

---

## 1. Goal

One place to set a theme; every `@kovojs/ui` component updates. Specifically:

1. **Seed-color → full theme.** Give a single source color, generate the whole palette around it
   (Material's HCT / tonal-palette approach), including a coherent dark mode.
2. **Two-tier tokens** in Material's style: **reference tokens** (raw tonal palettes) lower into
   **system tokens** (semantic roles like `primary`, `on-surface`), which is what components consume.
3. Theming is a document-level concern (no per-component overrides required), consistent with Kovo's
   light-DOM / CSS-custom-property model.

## 2. Current state (the gap)

There are three relevant pieces today, and they are **not connected**:

| Piece                            | What it is                                                                                                                                                                                      | Theming role today                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@kovojs/style`                  | The Kovo-owned StyleX fork. Has `create`, **`defineVars`** (typed `var(--kovo-*)` refs), **`createTheme`** (override class), `defineConsts`.                                                    | The _mechanism_ for typed, themeable CSS variables. Already perfect substrate.                           |
| `headless-ui/.../token-sheet.ts` | A hand-authored **shadcn-style** semantic token set (`--kovo-color-primary`, `muted`, `accent`, `destructive`…) as light/dark **HSL** pairs, emitted to `:root` and `:root[data-theme="dark"]`. | A semantic token contract — but values are hand-tuned, single-accent, not seed-generated.                |
| `@kovojs/ui` (97 components)     | Styled components built on `style.create`.                                                                                                                                                      | **Hardcode hex** (`#0a0a0a`, `#ffffff`, `#f5f5f5`). `var(--…)` token references: **0 of 97 components.** |

So the "change a theme in one place" promise is currently **unmet**: the token sheet exists but no
component reads it, and components bake literal colors. This spike is greenfield — there are no
`Material`/`HCT`/`tonal`/`seed-color` references anywhere in `packages/` or `SPEC.md`.

The good news: the hard machinery (`defineVars`/`createTheme`, the light/dark `:root` emit pattern in
`token-sheet.ts`) already exists. The work is (a) a color engine, (b) an M3 token contract, and
(c) rewiring the 97 components to read tokens instead of hex.

## 3. Material's 3-tier token model (the part to adopt)

From the M3 design-tokens overview:

- **Reference tokens** — `md.ref.palette.primary40`. The raw material: 6 **tonal palettes**
  (primary, secondary, tertiary, neutral, neutral-variant, error), each sampled at tones 0–100 in the
  **HCT** color space. Source of truth; rarely consumed directly.
- **System tokens** — `md.sys.color.primary`, `md.sys.color.on-primary`, `md.sys.color.surface-container-high`.
  **Semantic roles.** Each maps to a reference token _and flips by light/dark_. **This is what
  components bind to.** ~29 color roles per mode.
- **Component tokens** — `md.comp.filled-button.container-color`. Per-component role assignment, almost
  always an alias of a system token. Optional indirection tier.

The leverage: components only ever reference **system tokens**. Swap the reference palettes (new
seed) and every system token — hence every component — moves coherently. That is exactly the
"one place" the user wants.

## 4. What `material-color-utilities` gives us

TypeScript package `@material/material-color-utilities@0.4.0`, **Apache-2.0**, **zero runtime deps**,
ESM, ~10.7k LOC. Key entry points:

- `Hct` — the HCT (Hue, Chroma, Tone) color space. The whole system's foundation.
- `CorePalette.of(seedArgb)` → the 6 `TonalPalette`s (**reference tokens**). `palette.a1.tone(40)` etc.
- **System tokens, two API generations:**
  - _Legacy_ `Scheme.light(seed)` / `Scheme.dark(seed)` — flat objects of the ~29 roles. Simple.
  - _Current_ `DynamicScheme` + `SchemeTonalSpot|Vibrant|Expressive|Neutral|Monochrome|…` +
    `MaterialDynamicColors` — supports **scheme variants** and a **contrast level** knob
    (accessibility), and is where upstream development continues. Richer surface roles
    (`surface-container-low/high/highest`, `*-fixed`, `inverse-*`).
- `themeFromSourceColor(seed, customColors[])` — convenience wrapper returning palettes + light/dark
  schemes + harmonized custom brand colors (via `Blend.harmonize`).
- `QuantizerCelebi` + `Score.score` + `sourceColorFromImage` — extract a seed **from an image**
  (e.g. a logo). Optional, but cheap to include.

License is permissive; attribution is the only obligation.

## 5. The central tension — and the resolution

Material's generators are **runtime JavaScript color math**. Kovo's constitution is the opposite:
static, legible, "every artifact readable in devtools, checkable without a browser" (SPEC §1.2–1.4),
and a deliberately minimal client runtime (§1.4 non-goals).

**Resolution: run the color engine at build time; emit plain CSS custom properties.** The seed color
is _sugar_; the emitted system-token CSS block is the _authorable artifact_ — which is precisely
Constitution #3 ("sugar must lower to authorable IR") and #4 ("the wire is the documentation"). The
browser ships **no color math**, just a static stylesheet identical in shape to today's
`kovoUiTokenSheetCss`. The `:root` + `:root[data-theme="dark"]` light/dark pattern already in
`token-sheet.ts` is exactly the output target.

This cleanly splits two products:

- **Build-time theming (v1 target).** `themeFromSeed('#6750A4')` runs in the build, prints the
  system-token CSS. Fully static and legible. Covers ~all real "brand a site" needs.
- **Runtime "Material You" theming (later, opt-in).** User picks a seed _in the running app_ and the
  palette regenerates client-side. This is the dynamic path — it requires shipping (a trimmed slice
  of) the color engine to the browser, so it should be an explicit opt-in island, not the default,
  and is out of scope for v1 per the minimal-runtime posture.

## 6. Proposed architecture (mapping M3 → Kovo primitives)

```
seed '#6750A4'  ──(build time, color engine)──▶  reference palettes (HCT tones)
                                                          │ lower
                                                          ▼
        system tokens  --kovo-sys-color-primary / on-primary / surface-container-high …
            emitted to  :root (light)  and  :root[data-theme="dark"] (dark)
                                                          │ defineVars (typed refs)
                                                          ▼
        components reference  tokens.primary, tokens.onPrimary, tokens.surfaceContainerHigh
            (replaces the hardcoded #hex in all 97 @kovojs/ui components)
```

**(a) Color engine — `@kovojs/color` (vendored, build-time).** See §7. Exposes
`themeFromSeed(seed, { variant, contrast }): KovoTheme` returning the reference palettes + the
light/dark system-token maps as hex/`rgb` strings.

**(b) System-token contract — generalize `token-sheet.ts`.** Replace the hand-authored shadcn HSL
sheet with one generated from a default seed, using **M3 role names**. Keep the existing emit
machinery (`renderTokenBlock`, `:root` + `[data-theme="dark"]`, the `--color-*` document aliases for
app CSS). Output is a static `kovoUiTokenSheetCss` string, same as today.

**(c) Typed refs — `style.defineVars`.** A generated `tokens` object so components write
`backgroundColor: tokens.surfaceContainerHigh` instead of `'#fafafa'`. `defineVars` already mints
`var(--kovo-…)` refs with the right types; this is the bridge that makes the 97-component rewrite
mechanical and type-checked.

**(d) Multiple/override themes — `style.createTheme`.** Already supports an override class that
re-binds a subset of vars under `.kv-…-theme-<hash>`. A second brand or a "high-contrast" theme
becomes a `createTheme(tokens, themeFromSeed(otherSeed))` class applied to a subtree — no component
changes.

Why this fits Kovo specifically: light DOM means tokens are ordinary inherited custom properties (the
styling guide already calls this out — "theming does not cross shadow boundaries"). Nothing here needs
a client runtime, a shadow boundary, or non-static CSS.

## 7. Use vs. vendor the color engine

**Recommendation: vendor a trimmed subset as `@kovojs/color`, build-time only.**

Rationale, in order of weight:

1. **House precedent is to own, not depend.** `@kovojs/style` _is_ "the Kovo-owned StyleX fork." A
   vendored, auditable color engine is the consistent move and satisfies the "small, owned, auditable
   surface" ethos and `rules/api-surface.md`.
2. **Build-time only ⇒ zero client bytes**, so the ~10k LOC is not a runtime cost; it's a dev-time
   dependency we can trim hard.
3. **Trim to the current spec path:** keep `hct/`, `palettes/`, `dynamiccolor/` (DynamicScheme +
   MaterialDynamicColors), `utils/` (color/math/string), and optionally `quantize/`+`score/` for
   image-seed. **Drop** legacy `scheme/` (flat `Scheme`), `temperature/`, `dislike/`, and `blend/`
   unless harmonized custom brand colors are wanted. Preserve the Apache-2.0 header + NOTICE.

Lighter alternative: add `@material/material-color-utilities` as a **devDependency** and wrap it
behind a tiny Kovo-owned `themeFromSeed`. Less code to own; weaker fit with the fork-and-own house
style; upstream churn risk. Pick this only if we want to avoid carrying the source.

Either way, the _public_ Kovo surface is one stable function (`themeFromSeed`) + the token contract —
the engine internals stay private.

## 8. Decisions (resolved 2026-06-17)

1. **Token namespace → M3 names verbatim.** `primary`, `on-primary`, `surface-container-high`,
   `secondary-container`, etc. Source of truth is the M3 system-token set; this enables reusing M3
   component-token mappings and the richer surface roles. Accept the larger rename of the current
   sheet. (Open sub-question: whether to _also_ keep `--color-*` document aliases for app CSS — see
   plan, kept as a compatibility task, not a naming change.)
2. **Build-time only for v1.** Runtime "Material You" deferred to a later opt-in island.
3. **Vendor as `@kovojs/color`** (trimmed, Apache NOTICE preserved), not a devDependency.
4. **Scheme variant + contrast are public knobs** on `themeFromSeed`. Contrast is an a11y lever worth
   exposing (`rules/accessibility-conformance.md`); default variant `tonal-spot`.
5. **Image-seed support: in scope but lowest priority** (quantizer+score), behind the build-time API.

Tracked rollout: **`plans/theming-codex.md`**; the earlier `plans/material-theming.md` proposal was
retired into `plans/archive.md`.

## 9. Sketch of the proving path (once decisions land)

- [ ] Vendor trimmed engine into `packages/color` with Apache NOTICE; unit-test `themeFromSeed`
      against known M3 reference outputs (e.g. seed `#6750A4` → `primary` tone-40 hex).
- [ ] Regenerate `token-sheet.ts` from a default seed using the chosen role names; assert
      `kovoUiTokenSheetCss` shape (light `:root` + dark `[data-theme]`) is preserved.
- [ ] Emit a typed `tokens` (`defineVars`) object; codemod the 97 `@kovojs/ui` components from hex to
      `tokens.*`; the `*.stylex.test.tsx` snapshots become the regression net.
- [ ] Document the theming story in `site/content/guides/styling.md` (seed → tokens → components) and
      add a `createTheme` multi-theme example.
- [ ] If runtime theming is approved later: a separate opt-in island that ships the trimmed engine.

## 10. Risks / notes

- **The 97-component rewrite is the real cost,** not the color math. It should be a codemod + snapshot
  diff, ideally fanned out per component family (CLAUDE.md parallel-slice guidance).
- **Contrast guarantees:** M3's `on-*` roles are designed to clear WCAG against their pairs; using the
  DynamicScheme contrast knob preserves that. Hardcoded hex today has no such guarantee — this is a
  net a11y win, but must be asserted, not assumed (`rules/accessibility-conformance.md`).
- **Determinism:** the engine must be pure/deterministic at build time (no `Date.now`/random) so the
  emitted CSS is reproducible and the fixpoint/render-equivalence gates stay sound.
- **`@theme inline` aliases:** the current sheet emits Tailwind-style `@theme inline { --color-* }`
  aliases; decide whether the M3 sheet keeps that bridge for app-level CSS.

```

```
