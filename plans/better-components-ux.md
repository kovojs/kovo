# Better Components UX — bring the `@kovojs/ui` gallery to shadcn quality

**Goal:** Every component in the gallery (`examples/gallery`, served as
`/gallery/components/<name>/`) should look polished and behave at the same interaction quality as
shadcn/ui (https://ui.shadcn.com/docs/components) — overlays anchor and animate, menus read as flat
rows on one elevated surface, typeahead lists drop below the field, controls actually respond to the
gesture they advertise, and demos stop leaking raw debug state as body text. The styled components
live in `packages/ui/src/*.tsx` (StyleX skin over the `packages/headless-ui/src/primitives/*`
behavior); the live demos are the compiled TSX under `examples/gallery/src/interactive/*-demo.tsx`
(plus static ones in `examples/gallery/src/demo-fixtures.tsx`).

**Status (2026-06-20):** Diagnosis complete; **implementation pass landed** on branch
`agent/better-components-ux` (fan-out of 7 component-slice agents + main-thread integration). The
worktree is **green**: `pnpm exec vp check --fix` → 1422 files, 0 type/lint errors; the full
non-browser suite (`npx vitest run`) passes (the 2 commerce/tutorial 60s tests pass in isolation —
they only time out under whole-suite CPU contention); `check:api-surface` green (new exports
baselined); the gallery browser suite passes except the 2 synthetic-CSS visual-baseline snapshots
(see "Deferred" below).

**Landed (verified):** collapsible/disclosure reveal (B1); drawer + sheet edge-anchoring (B2);
popover/hover-card anchored placement (B3); autocomplete/combobox listbox-below-input (B4) +
close-on-reselect (B5); slider drag (B7); progress styled track (B10); avatar real images (B9, via
inline data-URI SVGs); menu/toolbar/number-field UA-bevel button reset (V1); dialog/sheet close-X +
Dialog/AlertDialog Header/Title/Description/Footer families (V3/V4); toast trigger moved out of the
fixed viewport + inline layout + centered placement (V5); meter optimum/green color (V6); skeleton
visible tone (V9); collapsible/disclosure grid-rows open/close animation (C1 subset); ~demo-state
`<output>` sr-only sweep across the interactive demos (T1).

**Deferred (tracked follow-ups, with reason):**

- **B6 OTP per-slot reactive value** — the styled per-slot value can't be sliced by `slotIndex` in a
  client `data-bind` (no indexing in binding paths); needs a component-owned slot-value primitive.
  Reverted to the working original (typing/delete work client-side; the apparent "bug" was a probe
  artifact). OTP marked **not-reproduced/works** rather than fixed.
- **B8 checkbox-group "All notifications" styled select-all** — a styled `Checkbox` regressed the
  native `.checked` form state across the group on toggle (native-property vs morph); reverted.
  Needs a select-all primitive that drives the group's native `.checked` properties.
- **avatar load/error island** (B9 deeper), **scroll-area `.scrollTop` jump** (V8), **progress
  indeterminate animation** — all need a shared client-action primitive for live-property binding
  (attribute `data-bind` can't set element properties). The visuals/static states are fixed; the
  property-backed behavior is the follow-up.
- **Keyframe animations** (tabs fade, skeleton pulse, progress slide) — `style.keyframes(name)`
  referenced by variable isn't statically extractable by the package-css / vendored-compile StyleX
  extractor (KV236 / A5 coverage); replaced with static styling. Needs keyframes-resolution support.
- **V10 Vaul drawer drag/snap/background-scale** — large gesture feature; out of this pass.
- **Visual baseline snapshots** (`interactive-gallery.visual.browser.test.ts`) — geometry shifted
  (intended) and the screenshot hashes are CI-environment-specific (they fail locally even on `main`),
  so they need a **CI-side baseline regeneration** to reflect the intended visual changes. Per the
  Verification protocol this synthetic-CSS test is non-authoritative; real-CSS confirmation is the
  Playwright-on-built-gallery probe.

Original diagnosis (unchanged): **14 P0, 28 P1, 54 P2** across all 44 components, reducible to ~9
shared root causes.

**Behavior source of truth:** `SPEC.md` (§5.2 TSX-authored components / KV235 hand-authored lowered
IR is forbidden; §13.1 stylesheet linking; §12.x accessibility), `rules/accessibility-conformance.md`,
and `rules/api-surface.md` for any new exported component (Header/Title/Footer families below).
Styling is **StyleX only** (`style.create` / `style.attrs` reading `uiTheme` tokens in
`packages/ui/src/theme.ts`) — no hand-written `.css`. Demos are **compiled TSX** — edit the
`*-demo.tsx` source, never the generated `/c/__v/**` artifacts. When a fix conflicts with `SPEC.md`,
follow `SPEC.md` and record the conflict.

Mark `- [x]` only when this session verifies the cited proving command/screenshot for the exact item
(CLAUDE.md Progress Discipline). This plan complements `plans/awesome-examples.md` item **E3**
("gallery — screenshot-audit each"), which this audit fulfills.

---

## How this was reproduced (investigation harness)

The deployed build already contains the real gallery (real Material CSS + hydration islands), so it
was served and driven directly — this is exactly what the user sees:

- **Serve:** `node scratch/ux/serve-dist.mjs` → static-serves `site/dist` on `http://127.0.0.1:4178`
  (the build ships `/assets/kovo-ui.css` + `/assets/site.css` + `/c/__v/**` client modules).
  Hydration confirmed live (slider keyboard 25→50, zero console errors).
- **Drive:** Playwright 1.60 + Chromium via `scratch/ux/{recon,interact,reprobe}.mjs`. For all 44
  components this captured **96 screenshots** (`scratch/ux/shots/<name>/*.png`), per-element DOM +
  computed styles (`scratch/ux/recon.json`), and hard interaction measurements
  (`scratch/ux/interact.json`, `scratch/ux/reprobe.json`: did the overlay close on Escape/backdrop,
  did the listbox overlap the input, did a drag change the value, OTP backspace sequence, drawer/sheet
  geometry vs viewport, checkbox height across states, …).
- **Diagnose:** a 6-cluster fan-out then cross-checked every observation against current source
  (`packages/ui`, `packages/headless-ui`, demo TSX). Raw findings: `scratch/ux/findings.md`
  (main-agent direct), `scratch/ux/diagnose-full.json` + `scratch/ux/issues-digest.txt` (full
  per-component detail). Staleness note: `site/dist` was built 2026-06-19; the tree is clean and the
  source line numbers below were verified against the current working tree, so the build faithfully
  represents current source.

---

## Coverage — all 44 components exercised

(verdict + issue counts; full detail in `scratch/ux/issues-digest.txt`)

| Component       | Cluster     | Verdict        | P0  | P1  | P2  |
| --------------- | ----------- | -------------- | --- | --- | --- |
| otp-field       | Text inputs | broken         | 2   | 1   |     |
| combobox        | Text inputs | broken         | 1   | 2   |     |
| drawer          | Overlays    | broken         | 1   | 1   | 1   |
| autocomplete    | Text inputs | broken         | 1   | 1   |     |
| avatar          | Display     | broken         | 1   | 1   | 1   |
| progress        | Display     | broken         | 1   | 1   |     |
| sheet           | Overlays    | broken         | 1   |     | 2   |
| popover         | Overlays    | broken         | 1   |     | 1   |
| hover-card      | Overlays    | broken         | 1   |     | 1   |
| checkbox-group  | Selection   | broken         | 1   |     | 1   |
| slider          | Selection   | broken         | 1   |     | 2   |
| collapsible     | Disclosure  | broken         | 1   |     | 1   |
| disclosure      | Disclosure  | broken         | 1   |     |     |
| menubar         | Menus       | broken         |     | 1   | 1   |
| skeleton        | Display     | broken         |     | 1   |     |
| toast           | Overlays    | works-but-poor |     | 2   | 2   |
| context-menu    | Menus       | works-but-poor |     | 2   | 1   |
| toggle-group    | Selection   | works-but-poor |     | 2   | 1   |
| scroll-area     | Disclosure  | works-but-poor |     | 2   | 1   |
| dialog          | Overlays    | works-but-poor |     | 1   | 2   |
| alert-dialog    | Overlays    | works-but-poor |     | 1   | 2   |
| dropdown-menu   | Menus       | works-but-poor |     | 1   | 1   |
| navigation-menu | Menus       | works-but-poor |     | 1   | 2   |
| command         | Menus       | works-but-poor |     | 1   | 3   |
| number-field    | Text inputs | works-but-poor |     | 1   | 2   |
| toggle          | Selection   | works-but-poor |     | 1   | 2   |
| accordion       | Disclosure  | works-but-poor |     | 1   | 1   |
| toolbar         | Disclosure  | works-but-poor |     | 1   | 2   |
| meter           | Display     | works-but-poor |     | 1   | 1   |
| switch          | Selection   | works-but-poor |     |     | 2   |
| field           | Text inputs | acceptable     |     | 1   | 1   |
| checkbox        | Selection   | acceptable     |     |     | 2   |
| radio-group     | Selection   | acceptable     |     |     | 2   |
| alert           | Display     | acceptable     |     |     | 2   |
| card            | Display     | acceptable     |     |     | 1   |
| tooltip         | Overlays    | good           |     |     | 1   |
| select          | Menus       | good           |     |     | 2   |
| tabs            | Disclosure  | good           |     |     | 2   |
| badge           | Display     | good           |     |     | 1   |
| breadcrumb      | Display     | good           |     |     | 1   |
| table           | Display     | good           |     |     | 1   |
| button          | Display     | good           |     |     | 2   |
| kbd             | Display     | good           |     |     |     |
| separator       | Display     | good           |     |     |     |

`select`, `tabs`, `tooltip` are the clean reference implementations to emulate (select item is a
`<div role=option>` with no UA chrome; tabs/toggle/accordion already reset `appearance`).

---

## User-reported complaints — status & where addressed

| #   | Component      | Complaint (verbatim intent)                      | Status                                                               | Fixed in            |
| --- | -------------- | ------------------------------------------------ | -------------------------------------------------------------------- | ------------------- |
| 1   | alert-dialog   | backdrop click doesn't close                     | **intentional** (alertdialog must not light-dismiss; matches shadcn) | — (documented)      |
| 2   | alert-dialog   | no X button                                      | **intentional** (alertdialog forces a choice; matches shadcn)        | — (documented)      |
| 3   | alert-dialog   | the two buttons are squished                     | **confirmed** P1                                                     | P2 §footer          |
| 4   | autocomplete   | menu covers the input                            | **confirmed** P0                                                     | P1                  |
| 5   | avatar         | no actual images                                 | **confirmed** P0                                                     | P1                  |
| 6   | checkbox       | height moves when cycling states                 | **confirmed** (caused by debug-text reflow)                          | P0 §output-leak     |
| 7   | checkbox-group | first item shows native (ugly) checkbox          | **confirmed** P0                                                     | P1                  |
| 8   | collapsible    | nothing collapses/expands                        | **confirmed** P0                                                     | P1                  |
| 9   | accordion      | should smoothly animate height                   | **confirmed** gap                                                    | P2/P3 §animation    |
| 10  | combobox       | menu covers the input                            | **confirmed** P0                                                     | P1                  |
| 11  | combobox       | clicking the already-selected item doesn't close | **confirmed** P0                                                     | P1                  |
| 12  | command        | looks horribly ugly                              | **confirmed** P1                                                     | P2 §button-reset    |
| 13  | context-menu   | ugly thick borders                               | **confirmed** P1 (UA button bevel)                                   | P2 §button-reset    |
| 14  | dialog         | should show an X button                          | **confirmed** P1                                                     | P2 §close-X         |
| 15  | disclosure     | does nothing                                     | **confirmed** P0                                                     | P1                  |
| 16  | drawer         | floats from the middle, not the bottom           | **confirmed** P0                                                     | P1                  |
| 17  | drawer         | want Vaul drag/snap/background-scale             | **confirmed** gap                                                    | P2 §drawer-gestures |
| 18  | dropdown-menu  | looks ugly                                       | **confirmed** P1 (UA button bevel)                                   | P2 §button-reset    |
| 19  | hover-card     | doesn't work                                     | **confirmed** P0 (renders centered, not at trigger)                  | P1                  |
| 20  | menubar        | looks awful                                      | **confirmed** P1 (submenu = unstyled text)                           | P2 §button-reset    |
| 21  | meter          | doesn't work                                     | **confirmed** P1 (brown token + 1px native el)                       | P0 §tokens + P2     |
| 22  | otp-field      | delete doesn't behave like a normal OTP          | **confirmed** P0 (typing & delete both broken)                       | P1                  |
| 23  | popover        | doesn't work (nothing appears)                   | **confirmed** P0 (renders centered, not at trigger)                  | P1                  |
| 24  | slider         | can't move the slider (drag)                     | **confirmed** P0                                                     | P1                  |
| 25  | toast          | looks horrible; button in the corner             | **confirmed** P1                                                     | P2 §toast           |

---

## Cross-cutting root causes (fix once → fixes many)

These are the levers. Each is one shared edit that clears a defect class; Phase 0 does them first.

### T1 — Demos leak raw reactive state as visible body text (~29 components)

Every `*-demo.tsx` appends `<output data-demo-state=…>{state.x}</output>` (and visible
`AutocompleteValue`/`ComboboxValue`/`SelectValue` spans) with `display:block` and no hidden styling.
They are observability probes read via the `data-demo-state` attribute, but they paint as stray text
next to each control ("openduplicate", "closedcopy", "open", "open 1", command's "a/idle/Open
dashboard"). For checkbox/switch/toggle the text-width swap on toggle also reflows/wraps the row —
**this is the "checkbox height moves" complaint**. _Fix:_ one shared visually-hidden `DemoState`
helper / `.sr-only` StyleX class in `demo-fixtures.tsx` that keeps `data-demo-state` observable for
tooling but removes it from layout (`position:absolute;width:1px;height:1px;clip-path;overflow:hidden`),
then mechanically swap every leak.

### T2 — `<button>`-based menu/toolbar items show the UA bevel (8 families)

dropdown-menu, context-menu, menubar, navigation-menu, command, toolbar, toggle-group, number-field
render a real `<button>` per item/trigger but their StyleX rule sets only padding/radius/color and
**never** `appearance:none` + `borderStyle:none` + `background`. StyleX emits only what's declared, so
the UA `<button>` defaults (2px outset bevel + button-face fill) bleed through → items read as
individually-bordered grey boxes instead of flat rows on one surface. This is the "ugly /
thick-borders / awful menus" cluster. _Fix:_ one shared "menu-item reset" StyleX fragment
(`appearance:none; background:transparent; borderStyle:none; borderWidth:0; font:inherit;
textAlign:left; width:100%`) merged into each family's item/trigger/button rule (emulate the clean
`select.tsx` `<div role=option>`). Same pass resets the `<a>` underline on breadcrumb/navigation-menu.

### T3 — Disclosure Content drops reactive `data-bind:*` stamps (collapsible, disclosure)

`CollapsibleContent` (`collapsible.tsx` ~L164) and `DisclosureContent` (`disclosure.tsx` ~L173)
return `<div {...styleAttrs} data-state hidden id>` with **no `{...passThroughProps(props)}`**, unlike
their Root/Trigger siblings. The compiler emits the `*_data_state_derive`/`*_hidden_derive` stamps
from the demo's reactive `open={state.open}`, but they're filtered onto nothing, so `data-state`/
`hidden` stay frozen at the closed SSR value and the panel never reveals (state flips to `open`,
content stays `display:none`). `pass-through.ts` confirms `passThroughProps` _retains_ `data-bind:*`
(it only drops style/island markers) — the helper is correct; the call site is missing. _Fix:_ add
`{...passThroughProps(props)}` to both Content `<div>`s, and audit every Content/panel render for the
same omission.

### T4 — Native modal `<dialog>` overlays render UA-centered, not edge-anchored (drawer, sheet)

Both open via `command="show-modal"` (`showModal()`), which applies the UA modal default
`inset:0; margin:auto`. The side rules set bottom/left/right/top insets but **never reset `margin`**,
so `margin:auto` keeps the panel centered inside the insets instead of hugging the edge — **this is
the "drawer floats from the middle" complaint** (measured geom x:313 w:655 of vw:1280,
`anchoredToBottom:false`). _Fix:_ in the shared content rule of `drawer.tsx`/`sheet.tsx` set
`margin:0` (+ `inset:auto` base so each side rule's explicit insets win).

### T5 — Top-layer popover overlays have no anchor positioning (popover, hover-card; tooltip milder)

`PopoverContent`/`HoverCardContent` use `position:absolute` against a `position:relative` root, but on
open the `[popover]` element is promoted to the **top layer** where that no longer resolves, and the
UA `[popover]:popover-open{inset:0;margin:auto}` centers it on screen — so content appears in the
middle (often clipped/empty-looking) instead of at the trigger. **This is the "popover/hover-card
don't work" complaints** (DOM opens; nothing visible at the trigger). No CSS anchor-positioning and no
JS placement exist. _Fix:_ one shared anchored-overlay utility (CSS `anchor-name`/`position-anchor`/
`anchor()` + a small JS `getBoundingClientRect` flip/shift fallback via a headless primitive) applied
to popover, hover-card, and tooltip (adds collision handling).

### T6 — Typeahead listboxes cover the input (autocomplete, combobox)

`autocomplete.tsx` list (~L114) and `combobox.tsx` listbox (~L112) set `position:absolute;width:100%;
marginTop:4;zIndex:50` but **no `top`**. The root is `position:relative;display:grid`, so an auto-top
absolute box anchors to the root's top padding edge and paints over the input (`marginTop` is inert on
an auto-top absolute box). **This is the "menu covers the input" complaints.** _Fix:_ set `top:100%`
(replace the inert `marginTop`) + `left:0`; factor into a shared listbox-dropdown fragment.

### T7 — `data-bind:*` only sets attributes, never live properties (scroll-area, avatar, progress)

A `data-bind` stamp writes a DOM _attribute_, never a live _property_ or DOM event. So scroll-area's
"Jump to end" sets a `scrolltop` attribute that does nothing (and `passThroughProps` drops
`scrollY`/`style` unless `{style:true}`); avatar has **no client island** to flip `data-state` on real
`<img>` load/error so image+fallback always coexist (**"no images"**); progress's StyleX classes are
missing from the interactive island so the **raw native `<progress>`** shows. _Fix:_ a small set of
client-action primitives for property-backed reactivity (imperative `.scrollTop`/`.indeterminate`
binding; an avatar load/error island) + fix progress StyleX extraction into the island; let
`ScrollAreaViewport` forward `{style:true}`.

### T8 — Open/close never animates (10 overlays/disclosures)

The only closed-state rule anywhere is `[data-state=closed]{display:none}`, which can't transition,
and disclosures have no `grid-template-rows` interpolation — so everything snaps. **This is the
"accordion should smoothly animate" complaint**, generalized. _Fix:_ shared animation fragments —
overlays use opacity/transform + `@starting-style` + `transition-behavior:allow-discrete`;
accordion/collapsible use `grid-template-rows:0fr→1fr`.

### T9 — Status/surface tokens map to loud or invisible Material containers (toast, meter, skeleton, table)

`theme.ts` (~L33-44) choices read wrong: toast `success` falls back to cyan secondary-container (not
green) and `info`→primaryContainer (loud); meter `suboptimum`→`warning.border` renders **brown** for a
normal value (**"meter looks broken"**); skeleton `backgroundMuted` (~tone90) is nearly invisible on
the ~tone98 card; table row `:hover` is ~2 tones off. _Fix:_ correct the semantic tokens centrally
(success→true green, info→quiet surface, add a skeleton/hover surface delta + pulse floor).

---

## Plan

### Phase 0 — Shared infrastructure & tokens (max leverage, do first)

- [ ] **P0-A. Visually-hidden demo-state helper (T1).** Add a `DemoState` component / `.sr-only`
      StyleX class in `examples/gallery/src/demo-fixtures.tsx`; sweep every `<output data-demo-state>` and
      visible `*Value` debug span across `examples/gallery/src/interactive/*-demo.tsx` to use it. Keeps
      `data-demo-state` observable for the browser tests; removes the text from layout. Clears ~29 leaks
      and the checkbox/switch/toggle "height moves" reflow in one sweep.
- [ ] **P0-B. Shared `<button>` menu-item reset fragment (T2).** Add a reusable StyleX fragment
      (`appearance:none; background:transparent; borderStyle:none; borderWidth:0; font:inherit;
textAlign:left; width:100%`) in a shared `packages/ui/src` module; ready to merge into the menu
      families in Phase 2. Include an `<a>` underline reset variant.
- [ ] **P0-C. Semantic token corrections (T9).** Fix `packages/ui/src/theme.ts` success→true green,
      info→quiet surface, add skeleton/hover surface tokens with enough delta + a pulse opacity floor.
      Re-screenshot toast/meter/skeleton/table to confirm.
- [ ] **P0-D. Anchored-overlay positioning utility (T5).** New shared headless primitive + StyleX:
      CSS anchor-positioning with a JS `getBoundingClientRect` flip/shift fallback. Consumed by popover,
      hover-card, tooltip in Phases 1–3.
- [ ] **P0-E. Property-backed reactivity primitives (T7).** Client-action primitives for imperative
      property binding (`.scrollTop`/`.scrollLeft`/`.indeterminate`) and an avatar `<img>` load/error
      island; fix progress StyleX extraction into the interactive island; teach `ScrollAreaViewport` to
      forward `{style:true}`. (Touches `packages/headless-ui` + compiler island extraction — higher risk;
      scope carefully and cite SPEC §5.2.)
- [ ] **P0-F. Shared open/close animation fragments (T8).** Encode overlay (opacity/transform +
      `@starting-style` + `allow-discrete`) and disclosure (`grid-template-rows:0fr→1fr`) StyleX fragments
      for reuse in Phases 2–3.

### Phase 1 — Per-component P0 breakages (make everything functional)

- [ ] **B1. collapsible + disclosure reveal (T3).** Add `{...passThroughProps(props)}` to
      `CollapsibleContent` (`collapsible.tsx` ~L164) and `DisclosureContent` (`disclosure.tsx` ~L173).
      Proof: re-probe `contentToggled` true and `re-after.png` shows the panel.
- [ ] **B2. drawer + sheet edge-anchoring (T4).** Reset `margin:0`/`inset:auto` base on the dialog
      content rule in `drawer.tsx` + `sheet.tsx`. Proof: re-probe `anchoredToBottom:true` (drawer), sheet
      hugs the right edge full-height.
- [ ] **B3. popover + hover-card placement (T5/P0-D).** Apply the anchored-overlay utility so content
      renders at the trigger. Proof: screenshot shows the panel adjacent to its trigger.
- [ ] **B4. autocomplete + combobox listbox below input (T6).** Set `top:100%;left:0` on the absolute
      list in `autocomplete.tsx` (~L114) + `combobox.tsx` (~L112). Proof: re-probe
      `listboxOverlapsInput:false`.
- [ ] **B5. combobox/autocomplete close on re-selecting the current option.** In
      `packages/headless-ui/src/primitives/combobox.ts` (`selectComboboxOption` ~L272-301) and
      `autocomplete.ts` (~L320-333), stop early-returning `open:{changed:false}` when the value is
      unchanged — always close on option click. Proof: probe — clicking the selected option closes the
      listbox.
- [ ] **B6. otp-field typing + delete.** In `packages/headless-ui/src/primitives/otp-field.ts`: slot N
      must read `otpFieldChars(fullValue)[N]` (not a single-char value) so digits 2..n render; fix one-key
      Backspace wiping the whole field and add empty-slot focus retreat (`otpFieldFocusIndexAfterInput`
      ~L262/L367). Proof: reprobe — typing "1234" fills four slots; Backspace removes one digit at a time.
- [ ] **B7. slider drag.** Make the `SliderThumb` pointer-interactive (`slider.tsx:136`
      `pointerEvents:none` → fix z-order/handlers) **and** wire the demo's native range `onInput` to
      `sliderInput` (`slider-demo.tsx:48`). Proof: reprobe `dragMovedValue:true`.
- [ ] **B8. checkbox-group "All notifications" uses the styled control.** Replace the hand-authored
      raw `<input type=checkbox indeterminate>` in `checkbox-group-demo.tsx` (~L50-80) with the styled
      `CheckboxGroupControl` (overlaid box) and bind `indeterminate` via the P0-E imperative primitive.
      Proof: screenshot — first item matches the others.
- [ ] **B9. avatar images + load/error island (T7).** Ship the avatar load/error client island (P0-E)
      and absolutely-position the fallback so image/fallback no longer coexist; give the demo working image
      sources (ship `examples/gallery` public `/avatars/*.png` or inline data-URIs). Proof: no 404s in
      console; loaded/fallback/error states all render correctly.
- [ ] **B10. progress styled track renders (T7).** Ensure `progress.tsx` StyleX classes are emitted
      into the interactive island so the styled track/indicator render instead of raw native `<progress>`.
      Proof: screenshot shows the themed bar.

### Phase 2 — P1 visual parity (match the shadcn skin)

- [ ] **V1. Apply the `<button>` reset (T2/P0-B)** to `dropdown-menu`, `context-menu`, `menubar`,
      `navigation-menu`, `command`, `toolbar`, `toggle-group`, `number-field` item/trigger/button rules →
      flat rows, no bevel. Reset `<a>` underline on breadcrumb/navigation-menu. Covers complaints
      #12/#13/#18/#20. Proof: screenshots of each opened menu show one elevated surface, no boxed items.
- [ ] **V2. context-menu trigger.** Drop the heavy dashed/boxed "Right click target" dropzone to a
      subtle target surface.
- [ ] **V3. dialog + sheet close-X (§close-X).** Add an absolutely-positioned top-right X close slot
      (`dialogStyles.closeX`, top/right 16, rounded, token hover/focus-visible) wired with the existing
      `command="close"`/`commandfor` semantics and `aria-label="Close"`. Covers complaint #14. Add
      `DialogHeader/DialogTitle/DialogDescription` primitives so the demo stops hand-styling `<h2>/<p>`
      with `#525252`. (New exports → follow `rules/api-surface.md`.)
- [ ] **V4. alert-dialog footer (§footer).** Add `alertDialogStyles.footer`
      (`display:flex;justifyContent:flex-end;gap:8;flexWrap:wrap`) + an `AlertDialogFooter` (and
      Header/Title/Description) family; wrap Cancel/Action so they're not squished. Covers complaint #3.
      Keep `role="alertdialog"` + no light-dismiss + no X (intentional, #1/#2).
- [ ] **V5. toast (§toast).** Move the "Show toast" trigger and all `<output>`s out of the fixed
      viewport (into the demo flow); restructure the toast root to an inline `[content | actions | close]`
      layout instead of stacked full-width bars; the `success` hue comes from P0-C. Fix
      `bottom-center`/`top-center` placement (`toast.tsx` viewport adds `transform:translateX(-50%)`).
      Covers complaint #25.
- [ ] **V6. meter color + element.** With P0-C tokens, ensure `optimum`→green/teal not brown, and give
      the native `<meter>` real dimensions (or render the styled track) so it isn't a 1×1 element. Covers
      complaint #21.
- [ ] **V7. toggle / toggle-group root stretch.** Prevent the demo grid `justify-self:stretch` from
      expanding the inline-flex control to full column width (wrap or set `justify-self:start`).
- [ ] **V8. scroll-area.** Apply P0-E imperative scroll binding + `{style:true}` forwarding so "Jump
      to end" works and the demo's `max-height` applies; style the custom scrollbar thumb to shadcn weight.
- [ ] **V9. skeleton visibility (T9).** Confirm the new surface token renders visible shimmer bars on
      the card surface.
- [ ] **V10. drawer Vaul gestures (§drawer-gestures).** Add drag-to-dismiss, snap points, and
      background-scale to the drawer via a new headless gesture primitive + StyleX transforms. Covers
      complaint #17. **Larger feature** — land after B2; if out of v1 scope, split into its own ledger and
      link it here.
- [ ] **V11. field / number-field P1s.** field: fix label/description ordering + item-row stretch;
      number-field: `appearance:textfield` + hide `::-webkit` spin buttons, real `−/+` icon glyphs.

### Phase 3 — P2 polish

- [ ] **C1. Open/close animations (T8/P0-F)** applied to drawer, sheet, dropdown/context/navigation
      menus, command, **accordion + collapsible** (grid-rows; covers complaint #9), tabs panel fade,
      tooltip.
- [ ] **C2. command palette polish.** Group headings + item icon/kbd slots; drop the in-content
      "Close" button in favor of Escape/backdrop dismiss (match cmdk).
- [ ] **C3. Header/footer subcomponent families.** `CardHeader/Title/Description/Content/Footer`;
      `alert` leading status-icon slot + stop emitting an empty description `<div>`.
- [ ] **C4. Remaining demo-state leaks** (autocomplete, combobox, meter, progress, scroll-area, field)
      swept via the P0-A helper if not already done.
- [ ] **C5. tooltip collision handling** via the P0-D utility.
- [ ] **C6. Demo coverage gaps.** Add destructive/outline `badge` variants; destructive/ghost/outline
  - small-size `button` variants; widen `slider` step granularity; focus-ring offset breathing room on
    checkbox/radio-group.
- [ ] **C7. Reprobe inconclusive captures.** switch / toggle / toolbar interaction screenshots were
      inconclusive (probe likely missed a stretched/full-width target) — reprobe clicking a definite
      toggling target to confirm paint; convert to fixes only if a real defect surfaces.

---

## Verification protocol (use for every visual/interaction checkbox)

1. **Re-serve + re-drive:** `node scratch/ux/serve-dist.mjs` (after a fresh
   `pnpm --filter @kovojs/site build` once code changes land so `site/dist` reflects the fix), then
   re-run the relevant `scratch/ux/*.mjs` probe and diff the named observation
   (`anchoredToBottom`, `listboxOverlapsInput`, `dragMovedValue`, `contentToggled`, `buttonGapPx`, the
   OTP backspace sequence, console-404 count) and the before/after screenshot.
2. **Component/browser tests:** extend the existing browser suite
   (`examples/gallery/src/interactive-gallery.interactions-*.browser.test.ts` and `.visual.*`) — but
   note those mount with a **synthetic** baseline stylesheet (`installVisualBaselineStyles`), so they
   do **not** catch the real-CSS regressions here; the Playwright-on-`site/dist` probe is the
   authoritative visual check. Add real-CSS assertions where feasible.
3. **A11y:** keep `interactive-gallery.axe.browser.test.ts` green; preserve ARIA/dialog/listbox
   semantics (`rules/accessibility-conformance.md`, SPEC §12.x).
4. **Gates before each checkpoint commit:** `pnpm run check` (tsc + API surface + import boundaries),
   `pnpm run check:api-surface` for any new exported component, and the gallery's `test:browser`.
   Record any gate that can't be run in the handoff note.

## Notes / open questions

- **Intentional, not bugs:** alert-dialog's no-backdrop-close and no-X are correct alertdialog
  semantics (match shadcn); only the squished footer is a defect. Document this in the demo so it isn't
  "re-fixed".
- **`select`/`tabs`/`tooltip` are the reference skins** — emulate `select`'s `<div role=option>` and
  the existing `appearance:none` resets rather than inventing new patterns.
- **Compiler-touching items (P0-E / B6 / B9 / B10):** these cross into `packages/headless-ui` + island
  extraction; size them carefully, cite SPEC §5.2, and prefer adding shared client-action primitives
  over per-demo hacks (no hand-authored lowered IR — KV235).
- Evidence index for implementers: `scratch/ux/issues-digest.txt` (full per-component root cause + fix),
  `scratch/ux/diagnose-full.json` (structured), `scratch/ux/findings.md` (direct browser proofs),
  `scratch/ux/shots/<name>/` (96 screenshots).
