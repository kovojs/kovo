# Accessibility Conformance Rule

Primitive accessibility conformance is a standing release rule for claimed
primitive families.

Every claimed primitive family MUST be free of axe-core violations not only at
initial render but in the terminal awaited state of each interaction tier it
supports:

- Open or expanded states: accordion, disclosure, collapsible, dialog,
  alert-dialog, sheet, drawer, popover, tooltip, hover-card, command, and all
  menu surfaces.
- Checked, pressed, or selected states: checkbox including
  `aria-checked="mixed"`, switch, toggle, radio-group, checkbox-group,
  toggle-group, toolbar, and tabs.
- Value end-states: slider, number-field, OTP filled/complete, progress
  complete and indeterminate, and meter optimum band.
- Validation or error states: field and fieldset.

Static styled families, including alert, avatar, badge, breadcrumb, button,
card, kbd, separator, skeleton, and table, MUST be axe-clean as rendered.

Native top-layer content, including promoted `<dialog>` and `popover` content,
MUST be evaluated as visible, active DOM, not as a hidden subtree.

A state MAY be excluded from this requirement only where it cannot be represented
as an axe-stable DOM: transient transition or closing frames, time-based
auto-dismiss countdowns, and hover-only visual states with no ARIA/DOM delta.
Each exclusion MUST be justified in the proving suite.

Conformance is proven by the gallery browser axe suite
(`examples/gallery/src/interactive-gallery.browser.test.ts`), run under
Chromium. Public docs that summarize this rule should point readers here or to
SPEC §12.1 rather than rephrasing the full proof inline.
