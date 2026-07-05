---
title: Accessibility
description: Kovo's styled primitives are axe-clean across their interactive state tiers — proven, not asserted, by the framework's own gallery browser axe suite.
order: 10
---

# Accessibility

Use this page for the split that matters in practice: what the framework already proves for you, and
what still belongs to the app you author. Kovo runs its primitive families through
[axe-core](https://github.com/dequelabs/axe-core) in a real Chromium browser at the end-state of
each interaction tier. If a primitive can reach a state, that state is asserted axe-clean in CI.

## Use the primitives for the hard part

A primitive isn't one DOM — it's a small state machine. A dialog has a closed state and an open,
focus-trapped, `aria-modal` top-layer state. A checkbox has unchecked, checked, and
`aria-checked="mixed"` indeterminate states. A progress bar has a determinate value, a completed
value, and a valueless indeterminate state. An accessibility check that only sees the initial render
proves nothing about the states a user actually interacts with.

Kovo's gallery browser suite drives each primitive into its **terminal awaited active state** and
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

For native top-layer content (`<dialog>` promoted via `showModal`, popover-backed content), the
suite verifies that axe descends into the promoted subtree rather than passing vacuously against a
hidden node — the assertion is anchored to a genuinely visible, active element.

## Add the app-specific semantics

You do not need to re-prove primitive accessibility. Your job is the part only the app can know:
meaningful labels and copy, correct heading order in your own layouts, and the semantics around the
primitive.

That part is plain HTML. Start with the label the user hears:

```tsx
<section aria-labelledby="shipping-heading">
  <h2 id="shipping-heading">Shipping</h2>
  <label for="zip">ZIP code</label>
  <input id="zip" name="zip" autocomplete="postal-code" />
</section>
```

A primitive can be flawless and the surrounding region still fail an audit if the labels are missing
or the heading levels skip. Concretely — give the form region an accessible name, wire each control
to a real `<label>`, and nest headings without gaps:

```tsx
/** @jsxImportSource @kovojs/server */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kovojs/ui/select';

export function ShippingSection() {
  const items = [
    { value: 'standard', label: 'Standard (5-7 days)' },
    { value: 'express', label: 'Express (1-2 days)' },
  ];

  return (
    <section aria-labelledby="shipping-heading">
      <h2 id="shipping-heading">Shipping</h2>

      {/* h2 → h3, no skipped level */}
      <h3 id="shipping-speed-heading">Delivery speed</h3>
      <label id="shipping-speed-label" for="shipping-speed-trigger">
        Shipping speed
      </label>
      <Select id="shipping-speed" items={items} listboxId="shipping-speed-listbox" value="standard">
        <SelectTrigger id="shipping-speed-trigger" items={items} labelledBy="shipping-speed-label">
          <SelectValue items={items} placeholder="Choose a speed" value="standard" />
        </SelectTrigger>
        <SelectContent
          id="shipping-speed-listbox"
          items={items}
          labelledBy="shipping-speed-label"
          value="standard"
        >
          <SelectItem itemValue="standard" value="standard">
            Standard (5-7 days)
          </SelectItem>
          <SelectItem itemValue="express" value="standard">
            Express (1-2 days)
          </SelectItem>
        </SelectContent>
      </Select>

      <label for="zip">ZIP code</label>
      <input id="zip" name="zip" inputmode="numeric" autocomplete="postal-code" />
    </section>
  );
}
```

The framework proves `Select` emits a correct listbox contract; only you can know that it labels
_delivery speed_, sits under a _Shipping_ heading, and that the heading order around it is `h2 →
h3` rather than `h2 → h4`.

## Know the documented exclusions

A few states cannot be represented as an axe-stable DOM, and the suite documents each exclusion
rather than writing a test that would pass without proving anything:

- **Transient transition frames.** The suite zeroes transitions and asserts terminal states; the
  in-between closing/dismissing frames are not stable DOM to assert against.
- **Toast auto-dismiss countdown.** A live region mid-countdown is a moving target; the open and
  dismissed end-states are asserted instead.
- **Hover-only visual states with no ARIA/DOM delta.** A purely visual `:hover` style with no
  attribute or structure change has nothing for axe to evaluate that the resting state doesn't
  already cover.

## Next

- [Composing primitives](/guides/composing-primitives/) - the merge rules behind the headless attributes you build on.
- [Components & copy-in UI](/guides/components/) - where those primitive families come from.
- For your own app-level audit recipe: render the route or flow in a real browser, drive it to each
  meaningful end-state, and run axe there. Kovo's proving command is
  `pnpm --filter @kovojs/example-gallery run test:browser`; use the same shape for your app's own
  labels, headings, and task flows.

<details>
<summary>Spec & diagnostics</summary>

The accessibility conformance contract — that every claimed primitive family is axe-clean across its
interactive state tiers (open/expanded/checked/selected/pressed/complete/error end-states), with
documented exclusions only where a state cannot be represented in an axe-stable DOM — is enforced by
`rules/accessibility-conformance.md`. The proving suites are
`examples/gallery/src/interactive-gallery.axe.browser.test.ts`,
`examples/gallery/src/interactive-gallery.interactions-a.browser.test.ts`, and
`examples/gallery/src/interactive-gallery.interactions-b.browser.test.ts`, which together run
axe-core in Chromium over the static fixtures and the primitive families' terminal interactive
states. Run them with
`pnpm --filter @kovojs/example-gallery run test:browser`.

</details>
