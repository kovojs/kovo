# Components Parity — Interactive Gallery vs shadcn/ui

**Goal:** Bring the interactive `@kovojs/ui` gallery components (served at
`/gallery/components/<name>/`) to visual + interaction parity with shadcn/ui for the ten components
the user flagged: command menu, accordion, OTP field, context menu, skeleton, slider, tooltip,
field, combobox (plus the shared cleanups they surface).

**Branch / worktree:** `agent/components-parity` (worktree `../kovo-components-parity`).

**Architecture recap (so fixes cite the right layer):**

- Styled components: `packages/ui/src/*.tsx` — StyleX (`style.create`/`style.attrs`) reading tokens
  from `packages/ui/src/theme.ts`. No hand-written CSS (SPEC.md §13.1).
- Behavior primitives: `packages/headless-ui/src/primitives/*.ts` — pure functions returning result
  objects the demo applies to `state`.
- Live demos: compiled TSX islands `examples/gallery/src/interactive/*-demo.tsx`
  (`component({ state, render })`). Handlers call headless functions + mutate `state`, and may do
  imperative DOM (`event.target.closest(...)`, `querySelector`, `.focus()`, `preventDefault`).
- Some demos are static fixtures in `examples/gallery/src/demo-fixtures.tsx` (e.g. skeleton).
- The always-loaded client loader (`packages/browser/src/inline-loader.ts`, canonical readable
  source in `inline-loader-build.ts`, SPEC.md §4.4) delegates events on the **capture phase** and
  dispatches handlers through an **async** function that does `await import(client-module)` before
  running the compiled handler.

**Verification harness:** `examples/gallery` browser suite
(`vitest --config vitest.browser.config.ts`, Playwright/chromium) drives the compiled demos via
`mountInteractiveDemo` + `userEvent`. Run gates: `pnpm exec vp check`, `check:api-surface`,
`check:inline-loader`.

---

## Checklist

- [x] **Command menu** — dialog `padding:0`/`overflow:hidden`; borderless input header + real `<svg>` search icon + bottom divider; flush borderless list; full-contrast item rows; demo sr-only's the title/description/value/close. `command.tsx`, `command-demo.tsx`.
- [x] **Accordion** — added `overflow:'hidden'` to `accordionStyles.content` so the collapsed `0fr` grid track clips the leaked first line. `accordion.tsx`.
- [x] **OTP field** — all 12 slot handlers now imperatively `.focus()` `#gallery-interactive-otp-slot-${focusIndex}` after setting `activeSlot`. New browser test asserts real `document.activeElement` crosses slots on type/arrow + delete. `otp-field-demo.tsx`.
- [x] **Context menu** — loader (`inline-loader-build.ts` `dispatch`) cancels `contextmenu` synchronously + sets `kovoNativeDefaultManaged`; `contextMenuTriggerContextMenu` no longer bails on that framework suppression. Regenerated `inline-loader.ts`. New loader test asserts synchronous prevention.
- [x] **Skeleton** — `SkeletonDemo` rebuilt as a circular-avatar + two-line card silhouette. `demo-fixtures.tsx`.
- [x] **Slider** — thumb `:focus-visible`/`[data-dragging]` 4px primary ring (thumb is already keyboard-focusable, no state change), thumb 16→18, root `minHeight` 20→24, demo `step` 25→5. `slider.tsx`, `slider-demo.tsx`.
- [x] **Tooltip** — placed above the trigger, centered rotated-square arrow, `radius.md`, `paddingInline:12`, softened shadow, robust non-anchor centering. `tooltip.tsx`.
- [x] **Field** — required emphasis scoped to the label (not the whole field), error un-bolded, focus switched to a 3px primary ring. `field.tsx`.
- [x] **Combobox** — `ComboboxInput` gets an `onClick` open-on-pointer (listbox started hidden with no opener). New browser test: click input → opens; click current option → closes. `combobox-demo.tsx`.

---

## 1. Command menu — `@kovojs/ui/command`

**Current:** `packages/ui/src/command.tsx`. Dialog has `padding:16` and the demo
(`command-demo.tsx`) renders a visible `<h2>` title, `<p>` description, a bottom `CommandValue`
span, and a footer Close button — clutter shadcn hides. The search `<input>` is a bordered rounded
box whose magnifier is a `::before` (lines 188-194) that **does not render on a replaced `<input>`**
→ no icon. The listbox (lines 270-288) keeps its own border + shadow + `marginTop:12`, producing a
bordered box-in-a-box inside the dialog. Item default color is `foregroundMuted` (labels too dim).
`heading`/`itemIcon`/`itemShortcut` styles exist (207-269) but are unused.

**Gap vs shadcn** (https://ui.shadcn.com/docs/components/base/command): clean rounded shell
(`padding:0`), borderless input header with a real leading search icon and a bottom divider, a flush
borderless scrollable list, full-contrast item labels with muted right-aligned shortcuts, no
heading/description/value chrome in the body.

**Fix:** `command.tsx` — dialog `padding:0`, `overflow:hidden`; input → borderless header with
`borderBottom` divider, real icon rendered as a sibling `<span aria-hidden>` inside a flex wrapper
(remove the non-rendering `::before`); listbox → drop border/shadow/`marginTop`, `overflow:auto`;
item default `color: foreground`. `command-demo.tsx` — visually-hide (`sr-only`) the title /
description / value / close so the dialog body is just input + list, and give items a leading icon.

---

## 2. Accordion — `@kovojs/ui/accordion`

**Current:** `packages/ui/src/accordion.tsx`. `AccordionContent` is a grid wrapper (`content`,
lines 69-81: `display:grid; gridTemplateRows:1fr → 0fr` on `[data-state=closed]`) around a padded
inner div (`contentInner`, 82-96: `minHeight:0; overflow:hidden`). The primitive sets `hidden:!open`
but the author rule `display:grid` deliberately defeats UA `[hidden]{display:none}` so the grid-row
transition can run. **Root cause of the "second line cutoff when collapsed":** the clipping
`overflow:hidden` lives only on `contentInner`; the collapsed `0fr` **track** (`content`) has no
`overflow:hidden`, so leading/sub-pixel residue of the first content line leaks past the collapsed
track.

**Fix:** add `overflow: 'hidden'` to `accordionStyles.content`. One line; guarantees the `0fr` track
clips. (Visual baseline height/hash for the accordion route will shift intentionally.)

---

## 3. OTP field — `@kovojs/ui/otp-field`

**Current:** `examples/gallery/src/interactive/otp-field-demo.tsx`. Each slot's
`onInput`/`onKeyDown`/`onPaste` computes `result.focusIndex` (headless `otpFieldInput` →
`otpFieldFocusIndexAfterInput`, `otp-field.ts:190-202`) and sets `state.activeSlot = focusIndex`,
which only flips `tabIndex`. **No handler ever `.focus()`es the target slot.** Slots are
`maxLength:1`, so after typing a digit focus must advance or the user can't continue; Backspace can't
step back. (Browser tests dispatched `input` directly on each slot, never asserting
`document.activeElement` — masking the bug. The prior pass's "not reproduced" was that probe
artifact.)

**Fix (demo only):** in all 12 handlers, after setting `state.activeSlot`, imperatively focus the
target slot, mirroring the accordion idiom (`accordion-demo.tsx:46-48`):
`event.target.closest('[data-gallery-interactive="otp-field"]').querySelector('#gallery-interactive-otp-slot-${focusIndex}').focus()`.

---

## 4. Context menu — `@kovojs/ui/context-menu`

**Current:** the native menu still appears on right-click. This is **not** a missing
`preventDefault` — the headless `contextMenuTriggerContextMenu` (`context-menu.ts:402-421`) calls
`event.preventDefault()`, and the demo wires it (`context-menu-demo.tsx:60-77`). **Root cause is
timing:** the loader dispatches handlers through an `async` function that does
`await import(client-module)` **before** running the compiled handler, so the handler's
`preventDefault()` lands after the synchronous `contextmenu` dispatch window has closed — the native
menu is already shown. `defaultPrevented` still flips true afterward, which is why the synchronous
unit test passes while a real browser leaks the menu. A demo-only `preventDefault` would also run
post-`await` and not help.

**Fix (loader — the only place that can cancel synchronously):** in the canonical readable source
`inline-loader-build.ts` `dispatch`, right after `if (!el || !refs) return;` (i.e. in the
synchronous prefix, before the awaited import — exactly where enhanced-`submit` already calls
`preventDefault`), add: `if (event.type === 'contextmenu' && event.cancelable) event.preventDefault();`
Then regenerate `inline-loader.ts` via `build:inline-loader` and re-run `check:inline-loader` (8KB
gzip budget). Suppresses the native menu for any element wired with `on:contextmenu` while the async
handler still opens the styled menu.

---

## 5. Skeleton — `@kovojs/ui/skeleton`

**Current:** `SkeletonDemo` in `demo-fixtures.tsx` renders two context-free gray rectangles (a line
and a panel). With no content silhouette and (per `skeleton.tsx:12-21`) no pulse animation —
`style.keyframes` is name-only and not statically extractable (KV236) — the demo reads as
meaningless blocks ("can't tell what it does").

**Fix (demo only):** rebuild `SkeletonDemo` as shadcn's card silhouette — a `radius.full` circular
avatar (48×48) beside two stacked text lines (16×220, 16×160) in a flex row. No component change; the
`style` override prop already accepts arbitrary width/height/radius. Pulse stays out of scope.

---

## 6. Slider — `@kovojs/ui/slider`

**Current:** `packages/ui/src/slider.tsx` + `slider-demo.tsx`. Pointer drag, track click, and
keyboard are all wired (the native range overlay is the pointer/focus target; the thumb has
`pointerEvents:none`). "Hard to use" is: (a) demo `step:25` → only 5 stops, so drag/keys jump
coarsely; (b) thumb is 16px with **no focus ring** — keyboard focus lands on the opacity-0 input so
there is no visible focus feedback; (c) small grab zone (`root.minHeight:20`).

**Fix (no state change — keeps the 6 exact `kovo-state` assertions and the compile-test handler
inventory intact):** the **thumb** is already keyboard-focusable (`role=slider`, `tabIndex:0`,
`onKeyDown`), so add `:focus-visible` + `[data-dragging]` ring branches directly to
`sliderStyles.thumb` (shadcn's 4px primary ring), bump thumb to 18px, and `root.minHeight:24` for a
bigger target. Demo: `step:25 → 5` for smooth motion (test assertions use multiples of 5/25, so they
still hold). Keep the thumb pointer handlers (the compile test asserts they exist).

---

## 7. Tooltip — `@kovojs/ui/tooltip`

**Current:** `packages/ui/src/tooltip.tsx` `tooltipStyles.content` renders **below** the trigger
(`positionArea:'bottom'`, `marginTop:4`), has **no arrow**, a heavy two-layer drop shadow, tight
`paddingInline:10` / `radius.sm`, and centers only via CSS anchor positioning — in browsers without
it the pill lands at the root's top-left ("looks funny").

**Fix:** place above (`positionArea:'top'`, `marginBottom:6`); add a centered rotated-square `arrow`
span in `TooltipContent`; `paddingInline:10 → 12`, `radius.sm → md`; soften the shadow; harden the
non-anchor fallback with `left:50%; transform:translateX(-50%); bottom:100%` so it centers above the
trigger everywhere. No demo behavior change.

---

## 8. Field — `@kovojs/ui/field`

**Current:** `packages/ui/src/field.tsx`. `root` has `'[data-required]': { fontWeight: 500 }`
(218-219) which boldens the **entire** field (label + input text + description + error) when
required — the demo's email field is required, so it all reads semibold. The error is bold
(`fontWeight:500`), focus is a detached offset outline, and `field-demo.tsx` hardcodes off-theme
`<output>`/label text (`font-size:0.75rem;color:#6b7280`, `color:#171717`).

**Fix:** remove the whole-field `[data-required]` bold and scope emphasis to the label only; un-bold
the error; switch the control focus to a 3px primary ring (matching shadcn); de-hardcode the demo's
secondary text to themed tokens/sizes.

---

## 9. Combobox — `@kovojs/ui/combobox`

**Current:** `combobox-demo.tsx` starts `open:false` and the listbox renders `hidden={!state.open}`
(`display:none`). The only ways to open are typing or ArrowUp/Down — `ComboboxInput` has **no
`onClick`/`onFocus`**. So a mouse user can never open the list to click an option, and after any
selection (which closes the list) it can never be reopened by mouse → "selecting the current element
by clicking doesn't work." The re-select-while-open path itself is already correct (B5:
`selectComboboxOption` closes even when the value is unchanged).

**Fix (demo only):** add an `onClick` to `ComboboxInput` that opens the listbox (and highlights the
current value) when closed, mirroring `select-demo.tsx`'s trigger. No headless change.

---

## Shared root causes

- **Imperative focus after a state morph** is needed wherever roving focus changes (OTP slots) — the
  accordion idiom is the template.
- **Async handler dispatch can't cancel a native default** (context menu) — must be handled
  synchronously in the loader, like enhanced-submit already is.
- **Open-by-pointer affordance** missing on typeahead inputs (combobox).
- **StyleX clipping must live on the element that collapses** (accordion track).
- **Demos leaking off-theme/raw chrome** (command, field, skeleton) — use themed tokens / sr-only.

## Latest verification (2026-06-21, worktree `agent/components-parity`)

All authoritative gates green:

- `pnpm exec vp check --fix` → 0 type/lint errors across 1426 files.
- `check:api-surface` → baseline 1338, fixed-this-run 0 (no public-surface regressions; the new
  `commandStyles`/`tooltipStyles` keys and `ContextMenuTriggerEvent.kovoNativeDefaultManaged` field
  did not move the gate).
- `check:inline-loader` → passes (loader regenerated from canonical readable source; under the 8KB
  budget).
- Gallery **non-browser** suite (`vitest --run`) → 50/50 (compile, client-behavior, aria-contracts,
  behavior-contracts, demo-fixtures incl. regenerated static `visual-fixtures/*.html.txt`, artifacts,
  static-export incl. the **real-CSS context-menu suppression** probe).
- Gallery **browser** interaction/axe/aria suites → green, including **3 new behavior tests**: OTP
  cross-slot focus (`document.activeElement`), combobox open-on-click + re-select, and (in
  `@kovojs/browser`) the synchronous `contextmenu` default-cancel.
- `@kovojs/headless-ui` context-menu primitive (17) and `@kovojs/browser` loader suites (45) → green.

### Known non-authoritative gap

`examples/gallery/src/interactive-gallery.visual.browser.test.ts` (synthetic-CSS screenshot hashes +
page geometry) fails locally in this environment — but it fails **independently of these changes**
(e.g. the untouched `switchDemo` geometry renders 99 vs the committed 125, and the
`kbd`/`checkbox`/`dialog` hash sets don't include this env's deterministic values). These are
sub-pixel/font-render baselines that the prior `plans/better-components-ux.md` pass already classified
as **non-authoritative and CI-environment-specific** ("fail locally even on `main`"). The six changed
components additionally shift their hashes/geometry intentionally, so the affected baselines
(command/accordion/tooltip/slider/field/skeleton + the compiled-route height) need a **CI-side
baseline regeneration**. Authoritative confirmation is the green behavioral + real-CSS static-export
suites above.
