# Reactive Primitive Attributes — Non-Boolean Controls

Extend the reactive-primitive-attribute compiler kernel to cover components whose
state is controlled by a **non-boolean** prop, so their primitive-owned
`aria-*`/`data-state`/`hidden` attributes (and decorative visuals) update on the
client without the demos hand-writing state attributes.

Authority: `SPEC.md` §4.6 (primitives own `aria-*`/`data-state`; hand-writing
them is **KV232**) and §5.2/**KV235** (TSX is the only app-authoring surface).
Follow-up to the shipped kernel on this branch (`agent/gallery-fix`).

## What already works (do not rebuild)

The kernel handles **boolean-controlled** primitives end-to-end:

- Phase `lowerPrimitiveReactiveAttributes` — `packages/compiler/src/lower/structural-jsx.ts`
- Component→primitive registry — `packages/compiler/src/lower/primitive-reactive-registry.ts`
- Dev-time snapshot generator — `packages/compiler/scripts/gen-primitive-reactive-attrs.mjs`
  → committed data `packages/compiler/src/generated/primitive-reactive-attrs.ts`
- Decorative-child reactivity helpers — `packages/ui/src/pass-through.ts`
  (`island: false` strips `kovo-*` ownership so the root is the sole island host
  per §4.6/KV231; `bindingProps()` forwards only `data-bind:*` to decorative spans).
  Applied to `switch` (track/thumb reactive).

Covered: switch, toggle, disclosure, collapsible, dialog, tooltip. Probe 49/51.

## The gap

The snapshot technique diffs a primitive attr fn over a boolean field
(`{true,false}`). Three components use a non-boolean control and are skipped, so
their state-derived attributes serialize once at SSR and freeze:

- [ ] **accordion** — control is `value` (string/array); trigger `aria-expanded` /
      content `hidden` derive from `value === itemValue` (single) or
      `value.includes(itemValue)` (multiple). The only remaining broken
      _interaction_ (click does not toggle `aria-expanded`). - Evidence: probe `accordion: click toggles aria-expanded :: false->false`;
      `accordionTriggerAttributes` (`packages/headless-ui/src/primitives/accordion.ts:117`)
      computes `aria-expanded` from `value`+`itemValue`+`type`.
- [ ] **checkbox** — control is tri-state `checked` (`true|false|'indeterminate'`);
      `data-state` is 3-way. Interaction works (native), but the custom box glyph
      (`packages/ui/src/checkbox.tsx`, `[data-state=checked]::after`) is static.
- [ ] **radio-group** — control is group `value`; each item's `data-state`/checked
      derives from `value === itemValue`. Item interaction works (native), but the
      custom dot (`packages/ui/src/radio-group.tsx`) is static.

## Plan

- [ ] **Extend the kernel to non-boolean control props.** Generalize
      `lowerPrimitiveReactiveAttributes` + the registry to support a control whose
      derive compares state against a per-element static discriminator
      (`itemValue`) and/or enumerates a small value set (tri-state). Synthesize
      `(state) => state.<ctrl> === '<itemValue>' ? <on> : <off>` (equality form) and
      a 3-way form for tri-state, reading the static discriminator from the element
      attributes. Add registry entries: AccordionTrigger/AccordionContent (`value`,
      discriminator `itemValue`, `type`), Checkbox (`checked` tri-state),
      RadioGroupItem (`value`, discriminator `itemValue`). - Evidence target: regenerated `examples/gallery/src/generated/interactive/accordion-demo.tsx`
      gains `data-bind:aria-expanded`/`data-bind:hidden`; live probe
      `accordion: click toggles aria-expanded :: false->true`.
- [ ] **Forward reactive `data-state` to checkbox/radio decorative children** once
      the kernel emits it — apply the `island:false` + `bindingProps()` pattern used
      in `switch.tsx` to `checkbox.tsx` (box) and `radio-group.tsx` (dot).
- [ ] **Verify against the no-hand-write rule.** Confirm the accordion/checkbox/
      radio demos add no `aria-*`/`data-state` by hand and that interactions +
      decorative visuals are reactive.

## Verification (run from the worktree root)

- `corepack pnpm --filter @kovojs/compiler exec vitest run` (kernel unit + gallery-merge-fixtures + fixpoint)
- `node scripts/import-boundary.mjs` (no production headless-ui import)
- `pnpm --filter @kovojs/example-gallery run emit:interactive-gallery` then rebuild
  `@kovojs/site` and re-run the Playwright interaction probe (target 51/51)
- `vp run conformance`
