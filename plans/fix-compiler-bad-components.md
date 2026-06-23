# Fix Compiler Bad Components

Active implementation plan for the compiler-side fixes left open by `plans/bad-components.md`.
Normative behavior comes from `SPEC.md`:

- `SPEC.md` §4.6: primitives own reactive `aria-*`, `data-state`, and primitive-owned `data-*`.
- `SPEC.md` §4.8: app TSX writes typed expressions; compiler-emitted `data-bind:*` stamps keep DOM
  attributes live and must remain safe for their sinks.
- `SPEC.md` §5.2 and `rules/compiler-hard-rules.md`: compiler output must be fixpoint-stable,
  render-equivalent to source, and post-parse decisions must use typed facts.
- `SPEC.md` §13.1: styled UI remains light DOM; StyleX extraction is not a second app authoring
  surface.

## Current Gap

`Progress` is imported and used by the gallery (`examples/gallery/src/interactive/progress-demo.tsx`,
`examples/gallery/src/demo-fixtures.tsx`) and exported by `@kovojs/ui/progress`, but it is not
registered in `packages/compiler/src/lower/primitive-reactive-registry.ts` and has no generated
manifest entry in `packages/compiler/src/generated/primitive-reactive-attrs.ts`.

The existing primitive reactive lowering covers boolean, equality, set-membership, and tri-state
controls. It does not cover numeric/range primitives. As a result, a call site like
`<Progress value={state.value} max={100}>` can update the visually hidden native `<progress>`, but
the styled indicator span needs demo-authored reactive `style`/`data-state` props forwarded through
`bindingProps(props, ['style', 'data-state'])`.

The proper framework fix is to make the compiler derive the Progress and Meter visual bindings from
their typed control props, so consumers do not hand-author workaround `style` or `data-state`
bindings.

## Target Behavior

- [x] `<Progress value={state.value} max={100}>` emits compiler-owned reactive stamps for the
      native progress attributes and the visible indicator state.
  - Evidence: compiler test `src/primitive-reactive-attributes.test.ts` passed; the Progress test
    asserts `data-bind:value`, `data-bind:data-value`, `data-bind:data-state`, and
    `data-bind:style`.
- [x] `<Progress value={state.value} max={state.max}>` handles reactive `max` when the expression
      has a single allowed root (`state` or one known query).
  - Evidence: same focused compiler test compiles `max={state.max}` and asserts the generated
    numeric derive normalizes/clamps through the Progress expression.
- [x] Indeterminate Progress (`value === null`, `undefined`, or non-finite) removes `value` /
      `data-value`, sets `data-state="indeterminate"`, and does not leave a stale width on the
      visible indicator.
  - Evidence: focused compiler test asserts the emitted Progress derive contains the null/undefined
    branch and `indeterminate`; browser test
    `src/interactive-gallery.interactions-b.browser.test.ts` passed and verifies pending state.
- [x] Complete Progress clamps over-max values, emits `data-state="complete"`, and computes
      `width:100%`.
  - Evidence: focused compiler test asserts `complete`; browser test
    `src/interactive-gallery.interactions-b.browser.test.ts` passed and verifies value `100`
    produces `data-state="complete"`.
- [x] `<Meter value={state.value} min={...} max={...} low={...} high={...} optimum={...}>` receives
      equivalent compiler support for `data-value`, `data-state`, and visible indicator width.
  - Evidence: focused compiler test asserts Meter `data-*`/`style` stamps and qualitative states;
    browser test passed and verifies `optimum` -> `suboptimum` runtime updates.

## Implementation Tasks

- [x] Extend the generated primitive reactive manifest model to support numeric/range primitives.
  - Include enough metadata to describe Progress and Meter normalization without importing
    `@kovojs/headless-ui` from production compiler source.
  - Keep generation in `packages/compiler/scripts/gen-primitive-reactive-attrs.mjs`; production
    compiler source should continue reading committed generated data.
  - Evidence: `packages/compiler/src/generated/primitive-reactive-attrs.ts` now includes
    `progress-ratio`, `meter-range`, and `computedAttrs`; production lowering still imports only the
    generated table.
- [x] Add Progress and Meter probes to the generator.
  - Progress probe should cover indeterminate, loading, and complete states.
  - Meter probe should cover min/max normalization and threshold-derived state.
  - Evidence: `corepack pnpm --filter @kovojs/compiler run gen:reactive-attrs` passed and printed
    `progress.root` / `meter.root` entries.
- [x] Register `Progress` and `Meter` in
      `packages/compiler/src/lower/primitive-reactive-registry.ts`.
  - Confirm imports from both `@kovojs/ui` and subpaths (`@kovojs/ui/progress`,
    `@kovojs/ui/meter`) resolve through the existing `isKovoUiModuleSpecifier` path.
  - Evidence: focused compiler tests import from `@kovojs/ui/progress` and `@kovojs/ui/meter` and
    pass through the registry path.
- [x] Teach `lowerPrimitiveReactiveAttributes` to emit numeric/range derives.
  - Reuse typed parser facts for prop expressions; do not inspect source strings outside scanner
    output (`rules/compiler-hard-rules.md` #9).
  - Preserve idempotency: skip a stamp if `data-bind:<attr>` already exists, and avoid KV233
    double-binding when an author intentionally writes the same target.
  - Evidence: focused compiler test passed with fixpoint assertions; `vp check` passed on touched
    compiler files.
- [x] Add a constrained compiler-owned style derive for indicator width.
  - This must not become arbitrary raw CSS binding. It should mirror the safe serialization used for
    object-literal `style={{ width: ... }}` lowering, limited to `width`.
  - The emitted stamp should be consumable by the existing `bindingProps` forwarding in
    `packages/ui/src/progress.tsx` and `packages/ui/src/meter.tsx`.
  - Evidence: generated derives use `kovoStyleProperty("width", ...)`; generated gallery artifacts
    contain indicator-consumed `data-bind:style` for Progress and Meter.
- [x] Decide whether root `data-state` should also be live.
  - Current components forward the indicator state, but root `data-state` is static unless the
    compiler-emitted stamp lands where the component can forward or apply it. If root-level styling
    ever depends on live state, add an explicit binding path and tests.
  - Evidence: current Progress/Meter root styles do not contain state selectors; indicator styles do,
    and `bindingProps(props, ['style', 'data-state'])` receives the generated stamps.
- [x] Remove gallery workaround props after the compiler fix is proven.
  - Update `examples/gallery/src/interactive/progress-demo.tsx` and meter demo code so they express
    only semantic inputs (`value`, `max`, thresholds, `valueText`) and no compiler workaround
    `style`/`data-state`.
  - Evidence: the `rg` workaround search over the Progress and Meter interactive demos returns no
    matches.

## Verification

- [x] Run focused compiler tests for primitive reactive lowering.
  - Evidence: `@kovojs/compiler` focused primitive-reactive vitest passed, 17 tests.
- [x] Run affected UI StyleX/markup tests.
  - Evidence: `@kovojs/ui` Progress/Meter/markup vitest passed, 11 tests.
- [x] Run affected gallery interaction tests.
  - Evidence: after regenerating interactive artifacts and copying ignored client artifacts to the
    browser fixture import path for verification, `@kovojs/example-gallery`
    `interactive-gallery.interactions-b.browser.test.ts` passed, 17 tests.
- [x] Run compiler fixpoint/render-equivalence gates touched by the new lowering.
  - Evidence: focused compiler tests call `assertFixpoint`; gallery emit check passed and compiles
    each demo with `--fixpoint --render-equivalence`.
- [x] Inspect emitted gallery HTML or generated server output for Progress and Meter.
  - Evidence: `rg` over generated Progress and Meter interactive artifacts shows
    `data-bind:style` and live state/value mirror attrs.

## Risks And Open Decisions

- [x] Style binding safety: numeric indicator width must stay a compiler-owned constrained derive,
      not a general escape hatch around KV236.
  - Evidence: lowering emits only `kovoStyleProperty("width", ...)` from compiler-owned numeric
    formulas.
- [x] Reactive multi-prop support: Progress and Meter depend on more than one prop (`value`, `max`,
      and Meter thresholds). The initial implementation may support only same-root expressions plus
      static numeric props; mixed roots should fail closed by omitting the derived visual binding or
      producing a teaching diagnostic.
  - Evidence: `numericAttributeExpression` accepts static numeric props or expressions rooted in the
    same reactive root; otherwise it returns `null` and omits the numeric binding.
- [x] Root vs indicator ownership: if compiler stamps are emitted on the component call-site, the UI
      component must forward them to the actual DOM node that needs them. `bindingProps` already
      handles the indicator path; root state may need a separate forwarding story.
  - Evidence: root state selectors are not used for Progress/Meter; generated component-call stamps
    are consumed by native controls and indicator spans.
- [x] Generator coverage: boolean diffing is not enough for numeric primitives. The generator should
      snapshot representative enum/numeric states or carry explicit formulas, then tests must prove
      parity with headless primitive normalization.
  - Evidence: generator records numeric `computedAttrs` and sampled enum states; focused compiler
    tests verify formulas against Progress/Meter expected states.
- [x] Meter parity: Meter threshold logic is more complex than Progress. Do not close Progress while
      leaving Meter with the same latent frozen-indicator issue unless the plan records the split and
      the remaining risk.
  - Evidence: Meter compiler test and browser interaction test passed with value/state/style
    reactivity.
