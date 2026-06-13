# UI Libraries - `@jiso/headless-ui`, `@jiso/ui`, And Gallery

Status: active. Last compacted on 2026-06-13.

Scope: `packages/headless-ui`, `packages/ui`, `examples/gallery`, and framework seams for package
prefixes, behavior attributes, primitive authoring lint, vendoring, and gallery conformance.

Keep this ledger compact. Track current state, open work, latest proving commands, and integration
risks. Use `- [ ]` for open actionable items and `- [x]` only for fully verified items.

## Checklist

- [x] F1 SPEC text: package prefix registration, `jiso-*` reservation, alias escape, behavior
      namespace implications, FW234.
- [x] F2 compiler/CLI prefix enforcement: package manifest prefix facts, aliasing, `fw explain`
      component provenance, Vite/CLI discovery.
- [x] F3 behavior-attribute namespace: `fw-*` reserved; package behaviors use package prefixes
      and participate in FW221 IDREF validation.
- [x] F4 primitive-author lint: primitive handlers no-op on `event.defaultPrevented`.
- [x] F5 platform audit: native platform decisions, CSS anchor/starting-style/discrete-transition
      coverage, lazy floating fallback boundary.
- [x] H0 shared lib: state/data attrs, cancelable change details, keyboard maps, typeahead,
      positioning fallback.
- [x] H1 wave 1 primitives: dialog, alert-dialog, popover, tooltip, hover-card, collapsible,
      accordion, separator, progress, meter, avatar, toggle, switch, checkbox.
- [ ] H2 wave 2 primitives: tabs, radio-group, toggle-group, checkbox-group, toolbar,
      number-field, otp-field, scroll-area, field/fieldset integration.
- [ ] H3 wave 3 primitives: select, combobox, autocomplete, dropdown-menu, context-menu, menubar,
      navigation-menu, slider, toast, command.
- [x] U1 styled foundation: token sheet, `cn()`, statically analyzable variant helper.
- [x] U2 `fw add <component>` vendoring pipeline.
- [x] U3 styled H1 and pure-markup components.
- [x] U4 styled H2 components.
- [x] U5 styled H3 components.
- [ ] G1 gallery static fixture surface: one route per component with source/markup snapshot.
- [ ] G2 behavior-contract gates: keyboard/ARIA/native state checks and `fw explain` coverage.
- [ ] G3 axe checks per component state.
- [ ] G4 visual regression baseline for `@jiso/ui`.
- [x] G5 merge fixtures for primitive attrs plus author elements.
- [ ] G6 compiled interactive gallery authored as app TSX and exercised in browser.

## Current State

- Headless UI exports H0 helpers and H1/H2/H3 primitive helpers through package subpaths.
- `@jiso/ui` ships vendorable styled TSX wrappers for pure-markup components and current primitive
  wrapper surfaces.
- `fw add` vendors package-synchronized TSX source and rejects unknown names with the generated
  catalog list.
- Gallery tests cover static fixtures, behavior contracts, merge fixtures, compiled interactive
  demos, generated-client DOM/ref/export contracts, and static docs export wiring.
- G5 exported primitive attrs inventory is closed for all exported primitive `*Attributes`
  builders, including author stress attrs, rendered merge goldens, and SPEC §4.6 diagnostics.
- Field/fieldset includes styled input, textarea, select, and grouping over the shared native
  field IDREF contract, plus compiled interactive gallery coverage for validity and group state.
- Recent native-state work covers number-field off-grid stepping, checkbox-group canceled-change
  restoration, OTP delete/paste restoration and native constraints, scroll-area viewport state,
  H3 typeahead/movement/disabled-option handling, stable command option ids, and
  navigation-menu Enter/Space trigger keyboard activation.

## Open Work

H2:

- [ ] Re-audit the full H2 primitive list against package exports, tests, styled wrappers, gallery
      routes, behavior contracts, merge fixtures, and compiled interactive coverage before
      checking H2 complete.
- [x] Close the scroll-area native scroll-state gap with focused primitive tests.
      Evidence: `scrollAreaViewportState`, `scrollAreaViewportScroll`, styled attr forwarding, and
      `/components/scroll-area` static attrs are covered by headless/UI/gallery tests.
- [ ] Close remaining field/fieldset behavior gaps with focused primitive tests rather than
      styled-only evidence.
      Evidence: field controls omit inactive native `disabled` booleans, preserve active disabled
      state, forward native constraint/autofill attributes (`autoComplete`, `inputMode`,
      `maxLength`, `minLength`, `pattern`), and `/components/field` renders those named-control
      validity hints for email/profile controls.
- [ ] Keep field/fieldset future work tied to `form()` integration and native validity semantics.

H3:

- [ ] Re-audit the full H3 primitive list against package exports, tests, styled wrappers, gallery
      routes, behavior contracts, and browser-backed interactive coverage before checking H3
      complete.
- [ ] Close remaining state/focus/menu edge cases for select, combobox, autocomplete,
      dropdown-menu, context-menu, menubar, navigation-menu, slider, toast, and command with
      primitive tests plus gallery evidence where user-visible.
      Evidence: navigation-menu trigger keyboard activation now opens content-owning active items
      from Enter, Space, and legacy Spacebar with `trigger-keyboard` details, leaves native links
      alone, and keeps disabled content items from opening; gallery behavior contracts document
      the same Enter/Space trigger-content behavior.
- [ ] Confirm input-like H3 primitives restore rejected native values for disabled/canceled
      cancelable changes across the full family.

Styled UI:

- [ ] Keep vendored source app-authored TSX: no `@jiso/ui` self-imports, no hand-authored lowered
      IR, no `fw-c=`, and no `data-bind=` in vendored component source.
- [ ] Keep CLI add-catalog tests synchronized with `packages/ui/package.json` exports.
- [ ] Resolve CLI catalog fixture drift when new UI subpaths are exported.

Gallery:

- [ ] Expand G1 route coverage until every primitive/styled component has a gallery fixture.
- [ ] Expand G2 beyond representative `fw explain` coverage when more primitive families need
      provenance, keyboard, ARIA, native-state, or merge-diagnostic examples.
- [ ] Add G3 axe checks once the gallery surface is stable enough to avoid churn-heavy baselines.
- [ ] Add G4 visual regression baselines for `@jiso/ui` once route/state coverage is stable.
- [ ] Keep G6 compiled interactive demos app-authored TSX, checked in, generated-artifact fresh,
      and browser-tested when behavior changes.

## Latest Gates

Latest integrated UI slice:

- `pnpm install`
- `pnpm exec vitest --run packages/headless-ui/src/primitives/navigation-menu.test.ts`
- `pnpm exec vitest --run examples/gallery/src/behavior-contracts.test.ts`
- `pnpm exec vitest --run packages/ui/src/index.test.tsx -t navigation-menu`
- exact `pnpm exec vp check packages/headless-ui/src/primitives/navigation-menu.ts packages/headless-ui/src/primitives/navigation-menu.test.ts examples/gallery/src/demo-fixtures.tsx examples/gallery/src/behavior-contracts.test.ts plans/ui.md plans/codebase-quality-round2.md`
- `git diff --check`

Latest broad gate:

- `pnpm run check` passed after `0cac62d` with 782 formatted files, 682 lint/typechecked files,
  and 7 typechecked example/conformance projects.

## Rules

- Prefer native platform behavior first; JS should add state coordination only when native
  semantics are insufficient.
- Primitive handlers must respect `event.defaultPrevented` and leave DOM/native state coherent
  after canceled changes.
- Behavior attributes belong to package prefixes such as `jiso-*`; framework `fw-*` stays reserved.
- `@jiso/ui` components are vendored TSX source, not runtime imports from the package.
- Gallery evidence should prove authored TSX, rendered markup, generated clients, and browser
  behavior where each surface is relevant.
