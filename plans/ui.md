# UI Libraries - `@jiso/headless-ui`, Vendored `@jiso/ui`, And Gallery

Status: active. Last compacted on 2026-06-12.

Scope: `packages/headless-ui`, `packages/ui`, `examples/gallery`, and the framework seams needed
for package prefixes, behavior attributes, primitive authoring lint, vendoring, and gallery
conformance.

Keep this ledger compact. Track current state, open work, latest proving commands, and integration
risks. Do not append long historical command lists.

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

- Headless UI exports shared H0 helpers and H1/H2/H3 primitive helpers through package subpaths.
- `@jiso/ui` ships vendorable styled TSX wrappers for pure-markup components, H1 primitives, and
  current H2/H3 wrapper surfaces.
- `fw add` vendors package-synchronized TSX source and rejects unknown names with the generated
  catalog list.
- Gallery tests cover static fixtures, behavior contracts, merge fixtures, compiled interactive
  demos, generated-client DOM ref/export contracts, and static docs export wiring.
- G5 exported primitive attrs inventory is closed for all exported primitive `*Attributes`
  builders, with author stress attrs, rendered merge goldens, and SPEC §4.6 diagnostic checks.
- U3/U4/U5 styled wrappers are broadly present for current H1/H2/H3 exports; future wrapper work
  should be tied to new primitive exports or behavior parity fixes.
- Field/fieldset includes styled input, textarea, select, and fieldset grouping over the shared
  native field IDREF contract, plus compiled interactive gallery coverage for validity and native
  group state.
- H3 menu/navigation typeahead supports repeated printable-key cycling and skips disabled items
  for dropdown-menu, context-menu, menubar, and navigation-menu.
- H3 autocomplete/combobox movement covers open-then-move Arrow key handlers and disabled-option
  skipping.
- H3 command preserves stable option ids across filtering so `aria-activedescendant` remains
  aligned with rendered option ids.
- Native value-backed primitive handlers for select, number-field, slider, toolbar, tabs,
  radio-group, toggle-group, toast, autocomplete, combobox, command, and otp-field have focused
  interactive or unit coverage for recent state synchronization fixes.
- Number-field step buttons now align off-step values to an explicit native `min`/`step` grid
  before clamping, preserving the real `type="number"` control contract from SPEC §6.3.
- Checkbox-group item clicks restore the live native checkbox `checked` property when SPEC §4.6
  cancelable/blocked changes leave the primitive value unchanged, and the G5 merge golden now
  preserves checkbox-group `role="group"` semantics.
- OTP field delete and paste handlers now restore the live slot input value when SPEC §4.6
  cancelable changes are rejected, and the aggregate named input exposes native length
  constraints for SPEC §6.3 form-control semantics.
- Scroll-area now derives native viewport edge/visibility facts from real scroll metrics and
  exposes `data-scroll-x`, `data-scroll-y`, and `data-scroll-position` attrs through headless and
  styled wrappers while keeping scrolling native per SPEC §4.6.

## Open Work

H2:

- [ ] Re-audit the full H2 primitive list against package exports, tests, styled wrappers, gallery
      routes, behavior contracts, merge fixtures, and compiled interactive coverage before
      checking H2 complete.
- [x] Close the remaining scroll-area native scroll-state gap with focused primitive tests.
      Evidence 2026-06-13: `packages/headless-ui/src/primitives/scroll-area.ts` exports
      `scrollAreaViewportState` and SPEC §4.6-safe `scrollAreaViewportScroll`, styled wrappers
      forward the computed scroll-position attrs, and `/components/scroll-area` renders the static
      attrs. Same-session proof: `pnpm exec vitest --run
packages/headless-ui/src/primitives/scroll-area.test.ts`, `pnpm --filter @jiso/headless-ui
exec vitest --run`, `pnpm --filter @jiso/headless-ui run lint:primitives`, `pnpm --filter
@jiso/ui exec vitest --run`, and `pnpm exec vitest --run
examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts
examples/gallery/src/merge-fixtures.test.tsx`.
- [ ] Close any remaining field/fieldset behavior gaps with focused primitive tests rather than
      styled-only evidence.
- [ ] Keep field/fieldset future work tied to `form()` integration and native validity semantics.

H3:

- [ ] Re-audit the full H3 primitive list against package exports, tests, styled wrappers, gallery
      routes, behavior contracts, and browser-backed interactive coverage before checking H3
      complete.
- [ ] Close remaining state/focus/menu edge cases for select, combobox, autocomplete,
      dropdown-menu, context-menu, menubar, navigation-menu, slider, toast, and command with
      primitive tests plus gallery evidence where user-visible.
- [ ] Confirm input-like H3 primitives restore rejected native values for disabled/canceled
      cancelable changes across the full family.

Styled UI:

- [ ] Keep vendored source app-authored TSX: no `@jiso/ui` self-imports, no hand-authored lowered
      IR, no `fw-c=`, and no `data-bind=` in vendored component source.
- [ ] Keep CLI add-catalog tests synchronized with `packages/ui/package.json` exports.
- [ ] Resolve any remaining CLI catalog fixture drift when new UI subpaths are exported.

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

- `pnpm install --frozen-lockfile`
- `pnpm exec vitest --run packages/headless-ui/src/primitives/scroll-area.test.ts`
- `pnpm exec vitest --run packages/ui/src/index.test.tsx`
- `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/merge-fixtures.test.tsx`
- `pnpm --filter @jiso/headless-ui exec vitest --run`
- `pnpm --filter @jiso/headless-ui run lint:primitives`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm exec vp check packages/headless-ui/src/primitives/scroll-area.ts packages/headless-ui/src/primitives/scroll-area.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts packages/ui/src/scroll-area.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/merge-fixtures.test.tsx IMPLEMENT_v1.md plans/ui.md`
- `git diff --check`

Latest broad gate:

- `pnpm run check` passed after `37cc7e3` with 768 formatted files, 670 lint/typechecked files,
  and 7 typechecked example/conformance projects.

## Rules

- Prefer native platform behavior first; JS should add state coordination only when native
  semantics are insufficient.
- Primitive handlers must respect `event.defaultPrevented` and leave DOM/native state coherent
  after canceled changes.
- Behavior attributes belong to package prefixes such as `jiso-*`; framework `fw-*` stays
  reserved.
- `@jiso/ui` components are vendored TSX source, not runtime imports from the package.
- Gallery evidence should prove authored TSX, rendered markup, generated clients, and browser
  behavior where each surface is relevant.
