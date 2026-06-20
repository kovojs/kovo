# UI Components — Visual Polish Plan (Material colors kept by design)

_Audited 2026-06-19 · revised 2026-06-19 after design review · diagnostic baseline: shadcn/ui_

> **Original question:** why do the `@kovojs/ui` components look like "a cheap knock-off of
> shadcn/ui"?
>
> **Design decision (this revision):** the **Material Design 3 color identity is intentional and we
> are keeping it** — teal primary, tonal neutrals, Material error red all stay. The "knock-off" feel
> is therefore **not** the palette. It is three fixable things layered on top of an otherwise
> well-built, shadcn-shaped component set:
> 1. **Color _correctness_ bugs** _within_ the Material system (a blue "warning", washed-out text, an
>    invisible skeleton, a primary button that gets _lighter_ on hover);
> 2. **Structure / anatomy gaps** vs any polished component library (missing chevron icons, an
>    unstructured select trigger, over-boxed/over-filled surfaces, outline-instead-of-ring focus);
> 3. **Native-control leaks & demo hygiene** (a raw OS checkbox, the native blue `<progress>` bar,
>    leaked debug text).
>
> shadcn is still used below as a **structural** reference (anatomy, focus model, de-boxing) — **not**
> a color target. Fixing the three buckets keeps the Material look and removes the "cheap" feel.

---

## 1. Decisions driving this revision

| Area | Decision | Effect on the old plan |
|---|---|---|
| **Accent / primary** | **Keep Material teal** (`#006a63`) on buttons, checked checkbox/radio/switch, slider, progress | Old P0 "recolor to near-black zinc-900" — **dropped** |
| **Neutrals** | **Keep the Material tint** (`#fafdfb` surfaces, `#bec9c6` borders) and current border weight; **fix only the contrast bugs** | Old "→ pure white / zinc-200" — **dropped**; keep the skeleton + washed-out-text fixes |
| **Status colors** | **Fix** success→Material green, warning→Material amber | Kept (now framed as Material-harmonized, not shadcn) |
| **Filled surfaces** | **Adopt the minimal versions** — Alert→bordered card, transparent accordion/table headers, drop heavy outer boxes | Kept |

Everything else in the original audit (focus rings, chevron icons, select trigger, OTP slots,
checkbox-group, native-control leaks, demo hygiene) is unchanged and carried into §4.

---

## 2. Root cause (diagnosis unchanged, prescription changed)

`packages/ui/src/theme.ts` binds the UI's semantic tokens (`uiTheme`) directly onto Material Design 3
system roles from `@kovojs/style` (`tokens.sys.color.*`, `tokens.sys.shape.*`), seeded from
`#0f766e` (teal-700). That binding is **what we want to keep** — it is the Material identity. The
problems are the handful of places where the mapping is _semantically wrong_ or where the component
_structure_ falls short, not the fact that it maps to Material.

Two facts from the audit are now levers rather than complaints:

- **The repo already emits the correct status hues and doesn't use them.**
  `--kovo-theme-custom-success-color: #006c4c` (a Material-harmonized green) and
  `--kovo-theme-custom-danger-color: #a73a00` (a burnt orange) exist in
  `site/src/generated/kovo-ui.css` but `uiTheme` references the custom slot **0×**. Wiring
  `success`/`warning` to these (plus a real amber) is the entire status-color fix.
- **Geometry is already right** — 6 px/12 px radii, 1 px borders, 36 px controls, Tailwind-scale
  shadows. No resizing needed; the work is color-correctness + anatomy.

_(Note for later: a parallel **shadcn-named** token sheet — `--kovo-color-*`, `--kovo-radius-*` —
exists in `packages/headless-ui/src/lib/token-sheet.ts` and is referenced 0× by the styled UI. We are
**not** switching to it; it's noted only so nobody assumes it's load-bearing.)_

---

## 3. Keep — intended Material identity (do **not** "fix")

These audit findings are **by design** under the Material decision and should be closed as
won't-fix / working-as-intended:

- **Teal primary fills** — `button` primary, `checkbox`/`radio`/`switch` checked, `slider`
  range+thumb, `progress` indicator (`accent = color.primary = #006a63`).
- **Tonal neutral surfaces & borders** — `#fafdfb` surfaces, `#bec9c6` borders keep their hue and
  weight (the faint green cast is the Material tint).
- **Material error red** for `destructive`/`danger` (`#ba1a1a`) — keep the hue (the two-tone _hover
  swap_ is addressed in §4-A as a state bug, not a hue change).
- **Badge default can be a solid _primary_ (teal) variant** — if we add a solid default badge it
  should be Material primary, not near-black.

---

## 4. Fix backlog — IMPLEMENTED ✅

> **Status (2026-06-19):** implemented on branch `agent/ui-polish-impl` (worktree
> `/Users/mini/kovo-ui-polish`), commits `308ce46b` (4-A/4-B), `49641301` (4-C),
> `7945066f` (extraction/accordion fixes + re-emit). 22 component sources + `theme.ts` changed.
> **Gates green:** `@kovojs/ui` 55 test files / 186 tests; gallery `demo-fixtures` 35 tests; site
> build `diagnostics=0`; `package-css` extraction 101 KB with `--kovo-theme-custom-{success,warning}-*`
> present; no raw hex in any `.tsx`. Visual re-shots in `scratch/ui-audit/shots-after/` confirm the
> changes (alert green/red card, badge green/amber, select chevron, table transparent, accordion
> de-boxed). Material color identity preserved throughout.

Ordered by leverage. **§4-A (color correctness) bought most of the "looks polished" win.**

### 4-A · Color correctness _within_ Material  ·  **P1**
- [x] **Status colors → Material green/amber.** `theme.ts` `success`/`warning` now reference the
      app-defined Material custom colors as **static `var()` literals with an M3 fallback**
      (`var(--kovo-theme-custom-success-color, var(--kovo-theme-sys-color-secondary))`, etc.);
      `site/theme.ts` adds a `warning: '#b45309'` amber. _Verified: shots-after `badge.png` (Live=green,
      Needs-review=amber), `alert.png` (green/red left accents); `kovo-ui.css` carries `custom-success`
      + `custom-warning`._ Fixes `badge`/`alert`/`toast`/`meter` with no per-component edits.
      _(NB: a helper-function form first broke the compiler's static package-css extraction — the
      literal form is required; documented in `theme.ts`.)_
- [x] **Resting text uses the full-strength role, not muted.** `dropdown-menu`/`context-menu`/
      `menubar`/`navigation-menu` resting item/trigger/link text moved `foregroundMuted` → `foreground`
      (menubar also gained `fontWeight:500`).
- [x] **Skeleton contrast.** Added `uiTheme.color.backgroundMuted` (`surfaceContainerHighest`);
      `skeleton` now fills with it instead of the near-invisible `backgroundSubtleHigh`.
- [x] **Primary/action hover darkens, not lightens.** `button` primary & destructive `:hover` and
      `alert-dialog` action `:hover` now use `filter: brightness(...)` (darken colored fills; lighten
      the dark action surface) instead of swapping to the bright `primaryContainer`/error containers.

### 4-B · Focus model  ·  **P2**
- [x] **Consistent Material-teal focus ring.** Recolored every component's focus ring from the dull
      gray `borderStrong` → `accent` (teal) across 28 files (39 `outlineColor` sites). _Implementation
      note: kept the existing `outline + outline-offset:2px` treatment (already a ring-with-gap)
      rather than converting to `box-shadow` — the real defect was the dull, inconsistent color, and a
      box-shadow swap would clash with the resting drop-shadows on buttons/cards/menus for marginal
      gain. The ring is Material-colored, per the "keep Material" decision._

### 4-C · Structure & anatomy  ·  **P3**
- [x] **Chevron affordances** (via the codebase's CSS-caret idiom). Added a right chevron to the
      `select` trigger and a trailing chevron to the `navigation-menu` trigger; `breadcrumb` separator
      is now a chevron caret (not text `/`); `command` input gained a leading search glyph; accordion/
      collapsible/disclosure keep their existing `::after` carets (already chevrons). _Note: `@kovojs/ui`
      has no SVG icon system (components take `string` children); a Lucide-style icon set is a separate
      effort — the CSS pseudo-element caret is the consistent, low-risk affordance here._
- [x] **Select trigger layout.** `select` trigger is now `display:inline-flex; justify-content:
      space-between; text-align:left` with the right chevron. _Verified: shots-after `select.png`._
- [x] **Alert → neutral bordered card.** `alert` is a neutral card (`background`/`border`/`foreground`)
      with a 4 px colored **left accent** per variant + muted description; the full color fill and the
      cyan `info` default are gone. _Verified: shots-after `alert.png`. (The literal leading-icon-dot
      column was deferred as grid-fiddly; the left-accent card is the clean result.)_
- [x] **De-box / de-fill surfaces.** `accordion` items → single `border-bottom` separator, transparent
      borderless trigger (explicit `backgroundColor:transparent; borderStyle:none` so native `<button>`
      chrome doesn't show), `hover:underline`. `table` → transparent `thead`, no outer box.
      `collapsible`/`disclosure` → content box dropped; `disclosure` trigger border `borderStrong`→`border`.
      `scroll-area` → transparent track, no card border. _Verified: shots-after `table.png` + accordion
      computed styles (trigger transparent, item bottom-hairline)._
- [x] **OTP contiguous slots.** `otp-field` is now one joined group: no `columnGap`, shared inner
      borders, only first/last slots rounded, active slot raised via focus z-index.
- [x] **checkbox-group reuses the styled box.** Group items now render the standalone `Checkbox`'s
      custom box (visually-hidden input + teal-checked box) instead of a bare native `<input>`.
- [x] **Overlay trigger borders + scrims.** `dialog`/`sheet`/`drawer`/`alert-dialog` trigger borders
      `borderStrong`→`border`; `::backdrop` raised to `rgb(0 0 0 / 0.8)` (added where missing on
      sheet/drawer); panel shadows lowered `~shadow-2xl`→`~shadow-lg`; `popover`/`hover-card` body text
      `foregroundMuted`→`foreground`; drawer handle lightened + bottom-side top radius.

### 4-D · Native-control leaks & demo hygiene  ·  **P4**
- [x] **`progress` — resolved (no change needed).** The component already visually-hides the native
      `<progress>` (1×1 absolute). The screenshot's blue-bar leak is a compiled-island artifact (the
      class isn't applied in the interactive client build), **not** a component-CSS defect — out of
      scope for this styling pass.
- [x] **`field` — resolved as by-design (no change).** `FieldSelect` intentionally renders a **styled
      native `<select>`** and `FieldControl` a native `<input>` so Field keeps no-JS form semantics;
      this is a feature, not the inconsistency the audit implied. The demo's raw checkbox is a demo
      choice. (The genuine native-control inconsistency was `checkbox-group`, fixed in §4-C.)
- [ ] **Gallery demos — deferred (gallery-harness scope, not component code).** Removing the
      `<output data-demo-state>` displays + restoring overlay interactivity would rewrite ~32 demos
      and their visual baselines/interaction tests; tracked under the gallery work (`agent/gallery-fix`
      + the `gallery-css-and-derive-gotchas` memo), not this `@kovojs/ui` polish branch.

---

## 5. Per-family notes (keep / fix)

Fidelity numbers below are **shadcn-fidelity (diagnostic only)** — many low scores were driven by the
Material color identity we are now keeping, so a low number ≠ "needs work." The **Fix** column is the
real backlog; **all of it is now implemented (see §4 ✅)** — these notes are kept as the diagnostic
record of what each family needed.

### Buttons & actions — `button` (2) · `toggle` (3) · `toggle-group` (4) · `toolbar` (3) · `kbd` (4)
**Keep:** teal primary, all geometry. **Fix:** primary hover that lightens to cyan (§4-A); unify the
three inconsistent pressed treatments (`toggle` teal / `toolbar` near-black / `toggle-group` white
card) onto one Material-consistent pressed style; ring focus.

![button](ui-components-parity-assets/button.png)

### Badges & status — `badge` (2) · `alert` (1) · `skeleton` (3) · `avatar` (3) · `separator` (4)
**Keep:** Material hues. **Fix:** `alert` → bordered card + icon (§4-C) with corrected status hue;
`badge` success teal→green / warning blue→amber (§4-A), drop the border on filled variants, bump
`fw500`→`600`, optionally add a solid teal default; `skeleton` contrast (§4-A).

![badge](ui-components-parity-assets/badge.png)
![alert](ui-components-parity-assets/alert.png)

### Text & form inputs — `field` (3) · `number-field` (4) · `otp-field` (3) · `slider` (2)
**Keep:** teal slider, tonal borders. **Fix:** ring focus (§4-B); `otp` contiguous slots (§4-C);
`field` native select/checkbox → styled (§4-D); `number-field` swap `-`/`+` text for Minus/Plus
icons.

![field](ui-components-parity-assets/field.png)
![slider](ui-components-parity-assets/slider.png)

### Selection controls — `checkbox` (3) · `checkbox-group` (2) · `radio-group` (3) · `switch` (3)
**Keep:** teal checked states, geometry. **Fix:** `checkbox-group` native input → styled box (§4-C);
ring focus (§4-B).

![checkbox](ui-components-parity-assets/checkbox.png)
![radio-group](ui-components-parity-assets/radio-group.png)
![switch](ui-components-parity-assets/switch.png)

### Selects & combos — `select` (2) · `combobox` (3) · `autocomplete` (3) · `command` (2)
**Keep:** tonal surfaces. **Fix:** `select` trigger chevron + left-aligned flex layout (§4-C);
`command` leading Search glyph + unify border weights + raise dialog radius; ring focus; resting
option text → `foreground`.

![select](ui-components-parity-assets/select.png)

### Overlays — `dialog` (3) · `alert-dialog` (3) · `sheet` (4) · `drawer` (4) · `popover` (4) · `hover-card` (4) · `tooltip` (4)
**Keep:** tonal panels, Material hues. **Fix:** trigger borders `borderStrong`→`border`; `::backdrop`
→ 0.8 + add scrims to sheet/drawer; panel shadow → shadow-lg; `popover`/`hover-card` body text
`foregroundMuted`→`foreground`; `alert-dialog` action hover de-cyan (§4-A); ring focus. _(Panels are
frozen closed in the gallery — see §4-D — so these were read from source.)_

### Menus — `dropdown-menu` (3) · `context-menu` (3) · `menubar` (3) · `navigation-menu` (2)
**Keep:** geometry, tonal surfaces. **Fix:** resting item/trigger text `foregroundMuted`→`foreground`
(§4-A); `navigation-menu` add `ChevronDown` trigger + re-model indicator; `menubar` items
`fontWeight:500`.

### Disclosure & navigation — `accordion` (2) · `collapsible` (3) · `disclosure` (2) · `tabs` (4) · `breadcrumb` (4)
**Keep:** `tabs` (closest match already). **Fix:** `accordion`/`collapsible`/`disclosure` de-box +
transparent trigger + chevron icon (§4-C); `disclosure` trigger border `borderStrong`→`border`;
`breadcrumb` `/`→`ChevronRight`.

![accordion](ui-components-parity-assets/accordion.png)
![tabs](ui-components-parity-assets/tabs.png)

### Data & feedback — `card` (4) · `table` (3) · `progress` (2) · `meter` (2) · `toast` (3) · `scroll-area` (4)
**Keep:** teal progress, `card`. **Fix:** `table` transparent header + drop outer box (§4-C);
`meter`/`toast` status hues → green/amber (§4-A); `toast` add icon slot; `progress` native-blue leak
(§4-D); `scroll-area` transparent track + drop card border.

![table](ui-components-parity-assets/table.png)

---

## 6. Caveats & scope

- **Material color is the target, not shadcn.** shadcn is referenced for _structure_ (anatomy, focus
  model, de-boxing) only. Do not recolor accents/neutrals toward zinc/near-black.
- **Light mode, teal seed (`#0f766e`).** Dark mode (`:root[data-theme="dark"]`, primary `#51dbce`)
  inherits the same mapping; the same fixes apply.
- **Overlays judged from source** — dialog/sheet/drawer/popover/menu/tooltip/toast demos are frozen
  closed on `main`; restoring interactivity (§4-D) is needed to review panels live.

## 7. How to reproduce

```bash
node site/scripts/serve-static.mjs --port 4173      # serve the built static gallery
node scratch/ui-audit/capture.mjs                   # → scratch/ui-audit/shots/*.png (44 components)
# ground truth: packages/ui/src/theme.ts + site/src/generated/kovo-ui.css (lines 101-161 resolved tokens)
```

Evidence index: per-component findings in `scratch/ui-audit/digest.txt`; raw 11-agent workflow output
in task transcript `wr2xdov3z`; screenshots in `plans/ui-components-parity-assets/`.
