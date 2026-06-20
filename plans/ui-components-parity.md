# UI Components — shadcn/ui Parity Audit

_Audited 2026-06-19 · branch `agent/ui-parity-audit` · worktree `/Users/mini/kovo-ui-parity`_

> **Question asked:** why do the `@kovojs/ui` components look like "a cheap knock-off of shadcn/ui"?
>
> **One-line answer:** the library has **shadcn's bones** (the same component set, the same
> geometry — 6 px/12 px radii, 36 px controls, Tailwind-scale shadows) wearing **Material Design 3's
> skin** (M3 tonal colors, M3 semantic roles). A single file — `packages/ui/src/theme.ts` — bridges
> the UI's semantic tokens straight onto Material Design 3 `tokens.sys.color.*` / `.shape.*`, so every
> surface is teal-tinted, the primary accent is teal instead of near-black, and "success/warning"
> render teal/blue instead of green/amber. **Fix the token bridge and ~80 % of the gap closes
> globally** — the components underneath are well-built.

---

## 1. Verdict & scoreboard

- **44 components audited.** Average shadcn fidelity **3.0 / 5**.
- **232 divergences** logged: **45 high**, 92 medium, 95 low.
- By category: **color 116 (50 %)**, structure 33, shape 28, a11y 24, state 11, semantic 11,
  spacing 5, typography 4. **Color is half of everything** — which is exactly why it _reads_ as
  off-brand rather than broken.

| Fidelity | Components |
|---|---|
| **1/5** | `alert` |
| **2/5** | `accordion`, `badge`, `button`, `checkbox-group`, `command`, `disclosure`, `meter`, `navigation-menu`, `progress`, `select`, `slider` |
| **3/5** | `alert-dialog`, `autocomplete`, `avatar`, `checkbox`, `collapsible`, `combobox`, `context-menu`, `dialog`, `dropdown-menu`, `field`, `menubar`, `otp-field`, `radio-group`, `skeleton`, `switch`, `table`, `toast`, `toggle`, `toolbar` |
| **4/5** | `breadcrumb`, `card`, `drawer`, `hover-card`, `kbd`, `number-field`, `popover`, `scroll-area`, `separator`, `sheet`, `tabs`, `toggle-group` |

`tabs` is the single closest match (a correct segmented control); `alert` is the worst (a
fully color-filled Material bar with no icon slot).

---

## 2. Root cause: shadcn bones, Material skin

`packages/ui/src/theme.ts` defines `uiTheme`, the semantic token object every styled component
consumes, and binds each key **directly to a Material Design 3 system role** from `@kovojs/style`
(`tokens.sys.color.*`, `tokens.sys.shape.*`). Those M3 roles are generated from a seed color
(`site/src/theme.ts` seed `#0f766e`, Tailwind teal-700) through `@material/material-color-utilities`,
so they are chromatic and hue-tinted by construction.

The mapping (annotated with the resolved light-mode hex, from `site/src/generated/kovo-ui.css`):

| `uiTheme` key | → M3 role | resolved | shadcn target |
|---|---|---|---|
| `accent` (primary fill) | `color.primary` | **`#006a63` deep teal** | `--primary` near-black `oklch(0.205 0 0)` ≈ `#18181b` |
| `accentHover` | `color.primaryContainer` | **`#72f7ea` bright cyan** | `primary/90` (slightly _darker_) |
| `background` (surface) | `color.surface` | **`#fafdfb` green-tinted white** | `--background` pure `#ffffff` |
| `border` | `color.outlineVariant` | **`#bec9c6` greenish, ~zinc-300** | `--border` zinc-200 `#e4e4e7` (near-invisible) |
| `borderStrong` | `color.outline` | `#6f7977` mid-gray | — (shadcn rarely borders this heavy) |
| `foregroundMuted` | `color.onSurfaceVariant` | `#3f4947` | `--muted-foreground` `#71717a` |
| `success` | `color.secondary*` | **`#cce8e4` / `#4a6360` teal** | green |
| `warning` | `color.tertiary*` | **`#cee5ff` / `#47617a` blue** | amber/yellow |
| `info` | `color.primary*` | **`#72f7ea` cyan** | (shadcn has no info) |
| `danger` | `color.error*` | `#ffdad6` / `#ba1a1a` brick-red | `--destructive` red-500/600 |
| `radius.{sm,md,lg,full}` | `shape.corner*` | 4 / 6 / 12 px / 9999 | ✅ matches shadcn (rounded-md/-xl) |

**Architectural note (verified correction).** There are actually _two_ token bridges in the repo,
and the UI uses the wrong one:

1. **What the styled components use** — `uiTheme` → M3 `tokens.sys.color.*` (the table above). The
   generated component CSS references `--kovo-theme-sys-color-primary` 16×, `…-surface` 34×,
   `…-outline-variant` 37×, etc.
2. **An unused shadcn-shaped layer** — `packages/headless-ui/src/lib/token-sheet.ts` emits a
   shadcn-named sheet (`--kovo-color-card/popover/primary/muted/accent/border/input/ring`,
   `--kovo-radius-*`). The styled `@kovojs/ui` CSS references it **zero times**. A shadcn-shaped
   token contract already exists in the codebase — the styled library simply ignores it in favor of
   raw Material roles.

So the geometry was built to shadcn spec, a shadcn-shaped token layer was even authored, but the
paint pipeline was wired to Material Design 3. That mismatch is the whole "knock-off" effect.

---

## 3. Verified systemic findings

Each headline claim below was checked by a dedicated adversarial verifier against
`packages/ui/src/theme.ts`, `site/src/generated/kovo-ui.css`, and component sources. Verdicts and
the exact corrections it returned:

1. **✅ Teal primary, not near-black.** `accent = color.primary = #006a63` paints buttons
   (`button.tsx:98`), checked checkbox (`checkbox.tsx:50`), switch-on (`switch.tsx:79`), radio dot,
   slider range. `#18181b` appears **0×** in the generated CSS. _(In dark mode primary becomes
   `#51dbce`, css:185 — still teal-family.)_
2. **✅ Hue-tinted, heavier neutrals.** `surface #fafdfb` (not pure white) and `border #bec9c6`
   (greenish; channels R<G) come from Material's tinted neutral/neutral-variant ramps; `#e4e4e7`
   (shadcn's border) never appears. The green cast is faint (1–3 points/channel) but pervasive — it
   sits under every surface, border, and divider.
3. **✅ Broken status semantics (category error).** `success → M3 secondary` renders **teal**
   (`#cce8e4`/`#4a6360`); `warning → M3 tertiary` renders **blue** (`#cee5ff`/`#47617a`). Consumed
   directly by `badge.tsx:45-54`, `alert.tsx:48-57`, `toast`, `meter`. A blue "warning" is
   semantically backwards.
4. **✅ A real green & orange are emitted but dead.** `--kovo-theme-custom-success-color: #006c4c`
   (true green) and `--kovo-theme-custom-danger-color: #a73a00` (true orange) exist in the generated
   CSS (css:154,158) but `theme.ts` never references the custom slot — **0** `var(--kovo-theme-custom-*)`
   in component CSS. The correct semantic colors are already in the bundle, just unused.
5. **◑ Geometry is fine; the gap is color + a few structural choices** _(confirmed with two
   corrections)_. Radii (6/12 px), 1 px borders, button h=36, and overlay shadow scales (shadow-sm
   `0 1px 2px/.05`, shadow-lg on select content, shadow-2xl on dialog) all match shadcn. Corrections:
   the select trigger is better described as an **unstructured default-centered `<button>` with no
   chevron at all** (no `display:flex`/`justify-between`); and the **accordion header is _not_
   permanently filled** — only the trigger fills on `[data-state=open]`/`:hover`; the **table thead
   _is_ permanently filled** (`table.tsx:61`).
6. **◑ Root cause = theme.ts bridges to M3** _(confirmed; mechanism corrected)_. `uiTheme` uses its
   _own_ semantic names (not shadcn names) bound to `tokens.sys.color.*`; the shadcn-named sheet lives
   in `headless-ui/token-sheet.ts` and is unconsumed (see §2).

---

## 4. The recurring "knock-off" tells (cross-cutting patterns)

These eight patterns repeat across the whole set and account for nearly all 45 high-severity items.
Each is fixable in one or a few places.

1. **Teal accent everywhere a fill or "on" state appears** — button primary, toggle pressed, checkbox/radio/switch checked, slider range+thumb, progress fill. shadcn's signature is monochrome near-black; Kovo replaces it with one saturated brand hue. _(button, checkbox, radio-group, switch, slider, progress, toggle)_
2. **Green-tinted neutrals + heavy borders** — `#fafdfb` surfaces and `#bec9c6` borders (≈ zinc-300) instead of pure white + near-invisible zinc-200. Every card, input, menu, and divider carries the cast. _(all families)_
3. **Broken status colors** — success = teal, warning = blue, info = cyan; the real green/orange go unused. _(badge, alert, toast, meter)_
4. **Plain outline focus, not a ring** — every component uses `outline: 2px solid #6f7977; outline-offset: 2px` where shadcn uses a `box-shadow` ring + ring-offset. This single change lifts the perceived polish of the entire set. _(all interactive components)_
5. **CSS-border carets instead of `ChevronDown` SVGs** — accordion/collapsible/disclosure draw the expand caret with a rotated `::after` square border (thin, home-made); select & navigation-menu omit the chevron entirely; breadcrumb uses a text `/`. shadcn uses Lucide icons throughout. _(accordion, collapsible, disclosure, select, navigation-menu, breadcrumb, command)_
6. **Over-boxed / filled surfaces** — accordion items are per-item bordered cards with a filled open-header; the table is a bordered box with a filled header row; alert is a fully color-filled bar; OTP renders four separate boxes; scroll-area adds a card border + filled scrollbar track. shadcn leaves all of these minimal/borderless. _(accordion, table, alert, otp-field, scroll-area)_
7. **Native-control leaks** — `checkbox-group` ships a bare native `<input type=checkbox>` (OS accent-color) instead of the styled box the standalone Checkbox uses; `field` embeds native `<select>`/checkboxes; the `progress` interactive build leaks the **OS-native blue `<progress>` bar** (~`#1a73e8`) over the teal indicator. _(checkbox-group, field, progress)_
8. **Washed-out menu text** — dropdown/context/menubar/navigation items default to `foregroundMuted #3f4947` for _resting_ text, where shadcn renders menu items at full near-black `#0a0a0a` and reserves muted only for shortcuts/labels. _(dropdown-menu, context-menu, menubar, navigation-menu)_

Plus **demo hygiene** issues that make the _gallery_ look unfinished (not component bugs): every
interactive demo leaks raw `<output>` debug state (`off`, `indeterminate`, `Standard`, `closed`,
`team`) next to the widget, and most overlays are **frozen closed** on `main` (the known broken
interaction wiring — see `agent/gallery-fix` and the `gallery-css-and-derive-gotchas` memo), so
dialog/sheet/drawer/popover/menu/tooltip/toast panels can't be exercised in the gallery.

---

## 5. Per-family findings

### Buttons & actions — `button` (2) · `toggle` (3) · `toggle-group` (4) · `toolbar` (3) · `kbd` (4)
Geometry is on-target across the family. The primary button and standalone toggle fill with teal;
worse, primary **hover _inverts_ to lighter** bright-cyan `#72f7ea` (poor white-text contrast) instead
of darkening. Destructive is a two-tone Material error treatment (brick-red `#ba1a1a` → pale pink
`#ffdad6` on hover) rather than a flat saturated red. The three "pressed" treatments are mutually
inconsistent — Toggle = teal, ToggleGroup = white card + shadow, Toolbar = near-black inverse —
where shadcn renders all three as a flat light-gray `bg-accent` (zinc-100) with dark text.

![button](ui-components-parity-assets/button.png)

### Badges & status — `badge` (2) · `alert` (1) · `skeleton` (3) · `avatar` (3) · `separator` (4)
`alert` is the family's worst: a fully color-filled bar (bg+border+text all colored), default variant
`info` = saturated cyan `#72f7ea`, success = teal, warning = blue, and **no icon slot** — vs shadcn's
neutral bordered card with a leading icon and muted description. `badge` has **no solid near-black
default** (its most prominent variant is gray `neutral`), puts a border on every variant, and uses
`fw500` not `600`. `skeleton`'s `#e6e9e7` fill on the `#fafdfb` page is near-invisible.

![badge](ui-components-parity-assets/badge.png)
![alert](ui-components-parity-assets/alert.png)

### Text & form inputs — `field` (3) · `number-field` (4) · `otp-field` (3) · `slider` (2)
Structurally close (36 px controls, 6 px radius, shadow-sm). Two systemic tells dominate: green-tinted
surface/border and **outline-not-ring focus**. `slider` is the family's lowest — range fill _and_ thumb
border are teal `#006a63`. `otp-field` renders four separate gapped boxes instead of shadcn's
contiguous joined slots. `field` embeds native `<select>`/checkbox and leaks `team`/`window` debug text.

![field](ui-components-parity-assets/field.png)
![slider](ui-components-parity-assets/slider.png)

### Selection controls — `checkbox` (3) · `checkbox-group` (2) · `radio-group` (3) · `switch` (3)
Geometry matches (18 px box r=4, 44×24 switch). Every "on" state is teal instead of near-black; unchecked
borders use heavy `#6f7977`. **`checkbox-group` ships a bare native `<input>`** (OS accent-color) instead
of reusing the standalone Checkbox's custom box — the clearest "inconsistent/cheap" tell in the set.

![checkbox](ui-components-parity-assets/checkbox.png)
![radio-group](ui-components-parity-assets/radio-group.png)
![switch](ui-components-parity-assets/switch.png)

### Selects & combos — `select` (2) · `combobox` (3) · `autocomplete` (3) · `command` (2)
`select` trigger has **no chevron** and centers its value (plain `<button>`, no flex/justify/text-align)
vs shadcn's left-value + right `ChevronDown`. `command` input has no leading Search glyph and mixes
border weights. All inherit the green-tinted neutrals + outline focus.

![select](ui-components-parity-assets/select.png)

### Overlays — `dialog` (3) · `alert-dialog` (3) · `sheet` (4) · `drawer` (4) · `popover` (4) · `hover-card` (4) · `tooltip` (4)
Geometry/structure faithful; the family reads "recognizably shadcn but off-hue." Cross-cutting:
green-tinted panel surfaces, heavy `#6f7977` trigger borders, **heavier shadows** (dialog
`rgb(0 0 0/.25)` ≈ shadow-2xl vs shadcn shadow-lg), a **faint `rgb(0 0 0/.3)` backdrop** vs shadcn's
~80 % scrim, and several panels set body text to `foregroundMuted` instead of `foreground`. _All seven
panels are frozen closed in the gallery; judged from source._

### Menus — `dropdown-menu` (3) · `context-menu` (3) · `menubar` (3) · `navigation-menu` (2)
Correct geometry, but item resting text is `foregroundMuted #3f4947` (washed out) and surfaces are
teal-tinted with heavy borders. `navigation-menu` additionally **omits the `ChevronDown` trigger
affordance** and models its indicator as a near-black bar rather than shadcn's rotated arrow.

### Disclosure & navigation — `accordion` (2) · `collapsible` (3) · `disclosure` (2) · `tabs` (4) · `breadcrumb` (4)
`accordion` boxes every item (1 px bordered rounded-md card), **fills the trigger on open/hover**, and
uses a CSS-border caret — vs shadcn's borderless, bottom-border-only, transparent-trigger,
`ChevronDown` anatomy. `tabs` is the **closest match in the whole audit** (correct segmented control,
white active pill + shadow).

![accordion](ui-components-parity-assets/accordion.png)
![tabs](ui-components-parity-assets/tabs.png)

### Data & feedback — `card` (4) · `table` (3) · `progress` (2) · `meter` (2) · `toast` (3) · `scroll-area` (4)
`card` is clean (12 px radius, shadow-sm) bar the tint. `table` is wrapped in a bordered box with a
**filled header row** (`#f2f4f2`) where shadcn's is transparent. `progress` fill is teal _and_ the live
build leaks the **native blue `<progress>`**. `meter` "good" = slate-teal, "warning" = blue — wrong hues.

![table](ui-components-parity-assets/table.png)

---

## 6. Remediation plan

Ordered by leverage. **P0 alone closes most of the visual gap** because the divergence is dominated
by the shared token bridge.

### P0 — Re-skin the token bridge _(global; ~80 % of the win)_
- [ ] In `packages/ui/src/theme.ts`, stop binding `accent`/neutrals to chromatic M3 roles. Either
      **(a)** seed `@kovojs/style` from a neutral/zinc source so `sys.color.primary` resolves near-black
      and neutrals lose their chroma, or **(b)** repoint `uiTheme` to the existing shadcn-named sheet
      (`--kovo-color-*` from `headless-ui/token-sheet.ts`). Targets: `accent → #18181b` (near-black),
      `accentForeground → near-white`, `accentHover → slightly darker` (not the lighter
      `primaryContainer`), `background → #ffffff`, `border → zinc-200 #e4e4e7`,
      `foregroundMuted → #71717a`.
- [ ] Verify with the theme contract test (`packages/ui/src/theme-contract.test.tsx`) and re-emit
      `site/src/generated/kovo-ui.css` (`site/scripts/emit-ui-css.mjs`); confirm `#006a63`/`#fafdfb`
      no longer back the primary/surface roles.

### P1 — Fix broken status semantics
- [ ] Remap `success` → a true green and `warning` → a true amber. The repo already emits
      `--kovo-theme-custom-success-color #006c4c` (green) and `--kovo-theme-custom-danger-color #a73a00`
      (orange); wire `theme.ts` to the custom semantic slots (add a real amber for warning). Fixes
      `badge`, `alert`, `toast`, `meter` with no per-component change.

### P2 — Replace outline focus with a ring _(shared)_
- [ ] Swap every `:focus-visible { outline: 2px solid borderStrong; outline-offset: 2px }` for a
      `box-shadow` ring + ring-offset (a `theme.shadow.focusRing` already exists in `theme.ts:50`).
      Touches the whole interactive set; do it once at the shared style level.

### P3 — Structural fixes (per component)
- [ ] `alert.tsx`: rebuild as a neutral bordered card with a **leading icon slot** (`grid-cols: auto 1fr`),
      foreground title + muted description; reserve color for the destructive variant's border/text only;
      drop the `info` default.
- [ ] `select.tsx`: add a right-aligned `ChevronDown`, make the trigger `display:flex;
      justify-content:space-between; text-align:left`.
- [ ] `accordion.tsx` / `collapsible.tsx` / `disclosure.tsx`: drop the per-item box + open-fill; use a
      single `border-bottom` separator + `hover:underline`; replace the `::after` caret with a
      `ChevronDown` icon that rotates 180°.
- [ ] `table.tsx`: transparent `thead` (remove the `backgroundRaised` fill), drop the wrapper
      border/radius.
- [ ] `checkbox-group.tsx`: reuse the standalone Checkbox's custom box instead of a bare native `<input>`.
- [ ] `otp-field.tsx`: render a contiguous joined slot group (shared inner borders, only first/last rounded).
- [ ] `navigation-menu.tsx`: add the `ChevronDown` trigger glyph; re-model the indicator as a rotated arrow.
- [ ] `breadcrumb.tsx`: default the separator to `ChevronRight` instead of text `/`.
- [ ] `command.tsx`: add a leading Search glyph; unify border weights; raise the dialog radius to `lg`.
- [ ] Menus (`dropdown-menu`, `context-menu`, `menubar`, `navigation-menu`): set item resting `color` to
      `foreground`, not `foregroundMuted`.
- [ ] Overlays: lighten dialog/alert-dialog shadow to shadow-lg; raise `::backdrop` to `rgb(0 0 0/.8)`;
      add a `::backdrop` scrim to `sheet`/`drawer`; switch trigger borders from `borderStrong` to `border`.

### P4 — Native-control & gallery hygiene
- [ ] `progress`: ensure the compiled interactive build fully hides the native `<progress>` so the OS
      blue bar stops leaking over the indicator span.
- [ ] `field`: replace the embedded native `<select>`/checkbox with the styled components for consistency.
- [ ] Gallery demos: stop leaking `<output data-demo-state>` debug text beside widgets; restore overlay
      interactivity (cross-ref `agent/gallery-fix`) so panels can be reviewed visually.

---

## 7. Caveats & scope

- **Light mode, default seed.** The audit targets the gallery's shipped teal seed (`#0f766e`). Dark
  mode (`:root[data-theme="dark"]`) inherits the same mapping (primary `#51dbce`), so the findings
  carry over; exact dark hexes were not re-tabulated.
- **Overlays judged from source.** Dialog/sheet/drawer/popover/menu/tooltip/toast demos are frozen
  closed on `main`, so their _panel_ styling was read from `*.tsx` `style.create` blocks, not seen
  live. The triggers were screenshotted.
- **shadcn baseline** = current default theme, fetched live: `--primary oklch(0.205 0 0)`,
  `--background oklch(1 0 0)`, `--border oklch(0.922 0 0)`, `--radius 0.625rem`, `--destructive` the
  only chromatic role, **no built-in `--success`/`--warning`**.

## 8. How to reproduce

```bash
# 1. serve the already-built static gallery (styled: site.css ~45 KB, kovo-ui.css ~111 KB)
node site/scripts/serve-static.mjs --port 4173
# 2. capture all 44 component pages + interaction attempts with Playwright
node scratch/ui-audit/capture.mjs            # → scratch/ui-audit/shots/*.png
# 3. ground truth: the token bridge and resolved values
#    packages/ui/src/theme.ts  +  site/src/generated/kovo-ui.css  (lines 101-161 = resolved sys tokens)
```

Evidence index: per-component fixes & evidence in `scratch/ui-audit/digest.txt`; raw 11-agent
workflow output in the task transcript (`wr2xdov3z`); embedded screenshots in
`plans/ui-components-parity-assets/`.
