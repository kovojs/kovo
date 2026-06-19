# Reactive Primitive Attributes — Non-Boolean Controls

Extend the reactive-primitive-attribute compiler kernel to cover primitives whose
state is controlled by non-boolean props, so primitive-owned `aria-*`,
`data-state`, `hidden`, and checked-state attributes update without demos
hand-writing them.

Authority: `SPEC.md` §4.6 (primitives own `aria-*`/`data-state`; hand-writing
them is KV232) and §5.2/KV235 (TSX is the app-authoring surface).

## Current State

- [x] **Accordion value/itemValue derives are emitted.**
      Evidence: `corepack pnpm --filter @kovojs/compiler exec vitest run`
      passes `packages/compiler/src/primitive-reactive-attributes.test.ts`
      coverage for single equality and multiple membership derives; regenerated
      `examples/gallery/src/generated/interactive/accordion-demo.tsx` contains
      `data-bind:aria-expanded` and `data-bind:hidden`.
- [x] **Checkbox tri-state derives are emitted.**
      Evidence: compiler vitest covers `checked: true | false | "indeterminate"`
      mapping to `aria-checked` and `data-state`; regenerated
      `examples/gallery/src/generated/interactive/checkbox-demo.tsx` contains
      `data-bind:aria-checked` and `data-bind:data-state`.
- [x] **Radio-group value/itemValue derives are emitted.**
      Evidence: compiler vitest covers `value === itemValue` derives for
      `RadioGroupItem` and `RadioGroupRadio`; regenerated
      `examples/gallery/src/generated/interactive/radio-group-demo.tsx` contains
      `data-bind:aria-checked`, `data-bind:checked`, and `data-bind:data-state`.
- [x] **Decorative checkbox/radio visuals receive reactive `data-state`.**
      Evidence: `packages/ui/src/checkbox.tsx` and
      `packages/ui/src/radio-group.tsx` use `bindingProps(props, ['data-state'])`
      on decorative spans and `passThroughProps(props, { island: false })` on
      inner native inputs.
- [x] **Authored accordion/checkbox/radio demos do not hand-write primitive state
      attrs.**
      Evidence: `! rg "aria-expanded=|aria-checked=|data-state=" \
examples/gallery/src/interactive/accordion-demo.tsx \
examples/gallery/src/interactive/checkbox-demo.tsx \
examples/gallery/src/interactive/radio-group-demo.tsx`.
- [x] **Static verification is green for this slice.**
      Evidence: `corepack pnpm exec vp check --fix`; `node scripts/import-boundary.mjs`;
      `corepack pnpm --filter @kovojs/example-gallery run emit:interactive-gallery`;
      `corepack pnpm --dir site run build`; `corepack pnpm --filter @kovojs/example-gallery exec vitest run src/interactive-gallery.artifacts.test.ts src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts src/interactive-gallery.client-behavior.test.ts`;
      `corepack pnpm exec vp run conformance`; `corepack pnpm run check:build`;
      `corepack pnpm run check:kovo`; `corepack pnpm run test`.

## Open Verification

- [ ] **Browser interaction probe target 51/51 remains unproven.**
      `corepack pnpm --dir examples/gallery exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.generated-interactions-a.browser.test.ts src/interactive-gallery.generated-interactions-b.browser.test.ts`
      fails before component-specific assertions in the checked-in harness
      (`Missing interactive gallery browser fixture element`). A local harness
      experiment that removed unconditional async rendering let tests mount, but
      then exposed broader existing browser-test expectation failures such as
      versioned `/c/__v/<hash>/...` client-module URLs. Do not record the live
      Playwright probe as passed until that harness/probe is fixed separately.
