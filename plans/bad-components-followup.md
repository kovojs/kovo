# Gallery Components — Follow-up Audit (deployed kovo.sh) & Fixes

> **STATUS — IMPLEMENTED 2026-06-22** on branch `agent/gallery-audit2` (from `main`, which already
> carries the round-1 fixes in `plans/bad-components.md`). After round-1 shipped, the user reported
> three components still broken on the **deployed** site. This round drove the live site
> (`https://kovo.sh/components/*`) with Playwright (chromium 148) — real interaction is the ground
> truth — root-caused each, fixed them, and re-verified the round-1 fixes are live.

## Method

The deploy DID land (the live alert-dialog already carried round-1's close-X). So the three reports
were **insufficient round-1 fixes**, not a stale deploy. Each was reproduced by driving the live page:
type/click/keypress, then read computed styles / `kovo-state` / element geometry.

## The three reported issues — root causes & fixes

### 1. Accordion — collapsed panel still shows a ~16px sliver

- **Reproduced:** collapse the open "Shipping" item → content height `37px → 16px` (not 0). The outer
  panel reports `data-state="closed"` but the **inner** padded div reports `data-state="open"` (frozen).
- **Root cause:** the grid-rows collapse works, but the residual is the inner div's padding
  (`paddingTop:4 + paddingBottom:12 = 16px`), which is supposed to zero via
  `accordionStyles.contentInner['[data-state=closed]']`. That rule never fires client-side because the
  inner div only had a **static** `data-state={attrs['data-state']}` — no reactive binding. Only the
  outer panel forwarded the `data-bind:data-state` (via `passThroughProps`).
  `packages/ui/src/accordion.tsx:312`.
- **Fix:** forward the reactive stamp to the inner div too — `{...bindingProps(props, ['data-state'])}`
  (the slider/progress pattern). Now the inner padding collapses to 0 on close.

### 2. Alert-dialog — not centered on large viewports

- **Reproduced:** at 1680×1050 the dialog centered at `(1036, 704)` vs viewport center `(840, 525)`.
  It IS `:modal` (top layer), `position:fixed`, with `left/top:50%` + `translate(-50%,-50%)`, but the
  computed box had `inset: 525px 0 0 840px` and `margin: 178.5px 196px`.
- **Root cause:** the author CSS only overrode the inline/block-**start** insets. The UA `dialog:modal`
  rule's `right:0; bottom:0; margin:auto` survived, over-constraining the box so the auto-margins
  centered it in the **bottom-right quadrant** (between `left:50%/top:50%` and the viewport edges).
  `packages/ui/src/alert-dialog.tsx` content style.
- **Fix:** add `right:'auto'; bottom:'auto'; margin:0` so only `left/top:50%` + the translate apply →
  true viewport centering at any size.

### 3. Alert-dialog — backdrop click does not dismiss

- **Reproduced:** open dialog, click backdrop (20,20) → still open.
- **Root cause:** by round-1 design (WAI-ARIA alertdialog), no light-dismiss was wired; the backdrop is
  the `::backdrop` pseudo (not a clickable node). User explicitly wants backdrop-dismiss.
- **Fix:** add the native `closedby="any"` attribute to the `<dialog>` (chromium 148 supports it). It
  fires a `cancel` event on backdrop click (and Escape), which the demo's existing `onCancel` already
  syncs to `state.open=false`. The explicit X / Cancel / Action choices remain. (Escape already
  dismissed, so backdrop-dismiss is consistent, not a new a11y regression.)

### 4. Autocomplete — Enter does not select; "what's going on?"

- **Reproduced:** filtering WORKS (type "dev" → Design hidden, Development shown, `highlightedValue:
"development"`). But Enter **reloaded the page** to the seed state — and the URL became
  `?gallery-tag=dev`. That `?gallery-tag=dev` the user was stuck on is the _form submission result_.
- **Root cause:** the autocomplete input lives in `<form id="gallery-autocomplete-form">`. Enter in a
  single-input form triggers **implicit form submission** → navigates to `?gallery-tag=dev` → the demo
  re-renders at its initial seed (`inputValue:''`), so the input looks empty. The primitive only
  `preventDefault()`ed when `value.changed`, so the submit leaked through.
  `packages/headless-ui/src/primitives/autocomplete.ts:502-506`.
- **Fix:** always `event.preventDefault()` in the Enter branch when the list is open with a highlighted
  option (selecting from an open list must never fall through to the host form's submit).

## Round-1 fixes — re-verified LIVE (all pass)

Drove each on kovo.sh: **popover** opens (`display none→block`), **hover-card** shows on hover,
**progress** fill moves (252→630px), **meter** fill moves on "Optimize", **toggle-group** single-select
(select italic → bold `aria-pressed=false`), **combobox** filters (type "chi" → 1/3 shown), **command**
empty-state appears on no-match, **menubar** drops below the trigger (menu top ≥ trigger bottom),
**slider** keyboard increments cleanly (25→30→35→40→45). Round-1 holds up in production.

## Additional observations (NOT changed this round — need confirmation)

- **Slider pointer-drag**: keyboard via the thumb works perfectly; dragging the opacity-0 native-range
  overlay did not update `kovo-state` in the probe (`dragValueStart` stayed 25). May be a probe miss
  (overlay hit-testing) or a real drag-target issue. Worth a dedicated check.
- **OTP typing/auto-advance**: Backspace now deletes across slots (the round-1 "delete multiple" fix —
  `12 → 2 → ''`), but fast `type('1234')` only registered `12` and the delete order looked off. Likely
  a per-slot input-timing nuance; core complaint is resolved.

## Verification of this round's fixes

- `@kovojs/ui` StyleX snapshots (alert-dialog centering + `closedby`) updated; `@kovojs/headless-ui`
  autocomplete tests updated for the unconditional Enter `preventDefault`.
- Gallery rebuilt; confirmed in the compiled artifact: accordion inner div now carries
  `data-bind:data-state`; alert-dialog `<dialog>` carries `closedby="any"` + the corrected centering
  atoms; autocomplete client handler prevents default on Enter.
- After deploy, re-probed kovo.sh: accordion collapses to 0, dialog centers + backdrop-dismisses,
  autocomplete Enter selects without reloading.
