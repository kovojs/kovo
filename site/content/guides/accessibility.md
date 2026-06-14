---
title: Accessibility
description: Jiso's styled primitives are axe-clean across their interactive state tiers — proven, not asserted, by the framework's own gallery browser axe suite.
order: 10
---

# Accessibility

Most component libraries claim accessibility and ship an audit once. Jiso treats it as a standing
contract: every primitive family is run through [axe-core](https://github.com/dequelabs/axe-core) in
a real Chromium browser, not at initial render only but in the **end-state of each interaction
tier** — open, expanded, checked, selected, pressed, complete, error. If a primitive can reach a
state, that state is asserted axe-clean in CI. This is the framework's own guarantee, so apps inherit
it without writing accessibility tests of their own.

## What "axe-clean across state tiers" means

A primitive isn't one DOM — it's a small state machine. A dialog has a closed state and an open,
focus-trapped, `aria-modal` top-layer state. A checkbox has unchecked, checked, and
`aria-checked="mixed"` indeterminate states. A progress bar has a determinate value, a completed
value, and a valueless indeterminate state. An accessibility check that only sees the initial render
proves nothing about the states a user actually interacts with.

Jiso's gallery browser suite drives each primitive into its **terminal awaited active state** and
runs axe there. Concretely, the suite asserts axe-clean for, among others:

- **Disclosure tier** — accordion (expanded), disclosure (open panel), collapsible (native
  `<details open>`).
- **Overlay / top-layer tier** — dialog and alert-dialog (open, focus-trapped `<dialog>`), sheet and
  drawer (open side dialog), popover (`:popover-open`), tooltip (open, `aria-describedby` wired),
  hover-card, command palette, context menu, dropdown menu, menubar, navigation menu.
- **Selection / toggle tier** — toggle (`aria-pressed`), switch (checked), checkbox (checked **and**
  `aria-checked="mixed"` indeterminate), checkbox-group, radio-group, toggle-group, toolbar, tabs.
- **Value tier** — slider, number-field, OTP field (filled / complete aggregate, plus delete and
  paste), progress (complete **and** indeterminate), meter (optimum band), select, combobox,
  autocomplete.
- **Validation tier** — field / fieldset error states (`aria-invalid`, visible error message wired by
  IDREF).
- **Static styled tier** — alert, avatar, badge, breadcrumb, button, card, kbd, separator, skeleton,
  table, all axe-clean as rendered.

For native top-layer content (`<dialog>` promoted via `showModal`, `popover="manual"` content), the
suite verifies that axe descends into the promoted subtree rather than passing vacuously against a
hidden node — the assertion is anchored to a genuinely visible, active element.

## States that are intentionally not asserted

A few states cannot be represented as an axe-stable DOM, and the suite documents each exclusion
rather than writing a test that would pass without proving anything:

- **Transient transition frames.** The suite zeroes transitions and asserts terminal states; the
  in-between closing/dismissing frames are not stable DOM to assert against.
- **Toast auto-dismiss countdown.** A live region mid-countdown is a moving target; the open and
  dismissed end-states are asserted instead.
- **Hover-only visual states with no ARIA/DOM delta.** A purely visual `:hover` style with no
  attribute or structure change has nothing for axe to evaluate that the resting state doesn't
  already cover.

## What this means for your app

You don't need to re-prove primitive accessibility. The styled families you compose from are already
held to the axe-clean-across-states bar by the framework's suite. Your accessibility work is the part
only you can know: meaningful labels and copy, correct heading order in your own layouts, and the
semantics of content you author around the primitives.

<details>
<summary>Spec & evidence</summary>

The accessibility conformance contract — that every claimed primitive family is axe-clean across its
interactive state tiers (open/expanded/checked/selected/pressed/complete/error end-states), with
documented exclusions only where a state cannot be represented in an axe-stable DOM — is **SPEC
§12.1**. The proving suite is the gallery browser axe suite
(`examples/gallery/src/interactive-gallery.browser.test.ts`), which runs axe-core in Chromium at each
primitive's terminal awaited state and on the static styled fixtures. Run it with
`pnpm --filter @jiso/example-gallery run test:browser`.

</details>
