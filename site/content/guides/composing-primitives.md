---
title: Composing primitives
description: Merge headless primitive behavior into your own elements, know which attributes compose, and see where conflicts fail the build.
order: 12
---

# Composing primitives

Use this when you want the primitive's behavior but you still want to own the element and most of
its markup. Kovo's primitive composition model is not a runtime wrapper trick. The primitive builds
an attribute record, and the compiler merges that record into your element before emission.

## Attach behavior to your element

The base form is an attrs builder plus your own element:

```text
import { tooltipTriggerAttributes } from '@kovojs/headless-ui/tooltip';

const attrs = tooltipTriggerAttributes({ contentId: 'pricing-tip', open: false });
<a {...attrs} href="/pricing" class="nav-link">Pricing</a>;
```

That is the core idea. The primitive computes ARIA, `data-state`, IDs, and handler refs. Your
element still owns the tag, text, href, and author styling.

## Use asChild

When a component family offers `asChild`, it is just sugar for the same merge:

```text
<TooltipTrigger asChild>
  <a href="/pricing">Pricing</a>
</TooltipTrigger>
```

Use it when the child is one static element. If the child is dynamic or plural, drop back to the
explicit attrs form so the merge target stays obvious.

## Use behavior attributes

For trigger-shaped cases, you can annotate the element directly:

```text
<button type="button" kovo-tooltip="pricing-tip">Pricing</button>
```

This is the only form that still works on markup Kovo did not render for you, such as CMS or
markdown output.

## Check what merging does

The merge rules are fixed by attribute class:

| Attribute class                                        | Rule                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `class`                                                | concatenate, primitive first and author last             |
| `style`                                                | concatenate, author declarations last                    |
| `on:<event>`                                           | chain left to right, author first and primitive second   |
| `id`                                                   | author wins; primitive IDREFs rewire to the surviving id |
| descriptive `aria-*` and `role`                        | author wins, with a visible override lint                |
| state `aria-*`, `data-state`, primitive-owned `data-*` | primitive wins, with a state-override lint               |
| conflicting IDREF relationships                        | build error                                              |

The important split is between descriptive attributes you intentionally override and live state the
primitive keeps updating after render.

## Handle failure

The framework refuses ambiguous merges:

- Unmergeable conflicts when both sides wire the same IDREF relationship.
- A visible override lint when you replace a primitive-owned state or ARIA attribute.
- A hard error when a static state ARIA value contradicts the primitive's render-time state.

Those failures are the feature. Kovo would rather stop the build than leave you with a UI whose
first state change clobbers your authored attribute.

## Next

- [Components & copy-in UI](/guides/components/) - use the public primitive packages and styled wrappers.
- [Accessibility](/guides/accessibility/) - understand what the primitive families already prove for you.

<details>
<summary>Spec & diagnostics</summary>

Normative merge model and full rule table: `spec/04-component-model.md` section 4.6. Tooltip
builder example: `packages/headless-ui/src/public/tooltip.ts` and
`packages/headless-ui/src/primitives/tooltip.ts`. The diagnostics named here are the primitive
composition family in `spec/11-diagnostics.md`.

API reference: [@kovojs/headless-ui](/api/headless-ui/).

</details>
